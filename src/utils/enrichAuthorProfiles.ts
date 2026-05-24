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

  // Apply latest user doc data to each post (in-place mutation)
  for (const post of posts) {
    const fresh = profileMap.get(post.authorId);
    if (!fresh) continue;
    // Always use the latest displayName/username from the user doc so that
    // profile name changes reflect immediately. Only skip if the user doc
    // has EMPTY values (corrupted doc) — keep the post's stamped data as fallback.
    if (fresh.displayName) post.authorDisplayName = fresh.displayName;
    if (fresh.username) post.authorUsername = fresh.username;
    if (fresh.profileImage) post.authorProfileImage = fresh.profileImage;
    if (fresh.badge) post.authorBadge = fresh.badge;
    post.authorIsVerified = fresh.isVerified;
  }
}
