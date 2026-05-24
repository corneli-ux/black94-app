import React, { useEffect, useState, useCallback, useRef, memo } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, ScrollView, Alert, Share, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { fetchUserProfile, toggleFollow, checkFollowing, toggleLike, toggleBookmark, toggleRepost, getUserDmPermission, getPaidChatPrice, hasPaidChatAccess, fetchActiveAdCampaigns, Post, User, tsToMillis, parseMediaUrls } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import FeedMedia from '../components/FeedMedia';
import Svg, { Path, Polyline } from 'react-native-svg';

/* ── Repost Icon (matches web app SVG exactly) ──────────────────────────── */
function RepostIcon({ size = 16, color = colors.textSecondary }: { size?: number; color?: string }) {
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
  postMediaUrls: string[];
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
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [captionTruncated, setCaptionTruncated] = useState(false);

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
        <TouchableOpacity style={profileCardStyles.contentColumn} activeOpacity={0.7} onPress={() => navigation.navigate('PostComments', { postId: post.repostOf || post.id, postCaption: post.caption, postAuthorUsername: post.authorUsername, postAuthorDisplayName: post.authorDisplayName })}>
          {/* Repost indicator */}
          {post.repostOf && (
            <View style={profileCardStyles.repostHeader}>
              <RepostIcon size={14} color={colors.textMuted} />
              <Text style={profileCardStyles.repostHeaderText}>
                {post.repostedByDisplayName || post.repostedByUsername || 'Someone'} reposted
              </Text>
            </View>
          )}
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
            {!post.repostOf && isOwnPost && (
              <TouchableOpacity
                style={profileCardStyles.moreBtn}
                onPress={() => Alert.alert('Delete Post', 'Are you sure you want to delete this post?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => onDelete(post.id) },
                ])}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          {post.caption ? (
            <View>
              <Text
                style={profileCardStyles.caption}
                numberOfLines={captionExpanded ? undefined : 3}
                onTextLayout={(e) => {
                  if (e.nativeEvent.lines.length > 3 && !captionTruncated) {
                    setCaptionTruncated(true);
                  }
                }}
              >
                {post.caption.split(/(#\w+|@\w+)/g).map((part, i) =>
                  /^#[\w]+$/.test(part) || /^@[\w]+$/.test(part) ? (
                    <Text key={i} style={{ color: colors.white }}>{part}</Text>
                  ) : (
                    <Text key={i}>{part}</Text>
                  )
                )}
              </Text>
              {captionTruncated && !captionExpanded && (
                <Text style={profileCardStyles.seeMore} onPress={() => setCaptionExpanded(true)}>See more</Text>
              )}
              {captionExpanded && captionTruncated && (
                <Text style={profileCardStyles.seeMore} onPress={() => setCaptionExpanded(false)}>See less</Text>
              )}
            </View>
          ) : null}
          {(post.mediaUrls?.length > 0) && (
            <TouchableOpacity activeOpacity={0.95} onPress={handleDoubleTap}>
              <FeedMedia uri={post.mediaUrls[0]} />
            </TouchableOpacity>
          )}
          {/* Action bar — exact match to FeedScreen PostCard */}
          <View style={profileCardStyles.actions}>
            {/* Comment */}
            <TouchableOpacity style={profileCardStyles.actionBtn} onPress={() => onComment(post.id, post.caption)}>
              <View style={profileCardStyles.actionIconWrap}>
                <Ionicons name="chatbubble-outline" size={18} color={colors.textSecondary} />
              </View>
              {formatCount(post.commentCount) ? <Text style={profileCardStyles.actionCount}>{formatCount(post.commentCount)}</Text> : null}
            </TouchableOpacity>
            {/* Repost */}
            <TouchableOpacity style={profileCardStyles.actionBtn} onPress={handleRepostPress}>
              <View style={profileCardStyles.actionIconWrap}>
                <RepostIcon size={18} color={isReposted ? colors.repost : colors.textSecondary} />
              </View>
              {localRepostCount > 0 ? <Text style={[profileCardStyles.actionCount, isReposted && { color: colors.repost }]}>{localRepostCount}</Text> : null}
            </TouchableOpacity>
            {/* Like */}
            <TouchableOpacity style={profileCardStyles.actionBtn} onPress={() => onLike(post.id, post.liked)}>
              <View style={profileCardStyles.actionIconWrap}>
                {post.liked ? (
                  <Ionicons name="heart" size={18} color={colors.like} />
                ) : (
                  <Ionicons name="heart-outline" size={18} color={colors.textSecondary} />
                )}
              </View>
              {post.likeCount > 0 ? <Text style={[profileCardStyles.actionCount, post.liked && { color: colors.like }]}>{post.likeCount}</Text> : null}
            </TouchableOpacity>
            {/* Views */}
            <TouchableOpacity style={profileCardStyles.actionBtn} disabled>
              <View style={profileCardStyles.actionIconWrap}>
                <Ionicons name="trending-up-outline" size={18} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>
            {/* Bookmark + Share */}
            <View style={profileCardStyles.actionPair}>
              <TouchableOpacity style={profileCardStyles.actionBtn} onPress={handleBookmarkPress}>
                <View style={profileCardStyles.actionIconWrap}>
                  {isBookmarked ? (
                    <Ionicons name="bookmark" size={18} color={colors.bookmark} />
                  ) : (
                    <Ionicons name="bookmark-outline" size={18} color={colors.textSecondary} />
                  )}
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={profileCardStyles.actionBtn} onPress={handleShare}>
                <View style={profileCardStyles.actionIconWrap}>
                  <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
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
    borderBottomColor: colors.separator,
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
  displayName: { color: colors.text, fontWeight: '700', fontSize: 15, lineHeight: 20 },
  username: { color: colors.textMuted, fontSize: 15, lineHeight: 20 },
  dot: { color: colors.textMuted, fontSize: 15, lineHeight: 20 },
  time: { color: colors.textMuted, fontSize: 15, lineHeight: 20 },
  caption: { color: colors.text, fontSize: 15, lineHeight: 20, marginTop: 4 },
  seeMore: { color: colors.white, fontSize: 15, fontWeight: '600', marginTop: 2 },
  mediaContainer: {
    marginTop: 12, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.separator,
  },
  media: { width: '100%', height: Math.min(SCREEN_W * 0.85, 510), backgroundColor: colors.bg },
  actions: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 8, marginLeft: -4, maxWidth: 440,
    justifyContent: 'space-between',
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actionPair: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  actionIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  actionCount: { color: colors.textMuted, fontSize: 13, lineHeight: 16, marginLeft: 1 },
  heartOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  mediaErrorOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
    gap: 8,
  },
  mediaErrorText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  repostHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  repostHeaderText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
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
      <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No posts yet</Text>
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

function RepliesList({ replies }: { replies: Reply[]; navigation?: any }) {
  // Filter out self-replies (user replying to their own post)
  const filteredReplies = replies.filter(r =>
    r.authorUsername.toLowerCase() !== r.postAuthorUsername.toLowerCase()
  );

  if (filteredReplies.length === 0) return (
    <View style={{ alignItems: 'center', paddingTop: 60 }}>
      <Ionicons name="chatbubble-outline" size={48} color={colors.textTertiary} style={{ marginBottom: 12 }} />
      <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No replies yet</Text>
    </View>
  );
  return (
    <View>
      {filteredReplies.map(reply => (
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
              <Text style={profileCardStyles.caption}>{reply.content}</Text>
            </View>
          </View>
        </View>
      ))}
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
      <Ionicons name="heart-outline" size={48} color={colors.textTertiary} style={{ marginBottom: 12 }} />
      <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No liked posts yet</Text>
    </View>
  );
  return <PostGrid posts={posts} navigation={navigation} onLike={onLike} onBookmark={onBookmark} onDelete={onDelete} onRepost={onRepost} onComment={onComment} />;
}

/* ── Media Grid — shows only posts with images in a 3-column grid ────────── */
function MediaGrid({ posts, navigation }: { posts: Post[]; navigation: any }) {
  const postsWithMedia = posts.filter(p => p.mediaUrls && p.mediaUrls.length > 0);
  if (postsWithMedia.length === 0) {
    return (
      <View style={{ alignItems: 'center', paddingTop: 60 }}>
        <Ionicons name="images-outline" size={48} color={colors.textSecondary} style={{ marginBottom: 12 }} />
        <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No media yet</Text>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 1 }}>
      {postsWithMedia.map(post => (
        <TouchableOpacity
          key={post.id}
          style={{ width: '33.333%', aspectRatio: 1, padding: 1 }}
          onPress={() => navigation.navigate('PostComments', { postId: post.id, postCaption: post.caption, postAuthorUsername: post.authorUsername, postAuthorDisplayName: post.authorDisplayName })}
        >
          <Image
            source={{ uri: post.mediaUrls[0] }}
            style={{ width: '100%', height: '100%', borderRadius: 4 }}
            resizeMode="cover"
          />
          {post.mediaUrls.length > 1 && (
            <View style={{ position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
              <Ionicons name="copy-outline" size={12} color={colors.white} />
            </View>
          )}
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
  const [tab, setTab] = useState<'posts' | 'media' | 'replies' | 'likes' | 'reposts' | 'store'>('posts');
  const [likedPosts, setLikedPosts] = useState<Post[]>([]);
  const [repostPosts, setRepostPosts] = useState<Post[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [profileAd, setProfileAd] = useState<any>(null);
  const [coverImageError, setCoverImageError] = useState(false);

  const isBusinessAccount = user?.role === 'business';
  const showStoreTab = isBusinessAccount;

  const tabs: Array<'posts' | 'media' | 'replies' | 'likes' | 'reposts' | 'store'> = showStoreTab
    ? ['posts', 'media', 'store', 'likes', 'reposts']
    : ['posts', 'media', 'replies', 'likes', 'reposts'];

  const load = useCallback(async () => {
    try {
      if (__DEV__) console.log('[ProfileScreen] Loading profile for:', targetUserId);
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
      if (__DEV__) console.log(`[ProfileScreen] Got user: ${u?.displayName || 'null'}, posts: ${feed.docs.length}, followers: ${followersSnap.size}, following: ${followingSnap.size}`);
      setUser(u);
      setCoverImageError(false);
      setFollowing(isFollowing);
      setFollowersCount(followersSnap.size);
      setFollowingCount(followingSnap.size);

      // BUG FIX: Also fetch repost posts for this user. Repost posts have the
      // original author's authorId, not the reposting user's ID. Without this
      // query, reposts would never appear on the user's profile page.
      let fetchedRepostPosts: Post[] = [];
      try {
        const repostSnap = await firestore()
          .collection('posts')
          .where('repostedByUid', '==', targetUserId)
          .limit(50)
          .get();
        fetchedRepostPosts = repostSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id, authorId: data.authorId || '', authorUsername: data.authorUsername || '',
            authorDisplayName: data.authorDisplayName || '', authorProfileImage: data.authorProfileImage || null,
            authorBadge: data.authorBadge || '', authorIsVerified: data.authorIsVerified || false,
            caption: data.caption || '', mediaUrls: parseMediaUrls(data.mediaUrls),
            likeCount: data.likeCount || 0, commentCount: data.commentCount || 0,
            repostCount: data.repostCount || 0, liked: false, bookmarked: false, reposted: true,
            createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
            repostOf: data.repostOf || undefined,
            repostedByUid: data.repostedByUid || undefined,
            repostedByUsername: data.repostedByUsername || undefined,
            repostedByDisplayName: data.repostedByDisplayName || undefined,
          };
        });
      } catch (e) {
        console.warn('[ProfileScreen] Failed to fetch repost posts:', e);
      }

      const ps: Post[] = feed.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, authorId: data.authorId || '', authorUsername: data.authorUsername || '',
          authorDisplayName: data.authorDisplayName || '', authorProfileImage: data.authorProfileImage || null,
          authorBadge: data.authorBadge || '', authorIsVerified: data.authorIsVerified || false,
          caption: data.caption || '', mediaUrls: parseMediaUrls(data.mediaUrls),
          likeCount: data.likeCount || 0, commentCount: data.commentCount || 0,
          repostCount: data.repostCount || 0, liked: false, bookmarked: false, reposted: false,
          createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
          repostOf: data.repostOf || undefined,
          repostedByUid: data.repostedByUid || undefined,
          repostedByUsername: data.repostedByUsername || undefined,
          repostedByDisplayName: data.repostedByDisplayName || undefined,
        };
      });

      // Store repost posts separately for the Reposts tab
      setRepostPosts(fetchedRepostPosts);

      // Merge own posts + repost posts, sort by createdAt descending
      const allPosts = [...ps, ...fetchedRepostPosts];
      allPosts.sort((a, b) => b.createdAt - a.createdAt);
      setPosts(allPosts);

      // Batch check interactions for current user's posts
      if (currentUser?.uid && allPosts.length > 0) {
        const postIds = allPosts.map(p => p.id);
        const likedIds = new Set<string>();
        const bookmarkedIds = new Set<string>();
        const repostedIds = new Set<string>();

        // BUG FIX: CHUNK_SIZE must be 10 — Firestore IN operator max is 10.
        // The old value of 30 caused batch queries with IN filter to fail.
        const INTERACTION_CHUNK = 10;
        for (let i = 0; i < postIds.length; i += INTERACTION_CHUNK) {
          const chunk = postIds.slice(i, i + INTERACTION_CHUNK);
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

        for (const post of allPosts) {
          post.liked = likedIds.has(post.id);
          post.bookmarked = bookmarkedIds.has(post.id);
          post.reposted = repostedIds.has(post.id);
        }
        setPosts([...allPosts]); // trigger re-render
      }
    } catch (e: any) {
      console.error('[ProfileScreen] Load error:', e?.message);
      // Don't show raw technical errors to users — show a friendly message
      // with a retry option instead of exposing internal function names etc.
      Alert.alert('Profile', 'Unable to load profile right now. Please check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [targetUserId]);

  // Fetch a random active ad campaign for own profile banner
  useEffect(() => {
    (async () => {
      try {
        const adList = await fetchActiveAdCampaigns(10);
        if (adList.length > 0) {
          // Pick a random campaign (different from UserProfileScreen which picks index 0)
          const randomIndex = Math.floor(Math.random() * adList.length);
          setProfileAd(adList[randomIndex]);
        }
      } catch {
        // silently ignore
      }
    })();
  }, []);

  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    setCanRefresh(offset <= 0);
  }, []);

  // Refresh profile data whenever the screen gains focus (e.g. returning from EditProfile)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

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
          let postMediaUrls: string[] = [];
          let postAuthorUsername = '';
          let postAuthorDisplayName = '';
          if (postId) {
            try {
              const postSnap = await firestore().collection('posts').doc(postId).get();
              if (postSnap.exists) {
                const pd = postSnap.data();
                postCaption = pd.caption || '';
                postMediaUrls = parseMediaUrls(pd.mediaUrls);
                postAuthorUsername = pd.authorUsername || '';
                postAuthorDisplayName = pd.authorDisplayName || '';
              }
            } catch { /* skip if post not found */ }
          }
          replyList.push({
            id: d.id,
            postId,
            postCaption,
            postMediaUrls,
            postAuthorUsername,
            postAuthorDisplayName,
            content: data.content || '',
            authorUsername: data.authorUsername || '',
            authorDisplayName: data.authorDisplayName || '',
            authorProfileImage: data.authorProfileImage || '',
            authorIsVerified: data.authorIsVerified || false,
            authorBadge: data.authorBadge || '',
            createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
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
                createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
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
    } catch (e: any) {
      console.error('[ProfileScreen] Delete post error:', e?.message, e?.code, e?.status);
      Alert.alert('Error', `Failed to delete post: ${e?.message || 'Unknown error'}`);
    }
  };

  const handleFollow = async () => {
    if (followLoading) return;
    setFollowLoading(true);
    try {
      const newState = await toggleFollow(targetUserId, following);
      setFollowing(newState);
      setFollowersCount(c => newState ? c + 1 : Math.max(0, c - 1));
    } catch (e) {
      console.warn('[ProfileScreen] follow error:', e);
    }
    setFollowLoading(false);
  };

  const findOrCreateChat = async (myUid: string, theirUid: string) => {
    const snap1 = await firestore().collection('chats').where('user1Id', '==', myUid).get();
    const existing = snap1.docs.find(d => d.data().user2Id === theirUid);
    if (existing) {
      navigation.navigate('ChatRoom' as never, { chatId: existing.id } as never);
      return;
    }
    const snap2 = await firestore().collection('chats').where('user2Id', '==', myUid).get();
    const existing2 = snap2.docs.find(d => d.data().user1Id === theirUid);
    if (existing2) {
      navigation.navigate('ChatRoom' as never, { chatId: existing2.id } as never);
      return;
    }
    const chatRef = await firestore().collection('chats').add({
      user1Id: myUid,
      user2Id: theirUid,
      lastMessage: '',
      lastMessageTime: firestore.FieldValue.serverTimestamp(),
      unreadUser1: 0,
      unreadUser2: 0,
      createdAt: firestore.FieldValue.serverTimestamp(),
    });
    navigation.navigate('ChatRoom' as never, { chatId: chatRef.id } as never);
  };

  const handleMessage = async () => {
    if (!currentUser?.uid || messaging) return;
    setMessaging(true);
    try {
      // ── Check target user's DM permission setting ──
      const dmPermission = await getUserDmPermission(targetUserId);

      if (dmPermission === 'paid') {
        // Check if user already has paid access
        const paid = await hasPaidChatAccess(currentUser.uid, targetUserId);
        if (paid) {
          // Already paid — proceed to chat directly
          await findOrCreateChat(currentUser.uid, targetUserId);
        } else {
          // Not paid — navigate to paid chat screen
          const chatPrice = await getPaidChatPrice(targetUserId);
          navigation.navigate('PaidChat' as never, { targetUserId, chatPrice } as never);
        }
        return;
      }

      if (dmPermission === 'followers') {
        // Check if current user follows the target
        const follows = await checkFollowing(targetUserId);
        if (!follows) {
          Alert.alert('Follow Required', 'You need to follow this user to send them a message.');
          return;
        }
      }

      // DM permission is "all" (or null/undefined), or "followers" (and user follows) — proceed normally
      await findOrCreateChat(currentUser.uid, targetUserId);
    } catch (e: any) {
      console.warn('[ProfileScreen] message error:', e);
    } finally {
      setMessaging(false);
    }
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
            <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
              <TouchableOpacity onPress={() => navigation.navigate('Settings')} hitSlop={8}>
                <Ionicons name="settings-outline" size={22} color={colors.text} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('PremiumDashboard')} hitSlop={8}>
                <Ionicons name="diamond-outline" size={22} color={colors.accent} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ width: 22 }} />
          )}
        </View>
      </SafeAreaView>

      {/* Cover */}
      <View style={styles.coverWrap}>
        {user?.coverImage && !coverImageError ? (
          <Image
            source={{ uri: user.coverImage }}
            style={styles.cover}
            resizeMode="cover"
            onError={(e) => {
              console.warn('[ProfileScreen] Cover image failed to load:', e.nativeEvent?.error);
              setCoverImageError(true);
            }}
          />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            {coverImageError && user?.coverImage && (
              <View style={styles.coverErrorOverlay}>
                <Ionicons name="image-outline" size={24} color={colors.textMuted} />
              </View>
            )}
          </View>
        )}
      </View>

      {/* Avatar + Edit / Follow */}
      <View style={styles.avatarRow}>
        <View style={{ marginTop: -32 }}>
          <Avatar
            uri={user?.profileImage}
            name={user?.displayName || null}
            size={80}
            borderWidth={4}
            borderColor={colors.bg}
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
              disabled={followLoading}
            >
              {followLoading ? (
                <ActivityIndicator size="small" color={following ? colors.text : colors.bg} />
              ) : (
                <Text style={[styles.followBtnText, following && styles.followingBtnText]}>
                  {following ? 'Following' : 'Follow'}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.messageBtn}
              onPress={handleMessage}
              disabled={messaging}
            >
              {messaging ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Ionicons name="chatbubble-outline" size={18} color={colors.white} />
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

      {/* Ad Banner — only show if an active campaign exists */}
      {profileAd && (
        <View style={styles.adBanner}>
          <View style={styles.adBannerBadgeRow}>
            <Ionicons name="megaphone-outline" size={14} color={colors.accentGold} />
            <Text style={styles.adBannerBadgeText}>Promoted</Text>
          </View>
          <Text style={styles.adBannerHeadline} numberOfLines={1}>{profileAd.headline || 'Ad'}</Text>
          {profileAd.description ? (
            <Text style={styles.adBannerDescription} numberOfLines={2}>{profileAd.description}</Text>
          ) : null}
          {profileAd.ctaText ? (
            <TouchableOpacity style={styles.adBannerCta} activeOpacity={0.7}>
              <Text style={styles.adBannerCtaText}>{profileAd.ctaText}</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.adBannerSponsored}>Sponsored</Text>
        </View>
      )}

      {/* Separator between ad and tabs */}
      {profileAd && <View style={styles.adSeparator} />}

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
      {tab === 'media' && (
        <MediaGrid posts={posts} navigation={navigation} />
      )}
      {tab === 'replies' && <RepliesList replies={replies} navigation={navigation} />}
      {tab === 'likes' && <LikedPostsGrid posts={likedPosts} navigation={navigation} onLike={handleLike} onBookmark={handleBookmark} onDelete={handleDelete} onRepost={handleRepost} onComment={handleComment} />}
      {tab === 'reposts' && <PostGrid posts={repostPosts} navigation={navigation} onLike={handleLike} onBookmark={handleBookmark} onDelete={handleDelete} onRepost={handleRepost} onComment={handleComment} />}
      {tab === 'store' && (
        <View style={{ alignItems: 'center', paddingTop: 60 }}>
          <Ionicons name="storefront-outline" size={48} color={colors.textSecondary} style={{ marginBottom: 12 }} />
          <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No products listed yet</Text>
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
  coverWrap: { height: 128, width: '100%', overflow: 'hidden', backgroundColor: colors.bg },
  cover: { width: '100%', height: '100%' },
  /* Fallback: solid black */
  coverPlaceholder: { backgroundColor: colors.bg },
  coverErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* web: flex items-end justify-between px-5 -mt-8 mb-3 */
  avatarRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 20, marginTop: -32, marginBottom: 12,
  },
  /* Edit Profile button: px-5 py-1.5 rounded-full border border-[#64748b] text-[15px] font-bold text-[#e7e9ea] */
  editProfileBtn: {
    borderWidth: 1, borderColor: colors.textTertiary, borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 6,
  },
  editProfileBtnText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  /* Follow button (not following): bg-[#e7e9ea] text-black px-6 py-2 rounded-full text-[15px] font-bold */
  followBtn: {
    backgroundColor: colors.text, borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 6,
  },
  /* Follow button (following): border border-[#64748b] text-[#e7e9ea] */
  followingBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.textTertiary },
  followBtnText: { color: colors.primaryForeground, fontWeight: '700', fontSize: 14 },
  followingBtnText: { color: colors.text },
  /* Message button: border border-[#FFFFFF]/40 text-[#FFFFFF] px-5 py-2 rounded-full text-[15px] font-bold */
  messageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 6,
  },
  messageBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  /* Bio section: px-5 pb-4 border-b border-white/[0.06] */
  bioSection: {
    paddingHorizontal: 20, paddingTop: 0, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: colors.separator,
  },
  /* Name: text-xl font-bold text-[#e7e9ea] */
  displayName: { color: colors.text, fontSize: 20, fontWeight: '700' },
  /* Username: text-[15px] text-[#94a3b8] */
  handle: { color: colors.textSecondary, fontSize: 15, marginTop: 2 },
  /* Bio: text-[15px] text-[#e7e9ea] mt-2 leading-relaxed (leading-relaxed = 1.625 → lineHeight 24.375) */
  bio: { color: colors.text, fontSize: 15, lineHeight: 24, marginTop: 8 },
  /* Stats: flex items-center gap-5 mt-4 text-[14px] */
  statsRow: { flexDirection: 'row', gap: 20, marginTop: 16 },
  statText: { color: colors.textSecondary, fontSize: 14 },
  statNum: { color: colors.text, fontWeight: '700' },
  /* Tab bar: sticky, bg-[#000], border-b border-white/[0.06] */
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
    backgroundColor: colors.bg,
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
    backgroundColor: colors.white,
  },
  /* Tab text: text-[15px] font-medium, active: text-[#e7e9ea] font-bold, inactive: text-[#94a3b8] */
  tabText: { color: colors.textSecondary, fontWeight: '500', fontSize: 15 },
  tabTextActive: { color: colors.text, fontWeight: '700' },
  /* ── Profile Ad Banner ── */
  adBanner: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 0,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  adBannerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  adBannerBadgeText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  adBannerHeadline: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
    marginBottom: 4,
  },
  adBannerDescription: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 10,
  },
  adBannerCta: {
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  adBannerCtaText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  adBannerSponsored: {
    color: 'rgba(113,118,123,0.6)',
    fontSize: 11,
  },
  adSeparator: {
    height: 0.5,
    backgroundColor: colors.separator,
    marginHorizontal: 20,
    marginTop: 12,
  },
});
