/**
 * PostActionsBar — self-contained post action buttons.
 *
 * Contract with api.ts:
 *  toggleLike:     throws on error, returns true=liked / false=unliked
 *  toggleBookmark: throws on error, returns true=bookmarked / false=unbookmarked
 *  toggleRepost:   returns { success, undone }
 *
 * Pattern: optimistic update → API call → revert ONLY on throw/exception
 *
 * Animation: Like / Repost / Bookmark use spring-based scale + color
 * transitions driven by shared values on the UI thread. Like also fires
 * a small heart burst on the like-tap (not un-like). All physics come
 * from src/constants/animations.ts so the feel is consistent app-wide.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Alert, Share } from 'react-native';
import { Feather, AntDesign } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { colors } from '../theme/colors';
import { RepostIcon } from './icons';
import { toggleLike, toggleRepost, toggleBookmark } from '../lib/api';
import { auth } from '../lib/firebase';
import { spring, DURATIONS } from '../constants/animations';
import { AnimatedPressableScale } from './AnimatedPressableScale';

function formatCount(n: number | undefined): string {
  if (!n) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function getUid(): string | null {
  try { return auth()?.currentUser?.uid || null; } catch { return null; }
}

/* ── Like button with spring scale + heart burst ─────────────────────────── */
function LikeButton({
  liked, count, sz, onPress,
}: { liked: boolean; count: number | undefined; sz: number; onPress: () => void; }) {
  const scale = useSharedValue(1);
  const burst = useSharedValue(0); // 0 → 1 fires the burst
  const burstOpacity = useSharedValue(0);

  const triggerBurst = useCallback(() => {
    'worklet';
    // Re-arm then play.
    burst.value = 0;
    burstOpacity.value = 1;
    burst.value = withSequence(
      withSpring(1, spring.bouncy),
      withTiming(0, { duration: DURATIONS.normal }, () => {
        burstOpacity.value = 0;
      }),
    );
  }, [burst, burstOpacity]);

  const handlePress = useCallback(() => {
    // Bounce the heart on tap, regardless of like/unlike direction.
    scale.value = withSequence(
      withSpring(1.35, spring.bouncy),
      withSpring(1, spring.snappy),
    );
    if (!liked) {
      // Fire burst only on like, not un-like.
      triggerBurst();
    }
    onPress();
  }, [liked, onPress, scale, triggerBurst]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Burst ring behind the heart. Static layout lives in the style prop;
  // only the animated values (transform, opacity) live in useAnimatedStyle.
  const burstStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(burst.value, [0, 1], [0.6, 1.6], Extrapolation.CLAMP) }],
    opacity: burstOpacity.value * interpolate(burst.value, [0, 1], [0.9, 0], Extrapolation.CLAMP),
  }));

  return (
    <View style={styles.btn}>
      <AnimatedPressableScale scale={1} onPress={handlePress} hitSlop={8} style={styles.btnInner}>
        <View style={styles.iconWrap}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.burstRing,
              { width: sz + 16, height: sz + 16, borderRadius: (sz + 16) / 2 },
              burstStyle,
            ]}
          />
          <Animated.View style={iconStyle}>
            {liked
              ? <AntDesign name="heart" size={sz} color={colors.like} />
              : <Feather name="heart" size={sz} color={colors.textSecondary} />
            }
          </Animated.View>
        </View>
        {count ? (
          <Text style={[styles.count, liked && { color: colors.like }]}>{formatCount(count)}</Text>
        ) : null}
      </AnimatedPressableScale>
    </View>
  );
}

/* ── Repost button with rotation + scale on success ──────────────────────── */
function RepostButton({
  reposted, count, sz, onPress,
}: { reposted: boolean; count: number | undefined; sz: number; onPress: () => void; }) {
  const rotate = useSharedValue(0);
  const scale = useSharedValue(1);

  const handlePress = useCallback(() => {
    // Quick rotation + scale punch on every press for feedback.
    rotate.value = withSequence(
      withTiming(-360, { duration: DURATIONS.normal }),
      withSpring(0, spring.snappy),
    );
    scale.value = withSequence(
      withSpring(1.2, spring.bouncy),
      withSpring(1, spring.snappy),
    );
    onPress();
  }, [onPress, rotate, scale]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${rotate.value}deg` },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={styles.btn}>
      <AnimatedPressableScale scale={1} onPress={handlePress} hitSlop={8} style={styles.btnInner}>
        <View style={styles.iconWrap}>
          <Animated.View style={iconStyle}>
            <RepostIcon size={sz} color={reposted ? colors.repost : colors.textSecondary} />
          </Animated.View>
        </View>
        {count ? (
          <Text style={[styles.count, reposted && { color: colors.repost }]}>{formatCount(count)}</Text>
        ) : null}
      </AnimatedPressableScale>
    </View>
  );
}

/* ── Bookmark button with scale punch on toggle ──────────────────────────── */
function BookmarkButton({
  bookmarked, sz, onPress,
}: { bookmarked: boolean; sz: number; onPress: () => void; }) {
  const scale = useSharedValue(1);

  const handlePress = useCallback(() => {
    scale.value = withSequence(
      withSpring(1.25, spring.bouncy),
      withSpring(1, spring.snappy),
    );
    onPress();
  }, [onPress, scale]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.btn}>
      <AnimatedPressableScale scale={1} onPress={handlePress} hitSlop={8} style={styles.btnInner}>
        <Animated.View style={iconStyle}>
          {bookmarked
            ? <AntDesign name="pushpin" size={sz} color={colors.bookmark} />
            : <Feather name="bookmark" size={sz} color={colors.textSecondary} />
          }
        </Animated.View>
      </AnimatedPressableScale>
    </View>
  );
}

/* ── Plain comment / share button (just scale feedback) ─────────────────── */

export interface PostActionsBarProps {
  post: {
    liked?: boolean;
    reposted?: boolean;
    bookmarked?: boolean;
    likeCount?: number;
    repostCount?: number;
    commentCount?: number;
    viewCount?: number;
    authorUsername?: string;
    caption?: string;
    repostOf?: string;
    id?: string;
  };
  interactionId: string;
  onLike?: (postId: string, currentlyLiked: boolean) => void;
  onRepost?: (postId: string, currentlyReposted: boolean) => void;
  onBookmark?: (postId: string, currentlyBookmarked: boolean) => void;
  onComment: (postId: string) => void;
  onShare?: () => void;
  navigation?: any;
  variant?: 'feed' | 'detail';
}

const PostActionsBar = React.memo(function PostActionsBar({
  post, interactionId, onLike, onRepost, onBookmark, onComment, onShare, navigation, variant = 'feed',
}: PostActionsBarProps) {

  const [liked, setLiked] = useState(!!post.liked);
  const [likeCount, setLikeCount] = useState(post.likeCount || 0);
  const [reposted, setReposted] = useState(!!post.reposted);
  const [repostCount, setRepostCount] = useState(post.repostCount || 0);
  const [bookmarked, setBookmarked] = useState(!!post.bookmarked);

  const likingRef = useRef(false);
  const repostingRef = useRef(false);
  const bookmarkingRef = useRef(false);
  const hasInteractedLike = useRef(false);
  const hasInteractedRepost = useRef(false);
  const hasInteractedBookmark = useRef(false);

  // Sync from props only before first interaction
  useEffect(() => {
    if (!hasInteractedLike.current) {
      setLiked(!!post.liked);
      setLikeCount(post.likeCount || 0);
    }
  }, [post.liked, post.likeCount]);

  useEffect(() => {
    if (!hasInteractedRepost.current) {
      setReposted(!!post.reposted);
      setRepostCount(post.repostCount || 0);
    }
  }, [post.reposted, post.repostCount]);

  useEffect(() => {
    if (!hasInteractedBookmark.current) setBookmarked(!!post.bookmarked);
  }, [post.bookmarked]);

  // ── LIKE ──────────────────────────────────────────────────────────────
  const handleLikePress = useCallback(async () => {
    if (likingRef.current) return;
    const targetId = interactionId || post.id;
    if (!targetId) return;

    const uid = getUid();
    if (!uid) {
      Alert.alert('Sign In Required', 'Please sign in to like posts.');
      return;
    }

    likingRef.current = true;
    hasInteractedLike.current = true;
    const wasLiked = liked;

    // Optimistic update
    setLiked(!wasLiked);
    setLikeCount(prev => Math.max(0, prev + (wasLiked ? -1 : 1)));

    try {
      await toggleLike(targetId, wasLiked);
      // Success — keep optimistic state
      onLike?.(targetId, wasLiked);
    } catch (e: any) {
      // Revert on real error
      setLiked(wasLiked);
      setLikeCount(prev => Math.max(0, prev + (wasLiked ? 1 : -1)));
      if (e?.message === 'Not authenticated') {
        Alert.alert('Sign In Required', 'Please sign in to like posts.');
      }
    } finally {
      likingRef.current = false;
    }
  }, [liked, interactionId, post.id, onLike]);

  // ── REPOST ────────────────────────────────────────────────────────────
  const doRepost = useCallback(async (targetId: string, wasReposted: boolean) => {
    repostingRef.current = true;
    hasInteractedRepost.current = true;

    setReposted(!wasReposted);
    setRepostCount(prev => Math.max(0, prev + (wasReposted ? -1 : 1)));

    try {
      onRepost?.(targetId, wasReposted);
    } finally {
      repostingRef.current = false;
    }
  }, [onRepost]);

  const handleRepostPress = useCallback(() => {
    if (repostingRef.current) return;
    const targetId = interactionId || post.id;
    if (!targetId) return;

    const uid = getUid();
    if (!uid) { Alert.alert('Sign In Required', 'Please sign in to repost.'); return; }

    if (reposted) { doRepost(targetId, true); return; }
    Alert.alert('Repost', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Repost', onPress: () => doRepost(targetId, false) },
      {
        text: 'Quote Repost',
        onPress: () => navigation?.navigate('CreatePost', {
          quotePostId: targetId,
          quoteAuthor: `@${post.authorUsername || 'user'}`,
          quoteCaption: (post.caption || '').slice(0, 100),
          quoteMediaUrl: post.mediaUrls?.[0] || null,
          quoteDisplayName: post.authorDisplayName || post.authorUsername || 'User',
        }),
      },
    ]);
  }, [reposted, interactionId, post.id, post.authorUsername, post.caption, navigation, doRepost]);

  // ── BOOKMARK ──────────────────────────────────────────────────────────
  const handleBookmarkPress = useCallback(async () => {
    if (bookmarkingRef.current) return;
    const targetId = interactionId || post.id;
    if (!targetId) return;

    const uid = getUid();
    if (!uid) { Alert.alert('Sign In Required', 'Please sign in to bookmark posts.'); return; }

    bookmarkingRef.current = true;
    hasInteractedBookmark.current = true;
    const wasBookmarked = bookmarked;

    setBookmarked(!wasBookmarked);

    try {
      await toggleBookmark(targetId, wasBookmarked);
      onBookmark?.(targetId, wasBookmarked);
    } catch {
      setBookmarked(wasBookmarked);
    } finally {
      bookmarkingRef.current = false;
    }
  }, [bookmarked, interactionId, post.id, onBookmark]);

  // ── COMMENT ───────────────────────────────────────────────────────────
  const handleCommentPress = useCallback(() => {
    const targetId = interactionId || post.id;
    if (targetId) onComment(targetId);
  }, [interactionId, post.id, onComment]);

  // ── SHARE ─────────────────────────────────────────────────────────────
  const handleSharePress = useCallback(async () => {
    if (onShare) { onShare(); return; }
    try { await Share.share({ message: 'Check out this post on Black94!' }); } catch {}
  }, [onShare]);

  if (!interactionId && !post.id) return null;

  const sz = variant === 'detail' ? 22 : 20;
  const repostSz = variant === 'detail' ? 22 : 20;

  return (
    <View style={styles.row}>
      {/* Comment */}
      <AnimatedPressableScale style={styles.btn} onPress={handleCommentPress} hitSlop={8}>
        <Feather name="message-circle" size={sz} color={colors.textSecondary} />
        {post.commentCount ? <Text style={styles.count}>{formatCount(post.commentCount)}</Text> : null}
      </AnimatedPressableScale>

      {/* Repost */}
      <RepostButton reposted={reposted} count={repostCount} sz={repostSz} onPress={handleRepostPress} />

      {/* Like */}
      <LikeButton liked={liked} count={likeCount} sz={sz} onPress={handleLikePress} />

      {/* Views */}
      <View style={styles.btn}>
        <Feather name="bar-chart-2" size={sz} color={colors.textSecondary} />
        {post.viewCount ? <Text style={styles.count}>{formatCount(post.viewCount)}</Text> : null}
      </View>

      {/* Bookmark + Share */}
      <View style={styles.endGroup}>
        <BookmarkButton bookmarked={bookmarked} sz={sz} onPress={handleBookmarkPress} />
        <AnimatedPressableScale style={styles.btn} onPress={handleSharePress} hitSlop={8}>
          <Feather name="share" size={sz} color={colors.textSecondary} />
        </AnimatedPressableScale>
      </View>
    </View>
  );
});

export default PostActionsBar;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginLeft: -2,
    paddingRight: 4,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 2,
    minWidth: 34,
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  iconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
  },
  burstRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.like,
  },
  count: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  endGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
});
