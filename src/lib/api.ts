import { auth, firestore, onAuthStateChanged, signInWithGoogleIdToken, signOut } from './firebase';
import { ensureChatEncryptionKey, encryptMessage, decryptMessage, clearKeyCache } from './e2ee';
import { createNotification } from '../services/notificationEngine';

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
  likeCount: number;
  commentCount: number;
  repostCount: number;
  liked: boolean;
  bookmarked: boolean;
  reposted: boolean;
  createdAt: number;
  factCheckVerified?: number;
  factCheckDebunked?: number;
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
  createdAt: number;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

export function parseMediaUrls(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    if (raw.startsWith('data:')) return [raw];
    return raw.split(',').map(u => u.trim()).filter(Boolean);
  }
  return [];
}

export { tsToMillis } from '../utils/datetime';

function currentUser(): any {
  return auth()?.currentUser;
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
    try {
      userDocSnap = await userDocRef.get();
    } catch (e) {
      console.warn('[Auth] Firestore user doc fetch failed, creating new:', e);
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
      profileImage: googlePhoto,
      role: 'personal',
      badge: '',
      subscription: 'free',
      isVerified: false,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    };

    // Extract existing Firestore data ONCE, before the if/else branches use it.
    const existingData = userDocSnap.exists ? userDocSnap.data() : null;

    if (!userDocSnap.exists) {
      userData.createdAt = firestore.FieldValue.serverTimestamp();
      try {
        // Use merge: true so if the doc was created by another client between
        // the get() and set() (race condition), we don't overwrite existing fields.
        await userDocRef.set(userData, { merge: true });
        await firestore().collection('usernames').doc(username.toLowerCase()).set({ uid: fbUser.uid });
      } catch (e) {
        console.warn('[Auth] Failed to create user doc:', e);
      }
    } else {
      // Returning user — update profileImage only if Firestore has null
      // but Google has a photo (recovery for users whose photos were stripped
      // by the old _isStorageUrl filter).
      try {
        const existingPhoto = existingData?.profileImage;
        const needsPhotoRecovery = !existingPhoto && googlePhoto;
        const updateFields: Record<string, any> = {
          updatedAt: firestore.FieldValue.serverTimestamp(),
        };
        if (needsPhotoRecovery) {
          updateFields.profileImage = googlePhoto;
        }
        await userDocRef.update(updateFields);
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

    return {
      id: fbUser.uid,
      email: fbUser.email || '',
      username: existingData?.username || username,
      displayName: existingData?.displayName || userData.displayName,
      bio: existingData?.bio || '',
      profileImage: existingData?.profileImage || recoveredPhoto || userData.profileImage,
      coverImage: existingData?.coverImage || null,
      role: existingData?.role || 'personal',
      badge: existingData?.badge || '',
      subscription: existingData?.subscription || 'free',
      isVerified: existingData?.isVerified || false,
      createdAt,
    };
  } catch (error: any) {
    if (error?.code === '12501') return null;
    console.error('[Auth] Google sign-in error:', error);
    throw error;
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
}

/* ── Posts ────────────────────────────────────────────────────────────────── */

export async function fetchFeed(limitCount = 20): Promise<Post[]> {
  if (__DEV__) console.log('[Feed] Fetching feed...');
  const snapshot = await firestore()
    .collection('posts')
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .get();

  if (__DEV__) console.log(`[Feed] Got ${snapshot.docs.length} posts from Firestore`);

  const userId = currentUser()?.uid;
  const posts: Post[] = snapshot.docs.map(docSnap => {
    const data = docSnap.data();
    return {
      id: docSnap.id,
      authorId: data.authorId || '',
      authorUsername: data.authorUsername || '',
      authorDisplayName: data.authorDisplayName || '',
      authorProfileImage: data.authorProfileImage || null,
      authorBadge: data.authorBadge || '',
      authorIsVerified: data.authorIsVerified || false,
      caption: data.caption || '',
      mediaUrls: parseMediaUrls(data.mediaUrls),
      likeCount: data.likeCount || 0,
      commentCount: data.commentCount || 0,
      repostCount: data.repostCount || 0,
      liked: false,
      bookmarked: false,
      reposted: false,
      createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
      factCheckVerified: data.factCheckVerified || 0,
      factCheckDebunked: data.factCheckDebunked || 0,
    };
  });

  if (posts.length === 0) return posts;

  // ── ROBUST: Fetch fresh user profiles for ALL unique authors ──
  // This ensures displayName, username, profileImage, badge, isVerified
  // are always up-to-date, even if the user changed their profile after posting.
  // This matches the webapp's behavior where the Zustand store provides live data.
  const uniqueAuthorIds = [...new Set(posts.map(p => p.authorId).filter(Boolean))];
  const authorProfileMap: Record<string, {
    displayName: string;
    username: string;
    profileImage: string | null;
    badge: string;
    isVerified: boolean;
  }> = {};

  const CHUNK_SIZE = 10; // Firestore IN operator max is 10
  for (let i = 0; i < uniqueAuthorIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueAuthorIds.slice(i, i + CHUNK_SIZE);
    try {
      const userDocs = await Promise.all(
        chunk.map(uid => firestore().collection('users').doc(uid).get().catch(() => null))
      );
      for (const docSnap of userDocs) {
        if (docSnap && docSnap.exists) {
          const d = docSnap.data()!;
          authorProfileMap[docSnap.id] = {
            displayName: d.displayName || d.username || '',
            username: d.username || '',
            profileImage: d.profileImage || null,
            badge: d.badge || '',
            isVerified: d.isVerified || false,
          };
        }
      }
    } catch (e) {
      console.warn('[Feed] Batch author profile fetch failed for chunk:', e);
    }
  }

  // Enrich posts with fresh author data from user profiles
  for (const post of posts) {
    const fresh = authorProfileMap[post.authorId];
    if (fresh) {
      post.authorDisplayName = fresh.displayName || post.authorDisplayName;
      post.authorUsername = fresh.username || post.authorUsername;
      post.authorProfileImage = fresh.profileImage || post.authorProfileImage;
      post.authorBadge = fresh.badge || post.authorBadge;
      post.authorIsVerified = fresh.isVerified || post.authorIsVerified;
    }
  }

  if (!userId) return posts;

  // Batch fetch all interaction data using IN filter (chunks of 30)
  const postIds = posts.map(p => p.id);
  const likedIds = new Set<string>();
  const bookmarkedIds = new Set<string>();
  const repostedIds = new Set<string>();

  for (let i = 0; i < postIds.length; i += CHUNK_SIZE) {
    const chunk = postIds.slice(i, i + CHUNK_SIZE);

    try {
      // Try batch query (needs composite index). Fall back to individual reads if it fails.
      let batchSucceeded = true;
      try {
        const [likesSnap, bookmarksSnap, repostsSnap] = await Promise.all([
          firestore().collection('post_likes')
            .where('postId', 'in', chunk)
            .where('userId', '==', userId)
            .get(),
          firestore().collection('post_bookmarks')
            .where('postId', 'in', chunk)
            .where('userId', '==', userId)
            .get(),
          firestore().collection('post_reposts')
            .where('postId', 'in', chunk)
            .where('userId', '==', userId)
            .get(),
        ]);

        for (const doc of likesSnap.docs) {
          const d = doc.data();
          if (d.postId) likedIds.add(d.postId);
        }
        for (const doc of bookmarksSnap.docs) {
          const d = doc.data();
          if (d.postId) bookmarkedIds.add(d.postId);
        }
        for (const doc of repostsSnap.docs) {
          const d = doc.data();
          if (d.postId) repostedIds.add(d.postId);
        }

        if ((likesSnap as any)._missingIndex || (bookmarksSnap as any)._missingIndex || (repostsSnap as any)._missingIndex) {
          batchSucceeded = false;
        }
      } catch (batchErr) {
        console.warn('[Feed] Batch interaction query failed, falling back to individual reads:', batchErr);
        batchSucceeded = false;
      }

      if (!batchSucceeded) {
        if (__DEV__) console.log('[Feed] Using individual interaction reads fallback');
        const individualPromises = chunk.flatMap(postId => [
          firestore().collection('post_likes').doc(`${postId}_${userId}`).get().then(snap => {
            if (snap.exists) likedIds.add(postId);
          }).catch(() => {}),
          firestore().collection('post_bookmarks').doc(`${postId}_${userId}`).get().then(snap => {
            if (snap.exists) bookmarkedIds.add(postId);
          }).catch(() => {}),
          firestore().collection('post_reposts').doc(`${postId}_${userId}`).get().then(snap => {
            if (snap.exists) repostedIds.add(postId);
          }).catch(() => {}),
        ]);
        await Promise.all(individualPromises);
      }
    } catch (e) {
      console.warn('[Feed] Batch interaction fetch failed for chunk:', e);
    }
  }

  // Merge interaction results back into posts
  for (const post of posts) {
    post.liked = likedIds.has(post.id);
    post.bookmarked = bookmarkedIds.has(post.id);
    post.reposted = repostedIds.has(post.id);
  }

  return posts;
}

export async function createPost(caption: string, mediaUrls: string[] = []): Promise<string> {
  const userId = currentUser()?.uid;
  if (!userId) throw new Error('Not authenticated');

  const userDocSnap = await firestore().collection('users').doc(userId).get();
  const userData = userDocSnap.data();

  const docRef = await firestore().collection('posts').add({
    authorId: userId,
    authorUsername: userData?.username || '',
    authorDisplayName: userData?.displayName || '',
    authorProfileImage: userData?.profileImage || null,
    authorBadge: userData?.badge || '',
    authorIsVerified: userData?.isVerified || false,
    caption,
    mediaUrls,
    likeCount: 0,
    commentCount: 0,
    repostCount: 0,
    createdAt: firestore.FieldValue.serverTimestamp(),
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });

  return docRef.id;
}

export async function toggleLike(postId: string, currentlyLiked: boolean): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;

  const likeRef = firestore().collection('post_likes').doc(`${postId}_${userId}`);
  const postRef = firestore().collection('posts').doc(postId);

  if (currentlyLiked) {
    await likeRef.delete();
    await postRef.update({ likeCount: firestore.FieldValue.increment(-1) });
    return false;
  } else {
    await likeRef.set({ postId, userId, createdAt: firestore.FieldValue.serverTimestamp() });
    await postRef.update({ likeCount: firestore.FieldValue.increment(1) });

    // ── Notification: tell post author someone liked their post ──
    try {
      const postDoc = await postRef.get();
      const postData = postDoc.exists ? postDoc.data() : null;
      const postAuthorId = postData?.authorId;
      if (postAuthorId && postAuthorId !== userId) {
        const myDoc = await firestore().collection('users').doc(userId).get();
        const myData = myDoc.exists ? myDoc.data() : null;
        createNotification({
          recipientId: postAuthorId,
          type: 'like',
          actorId: userId,
          actorDisplayName: myData?.displayName || '',
          actorUsername: myData?.username || '',
          actorProfileImage: myData?.profileImage || null,
          actorIsVerified: myData?.isVerified || false,
          actorBadge: myData?.badge || '',
          postId,
          postCaption: postData?.caption || '',
        });
      }
    } catch (e) {
      console.warn('[Like] Notification fire-and-forget failed:', e);
    }

    return true;
  }
}

export async function toggleBookmark(postId: string, currentlyBookmarked: boolean): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;

  const bookmarkRef = firestore().collection('post_bookmarks').doc(`${postId}_${userId}`);

  if (currentlyBookmarked) {
    await bookmarkRef.delete();
    return false;
  } else {
    await bookmarkRef.set({ postId, userId, createdAt: firestore.FieldValue.serverTimestamp() });
    return true;
  }
}

export async function toggleRepost(postId: string, currentlyReposted: boolean): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;

  const repostRef = firestore().collection('post_reposts').doc(`${postId}_${userId}`);
  const postRef = firestore().collection('posts').doc(postId);

  if (currentlyReposted) {
    await repostRef.delete();
    await postRef.update({ repostCount: firestore.FieldValue.increment(-1) });
    return false;
  } else {
    await repostRef.set({ postId, userId, createdAt: firestore.FieldValue.serverTimestamp() });
    await postRef.update({ repostCount: firestore.FieldValue.increment(1) });

    // ── Notification: tell post author someone reposted their post ──
    try {
      const postDoc = await postRef.get();
      const postData = postDoc.exists ? postDoc.data() : null;
      const postAuthorId = postData?.authorId;
      if (postAuthorId && postAuthorId !== userId) {
        const myDoc = await firestore().collection('users').doc(userId).get();
        const myData = myDoc.exists ? myDoc.data() : null;
        createNotification({
          recipientId: postAuthorId,
          type: 'repost',
          actorId: userId,
          actorDisplayName: myData?.displayName || '',
          actorUsername: myData?.username || '',
          actorProfileImage: myData?.profileImage || null,
          actorIsVerified: myData?.isVerified || false,
          actorBadge: myData?.badge || '',
          postId,
          postCaption: postData?.caption || '',
        });
      }
    } catch (e) {
      console.warn('[Repost] Notification fire-and-forget failed:', e);
    }

    return true;
  }
}

/* ── Chat ─────────────────────────────────────────────────────────────────── */

export async function fetchChatList(): Promise<Chat[]> {
  const userId = currentUser()?.uid;
  if (!userId) return [];

  try {
    if (__DEV__) console.log('[Chat] Fetching chat list for user:', userId);
    const [snap1, snap2] = await Promise.all([
      firestore().collection('chats').where('user1Id', '==', userId).get(),
      firestore().collection('chats').where('user2Id', '==', userId).get(),
    ]);
    if (__DEV__) console.log(`[Chat] Got ${snap1.docs.length} + ${snap2.docs.length} chats`);

    const allDocs = [...snap1.docs, ...snap2.docs];
    if (allDocs.length === 0) return [];

    // Collect unique other user IDs
    const otherUserIds = [...new Set(allDocs.map(docSnap => {
      const data = docSnap.data();
      return data.user1Id === userId ? data.user2Id : data.user1Id;
    }))];

    // Batch fetch all user profiles in parallel (chunks of 30)
    const CHUNK_SIZE = 10; // Firestore IN operator max is 10
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
    const chats: Chat[] = allDocs.map(docSnap => {
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
          email: otherData.email || '',
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

    return chats.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
  } catch (e: any) {
    console.error('[Chat] Processing error:', e?.message);
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

    // Get encryption key for this chat (returns null if none exists yet)
    const encryptionKey = await ensureChatEncryptionKey(chatId);

    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      const rawContent = data.content || '';
      return {
        id: docSnap.id,
        chatId,
        senderId: data.senderId || '',
        receiverId: data.receiverId || '',
        content: decryptMessage(rawContent, encryptionKey),
        createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
      };
    });
  } catch (e) {
    console.error('[Messages] Failed:', e);
    return [];
  }
}

export async function sendMessage(chatId: string, receiverId: string, content: string): Promise<void> {
  const userId = currentUser()?.uid;
  if (!userId) return;

  // ── Nuclear Block Check: prevent messaging if either user blocked the other ──
  try {
    const [iBlockedThem, theyBlockedMe] = await Promise.all([
      firestore().collection('blocks').doc(`${userId}_${receiverId}`).get(),
      firestore().collection('blocks').doc(`${receiverId}_${userId}`).get(),
    ]);
    if (iBlockedThem.exists || theyBlockedMe.exists) {
      if (__DEV__) console.log('[Messages] Blocked — message not sent');
      return;
    }
  } catch (e) {
    console.warn('[Messages] Block check failed, allowing message:', e);
  }

  // Encrypt the message content before storing
  const encryptionKey = await ensureChatEncryptionKey(chatId);
  const encryptedContent = encryptMessage(content, encryptionKey);

  await firestore().collection('chats').doc(chatId).collection('messages').add({
    chatId,
    senderId: userId,
    receiverId,
    content: encryptedContent,
    messageType: 'text',
    status: 'sent',
    createdAt: firestore.FieldValue.serverTimestamp(),
  });

  // Increment unread count for receiver, reset sender's unread to 0
  // Store lastMessage as plain text for the chat list preview (not encrypted)
  const chatDoc = await firestore().collection('chats').doc(chatId).get();
  const chatData = chatDoc.exists ? chatDoc.data() : null;
  const senderIsUser1 = chatData?.user1Id === userId;
  const senderUnreadField = senderIsUser1 ? 'unreadUser1' : 'unreadUser2';
  const receiverUnreadField = senderIsUser1 ? 'unreadUser2' : 'unreadUser1';

  await firestore().collection('chats').doc(chatId).update({
    lastMessage: content,
    lastMessageTime: firestore.FieldValue.serverTimestamp(),
    [receiverUnreadField]: firestore.FieldValue.increment(1),
    [senderUnreadField]: 0,
  });

  // ── Notification: tell receiver they got a new DM ──
  try {
    const myDoc = await firestore().collection('users').doc(userId).get();
    const myData = myDoc.exists ? myDoc.data() : null;
    createNotification({
      recipientId: receiverId,
      type: 'chat',
      actorId: userId,
      actorDisplayName: myData?.displayName || '',
      actorUsername: myData?.username || '',
      actorProfileImage: myData?.profileImage || null,
      actorIsVerified: myData?.isVerified || false,
      actorBadge: myData?.badge || '',
    });
  } catch (e) {
    console.warn('[Messages] Notification fire-and-forget failed:', e);
  }
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
    ]);

    // Delete all messages in chats between these two users
    const chatSnapshots = await Promise.all([
      firestore().collection('chats').where('user1Id', '==', userId).where('user2Id', '==', targetUserId).get(),
      firestore().collection('chats').where('user1Id', '==', targetUserId).where('user2Id', '==', userId).get(),
    ]);

    const chatIds = [
      ...chatSnapshots[0].docs.map(d => d.id),
      ...chatSnapshots[1].docs.map(d => d.id),
    ];

    // Delete all messages in each chat
    for (const chatId of chatIds) {
      try {
        const messagesSnapshot = await firestore()
          .collection('chats')
          .doc(chatId)
          .collection('messages')
          .limit(500)
          .get();

        const deletePromises = messagesSnapshot.docs.map(docSnap =>
          firestore().collection('chats').doc(chatId).collection('messages').doc(docSnap.id).delete()
        );
        await Promise.all(deletePromises);
        if (__DEV__) console.log(`[Block] Deleted ${messagesSnapshot.docs.length} messages in chat ${chatId}`);
      } catch (e) {
        console.warn(`[Block] Failed to delete messages for chat ${chatId}:`, e);
      }
    }

    if (__DEV__) console.log(`[Block] User ${targetUserId} blocked successfully`);
    return true;
  } catch (e) {
    console.error('[Block] Failed to block user:', e);
    return false;
  }
}

export async function unblockUser(targetUserId: string): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;

  try {
    await Promise.all([
      firestore().collection('blocks').doc(`${userId}_${targetUserId}`).delete(),
      firestore().collection('blockedBy').doc(`${targetUserId}_${userId}`).delete(),
    ]);
    if (__DEV__) console.log(`[Block] User ${targetUserId} unblocked successfully`);
    return true;
  } catch (e) {
    console.error('[Block] Failed to unblock user:', e);
    return false;
  }
}

export async function isBlockedByMe(targetUserId: string): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;

  try {
    const docSnap = await firestore().collection('blocks').doc(`${userId}_${targetUserId}`).get();
    return docSnap.exists;
  } catch (e) {
    console.warn('[Block] Failed to check block status:', e);
    return false;
  }
}

export async function fetchBlockedUsers(): Promise<string[]> {
  const userId = currentUser()?.uid;
  if (!userId) return [];

  try {
    const snapshot = await firestore()
      .collection('blocks')
      .where('blockerId', '==', userId)
      .get();

    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return data.blockedId || '';
    }).filter(Boolean);
  } catch (e) {
    console.warn('[Block] Failed to fetch blocked users:', e);
    return [];
  }
}

/* ── Hybrid Search ────────────────────────────────────────────────────────── */

export interface SearchResult {
  users: User[];
  posts: Post[];
  webResults: any[];
}

export async function hybridSearch(query: string): Promise<SearchResult> {
  const result: SearchResult = { users: [], posts: [], webResults: [] };
  if (!query.trim()) return result;

  const q = query.trim();
  const qLower = q.toLowerCase();

  try {
    // ── 1. Local Firestore: search users by username/displayName prefix ──
    // Firestore 'startsWith' requires >= 2 chars; prefix range query workaround
    let userSnapshots: any;
    if (qLower.length >= 2) {
      const endStr = qLower.slice(0, -1) + String.fromCharCode(qLower.charCodeAt(qLower.length - 1) + 1);
      userSnapshots = await Promise.all([
        firestore().collection('users').where('usernameLower', '>=', qLower).where('usernameLower', '<', endStr).limit(10).get(),
        firestore().collection('users').where('displayNameLower', '>=', qLower).where('displayNameLower', '<', endStr).limit(10).get(),
      ]);
    } else {
      // Too short for prefix range — skip user search
      userSnapshots = [{ docs: [] }, { docs: [] }];
    }

    const seenUserIds = new Set<string>();
    for (const snap of userSnapshots) {
      for (const docSnap of snap.docs) {
        if (seenUserIds.has(docSnap.id)) continue;
        seenUserIds.add(docSnap.id);
        const data = docSnap.data();
        result.users.push({
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
    }

    // ── 2. Local Firestore: search posts by caption prefix ──
    let postSnap: any;
    if (qLower.length >= 2) {
      const endStr = qLower.slice(0, -1) + String.fromCharCode(qLower.charCodeAt(qLower.length - 1) + 1);
      postSnap = await firestore().collection('posts').where('captionLower', '>=', qLower).where('captionLower', '<', endStr).limit(20).get();
    } else {
      postSnap = { docs: [] };
    }

    result.posts = postSnap.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        authorId: data.authorId || '',
        authorUsername: data.authorUsername || '',
        authorDisplayName: data.authorDisplayName || '',
        authorProfileImage: data.authorProfileImage || null,
        authorBadge: data.authorBadge || '',
        authorIsVerified: data.authorIsVerified || false,
        caption: data.caption || '',
        mediaUrls: parseMediaUrls(data.mediaUrls),
        likeCount: data.likeCount || 0,
        commentCount: data.commentCount || 0,
        repostCount: data.repostCount || 0,
        liked: false,
        bookmarked: false,
        reposted: false,
        createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
      };
    });

    // ── 3. Firestore: cached web results ──
    const webSnap = await firestore()
      .collection('web_results')
      .where('query', '==', qLower)
      .limit(5)
      .get();

    result.webResults = webSnap.docs.map(docSnap => docSnap.data());
  } catch (e) {
    console.warn('[Search] Hybrid search error:', e);
  }

  return result;
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
    return {
      id: userId,
      email: data?.email || '',
      username: data?.username || '',
      displayName,
      bio: data?.bio || '',
      profileImage: data?.profileImage || null,
      coverImage: data?.coverImage || null,
      role: data?.role || 'personal',
      badge: data?.badge || '',
      subscription: data?.subscription || 'free',
      isVerified: data?.isVerified || false,
      createdAt,
    };
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

  if (currentlyFollowing) {
    await followRef.delete();
    return false;
  } else {
    await followRef.set({
      followerId: userId,
      followingId: targetUserId,
      createdAt: firestore.FieldValue.serverTimestamp(),
    });

    // ── Notification: tell target user they got a new follower ──
    try {
      const myDoc = await firestore().collection('users').doc(userId).get();
      const myData = myDoc.exists ? myDoc.data() : null;
      createNotification({
        recipientId: targetUserId,
        type: 'follow',
        actorId: userId,
        actorDisplayName: myData?.displayName || '',
        actorUsername: myData?.username || '',
        actorProfileImage: myData?.profileImage || null,
        actorIsVerified: myData?.isVerified || false,
        actorBadge: myData?.badge || '',
      });
    } catch (e) {
      console.warn('[Follow] Notification fire-and-forget failed:', e);
    }

    return true;
  }
}

export async function checkFollowing(targetUserId: string): Promise<boolean> {
  const userId = currentUser()?.uid;
  if (!userId) return false;
  const docSnap = await firestore().collection('follows').doc(`${userId}_${targetUserId}`).get();
  return docSnap.exists;
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

export async function addPostComment(postId: string, content: string): Promise<CommentData | null> {
  const userId = currentUser()?.uid;
  if (!userId || !content.trim()) return null;
  
  const userDocSnap = await firestore().collection('users').doc(userId).get();
  const userData = userDocSnap.data();

  const docRef = await firestore().collection('post_comments').add({
    postId,
    authorId: userId,
    authorUsername: userData?.username || '',
    authorDisplayName: userData?.displayName || '',
    authorProfileImage: userData?.profileImage || '',
    authorIsVerified: userData?.isVerified || false,
    authorBadge: userData?.badge || '',
    content: content.trim(),
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
      createNotification({
        recipientId: postAuthorId,
        type: 'comment',
        actorId: userId,
        actorDisplayName: userData?.displayName || '',
        actorUsername: userData?.username || '',
        actorProfileImage: userData?.profileImage || null,
        actorIsVerified: userData?.isVerified || false,
        actorBadge: userData?.badge || '',
        postId,
        postCaption: postData?.caption || '',
        commentContent: content.trim(),
      });
    }
  } catch (e) {
    console.warn('[Comments] Notification fire-and-forget failed:', e);
  }

  return {
    id: docRef.id,
    postId,
    authorId: userId,
    authorUsername: userData?.username || '',
    authorDisplayName: userData?.displayName || '',
    authorProfileImage: userData?.profileImage || '',
    authorIsVerified: userData?.isVerified || false,
    authorBadge: userData?.badge || '',
    content: content.trim(),
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

/* ── AI Follow-up System ──────────────────────────────────────────────────── */

/**
 * Checks for leads assigned to a user that haven't been followed up on in >24h.
 * For each stale lead, writes an auto-follow-up notification and updates the
 * lead's lastFollowUpAt timestamp.
 */
export async function checkAndSendFollowUps(userId: string): Promise<void> {
  try {
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

    // Firestore doesn't support != on arrays, so query each status separately
    const [newSnap, contactedSnap] = await Promise.all([
      firestore()
        .collection('leads')
        .where('assignedTo', '==', userId)
        .where('status', '==', 'new')
        .get(),
      firestore()
        .collection('leads')
        .where('assignedTo', '==', userId)
        .where('status', '==', 'contacted')
        .get(),
    ]);

    const allLeads = [...newSnap.docs, ...contactedSnap.docs];

    for (const docSnap of allLeads) {
      const leadData = docSnap.data();
      const leadId = docSnap.id;
      let lastFollowUpAt = 0;
      try { lastFollowUpAt = leadData.lastFollowUpAt ? tsToMillis(leadData.lastFollowUpAt) : 0; } catch {}

      // Only process leads whose last follow-up is older than 24 hours (or never)
      if (lastFollowUpAt > twentyFourHoursAgo) continue;

      const leadName = leadData.name || leadData.companyName || 'Lead';
      const statusLabel = leadData.status === 'new' ? 'new' : 'contacted';

      if (__DEV__) console.log(`[Follow-up] Sending auto follow-up for lead ${leadId} (${leadName}, status: ${statusLabel})`);

      // Write a follow-up notification
      const notificationId = `${leadId}_followup`;
      try {
        await firestore()
          .collection('notifications')
          .doc(notificationId)
          .set({
            type: 'follow_up_reminder',
            leadId,
            leadName,
            assignedTo: userId,
            message: `Follow-up reminder: ${leadName} (${statusLabel}) hasn't been contacted in over 24 hours.`,
            status: leadData.status,
            createdAt: firestore.FieldValue.serverTimestamp(),
            read: false,
          });
      } catch (notifErr) {
        console.warn(`[Follow-up] Failed to write notification for lead ${leadId}:`, notifErr);
      }

      // Update the lead's lastFollowUpAt to now
      try {
        await firestore()
          .collection('leads')
          .doc(leadId)
          .update({
            lastFollowUpAt: firestore.FieldValue.serverTimestamp(),
          });
      } catch (updateErr) {
        console.warn(`[Follow-up] Failed to update lastFollowUpAt for lead ${leadId}:`, updateErr);
      }
    }

    if (__DEV__) console.log(`[Follow-up] Processed ${allLeads.length} leads for user ${userId}`);
  } catch (e) {
    console.error('[Follow-up] checkAndSendFollowUps error:', e);
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
    return privacy.dmPermission || 'all';
  } catch (e) {
    console.warn('[PaidChat] Failed to fetch DM permission:', e);
    return 'all';
  }
}

/* ── Privacy Settings ───────────────────────────────────────────────────── */

export interface UserPrivacySettings {
  nameVisibility: 'public' | 'private' | 'selected';
  dmPermission: 'everyone' | 'followers_only' | 'paid' | 'no one';
  searchVisible: boolean;
  accountLocked: boolean;
}

const DEFAULT_PRIVACY_SETTINGS: UserPrivacySettings = {
  nameVisibility: 'public',
  dmPermission: 'everyone',
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
          dmPermission: stored.dmPermission || DEFAULT_PRIVACY_SETTINGS.dmPermission,
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

export async function addToCart(userId: string, productId: string, quantity: number = 1): Promise<void> {
  const cartRef = firestore().collection('users').doc(userId).collection('cart').doc(productId);
  const cartDoc = await cartRef.get();
  const existingQty = cartDoc.exists ? (cartDoc.data()?.quantity || 0) : 0;

  await cartRef.set({
    productId,
    quantity: existingQty + quantity,
    addedAt: firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
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
          if (productData.businessId) {
            const ownerSnap = await firestore().collection('users').doc(productData.businessId).get();
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
  if (quantity <= 0) {
    await removeFromCart(userId, productId);
    return;
  }
  await firestore()
    .collection('users')
    .doc(userId)
    .collection('cart')
    .doc(productId)
    .update({ quantity });
}

export async function removeFromCart(userId: string, productId: string): Promise<void> {
  await firestore()
    .collection('users')
    .doc(userId)
    .collection('cart')
    .doc(productId)
    .delete();
}

export async function clearCart(userId: string): Promise<void> {
  const snapshot = await firestore()
    .collection('users')
    .doc(userId)
    .collection('cart')
    .get();

  const batchSize = 20;
  let hasMore = !snapshot.empty;
  while (hasMore) {
    const snap = await firestore()
      .collection('users')
      .doc(userId)
      .collection('cart')
      .limit(batchSize)
      .get();

    const promises = snap.docs.map(doc => doc.ref.delete());
    await Promise.all(promises);
    hasMore = snap.size >= batchSize;
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

  const snap = await firestore().collection('factChecks').doc(docRef.id).get();
  const data = snap.data();

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

/**
 * Submits a verification for a fact-check claim (admin/verified users).
 */
export async function verifyFactCheck(
  claimId: string,
  verdict: 'verified' | 'debunked' | 'misleading',
  confidenceScore: number,
  tags?: string[],
): Promise<void> {
  const userId = currentUser()?.uid;
  if (!userId) throw new Error('Not authenticated');

  await firestore().collection('factChecks').doc(claimId).update({
    verdict,
    confidenceScore: Math.max(0, Math.min(100, confidenceScore)),
    verifiedBy: userId,
    verifiedAt: firestore.FieldValue.serverTimestamp(),
    tags: tags || [],
  });
}

/**
 * Adds a fact-check badge/count to a post.
 * Called after a claim is verified to show the badge on the post.
 */
export async function updatePostFactCheckStatus(
  postId: string,
  verifiedCount: number,
  debunkedCount: number,
): Promise<void> {
  await firestore().collection('posts').doc(postId).update({
    factCheckVerified: verifiedCount,
    factCheckDebunked: debunkedCount,
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
}
