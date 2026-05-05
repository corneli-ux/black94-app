import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, FlatList, StyleSheet, Dimensions, ActivityIndicator, RefreshControl, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { fetchUserProfile, toggleFollow, checkFollowing, Post, User, tsToMillis, parseMediaUrls } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';

const { width: SCREEN_W } = Dimensions.get('window');

function PostGrid({ posts, navigation }: { posts: Post[]; navigation: any }) {
  if (posts.length === 0) return (
    <View style={{ alignItems: 'center', paddingTop: 60 }}>
      <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No posts yet</Text>
    </View>
  );
  return (
    <View style={{ paddingHorizontal: 16 }}>
      {posts.map(post => (
        <TouchableOpacity key={post.id} style={styles.postRow}>
          <View style={styles.postRowInner}>
            <Text style={styles.postCaption} numberOfLines={3}>{post.caption}</Text>
            {post.mediaUrls?.length > 0 && (
              <Image source={{ uri: post.mediaUrls[0] }} style={styles.postThumb} />
            )}
          </View>
          <View style={styles.postStats}>
            <Text style={styles.postStat}>🤍 {post.likeCount}</Text>
            <Text style={styles.postStat}>💬 {post.commentCount}</Text>
            <Text style={styles.postStat}>🔁 {post.repostCount}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
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
  const [tab, setTab] = useState<'posts' | 'store' | 'bookmarks'>('posts');
  const [likedPosts, setLikedPosts] = useState<Post[]>([]);

  const load = useCallback(async () => {
    try {
      console.log('[ProfileScreen] Loading profile for:', targetUserId);
      const [u, feed, isFollowing, followersSnap, followingSnap] = await Promise.all([
        fetchUserProfile(targetUserId),
        firestore().collection('posts').where('authorId', '==', targetUserId).orderBy('createdAt', 'desc').limit(20).get(),
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
      setPosts(ps);

      // Load liked posts
      if (isOwnProfile) {
        const likesSnap = await firestore()
          .collection('post_bookmarks')
          .where('userId', '==', targetUserId)
          .limit(20).get();
        const liked: Post[] = [];
        for (const doc of likesSnap.docs) {
          const postId = doc.data().postId;
          if (postId) {
            const postSnap = await firestore().collection('posts').doc(postId).get();
            if (postSnap.exists) {
              const data = postSnap.data();
              liked.push({
                id: postSnap.id, authorId: data.authorId || '', authorUsername: data.authorUsername || '',
                authorDisplayName: data.authorDisplayName || '', authorProfileImage: data.authorProfileImage || null,
                authorBadge: data.authorBadge || '', authorIsVerified: data.authorIsVerified || false,
                caption: data.caption || '', mediaUrls: parseMediaUrls(data.mediaUrls),
                likeCount: data.likeCount || 0, commentCount: data.commentCount || 0,
                repostCount: data.repostCount || 0, liked: true, bookmarked: true, reposted: false,
                createdAt: tsToMillis(data.createdAt),
              });
            }
          }
        }
        setLikedPosts(liked);
      }
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

  const handleFollow = async () => {
    const newState = await toggleFollow(targetUserId, following);
    setFollowing(newState);
    setFollowersCount(c => c + (newState ? 1 : -1));
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
    >
      {/* Top bar */}
      <SafeAreaView edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.openDrawer()}>
            <Text style={{ color: colors.text, fontSize: 24 }}>☰</Text>
          </TouchableOpacity>
          <Text style={styles.topLogo}>Black94</Text>
          {isOwnProfile ? (
            <TouchableOpacity onPress={() => navigation.navigate('EditProfile')}>
              <Text style={{ color: colors.text, fontSize: 20 }}>⚙️</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 30 }} />
          )}
        </View>
      </SafeAreaView>

      {/* Cover */}
      <View style={styles.coverWrap}>
        {user?.coverImage ? (
          <Image source={{ uri: user.coverImage }} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Text style={{ color: 'rgba(255,255,255,0.08)', fontSize: 60, fontWeight: '800' }}>B94</Text>
          </View>
        )}
      </View>

      {/* Avatar + Edit / Follow */}
      <View style={styles.avatarRow}>
        <View style={{ marginTop: -32 }}>
          {/* web: PAvatar size={80} className="ring-4 ring-[#000000]" */}
          <Avatar uri={user?.profileImage || currentUser?.photoURL} size={80} borderWidth={4} borderColor={colors.bg} />
        </View>
        {isOwnProfile ? (
          <TouchableOpacity style={styles.editBtn} onPress={() => navigation.navigate('EditProfile')}>
            <Text style={styles.editBtnText}>Edit profile</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.editBtn, following && styles.followingBtn]}
            onPress={handleFollow}
          >
            <Text style={[styles.editBtnText, following && { color: colors.text }]}>
              {following ? 'Following' : 'Follow'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Name / Bio */}
      <View style={styles.bioSection}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.displayName}>{user?.displayName || 'User'}</Text>
          <VerifiedBadge badge={user?.badge} isVerified={user?.isVerified} />
        </View>
        <Text style={styles.handle}>@{user?.username}</Text>
        {user?.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
        <View style={styles.statsRow}>
          <TouchableOpacity>
            <Text style={styles.statText}><Text style={styles.statNum}>{followingCount}</Text> Following</Text>
          </TouchableOpacity>
          <TouchableOpacity>
            <Text style={styles.statText}><Text style={styles.statNum}>{followersCount}</Text> Followers</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['posts', 'store', 'bookmarks'] as const).map(t => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'posts' && <PostGrid posts={posts} navigation={navigation} />}
      {tab === 'store' && (
        <View style={{ alignItems: 'center', paddingTop: 60 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No store items yet</Text>
        </View>
      )}
      {tab === 'bookmarks' && (
        isOwnProfile ? (
          <PostGrid posts={likedPosts} navigation={navigation} />
        ) : (
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 15 }}>Only visible to the profile owner</Text>
          </View>
        )
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
  /* web: h-32 = 128px */
  coverWrap: { height: 128, width: '100%', overflow: 'hidden', backgroundColor: '#111' },
  cover: { width: '100%', height: '100%' },
  /* web: bg-gradient-to-br from-[#1a2a1a] to-[#110f1a] */
  coverPlaceholder: { backgroundColor: '#110f1a', alignItems: 'center', justifyContent: 'center' },
  /* web: flex items-end justify-between px-5 -mt-8 mb-3 */
  avatarRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: -32, marginBottom: 12 },
  /* web: px-5 py-1.5 rounded-full border border-[#64748b] text-[15px] font-bold text-[#e7e9ea] */
  editBtn: {
    borderWidth: 1, borderColor: '#64748b', borderRadius: 20,
    paddingHorizontal: 20, paddingVertical: 6,
  },
  followingBtn: { backgroundColor: 'transparent' },
  editBtnText: { color: '#e7e9ea', fontWeight: '700', fontSize: 15 },
  /* web: px-5 pb-4 border-b border-white/[0.06] */
  bioSection: { paddingHorizontal: 20, paddingTop: 0, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.separator },
  /* web: text-xl font-bold text-[#e7e9ea] */
  displayName: { color: '#e7e9ea', fontSize: 20, fontWeight: '700' },
  /* web: text-[15px] text-[#94a3b8] */
  handle: { color: '#94a3b8', fontSize: 15, marginTop: 2 },
  /* web: text-[15px] text-[#e7e9ea] mt-2 leading-relaxed */
  bio: { color: '#e7e9ea', fontSize: 15, lineHeight: 22, marginTop: 8 },
  /* web: flex items-center gap-5 mt-4 text-[14px] */
  statsRow: { flexDirection: 'row', gap: 20, marginTop: 16 },
  statText: { color: '#94a3b8', fontSize: 14 },
  statNum: { color: '#e7e9ea', fontWeight: '700' },
  /* web: flex py-3.5 text-[15px] font-medium border-b border-white/[0.06] */
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.separator },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#FFFFFF' },
  tabText: { color: '#94a3b8', fontWeight: '500', fontSize: 15 },
  tabTextActive: { color: '#e7e9ea', fontWeight: '700' },
  postRow: { paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  postRowInner: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  postCaption: { color: colors.text, fontSize: 14, flex: 1, lineHeight: 20 },
  postThumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: colors.surface },
  postStats: { flexDirection: 'row', gap: 16, marginTop: 8 },
  postStat: { color: colors.textSecondary, fontSize: 13 },
});
