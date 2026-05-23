import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import {
  toggleLike,
  toggleBookmark,
  toggleRepost,
  Post,
  tsToMillis,
  parseMediaUrls,
} from '../lib/api';
import { useAppStore } from '../stores/app';
import { useOptimisticAction } from '../hooks/useOptimisticAction';
import FeedMedia from '../components/FeedMedia';
import { refreshFirebaseUrl } from '../utils/imageUpload';

/* ── Helpers ────────────────────────────────────────────────────────────────── */

const formatCount = (n: number | undefined): string => {
  if (!n) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
};

/* ── Screen ────────────────────────────────────────────────────────────────── */

export default function PostDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { postId } = (route.params as { postId: string }) || {};
  const insets = useSafeAreaInsets();
  const currentUser = auth()?.currentUser;

  // ── Post state ───────────────────────────────────────────────────────────
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Interaction state (optimistic) ──────────────────────────────────────
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [bookmarked, setBookmarked] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [repostCount, setRepostCount] = useState(0);

  // ── Media URL refresh ───────────────────────────────────────────────────
  const [refreshedUrl, setRefreshedUrl] = useState<string | null>(null);
  const refreshAttemptedRef = useRef(false);

  // ── In-flight guard ─────────────────────────────────────────────────────
  const { guard: inflight, release: releaseInflight } = useOptimisticAction();

  // ── Fetch post ──────────────────────────────────────────────────────────
  const loadPost = useCallback(async () => {
    if (!postId) {
      setError('No post ID provided');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const docSnap = await firestore().collection('posts').doc(postId).get();

      if (!docSnap.exists) {
        setError('This post doesn\'t exist or has been deleted');
        setLoading(false);
        return;
      }

      const data = docSnap.data();
      if (!data) {
        setError('Failed to load post data');
        setLoading(false);
        return;
      }

      const fetched: Post = {
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
        viewCount: data.viewCount || 0,
        liked: false,
        bookmarked: false,
        reposted: false,
        createdAt: (() => {
          try {
            return tsToMillis(data.createdAt);
          } catch {
            return Date.now();
          }
        })(),
        repostOf: data.repostOf || undefined,
        repostedByUid: data.repostedByUid || undefined,
        repostedByDisplayName: data.repostedByDisplayName || undefined,
        repostedByUsername: data.repostedByUsername || undefined,
        visibility: data.visibility || 'public',
      };

      setPost(fetched);
      setLikeCount(fetched.likeCount);
      setRepostCount(fetched.repostCount);

      // ── Enrich: fetch author profile for fresh avatar/badge ────────────
      try {
        const userDoc = await firestore().collection('users').doc(fetched.authorId).get();
        if (userDoc.exists) {
          const ud = userDoc.data();
          if (ud) {
            fetched.authorProfileImage = ud.profileImage || fetched.authorProfileImage;
            fetched.authorBadge = ud.badge || fetched.authorBadge;
            fetched.authorIsVerified = ud.isVerified ?? fetched.authorIsVerified;
          }
        }
      } catch {}

      // ── Enrich: check current user's interaction state ─────────────────
      if (currentUser?.uid) {
        try {
          const targetId = fetched.repostOf || fetched.id;
          const [likeSnap, bookmarkSnap, repostSnap] = await Promise.all([
            firestore().collection('post_likes').doc(`${targetId}_${currentUser.uid}`).get().catch(() => null),
            firestore().collection('post_bookmarks').doc(`${targetId}_${currentUser.uid}`).get().catch(() => null),
            firestore().collection('post_reposts').doc(`${targetId}_${currentUser.uid}`).get().catch(() => null),
          ]);

          if (likeSnap?.exists) setLiked(true);
          if (bookmarkSnap?.exists) setBookmarked(true);
          if (repostSnap?.exists) setReposted(true);
        } catch {}
      }

      setPost({ ...fetched });
    } catch (e: any) {
      console.error('[PostDetail] Failed to load post:', e?.message);
      setError(e?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [postId, currentUser?.uid]);

  useEffect(() => {
    loadPost();
  }, [loadPost]);

  // ── Media URL refresh on error ──────────────────────────────────────────
  const handleMediaError = useCallback(async (originalUrl: string) => {
    if (!refreshAttemptedRef.current && originalUrl) {
      refreshAttemptedRef.current = true;
      try {
        const newUrl = await refreshFirebaseUrl(originalUrl);
        if (newUrl && newUrl !== originalUrl) {
          setRefreshedUrl(newUrl);
        }
      } catch {}
    }
  }, []);

  // ── Like ────────────────────────────────────────────────────────────────
  const handleLike = useCallback(async () => {
    if (!post || !currentUser?.uid) return;
    const key = `like_${post.id}`;
    if (!inflight(key)) return;

    const next = !liked;
    setLiked(next);
    setLikeCount(c => c + (next ? 1 : -1));

    try {
      await toggleLike(post.id, liked);
    } catch {
      setLiked(!next);
      setLikeCount(c => c + (next ? -1 : 1));
    } finally {
      releaseInflight(key);
    }
  }, [post, liked, currentUser?.uid, inflight, releaseInflight]);

  // ── Bookmark ────────────────────────────────────────────────────────────
  const handleBookmark = useCallback(async () => {
    if (!post || !currentUser?.uid) return;
    const key = `bm_${post.id}`;
    if (!inflight(key)) return;

    const next = !bookmarked;
    setBookmarked(next);

    try {
      await toggleBookmark(post.id, bookmarked);
    } catch {
      setBookmarked(!next);
    } finally {
      releaseInflight(key);
    }
  }, [post, bookmarked, currentUser?.uid, inflight, releaseInflight]);

  // ── Repost ──────────────────────────────────────────────────────────────
  const handleRepost = useCallback(async () => {
    if (!post || !currentUser?.uid) return;
    const key = `rp_${post.id}`;
    if (!inflight(key)) return;

    const next = !reposted;
    setReposted(next);
    setRepostCount(c => c + (next ? 1 : -1));

    try {
      const result = await toggleRepost(post.id, reposted);
      if (!result.success) {
        setReposted(!next);
        setRepostCount(c => c + (next ? -1 : 1));
      }
    } catch {
      setReposted(!next);
      setRepostCount(c => c + (next ? -1 : 1));
    } finally {
      releaseInflight(key);
    }
  }, [post, reposted, currentUser?.uid, inflight, releaseInflight]);

  // ── Share ───────────────────────────────────────────────────────────────
  const handleShare = useCallback(async () => {
    try {
      await Share.share({ message: 'Check out this post on Black94!' });
    } catch {}
  }, []);

  // ── Navigate to comments ────────────────────────────────────────────────
  const handleComment = useCallback(() => {
    if (!post) return;
    navigation.navigate('PostComments' as never, {
      postId: post.id,
      postCaption: post.caption,
      postAuthorUsername: post.authorUsername,
      postAuthorDisplayName: post.authorDisplayName,
    });
  }, [post, navigation]);

  // ── Navigate to user profile ────────────────────────────────────────────
  const handleAuthorPress = useCallback(() => {
    if (!post) return;
    if (post.authorId === currentUser?.uid) {
      navigation.navigate('ProfileSelf' as never);
    } else {
      navigation.navigate('UserProfile' as never, { userId: post.authorId });
    }
  }, [post, currentUser?.uid, navigation]);

  // ── Render: Loading ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  // ── Render: Error ───────────────────────────────────────────────────────
  if (error || !post) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
              <Ionicons name="arrow-back" size={22} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Post</Text>
            <View style={{ width: 22 }} />
          </View>
        </SafeAreaView>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text style={styles.errorText}>{error || 'Post not found'}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadPost}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const displayUrl = refreshedUrl || post.mediaUrls?.[0] || null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Post</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      {/* Post content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: Math.max(16, insets.bottom + 80) }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Repost indicator */}
        {post.repostedByDisplayName ? (
          <View style={styles.repostBar}>
            <Ionicons name="repeat" size={14} color={colors.textSecondary} />
            <Text style={styles.repostText}>
              {post.repostedByUid === currentUser?.uid ? 'You' : post.repostedByDisplayName} reposted
            </Text>
          </View>
        ) : null}

        {/* Author row */}
        <View style={styles.authorRow}>
          <TouchableOpacity onPress={handleAuthorPress} activeOpacity={0.7}>
            <Avatar uri={post.authorProfileImage} name={post.authorDisplayName} size={48} />
          </TouchableOpacity>
          <View style={styles.authorInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.displayName} numberOfLines={1}>{post.authorDisplayName}</Text>
              <VerifiedBadge badge={post.authorBadge} isVerified={post.authorIsVerified} size={18} />
              <Text style={styles.handle}>@{post.authorUsername}</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.timestamp}>{timeAgo(post.createdAt)}</Text>
            </View>
          </View>
        </View>

        {/* Caption */}
        {post.caption ? (
          <Text style={styles.caption}>{post.caption}</Text>
        ) : null}

        {/* Media */}
        {displayUrl ? (
          <FeedMedia
            uri={displayUrl}
            onRefreshUrl={() => handleMediaError(post.mediaUrls[0])}
          />
        ) : null}

        {/* View count */}
        {post.viewCount > 0 ? (
          <Text style={styles.viewCount}>
            {formatCount(post.viewCount)} Views
          </Text>
        ) : null}

        {/* Action buttons */}
        <View style={styles.actions}>
          {/* Comment */}
          <TouchableOpacity style={styles.actionBtn} onPress={handleComment}>
            <View style={styles.actionIconWrap}>
              <Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} />
            </View>
            {formatCount(post.commentCount) ? (
              <Text style={styles.actionCount}>{formatCount(post.commentCount)}</Text>
            ) : null}
          </TouchableOpacity>

          {/* Repost */}
          <TouchableOpacity style={styles.actionBtn} onPress={handleRepost}>
            <View style={styles.actionIconWrap}>
              <Ionicons name="repeat" size={18} color={reposted ? colors.repost : colors.textMuted} />
            </View>
            {formatCount(repostCount) ? (
              <Text style={[styles.actionCount, reposted && { color: colors.repost }]}>
                {formatCount(repostCount)}
              </Text>
            ) : null}
          </TouchableOpacity>

          {/* Like */}
          <TouchableOpacity style={styles.actionBtn} onPress={handleLike}>
            <View style={styles.actionIconWrap}>
              <Ionicons name={liked ? 'heart' : 'heart-outline'} size={18} color={liked ? colors.like : colors.textMuted} />
            </View>
            {formatCount(likeCount) ? (
              <Text style={[styles.actionCount, liked && { color: colors.like }]}>
                {formatCount(likeCount)}
              </Text>
            ) : null}
          </TouchableOpacity>

          {/* Views */}
          <TouchableOpacity style={styles.actionBtn} disabled>
            <View style={styles.actionIconWrap}>
              <Ionicons name="trending-up-outline" size={18} color={colors.textMuted} />
            </View>
          </TouchableOpacity>

          {/* Bookmark + Share */}
          <View style={styles.actionPair}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleBookmark}>
              <View style={styles.actionIconWrap}>
                <Ionicons
                  name={bookmarked ? 'bookmark' : 'bookmark-outline'}
                  size={18}
                  color={bookmarked ? colors.bookmark : colors.textMuted}
                />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
              <View style={styles.actionIconWrap}>
                <Ionicons name="share-outline" size={18} color={colors.textMuted} />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats bar */}
        <View style={styles.statsBar}>
          <Text style={styles.statsText}>
            {formatCount(post.repostCount) ? `${formatCount(repostCount)} Reposts` : ''}
            {(formatCount(repostCount) && formatCount(likeCount)) ? ' · ' : ''}
            {formatCount(likeCount) ? `${formatCount(likeCount)} Likes` : ''}
          </Text>
        </View>
      </ScrollView>

      {/* Bottom comment input bar */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(10, insets.bottom) }]}>
        <TouchableOpacity
          style={styles.commentInputFake}
          onPress={handleComment}
          activeOpacity={0.7}
        >
          <Text style={styles.commentInputPlaceholder}>
            Add a reply to @{post.authorUsername}...
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  /* Error state */
  errorText: {
    color: colors.text,
    fontSize: 16,
    marginTop: 12,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  retryBtnText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  /* Repost bar */
  repostBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 64,
    paddingTop: 12,
  },
  repostText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  /* Author */
  authorRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  authorInfo: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'nowrap',
    overflow: 'hidden',
  },
  displayName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 15,
  },
  handle: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  dot: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  timestamp: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  /* Caption */
  caption: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 24,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  /* View count */
  viewCount: {
    color: colors.textMuted,
    fontSize: 13,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  /* Action buttons */
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginLeft: 0,
    maxWidth: 440,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  actionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCount: {
    color: colors.textSecondary,
    fontSize: 13,
    marginLeft: 2,
  },
  actionPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  /* Stats bar */
  statsBar: {
    marginTop: 16,
    marginHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: colors.separator,
  },
  statsText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  /* Bottom bar */
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
    backgroundColor: colors.bg,
  },
  commentInputFake: {
    flex: 1,
    height: 40,
    backgroundColor: colors.surface,
    borderRadius: 20,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  commentInputPlaceholder: {
    color: colors.textMuted,
    fontSize: 15,
  },
});
