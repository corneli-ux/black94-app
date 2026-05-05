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
        await userDocRef.set(userData);
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
      username: username,
      displayName: userData.displayName,
      bio: existingData?.bio || '',
      profileImage: userData.profileImage,
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
  const posts: Post[] = [];

  // Process like/bookmark/repost checks in batches of 5 to avoid overwhelming the API
  const BATCH_SIZE = 5;
  const CHECK_TIMEOUT = 5000;

  for (let i = 0; i < snapshot.docs.length; i += BATCH_SIZE) {
    const batch = snapshot.docs.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (docSnap) => {
        const data = docSnap.data();
        let liked = false;
        let bookmarked = false;
        let reposted = false;

        if (userId) {
          try {
            const checkPromise = Promise.all([
              firestore().collection('post_likes').doc(`${docSnap.id}_${userId}`).get(),
              firestore().collection('post_bookmarks').doc(`${docSnap.id}_${userId}`).get(),
              firestore().collection('post_reposts').doc(`${docSnap.id}_${userId}`).get(),
            ]);
            const [likeSnap, bookmarkSnap, repostSnap] = await Promise.race([
              checkPromise,
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT)),
            ]);
            liked = likeSnap.exists;
            bookmarked = bookmarkSnap.exists;
            reposted = repostSnap.exists;
          } catch {
            // Timeout or error — skip interaction status for this post
          }
        }

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
          liked,
          bookmarked,
          reposted,
          createdAt: tsToMillis(data.createdAt),
        };
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        posts.push(result.value);
      }
    }
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
    const chats: Chat[] = [];

    for (const docSnap of allDocs) {
      const data = docSnap.data();
      const otherId = data.user1Id === userId ? data.user2Id : data.user1Id;
      const isUser1 = data.user1Id === userId;
      const unreadCount = isUser1 ? (data.unreadUser1 || 0) : (data.unreadUser2 || 0);

      try {
        const otherSnap = await firestore().collection('users').doc(otherId).get();
        const otherData = otherSnap.data();
        chats.push({
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
        });
      } catch {}
    }

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
  return {
    id: userId,
    email: data?.email || '',
    username: data?.username || '',
    displayName: data?.displayName || '',
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
