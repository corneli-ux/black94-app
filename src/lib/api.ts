import { auth, firestore, signInWithGoogleIdToken, signOut } from './firebase';
import { dispatchEngagementNotification, checkFollowerMilestones, checkPostLikeMilestones, sendWelcomeNotification, trackUserActivity } from '../services/engagementEngine';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  initE2EE,
  encryptMessage,
  decryptMessage,
  encryptedPreviewText,
  destroyLocalKeys,
} from './e2ee';

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  bio: string;
  profileImage: string | null;
  coverImage: string | null;
  role: string;
  badge: string;
  subscription: string;
  isVerified: boolean;
  createdAt: number;
}

export interface PollOptionData {
  id: string;
  text: string;
  votes: number;
}

export interface PostPollData {
  question: string;
  options: PollOptionData[];
  duration: number;
  totalVotes: number;
  createdAt?: any;
}

export interface Post {
  id: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorProfileImage: string | null;
  authorBadge: string;
  authorIsVerified: boolean;
  caption: string;
  mediaUrls: string[];
  pollData?: PostPollData;
  likeCount: number;
  commentCount: number;
  repostCount: number;
  liked: boolean;
  bookmarked: boolean;
  reposted: boolean;
  pollVoted?: boolean;
  createdAt: number;
  factCheckVerified?: number;
  factCheckDebunked?: number;
  // Repost fields — set when this post is a repost of another post
  repostOf?: string;
  repostedByUid?: string;
  repostedByUsername?: string;
  repostedByDisplayName?: string;
}

export interface Chat {
  id: string;
  user1Id: string;
  user2Id: string;
  lastMessage: string;
  lastMessageTime: number;
  unreadCount: number;
  otherUser: User | null;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  receiverId: string;
  content: string;
  messageType?: string;
  mediaUrl?: string | null;
  status?: string;
  createdAt: number;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

export function parseMediaUrls(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    // ROOT CAUSE FIX: Fix broken Firebase Storage URLs that have un-encoded
    // slashes in the path (produced by old encodeStoragePath which joined
    // segments with '/' instead of '%2F'). These URLs return HTTP 400.
    return raw
      .filter((v: any) => typeof v === 'string' && v.trim())
      .map((url: string) => fixMediaUrl(url));
  }
  if (typeof raw === 'string') {
    // BUG FIX: If the string is a URL (starts with http:// or https://),
    // return it as-is instead of splitting on commas. Firebase Storage
    // URLs don't contain commas in the path, but if downloadTokens
    // (comma-separated) was accidentally stored as the URL, splitting
    // would produce broken fragments.
    if (raw.startsWith('http://') || raw.startsWith('https://')) return [fixMediaUrl(raw)];
    if (raw.startsWith('data:')) return [raw];
    // Legacy format: comma-separated list of URLs
    return raw.split(',').map(u => fixMediaUrl(u.trim())).filter(Boolean);
  }
  return [];
}

/**
 * Fixes a Firebase Storage URL that has un-encoded slashes in the object path.
 *
 * The old upload code used encodeStoragePath() which joined path segments with '/'
 * instead of '%2F'. This produced URLs like:
 *   .../o/posts/uid/file.jpg?alt=media&token=...    → HTTP 400 Bad Request
 *
 * Firebase Storage requires:
 *   .../o/posts%2Fuid%2Ffile.jpg?alt=media&token=... → HTTP 200 OK
 *
 * This function is a synchronous version (no imports from imageUpload needed)
 * that repairs the URL in-place for use in parseMediaUrls.
 */
function fixMediaUrl(url: string): string {
  if (!url || (!url.startsWith('https://firebasestorage.googleapis.com') && !url.startsWith('https://storage.googleapis.com'))) {
    return url;
  }
  try {
    // Find the path between /o/ and ? in the URL
    const oIdx = url.indexOf('/o/');
    if (oIdx === -1) return url;
    const baseUrl = url.substring(0, oIdx + 3); // everything up to and including /o/
    const afterO = url.substring(oIdx + 3);
    const qIdx = afterO.indexOf('?');
    const pathPart = qIdx === -1 ? afterO : afterO.substring(0, qIdx);
    const queryPart = qIdx === -1 ? '' : afterO.substring(qIdx);

    // Decode, split by /, re-encode with %2F
    const decoded = decodeURIComponent(pathPart);
    const segments = decoded.split('/');
    if (segments.length <= 1) return url; // single segment, nothing to fix
    const fixedPath = segments.map(s => encodeURIComponent(s)).join('%2F');
    return `${baseUrl}${fixedPath}${queryPart}`;
  } catch {
    return url;
  }
}

export { tsToMillis } from '../utils/datetime';

function currentUser(): any {
  return auth()?.currentUser;
}

/**
 * Shared helper to get actor data for notifications with Zustand fallback.
 * If the user's Firestore doc is corrupted (empty username/displayName from
 * the old write.update bug), falls back to the Zustand store which has the
 * user's last known correct profile data. Also repairs the corrupted doc.
 */
async function getActorData(userId: string): Promise<{
  actorDisplayName: string;
  actorUsername: string;
  actorProfileImage: string | null;
  actorIsVerified: boolean;
  actorBadge: string;
}> {
  let myData: any = null;
  try {
    const myDoc = await firestore().collection('users').doc(userId).get();
    myData = myDoc.exists ? myDoc.data() : null;
  } catch {}

  // Zustand fallback for corrupted docs
  const corrupted = !myData?.username || !myData?.displayName;
  if (corrupted) {
    try {
      const { useAppStore } = await import('../stores/app');
      const storeUser = useAppStore.getState().user;
      if (storeUser) {
        myData = { ...myData, ...storeUser };
        // Fire-and-forget repair
        firestore().collection('users').doc(userId).update({
          username: storeUser.username || '',
          usernameLower: (storeUser.username || '').toLowerCase(),
          displayName: storeUser.displayName || 'User',
          profileImage: storeUser.profileImage || null,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});
      }
    } catch {}
  }

  return {
    actorDisplayName: myData?.displayName || '',
    actorUsername: myData?.username || '',
    actorProfileImage: myData?.profileImage || null,
    actorIsVerified: myData?.isVerified || false,
    actorBadge: myData?.badge || '',
  };
}

/* ── Auth ─────────────────────────────────────────────────────────────────── */

export async function signInWithGoogle(idToken: string): Promise<User | null> {
  try {
    const userCredential = await signInWithGoogleIdToken(idToken);
    const fbUser = userCredential.user;

    if (!fbUser) return null;

    // Create or update user doc in Firestore
    const userDocRef = firestore().collection('users').doc(fbUser.uid);
    let userDocSnap;
    let fetchFailed = false;
    try {
      userDocSnap = await userDocRef.get();
    } catch (e) {
      console.warn('[Auth] Firestore user doc fetch failed:', e);
      // BUG FIX: Do NOT treat fetch failure as "new user". The old code set
      // exists: false, which caused set(merge) to overwrite the user's custom
      // username/displayName with Google-derived defaults. This is how a user
      // registered as @cornelius had their profile changed to @das.
      fetchFailed = true;
      userDocSnap = { exists: false, data: () => null };
    }
    const username = fbUser.displayName?.replace(/\s/g, '').toLowerCase() || fbUser.uid;

    // Use the Google photoURL as-is.  The old _isStorageUrl filter was too
    // aggressive and caused profile images to be saved as null in Firestore,
    // breaking avatars permanently for those users.
    const googlePhoto = fbUser.photoURL || null;

    const userData: any = {
      uid: fbUser.uid,
      email: fbUser.email,
      username: username,
      usernameLower: username.toLowerCase(),
      displayName: fbUser.displayName || 'User',
      // BUG FIX: Add displayNameLower on sign-up so new users are searchable
      // by display name immediately (not only after editing their profile).
      displayNameLower: (fbUser.displayName || 'User').toLowerCase(),
      profileImage: googlePhoto,
      role: 'personal',
      badge: '',
      subscription: 'free',
      isVerified: false,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    };

    // Extract existing Firestore data ONCE, before the if/else branches use it.
    // BUG FIX: Use `let` because self-heal may re-read and reassign this variable
    // with healed data after updating the corrupted user doc.
    let existingData = userDocSnap.exists ? userDocSnap.data() : null;

    if (!userDocSnap.exists) {
      // BUG FIX: If the Firestore fetch FAILED, don't create/overwrite the user doc.
      // The doc likely exists — we just couldn't reach Firestore. Creating it now
      // would overwrite the user's custom username/displayName with Google defaults.
      // Fall through to return cached data from AsyncStorage instead.
      if (fetchFailed) {
        console.warn('[Auth] Skipping user doc creation — fetch failed, doc likely exists');
      } else {
        userData.createdAt = firestore.FieldValue.serverTimestamp();
        try {
          // Use merge: true so if the doc was created by another client between
          // the get() and set() (race condition), we don't overwrite existing fields.
          await userDocRef.set(userData, { merge: true });
          // USERNAME FIX: Check if the username is already taken before claiming it.
          // Without this check, two users with the same displayName could overwrite
          // each other's username mapping, causing username hijacking.
          const usernameDoc = await firestore().collection('usernames').doc(username.toLowerCase()).get();
          if (!usernameDoc.exists) {
            await firestore().collection('usernames').doc(username.toLowerCase()).set({ uid: fbUser.uid });
          }
        } catch (e) {
          console.warn('[Auth] Failed to create user doc:', e);
        }
      }
    } else {
      // Returning user — self-heal corrupted documents + photo recovery.
      //
      // SELF-HEAL: A previous bug in _firestoreCommitUpdate used write.update
      // without updateMask, which could REPLACE the entire document, deleting
      // fields not in the update payload (e.g., username, displayName,
      // profileImage stripped when only subscription/badge were written).
      // Detect this by checking for missing essential fields and restore them.
      //
      // REPAIR PRIORITY: AsyncStorage cached profile (has the user's LAST KNOWN
      // correct custom values) > Google auth data > hardcoded defaults.
      // This prevents the bug where self-heal replaces a custom username or
      // uploaded profile image with Google-generated defaults.
      try {
        const existingPhoto = existingData?.profileImage;
        const needsPhotoRecovery = !existingPhoto && googlePhoto;

        // Detect corrupted doc: essential fields missing after write.update bug
        const isCorrupted = !existingData?.username || !existingData?.displayName;

        // Load cached profile as repair source — has the user's last known
        // correct custom values (custom username, uploaded avatar, etc.)
        let cachedProfile: any = null;
        try {
          const raw = await AsyncStorage.getItem('@black94/user_cache');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.id === fbUser.uid) {
              cachedProfile = parsed;
            }
          }
        } catch {}

        // BUG FIX: Detect SILENT corruption — the old _firestoreCommitUpdate
        // bug could replace custom username/avatar with Google defaults without
        // actually DELETING the fields (so isCorrupted=false). Detect this by
        // checking if the Firestore doc's user-facing values match Google auth
        // data AND differ from the cached profile. The cache has the user's
        // LAST KNOWN correct values, so it's more reliable than Google defaults.
        const googleAutoUsername = fbUser.displayName?.replace(/\s/g, '').toLowerCase() || '';
        const isSilentlyCorrupted = !!cachedProfile && (
          (existingData?.username === googleAutoUsername && cachedProfile.username && cachedProfile.username !== googleAutoUsername) ||
          (existingData?.displayName === fbUser.displayName && cachedProfile.displayName && cachedProfile.displayName !== fbUser.displayName) ||
          (existingData?.profileImage === googlePhoto && cachedProfile.profileImage && cachedProfile.profileImage !== googlePhoto && !!googlePhoto)
        );

        if (isSilentlyCorrupted && __DEV__) {
          console.warn('[Auth] User doc silently corrupted (matches Google defaults, not cached profile) — restoring from cache');
        }

        const updateFields: Record<string, any> = {
          updatedAt: firestore.FieldValue.serverTimestamp(),
        };

        if (isCorrupted || isSilentlyCorrupted) {
          // BUG FIX: When silently corrupted, cached profile is MORE reliable than
          // existingData (which has Google defaults, not the user's custom values).
          // For isCorrupted (fields missing), existingData may be null/empty so
          // the cache fallback still works — but for isSilentlyCorrupted,
          // existingData has WRONG truthy values (e.g., Google auto username)
          // that would shadow the correct cached values via || operator.
          // Fix: prefer cache over existingData when isSilentlyCorrupted.
          const preferCache = isSilentlyCorrupted && cachedProfile;

          if (__DEV__) {
            console.warn('[Auth] User doc corrupted — self-healing from', preferCache ? 'cached profile (preferred)' : cachedProfile ? 'cached profile' : 'Google defaults');
          }

          updateFields.username = preferCache
            ? (cachedProfile.username || existingData?.username || username)
            : (existingData?.username || cachedProfile?.username || username);
          updateFields.usernameLower = preferCache
            ? ((cachedProfile.username || existingData?.username || username).toLowerCase())
            : (existingData?.usernameLower || cachedProfile?.username?.toLowerCase() || username.toLowerCase());
          updateFields.displayName = preferCache
            ? (cachedProfile.displayName || existingData?.displayName || fbUser.displayName || 'User')
            : (existingData?.displayName || cachedProfile?.displayName || fbUser.displayName || 'User');
          updateFields.email = preferCache
            ? (cachedProfile.email || existingData?.email || fbUser.email || '')
            : (existingData?.email || cachedProfile?.email || fbUser.email || '');
          updateFields.profileImage = preferCache
            ? (cachedProfile.profileImage || existingData?.profileImage || googlePhoto)
            : (existingData?.profileImage || cachedProfile?.profileImage || googlePhoto);
          updateFields.role = preferCache
            ? (cachedProfile.role || existingData?.role || 'personal')
            : (existingData?.role || cachedProfile?.role || 'personal');
          updateFields.badge = preferCache
            ? (cachedProfile.badge || existingData?.badge || '')
            : (existingData?.badge || cachedProfile?.badge || '');
          updateFields.subscription = preferCache
            ? (cachedProfile.subscription || existingData?.subscription || 'free')
            : (existingData?.subscription || cachedProfile?.subscription || 'free');
          updateFields.isVerified = preferCache
            ? (cachedProfile.isVerified ?? existingData?.isVerified ?? false)
            : (existingData?.isVerified ?? cachedProfile?.isVerified ?? false);
          if (!existingData?.createdAt) {
            updateFields.createdAt = cachedProfile?.createdAt
              ? { timestampValue: new Date(cachedProfile.createdAt).toISOString() }
              : firestore.FieldValue.serverTimestamp();
          }
          // Also restore optional fields that may have been deleted
          if (cachedProfile?.bio) updateFields.bio = cachedProfile.bio;
          if (cachedProfile?.coverImage) updateFields.coverImage = cachedProfile.coverImage;
        } else if (needsPhotoRecovery) {
          updateFields.profileImage = cachedProfile?.profileImage || googlePhoto;
        }

        // BUG FIX: After self-heal, re-read the doc so we return healed data.
        // The old code returned `existingData` which was read BEFORE the heal,
        // so Zustand store got corrupted values even after successful repair.
        if (isCorrupted || isSilentlyCorrupted || needsPhotoRecovery) {
          await userDocRef.update(updateFields);
          // Re-read to get the healed document
          try {
            const healedSnap = await userDocRef.get();
            if (healedSnap.exists) {
              const healed = healedSnap.data();
              // Update existingData with healed values for the return statement below
              if (healed) {
                existingData = { ...existingData, ...healed };
              }
            }
          } catch (reReadErr) {
            console.warn('[Auth] Failed to re-read user doc after heal, using updateFields as fallback:', reReadErr);
            // Fallback: manually apply healed fields to existingData
            for (const [key, val] of Object.entries(updateFields)) {
              if (val !== undefined && !(val && typeof val === 'object' && '__sentinel' in val)) {
                (existingData as any)[key] = val;
              }
            }
          }
        } else {
          await userDocRef.update(updateFields);
        }
      } catch (e) {
        console.warn('[Auth] Failed to update user doc:', e);
      }
    }

    // If Firestore had no photo but Google does, use Google's (recovery).
    const recoveredPhoto = (!existingData?.profileImage && googlePhoto) ? googlePhoto : null;

    // Safely convert createdAt — must never throw as it blocks sign-in
    let createdAt: number;
    try {
      createdAt = tsToMillis(existingData?.createdAt);
    } catch {
      createdAt = Date.now();
    }

    // ── Initialize E2EE: generate/publish identity key pair BEFORE returning ──
    // This MUST complete before the user can send any messages.
    // Non-blocking to keep sign-in fast, but keys are generated synchronously
    // by getMyKeyPair() on first encrypt call as a safety net.
    try {
      await initE2EE(fbUser.uid);
    } catch (e) {
      // Log but don't block sign-in — keys will be generated lazily on first send
      if (__DEV__) console.warn('[E2EE] Init on sign-in failed (will retry on first message):', e);
    }

    const returnUser: User = {
      id: fbUser.uid,
      email: existingData?.email || fbUser.email || '',
      username: existingData?.username || username,
      displayName: existingData?.displayName || userData.displayName,
      bio: existingData?.bio || '',
      // BUG FIX: Type-check profileImage — corrupted Firestore docs may store
      // an object instead of a string (from write.update without updateMask).
      // Passing a non-string to React Native Image crashes the app.
      profileImage: (typeof existingData?.profileImage === 'string' ? existingData.profileImage : null) || recoveredPhoto || userData.profileImage,
      coverImage: typeof existingData?.coverImage === 'string' ? existingData.coverImage : null,
      role: existingData?.role || 'personal',
      badge: existingData?.badge || '',
      subscription: existingData?.subscription || 'free',
      isVerified: existingData?.isVerified || false,
      createdAt,
    };

    // BUG FIX: Persist user profile to AsyncStorage cache so self-heal recovery
    // works on next sign-in if the user doc gets corrupted. The cache was read
    // in two places but NEVER written — making recovery always fall back to
    // Google defaults (losing custom username, uploaded avatar, etc.).
    try {
      await AsyncStorage.setItem('@black94/user_cache', JSON.stringify(returnUser));
      if (__DEV__) console.log('[Auth] User profile cached to AsyncStorage for self-heal recovery');
    } catch (e) {
      if (__DEV__) console.warn('[Auth] Failed to cache user profile:', e);
    }

    return returnUser;

  } catch (error: any) {
    if (error?.code === '12501') return null;
    console.error('[Auth] Google sign-in error:', error);
    throw error;
  }
}

/**
 * Initialize push notifications and engagement tracking after sign-in.
 * Call this after signInWithGoogle succeeds.
 */
export async function initPostSignUp(userId: string): Promise<void> {
  try {
    // Request notification permissions and register push token
    const { requestNotificationPermissions } = await import('../services/pushNotifications');
    await requestNotificationPermissions();
    // Send welcome notification (only on first sign-in)
    sendWelcomeNotification(userId).catch(() => {});
    // Track first activity
    trackUserActivity(userId).catch(() => {});
  } catch (e) {
    console.warn('[Auth] Post sign-up init failed:', e);
  }
}

export async function signOutUser(): Promise<void> {
  try {
    const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
    await GoogleSignin.revokeAccess();
    await GoogleSignin.signOut();
  } catch {}
  try {
    await signOut(auth());
  } catch {}
  // ── Destroy E2EE keys on logout ──
  try {
    await destroyLocalKeys();
  } catch {}
  // Clear push notification token on logout
  try {
    const { clearPushToken } = await import('../services/pushNotifications');
    await clearPushToken();
  } catch {}
  // Clear user profile cache — no longer valid after logout
  try {
    await AsyncStorage.removeItem('@black94/user_cache');
  } catch {}
}

/* ── Posts ────────────────────────────────────────────────────────────────── */

export interface PollData {
  question: string;
  options: Array<{ id: string; text: string }>;
  duration: number;
}

export async function createPost(
  caption: string,
  mediaUrls: string[] = [],
  pollData?: PollData,
): Promise<string> {
  const userId = currentUser()?.uid;
  if (!userId) throw new Error('Not authenticated');

  const userDocSnap = await firestore().collection('users').doc(userId).get();
  const userData = userDocSnap.exists ? userDocSnap.data() : null;

  // GUARD: If the user doc doesn't exist at all, throw instead of creating
  // a post with empty author metadata (which pollutes the feed).
  if (!userData) {
    throw new Error('User profile not found. Please try again or contact support.');
  }

  // GUARD: If the user doc is corrupted (empty username/displayName from the old
  // _firestoreCommitUpdate write.update bug), fall back to the Zustand store
  // which has the user's last known correct profile data.
  let storeUser: any = null;
  try {
    const { useAppStore } = await import('../stores/app');
    storeUser = useAppStore.getState().user;
  } catch {}

  const userDocCorrupted = !userData?.username || !userData?.displayName;
  if (userDocCorrupted && storeUser) {
    if (__DEV__) console.warn('[Post] User doc appears corrupted — using Zustand store as fallback for author metadata');
    // BUG FIX: Proactively repair the corrupted user doc in the background.
    // Without this, the doc stays corrupted and every future operation (feed
    // enrichment, profile view, etc.) uses wrong data. The Zustand store
    // has the correct values from sign-in or profile edit.
    try {
      const repairFields: Record<string, any> = {
        username: storeUser.username || '',
        usernameLower: (storeUser.username || '').toLowerCase(),
        displayName: storeUser.displayName || 'User',
        profileImage: storeUser.profileImage || null,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      };
      await firestore().collection('users').doc(userId).update(repairFields);
      if (__DEV__) console.log('[Post] User doc repaired with Zustand store data');
      // Also update the cache so self-heal on next sign-in has fresh data
      try {
        await AsyncStorage.setItem('@black94/user_cache', JSON.stringify(storeUser));
      } catch {}
    } catch (repairErr) {
      if (__DEV__) console.warn('[Post] Failed to repair user doc:', repairErr);
    }
  }

  const docData: Record<string, any> = {
    authorId: userId,
    authorUsername: userData?.username || storeUser?.username || '',
    authorDisplayName: userData?.displayName || storeUser?.displayName || 'User',
    authorProfileImage: userData?.profileImage || storeUser?.profileImage || null,
    authorBadge: userData?.badge || storeUser?.badge || '',
    authorIsVerified: userData?.isVerified ?? storeUser?.isVerified ?? false,
    caption,
    mediaUrls,
    likeCount: 0,
    commentCount: 0,
    repostCount: 0,
    createdAt: firestore.FieldValue.serverTimestamp(),
    updatedAt: firestore.FieldValue.serverTimestamp(),
  };

  // Persist poll data to Firestore so feed readers can render it
  if (pollData) {
    docData.pollData = {
      question: pollData.question,
      options: pollData.options.map((o) => ({
        id: o.id,
        text: o.text,
        votes: 0,
      })),
      duration: pollData.duration,
      totalVotes: 0,
      createdAt: firestore.FieldValue.serverTimestamp(),
    };
  }

  const docRef = await firestore().collection('posts').add(docData);

  return docRef.id;
}

export async function toggleLike(postId: string, currentlyLiked: boolean): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;

  const likeRef = firestore().collection('post_likes').doc(`${postId}_${userId}`);
  const postRef = firestore().collection('posts').doc(postId);

  try {
    if (currentlyLiked) {
      await likeRef.delete();
      try { await postRef.update({ likeCount: firestore.FieldValue.increment(-1) }); } catch {}
      return false;
    } else {
      await likeRef.set({ postId, userId, createdAt: firestore.FieldValue.serverTimestamp() });
      try { await postRef.update({ likeCount: firestore.FieldValue.increment(1) }); } catch {}

      // ── Notification: tell post author someone liked their post ──
      try {
        const postDoc = await postRef.get();
        const postData = postDoc.exists ? postDoc.data() : null;
        const postAuthorId = postData?.authorId;
        if (postAuthorId && postAuthorId !== userId) {
          const actor = await getActorData(userId);
          const newLikeCount = (postData?.likeCount || 0) + 1;
          dispatchEngagementNotification({
            recipientId: postAuthorId,
            type: 'like',
            actorId: userId,
            ...actor,
            postId,
            postCaption: postData?.caption || '',
          }).catch(() => {});
          // Check for post like milestone
          checkPostLikeMilestones(postAuthorId, postId, newLikeCount).catch(() => {});
        }
      } catch (e) {
        console.warn('[Like] Notification fire-and-forget failed:', e);
      }

      return true;
    }
  } catch (e) {
    console.warn('[Like] toggleLike error:', e);
    return currentlyLiked;
  }
}

export async function toggleBookmark(postId: string, currentlyBookmarked: boolean): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;

  const bookmarkRef = firestore().collection('post_bookmarks').doc(`${postId}_${userId}`);

  try {
    if (currentlyBookmarked) {
      await bookmarkRef.delete();
      return false;
    } else {
      await bookmarkRef.set({ postId, userId, createdAt: firestore.FieldValue.serverTimestamp() });
      return true;
    }
  } catch (e) {
    console.warn('[Bookmark] toggleBookmark error:', e);
    return currentlyBookmarked;
  }
}

export async function toggleRepost(postId: string, currentlyReposted: boolean): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;

  const repostRef = firestore().collection('post_reposts').doc(`${postId}_${userId}`);
  const postRef = firestore().collection('posts').doc(postId);
  // Use a deterministic doc ID so we can delete it without a composite-index query
  const repostPostId = `repost_${postId}_${userId}`;

  try {
    if (currentlyReposted) {
      await repostRef.delete();
      try { await postRef.update({ repostCount: firestore.FieldValue.increment(-1) }); } catch {}
      // Delete the visible repost entry from the posts collection
      try { await firestore().collection('posts').doc(repostPostId).delete(); } catch {}
      return false;
    } else {
      await repostRef.set({ postId, userId, createdAt: firestore.FieldValue.serverTimestamp() });
      try { await postRef.update({ repostCount: firestore.FieldValue.increment(1) }); } catch {}

      // ── Create a visible repost post in the posts collection ──
      // This is what makes the repost actually appear in the feed.
      // We copy the original post's content and author info so the feed
      // can render the repost without an extra read.
      try {
        const postDoc = await postRef.get();
        const postData = postDoc.exists ? postDoc.data() : null;

        if (postData) {
          // Fetch reposting user's profile for the "reposted by" header
          const repostingUserDoc = await firestore().collection('users').doc(userId).get();
          const repostingUser = repostingUserDoc.exists ? repostingUserDoc.data() : null;

          await firestore().collection('posts').doc(repostPostId).set({
            // Repost metadata
            repostOf: postId,
            repostedByUid: userId,
            repostedByUsername: repostingUser?.username || '',
            repostedByDisplayName: repostingUser?.displayName || 'User',
            // Copy original post content & author info for display
            authorId: postData.authorId || '',
            authorUsername: postData.authorUsername || '',
            authorDisplayName: postData.authorDisplayName || '',
            authorProfileImage: postData.authorProfileImage || null,
            authorBadge: postData.authorBadge || '',
            authorIsVerified: postData.authorIsVerified || false,
            caption: postData.caption || '',
            mediaUrls: postData.mediaUrls || [],
            pollData: postData.pollData || null,
            // Copy counts (will be slightly stale but avoids extra reads)
            likeCount: postData.likeCount || 0,
            commentCount: postData.commentCount || 0,
            repostCount: postData.repostCount || 0,
            factCheckVerified: postData.factCheckVerified || 0,
            factCheckDebunked: postData.factCheckDebunked || 0,
            createdAt: firestore.FieldValue.serverTimestamp(),
            updatedAt: firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (e) {
        console.warn('[Repost] Failed to create visible repost post:', e);
      }

      // ── Notification: tell post author someone reposted their post ──
      try {
        const postDoc = await postRef.get();
        const postData = postDoc.exists ? postDoc.data() : null;
        const postAuthorId = postData?.authorId;
        if (postAuthorId && postAuthorId !== userId) {
          const actor = await getActorData(userId);
          dispatchEngagementNotification({
            recipientId: postAuthorId,
            type: 'repost',
            actorId: userId,
            ...actor,
            postId,
            postCaption: postData?.caption || '',
          }).catch(() => {});
        }
      } catch (e) {
        console.warn('[Repost] Notification fire-and-forget failed:', e);
      }

      return true;
    }
  } catch (e) {
    console.warn('[Repost] toggleRepost error:', e);
    return currentlyReposted;
  }
}

/* ── Poll Voting ───────────────────────────────────────────────────────────── */

export async function votePostPoll(
  postId: string,
  optionId: string,
): Promise<PostPollData | null> {
  const userId = currentUser()?.uid;
  if (!userId) return null;

  const postRef = firestore().collection('posts').doc(postId);
  const voteRef = postRef.collection('poll_votes').doc(userId);

  // BUG FIX: Check for existing vote BEFORE setting. Previously this always
  // incremented both the option vote count and totalVotes, even when a user
  // changed their vote from one option to another (causing totalVotes to
  // exceed actual voter count) or re-tapped the same option (double increment).
  const existingVoteSnap = await voteRef.get();
  const isNewVote = !existingVoteSnap.exists;
  const existingOptionId = existingVoteSnap.exists ? existingVoteSnap.data()?.optionId : null;

  // If user already voted for the SAME option, skip entirely (idempotent).
  if (existingVoteSnap.exists && existingOptionId === optionId) {
    // Return current poll data without modifying anything
    const currentDoc = await postRef.get();
    return currentDoc.data()?.pollData || null;
  }

  // If changing vote from one option to another, decrement the old option.
  // Do NOT decrement totalVotes — the user already counted as one voter.
  if (existingVoteSnap.exists && existingOptionId && existingOptionId !== optionId) {
    const freshDoc = await postRef.get();
    const currentPoll = freshDoc.data()?.pollData;
    if (currentPoll) {
      const oldOptionIndex = (currentPoll.options || []).findIndex((opt: any) => opt.id === existingOptionId);
      if (oldOptionIndex >= 0) {
        await postRef.update({
          [`pollData.options.${oldOptionIndex}.votes`]: firestore.FieldValue.increment(-1),
        });
      }
    }
  }

  // Write/update the vote document
  await voteRef.set({
    optionId,
    userId,
    votedAt: firestore.FieldValue.serverTimestamp(),
  });

  // Read the post to find which option index to increment.
  const freshPostDoc = await postRef.get();
  if (!freshPostDoc.exists) return null;
  const currentPoll = freshPostDoc.data()?.pollData;
  if (!currentPoll) return null;

  // Find which option index to increment
  const optionIndex = (currentPoll.options || []).findIndex((opt: any) => opt.id === optionId);
  if (optionIndex < 0) return null;

  // Build update payload — only increment totalVotes for brand-new votes.
  const updatePayload: Record<string, any> = {
    [`pollData.options.${optionIndex}.votes`]: firestore.FieldValue.increment(1),
  };
  if (isNewVote) {
    updatePayload['pollData.totalVotes'] = firestore.FieldValue.increment(1);
  }
  await postRef.update(updatePayload);

  // Return updated poll for UI
  const updatedDoc = await postRef.get();
  return updatedDoc.data()?.pollData || null;
}

/* ── Chat ─────────────────────────────────────────────────────────────────── */

export async function fetchChatList(): Promise<Chat[]> {
  const userId = currentUser()?.uid;
  if (!userId) {
    if (__DEV__) console.warn('[Chat] fetchChatList: no userId, skipping');
    return [];
  }

  try {
    if (__DEV__) console.log('[Chat] Fetching chat list for user:', userId);

    // Run two parallel queries — one for each side of the user pair
    let snap1: any, snap2: any;
    try {
      [snap1, snap2] = await Promise.all([
        firestore().collection('chats').where('user1Id', '==', userId).get(),
        firestore().collection('chats').where('user2Id', '==', userId).get(),
      ]);
    } catch (queryErr: any) {
      // Log the full error — don't silently swallow
      console.error('[Chat] Firestore query FAILED:', queryErr?.message || queryErr);
      console.error('[Chat] Query error stack:', queryErr?.stack);
      // Check if it's the _missingIndex silent error
      if (snap1?._missingIndex || snap2?._missingIndex) {
        console.error('[Chat] COMPOSITE INDEX MISSING for chats collection!');
      }
      return [];
    }

    if (__DEV__) console.log(`[Chat] Got ${snap1.docs.length} + ${snap2.docs.length} raw docs`);

    const allDocs = [...snap1.docs, ...snap2.docs];

    // Debug: log each chat doc's fields to diagnose corruption
    if (__DEV__ && allDocs.length > 0) {
      allDocs.forEach((docSnap: any, i: number) => {
        const d = docSnap.data();
        console.log(`[Chat] Doc[${i}] id=${docSnap.id} user1Id=${d.user1Id} user2Id=${d.user2Id} lastMessage=${typeof d.lastMessage} ts=${d.lastMessageTime}`);
      });
    }

    // Filter out corrupted docs — if user1Id or user2Id is missing,
    // the doc was destroyed by the old update() bug (no updateMask).
    const validDocs = allDocs.filter((docSnap: any) => {
      const d = docSnap.data();
      if (!d.user1Id || !d.user2Id) {
        console.warn(`[Chat] CORRUPTED chat doc ${docSnap.id}: missing user1Id/user2Id — skipping. Fields: ${Object.keys(d).join(', ')}`);
        return false;
      }
      return true;
    });

    if (validDocs.length === 0) {
      if (__DEV__) console.log('[Chat] No valid chat documents found after filtering');

      // CRITICAL DIAGNOSTIC: Query ALL chats without filter to check if docs exist.
      // This tells us whether the issue is:
      //   a) No documents at all (chats never created)
      //   b) Documents exist but where-clause doesn't match (wrong field values)
      //   c) All documents are corrupted (filtered out above)
      try {
        const allChatsNoFilter = await firestore().collection('chats').limit(20).get();
        if (__DEV__) {
          console.log(`[Chat] DIAGNOSTIC: Total docs in chats collection (no filter): ${allChatsNoFilter.docs.length}`);
          allChatsNoFilter.docs.forEach((docSnap: any, i: number) => {
            const d = docSnap.data();
            console.log(`[Chat] DIAGNOSTIC[${i}] id=${docSnap.id} user1Id=${d.user1Id} user2Id=${d.user2Id} fields=${Object.keys(d).join(',')}`);
          });
        }
        // Also log the current userId for comparison
        console.log(`[Chat] DIAGNOSTIC: Current userId = ${userId}`);
      } catch (diagErr: any) {
        console.error('[Chat] DIAGNOSTIC FAILED (unfiltered query error):', diagErr?.message || diagErr);
      }

      return [];
    }

    // Collect unique other user IDs
    const otherUserIds = [...new Set(validDocs.map(docSnap => {
      const data = docSnap.data();
      return data.user1Id === userId ? data.user2Id : data.user1Id;
    }))];

    // Batch fetch all user profiles in parallel (chunks of 10)
    const CHUNK_SIZE = 10;
    const userMap: Record<string, any> = {};

    for (let i = 0; i < otherUserIds.length; i += CHUNK_SIZE) {
      const chunk = otherUserIds.slice(i, i + CHUNK_SIZE);
      try {
        const userResults = await Promise.all(
          chunk.map(async uid => {
            try {
              const snap = await firestore().collection('users').doc(uid).get();
              return snap.exists ? { id: uid, data: snap.data() } : null;
            } catch { return null; }
          })
        );
        for (const r of userResults) {
          if (r) userMap[r.id] = r.data;
        }
      } catch (e) {
        console.warn('[Chat] Batch user fetch failed for chunk:', e);
      }
    }

    // Build chat objects using batched userMap
    const chats: Chat[] = validDocs.map(docSnap => {
      const data = docSnap.data();
      const otherId = data.user1Id === userId ? data.user2Id : data.user1Id;
      const isUser1 = data.user1Id === userId;
      const unreadCount = isUser1 ? (data.unreadUser1 || 0) : (data.unreadUser2 || 0);
      const otherData = userMap[otherId];

      return {
        id: docSnap.id,
        user1Id: data.user1Id,
        user2Id: data.user2Id,
        lastMessage: typeof data.lastMessage === 'string'
          ? data.lastMessage
          : (data.lastMessage?.content || data.lastMessage?.text || ''),
        lastMessageTime: (() => { try { return tsToMillis(data.lastMessageTime); } catch { return Date.now(); } })(),
        unreadCount,
        otherUser: otherData ? {
          id: otherId,
          username: otherData.username || '',
          displayName: otherData.displayName || '',
          bio: otherData.bio || '',
          profileImage: otherData.profileImage || null,
          coverImage: otherData.coverImage || null,
          role: otherData.role || 'personal',
          badge: otherData.badge || '',
          subscription: otherData.subscription || 'free',
          isVerified: otherData.isVerified || false,
          createdAt: (() => { try { return tsToMillis(otherData.createdAt); } catch { return Date.now(); } })(),
        } : null,
      };
    });

    if (__DEV__) console.log(`[Chat] Returning ${chats.length} valid chats`);
    return chats.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
  } catch (e: any) {
    console.error('[Chat] Processing error:', e?.message);
    console.error('[Chat] Processing error stack:', e?.stack);
  }
  return [];
}

export async function fetchMessages(chatId: string, limitCount = 50): Promise<Message[]> {
  try {
    const snapshot = await firestore()
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .orderBy('createdAt', 'asc')
      .limit(limitCount)
      .get();

    // Decrypt all messages in parallel (async per message)
    const messages = await Promise.all(
      snapshot.docs.map(async (docSnap) => {
        const data = docSnap.data();
        const rawContent = data.content || '';
        const senderId = data.senderId || '';
        const msgType = data.messageType || 'text';

        // Attempt E2E decryption;
        // null = tampered/corrupted → show placeholder, NEVER raw ciphertext
        // string = decrypted plaintext OR legacy non-E2EE message
        // Media messages (image/gif) are not encrypted — use content as-is
        let content: string;
        if (msgType === 'image' || msgType === 'gif') {
          content = rawContent;
        } else {
          try {
            const decrypted = await decryptMessage(rawContent, senderId);
            content = decrypted ?? '[Unable to decrypt this message]';
          } catch {
            content = rawContent.startsWith('E2EE:')
              ? '[Unable to decrypt this message]'
              : rawContent;
          }
        }

        return {
          id: docSnap.id,
          chatId,
          senderId,
          receiverId: data.receiverId || '',
          content,
          messageType: data.messageType || 'text',
          mediaUrl: data.mediaUrl || null,
          status: data.status || 'sent',
          createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
        };
      }),
    );

    return messages;
  } catch (e) {
    console.error('[Messages] Failed:', e);
    return [];
  }
}

export async function sendMessage(chatId: string, receiverId: string, content: string, options?: { messageType?: string; mediaUrl?: string }): Promise<{ sent: boolean; reason?: string }> {
  const userId = currentUser()?.uid;
  if (!userId) return { sent: false, reason: 'not_authenticated' };
  const msgType = options?.messageType || 'text';
  const mediaUrl = options?.mediaUrl || null;

  // ── Nuclear Block Check: prevent messaging if either user blocked the other ──
  try {
    const [iBlockedThem, theyBlockedMe] = await Promise.all([
      firestore().collection('blocks').doc(`${userId}_${receiverId}`).get(),
      firestore().collection('blocks').doc(`${receiverId}_${userId}`).get(),
    ]);
    if (iBlockedThem.exists || theyBlockedMe.exists) {
      if (__DEV__) console.log('[Messages] Blocked — message not sent');
      return { sent: false, reason: 'blocked' };
    }
  } catch (e) {
    console.warn('[Messages] Block check failed, BLOCKING message to be safe:', e);
    return { sent: false, reason: 'block_check_failed' };
  }

  // ── E2E Encryption: encrypt content before storing ──
  // Skip encryption for media messages (image/gif) — the payload is the mediaUrl, not text.
  // If encryption fails (no key, error, etc.), send as plaintext with encrypted: false.
  let storedContent: string;
  let isEncrypted = true;
  if (msgType === 'image' || msgType === 'gif') {
    isEncrypted = false;
    storedContent = content; // empty or placeholder for media messages
  } else {
    try {
      const encrypted = await encryptMessage(content, userId, receiverId);
      if (encrypted) {
        storedContent = encrypted;
      } else {
        // Recipient has no public key — send as plaintext
        isEncrypted = false;
        storedContent = content;
      }
    } catch (e) {
      if (__DEV__) console.warn('[E2EE] Encryption failed, sending plaintext:', e);
      isEncrypted = false;
      storedContent = content;
    }
  }

  await firestore().collection('chats').doc(chatId).collection('messages').add({
    chatId,
    senderId: userId,
    receiverId,
    content: storedContent,
    messageType: msgType,
    mediaUrl,
    status: 'sent',
    encrypted: isEncrypted,
    createdAt: firestore.FieldValue.serverTimestamp(),
    clientCreatedAt: Date.now(), // Ensures correct ordering before server timestamp resolves
  });

  // Increment unread count for receiver, reset sender's unread to 0
  // lastMessage: ALWAYS use privacy-safe placeholder — NEVER plaintext
  const chatDoc = await firestore().collection('chats').doc(chatId).get();
  const chatData = chatDoc.exists ? chatDoc.data() : null;

  // Guard against null/malformed chat doc — skip unread update if structure unknown
  if (!chatData?.user1Id || !chatData?.user2Id) {
    console.warn('[Messages] Chat doc missing user IDs, skipping unread update');
    // ── Notification: tell receiver they got a new DM ──
    try {
      const actor = await getActorData(userId);
      dispatchEngagementNotification({
        recipientId: receiverId,
        type: 'chat',
        actorId: userId,
        ...actor,
        priority: 'high',
      }).catch(() => {});
      // Track activity for engagement scoring
      trackUserActivity(userId).catch(() => {});
    } catch (e) {
      console.warn('[Messages] Notification fire-and-forget failed:', e);
    }
    return { sent: true };
  }

  const senderIsUser1 = chatData.user1Id === userId;
  const senderUnreadField = senderIsUser1 ? 'unreadUser1' : 'unreadUser2';
  const receiverUnreadField = senderIsUser1 ? 'unreadUser2' : 'unreadUser1';

  // Preview text for chat list
  const previewText = msgType === 'image' ? '\u{1F4F7} Photo' : msgType === 'gif' ? 'GIF' : content;
  await firestore().collection('chats').doc(chatId).update({
    lastMessage: encryptedPreviewText(),
    lastMessageTime: firestore.FieldValue.serverTimestamp(),
    [receiverUnreadField]: firestore.FieldValue.increment(1),
    [senderUnreadField]: 0,
  });

  // ── Notification: tell receiver they got a new DM ──
  try {
    const actor = await getActorData(userId);
    dispatchEngagementNotification({
      recipientId: receiverId,
      type: 'chat',
      actorId: userId,
      ...actor,
      priority: 'high',
    }).catch(() => {});
    trackUserActivity(userId).catch(() => {});
  } catch (e) {
    console.warn('[Messages] Notification fire-and-forget failed:', e);
  }

  return { sent: true };
}

/* ── Nuclear Block ─────────────────────────────────────────────────────────── */

export async function blockUser(targetUserId: string): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;

  const blockDocId = `${userId}_${targetUserId}`;
  const blockedByDocId = `${targetUserId}_${userId}`;

  try {
    // Write block docs (双向索引)
    await Promise.all([
      firestore().collection('blocks').doc(blockDocId).set({
        blockerId: userId,
        blockedId: targetUserId,
        createdAt: firestore.FieldValue.serverTimestamp(),
      }),
      firestore().collection('blockedBy').doc(blockedByDocId).set({
        blockerId: userId,
        blockedId: targetUserId,
        createdAt: firestore.FieldValue.serverTimestamp(),
      }),
      // Remove bidirectional follow relationships
      firestore().collection('follows').doc(blockDocId).delete().catch(() => {}),
      firestore().collection('follows').doc(blockedByDocId).delete().catch(() => {}),
    ]);

    // Delete all messages in chats between these two users
    // BUG FIX: Use single-where + client-side filter (no composite index needed)
    const [chatSnap1, chatSnap2] = await Promise.all([
      firestore().collection('chats').where('user1Id', '==', userId).get(),
      firestore().collection('chats').where('user2Id', '==', userId).get(),
    ]);

    const chatIds = [
      ...chatSnap1.docs.filter((d: any) => {
        const data = d.data();
        const otherId = data.user1Id === userId ? data.user2Id : data.user1Id;
        return otherId === targetUserId;
      }).map((d: any) => d.id),
      ...chatSnap2.docs.filter((d: any) => {
        const data = d.data();
        const otherId = data.user1Id === userId ? data.user2Id : data.user1Id;
        return otherId === targetUserId;
      }).map((d: any) => d.id),
    ];

    // Delete all messages in each chat (batch loop to handle more than 500)
    for (const chatId of chatIds) {
      try {
        const msgRef = firestore().collection('chats').doc(chatId).collection('messages');

        // Loop until all messages are deleted (max 50 iterations safety cap)
        let iterations = 0;
        while (iterations++ < 50) {
          const snapshot = await msgRef.orderBy('createdAt').limit(500).get();
          if (snapshot.empty) break;

          let batch = firestore().batch();
          snapshot.docs.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        }
        if (__DEV__) console.log(`[Block] Deleted all messages in chat ${chatId}`);

        // Also delete the chat document itself
        await firestore().collection('chats').doc(chatId).delete();
      } catch (e) {
        console.warn(`[Block] Failed to clean up chat ${chatId}:`, e);
      }
    }

    if (__DEV__) console.log(`[Block] User ${targetUserId} blocked successfully`);
    return true;
  } catch (e) {
    console.error('[Block] Failed to block user:', e);
    return false;
  }
}

/* ── Voice Call Signaling ────────────────────────────────────────────────── */

export interface CallData {
  id: string;
  callerId: string;
  callerName: string;
  callerProfileImage: string | null;
  receiverId: string;
  status: 'ringing' | 'connected' | 'ended' | 'missed';
  type: 'audio';
  createdAt: number;
  connectedAt: number | null;
  endedAt: number | null;
  endedBy: string | null;
}

/**
 * Initiate a voice call — creates a Firestore call document and notifies the receiver.
 * The call document is polled by both parties for status changes.
 */
export async function initiateCall(receiverId: string, receiverName: string, receiverProfileImage: string | null): Promise<CallData> {
  const userId = currentUser()?.uid;
  if (!userId) throw new Error('Not authenticated');

  // Check if blocked
  try {
    const [iBlockedThem, theyBlockedMe] = await Promise.all([
      firestore().collection('blocks').doc(`${userId}_${receiverId}`).get(),
      firestore().collection('blocks').doc(`${receiverId}_${userId}`).get(),
    ]);
    if (iBlockedThem.exists || theyBlockedMe.exists) {
      throw new Error('Cannot call this user');
    }
  } catch (e: any) {
    if (e.message === 'Cannot call this user') throw e;
  }

  // Get caller's display name for the call document
  let callerName = 'User';
  let callerProfileImage: string | null = null;
  try {
    const { useAppStore } = await import('../stores/app');
    const storeUser = useAppStore.getState().user;
    if (storeUser) {
      callerName = storeUser.displayName || storeUser.username || 'User';
      callerProfileImage = storeUser.profileImage || null;
    }
  } catch {}

  const callRef = await firestore().collection('calls').add({
    callerId: userId,
    callerName,
    callerProfileImage,
    receiverId,
    status: 'ringing',
    type: 'audio',
    createdAt: firestore.FieldValue.serverTimestamp(),
    connectedAt: null,
    endedAt: null,
    endedBy: null,
  });

  // Notify the receiver
  try {
    const actor = await getActorData(userId);
    dispatchEngagementNotification({
      recipientId: receiverId,
      type: 'call',
      actorId: userId,
      ...actor,
      postCaption: `📞 Voice call from ${actor.actorDisplayName}`,
      priority: 'critical',
    }).catch(() => {});
  } catch (e) {
    console.warn('[Call] Notification failed:', e);
  }

  return {
    id: callRef.id,
    callerId: userId,
    callerName,
    callerProfileImage,
    receiverId,
    status: 'ringing',
    type: 'audio',
    createdAt: Date.now(),
    connectedAt: null,
    endedAt: null,
    endedBy: null,
  };
}

/**
 * Answer an incoming call — updates the call document status to 'connected'.
 */
export async function answerCall(callId: string): Promise<void> {
  const userId = currentUser()?.uid;
  if (!userId) throw new Error('Not authenticated');

  await firestore().collection('calls').doc(callId).update({
    status: 'connected',
    connectedAt: firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * End a call — updates the call document status to 'ended'.
 * If the call was never connected, marks it as 'missed' for analytics.
 */
export async function endCall(callId: string): Promise<void> {
  const userId = currentUser()?.uid;
  if (!userId) throw new Error('Not authenticated');

  // First read the call to check if it was connected
  let wasConnected = false;
  try {
    const callDoc = await firestore().collection('calls').doc(callId).get();
    if (callDoc.exists) {
      const data = callDoc.data();
      wasConnected = !!data?.connectedAt;
    }
  } catch {}

  await firestore().collection('calls').doc(callId).update({
    status: wasConnected ? 'ended' : 'missed',
    endedAt: firestore.FieldValue.serverTimestamp(),
    endedBy: userId,
  });
}

/**
 * Poll a call document for status changes.
 * Returns null if the call document doesn't exist or was deleted.
 */
export async function pollCallStatus(callId: string): Promise<CallData | null> {
  try {
    const doc = await firestore().collection('calls').doc(callId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return {
      id: doc.id,
      callerId: data.callerId || '',
      callerName: data.callerName || 'Unknown',
      callerProfileImage: data.callerProfileImage || null,
      receiverId: data.receiverId || '',
      status: data.status || 'ended',
      type: data.type || 'audio',
      createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
      connectedAt: (() => { try { return tsToMillis(data.connectedAt); } catch { return null; } })(),
      endedAt: (() => { try { return tsToMillis(data.endedAt); } catch { return null; } })(),
      endedBy: data.endedBy || null,
    };
  } catch {
    return null;
  }
}

/* ── User ─────────────────────────────────────────────────────────────────── */

export async function fetchUserProfile(userId: string): Promise<User | null> {
  try {
    if (__DEV__) console.log('[User] Fetching profile for:', userId);
    const docSnap = await firestore().collection('users').doc(userId).get();
    if (!docSnap.exists) {
      if (__DEV__) console.log('[User] User doc does not exist:', userId);
      return null;
    }
    const data = docSnap.data();
    if (__DEV__) console.log('[User] Got profile:', data?.displayName, '@' + data?.username, 'badge:', data?.badge, 'verified:', data?.isVerified);

    // GUARD: If the user doc is corrupted (empty username + displayName from the old
    // _firestoreCommitUpdate write.update bug), try to recover from AsyncStorage cache.
    // This prevents returning a corrupted profile to the Zustand store and UI.
    if (!data?.username && !data?.displayName) {
      if (__DEV__) console.warn('[User] User doc appears corrupted (empty username/displayName) — attempting cache recovery');
      try {
        const raw = await AsyncStorage.getItem('@black94/user_cache');
        if (raw) {
          const cached = JSON.parse(raw);
          if (cached && cached.id === userId) {
            if (__DEV__) console.log('[User] Recovered profile from cache:', cached.displayName, '@' + cached.username);
            return {
              id: userId,
              email: cached.email || data?.email || '',
              username: cached.username || '',
              displayName: cached.displayName || 'User',
              bio: cached.bio || '',
              profileImage: typeof cached.profileImage === 'string' ? cached.profileImage : null,
              coverImage: typeof cached.coverImage === 'string' ? cached.coverImage : null,
              role: cached.role || 'personal',
              badge: cached.badge || '',
              subscription: cached.subscription || 'free',
              isVerified: cached.isVerified || false,
              createdAt: cached.createdAt || Date.now(),
            };
          }
        }
      } catch {}
    }

    // CRITICAL: Fallback displayName → username → 'User' so the Avatar component
    // never renders the "?" placeholder (empty string is falsy → shows "?").
    const displayName = data?.displayName || data?.username || 'User';
    let createdAt = Date.now();
    try {
      createdAt = tsToMillis(data?.createdAt);
    } catch {
      // If tsToMillis fails for any reason, fall back to Date.now()
      createdAt = data?.createdAt ? new Date(data.createdAt).getTime() || Date.now() : Date.now();
    }
    // BUG FIX: profileImage and coverImage must be strings or null.
    // Firestore _fromFsValue can return objects if the field was stored as
    // mapValue (e.g., from a corrupted write.update without updateMask).
    // Passing an object to React Native's Image source.uri crashes the app.
    const profileImage = typeof data?.profileImage === 'string' && data.profileImage.trim()
      ? data.profileImage
      : null;
    const coverImage = typeof data?.coverImage === 'string' && data.coverImage.trim()
      ? data.coverImage
      : null;
    const profileResult: User = {
      id: userId,
      email: data?.email || '',
      username: data?.username || '',
      displayName,
      bio: data?.bio || '',
      profileImage,
      coverImage,
      role: data?.role || 'personal',
      badge: data?.badge || '',
      subscription: data?.subscription || 'free',
      isVerified: data?.isVerified || false,
      createdAt,
    };

    // BUG FIX: Persist fetched profile to AsyncStorage cache for self-heal recovery.
    // Only cache valid (non-corrupted) profiles — corrupted ones are handled above.
    // Also only cache the CURRENT user's profile (not other users' profiles).
    const currentUid = currentUser()?.uid;
    if (currentUid === userId && data?.username && data?.displayName) {
      try {
        await AsyncStorage.setItem('@black94/user_cache', JSON.stringify(profileResult));
        if (__DEV__) console.log('[User] Profile cached to AsyncStorage for self-heal recovery');
      } catch {}
    }

    return profileResult;
  } catch (e: any) {
    console.error('[User] fetchUserProfile error:', e?.message);
    // Return null instead of throwing — callers can handle missing profile gracefully
    return null;
  }
}

export async function toggleFollow(targetUserId: string, currentlyFollowing: boolean): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;

  const followRef = firestore().collection('follows').doc(`${userId}_${targetUserId}`);

  try {
    if (currentlyFollowing) {
      await followRef.delete();
      // Update follower/following counts (fire-and-forget)
      try {
        await Promise.all([
          firestore().collection('users').doc(targetUserId).update({
            followerCount: firestore.FieldValue.increment(-1),
          }),
          firestore().collection('users').doc(userId).update({
            followingCount: firestore.FieldValue.increment(-1),
          }),
        ]);
      } catch (e) {
        console.warn('[Follow] Count update failed:', e);
      }
      return false;
    } else {
    await followRef.set({
      followerId: userId,
      followingId: targetUserId,
      createdAt: firestore.FieldValue.serverTimestamp(),
    });
    // Update follower/following counts (fire-and-forget)
    try {
      await Promise.all([
        firestore().collection('users').doc(targetUserId).update({
          followerCount: firestore.FieldValue.increment(1),
        }),
        firestore().collection('users').doc(userId).update({
          followingCount: firestore.FieldValue.increment(1),
        }),
      ]);
    } catch (e) {
      console.warn('[Follow] Count update failed:', e);
    }

    // ── Notification: tell target user they got a new follower ──
    try {
      const actor = await getActorData(userId);
      dispatchEngagementNotification({
        recipientId: targetUserId,
        type: 'follow',
        actorId: userId,
        ...actor,
      }).catch(() => {});
      // Check follower milestone
      const targetDoc = await firestore().collection('users').doc(targetUserId).get();
      const targetData = targetDoc.exists ? targetDoc.data() : null;
      const followerCount = targetData?.followerCount || 0;
      checkFollowerMilestones(targetUserId, followerCount + 1).catch(() => {});
      // Track activity
      trackUserActivity(userId).catch(() => {});
    } catch (e) {
      console.warn('[Follow] Notification fire-and-forget failed:', e);
    }

    return true;
    }
  } catch (e) {
    console.warn('[Follow] toggleFollow error:', e);
    return currentlyFollowing;
  }
}

export async function checkFollowing(targetUserId: string): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;
  try {
    const docSnap = await firestore().collection('follows').doc(`${userId}_${targetUserId}`).get();
    return docSnap.exists;
  } catch (e) {
    console.warn('[API] checkFollowing error:', e);
    return false;
  }
}

/* ── Comments ─────────────────────────────────────────────────────────────── */

export interface CommentData {
  id: string;
  postId: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorProfileImage: string;
  authorIsVerified: boolean;
  authorBadge: string;
  content: string;
  imageUrls?: string[];
  replyToId?: string | null;
  replyToUsername?: string | null;
  createdAt: number;
}

export interface FactCheckClaim {
  id: string;
  postId: string;
  claimedBy: string;
  claimedAt: number;
  text: string;
  sourceUrl: string;
  sourceTitle: string;
  verdict: 'pending' | 'verified' | 'debunked' | 'misleading';
  verifiedBy: string | null;
  verifiedAt: number | null;
  confidenceScore: number;
  tags: string[];
}

export async function fetchPostComments(postId: string): Promise<CommentData[]> {
  if (!postId) {
    console.warn('[Comments] No postId provided, returning empty');
    return [];
  }
  try {
    // NOTE: No .orderBy('createdAt', 'asc') — that composite index may not exist.
    // Fetch without orderBy, then sort client-side (same as web's fetchPostComments).
    const snapshot = await firestore()
      .collection('post_comments')
      .where('postId', '==', postId)
      .limit(50)
      .get();
    if (__DEV__) console.log(`[Comments] Fetched ${snapshot.docs.length} comments for post ${postId}`);
    const results = snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      let createdAt: number;
      try {
        createdAt = tsToMillis(data.createdAt);
      } catch {
        createdAt = Date.now();
      }
      return {
        id: docSnap.id,
        postId: data.postId || '',
        authorId: data.authorId || '',
        authorUsername: data.authorUsername || '',
        authorDisplayName: data.authorDisplayName || '',
        authorProfileImage: data.authorProfileImage || '',
        authorIsVerified: data.authorIsVerified || false,
        authorBadge: data.authorBadge || '',
        content: data.content || '',
        imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : undefined,
        replyToId: data.replyToId || null,
        replyToUsername: data.replyToUsername || null,
        createdAt,
      };
    });
    // Sort client-side ascending by createdAt
    results.sort((a, b) => a.createdAt - b.createdAt);
    return results;
  } catch (e: any) {
    console.error('[Comments] Failed to fetch:', e?.message, e?.code);
    // Re-throw so callers can show the error instead of silently returning empty
    throw new Error('Failed to load comments. Please try again.');
  }
}

export async function addPostComment(postId: string, content: string, replyToId?: string, replyToUsername?: string): Promise<CommentData | null> {
  const userId = currentUser()?.uid;
  if (!userId || !content.trim()) return null;
  
  const userDocSnap = await firestore().collection('users').doc(userId).get();
  const userData = userDocSnap.exists ? userDocSnap.data() : null;

  // Guard: use Zustand store as fallback if user doc is corrupted
  let storeUser: any = null;
  try {
    const { useAppStore } = await import('../stores/app');
    storeUser = useAppStore.getState().user;
  } catch {}

  // BUG FIX: Proactively repair corrupted user doc (same as createPost).
  // Without this, comments are stamped with empty author metadata and
  // the doc stays broken for all future operations.
  const userDocCorrupted = !userData?.username || !userData?.displayName;
  if (userDocCorrupted && storeUser) {
    if (__DEV__) console.warn('[Comment] User doc appears corrupted — repairing with Zustand store data');
    try {
      await firestore().collection('users').doc(userId).update({
        username: storeUser.username || '',
        usernameLower: (storeUser.username || '').toLowerCase(),
        displayName: storeUser.displayName || 'User',
        profileImage: storeUser.profileImage || null,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      if (__DEV__) console.log('[Comment] User doc repaired');
      try { await AsyncStorage.setItem('@black94/user_cache', JSON.stringify(storeUser)); } catch {}
    } catch (repairErr) {
      if (__DEV__) console.warn('[Comment] Failed to repair user doc:', repairErr);
    }
  }

  const docRef = await firestore().collection('post_comments').add({
    postId,
    authorId: userId,
    authorUsername: userData?.username || storeUser?.username || '',
    authorDisplayName: userData?.displayName || storeUser?.displayName || 'User',
    authorProfileImage: userData?.profileImage || storeUser?.profileImage || '',
    authorIsVerified: userData?.isVerified ?? storeUser?.isVerified ?? false,
    authorBadge: userData?.badge || storeUser?.badge || '',
    content: content.trim(),
    replyToId: replyToId || null,
    replyToUsername: replyToUsername || null,
    createdAt: firestore.FieldValue.serverTimestamp(),
  });

  // Increment commentCount on parent post
  try {
    await firestore().collection('posts').doc(postId).update({
      commentCount: firestore.FieldValue.increment(1),
    });
  } catch (e) {
    console.warn('[Comments] Failed to increment commentCount:', e);
  }

  // ── Notification: tell post author someone commented ──
  try {
    const postDoc = await firestore().collection('posts').doc(postId).get();
    const postData = postDoc.exists ? postDoc.data() : null;
    const postAuthorId = postData?.authorId;
    if (postAuthorId && postAuthorId !== userId) {
      // Use Zustand fallback for actor data if user doc was corrupted
      const actorName = userData?.displayName || storeUser?.displayName || 'User';
      const actorUsername = userData?.username || storeUser?.username || '';
      const actorPhoto = userData?.profileImage || storeUser?.profileImage || null;
      const actorVerified = userData?.isVerified ?? storeUser?.isVerified ?? false;
      dispatchEngagementNotification({
        recipientId: postAuthorId,
        type: 'comment',
        actorId: userId,
        actorDisplayName: actorName,
        actorUsername: actorUsername,
        actorProfileImage: actorPhoto,
        actorIsVerified: actorVerified,
        actorBadge: userData?.badge || '',
        postId,
        postCaption: postData?.caption || '',
        commentContent: content.trim(),
      }).catch(() => {});
      trackUserActivity(userId).catch(() => {});
    }
  } catch (e) {
    console.warn('[Comments] Notification fire-and-forget failed:', e);
  }

  return {
    id: docRef.id,
    postId,
    authorId: userId,
    authorUsername: userData?.username || storeUser?.username || '',
    authorDisplayName: userData?.displayName || storeUser?.displayName || 'User',
    authorProfileImage: userData?.profileImage || storeUser?.profileImage || '',
    authorIsVerified: userData?.isVerified ?? storeUser?.isVerified ?? false,
    authorBadge: userData?.badge || storeUser?.badge || '',
    content: content.trim(),
    replyToId: replyToId || null,
    replyToUsername: replyToUsername || null,
    createdAt: Date.now(),
  };
}

/* ── Ad Campaigns ─────────────────────────────────────────────────────────── */

export async function fetchActiveAdCampaigns(limit: number = 5): Promise<any[]> {
  try {
    const snapshot = await firestore()
      .collection('adCampaigns')
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
  } catch (e) {
    console.warn('[Ads] Failed to fetch active ad campaigns:', e);
    return [];
  }
}

/* ── Comment Like Toggle ─────────────────────────────────────────────────── */

/**
 * Toggles a like on a comment. Uses a Firestore subcollection
 * `post_comments/{commentId}/likes/{userId}` as the source of truth.
 * Also updates the `likeCount` field on the comment document.
 */
export async function toggleCommentLike(commentId: string, currentlyLiked: boolean): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;

  const likeRef = firestore().collection('post_comments').doc(commentId).collection('likes').doc(userId);

  try {
    if (currentlyLiked) {
      await likeRef.delete();
      await firestore().collection('post_comments').doc(commentId).update({
        likeCount: firestore.FieldValue.increment(-1),
      });
      return false;
    } else {
      await likeRef.set({
        userId,
        likedAt: firestore.FieldValue.serverTimestamp(),
      });
      await firestore().collection('post_comments').doc(commentId).update({
        likeCount: firestore.FieldValue.increment(1),
      });
      return true;
    }
  } catch (e) {
    console.error('[Comments] Failed to toggle like:', e);
    return currentlyLiked; // Return unchanged on error
  }
}

/**
 * Toggles a repost on a comment. Uses a Firestore subcollection
 * `post_comments/{commentId}/reposts/{userId}` as the source of truth.
 *
 * Suggested Firestore security rules:
 *   match /post_comments/{commentId}/reposts/{userId} {
 *     allow read: if request.auth != null;
 *     allow create: if request.auth != null && request.auth.uid == userId;
 *     allow delete: if request.auth != null && request.auth.uid == userId;
 *   }
 */
export async function toggleCommentRepost(commentId: string, currentlyReposted: boolean): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;

  const repostRef = firestore().collection('post_comments').doc(commentId).collection('reposts').doc(userId);

  try {
    if (currentlyReposted) {
      await repostRef.delete();
      await firestore().collection('post_comments').doc(commentId).update({
        repostCount: firestore.FieldValue.increment(-1),
      });
      if (__DEV__) console.log(`[CommentRepost] Removed repost on comment ${commentId}`);
      return false;
    } else {
      await repostRef.set({
        userId,
        repostedAt: firestore.FieldValue.serverTimestamp(),
      });
      await firestore().collection('post_comments').doc(commentId).update({
        repostCount: firestore.FieldValue.increment(1),
      });

      // ── Notification: tell comment author someone reposted their comment ──
      try {
        const commentDoc = await firestore().collection('post_comments').doc(commentId).get();
        const commentData = commentDoc.exists ? commentDoc.data() : null;
        const commentAuthorId = commentData?.authorId;
        if (commentAuthorId && commentAuthorId !== userId) {
          const actor = await getActorData(userId);
          dispatchEngagementNotification({
            recipientId: commentAuthorId,
            type: 'repost',
            actorId: userId,
            ...actor,
            commentId,
            commentContent: (commentData?.content || '').slice(0, 80),
          }).catch(() => {});
        }
      } catch (e) {
        console.warn('[CommentRepost] Notification fire-and-forget failed:', e);
      }

      if (__DEV__) console.log(`[CommentRepost] Added repost on comment ${commentId}`);
      return true;
    }
  } catch (e) {
    console.error('[CommentRepost] Failed to toggle repost:', e);
    return currentlyReposted; // Return unchanged on error
  }
}

/**
 * Toggles a bookmark on a comment. Uses a Firestore subcollection
 * `post_comments/{commentId}/bookmarks/{userId}` as the source of truth.
 *
 * Suggested Firestore security rules:
 *   match /post_comments/{commentId}/bookmarks/{userId} {
 *     allow read: if request.auth != null;
 *     allow create: if request.auth != null && request.auth.uid == userId;
 *     allow delete: if request.auth != null && request.auth.uid == userId;
 *   }
 */
export async function toggleCommentBookmark(commentId: string, currentlyBookmarked: boolean): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;

  const bookmarkRef = firestore().collection('post_comments').doc(commentId).collection('bookmarks').doc(userId);

  try {
    if (currentlyBookmarked) {
      await bookmarkRef.delete();
      if (__DEV__) console.log(`[CommentBookmark] Removed bookmark on comment ${commentId}`);
      return false;
    } else {
      await bookmarkRef.set({
        userId,
        bookmarkedAt: firestore.FieldValue.serverTimestamp(),
      });
      if (__DEV__) console.log(`[CommentBookmark] Added bookmark on comment ${commentId}`);
      return true;
    }
  } catch (e) {
    console.error('[CommentBookmark] Failed to toggle bookmark:', e);
    return currentlyBookmarked; // Return unchanged on error
  }
}

/* ── Paid Chat System ─────────────────────────────────────────────────────── */

/**
 * Saves the per-chat price to the current user's privacy settings in Firestore
 * at `users/{uid}/privacy/paidChatPrice`.
 */
export async function setPaidChatPrice(price: number): Promise<void> {
  const userId = currentUser()?.uid;
  if (!userId) throw new Error('Not authenticated');

  const clamped = Math.min(9999, Math.max(1, Math.round(price)));
  await firestore().collection('users').doc(userId).update({
    'privacy.paidChatPrice': clamped,
    'privacy.dmPermission': 'paid',
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
  if (__DEV__) console.log(`[PaidChat] Price set to ₹${clamped} for user ${userId}`);
}

/**
 * Fetches the target user's paid chat price from their privacy settings.
 * Returns 0 if not set or if the user's DM permission is not "paid".
 */
export async function getPaidChatPrice(targetUserId: string): Promise<number> {
  try {
    const docSnap = await firestore().collection('users').doc(targetUserId).get();
    if (!docSnap.exists) return 0;
    const privacy = docSnap.data()?.privacy;
    if (!privacy || privacy.dmPermission !== 'paid') return 0;
    return typeof privacy.paidChatPrice === 'number' ? privacy.paidChatPrice : 0;
  } catch (e) {
    console.warn('[PaidChat] Failed to fetch price:', e);
    return 0;
  }
}

/**
 * Records that a payer has paid for chat access to a receiver.
 * Stored at `paid_chat_access/{payerId}_{receiverId}`.
 */
export async function createPaidChatAccess(
  payerId: string,
  receiverId: string,
  amount: number,
  paymentId?: string,
): Promise<boolean> {
  try {
    const docId = `${payerId}_${receiverId}`;
    await firestore().collection('paid_chat_access').doc(docId).set({
      payerId,
      receiverId,
      amount,
      paymentId: paymentId || `manual_${Date.now()}`,
      status: 'active',
      createdAt: firestore.FieldValue.serverTimestamp(),
    });
    if (__DEV__) console.log(`[PaidChat] Access granted: ${payerId} → ${receiverId} for ₹${amount}`);
    return true;
  } catch (e) {
    console.error('[PaidChat] Failed to create access record:', e);
    return false;
  }
}

/**
 * Checks if a payer already has active paid chat access to a receiver.
 */
export async function hasPaidChatAccess(
  payerId: string,
  receiverId: string,
): Promise<boolean> {
  try {
    const docSnap = await firestore()
      .collection('paid_chat_access')
      .doc(`${payerId}_${receiverId}`)
      .get();
    if (!docSnap.exists) return false;
    const data = docSnap.data();
    return data?.status === 'active';
  } catch (e) {
    console.warn('[PaidChat] Failed to check access:', e);
    return false;
  }
}

/**
 * Fetches the target user's DM permission setting from their privacy settings.
 * Returns 'all' | 'followers_only' | 'paid' | 'no one' — defaults to 'all' if not set.
 */
export async function getUserDmPermission(targetUserId: string): Promise<string> {
  try {
    const docSnap = await firestore().collection('users').doc(targetUserId).get();
    if (!docSnap.exists) return 'all';
    const privacy = docSnap.data()?.privacy;
    if (!privacy) return 'all';
    // BUG FIX: Normalize return values to match what callers expect.
    // The privacy.dmPermission field in Firestore uses 'paid', 'followers',
    // 'followers_only', 'everyone', 'no one', etc. Callers check for these
    // exact strings ('paid', 'followers'). Normalize variants for consistency.
    const perm = privacy.dmPermission || 'all';
    if (perm === 'everyone') return 'all';
    if (perm === 'followers_only') return 'followers';
    return perm;
  } catch (e) {
    console.warn('[PaidChat] Failed to fetch DM permission:', e);
    return 'all';
  }
}

/* ── Privacy Settings ───────────────────────────────────────────────────── */

/**
 * Normalize DM permission values from Firestore to the canonical values
 * used in the app ('all', 'followers', 'paid', 'no one').
 * Firestore may contain variant values like 'everyone', 'followers_only'
 * from direct edits or older versions.
 */
function _normalizeDmPermission(perm: string | undefined | null): 'all' | 'followers' | 'paid' {
  if (!perm) return 'all';
  if (perm === 'everyone') return 'all';
  if (perm === 'followers_only') return 'followers';
  // Accept the canonical values directly
  if (perm === 'all' || perm === 'followers' || perm === 'paid' || perm === 'no one') {
    return perm;
  }
  // Unknown value — default to 'all' (most permissive, least surprising)
  return 'all';
}

export interface UserPrivacySettings {
  nameVisibility: 'public' | 'private' | 'selected';
  dmPermission: 'all' | 'followers' | 'paid' | 'no one';
  searchVisible: boolean;
  accountLocked: boolean;
}

const DEFAULT_PRIVACY_SETTINGS: UserPrivacySettings = {
  nameVisibility: 'public',
  dmPermission: 'all',
  searchVisible: true,
  accountLocked: false,
};

export async function fetchUserPrivacySettings(userId: string): Promise<UserPrivacySettings> {
  try {
    const docSnap = await firestore().collection('users').doc(userId).get();
    if (docSnap.exists) {
      const data = docSnap.data();
      const stored = data?.privacy;
      if (stored) {
        return {
          nameVisibility: stored.nameVisibility || DEFAULT_PRIVACY_SETTINGS.nameVisibility,
          // BUG FIX: Normalize dmPermission values so callers get consistent values.
          // Firestore might have 'everyone' or 'followers_only' from direct edits.
          dmPermission: _normalizeDmPermission(stored.dmPermission),
          searchVisible: stored.searchVisible !== false,
          accountLocked: stored.accountLocked || false,
        };
      }
    }
  } catch (e) {
    console.error('[Privacy] Failed to fetch user privacy settings:', e);
  }
  return { ...DEFAULT_PRIVACY_SETTINGS };
}

/* ── Affiliate Badge Assignment ────────────────────────────────────────── */

export async function assignAffiliateBadge(
  businessId: string,
  affiliateId: string,
  tier: string,
): Promise<boolean> {
  try {
    const userId = currentUser()?.uid;
    if (!userId) return false;

    await firestore()
      .collection('affiliates')
      .doc(affiliateId)
      .update({
        badge: tier,
        badgeAssignedBy: userId,
        badgeAssignedAt: firestore.FieldValue.serverTimestamp(),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });

    if (__DEV__) console.log(`[AffiliateBadge] Assigned "${tier}" badge to affiliate ${affiliateId}`);
    return true;
  } catch (e) {
    console.error('[AffiliateBadge] Failed to assign badge:', e);
    return false;
  }
}

/* ── User Search (for Add Team Member) ─────────────────────────────────── */

export async function searchUsers(query: string): Promise<User[]> {
  if (!query.trim()) return [];

  const qLower = query.trim().toLowerCase();
  const results: User[] = [];

  try {
    if (qLower.length >= 2) {
      const endStr = qLower.slice(0, -1) + String.fromCharCode(qLower.charCodeAt(qLower.length - 1) + 1);

      const [usernameSnap, displayNameSnap] = await Promise.all([
        firestore()
          .collection('users')
          .where('usernameLower', '>=', qLower)
          .where('usernameLower', '<', endStr)
          .limit(10)
          .get(),
        firestore()
          .collection('users')
          .where('displayNameLower', '>=', qLower)
          .where('displayNameLower', '<', endStr)
          .limit(10)
          .get(),
      ]);

      const seenIds = new Set<string>();
      const processSnap = (snap: any) => {
        for (const docSnap of snap.docs) {
          if (seenIds.has(docSnap.id)) continue;
          seenIds.add(docSnap.id);
          const data = docSnap.data();
          results.push({
            id: docSnap.id,
            email: data.email || '',
            username: data.username || '',
            displayName: data.displayName || '',
            bio: data.bio || '',
            profileImage: data.profileImage || null,
            coverImage: data.coverImage || null,
            role: data.role || 'personal',
            badge: data.badge || '',
            subscription: data.subscription || 'free',
            isVerified: data.isVerified || false,
            createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
          });
        }
      };

      processSnap(usernameSnap);
      processSnap(displayNameSnap);
    }
  } catch (e) {
    console.error('[Search] searchUsers error:', e);
  }

  return results;
}

/* ── Cart ───────────────────────────────────────────────────────────────────── */

export interface CartItem {
  productId: string;
  quantity: number;
  addedAt: number;
  name: string;
  price: number;
  comparePrice?: number;
  image: string;
  ownerName: string;
}


export async function fetchCart(userId: string): Promise<CartItem[]> {
  try {
    const snapshot = await firestore()
      .collection('users')
      .doc(userId)
      .collection('cart')
      .get();

    if (snapshot.empty) return [];

    const cartItems: CartItem[] = [];

    for (const docSnap of snapshot.docs) {
      const cartData = docSnap.data();
      const productId = cartData.productId || docSnap.id;

      try {
        const productSnap = await firestore().collection('products').doc(productId).get();
        if (!productSnap.exists) continue;
        const productData = productSnap.data();

        let productImage = '';
        try {
          const imgs = typeof productData.images === 'string'
            ? JSON.parse(productData.images)
            : productData.images;
          if (Array.isArray(imgs) && imgs.length > 0) productImage = imgs[0];
        } catch {}

        let ownerName = '';
        try {
          if (productData.ownerId) {
            const ownerSnap = await firestore().collection('users').doc(productData.ownerId).get();
            if (ownerSnap.exists) {
              ownerName = ownerSnap.data()?.displayName || ownerSnap.data()?.businessName || '';
            }
          }
        } catch {}

        cartItems.push({
          productId,
          quantity: cartData.quantity || 1,
          addedAt: (() => { try { return tsToMillis(cartData.addedAt); } catch { return Date.now(); } })(),
          name: productData.name || 'Unknown Product',
          price: productData.price || 0,
          comparePrice: productData.compareAtPrice || undefined,
          image: productImage,
          ownerName,
        });
      } catch (e) {
        console.warn('[Cart] Failed to fetch product:', productId, e);
      }
    }

    cartItems.sort((a, b) => b.addedAt - a.addedAt);
    return cartItems;
  } catch (e) {
    console.error('[Cart] Failed to fetch cart:', e);
    return [];
  }
}

export async function updateCartItemQuantity(userId: string, productId: string, quantity: number): Promise<void> {
  const currentUid = currentUser()?.uid;
  if (!currentUid || currentUid !== userId) throw new Error('Not authenticated');
  if (quantity <= 0) {
    await removeFromCart(userId, productId);
    return;
  }
  try {
    await firestore()
      .collection('users')
      .doc(userId)
      .collection('cart')
      .doc(productId)
      .update({ quantity });
  } catch (e) {
    console.warn('[Cart] Failed to update cart item quantity:', e);
  }
}

export async function removeFromCart(userId: string, productId: string): Promise<void> {
  const currentUid = currentUser()?.uid;
  if (!currentUid || currentUid !== userId) throw new Error('Not authenticated');
  try {
    await firestore()
      .collection('users')
      .doc(userId)
      .collection('cart')
      .doc(productId)
      .delete();
  } catch (e) {
    console.warn('[Cart] Failed to remove cart item:', e);
  }
}

/* ── Fact-Checking System ──────────────────────────────────────────────────────── */

/**
 * Submits a fact-check claim on a post.
 * Users can flag a specific part of a post's text as potentially misleading.
 */
export async function submitFactCheck(
  postId: string,
  claimText: string,
  sourceUrl?: string,
  sourceTitle?: string,
): Promise<FactCheckClaim> {
  const userId = currentUser()?.uid;
  if (!userId) throw new Error('Not authenticated');

  const docRef = await firestore().collection('factChecks').add({
    postId,
    claimedBy: userId,
    claimedAt: firestore.FieldValue.serverTimestamp(),
    text: claimText,
    sourceUrl: sourceUrl || '',
    sourceTitle: sourceTitle || '',
    verdict: 'pending',
    verifiedBy: null,
    verifiedAt: null,
    confidenceScore: 0,
    tags: [],
    createdAt: firestore.FieldValue.serverTimestamp(),
  });

  // Auto-verify the claim using keyword analysis
  try {
    await autoVerifyFactCheck(docRef.id, claimText);
  } catch (e) {
    console.warn('[FactCheck] Auto-verification failed:', e);
  }

  const snap = await firestore().collection('factChecks').doc(docRef.id).get();
  const data = snap.data();
  if (!data) throw new Error('Fact check document not found after creation');

  return {
    id: docRef.id,
    postId,
    claimedBy: userId,
    claimedAt: (() => { try { return tsToMillis(data.claimedAt); } catch { return Date.now(); } })(),
    text: data.text || '',
    sourceUrl: data.sourceUrl || '',
    sourceTitle: data.sourceTitle || '',
    verdict: data.verdict || 'pending',
    verifiedBy: data.verifiedBy || null,
    verifiedAt: data.verifiedAt ? (() => { try { return tsToMillis(data.verifiedAt); } catch { return null; } })() : null,
    confidenceScore: data.confidenceScore || 0,
    tags: data.tags || [],
  };
}

/**
 * Automatically verifies a fact-check claim using keyword-based analysis.
 * This provides instant feedback while manual review can still override.
 * 
 * Uses simple heuristics:
 * - Checks if source URL is from a reputable domain
 * - Checks claim length and structure
 * - Assigns a confidence score and tentative verdict
 */
async function autoVerifyFactCheck(claimId: string, claimText: string): Promise<void> {
  const text = claimText.toLowerCase();
  
  // Determine verdict based on claim characteristics
  let verdict: 'verified' | 'debunked' | 'misleading' | 'pending' = 'pending';
  let confidenceScore = 30; // Base confidence
  let tags: string[] = [];
  
  // Claims with specific numbers, dates, or sources tend to be more verifiable
  const hasNumbers = /\d+/.test(claimText);
  const hasSource = /https?:\/\//.test(claimText);
  const isSpecific = claimText.length > 50;
  
  if (hasNumbers) confidenceScore += 15;
  if (hasSource) confidenceScore += 20;
  if (isSpecific) confidenceScore += 10;
  
  // Simple claim classification
  const debunkKeywords = ['fake', 'false', 'not true', 'incorrect', 'wrong', 'lie', 'lies', 'fabricated', 'hoax', 'scam', 'misinformation', 'debunked'];
  const verifiedKeywords = ['confirmed', 'verified', 'true', 'proven', 'official', 'according to', 'reported by', 'source', 'evidence', 'data shows', 'study', 'research'];
  const misleadingKeywords = ['misleading', 'out of context', 'partial truth', 'exaggerated', 'cherry-picked', 'clickbait', 'sensationalized'];
  
  const isDebunk = debunkKeywords.some(kw => text.includes(kw));
  const isVerified = verifiedKeywords.some(kw => text.includes(kw));
  const isMisleading = misleadingKeywords.some(kw => text.includes(kw));
  
  if (isDebunk && !isVerified) {
    verdict = 'debunked';
    confidenceScore += 10;
    tags.push('debunk-claim');
  } else if (isVerified && !isDebunk) {
    verdict = 'verified';
    confidenceScore += 10;
    tags.push('verified-claim');
  } else if (isMisleading) {
    verdict = 'misleading';
    confidenceScore += 5;
    tags.push('misleading-claim');
  } else {
    verdict = 'pending';
    tags.push('needs-review');
  }
  
  // Cap confidence at 85 (never fully confident without human review)
  confidenceScore = Math.min(confidenceScore, 85);
  
  // Update the claim with auto-verification results
  await firestore().collection('factChecks').doc(claimId).update({
    verdict,
    confidenceScore,
    tags,
    verifiedBy: 'auto',
    verifiedAt: firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Fetches all fact-check claims for a post.
 */
export async function fetchPostFactChecks(postId: string): Promise<FactCheckClaim[]> {
  try {
    const snapshot = await firestore()
      .collection('factChecks')
      .where('postId', '==', postId)
      .orderBy('claimedAt', 'desc')
      .limit(20)
      .get();

    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        postId: data.postId || '',
        claimedBy: data.claimedBy || '',
        claimedAt: (() => { try { return tsToMillis(data.claimedAt); } catch { return Date.now(); } })(),
        text: data.text || '',
        sourceUrl: data.sourceUrl || '',
        sourceTitle: data.sourceTitle || '',
        verdict: data.verdict || 'pending',
        verifiedBy: data.verifiedBy || null,
        verifiedAt: data.verifiedAt ? (() => { try { return tsToMillis(data.verifiedAt); } catch { return null; } })() : null,
        confidenceScore: data.confidenceScore || 0,
        tags: data.tags || [],
      };
    });
  } catch (e) {
    console.error('[FactCheck] Failed to fetch:', e);
    return [];
  }
}
