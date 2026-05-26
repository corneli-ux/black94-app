/**
 * PostActionsBar — self-contained action buttons for posts.
 *
 * This component manages its OWN liked/reposted/bookmarked state internally.
 * When a button is tapped, it:
 *   1. Immediately updates local state (instant visual feedback)
 *   2. Calls the API directly (toggleLike / toggleRepost / toggleBookmark)
 *   3. Reverts local state if the API fails
 *
 * This means the buttons work regardless of whether the parent's state
 * management is functioning correctly.
 *
 * Used by: FeedScreen, ProfileScreen, UserProfileScreen, BookmarksScreen,
 * PostDetailScreen, HashtagScreen.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Share } from 'react-native';
import { colors } from '../theme/colors';
import { AppIcon, RepostIcon } from './icons';
import { toggleLike, toggleRepost, toggleBookmark, ToggleRepostResult } from '../lib/api';
import { auth } from '../lib/firebase';

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function formatCount(n: number | undefined): string {
  if (!n) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function getUid(): string | null {
  try {
    return auth()?.currentUser?.uid || null;
  } catch {
    return null;
  }
}

/* ── Types ───────────────────────────────────────────────────────────────── */

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
  /** Optional: parent callback for cross-component sync */
  onLike?: (postId: string, currentlyLiked: boolean) => void;
  /** Optional: parent callback for cross-component sync */
  onRepost?: (postId: string, currentlyReposted: boolean) => void;
  /** Optional: parent callback for cross-component sync */
  onBookmark?: (postId: string, currentlyBookmarked: boolean) => void;
  /** Comment callback */
  onComment: (postId: string) => void;
  /** Share callback */
  onShare?: () => void;
  /** React Navigation ref */
  navigation?: any;
  /** Style variant */
  variant?: 'feed' | 'detail';
}

/* ── Component ───────────────────────────────────────────────────────────── */

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

  // ── Self-contained state ─────────────────────────────────────────────
  const [liked, setLiked] = useState(!!post.liked);
  const [likeCount, setLikeCount] = useState(post.likeCount || 0);
  const [reposted, setReposted] = useState(!!post.reposted);
  const [repostCount, setRepostCount] = useState(post.repostCount || 0);
  const [bookmarked, setBookmarked] = useState(!!post.bookmarked);

  // ── In-flight guards (prevent double-tap) ────────────────────────────
  const likingRef = useRef(false);
  const repostingRef = useRef(false);
  const bookmarkingRef = useRef(false);

  // ── Interaction guards — prevent useEffect from overwriting optimistic state ──
  // Once the user taps a button, we stop syncing that field from props.
  // This prevents the parent re-render (e.g. Firestore snapshot) from
  // snapping the button back to its pre-tap state before the API responds.
  const hasInteractedLike = useRef(false);
  const hasInteractedRepost = useRef(false);
  const hasInteractedBookmark = useRef(false);

  // ── Sync from post prop when it changes (only before first interaction) ──
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
    if (!hasInteractedBookmark.current) {
      setBookmarked(!!post.bookmarked);
    }
  }, [post.bookmarked]);

  // ── LIKE ────────────────────────────────────────────────────────────
  const handleLikePress = useCallback(async () => {
    if (likingRef.current) return;
    likingRef.current = true;
    hasInteractedLike.current = true;

    const wasLiked = liked;
    const targetId = interactionId || post.id;

    if (!targetId) {
      Alert.alert('Error', 'Cannot like this post — missing post ID.');
      likingRef.current = false;
      return;
    }

    // Optimistic: update immediately
    setLiked(!wasLiked);
    setLikeCount(prev => Math.max(0, prev + (wasLiked ? -1 : 1)));

    try {
      const uid = getUid();
      if (!uid) {
        Alert.alert('Sign In Required', 'Please sign in to like posts.');
        setLiked(wasLiked);
        setLikeCount(prev => Math.max(0, prev + (wasLiked ? 1 : -1)));
        likingRef.current = false;
        return;
      }

      const result = await toggleLike(targetId, wasLiked);
      if (result === false) {
        // API returned false (shouldn't happen after uid check, but safety)
        setLiked(wasLiked);
        setLikeCount(prev => Math.max(0, prev + (wasLiked ? 1 : -1)));
      }
    } catch (e: any) {
      console.error('[PostActionsBar] Like error:', e);
      setLiked(wasLiked);
      setLikeCount(prev => Math.max(0, prev + (wasLiked ? 1 : -1)));
    } finally {
      likingRef.current = false;
      // Notify parent for cross-component sync
      try { onLike?.(targetId, wasLiked); } catch {}
    }
  }, [liked, interactionId, post.id, onLike]);

  // ── REPOST ──────────────────────────────────────────────────────────
  const handleRepostPress = useCallback(() => {
    if (repostingRef.current) return;

    const targetId = interactionId || post.id;
    if (!targetId) {
      Alert.alert('Error', 'Cannot repost this post — missing post ID.');
      return;
    }

    if (reposted) {
      // Already reposted — undo directly
      doRepost(targetId, true);
    } else {
      // Show options
      Alert.alert('Repost', 'How would you like to repost?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Repost',
          onPress: () => doRepost(targetId, false),
        },
        {
          text: 'Quote Repost',
          onPress: () => {
            if (navigation) {
              navigation.navigate('CreatePost', {
                quotePostId: targetId,
                quoteAuthor: `@${post.authorUsername || 'user'}`,
                quoteCaption: (post.caption || '').slice(0, 100),
              });
            }
          },
        },
      ]);
    }
  }, [reposted, interactionId, post.id, post.authorUsername, post.caption, navigation]);

  const doRepost = useCallback(async (targetId: string, wasReposted: boolean) => {
    repostingRef.current = true;
    hasInteractedRepost.current = true;

    // Optimistic
    setReposted(!wasReposted);
    setRepostCount(prev => Math.max(0, prev + (wasReposted ? -1 : 1)));

    try {
      const uid = getUid();
      if (!uid) {
        Alert.alert('Sign In Required', 'Please sign in to repost.');
        setReposted(wasReposted);
        setRepostCount(prev => Math.max(0, prev + (wasReposted ? 1 : -1)));
        repostingRef.current = false;
        return;
      }

      const result: ToggleRepostResult = await toggleRepost(targetId, wasReposted);

      if (!result.success) {
        setReposted(wasReposted);
        setRepostCount(prev => Math.max(0, prev + (wasReposted ? 1 : -1)));
      }
      // If success and undone, the parent should remove the repost card from the list
      // We notify via onRepost callback
    } catch (e: any) {
      console.error('[PostActionsBar] Repost error:', e);
      setReposted(wasReposted);
      setRepostCount(prev => Math.max(0, prev + (wasReposted ? 1 : -1)));
    } finally {
      repostingRef.current = false;
      try { onRepost?.(targetId, wasReposted); } catch {}
    }
  }, [onRepost]);

  // ── BOOKMARK ────────────────────────────────────────────────────────
  const handleBookmarkPress = useCallback(async () => {
    if (bookmarkingRef.current) return;
    bookmarkingRef.current = true;
    hasInteractedBookmark.current = true;

    const wasBookmarked = bookmarked;
    const targetId = interactionId || post.id;

    if (!targetId) {
      bookmarkingRef.current = false;
      return;
    }

    setBookmarked(!wasBookmarked);

    try {
      const uid = getUid();
      if (!uid) {
        Alert.alert('Sign In Required', 'Please sign in to bookmark posts.');
        setBookmarked(wasBookmarked);
        bookmarkingRef.current = false;
        return;
      }

      await toggleBookmark(targetId, wasBookmarked);
    } catch (e: any) {
      console.error('[PostActionsBar] Bookmark error:', e);
      setBookmarked(wasBookmarked);
    } finally {
      bookmarkingRef.current = false;
      try { onBookmark?.(targetId, wasBookmarked); } catch {}
    }
  }, [bookmarked, interactionId, post.id, onBookmark]);

  // ── COMMENT ─────────────────────────────────────────────────────────
  const handleCommentPress = useCallback(() => {
    const targetId = interactionId || post.id;
    if (targetId) onComment(targetId);
  }, [interactionId, post.id, onComment]);

  // ── SHARE ───────────────────────────────────────────────────────────
  const handleSharePress = useCallback(async () => {
    if (onShare) {
      onShare();
      return;
    }
    try {
      await Share.share({ message: 'Check out this post on Black94!' });
    } catch {}
  }, [onShare]);

  // ── Guard ───────────────────────────────────────────────────────────
  if (!interactionId && !post.id) {
    return null;
  }

  const isDetail = variant === 'detail';
  const iconSize = isDetail ? 'lg' : 'md';
  const repostIconSize = isDetail ? 20 : 18;

  return (
    <View style={styles.actions}>
      {/* Comment */}
      <TouchableOpacity style={styles.actionBtn} onPress={handleCommentPress}>
        <View style={[styles.actionIconWrap, isDetail && styles.actionIconWrapLarge]}>
          <AppIcon name="chat-bubble-outline" size={iconSize} color={colors.textSecondary} />
        </View>
        {formatCount(post.commentCount) ? (
          <Text style={styles.actionCount}>{formatCount(post.commentCount)}</Text>
        ) : null}
      </TouchableOpacity>

      {/* Repost */}
      <TouchableOpacity style={styles.actionBtn} onPress={handleRepostPress}>
        <View style={[styles.actionIconWrap, isDetail && styles.actionIconWrapLarge]}>
          <RepostIcon
            size={repostIconSize}
            color={reposted ? colors.repost : colors.textSecondary}
          />
        </View>
        {formatCount(repostCount) ? (
          <Text style={[styles.actionCount, reposted && { color: colors.repost }]}>
            {formatCount(repostCount)}
          </Text>
        ) : null}
      </TouchableOpacity>

      {/* Like */}
      <TouchableOpacity style={styles.actionBtn} onPress={handleLikePress}>
        <View style={[styles.actionIconWrap, isDetail && styles.actionIconWrapLarge]}>
          {liked ? (
            <AppIcon name="favorite" size={iconSize} color={colors.like} />
          ) : (
            <AppIcon name="favorite-border" size={iconSize} color={colors.textSecondary} />
          )}
        </View>
        {formatCount(likeCount) ? (
          <Text style={[styles.actionCount, liked && { color: colors.like }]}>
            {formatCount(likeCount)}
          </Text>
        ) : null}
      </TouchableOpacity>

      {/* Views */}
      <TouchableOpacity style={styles.actionBtn} disabled>
        <View style={[styles.actionIconWrap, isDetail && styles.actionIconWrapLarge]}>
          <AppIcon name="trending-up" size={iconSize} color={colors.textSecondary} />
        </View>
        {formatCount(post.viewCount) ? (
          <Text style={styles.actionCount}>{formatCount(post.viewCount)}</Text>
        ) : null}
      </TouchableOpacity>

      {/* Bookmark + Share */}
      <View style={styles.actionPair}>
        <TouchableOpacity style={styles.actionBtn} onPress={handleBookmarkPress}>
          <View style={[styles.actionIconWrap, isDetail && styles.actionIconWrapLarge]}>
            {bookmarked ? (
              <AppIcon name="bookmark" size={iconSize} color={colors.bookmark} />
            ) : (
              <AppIcon name="bookmark-border" size={iconSize} color={colors.textSecondary} />
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={handleSharePress}>
          <View style={[styles.actionIconWrap, isDetail && styles.actionIconWrapLarge]}>
            <AppIcon name="share" size={iconSize} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default PostActionsBar;

/* ── Styles ───────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginLeft: -4,
    maxWidth: 440,
    justifyContent: 'space-between',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
  },
  actionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconWrapLarge: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  actionCount: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  actionPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
});
