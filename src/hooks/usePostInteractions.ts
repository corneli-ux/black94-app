/**
 * usePostInteractions — single source of truth for post interaction handlers.
 *
 * Provides handleLike, handleBookmark, handleRepost, handleDelete that work
 * identically across ALL screens (FeedScreen, ProfileScreen, UserProfileScreen,
 * BookmarksScreen, PostDetailScreen, etc.).
 *
 * Usage for list-based screens (feed, profile):
 *   const { handlers } = usePostInteractions({ posts, setPosts, currentUserUid });
 *   <PostCard onLike={handlers.like} onBookmark={handlers.bookmark} ... />
 *
 * Usage for single-post screens (PostDetailScreen):
 *   const { single } = usePostInteractions({ posts: [post], setPosts: setPostWrapper, currentUserUid });
 *   // single.like(), single.bookmark(), etc. — returns { value, count }
 */

import { useCallback, useMemo, useRef } from 'react';
import { auth, firestore } from '../lib/firebase';
import { toggleLike, toggleBookmark, toggleRepost, ToggleRepostResult, Post, parseMediaUrls } from '../lib/api';

/* ── Types ─────────────────────────────────────────────────────────────────── */

/** Map of post ID → boolean (liked, bookmarked, reposted) */
type BoolMap = Record<string, boolean>;

export interface ListHandlers {
  /** Optimistic like toggle. postId = post.repostOf || post.id */
  like: (postId: string, currentlyLiked: boolean) => void;
  /** Optimistic bookmark toggle. postId = post.repostOf || post.id */
  bookmark: (postId: string, currentlyBookmarked: boolean) => void;
  /** Optimistic repost toggle. postId = post.repostOf || post.id */
  repost: (postId: string, currentlyReposted: boolean) => void;
  /** Delete a post from the list */
  delete: (postId: string) => void;
}

export interface SinglePostState {
  liked: boolean;
  likeCount: number;
  bookmarked: boolean;
  reposted: boolean;
  repostCount: number;
}

export interface SingleHandlers {
  like: () => Promise<void>;
  bookmark: () => Promise<void>;
  repost: () => Promise<void>;
  share: () => Promise<void>;
  state: SinglePostState;
}

interface UsePostInteractionsOptions {
  /** The posts array (for list screens) or a single-element array (for detail screens) */
  posts: Post[];
  /** State setter that replaces the posts array */
  setPosts: React.Dispatch<React.SetStateAction<Post[]>>;
  /** Current user's UID — pass null if not authenticated */
  currentUserUid: string | null;
}

/* ── Hook ──────────────────────────────────────────────────────────────────── */

export function usePostInteractions({
  posts,
  setPosts,
  currentUserUid,
}: UsePostInteractionsOptions) {

  // ── In-flight guard ─────────────────────────────────────────────────────
  const inflightRef = useRef(new Set<string>());

  const isInflight = useCallback((key: string): boolean => {
    return inflightRef.current.has(key);
  }, []);

  const markInflight = useCallback((key: string): boolean => {
    if (inflightRef.current.has(key)) return false; // already in-flight
    inflightRef.current.add(key);
    return true;
  }, []);

  const releaseInflight = useCallback((key: string) => {
    inflightRef.current.delete(key);
  }, []);

  // ── Helper: resolve interaction target ─────────────────────────────────
  // For reposts, ALL interactions target the ORIGINAL post.
  // interactionId = post.repostOf || post.id
  // But handlers receive interactionId directly, so this is just for documentation.

  // ── Helper: optimistic update on matching posts ─────────────────────────
  // Matches BOTH the wrapper post (p.id === postId) AND any repost wrapper
  // pointing to the same original (p.repostOf === postId).
  const updateMatchingPosts = useCallback((
    updater: (p: Post) => Post,
    postId: string,
  ) => {
    setPosts(prev => prev.map(p =>
      (p.id === postId || p.repostOf === postId) ? updater(p) : p
    ));
  }, [setPosts]);

  // ══════════════════════════════════════════════════════════════════════
  // LIKE
  // ══════════════════════════════════════════════════════════════════════
  const handleLike = useCallback(async (
    postId: string,
    currentlyLiked: boolean,
  ) => {
    const key = `like_${postId}`;
    if (!markInflight(key)) return; // drop double-tap

    // Optimistic: toggle liked + count on ALL matching posts
    updateMatchingPosts(p => ({
      ...p,
      liked: !currentlyLiked,
      likeCount: Math.max(0, p.likeCount + (currentlyLiked ? -1 : 1)),
    }), postId);

    try {
      await toggleLike(postId, currentlyLiked);
    } catch (e) {
      // Revert on error
      updateMatchingPosts(p => ({
        ...p,
        liked: currentlyLiked,
        likeCount: Math.max(0, p.likeCount + (currentlyLiked ? 1 : -1)),
      }), postId);
    } finally {
      releaseInflight(key);
    }
  }, [markInflight, releaseInflight, updateMatchingPosts]);

  // ══════════════════════════════════════════════════════════════════════
  // BOOKMARK
  // ══════════════════════════════════════════════════════════════════════
  const handleBookmark = useCallback(async (
    postId: string,
    currentlyBookmarked: boolean,
  ) => {
    const key = `bm_${postId}`;
    if (!markInflight(key)) return;

    updateMatchingPosts(p => ({
      ...p,
      bookmarked: !currentlyBookmarked,
    }), postId);

    try {
      await toggleBookmark(postId, currentlyBookmarked);
    } catch (e) {
      updateMatchingPosts(p => ({
        ...p,
        bookmarked: currentlyBookmarked,
      }), postId);
    } finally {
      releaseInflight(key);
    }
  }, [markInflight, releaseInflight, updateMatchingPosts]);

  // ══════════════════════════════════════════════════════════════════════
  // REPOST
  // ══════════════════════════════════════════════════════════════════════
  const handleRepost = useCallback(async (
    postId: string,
    currentlyReposted: boolean,
  ) => {
    const key = `rp_${postId}`;
    if (!markInflight(key)) return;

    // Optimistic: toggle reposted + count
    updateMatchingPosts(p => ({
      ...p,
      reposted: !currentlyReposted,
      repostCount: Math.max(0, p.repostCount + (currentlyReposted ? -1 : 1)),
    }), postId);

    try {
      const result: ToggleRepostResult = await toggleRepost(postId, currentlyReposted);

      if (!result.success) {
        // API returned failure — revert
        updateMatchingPosts(p => ({
          ...p,
          reposted: currentlyReposted,
          repostCount: Math.max(0, p.repostCount + (currentlyReposted ? 1 : -1)),
        }), postId);
        return;
      }

      if (result.undone) {
        // Undo succeeded — remove the repost wrapper from the list
        const removedRepostId = `repost_${postId}_${currentUserUid}`;
        setPosts(prev => prev.filter(p => p.id !== removedRepostId));
        return;
      }

      // New repost succeeded — prepend the returned repost doc to the list
      if (!currentlyReposted && result.repostDoc) {
        const rd = result.repostDoc;
        const newPost: Post = {
          id: rd.id,
          authorId: rd.authorId,
          authorUsername: rd.authorUsername,
          authorDisplayName: rd.authorDisplayName,
          authorProfileImage: rd.authorProfileImage,
          authorBadge: rd.authorBadge,
          authorIsVerified: rd.authorIsVerified,
          caption: rd.caption,
          mediaUrls: Array.isArray(rd.mediaUrls) ? rd.mediaUrls : [],
          pollData: rd.pollData || undefined,
          likeCount: rd.likeCount || 0,
          commentCount: rd.commentCount || 0,
          repostCount: rd.repostCount || 0,
          viewCount: rd.viewCount || 0,
          liked: false,
          bookmarked: false,
          reposted: true,
          createdAt: Date.now(),
          repostOf: rd.repostOf,
          repostedByUid: rd.repostedByUid,
          repostedByUsername: rd.repostedByUsername,
          repostedByDisplayName: rd.repostedByDisplayName,
          visibility: 'public',
          factCheckVerified: (rd as any).factCheckVerified || 0,
          factCheckDebunked: (rd as any).factCheckDebunked || 0,
        };

        // Prepend only if not already present (guard against double-tap races)
        setPosts(prev =>
          prev.some(p => p.id === newPost.id) ? prev : [newPost, ...prev]
        );
      }
    } catch (e) {
      // Network/unknown error — revert
      updateMatchingPosts(p => ({
        ...p,
        reposted: currentlyReposted,
        repostCount: Math.max(0, p.repostCount + (currentlyReposted ? 1 : -1)),
      }), postId);
    } finally {
      releaseInflight(key);
    }
  }, [markInflight, releaseInflight, updateMatchingPosts, currentUserUid, setPosts]);

  // ══════════════════════════════════════════════════════════════════════
  // DELETE
  // ══════════════════════════════════════════════════════════════════════
  const handleDelete = useCallback(async (postId: string) => {
    try {
      await firestore().collection('posts').doc(postId).delete();
      // Remove the original post AND any repost wrappers pointing to it
      setPosts(prev => prev.filter(p => p.id !== postId && p.repostOf !== postId));
    } catch (e) {
      if (__DEV__) console.error('[usePostInteractions] Delete error:', e);
    }
  }, [setPosts]);

  // ── Return list handlers ──────────────────────────────────────────────
  const handlers: ListHandlers = useMemo(() => ({
    like: handleLike,
    bookmark: handleBookmark,
    repost: handleRepost,
    delete: handleDelete,
  }), [handleLike, handleBookmark, handleRepost, handleDelete]);

  return { handlers };
}
