import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { fetchUserProfile, toggleFollow, checkFollowing, Post, User, tsToMillis, parseMediaUrls } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import Svg, { Path, Polyline } from 'react-native-svg';

/* ── Repost Icon (matches web app SVG exactly) ──────────────────────────── */
function RepostIcon({ size = 16, color = '#71767b' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="23 4 23 10 17 10" />
      <Path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </Svg>
  );
}


/* ── Replies type ──────────────────────────────────────────────── */
interface Reply {
  id: string;
  postId: string;
  content: string;
  authorUsername: string;
  authorDisplayName: string;
  authorProfileImage: string;
  authorIsVerified: boolean;
  authorBadge: string;
  createdAt: number;
}

/* ── Feed-style PostCard for profile (matches FeedScreen PostCard) ── */
function ProfilePostCard({ post, navigation }: { post: Post; navigation: any }) {
  const currentUser = auth()?.currentUser;

  return (
    <TouchableOpacity
      style={profileCardStyles.postCard}
      activeOpacity={0.95}
      onPress={() => navigation.navigate('UserProfile', { userId: post.authorId })}
    >
      {/* Content row: avatar + content */}
      <View style={profileCardStyles.contentRow}>
        <Avatar uri={post.authorProfileImage} name={post.authorDisplayName} size={44} />
        <View style={profileCardStyles.contentColumn}>
          <View style={profileCardStyles.headerNameRow}>
            <Text style={profileCardStyles.displayName} numberOfLines={1}>
              {post.authorDisplayName || post.authorUsername || 'User'}
            </Text>
            <VerifiedBadge badge={post.authorBadge} isVerified={post.authorIsVerified} size={16} />
            <Text style={profileCardStyles.username}>@{post.authorUsername || 'user'}</Text>
            <Text style={profileCardStyles.dot}>·</Text>
            <Text style={profileCardStyles.time}>{timeAgo(post.createdAt)}</Text>
          </View>
          {post.caption ? <Text style={profileCardStyles.caption}>{post.caption}</Text> : null}
          {post.mediaUrls?.length > 0 && (
            <View style={profileCardStyles.mediaContainer}>
              <Image source={{ uri: post.mediaUrls[0] }} style={profileCardStyles.media} resizeMode="cover" />
            </View>
          )}
          {/* Action bar */}
          <View style={profileCardStyles.actions}>
            <View style={profileCardStyles.actionBtn}>
              <Ionicons name="chatbubble-outline" size={16} color="#71767b" />
              {post.commentCount > 0 && <Text style={profileCardStyles.actionCount}>{post.commentCount}</Text>}
            </View>
            <View style={profileCardStyles.actionBtn}>
              <RepostIcon size={16} color="#71767b" />
              {post.repostCount > 0 && <Text style={profileCardStyles.actionCount}>{post.repostCount}</Text>}
            </View>
            <View style={profileCardStyles.actionBtn}>
              <Ionicons name="heart-outline" size={16} color="#71767b" />
              {post.likeCount > 0 && <Text style={profileCardStyles.actionCount}>{post.likeCount}</Text>}
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const profileCardStyles = StyleSheet.create({
  postCard: {
    backgroundColor: '#000000',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  contentRow: { flexDirection: 'row', gap: 10 },
  contentColumn: { flex: 1, minWidth: 0 },
  headerNameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    flex: 1, flexWrap: 'nowrap', overflow: 'hidden',
  },
  displayName: { color: '#e7e9ea', fontWeight: '700', fontSize: 15 },
  username: { color: '#94a3b8', fontSize: 14 },
  dot: { color: '#94a3b8', fontSize: 14 },
  time: { color: '#94a3b8', fontSize: 14 },
  caption: { color: '#e7e9ea', fontSize: 15, lineHeight: 20, marginTop: 2 },
  mediaContainer: {
    marginTop: 10, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  media: { width: '100%', height: 200, backgroundColor: '#111' },
  actions: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 10, marginLeft: -4, gap: 40,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  actionCount: { color: '#71767b', fontSize: 13 },
});

function PostGrid({ posts, navigation }: { posts: Post[]; navigation: any }) {
  if (posts.length === 0) return (
    <View style={{ alignItems: 'center', paddingTop: 60 }}>
      <Text style={{ color: '#94a3b8', fontSize: 15 }}>No posts yet</Text>
    </View>
  );
  return (
    <View>
      {posts.map(post => (
        <ProfilePostCard key={post.id} post={post} navigation={navigation} />
      ))}
    </View>
  );
}

function RepliesList({ replies, navigation }: { replies: Reply[]; navigation: any }) {
  if (replies.length === 0) return (
    <View style={{ alignItems: 'center', paddingTop: 60 }}>
      <Ionicons name="chatbubble-outline" size={48} color="#64748b" style={{ marginBottom: 12 }} />
      <Text style={{ color: '#94a3b8', fontSize: 15 }}>No replies yet</Text>
    </View>
  );
  return (
    <View>
      {replies.map(reply => (
        <View key={reply.id} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Avatar uri={reply.authorProfileImage || null} name={reply.authorDisplayName || reply.authorUsername} size={32} />
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#e7e9ea' }} numberOfLines={1}>
                {reply.authorDisplayName || reply.authorUsername}
              </Text>
              <Text style={{ fontSize: 13, color: '#94a3b8' }}>@{reply.authorUsername}</Text>
            </View>
            <Text style={{ fontSize: 13, color: '#64748b' }}>{timeAgo(reply.createdAt)}</Text>
          </View>
          <Text style={{ fontSize: 14, color: '#e7e9ea', lineHeight: 20, paddingLeft: 40 }}>{reply.content}</Text>
        </View>
      ))}
    </View>
  );
}

function LikedPostsGrid({ posts, navigation }: { posts: Post[]; navigation: any }) {
  if (posts.length === 0) return (
    <View style={{ alignItems: 'center', paddingTop: 60 }}>
      <Ionicons name="heart-outline" size={48} color="#64748b" style={{ marginBottom: 12 }} />
      <Text style={{ color: '#94a3b8', fontSize: 15 }}>No liked posts yet</Text>
    </View>
  );
  return <PostGrid posts={posts} navigation={navigation} />;
}

export default function ProfileScreen({ route, navigation }: any) {
  const currentUser = auth()?.currentUser;
  const targetUserId = route?.params?.userId || currentUser?.uid;
  const isOwnProfile = targetUserId === currentUser?.uid;

  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);
  const [following, setFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [tab, setTab] = useState<'posts' | 'replies' | 'likes' | 'store'>('posts');
  const [likedPosts, setLikedPosts] = useState<Post[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [messaging, setMessaging] = useState(false);

  const isBusinessAccount = user?.role === 'business';
  const showStoreTab = isBusinessAccount;

  const tabs: Array<'posts' | 'replies' | 'likes' | 'store'> = showStoreTab
    ? ['posts', 'store', 'likes']
    : ['posts', 'replies', 'likes'];

  const load = useCallback(async () => {
    try {
      console.log('[ProfileScreen] Loading profile for:', targetUserId);
      const [u, feed, isFollowing, followersSnap, followingSnap] = await Promise.all([
        fetchUserProfile(targetUserId),
        // NOTE: No .orderBy('createdAt', 'desc') here — that composite index may
        // not exist in Firestore. Query without orderBy, then sort client-side
        // (same strategy as web's fetchUserPostsNoIndex in social.ts).
        firestore().collection('posts').where('authorId', '==', targetUserId).limit(50).get(),
        isOwnProfile ? Promise.resolve(false) : checkFollowing(targetUserId),
        firestore().collection('follows').where('followingId', '==', targetUserId).get(),
        firestore().collection('follows').where('followerId', '==', targetUserId).get(),
      ]);
      console.log(`[ProfileScreen] Got user: ${u?.displayName || 'null'}, posts: ${feed.docs.length}, followers: ${followersSnap.size}, following: ${followingSnap.size}`);
      setUser(u);
      setFollowing(isFollowing);
      setFollowersCount(followersSnap.size);
      setFollowingCount(followingSnap.size);

      const ps: Post[] = feed.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, authorId: data.authorId || '', authorUsername: data.authorUsername || '',
          authorDisplayName: data.authorDisplayName || '', authorProfileImage: data.authorProfileImage || null,
          authorBadge: data.authorBadge || '', authorIsVerified: data.authorIsVerified || false,
          caption: data.caption || '', mediaUrls: parseMediaUrls(data.mediaUrls),
          likeCount: data.likeCount || 0, commentCount: data.commentCount || 0,
          repostCount: data.repostCount || 0, liked: false, bookmarked: false, reposted: false,
          createdAt: tsToMillis(data.createdAt),
        };
      });
      // Sort client-side by createdAt descending (avoids composite index requirement)
      ps.sort((a, b) => b.createdAt - a.createdAt);
      setPosts(ps);
    } catch (e: any) {
      console.error('[ProfileScreen] Load error:', e?.message);
      Alert.alert('Profile Error', `Could not load profile: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [targetUserId]);

  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    setCanRefresh(offset <= 0);
  }, []);

  useEffect(() => { load(); }, []);

  // Load replies when replies tab is active
  useEffect(() => {
    if (tab !== 'replies' || !targetUserId) return;
    setTabLoading(true);
    (async () => {
      try {
        const snap = await firestore()
          .collection('post_comments')
          .where('authorId', '==', targetUserId)
          .limit(30)
          .get();
        const replyList: Reply[] = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            postId: data.postId || '',
            content: data.content || '',
            authorUsername: data.authorUsername || '',
            authorDisplayName: data.authorDisplayName || '',
            authorProfileImage: data.authorProfileImage || '',
            authorIsVerified: data.authorIsVerified || false,
            authorBadge: data.authorBadge || '',
            createdAt: tsToMillis(data.createdAt),
          };
        });
        // Sort client-side to avoid composite index requirement
        replyList.sort((a, b) => b.createdAt - a.createdAt);
        setReplies(replyList);
      } catch (e: any) {
        console.error('[ProfileScreen] Failed to load replies:', e?.message);
        setReplies([]);
      } finally {
        setTabLoading(false);
      }
    })();
  }, [tab, targetUserId]);

  // Load liked posts when likes tab is active
  useEffect(() => {
    if (tab !== 'likes' || !targetUserId) return;
    setTabLoading(true);
    (async () => {
      try {
        const likesSnap = await firestore()
          .collection('post_likes')
          .where('userId', '==', targetUserId)
          .limit(20)
          .get();

        if (likesSnap.empty) {
          setLikedPosts([]);
          setTabLoading(false);
          return;
        }

        const postIds = [...new Set(likesSnap.docs.map(d => d.data().postId).filter(Boolean))];
        const allPosts: Post[] = [];

        for (const postId of postIds) {
          try {
            const postSnap = await firestore().collection('posts').doc(postId).get();
            if (postSnap.exists) {
              const data = postSnap.data();
              allPosts.push({
                id: postSnap.id, authorId: data.authorId || '', authorUsername: data.authorUsername || '',
                authorDisplayName: data.authorDisplayName || '', authorProfileImage: data.authorProfileImage || null,
                authorBadge: data.authorBadge || '', authorIsVerified: data.authorIsVerified || false,
                caption: data.caption || '', mediaUrls: parseMediaUrls(data.mediaUrls),
                likeCount: data.likeCount || 0, commentCount: data.commentCount || 0,
                repostCount: data.repostCount || 0, liked: true, bookmarked: false, reposted: false,
                createdAt: tsToMillis(data.createdAt),
              });
            }
          } catch { /* skip */ }
        }

        allPosts.sort((a, b) => b.createdAt - a.createdAt);
        setLikedPosts(allPosts);
      } catch (e: any) {
        console.error('[ProfileScreen] Failed to load liked posts:', e?.message);
        setLikedPosts([]);
      } finally {
        setTabLoading(false);
      }
    })();
  }, [tab, targetUserId]);

  const handleFollow = async () => {
    const newState = await toggleFollow(targetUserId, following);
    setFollowing(newState);
    setFollowersCount(c => c + (newState ? 1 : -1));
  };

  const handleMessage = async () => {
    if (!currentUser?.uid || messaging) return;
    setMessaging(true);
    try {
      // Try to find existing chat — use simple queries first to avoid composite index issues.
      // If both user1/user2 simple queries fail, fall back to searching user2 queries.
      const snap1 = await firestore().collection('chats').where('user1Id', '==', currentUser.uid).get();
      const existing = snap1.docs.find(d => d.data().user2Id === targetUserId);
      if (existing) {
        navigation.navigate('ChatRoom' as never, { chatId: existing.id } as never);
      } else {
        const snap2 = await firestore().collection('chats').where('user2Id', '==', currentUser.uid).get();
        const existing2 = snap2.docs.find(d => d.data().user1Id === targetUserId);
        if (existing2) {
          navigation.navigate('ChatRoom' as never, { chatId: existing2.id } as never);
        } else {
          const chatRef = await firestore().collection('chats').add({
            user1Id: currentUser.uid,
            user2Id: targetUserId,
            lastMessage: '',
            lastMessageTime: firestore.FieldValue.serverTimestamp(),
            unreadUser1: 0,
            unreadUser2: 0,
            createdAt: firestore.FieldValue.serverTimestamp(),
          });
          navigation.navigate('ChatRoom' as never, { chatId: chatRef.id } as never);
        }
      }
    } catch (e: any) {
      console.warn('[ProfileScreen] message error:', e);
    }
    setMessaging(false);
  };

  if (loading) return (
    <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );

  return (
    <ScrollView
      style={styles.container}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      refreshControl={<RefreshControl refreshing={refreshing && canRefresh} onRefresh={() => { if (canRefresh) { setRefreshing(true); load(); } }} tintColor={colors.accent} enabled={canRefresh} />}
      stickyHeaderIndices={[3]}
    >
      {/* Top bar */}
      <SafeAreaView edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.topLogo}>Profile</Text>
          {isOwnProfile ? (
            <TouchableOpacity onPress={() => navigation.navigate('EditProfile')} hitSlop={8}>
              <Ionicons name="settings-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 22 }} />
          )}
        </View>
      </SafeAreaView>

      {/* Cover */}
      <View style={styles.coverWrap}>
        {user?.coverImage ? (
          <Image source={{ uri: user.coverImage }} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]} />
        )}
      </View>

      {/* Avatar + Edit / Follow */}
      <View style={styles.avatarRow}>
        <View style={{ marginTop: -32 }}>
          <Avatar
            uri={user?.profileImage || currentUser?.photoURL}
            name={user?.displayName || null}
            size={80}
            borderWidth={4}
            borderColor="#000000"
          />
        </View>
        {isOwnProfile ? (
          <TouchableOpacity style={styles.editProfileBtn} onPress={() => navigation.navigate('EditProfile')}>
            <Text style={styles.editProfileBtnText}>Edit profile</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              style={[styles.followBtn, following && styles.followingBtn]}
              onPress={handleFollow}
            >
              <Text style={[styles.followBtnText, following && styles.followingBtnText]}>
                {following ? 'Following' : 'Follow'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.messageBtn}
              onPress={handleMessage}
              disabled={messaging}
            >
              {messaging ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="chatbubble-outline" size={18} color="#FFFFFF" />
              )}
              <Text style={styles.messageBtnText}>Message</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Name / Bio */}
      <View style={styles.bioSection}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.displayName}>{user?.displayName || 'User'}</Text>
          <VerifiedBadge badge={user?.badge} isVerified={user?.isVerified} size={20} />
        </View>
        <Text style={styles.handle}>@{user?.username}</Text>
        {user?.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
        <View style={styles.statsRow}>
          <TouchableOpacity onPress={() => navigation.navigate('Followers' as never, { targetUserId, mode: 'following' } as never)}>
            <Text style={styles.statText}>
              <Text style={styles.statNum}>{followingCount}</Text> Following
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Followers' as never, { targetUserId, mode: 'followers' } as never)}>
            <Text style={styles.statText}>
              <Text style={styles.statNum}>{followersCount}</Text> Followers
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {tabs.map(t => (
          <TouchableOpacity key={t} style={styles.tab} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
            {tab === t && <View style={styles.tabIndicator} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab Content */}
      {tabLoading ? (
        <View style={{ paddingTop: 40, alignItems: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : tab === 'posts' && <PostGrid posts={posts} navigation={navigation} />}
      {tab === 'replies' && <RepliesList replies={replies} navigation={navigation} />}
      {tab === 'likes' && <LikedPostsGrid posts={likedPosts} navigation={navigation} />}
      {tab === 'store' && (
        <View style={{ alignItems: 'center', paddingTop: 60 }}>
          <Ionicons name="storefront-outline" size={48} color="#94a3b8" style={{ marginBottom: 12 }} />
          <Text style={{ color: '#94a3b8', fontSize: 15 }}>No products listed yet</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10,
  },
  topLogo: { color: colors.text, fontSize: 18, fontWeight: '800' },
  /* Cover: h-32 = 128px */
  coverWrap: { height: 128, width: '100%', overflow: 'hidden', backgroundColor: '#000000' },
  cover: { width: '100%', height: '100%' },
  /* Fallback: gradient from-[#1a2a1a] to-[#110f1a] → simple solid */
  coverPlaceholder: { backgroundColor: '#110f1a' }, /* TODO: LinearGradient when expo-linear-gradient added */
  /* web: flex items-end justify-between px-5 -mt-8 mb-3 */
  avatarRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 20, marginTop: -32, marginBottom: 12,
  },
  /* Edit Profile button: px-5 py-1.5 rounded-full border border-[#64748b] text-[15px] font-bold text-[#e7e9ea] */
  editProfileBtn: {
    borderWidth: 1, borderColor: '#64748b', borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 6,
  },
  editProfileBtnText: { color: '#e7e9ea', fontWeight: '700', fontSize: 15 },
  /* Follow button (not following): bg-[#e7e9ea] text-black px-6 py-2 rounded-full text-[15px] font-bold */
  followBtn: {
    backgroundColor: '#e7e9ea', borderRadius: 999,
    paddingHorizontal: 24, paddingVertical: 8,
  },
  /* Follow button (following): border border-[#64748b] text-[#e7e9ea] */
  followingBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#64748b' },
  followBtnText: { color: '#000000', fontWeight: '700', fontSize: 15 },
  followingBtnText: { color: '#e7e9ea' },
  /* Message button: border border-[#FFFFFF]/40 text-[#FFFFFF] px-5 py-2 rounded-full text-[15px] font-bold */
  messageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 8,
  },
  messageBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  /* Bio section: px-5 pb-4 border-b border-white/[0.06] */
  bioSection: {
    paddingHorizontal: 20, paddingTop: 0, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  /* Name: text-xl font-bold text-[#e7e9ea] */
  displayName: { color: '#e7e9ea', fontSize: 20, fontWeight: '700' },
  /* Username: text-[15px] text-[#94a3b8] */
  handle: { color: '#94a3b8', fontSize: 15, marginTop: 2 },
  /* Bio: text-[15px] text-[#e7e9ea] mt-2 leading-relaxed (leading-relaxed = 1.625 → lineHeight 24.375) */
  bio: { color: '#e7e9ea', fontSize: 15, lineHeight: 24, marginTop: 8 },
  /* Stats: flex items-center gap-5 mt-4 text-[14px] */
  statsRow: { flexDirection: 'row', gap: 20, marginTop: 16 },
  statText: { color: '#94a3b8', fontSize: 14 },
  statNum: { color: '#e7e9ea', fontWeight: '700' },
  /* Tab bar: sticky, bg-[#000], border-b border-white/[0.06] */
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14, position: 'relative' as const },
  /* Active tab indicator: absolute bottom-0 inset-x-6 h-1 bg-[#FFFFFF] */
  tabIndicator: {
    position: 'absolute' as const,
    bottom: 0,
    left: 24,
    right: 24,
    height: 1,
    borderRadius: 0.5,
    backgroundColor: '#FFFFFF',
  },
  /* Tab text: text-[15px] font-medium, active: text-[#e7e9ea] font-bold, inactive: text-[#94a3b8] */
  tabText: { color: '#94a3b8', fontWeight: '500', fontSize: 15 },
  tabTextActive: { color: '#e7e9ea', fontWeight: '700' },
});
