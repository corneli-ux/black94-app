/**
 * enrichAuthorProfiles — Shared utility for hydrating post/comment author metadata
 * from the latest user documents in Firestore.
 *
 * When a user changes their display name, username, or avatar, the user document
 * is updated immediately but posts/comments still contain the OLD stamped values.
 * This function fetches the latest user docs (via userCache for performance)
 * and overwrites the stale author fields so that name/avatar changes reflect
 * everywhere without waiting for a background batch-update to propagate.
 *
 * CRITICAL FIX: This function creates NEW object references (via spread) instead
 * of mutating in-place. FeedScreen, ProfileScreen, and UserProfileScreen wrap
 * PostCard in React.memo — in-place mutations don't trigger re-renders because
 * the object reference stays the same (shallow equality check passes). By creating
 * new objects, React.memo detects the change and re-renders with updated names.
 *
 * PERF: Uses getUserProfilesBatch() which has a 2-minute TTL cache.
 * This eliminates redundant Firestore reads when the same authors appear
 * across feed, comments, bookmarks, etc.
 *
 * Used by: useFeed.ts, ProfileScreen.tsx, UserProfileScreen.tsx, BookmarksScreen.tsx,
 * SearchScreen.tsx, PostCommentsScreen.tsx, HashtagScreen.tsx, LikedPostsScreen.tsx.
 */

import { getUserProfilesBatch } from '../lib/userCache';

export async function enrichAuthorProfiles(posts: any[]): Promise<void> {
  if (!posts || posts.length === 0) return;

  const uniqueAuthorIds = [...new Set(posts.map((p: any) => p.authorId).filter(Boolean))];
  if (uniqueAuthorIds.length === 0) return;

  // Batch-fetch user profiles with built-in cache (2-min TTL)
  const profileMap = await getUserProfilesBatch(uniqueAuthorIds);

  // Create NEW object references for each enriched post so React.memo
  // detects the change and triggers a re-render with updated author info.
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const fresh = profileMap.get(post.authorId);
    if (!fresh) continue;

    let changed = false;
    const updates: Record<string, any> = {};

    // Always use the latest displayName/username from the user doc so that
    // profile name changes reflect immediately. Only skip if the user doc
    // has EMPTY values (corrupted doc) — keep the post's stamped data as fallback.
    if (fresh.displayName && fresh.displayName !== post.authorDisplayName) {
      updates.authorDisplayName = fresh.displayName;
      changed = true;
    }
    if (fresh.username && fresh.username !== post.authorUsername) {
      updates.authorUsername = fresh.username;
      changed = true;
    }
    if (fresh.profileImage && fresh.profileImage !== post.authorProfileImage) {
      updates.authorProfileImage = fresh.profileImage;
      changed = true;
    }
    if (fresh.badge !== undefined && fresh.badge !== post.authorBadge) {
      updates.authorBadge = fresh.badge;
      changed = true;
    }
    if (fresh.isVerified !== post.authorIsVerified) {
      updates.authorIsVerified = fresh.isVerified;
      changed = true;
    }

    // Only replace reference if something actually changed — avoids
    // unnecessary re-renders when data was already fresh
    if (changed) {
      posts[i] = { ...post, ...updates };
    }
  }
}
