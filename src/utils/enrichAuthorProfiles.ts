/**
 * enrichAuthorProfiles — Shared utility for hydrating post/comment author metadata
 * from the latest user documents in Firestore.
 *
 * When a user changes their display name, username, or avatar, the user document
 * is updated immediately but posts/comments still contain the OLD stamped values.
 * This function fetches the latest user docs and overwrites the stale author
 * fields so that name/avatar changes reflect everywhere without waiting for a
 * background batch-update to propagate to every post document.
 *
 * Used by: useFeed.ts, ProfileScreen.tsx, UserProfileScreen.tsx, BookmarksScreen.tsx,
 * SearchScreen.tsx, PostCommentsScreen.tsx, HashtagScreen.tsx, LikedPostsScreen.tsx.
 */

import { firestore } from '../lib/firebase';

export async function enrichAuthorProfiles(posts: any[]): Promise<void> {
  if (!posts || posts.length === 0) return;

  const uniqueAuthorIds = [...new Set(posts.map((p: any) => p.authorId).filter(Boolean))];
  if (uniqueAuthorIds.length === 0) return;

  const CHUNK_SIZE = 10;
  const authorProfileMap: Record<string, any> = {};

  // Fetch user docs in chunks to avoid overwhelming Firestore
  for (let i = 0; i < uniqueAuthorIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueAuthorIds.slice(i, i + CHUNK_SIZE);
    try {
      const userDocs = await Promise.all(
        chunk.map(uid => firestore().collection('users').doc(uid).get().catch(() => null))
      );
      for (const docSnap of userDocs) {
        if (docSnap && docSnap.exists) {
          const d = docSnap.data()!;
          authorProfileMap[docSnap.id] = {
            username: d.username || '',
            displayName: d.displayName || '',
            profileImage: d.profileImage || null,
            badge: d.badge || '',
            isVerified: d.isVerified || false,
          };
        }
      }
    } catch (e) {
      console.warn('[enrichAuthorProfiles] Batch user doc fetch failed:', e);
    }
  }

  // Apply latest user doc data to each post (in-place mutation)
  for (const post of posts) {
    const fresh = authorProfileMap[post.authorId];
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
