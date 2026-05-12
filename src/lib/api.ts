import { auth, firestore, onAuthStateChanged, signInWithGoogleIdToken, signOut } from './firebase';

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

export function tsToMillis(ts: any): number {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return new Date(ts).getTime() || Date.now();
  if (ts?.toMillis) return ts.toMillis();
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts?.seconds) return ts.seconds * 1000;
  return Date.now();
}

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

    const userData: any = {
      uid: fbUser.uid,
      email: fbUser.email,
      username: username,
      usernameLower: username.toLowerCase(),
      displayName: fbUser.displayName || 'User',
      profileImage: fbUser.photoURL || null,
      role: 'personal',
      badge: '',
      subscription: 'free',
      isVerified: false,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    };

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
      try {
        await userDocRef.update({
          profileImage: fbUser.photoURL || null,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.warn('[Auth] Failed to update user doc:', e);
      }
    }

    const existingData = userDocSnap.exists ? userDocSnap.data() : null;

    return {
      id: fbUser.uid,
      email: fbUser.email || '',
      username: existingData?.username || username,
      displayName: existingData?.displayName || userData.displayName,
      bio: existingData?.bio || '',
      profileImage: existingData?.profileImage || userData.profileImage,
      coverImage: existingData?.coverImage || null,
      role: existingData?.role || 'personal',
      badge: existingData?.badge || '',
      subscription: existingData?.subscription || 'free',
      isVerified: existingData?.isVerified || false,
      createdAt: tsToMillis(existingData?.createdAt),
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
  console.log('[Feed] Fetching feed...');
  const snapshot = await firestore()
    .collection('posts')
    .orderBy('createdAt', 'desc')
    .limit(limitCount)
    .get();

  console.log(`[Feed] Got ${snapshot.docs.length} posts from Firestore`);

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
      createdAt: tsToMillis(data.createdAt),
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
        console.log('[Feed] Using individual interaction reads fallback');
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
    return true;
  }
}

/* ── Chat ─────────────────────────────────────────────────────────────────── */

export async function fetchChatList(): Promise<Chat[]> {
  const userId = currentUser()?.uid;
  if (!userId) return [];

  console.log('[Chat] Fetching chat list for user:', userId);
  const [snap1, snap2] = await Promise.all([
    firestore().collection('chats').where('user1Id', '==', userId).get(),
    firestore().collection('chats').where('user2Id', '==', userId).get(),
  ]);
  console.log(`[Chat] Got ${snap1.docs.length} + ${snap2.docs.length} chats`);

  try {
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
        lastMessageTime: tsToMillis(data.lastMessageTime),
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
          createdAt: tsToMillis(otherData.createdAt),
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

    return snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        chatId,
        senderId: data.senderId || '',
        receiverId: data.receiverId || '',
        content: data.content || '',
        createdAt: tsToMillis(data.createdAt),
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
      console.log('[Messages] Blocked — message not sent');
      return;
    }
  } catch (e) {
    console.warn('[Messages] Block check failed, allowing message:', e);
  }

  await firestore().collection('chats').doc(chatId).collection('messages').add({
    chatId,
    senderId: userId,
    receiverId,
    content,
    messageType: 'text',
    status: 'sent',
    createdAt: firestore.FieldValue.serverTimestamp(),
  });

  // Increment unread count for receiver, reset sender's unread to 0
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
        console.log(`[Block] Deleted ${messagesSnapshot.docs.length} messages in chat ${chatId}`);
      } catch (e) {
        console.warn(`[Block] Failed to delete messages for chat ${chatId}:`, e);
      }
    }

    console.log(`[Block] User ${targetUserId} blocked successfully`);
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
    console.log(`[Block] User ${targetUserId} unblocked successfully`);
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
          createdAt: tsToMillis(data.createdAt),
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
        createdAt: tsToMillis(data.createdAt),
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
  console.log('[User] Fetching profile for:', userId);
  const docSnap = await firestore().collection('users').doc(userId).get();
  if (!docSnap.exists) {
    console.log('[User] User doc does not exist:', userId);
    return null;
  }
  const data = docSnap.data();
  console.log('[User] Got profile:', data?.displayName, '@' + data?.username, 'badge:', data?.badge, 'verified:', data?.isVerified);
  // CRITICAL: Fallback displayName to username so feed and profile always agree.
  // Feed enrichment uses d.displayName || d.username || '' — must match here.
  const displayName = data?.displayName || data?.username || '';
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
    createdAt: tsToMillis(data?.createdAt),
  };
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

export async function fetchPostComments(postId: string): Promise<CommentData[]> {
  try {
    // NOTE: No .orderBy('createdAt', 'asc') — that composite index may not exist.
    // Fetch without orderBy, then sort client-side (same as web's fetchPostComments).
    const snapshot = await firestore()
      .collection('post_comments')
      .where('postId', '==', postId)
      .limit(50)
      .get();
    const results = snapshot.docs.map(docSnap => {
      const data = docSnap.data();
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
        createdAt: tsToMillis(data.createdAt),
      };
    });
    // Sort client-side ascending by createdAt
    results.sort((a, b) => a.createdAt - b.createdAt);
    return results;
  } catch (e) {
    console.error('[Comments] Failed to fetch:', e);
    return [];
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

/* ── AI Messaging Helper ──────────────────────────────────────────────────── */

/**
 * Generates a smart AI-like reply based on the last 10 messages in a chat.
 * This is a keyword-matching placeholder that can be replaced with a real
 * AI API (e.g. OpenAI, Gemini) later.
 */
export async function generateAIReply(chatId: string, lastMessage: string): Promise<string | null> {
  try {
    // 1. Read the last 10 messages from the chat (ordered by createdAt desc)
    const snapshot = await firestore()
      .collection('chats')
      .doc(chatId)
      .collection('messages')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    if (snapshot.empty) return null;

    // 2. Build a simple context string from recent messages
    const messages = snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        senderId: data.senderId || '',
        content: data.content || '',
        createdAt: tsToMillis(data.createdAt),
      };
    });

    // Reverse so oldest is first for context building
    messages.reverse();

    const contextSummary = messages
      .map(m => `${m.senderId === currentUser()?.uid ? 'You' : 'Customer'}: ${m.content}`)
      .join('\n');

    console.log('[AI Reply] Context:\n', contextSummary);

    // 3. Keyword-based smart response matching
    const lower = lastMessage.toLowerCase();

    if (/price|cost|how much|pricing|rate|quote/i.test(lower)) {
      return 'Our team will get back to you with pricing details shortly. Thank you for your interest!';
    }
    if (/\bhello\b|\bhi\b|\bhey\b|\bgreetings\b|\byo\b/i.test(lower)) {
      return 'Hello! Welcome to our store. How can I help you today?';
    }
    if (/\border\b|\bshipping\b|\bdelivery\b|\btrack\b|\bshipment\b/i.test(lower)) {
      return 'Your order is being processed. You\'ll receive tracking details via email shortly.';
    }
    if (/\breturn\b|\brefund\b|\bexchange\b|\bmoney back\b|\bcancel order\b/i.test(lower)) {
      return 'Our return policy allows returns within 7 days. Please share your order ID and we\'ll assist you.';
    }
    if (/\bthank/i.test(lower)) {
      return 'You\'re welcome! Feel free to reach out anytime. We\'re happy to help!';
    }
    if (/\bsorry\b|\bapologize\b|\bproblem\b|\bissue\b|\bwrong\b/i.test(lower)) {
      return 'We\'re sorry for the inconvenience. Our team is looking into this and will resolve it as soon as possible.';
    }

    // Default fallback
    return 'Thank you for your message. Our team will respond shortly during business hours.';
  } catch (e) {
    console.error('[AI Reply] Failed to generate reply:', e);
    return null;
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
      const lastFollowUpAt = leadData.lastFollowUpAt
        ? tsToMillis(leadData.lastFollowUpAt)
        : 0;

      // Only process leads whose last follow-up is older than 24 hours (or never)
      if (lastFollowUpAt > twentyFourHoursAgo) continue;

      const leadName = leadData.name || leadData.companyName || 'Lead';
      const statusLabel = leadData.status === 'new' ? 'new' : 'contacted';

      console.log(`[Follow-up] Sending auto follow-up for lead ${leadId} (${leadName}, status: ${statusLabel})`);

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

    console.log(`[Follow-up] Processed ${allLeads.length} leads for user ${userId}`);
  } catch (e) {
    console.error('[Follow-up] checkAndSendFollowUps error:', e);
  }
}
