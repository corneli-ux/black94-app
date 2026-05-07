import React, { useEffect, useState, useCallback, useRef, memo } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, ScrollView, Alert, Share, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { fetchUserProfile, toggleFollow, checkFollowing, toggleLike, toggleBookmark, toggleRepost, Post, User, tsToMillis, parseMediaUrls } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import Svg, { Path, Polyline } from 'react-native-svg';

/* ── Panda image for @black94's post fallback ──────────────────────────── */
const pandaImage = require('../../../assets/panda-post.png');

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
  postCaption: string;
  postAuthorUsername: string;
  postAuthorDisplayName: string;
  content: string;
  authorUsername: string;
  authorDisplayName: string;
  authorProfileImage: string;
  authorIsVerified: boolean;
  authorBadge: string;
  createdAt: number;
}

/* ── Hashtag/Mention Highlighted Text ────────────────────────────────── */
function HighlightedCaption({ text, style }: { text: string; style: any }) {
  const parts = text.split(/(#\w+|@\w+)/g);
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        /^#[\w]+$/.test(part) || /^@[\w]+$/.test(part) ? (
          <Text key={i} style={{ color: '#FFFFFF' }}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
}

function formatCount(n: number | undefined): string {
  if (!n) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

/* ── Feed-style PostCard for profile (fully interactive, matches FeedScreen PostCard) ── */
const ProfilePostCard = memo(function ProfilePostCard({ post, onLike, onBookmark, onDelete, onRepost, onComment, navigation }: {
  post: Post;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onDelete: (id: string) => void;
  onRepost: (id: string, reposted: boolean) => void;
  onComment: (id: string, caption?: string) => void;
  navigation: any;
}) {
  const currentUser = auth()?.currentUser;
  const [showHeart, setShowHeart] = useState(false);
  const lastTapRef = useRef(0);
  const [isReposted, setIsReposted] = useState(post.reposted);
  const [localRepostCount, setLocalRepostCount] = useState(post.repostCount);
  const [isBookmarked, setIsBookmarked] = useState(post.bookmarked);

  React.useEffect(() => {
    setIsReposted(post.reposted);
    setLocalRepostCount(post.repostCount);
    setIsBookmarked(post.bookmarked);
  }, [post.reposted, post.repostCount, post.bookmarked]);

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (!post.liked) { onLike(post.id, post.liked); }
      setShowHeart(true);
      setTimeout(() => setShowHeart(false), 900);
    }
    lastTapRef.current = now;
  };

  const handleRepostPress = () => {
    const next = !isReposted;
    setIsReposted(next);
    setLocalRepostCount(prev => prev + (next ? 1 : -1));
    onRepost(post.id, isReposted);
  };

  const handleBookmarkPress = () => {
    const next = !isBookmarked;
    setIsBookmarked(next);
    onBookmark(post.id, isBookmarked);
  };

  const handleShare = async () => {
    try { await Share.share({ message: 'Check out this post on Black94!' }); } catch {}
  };

  const isOwnPost = currentUser?.uid === post.authorId;

  return (
    <View style={profileCardStyles.postCard}>
      {/* Content row: avatar + content */}
      <View style={profileCardStyles.contentRow}>
        <TouchableOpacity onPress={() => {
              if (post.authorId !== currentUser?.uid) {
                navigation.navigate('UserProfile', { userId: post.authorId });
              } else {
                navigation.navigate('ProfileSelf');
              }
            }} activeOpacity={0.7} hitSlop={8}>
              <Avatar uri={post.authorProfileImage} name={post.authorDisplayName} size={40} />
            </TouchableOpacity>
        <TouchableOpacity style={profileCardStyles.contentColumn} activeOpacity={0.7} onPress={() => navigation.navigate('PostComments', { postId: post.id, postCaption: post.caption, postAuthorUsername: post.authorUsername, postAuthorDisplayName: post.authorDisplayName })}>
          <View style={profileCardStyles.headerRow}>
            <TouchableOpacity onPress={() => {
              if (post.authorId !== currentUser?.uid) {
                navigation.navigate('UserProfile', { userId: post.authorId });
              } else {
                navigation.navigate('ProfileSelf');
              }
            }} activeOpacity={0.7} style={profileCardStyles.headerNameRow}>
              <Text style={profileCardStyles.displayName} numberOfLines={1}>
                {post.authorDisplayName || post.authorUsername || 'User'}
              </Text>
              <VerifiedBadge badge={post.authorBadge} isVerified={post.authorIsVerified} size={16} />
              <Text style={profileCardStyles.username}>@{post.authorUsername || 'user'}</Text>
              <Text style={profileCardStyles.dot}>·</Text>
              <Text style={profileCardStyles.time}>{timeAgo(post.createdAt)}</Text>
            </TouchableOpacity>
            {isOwnPost && (
              <TouchableOpacity
                style={profileCardStyles.moreBtn}
                onPress={() => Alert.alert('Delete Post', 'Are you sure you want to delete this post?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => onDelete(post.id) },
                ])}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color="#94a3b8" />
              </TouchableOpacity>
            )}
          </View>
          {post.caption ? <HighlightedCaption text={post.caption} style={profileCardStyles.caption} /> : null}
          {(post.mediaUrls?.length > 0 || (post.caption?.toLowerCase().includes('panda') && post.authorUsername === 'black94')) && (
            <TouchableOpacity activeOpacity={0.95} onPress={handleDoubleTap}>
              <View style={profileCardStyles.mediaContainer}>
                <Image source={post.mediaUrls?.length > 0
                  ? { uri: post.mediaUrls[0] }
                  : pandaImage} style={profileCardStyles.media} resizeMode="cover" />
              </View>
            </TouchableOpacity>
          )}
          {/* Action bar — exact match to FeedScreen PostCard */}
          <View style={profileCardStyles.actions}>
            {/* Comment */}
            <TouchableOpacity style={profileCardStyles.actionBtn} onPress={() => onComment(post.id, post.caption)}>
              <View style={profileCardStyles.actionIconWrap}>
                <Ionicons name="chatbubble-outline" size={18} color="#94a3b8" />
              </View>
              {formatCount(post.commentCount) ? <Text style={profileCardStyles.actionCount}>{formatCount(post.commentCount)}</Text> : null}
            </TouchableOpacity>
            {/* Repost */}
            <TouchableOpacity style={profileCardStyles.actionBtn} onPress={handleRepostPress}>
              <View style={profileCardStyles.actionIconWrap}>
                <RepostIcon size={18} color={isReposted ? '#00ba7c' : '#94a3b8'} />
              </View>
              {localRepostCount > 0 ? <Text style={[profileCardStyles.actionCount, isReposted && { color: '#00ba7c' }]}>{localRepostCount}</Text> : null}
            </TouchableOpacity>
            {/* Like */}
            <TouchableOpacity style={profileCardStyles.actionBtn} onPress={() => onLike(post.id, post.liked)}>
              <View style={profileCardStyles.actionIconWrap}>
                {post.liked ? (
                  <Ionicons name="heart" size={18} color="#f43f5e" />
                ) : (
                  <Ionicons name="heart-outline" size={18} color="#94a3b8" />
                )}
              </View>
              {post.likeCount > 0 ? <Text style={[profileCardStyles.actionCount, post.liked && { color: '#f43f5e' }]}>{post.likeCount}</Text> : null}
            </TouchableOpacity>
            {/* Views */}
            <TouchableOpacity style={profileCardStyles.actionBtn} disabled>
              <View style={profileCardStyles.actionIconWrap}>
                <Ionicons name="trending-up-outline" size={18} color="#94a3b8" />
              </View>
            </TouchableOpacity>
            {/* Bookmark + Share */}
            <View style={profileCardStyles.actionPair}>
              <TouchableOpacity style={profileCardStyles.actionBtn} onPress={handleBookmarkPress}>
                <View style={profileCardStyles.actionIconWrap}>
                  {isBookmarked ? (
                    <Ionicons name="bookmark" size={18} color={colors.bookmark} />
                  ) : (
                    <Ionicons name="bookmark-outline" size={18} color="#94a3b8" />
                  )}
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={profileCardStyles.actionBtn} onPress={handleShare}>
                <View style={profileCardStyles.actionIconWrap}>
                  <Ionicons name="share-outline" size={18} color="#94a3b8" />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </View>
      {/* Double-tap heart overlay */}
      {showHeart && (
        <View style={profileCardStyles.heartOverlay} pointerEvents="none">
          <Ionicons name="heart" size={80} color="rgba(249,24,128,0.85)" />
        </View>
      )}
    </View>
  );
});

const { width: SCREEN_W } = Dimensions.get('window');

const profileCardStyles = StyleSheet.create({
  postCard: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  contentRow: { flexDirection: 'row', gap: 12 },
  contentColumn: { flex: 1, minWidth: 0, position: 'relative' },
  headerRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerNameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    flex: 1, flexWrap: 'nowrap', overflow: 'hidden',
  },
  moreBtn: {
    position: 'absolute',
    top: 0,
    right: -8,
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 16,
  },
  displayName: { color: '#e7e9ea', fontWeight: '700', fontSize: 15, lineHeight: 20 },
  username: { color: '#71767b', fontSize: 15, lineHeight: 20 },
  dot: { color: '#71767b', fontSize: 15, lineHeight: 20 },
  time: { color: '#71767b', fontSize: 15, lineHeight: 20 },
  caption: { color: '#e7e9ea', fontSize: 15, lineHeight: 20, marginTop: 4 },
  mediaContainer: {
    marginTop: 12, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  media: { width: '100%', height: Math.min(SCREEN_W * 0.85, 510), backgroundColor: '#111' },
  actions: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 8, marginLeft: -4, maxWidth: 440,
    justifyContent: 'space-between',
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actionPair: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  actionIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  actionCount: { color: '#71767b', fontSize: 13, lineHeight: 16, marginLeft: 1 },
  heartOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  replyingTo: {
    color: '#71767b',
    fontSize: 13,
    marginTop: 2,
  },
  replyingToName: {
    color: '#3b82f6',
  },
  replyContextCaption: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
});

function PostGrid({ posts, navigation, onLike, onBookmark, onDelete, onRepost, onComment }: {
  posts: Post[]; navigation: any;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onDelete: (id: string) => void;
  onRepost: (id: string, reposted: boolean) => void;
  onComment: (id: string, caption?: string) => void;
}) {
  if (posts.length === 0) return (
    <View style={{ alignItems: 'center', paddingTop: 60 }}>
      <Text style={{ color: '#94a3b8', fontSize: 15 }}>No posts yet</Text>
    </View>
  );
  return (
    <View>
      {posts.map(post => (
        <ProfilePostCard key={post.id} post={post} onLike={onLike} onBookmark={onBookmark} onDelete={onDelete} onRepost={onRepost} onComment={onComment} navigation={navigation} />
      ))}
    </View>
  );
}

function RepliesList({ replies, navigation }: { replies: Reply[]; navigation: any }) {
  const [likeMap, setLikeMap] = useState<Record<string, boolean>>({});
  const [repostMap, setRepostMap] = useState<Record<string, boolean>>({});
  const [bookmarkMap, setBookmarkMap] = useState<Record<string, boolean>>({});

  // Filter out self-replies (user replying to their own post)
  const filteredReplies = replies.filter(r =>
    r.authorUsername.toLowerCase() !== r.postAuthorUsername.toLowerCase()
  );

  if (filteredReplies.length === 0) return (
    <View style={{ alignItems: 'center', paddingTop: 60 }}>
      <Ionicons name="chatbubble-outline" size={48} color="#64748b" style={{ marginBottom: 12 }} />
      <Text style={{ color: '#94a3b8', fontSize: 15 }}>No replies yet</Text>
    </View>
  );
  return (
    <View>
      {filteredReplies.map(reply => {
        const isSelfReply = reply.authorUsername.toLowerCase() === reply.postAuthorUsername.toLowerCase();
        return (
        <View key={reply.id} style={profileCardStyles.postCard}>
          <View style={profileCardStyles.contentRow}>
            <Avatar uri={reply.authorProfileImage || null} name={reply.authorDisplayName || reply.authorUsername} size={40} />
            <View style={profileCardStyles.contentColumn}>
              <View style={profileCardStyles.headerNameRow}>
                <Text style={profileCardStyles.displayName} numberOfLines={1}>
                  {reply.authorDisplayName || reply.authorUsername}
                </Text>
                <VerifiedBadge badge={reply.authorBadge} isVerified={reply.authorIsVerified} size={16} />
                <Text style={profileCardStyles.username}>@{reply.authorUsername}</Text>
                <Text style={profileCardStyles.dot}>·</Text>
                <Text style={profileCardStyles.time}>{timeAgo(reply.createdAt)}</Text>
              </View>
              {!isSelfReply && (
                <Text style={profileCardStyles.replyingTo}>
                  Replying to <Text style={profileCardStyles.replyingToName}>@{reply.postAuthorUsername}</Text>
                </Text>
              )}
              <Text style={profileCardStyles.caption}>{reply.content}</Text>
              <View style={profileCardStyles.actions}>
                <TouchableOpacity style={profileCardStyles.actionBtn} onPress={() => navigation.navigate('PostComments', { postId: reply.postId, postCaption: reply.postCaption })}>
                  <View style={profileCardStyles.actionIconWrap}>
                    <Ionicons name="chatbubble-outline" size={18} color="#94a3b8" />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={profileCardStyles.actionBtn} onPress={() => setRepostMap(prev => ({ ...prev, [reply.id]: !prev[reply.id] }))}>
                  <View style={profileCardStyles.actionIconWrap}>
                    <RepostIcon size={18} color={repostMap[reply.id] ? '#00ba7c' : '#94a3b8'} />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={profileCardStyles.actionBtn} onPress={() => setLikeMap(prev => ({ ...prev, [reply.id]: !prev[reply.id] }))}>
                  <View style={profileCardStyles.actionIconWrap}>
                    <Ionicons name={likeMap[reply.id] ? 'heart' : 'heart-outline'} size={18} color={likeMap[reply.id] ? '#f43f5e' : '#94a3b8'} />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={profileCardStyles.actionBtn}>
                  <View style={profileCardStyles.actionIconWrap}>
                    <Ionicons name="trending-up-outline" size={18} color="#94a3b8" />
                  </View>
                </TouchableOpacity>
                <View style={profileCardStyles.actionPair}>
                  <TouchableOpacity style={profileCardStyles.actionBtn} onPress={() => setBookmarkMap(prev => ({ ...prev, [reply.id]: !prev[reply.id] }))}>
                    <View style={profileCardStyles.actionIconWrap}>
                      <Ionicons name={bookmarkMap[reply.id] ? 'bookmark' : 'bookmark-outline'} size={18} color={bookmarkMap[reply.id] ? colors.bookmark : '#94a3b8'} />
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity style={profileCardStyles.actionBtn}>
                    <View style={profileCardStyles.actionIconWrap}>
                      <Ionicons name="share-outline" size={18} color="#94a3b8" />
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </View>
      );
    })}
    </View>
  );
}

function LikedPostsGrid({ posts, navigation, onLike, onBookmark, onDelete, onRepost, onComment }: {
  posts: Post[]; navigation: any;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onDelete: (id: string) => void;
  onRepost: (id: string, reposted: boolean) => void;
  onComment: (id: string, caption?: string) => void;
}) {
  if (posts.length === 0) return (
    <View style={{ alignItems: 'center', paddingTop: 60 }}>
      <Ionicons name="heart-outline" size={48} color="#64748b" style={{ marginBottom: 12 }} />
      <Text style={{ color: '#94a3b8', fontSize: 15 }}>No liked posts yet</Text>
    </View>
  );
  return <PostGrid posts={posts} navigation={navigation} onLike={onLike} onBookmark={onBookmark} onDelete={onDelete} onRepost={onRepost} onComment={onComment} />;
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
  const [interactionsChecked, setInteractionsChecked] = useState(false);

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

      // Batch check interactions for current user's posts
      if (currentUser?.uid && ps.length > 0) {
        const postIds = ps.map(p => p.id);
        const likedIds = new Set<string>();
        const bookmarkedIds = new Set<string>();
        const repostedIds = new Set<string>();

        // Check interactions in chunks of 30
        for (let i = 0; i < postIds.length; i += 30) {
          const chunk = postIds.slice(i, i + 30);
          try {
            const promises = chunk.flatMap(postId => [
              firestore().collection('post_likes').doc(`${postId}_${currentUser.uid}`).get()
                .then(snap => { if (snap.exists) likedIds.add(postId); }).catch(() => {}),
              firestore().collection('post_bookmarks').doc(`${postId}_${currentUser.uid}`).get()
                .then(snap => { if (snap.exists) bookmarkedIds.add(postId); }).catch(() => {}),
              firestore().collection('post_reposts').doc(`${postId}_${currentUser.uid}`).get()
                .then(snap => { if (snap.exists) repostedIds.add(postId); }).catch(() => {}),
            ]);
            await Promise.all(promises);
          } catch (e) {
            console.warn('[Profile] Interaction check failed:', e);
          }
        }

        for (const post of ps) {
          post.liked = likedIds.has(post.id);
          post.bookmarked = bookmarkedIds.has(post.id);
          post.reposted = repostedIds.has(post.id);
        }
        setPosts([...ps]); // trigger re-render
        setInteractionsChecked(true);
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
        const replyList: Reply[] = [];
        for (const d of snap.docs) {
          const data = d.data();
          const postId = data.postId || '';
          let postCaption = '';
          let postAuthorUsername = '';
          let postAuthorDisplayName = '';
          if (postId) {
            try {
              const postSnap = await firestore().collection('posts').doc(postId).get();
              if (postSnap.exists) {
                const pd = postSnap.data();
                postCaption = pd.caption || '';
                postAuthorUsername = pd.authorUsername || '';
                postAuthorDisplayName = pd.authorDisplayName || '';
              }
            } catch { /* skip if post not found */ }
          }
          replyList.push({
            id: d.id,
            postId,
            postCaption,
            postAuthorUsername,
            postAuthorDisplayName,
            content: data.content || '',
            authorUsername: data.authorUsername || '',
            authorDisplayName: data.authorDisplayName || '',
            authorProfileImage: data.authorProfileImage || '',
            authorIsVerified: data.authorIsVerified || false,
            authorBadge: data.authorBadge || '',
            createdAt: tsToMillis(data.createdAt),
          });
        }
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

  const handleLike = async (postId: string, liked: boolean) => {
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, liked: !liked, likeCount: p.likeCount + (liked ? -1 : 1) }
      : p));
    try { await toggleLike(postId, liked); } catch {}
  };

  const handleBookmark = async (postId: string, bookmarked: boolean) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, bookmarked: !bookmarked } : p));
    try { await toggleBookmark(postId, bookmarked); } catch {}
  };

  const handleRepost = async (postId: string, reposted: boolean) => {
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, reposted: !reposted, repostCount: p.repostCount + (reposted ? -1 : 1) }
      : p));
    try { await toggleRepost(postId, reposted); } catch {}
  };

  const handleComment = (postId: string, caption?: string, authorUsername?: string, authorDisplayName?: string) => {
    navigation.navigate('PostComments', { postId, postCaption: caption || '', postAuthorUsername: authorUsername || '', postAuthorDisplayName: authorDisplayName || '' });
  };

  const handleDelete = async (postId: string) => {
    try {
      await firestore().collection('posts').doc(postId).delete();
      setPosts(prev => prev.filter(p => p.id !== postId));
    } catch {
      Alert.alert('Error', 'Failed to delete post');
    }
  };

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
              <Text style={styles.statNum}>{formatCount(followingCount)}</Text> Following
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Followers' as never, { targetUserId, mode: 'followers' } as never)}>
            <Text style={styles.statText}>
              <Text style={styles.statNum}>{formatCount(followersCount)}</Text> Followers
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
      ) : tab === 'posts' && <PostGrid posts={posts} navigation={navigation} onLike={handleLike} onBookmark={handleBookmark} onDelete={handleDelete} onRepost={handleRepost} onComment={handleComment} />}
      {tab === 'replies' && <RepliesList replies={replies} navigation={navigation} />}
      {tab === 'likes' && <LikedPostsGrid posts={likedPosts} navigation={navigation} onLike={handleLike} onBookmark={handleBookmark} onDelete={handleDelete} onRepost={handleRepost} onComment={handleComment} />}
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
