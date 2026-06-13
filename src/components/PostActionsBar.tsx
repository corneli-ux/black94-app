/**
 * PostActionsBar v2 — polished action buttons.
 *
 * Fixes:
 *  - Proper touch target size (44px min per HIG/Material)
 *  - Press state background tint per action color
 *  - Correct spacing between bookmark + share pair
 *  - Icon size bump for better tap accuracy
 *  - Animated scale on press
 *  - Count shown even at 0 (was hidden, felt broken)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
  Animated,
} from 'react-native';
import { colors } from '../theme/colors';
import { typography, spacing, radius } from '../theme/tokens';
import { AppIcon, RepostIcon } from './icons';
import { toggleLike, toggleRepost, toggleBookmark, ToggleRepostResult } from '../lib/api';
import { auth } from '../lib/firebase';

function formatCount(n: number | undefined): string {
  if (n === undefined || n === null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function getUid(): string | null {
  try { return auth()?.currentUser?.uid || null; } catch { return null; }
}

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

/** Animated action button with press-tint feedback */
function ActionBtn({
  onPress,
  disabled = false,
  pressColor = 'rgba(255,255,255,0.08)',
  children,
}: {
  onPress?: () => void;
  disabled?: boolean;
  pressColor?: string;
  children: React.ReactNode;
}) {
  const bg = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  const bgColor = bg.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(0,0,0,0)', pressColor],
  });

  const onPressIn = () => {
    Animated.parallel([
      Animated.timing(bg, { toValue: 1, duration: 80, useNativeDriver: false }),
      Animated.spring(scale, { toValue: 0.88, useNativeDriver: true, speed: 60 }),
    ]).start();
  };
  const onPressOut = () => {
    Animated.parallel([
      Animated.timing(bg, { toValue: 0, duration: 200, useNativeDriver: false }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40 }),
    ]).start();
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      activeOpacity={1}
      style={actionBtnStyles.touch}
    >
      <Animated.View
        style={[
          actionBtnStyles.inner,
          { backgroundColor: bgColor, transform: [{ scale }] },
        ]}
      >
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
}

const actionBtnStyles = StyleSheet.create({
  touch: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
  },
});

const PostActionsBar = React.memo(function PostActionsBar({
  post,
  interactionId,
  onLike,
  onRepost,
  onBookmark,
  onComment,
  onShare,
  navigation,
  variant = 'feed',
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

  // ── LIKE ──────────────────────────────────────────────────────────────────
  const handleLikePress = useCallback(async () => {
    if (likingRef.current) return;
    likingRef.current = true;
    hasInteractedLike.current = true;
    const wasLiked = liked;
    const targetId = interactionId || post.id;
    if (!targetId) { likingRef.current = false; return; }
    setLiked(!wasLiked);
    setLikeCount(prev => Math.max(0, prev + (wasLiked ? -1 : 1)));
    try {
      const uid = getUid();
      if (!uid) {
        Alert.alert('Sign In Required', 'Please sign in to like posts.');
        setLiked(wasLiked);
        setLikeCount(prev => Math.max(0, prev + (wasLiked ? 1 : -1)));
        return;
      }
      const result = await toggleLike(targetId, wasLiked);
      if (result === false) {
        setLiked(wasLiked);
        setLikeCount(prev => Math.max(0, prev + (wasLiked ? 1 : -1)));
      }
    } catch (e: any) {
      setLiked(wasLiked);
      setLikeCount(prev => Math.max(0, prev + (wasLiked ? 1 : -1)));
    } finally {
      likingRef.current = false;
    }
  }, [liked, interactionId, post.id]);

  // ── REPOST ────────────────────────────────────────────────────────────────
  const handleRepostPress = useCallback(() => {
    if (repostingRef.current) return;
    const targetId = interactionId || post.id;
    if (!targetId) return;
    if (reposted) {
      doRepost(targetId, true);
    } else {
      Alert.alert('Repost', 'How would you like to repost?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Repost', onPress: () => doRepost(targetId, false) },
        {
          text: 'Quote Repost',
          onPress: () => {
            navigation?.navigate('CreatePost', {
              quotePostId: targetId,
              quoteAuthor: `@${post.authorUsername || 'user'}`,
              quoteCaption: (post.caption || '').slice(0, 100),
            });
          },
        },
      ]);
    }
  }, [reposted, interactionId, post.id, post.authorUsername, post.caption, navigation]);

  const doRepost = useCallback(async (targetId: string, wasReposted: boolean) => {
    repostingRef.current = true;
    hasInteractedRepost.current = true;
    setReposted(!wasReposted);
    setRepostCount(prev => Math.max(0, prev + (wasReposted ? -1 : 1)));
    try {
      const uid = getUid();
      if (!uid) {
        Alert.alert('Sign In Required', 'Please sign in to repost.');
        setReposted(wasReposted);
        setRepostCount(prev => Math.max(0, prev + (wasReposted ? 1 : -1)));
        return;
      }
      const result: ToggleRepostResult = await toggleRepost(targetId, wasReposted);
      if (!result.success) {
        setReposted(wasReposted);
        setRepostCount(prev => Math.max(0, prev + (wasReposted ? 1 : -1)));
      }
    } catch (e: any) {
      setReposted(wasReposted);
      setRepostCount(prev => Math.max(0, prev + (wasReposted ? 1 : -1)));
    } finally {
      repostingRef.current = false;
    }
  }, []);

  // ── BOOKMARK ──────────────────────────────────────────────────────────────
  const handleBookmarkPress = useCallback(async () => {
    if (bookmarkingRef.current) return;
    bookmarkingRef.current = true;
    hasInteractedBookmark.current = true;
    const wasBookmarked = bookmarked;
    const targetId = interactionId || post.id;
    if (!targetId) { bookmarkingRef.current = false; return; }
    setBookmarked(!wasBookmarked);
    try {
      const uid = getUid();
      if (!uid) {
        Alert.alert('Sign In Required', 'Please sign in to bookmark posts.');
        setBookmarked(wasBookmarked);
        return;
      }
      await toggleBookmark(targetId, wasBookmarked);
    } catch (e: any) {
      setBookmarked(wasBookmarked);
    } finally {
      bookmarkingRef.current = false;
    }
  }, [bookmarked, interactionId, post.id]);

  // ── COMMENT ───────────────────────────────────────────────────────────────
  const handleCommentPress = useCallback(() => {
    const targetId = interactionId || post.id;
    if (targetId) onComment(targetId);
  }, [interactionId, post.id, onComment]);

  // ── SHARE ─────────────────────────────────────────────────────────────────
  const handleSharePress = useCallback(async () => {
    if (onShare) { onShare(); return; }
    try { await Share.share({ message: 'Check out this post on Black94!' }); } catch {}
  }, [onShare]);

  if (!interactionId && !post.id) return null;

  const isDetail = variant === 'detail';
  const iconSize = isDetail ? 20 : 18;
  const repostIconSize = isDetail ? 21 : 19;

  return (
    <View style={[styles.actions, isDetail && styles.actionsDetail]}>

      {/* Comment */}
      <ActionBtn onPress={handleCommentPress} pressColor="rgba(255,255,255,0.08)">
        <AppIcon name="chat-bubble-outline" size={isDetail ? 'lg' : 'md'} color={colors.textSecondary} />
        <Text style={styles.count}>{formatCount(post.commentCount)}</Text>
      </ActionBtn>

      {/* Repost */}
      <ActionBtn onPress={handleRepostPress} pressColor="rgba(16,185,129,0.15)">
        <RepostIcon size={repostIconSize} color={reposted ? colors.repost : colors.textSecondary} />
        <Text style={[styles.count, reposted && styles.repostCount]}>{formatCount(repostCount)}</Text>
      </ActionBtn>

      {/* Like */}
      <ActionBtn onPress={handleLikePress} pressColor="rgba(244,63,94,0.15)">
        <AppIcon
          name={liked ? 'favorite' : 'favorite-border'}
          size={isDetail ? 'lg' : 'md'}
          color={liked ? colors.like : colors.textSecondary}
        />
        <Text style={[styles.count, liked && styles.likeCount]}>{formatCount(likeCount)}</Text>
      </ActionBtn>

      {/* Views */}
      <ActionBtn disabled>
        <AppIcon name="trending-up" size={isDetail ? 'lg' : 'md'} color={colors.textSecondary} />
        <Text style={styles.count}>{formatCount(post.viewCount)}</Text>
      </ActionBtn>

      {/* Right cluster: bookmark + share */}
      <View style={styles.rightCluster}>
        <ActionBtn onPress={handleBookmarkPress} pressColor="rgba(212,175,55,0.15)">
          <AppIcon
            name={bookmarked ? 'bookmark' : 'bookmark-border'}
            size={isDetail ? 'lg' : 'md'}
            color={bookmarked ? colors.bookmark : colors.textSecondary}
          />
        </ActionBtn>
        <ActionBtn onPress={handleSharePress} pressColor="rgba(255,255,255,0.08)">
          <AppIcon name="share" size={isDetail ? 'lg' : 'md'} color={colors.textSecondary} />
        </ActionBtn>
      </View>

    </View>
  );
});

export default PostActionsBar;

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[2],
    justifyContent: 'space-between',
  },
  actionsDetail: {
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  rightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  count: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
    color: colors.textSecondary,
    minWidth: 18,
  },
  likeCount:   { color: colors.like },
  repostCount: { color: colors.repost },
});
