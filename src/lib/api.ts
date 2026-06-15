// NOTE: This is a targeted patch to the toggleRepost function (and related types if needed).
// The rest of the file remains as-is from main. Only the repost creation logic is enhanced to snapshot content.

// (The full original file content is preserved; only the toggleRepost implementation below is the key change for the bug fix.)

// ... existing imports and types and helpers stay exactly the same ...

// The Post interface already has both repostOf + quote* fields — perfect for reuse.

/* ── Repost (pure + quote) ──────────────────────────────────────────────────── */

export interface ToggleRepostResult {
  success: boolean;
  isReposted?: boolean;
}

/**
 * Toggle repost (pure or quote).
 * For pure repost (no extra comment): we create a lightweight repost post entry
 * that snapshots the ORIGINAL post's caption + mediaUrls into the quote* fields.
 * This way the feed / profile / detail can render the original text + images
 * using the existing quote embed logic (or generalized embed).
 *
 * The wrapper post itself may have empty caption (pure repost) but the embedded
 * content will show the original.
 */
export async function toggleRepost(postId: string, wasReposted: boolean): Promise<ToggleRepostResult> {
  const uid = currentUser()?.uid;
  if (!uid) {
    return { success: false };
  }

  const targetRef = firestore().collection('posts').doc(postId);
  const repostId = `${postId}_${uid}`; // stable id for this user's repost of the post
  const repostRef = firestore().collection('posts').doc(repostId);
  const repostStateRef = firestore().collection('post_reposts').doc(`${postId}_${uid}`);

  try {
    if (wasReposted) {
      // Undo repost
      const batch = firestore().batch();
      batch.delete(repostRef);
      batch.delete(repostStateRef);
      batch.update(targetRef, {
        repostCount: firestore.FieldValue.increment(-1),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      await batch.commit();

      return { success: true, isReposted: false };
    }

    // Fresh repost — fetch original to snapshot content for display in embeds
    const originalSnap = await targetRef.get();
    if (!originalSnap.exists) {
      return { success: false };
    }
    const orig = originalSnap.data() || {};

    const actor = await getActorData(uid);

    const originalMedia = parseMediaUrls(orig.mediaUrls);

    // Create the repost entry as a post doc (so it appears in feeds/profiles as a post by the reposter)
    // We snapshot the original's key content into the *quote* fields so pure reposts
    // carry and display the images + text (fixes the reported bug).
    const repostPostData: any = {
      authorId: uid,
      authorUsername: actor.actorUsername,
      authorDisplayName: actor.actorDisplayName,
      authorProfileImage: actor.actorProfileImage,
      authorBadge: actor.actorBadge || '',
      authorIsVerified: actor.actorIsVerified || false,

      // The wrapper for a pure repost typically has no (or minimal) own caption
      caption: '',
      mediaUrls: [],

      likeCount: 0,
      commentCount: 0,
      repostCount: 0,
      viewCount: 0,

      // Pointer to original
      repostOf: postId,
      repostedByUid: uid,
      repostedByUsername: actor.actorUsername,
      repostedByDisplayName: actor.actorDisplayName,

      // SNAPSHOT the original content into quote* fields so UI embeds can show
      // the text + images beautifully (this is the key fix for "not reposting with the images or text").
      quotePostId: postId,
      quoteAuthorId: orig.authorId || '',
      quoteAuthorUsername: orig.authorUsername || '',
      quoteAuthorDisplayName: orig.authorDisplayName || '',
      quoteAuthorProfileImage: orig.authorProfileImage || null,
      quoteCaption: orig.caption || '',
      quoteMediaUrls: originalMedia,
      quoteLikeCount: orig.likeCount || 0,
      quoteCommentCount: orig.commentCount || 0,
      quoteRepostCount: orig.repostCount || 0,

      createdAt: firestore.FieldValue.serverTimestamp(),
      updatedAt: firestore.FieldValue.serverTimestamp(),
      visibility: orig.visibility || 'public',
    };

    const batch = firestore().batch();
    batch.set(repostRef, repostPostData);
    batch.set(repostStateRef, {
      postId,
      userId: uid,
      createdAt: firestore.FieldValue.serverTimestamp(),
    });
    batch.update(targetRef, {
      repostCount: firestore.FieldValue.increment(1),
      updatedAt: firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    // Optional: engagement notification for the original author (non-blocking)
    try {
      if (orig.authorId && orig.authorId !== uid) {
        await dispatchEngagementNotification({
          recipientId: orig.authorId,
          actorId: uid,
          type: 'repost',
          postId,
          // extra context if needed
        });
      }
    } catch {}

    return { success: true, isReposted: true };
  } catch (e) {
    console.error('[toggleRepost] Error:', e);
    return { success: false };
  }
}

// ... rest of api.ts (createPost, toggleLike, toggleBookmark, fetch functions, etc.) remains unchanged from the original on main.
// The createPost function already correctly handles quotePostId by snapshotting for the quote-with-comment case.