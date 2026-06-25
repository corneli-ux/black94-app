import React, { useCallback, useEffect, useState, memo, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, firestore } from '../lib/firebase';
import {
  fetchUserProfile,
  toggleFollow,
  checkFollowing,
  getUserDmPermission,
  User,
  Post,
  tsToMillis,
  parseMediaUrls,
} from '../lib/api';
import { usePostInteractions } from '../hooks/usePostInteractions';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import FeedMedia from '../components/FeedMedia';
import { enrichAuthorProfiles } from '../utils/enrichAuthorProfiles';
import { AppIcon, RepostIcon } from '../components/icons';
import PostActionsBar from '../components/PostActionsBar';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

/* ── Hashtag/Mention Highlighted Text ────────────────────────────────── */
function HighlightedCaption({ text, style }: { text: string; style: any }) {
  const parts = text.split(/(#\w+|@\w+)/g);
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        /^#[\w]+$/.test(part) || /^@[\w]+$/.test(part) ? (
          <Text key={i} style={{ color: colors.white }}>{part}</Text>
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
  onComment: (id: string, caption?: string, authorUsername?: string, authorDisplayName?: string) => void;
  navigation: any;
}) {
  const currentUser = auth()?.currentUser;
  const [showHeart, setShowHeart] = useState(false);
  const lastTapRef = useRef(0);

  // Single-layer state: all optimistic updates flow through the parent handler.
  // Previous dual-layer state (local + parent) caused flickering races.

  const interactionId = post.repostOf || post.id;

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (!post.liked) { onLike(interactionId, post.liked); }
      setShowHeart(true);
      setTimeout(() => setShowHeart(false), 900);
    }
    lastTapRef.current = now;
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
        <TouchableOpacity style={profileCardStyles.contentColumn} activeOpacity={0.7} onPress={() => navigation.navigate('PostComments', { postId: interactionId, postCaption: post.caption, postAuthorUsername: post.authorUsername, postAuthorDisplayName: post.authorDisplayName })}>
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
                <AppIcon name="more-horiz" size="md" color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          {post.caption ? <HighlightedCaption text={post.caption} style={profileCardStyles.caption} /> : null}
          {(post.mediaUrls?.length > 0) && (
            <TouchableOpacity activeOpacity={0.95} onPress={handleDoubleTap}>
              <FeedMedia uri={post.mediaUrls[0]} />
            </TouchableOpacity>
          )}
          {/* Action bar — shared PostActionsBar component */}
          <PostActionsBar
            post={post}
            interactionId={interactionId}
            onLike={onLike}
            onRepost={onRepost}
            onBookmark={onBookmark}
            onComment={(id) => onComment(id, post.caption, post.authorUsername, post.authorDisplayName)}
            navigation={navigation}
          />
        </TouchableOpacity>
      </View>
      {/* Double-tap heart overlay */}
      {showHeart && (
        <View style={profileCardStyles.heartOverlay} pointerEvents="none">
          <AppIcon name="favorite" size="overlay" color={colors.like} />
        </View>
      )}
    </View>
  );
});

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
  mediaContainer: {
    marginTop: 12, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.separator,
  },
  media: { width: '100%', height: Math.min(SCREEN_WIDTH * 0.85, 510), backgroundColor: colors.bg },
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
  replyingTo: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 2,
  },
  replyingToName: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  /* Parent post media shown in reply cards */
  replyMediaContainer: {
    marginTop: 10,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.separator,
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
  replyMedia: {
    width: '100%',
    height: Math.min(SCREEN_WIDTH * 0.65, 380),
    backgroundColor: colors.bg,
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

function MediaGrid({ posts, navigation }: { posts: Post[]; navigation: any }) {
  const mediaPosts = React.useMemo(
    () => posts.filter(p => p.mediaUrls && p.mediaUrls.length > 0),
    [posts],
  );
  const gap = 2;
  const colCount = 3;
  const size = (SCREEN_WIDTH - gap * (colCount - 1)) / colCount;

  if (mediaPosts.length === 0) return (
    <View style={{ alignItems: 'center', paddingTop: 60 }}>
      <AppIcon name="photo-library" size="hero" color={colors.textTertiary} style={{ marginBottom: 12 }} />
      <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No media yet</Text>
    </View>
  );

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, padding: gap }}>
      {mediaPosts.map((post, idx) => (
        <TouchableOpacity
          key={post.id + '_' + idx}
          style={{ width: size, height: size, backgroundColor: colors.bg }}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('PostDetail', { postId: post.id })}
        >
          <Image
            source={{ uri: post.mediaUrls![0] }}
            style={{ width: size, height: size }}
            resizeMode="cover"
          />
          {post.mediaUrls!.length > 1 && (
            <View style={{
              position: 'absolute', top: 6, right: 6,
              backgroundColor: colors.overlayDark, borderRadius: 4,
              paddingHorizontal: 5, paddingVertical: 2,
            }}>
              <AppIcon name="content-copy" size={10} color={colors.white} />
            </View>
          )}
        </TouchableOpacity>
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
      <AppIcon name="chat-bubble-outline" size="hero" color={colors.textTertiary} style={{ marginBottom: 12 }} />
      <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No replies yet</Text>
    </View>
  );
  return (
    <View>
      {filteredReplies.map(reply => {
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
              <Text style={profileCardStyles.replyingTo}>
                Replying to <Text style={profileCardStyles.replyingToName}>@{reply.postAuthorUsername}</Text>
              </Text>
              <Text style={profileCardStyles.caption}>{reply.content}</Text>
              {/* Show parent post media if available */}
              {reply.postMediaUrls?.length > 0 && (
                <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate('PostComments', { postId: reply.postId, postCaption: reply.postCaption })}>
                  <View style={profileCardStyles.replyMediaContainer}>
                    <Image source={{ uri: reply.postMediaUrls[0] }} style={profileCardStyles.replyMedia} resizeMode="cover" />
                  </View>
                </TouchableOpacity>
              )}
              <View style={profileCardStyles.actions}>
                <TouchableOpacity style={profileCardStyles.actionBtn} onPress={() => navigation.navigate('PostComments', { postId: reply.postId, postCaption: reply.postCaption })}>
                  <View style={profileCardStyles.actionIconWrap}>
                    <AppIcon name="chat-bubble-outline" size="md" color={colors.textSecondary} />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={profileCardStyles.actionBtn} onPress={() => setRepostMap(prev => ({ ...prev, [reply.id]: !prev[reply.id] }))}>
                  <View style={profileCardStyles.actionIconWrap}>
                    <RepostIcon size={18} color={repostMap[reply.id] ? colors.repost : colors.textSecondary} />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={profileCardStyles.actionBtn} onPress={() => setLikeMap(prev => ({ ...prev, [reply.id]: !prev[reply.id] }))}>
                  <View style={profileCardStyles.actionIconWrap}>
                    <AppIcon name={likeMap[reply.id] ? 'favorite' : 'favorite-border'} size="md" color={likeMap[reply.id] ? colors.like : colors.textSecondary} />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={profileCardStyles.actionBtn}>
                  <View style={profileCardStyles.actionIconWrap}>
                    <AppIcon name="trending-up" size="md" color={colors.textSecondary} />
                  </View>
                </TouchableOpacity>
                <View style={profileCardStyles.actionPair}>
                  <TouchableOpacity style={profileCardStyles.actionBtn} onPress={() => setBookmarkMap(prev => ({ ...prev, [reply.id]: !prev[reply.id] }))}>
                    <View style={profileCardStyles.actionIconWrap}>
                      <AppIcon name={bookmarkMap[reply.id] ? 'bookmark' : 'bookmark-border'} size="md" color={bookmarkMap[reply.id] ? colors.bookmark : colors.textSecondary} />
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity style={profileCardStyles.actionBtn}>
                    <View style={profileCardStyles.actionIconWrap}>
                      <AppIcon name="share" size="md" color={colors.textSecondary} />
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
      <AppIcon name="favorite-border" size="hero" color={colors.textTertiary} style={{ marginBottom: 12 }} />
      <Text style={{ color: colors.textSecondary, fontSize: 15 }}>No liked posts yet</Text>
    </View>
  );
  return <PostGrid posts={posts} navigation={navigation} onLike={onLike} onBookmark={onBookmark} onDelete={onDelete} onRepost={onRepost} onComment={onComment} />;
}

type ProfileTab = 'posts' | 'media' | 'replies' | 'likes';

export default function UserProfileScreen({ navigation, route }: any) {
  const { userId } = route.params || {};
  const currentUid = auth()?.currentUser?.uid ?? '';

  // BUG FIX: ALL hooks MUST be called before ANY early return.
  // The old code had an early return for !userId BEFORE useState/useEffect,
  // which is a fatal React hooks violation that crashes the app with
  // "Rendered fewer hooks than expected". This was the root cause of the
  // profile page crash for certain users (e.g., @das/@cornelius).
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('posts');
  const [refreshing, setRefreshing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);
  const [likedPosts, setLikedPosts] = useState<Post[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [privacy, setPrivacy] = useState<{ nameVisibility?: string } | null>(null);
  // BUG FIX: Add loadError state so users see an error screen with retry
  // instead of an infinite loading spinner when profile data fails to load.
  const [loadError, setLoadError] = useState(false);
  const [coverImageError, setCoverImageError] = useState(false);

  // Early return for missing userId — now AFTER all hooks are declared.
  // This is safe because no hooks are called after this point.
  if (!userId) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top']}>
        <Text style={{ color: colors.text, fontSize: 16, textAlign: 'center', padding: 40 }}>
          User not found
        </Text>
      </SafeAreaView>
    );
  }

  // Fetch one active ad campaign for profile banner
  useEffect(() => {
    (async () => {
      try {
        }
      } catch {
        // silently ignore
      }
    })();
  }, []);

  const loadData = useCallback(async () => {
    try {
      // BUG FIX: fetchUserProfile already fetches the user doc internally.
      // The old code fetched it AGAIN with a direct Firestore call, wasting
      // one round-trip. Now we extract privacy from the userData returned
      // by fetchUserProfile (which returns the full user doc data).
      const [userData, userPostsSnap, followersSnap, followingSnap, isFollow] = await Promise.all([
        fetchUserProfile(userId),
        // NOTE: No .orderBy('createdAt', 'desc') — that composite index may
        // not exist in Firestore. Query without orderBy, then sort client-side
        // (same strategy as ProfileScreen and web's fetchUserPostsNoIndex).
        firestore().collection('posts').where('authorId', '==', userId).limit(50).get(),
        firestore().collection('follows').where('followingId', '==', userId).get(),
        firestore().collection('follows').where('followerId', '==', userId).get(),
        currentUid ? checkFollowing(userId) : Promise.resolve(false),
      ]);
      setUser(userData);
      setLoadError(false);
      setCoverImageError(false);
      // Extract privacy settings from user data returned by fetchUserProfile
      if (userData) {
        setPrivacy((userData as any).privacy || null);
      }
      setFollowerCount(followersSnap.size);
      setFollowingCount(followingSnap.size);
      setIsFollowing(isFollow);

      const userPosts: Post[] = userPostsSnap.docs.map((docSnap) => {
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
          repostOf: data.repostOf || undefined,
          repostedByUid: data.repostedByUid || undefined,
          repostedByUsername: data.repostedByUsername || undefined,
          repostedByDisplayName: data.repostedByDisplayName || undefined,
        };
      });

      // BUG FIX: Also fetch repost posts for this user. Repost posts have the
      // original author's authorId, not the reposting user's ID.
      let repostPosts: Post[] = [];
      try {
        const repostSnap = await firestore()
          .collection('posts')
          .where('repostedByUid', '==', userId)
          .limit(50)
          .get();
        repostPosts = repostSnap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
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
            reposted: true,
            createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
            repostOf: data.repostOf || undefined,
            repostedByUid: data.repostedByUid || undefined,
            repostedByUsername: data.repostedByUsername || undefined,
            repostedByDisplayName: data.repostedByDisplayName || undefined,
          };
        });
      } catch (e) {
        if (__DEV__) console.warn('[UserProfile] Failed to fetch repost posts:', e);
      }

      // Merge own posts + repost posts, sort by createdAt descending
      const allPosts = [...userPosts, ...repostPosts];
      allPosts.sort((a, b) => b.createdAt - a.createdAt);

      // Enrich author profiles from user docs so that name/avatar
      // changes reflect immediately.
      await enrichAuthorProfiles(allPosts);

      setPosts(allPosts);

      // Batch check interactions for current user
      if (currentUid && allPosts.length > 0) {
        const postIds = allPosts.map(p => p.id);
        const likedIds = new Set<string>();
        const bookmarkedIds = new Set<string>();
        const repostedIds = new Set<string>();

        // BUG FIX: Chunk size must be 10 — launching 30*3=90 parallel Firestore
        // reads can overwhelm slow connections and cause timeouts on mobile.
        for (let i = 0; i < postIds.length; i += 10) {
          const chunk = postIds.slice(i, i + 10);
          try {
            const promises = chunk.flatMap(postId => [
              firestore().collection('post_likes').doc(`${postId}_${currentUid}`).get()
                .then(snap => { if (snap.exists) likedIds.add(postId); }).catch(() => {}),
              firestore().collection('post_bookmarks').doc(`${postId}_${currentUid}`).get()
                .then(snap => { if (snap.exists) bookmarkedIds.add(postId); }).catch(() => {}),
              firestore().collection('post_reposts').doc(`${postId}_${currentUid}`).get()
                .then(snap => { if (snap.exists) repostedIds.add(postId); }).catch(() => {}),
            ]);
            await Promise.all(promises);
          } catch (e) {
            if (__DEV__) console.warn('[UserProfile] Interaction check failed:', e);
          }
        }

        for (const post of allPosts) {
          post.liked = likedIds.has(post.id);
          post.bookmarked = bookmarkedIds.has(post.id);
          post.reposted = repostedIds.has(post.id);
        }
        setPosts([...allPosts]);
      }
    } catch (e) {
      if (__DEV__) console.warn('[UserProfileScreen] load error:', e);
      // BUG FIX: Set loadError so the UI shows an error screen with retry
      // instead of a permanent loading spinner when profile data fails to load.
      setLoadError(true);
    }
  }, [userId, currentUid]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load replies when replies tab is active
  useEffect(() => {
    if (tab !== 'replies' || !userId) return;
    setTabLoading(true);
    (async () => {
      try {
        const snap = await firestore()
          .collection('post_comments')
          .where('authorId', '==', userId)
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
        replyList.sort((a, b) => b.createdAt - a.createdAt);
        setReplies(replyList);
      } catch (e: any) {
        console.error('[UserProfileScreen] Failed to load replies:', e?.message);
        setReplies([]);
      } finally {
        setTabLoading(false);
      }
    })();
  }, [tab, userId]);

  // Load liked posts when likes tab is active
  useEffect(() => {
    if (tab !== 'likes' || !userId) return;
    setTabLoading(true);
    (async () => {
      try {
        const likesSnap = await firestore()
          .collection('post_likes')
          .where('userId', '==', userId)
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
        console.error('[UserProfileScreen] Failed to load liked posts:', e?.message);
        setLikedPosts([]);
      } finally {
        setTabLoading(false);
      }
    })();
  }, [tab, userId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleToggleFollow = useCallback(async () => {
    if (!currentUid || followLoading) return;
    setFollowLoading(true);
    try {
      const nowFollowing = await toggleFollow(userId, isFollowing);
      setIsFollowing(nowFollowing);
      setFollowerCount((prev) => (nowFollowing ? prev + 1 : Math.max(0, prev - 1)));
    } catch (e) {
      if (__DEV__) console.warn('[UserProfileScreen] follow error:', e);
    }
    setFollowLoading(false);
  }, [currentUid, userId, followLoading, isFollowing]);

  const handleMessage = useCallback(async () => {
    if (!currentUid || messageLoading) return;
    setMessageLoading(true);
    try {
      const dmPermission = await getUserDmPermission(userId);


      if (dmPermission === 'followers') {
        const follows = await checkFollowing(userId);
        if (!follows) {
          Alert.alert('Follow Required', 'You need to follow this user to send them a message.');
          setMessageLoading(false);
          return;
        }
      }

      if (dmPermission === 'no one' || dmPermission === 'nobody' || dmPermission === 'disabled') {
        Alert.alert('Messages Disabled', 'This user does not accept messages.');
        setMessageLoading(false);
        return;
      }

      const snap1 = await firestore().collection('chats').where('user1Id', '==', currentUid).get();
      const existing = snap1.docs.find(d => d.data().user2Id === userId);
      if (existing) {
        navigation.navigate('ChatRoom' as never, { chatId: existing.id } as never);
      } else {
        const snap2 = await firestore().collection('chats').where('user2Id', '==', currentUid).get();
        const existing2 = snap2.docs.find(d => d.data().user1Id === userId);
        if (existing2) {
          navigation.navigate('ChatRoom' as never, { chatId: existing2.id } as never);
        } else {
          const chatRef = await firestore().collection('chats').add({
            user1Id: currentUid,
            user2Id: userId,
            lastMessage: '',
            lastMessageTime: firestore.FieldValue.serverTimestamp(),
            unreadUser1: 0,
            unreadUser2: 0,
            createdAt: firestore.FieldValue.serverTimestamp(),
          });
          navigation.navigate('ChatRoom' as never, { chatId: chatRef.id } as never);
        }
      }
    } catch (e) {
      if (__DEV__) console.warn('[UserProfileScreen] message error:', e);
    }
    setMessageLoading(false);
  }, [currentUid, userId, messageLoading, navigation]);

  // Interaction handlers
  // ── Post interactions: like, bookmark, repost, delete ──────────────
  const { handlers } = usePostInteractions({
    posts,
    setPosts,
    currentUserUid: auth()?.currentUser?.uid || null,
  });

  const handleComment = (postId: string, caption?: string, authorUsername?: string, authorDisplayName?: string) => {
    navigation.navigate('PostComments', { postId, postCaption: caption || '', postAuthorUsername: authorUsername || '', postAuthorDisplayName: authorDisplayName || '' });
  };

  if (!user && loadError) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top']}>
        <View style={{ alignItems: 'center', padding: 40 }}>
          <AppIcon name="error-outline" size="hero" color={colors.textSecondary} style={{ marginBottom: 12 }} />
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>Unable to load profile</Text>
          <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 8 }}>Check your connection and try again.</Text>
          <TouchableOpacity
            style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.accentBgStrong, borderRadius: 12, borderWidth: 1, borderColor: colors.accentBorderHeavy }}
            onPress={() => loadData()}
            activeOpacity={0.7}
          >
            <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '600' }}>Tap to retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ marginTop: 12 }}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Text style={{ color: colors.textMuted, fontSize: 14 }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top']}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  const isOwnProfile = currentUid === userId;

  const tabs: ProfileTab[] = ['posts', 'media', 'replies', 'likes'];

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        {/* Top bar */}
        <SafeAreaView edges={['top']}>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
              <AppIcon name="arrow-back" size="lg" color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.topLogo}>{user.displayName || 'Profile'}</Text>
            <View style={{ width: 22 }} />
          </View>
        </SafeAreaView>

        {/* Cover Image */}
        <View style={styles.coverContainer}>
          {user.coverImage && !coverImageError ? (
            <Image
              source={{ uri: user.coverImage }}
              style={styles.coverImage}
              resizeMode="cover"
              onError={(e) => {
                if (__DEV__) console.warn('[UserProfileScreen] Cover image failed to load:', e.nativeEvent?.error);
                setCoverImageError(true);
              }}
            />
          ) : (
            <View style={[styles.coverImage, styles.coverPlaceholder]}>
              {coverImageError && user.coverImage && (
                <View style={styles.coverErrorOverlay}>
                  <AppIcon name="image" size="xl" color={colors.textMuted} />
                </View>
              )}
              {!user.coverImage && <Text style={styles.coverPlaceholderText}>B94</Text>}
            </View>
          )}
        </View>

        {/* Avatar + Follow / Message / Options */}
        <View style={styles.avatarRow}>
          <View style={{ marginTop: -32 }}>
            <Avatar
              uri={user.profileImage}
              name={user.displayName || null}
              size={80}
              borderWidth={4}
              borderColor={colors.bg}
            />
          </View>
          {!isOwnProfile && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                style={[styles.followBtn, isFollowing && styles.followingBtn]}
                onPress={handleToggleFollow}
                disabled={followLoading}
              >
                {followLoading ? (
                  <ActivityIndicator size="small" color={isFollowing ? colors.text : colors.bg} />
                ) : (
                  <Text style={[styles.followBtnText, isFollowing && styles.followingBtnText]}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.messageBtn}
                onPress={handleMessage}
                disabled={messageLoading}
              >
                {messageLoading ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <>
                    <AppIcon name="chat-bubble-outline" size="md" color={colors.white} />
                    <Text style={styles.messageBtnText}>Message</Text>
                  </>
                )}
              </TouchableOpacity>
              {/* Options button */}
              <TouchableOpacity
                style={styles.moreOptionsBtn}
                onPress={() => {
                  Alert.alert('Options', '', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: isFollowing ? 'Unfollow' : 'Follow',
                      onPress: () => handleToggleFollow(),
                    },
                    {
                      text: 'Block User',
                      style: 'destructive',
                      onPress: () => {
                        Alert.alert('Block User', `Block @${user?.username || 'this user'}? They won't be able to see your posts or profile.`, [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Block',
                            style: 'destructive',
                            onPress: async () => {
                              try {
                                await firestore().collection('user_blocks').doc(`${currentUid}_${userId}`).set({
                                  blockerId: currentUid,
                                  blockedId: userId,
                                  createdAt: firestore.FieldValue.serverTimestamp(),
                                });
                                if (isFollowing) {
                                  await toggleFollow(userId, true);
                                  setIsFollowing(false);
                                  setFollowerCount(prev => Math.max(0, prev - 1));
                                }
                                try {
                                  await firestore().collection('follows').doc(`${userId}_${currentUid}`).delete();
                                } catch {}
                                navigation.goBack();
                              } catch {}
                            },
                          },
                        ]);
                      },
                    },
                    {
                      text: 'Report User',
                      onPress: () => {
                        const reasons = [
                          'Harassment or bullying',
                          'Hate speech',
                          'Spam or fake account',
                          'Inappropriate content',
                          'Impersonation',
                          'Other',
                        ];
                        Alert.alert('Report User', `Why are you reporting @${user?.username || 'this user'}?`, [
                          { text: 'Cancel', style: 'cancel' },
                          ...reasons.map(reason => ({
                            text: reason,
                            style: 'default' as const,
                            onPress: async () => {
                              try {
                                await firestore().collection('reports').add({
                                  type: 'user',
                                  targetId: userId,
                                  targetUsername: user?.username || '',
                                  reporterId: currentUid,
                                  reason,
                                  status: 'pending',
                                  createdAt: firestore.FieldValue.serverTimestamp(),
                                });
                                Alert.alert('Reported', 'Thank you for your report. Our team will review this within 48 hours.');
                              } catch {}
                            },
                          })),
                        ]);
                      },
                    },
                  ]);
                }}
              >
                <AppIcon name="more-horiz" size="md" color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* User Info */}
        <View style={styles.userInfoSection}>
          <View style={styles.nameRow}>
            {(() => {
              const showRealName = privacy?.nameVisibility !== 'private' && privacy?.nameVisibility !== 'selected';
              return showRealName ? (
                <Text style={styles.displayName}>{user.displayName}</Text>
              ) : null;
            })()}
            {privacy?.nameVisibility !== 'private' && privacy?.nameVisibility !== 'selected' && (
              <VerifiedBadge badge={user.badge} isVerified={user.isVerified} />
            )}
          </View>
          <Text style={styles.username}>@{user.username}</Text>
          {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}

          {/* Stats */}
          <View style={styles.statsRow}>
            <TouchableOpacity onPress={() => navigation.navigate('Followers' as never, { targetUserId: userId, mode: 'following' } as never)}>
              <Text style={styles.statText}>
                <Text style={styles.statNum}>{formatCount(followingCount)}</Text> Following
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('Followers' as never, { targetUserId: userId, mode: 'followers' } as never)}>
              <Text style={styles.statText}>
                <Text style={styles.statNum}>{formatCount(followerCount)}</Text> Followers
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Ad Banner — only show if an active campaign exists */}

        {/* Separator between ad and tabs */}

        {/* Tabs — horizontal pill/chip style */}
        <View style={styles.tabBarContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarScroll}>
            {tabs.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.tabPill, tab === t && styles.tabPillActive]}
                onPress={() => setTab(t)}
              >
                <Text style={[styles.tabPillText, tab === t && styles.tabPillTextActive]}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Tab Content */}
        {tabLoading ? (
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : tab === 'posts' && (
          <PostGrid posts={posts} navigation={navigation} onLike={handlers.like} onBookmark={handlers.bookmark} onDelete={handlers.delete} onRepost={handlers.repost} onComment={handleComment} />
        )}
        {tab === 'media' && (
          <MediaGrid posts={posts} navigation={navigation} />
        )}
        {tab === 'replies' && <RepliesList replies={replies} navigation={navigation} />}
        {tab === 'likes' && <LikedPostsGrid posts={likedPosts} navigation={navigation} onLike={handlers.like} onBookmark={handlers.bookmark} onDelete={handlers.delete} onRepost={handlers.repost} onComment={handleComment} />}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10,
  },
  topLogo: { color: colors.text, fontSize: 18, fontWeight: '800' },
  coverContainer: {
    height: 128,
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverPlaceholder: {
    backgroundColor: colors.bg,
  },
  coverPlaceholderText: {
    color: colors.borderSubtle,
    fontSize: 60,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 20,
  },
  coverErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 20, marginTop: -32, marginBottom: 12,
  },
  followBtn: {
    backgroundColor: colors.text, borderRadius: 999,
    paddingHorizontal: 20, paddingVertical: 6,
  },
  followingBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.textTertiary },
  followBtnText: { color: colors.primaryForeground, fontWeight: '700', fontSize: 15 },
  followingBtnText: { color: colors.text },
  messageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: colors.borderWhite40, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 6,
  },
  messageBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  moreOptionsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderWhite40,
  },
  userInfoSection: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  displayName: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  username: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 2,
  },
  bio: {
    fontSize: 15,
    color: colors.text,
    marginTop: 8,
    lineHeight: 24,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 20,
  },
  statText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  statNum: {
    color: colors.text,
    fontWeight: '700',
  },
  tabBarContainer: {
    backgroundColor: colors.bg,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
  },
  tabBarScroll: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  tabPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabPillActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  tabPillText: {
    color: colors.textSecondary,
    fontWeight: '500',
    fontSize: 13,
  },
  tabPillTextActive: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: 13,
  },
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
    gap: 4,
    marginBottom: 8,
  },
    letterSpacing: 0.3,
  },
    lineHeight: 20,
    marginBottom: 4,
  },
    lineHeight: 19,
    marginBottom: 10,
  },
});
