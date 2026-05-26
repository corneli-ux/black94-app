/**
 * PostActionsBar — single shared component for ALL post action buttons.
 *
 * Used by: FeedScreen, ProfileScreen, UserProfileScreen, BookmarksScreen,
 * PostDetailScreen, HashtagScreen, PostCommentsScreen.
 *
 * Props:
 *   - post: The Post object (reads liked, reposted, bookmarked, counts)
 *   - interactionId: The post ID to target (post.repostOf || post.id)
 *   - onLike(postId, currentlyLiked): Called when like button pressed
 *   - onRepost(postId, currentlyReposted): Called when repost button pressed
 *   - onBookmark(postId, currentlyBookmarked): Called when bookmark pressed
 *   - onComment(postId): Called when comment pressed
 *   - onShare(): Called when share pressed
 *   - navigation: React Navigation ref (needed for quote repost navigation)
 *
 * The component does NOT manage any state — it reads from the post prop
 * and delegates ALL actions to the parent via callbacks. This ensures
 * optimistic updates and API calls are handled in ONE place by
 * usePostInteractions or useFeed hooks.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Share } from 'react-native';
import { colors } from '../theme/colors';
import { AppIcon, RepostIcon } from './icons';

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function formatCount(n: number | undefined): string {
  if (!n) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

/* ── Types ───────────────────────────────────────────────────────────────── */

export interface PostActionsBarProps {
  /** The full Post object — reads liked, reposted, bookmarked, and counts */
  post: {
    liked?: boolean;
    reposted?: boolean;
    bookmarked?: boolean;
    likeCount?: number;
    repostCount?: number;
    commentCount?: number;
    viewCount?: number;
    // For quote repost navigation
    authorUsername?: string;
    caption?: string;
    // Repost info for undo
    repostOf?: string;
    id?: string;
  };
  /** The target post ID: post.repostOf || post.id */
  interactionId: string;
  /** Like callback: (targetPostId, currentlyLiked) => void */
  onLike: (postId: string, currentlyLiked: boolean) => void;
  /** Repost callback: (targetPostId, currentlyReposted) => void */
  onRepost: (postId: string, currentlyReposted: boolean) => void;
  /** Bookmark callback: (targetPostId, currentlyBookmarked) => void */
  onBookmark: (postId: string, currentlyBookmarked: boolean) => void;
  /** Comment callback: (targetPostId) => void */
  onComment: (postId: string) => void;
  /** Share callback: () => void */
  onShare?: () => void;
  /** React Navigation ref — used for quote repost navigation */
  navigation?: any;
  /** Style variant: 'feed' (default) or 'detail' (slightly larger) */
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

  // ── Repost handler: undo if already reposted, else show options ──────
  const handleRepostPress = () => {
    console.log('[PostActionsBar] Repost pressed — interactionId:', interactionId, 'currentlyReposted:', post.reposted);

    if (post.reposted) {
      // Already reposted — undo it directly
      console.log('[PostActionsBar] Undoing repost for:', interactionId);
      onRepost(interactionId, true);
      return;
    }

    // Show options: Repost or Quote Repost
    Alert.alert('Repost', 'How would you like to repost?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Repost',
        onPress: () => {
          console.log('[PostActionsBar] Simple repost for:', interactionId);
          onRepost(interactionId, false);
        },
      },
      {
        text: 'Quote Repost',
        onPress: () => {
          if (navigation) {
            navigation.navigate('CreatePost', {
              quotePostId: interactionId,
              quoteAuthor: `@${post.authorUsername || 'user'}`,
              quoteCaption: (post.caption || '').slice(0, 100),
            });
          }
        },
      },
    ]);
  };

  // ── Like handler ─────────────────────────────────────────────────────
  const handleLikePress = () => {
    console.log('[PostActionsBar] Like pressed — interactionId:', interactionId, 'currentlyLiked:', post.liked);
    onLike(interactionId, !!post.liked);
  };

  // ── Bookmark handler ────────────────────────────────────────────────
  const handleBookmarkPress = () => {
    console.log('[PostActionsBar] Bookmark pressed — interactionId:', interactionId, 'currentlyBookmarked:', post.bookmarked);
    onBookmark(interactionId, !!post.bookmarked);
  };

  // ── Comment handler ─────────────────────────────────────────────────
  const handleCommentPress = () => {
    console.log('[PostActionsBar] Comment pressed — interactionId:', interactionId);
    onComment(interactionId);
  };

  // ── Share handler ───────────────────────────────────────────────────
  const handleSharePress = async () => {
    if (onShare) {
      onShare();
      return;
    }
    try {
      await Share.share({ message: 'Check out this post on Black94!' });
    } catch {}
  };

  const isDetail = variant === 'detail';

  return (
    <View style={styles.actions}>
      {/* Comment */}
      <TouchableOpacity style={styles.actionBtn} onPress={handleCommentPress}>
        <View style={[styles.actionIconWrap, isDetail && styles.actionIconWrapLarge]}>
          <AppIcon name="chat-bubble-outline" size={isDetail ? 'lg' : 'md'} color={colors.textSecondary} />
        </View>
        {formatCount(post.commentCount) ? (
          <Text style={styles.actionCount}>{formatCount(post.commentCount)}</Text>
        ) : null}
      </TouchableOpacity>

      {/* Repost */}
      <TouchableOpacity style={styles.actionBtn} onPress={handleRepostPress}>
        <View style={[styles.actionIconWrap, isDetail && styles.actionIconWrapLarge]}>
          <RepostIcon
            size={isDetail ? 20 : 18}
            color={post.reposted ? colors.repost : colors.textSecondary}
          />
        </View>
        {formatCount(post.repostCount) ? (
          <Text style={[styles.actionCount, post.reposted && { color: colors.repost }]}>
            {formatCount(post.repostCount)}
          </Text>
        ) : null}
      </TouchableOpacity>

      {/* Like */}
      <TouchableOpacity style={styles.actionBtn} onPress={handleLikePress}>
        <View style={[styles.actionIconWrap, isDetail && styles.actionIconWrapLarge]}>
          {post.liked ? (
            <AppIcon name="favorite" size={isDetail ? 'lg' : 'md'} color={colors.like} />
          ) : (
            <AppIcon name="favorite-border" size={isDetail ? 'lg' : 'md'} color={colors.textSecondary} />
          )}
        </View>
        {formatCount(post.likeCount) ? (
          <Text style={[styles.actionCount, post.liked && { color: colors.like }]}>
            {formatCount(post.likeCount)}
          </Text>
        ) : null}
      </TouchableOpacity>

      {/* Views */}
      <TouchableOpacity style={styles.actionBtn} disabled>
        <View style={[styles.actionIconWrap, isDetail && styles.actionIconWrapLarge]}>
          <AppIcon name="trending-up" size={isDetail ? 'lg' : 'md'} color={colors.textSecondary} />
        </View>
        {formatCount(post.viewCount) ? (
          <Text style={styles.actionCount}>{formatCount(post.viewCount)}</Text>
        ) : null}
      </TouchableOpacity>

      {/* Bookmark + Share */}
      <View style={styles.actionPair}>
        <TouchableOpacity style={styles.actionBtn} onPress={handleBookmarkPress}>
          <View style={[styles.actionIconWrap, isDetail && styles.actionIconWrapLarge]}>
            {post.bookmarked ? (
              <AppIcon name="bookmark" size={isDetail ? 'lg' : 'md'} color={colors.bookmark} />
            ) : (
              <AppIcon name="bookmark-border" size={isDetail ? 'lg' : 'md'} color={colors.textSecondary} />
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={handleSharePress}>
          <View style={[styles.actionIconWrap, isDetail && styles.actionIconWrapLarge]}>
            <AppIcon name="share" size={isDetail ? 'lg' : 'md'} color={colors.textSecondary} />
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
