/**
 * PostActionsBar — self-contained post action buttons.
 * 
 * Contract with api.ts:
 *  toggleLike:     throws on error, returns true=liked / false=unliked
 *  toggleBookmark: throws on error, returns true=bookmarked / false=unbookmarked  
 *  toggleRepost:   returns { success, undone }
 * 
 * Pattern: optimistic update → API call → revert ONLY on throw/exception
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Share } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { RepostIcon } from './icons';
import { toggleLike, toggleRepost, toggleBookmark, ToggleRepostResult } from '../lib/api';
import { auth } from '../lib/firebase';

function formatCount(n: number | undefined): string {
  if (!n) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
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
      const result: ToggleRepostResult = await toggleRepost(targetId, wasReposted);
      if (!result.success) {
        setReposted(wasReposted);
        setRepostCount(prev => Math.max(0, prev + (wasReposted ? 1 : -1)));
      } else {
        onRepost?.(targetId, wasReposted);
      }
    } catch {
      setReposted(wasReposted);
      setRepostCount(prev => Math.max(0, prev + (wasReposted ? 1 : -1)));
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
      <TouchableOpacity style={styles.btn} onPress={handleCommentPress} hitSlop={8}>
        <Feather name="message-circle" size={sz} color={colors.textSecondary} />
        {post.commentCount ? <Text style={styles.count}>{formatCount(post.commentCount)}</Text> : null}
      </TouchableOpacity>

      {/* Repost */}
      <TouchableOpacity style={styles.btn} onPress={handleRepostPress} hitSlop={8}>
        <RepostIcon size={repostSz} color={reposted ? colors.repost : colors.textSecondary} />
        {repostCount ? (
          <Text style={[styles.count, reposted && { color: colors.repost }]}>{formatCount(repostCount)}</Text>
        ) : null}
      </TouchableOpacity>

      {/* Like */}
      <TouchableOpacity style={styles.btn} onPress={handleLikePress} hitSlop={8}>
        <Feather
          name={liked ? "heart" : "heart"}
          size={sz}
          color={liked ? colors.like : colors.textSecondary}
        />
        {likeCount ? (
          <Text style={[styles.count, liked && { color: colors.like }]}>{formatCount(likeCount)}</Text>
        ) : null}
      </TouchableOpacity>

      {/* Views */}
      <View style={styles.btn}>
        <Feather name="bar-chart-2" size={sz} color={colors.textSecondary} />
        {post.viewCount ? <Text style={styles.count}>{formatCount(post.viewCount)}</Text> : null}
      </View>

      {/* Bookmark + Share */}
      <View style={styles.endGroup}>
        <TouchableOpacity style={styles.btn} onPress={handleBookmarkPress} hitSlop={8}>
          <Feather name="bookmark" size={sz} color={bookmarked ? colors.bookmark : colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={handleSharePress} hitSlop={8}>
          <Feather name="share" size={sz} color={colors.textSecondary} />
        </TouchableOpacity>
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
    marginTop: 10,
    marginLeft: -2,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 2,
    minWidth: 32,
  },
  count: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '400',
  },
  endGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
});
