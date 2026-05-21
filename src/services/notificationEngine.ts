/**
 * In-App Notification Engine — polls Firestore for new notifications.
 *
 * Reads/writes the flat `notifications` collection (already used by
 * NotificationsScreen and checkAndSendFollowUps). Each document has:
 *   - recipientId: string
 *   - type: 'follow' | 'like' | 'comment' | 'repost' | 'mention' | 'chat'
 *   - actorId, actorDisplayName, actorUsername, actorProfileImage
 *   - actorIsVerified?, actorBadge?
 *   - postId?, postCaption?, commentContent?
 *   - read: boolean
 *   - createdAt: server timestamp
 */

import { firestore, auth } from '../lib/firebase';

const POLL_INTERVAL = 5000; // 5 seconds (faster for better UX)
let pollTimer: ReturnType<typeof setInterval> | null = null;
let initialPollTimer: ReturnType<typeof setTimeout> | null = null;

// ── Polling ─────────────────────────────────────────────────────────────────

/**
 * Start polling Firestore for unread notifications for the given user.
 * Calls `onNewNotification(count)` whenever the unread count changes.
 */
export function startNotificationPolling(
  userId: string,
  onNewNotification: (count: number) => void,
): void {
  stopNotificationPolling();

  let lastKnownCount = -1;

  // Defer first poll by 2 seconds to avoid competing with feed load at startup
  initialPollTimer = setTimeout(() => {
    initialPollTimer = null;
    pollUnread(userId).then((count) => {
      lastKnownCount = count;
      onNewNotification(count);
    }).catch((e) => {
      // CRITICAL FIX: If the initial poll fails (index missing, network error, etc.),
      // set lastKnownCount to 0 instead of leaving it at -1.
      // Without this, the interval guard (lastKnownCount === -1) permanently
      // kills ALL future polling, and the badge never updates.
      console.warn('[NotificationEngine] Initial poll failed, using 0:', e?.message || e);
      lastKnownCount = 0;
      onNewNotification(0);
    });
  }, 2000);

  pollTimer = setInterval(async () => {
    try {
      if (lastKnownCount === -1) return;
      const count = await pollUnread(userId);
      if (count !== lastKnownCount) {
        lastKnownCount = count;
        onNewNotification(count);
      }
    } catch (e) {
      console.warn('[NotificationEngine] Poll error:', e);
    }
  }, POLL_INTERVAL);

  console.log('[NotificationEngine] Polling started for user:', userId);
}

/**
 * Stop the notification polling timer.
 */
export function stopNotificationPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[NotificationEngine] Polling stopped');
  }
  if (initialPollTimer) {
    clearTimeout(initialPollTimer);
    initialPollTimer = null;
  }
}

/**
 * Get the count of unread notifications for a user.
 */
async function pollUnread(userId: string): Promise<number> {
  const snapshot = await firestore()
    .collection('notifications')
    .where('recipientId', '==', userId)
    .where('read', '==', false)
    .get();

  return snapshot.size;
}

// ── Create Notification ─────────────────────────────────────────────────────

export interface CreateNotificationParams {
  recipientId: string;
  type: 'follow' | 'like' | 'comment' | 'repost' | 'mention' | 'chat' | 'story_view' | 'milestone' | 'suggestion' | 'call';
  actorId: string;
  actorDisplayName: string;
  actorUsername: string;
  actorProfileImage: string | null;
  actorIsVerified?: boolean;
  actorBadge?: string;
  postId?: string;
  postCaption?: string;
  commentContent?: string;
}

/**
 * Create a notification document for a recipient.
 * Uses a deterministic doc ID to avoid duplicates for the same event.
 * Format: `{type}_{actorId}_{postId}` (or `{type}_{actorId}` for follows).
 *
 * BUG FIX: Added block check — blocked users should NOT generate notifications.
 * BUG FIX: For comment type, use unique doc ID (with timestamp) to prevent
 * overwriting previous comment notifications from the same user on same post.
 * BUG FIX: Added input validation — empty recipientId/actorId or invalid type
 * should be silently rejected to prevent junk data in Firestore.
 */
export async function createNotification(
  params: CreateNotificationParams,
): Promise<void> {
  const me = auth()?.currentUser?.uid;
  if (me && params.actorId === params.recipientId) return;

  // BUG FIX: Input validation — prevent junk notifications
  if (!params.recipientId?.trim() || !params.actorId?.trim()) return;
  const validTypes = ['follow', 'like', 'comment', 'repost', 'mention', 'chat', 'story_view', 'milestone', 'suggestion', 'follow_up_reminder', 'call'];
  if (!validTypes.includes(params.type)) return;

  // BUG FIX: Don't notify if recipient has blocked the actor
  try {
    const blockDoc = await firestore().collection('blocks').doc(`${params.actorId}_${params.recipientId}`).get();
    if (blockDoc.exists) return;
  } catch {
    // If block check fails, allow notification (don't silently drop on network error)
  }

  const { recipientId, type, actorId, postId } = params;

  // Deterministic doc ID prevents duplicate notifications.
  // BUG FIX: For comments, use timestamp to allow multiple comments from
  // same user on same post (without it, second comment overwrites first).
  let docId: string;
  if (type === 'comment' && postId) {
    docId = `${type}_${actorId}_${postId}_${Date.now()}`;
  } else if (postId) {
    docId = `${type}_${actorId}_${postId}`;
  } else {
    docId = `${type}_${actorId}`;
  }

  try {
    await firestore()
      .collection('notifications')
      .doc(docId)
      .set({
        recipientId,
        type,
        actorId,
        actorDisplayName: params.actorDisplayName || '',
        actorUsername: params.actorUsername || '',
        actorProfileImage: params.actorProfileImage || null,
        actorIsVerified: params.actorIsVerified || false,
        actorBadge: params.actorBadge || '',
        postId: params.postId || '',
        postCaption: params.postCaption || '',
        commentContent: params.commentContent || '',
        read: false,
        createdAt: firestore.FieldValue.serverTimestamp(),
      });

    console.log(`[NotificationEngine] Created ${type} notification for ${recipientId}`);
  } catch (e) {
    // Notification creation should never break the main action (like, follow, etc.)
    console.warn('[NotificationEngine] Failed to create notification:', e);
  }
}

// ── Engagement Notifications ────────────────────────────────────────────────

/**
 * Create a system-generated engagement notification (milestone, suggestion, etc.).
 * These come from the "system" actor (Black94 platform).
 */
export async function createEngagementNotification(
  recipientId: string,
  type: 'milestone' | 'suggestion',
  title: string,
  body: string,
): Promise<void> {
  const docId = `${type}_${recipientId}_${Date.now()}`;
  try {
    await firestore()
      .collection('notifications')
      .doc(docId)
      .set({
        recipientId,
        type,
        actorId: 'system',
        actorDisplayName: 'Black94',
        actorUsername: 'black94',
        actorProfileImage: null,
        actorIsVerified: true,
        actorBadge: 'gold',
        postId: '',
        postCaption: title,
        commentContent: body,
        read: false,
        createdAt: firestore.FieldValue.serverTimestamp(),
      });
  } catch (e) {
    console.warn('[NotificationEngine] Engagement notification failed:', e);
  }
}

// ── Mark Read ───────────────────────────────────────────────────────────────

/**
 * Mark all unread notifications as read for a given user.
 *
 * BUG FIX: Use batched loop to handle >100 unread notifications.
 * The old code capped at limit(100), leaving excess unread forever.
 */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  try {
    let totalMarked = 0;
    let hasMore = true;
    while (hasMore) {
      const snapshot = await firestore()
        .collection('notifications')
        .where('recipientId', '==', userId)
        .where('read', '==', false)
        .limit(100)
        .get();

      hasMore = snapshot.docs.length === 100;
      const updates: Promise<any>[] = [];
      for (const doc of snapshot.docs) {
        updates.push(doc.ref.update({ read: true }));
      }
      await Promise.all(updates);
      totalMarked += snapshot.docs.length;
      if (snapshot.docs.length === 0) break;
    }
    console.log(`[NotificationEngine] Marked ${totalMarked} notifications as read`);
  } catch (e) {
    console.warn('[NotificationEngine] Failed to mark notifications read:', e);
  }
}
