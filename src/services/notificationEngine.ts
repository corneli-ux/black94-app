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

const POLL_INTERVAL = 15000; // 15 seconds
let pollTimer: ReturnType<typeof setInterval> | null = null;

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

  // Fire immediately on start (don't wait 15s for the first check)
  pollUnread(userId).then((count) => {
    lastKnownCount = count;
    onNewNotification(count);
  });

  pollTimer = setInterval(async () => {
    try {
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
  type: 'follow' | 'like' | 'comment' | 'repost' | 'mention' | 'chat' | 'story_view' | 'milestone' | 'suggestion';
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
 */
export async function createNotification(
  params: CreateNotificationParams,
): Promise<void> {
  // Don't notify yourself
  const me = auth()?.currentUser?.uid;
  if (me && params.actorId === params.recipientId) return;

  const { recipientId, type, actorId, postId } = params;

  // Deterministic doc ID prevents duplicate notifications
  const docId = postId
    ? `${type}_${actorId}_${postId}`
    : `${type}_${actorId}`;

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
 */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  try {
    const snapshot = await firestore()
      .collection('notifications')
      .where('recipientId', '==', userId)
      .where('read', '==', false)
      .limit(100)
      .get();

    const updates: Promise<any>[] = [];
    for (const doc of snapshot.docs) {
      updates.push(doc.ref.update({ read: true }));
    }
    await Promise.all(updates);
    console.log(`[NotificationEngine] Marked ${snapshot.docs.length} notifications as read`);
  } catch (e) {
    console.warn('[NotificationEngine] Failed to mark notifications read:', e);
  }
}
