/**
 * Engagement Engine — comprehensive notification + engagement system.
 *
 * Extends the basic in-app notification engine with:
 *   1. **Push Notification Dispatch** — sends push to recipient's devices
 *   2. **Smart Delivery** — rate limiting, batching, priority queuing
 *   3. **Milestone Tracking** — follower milestones, post milestones, streaks
 *   4. **Re-engagement Triggers** — inactive user detection, comeback prompts
 *   5. **Engagement Scoring** — compute user engagement score
 *   6. **Celebration Notifications** — achievements, anniversaries, goals
 *
 * This module is the central dispatch point for ALL notifications.
 * It writes to the Firestore `notifications` collection AND sends push.
 *
 * ARCHITECTURE NOTE:
 *   Firestore notification docs are ALWAYS written IMMEDIATELY (no delay).
 *   Only the push notification is batched (3s) to combine rapid-fire events
 *   (e.g. "5 people liked your post") into a single push.
 *   This prevents notifications from being lost if the sender closes the app
 *   within the batch window.
 */

import { firestore, auth } from '../lib/firebase';
import { sendPushToUser } from './pushNotifications';

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

export interface EngagementNotification {
  recipientId: string;
  type: 'follow' | 'like' | 'comment' | 'repost' | 'mention' | 'chat'
       | 'story_view' | 'milestone' | 'suggestion' | 'call'
       | 'follow_up_reminder' | 'welcome' | 'achievement' | 'reengagement'
       | 'trending' | 'new_follower_batch';
  actorId: string;
  actorDisplayName: string;
  actorUsername: string;
  actorProfileImage: string | null;
  actorIsVerified?: boolean;
  actorBadge?: string;
  postId?: string;
  postCaption?: string;
  commentContent?: string;
  chatId?: string;
  pushTitle?: string;
  pushBody?: string;
  pushData?: Record<string, string>;
  priority?: 'low' | 'normal' | 'high' | 'critical';
}

/* ═══════════════════════════════════════════════════════════════════════════
   RATE LIMITING — prevent notification spam
   ═══════════════════════════════════════════════════════════════════════════ */

// Track recent sends to prevent flooding (in-memory, resets on app restart)
const _rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_PER_WINDOW: Record<string, number> = {
  like: 5,        // Max 5 like notifications per minute
  comment: 10,
  follow: 5,
  repost: 5,
  mention: 5,
  chat: 10,       // Chat is high priority
  milestone: 2,
  achievement: 2,
  reengagement: 1,
  _default: 10,
};

function isRateLimited(recipientId: string, type: string): boolean {
  const key = `${recipientId}_${type}`;
  const now = Date.now();
  const max = MAX_PER_WINDOW[type] || MAX_PER_WINDOW._default;

  const timestamps = _rateLimitMap.get(key) || [];

  // Clean old entries
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);

  if (recent.length >= max) {
    _rateLimitMap.set(key, recent);
    return true; // Rate limited
  }

  recent.push(now);
  _rateLimitMap.set(key, recent);
  return false;
}

/* ═══════════════════════════════════════════════════════════════════════════
   PUSH BATCHING — combine push notifications of the same type
   ═══════════════════════════════════════════════════════════════════════════ */

// CRITICAL: Firestore notification docs are ALWAYS written immediately.
// Only the PUSH notification is batched (delayed to combine e.g. "5 people liked").
// Old code batched BOTH doc+push via setTimeout — if the sender closed the app
// within 3 seconds, the notification was lost entirely (no doc, no push).
const _pushBatch = new Map<string, { count: number; latestData: EngagementNotification; latestPushData: Record<string, string>; timer: any }>();
const BATCH_DELAY = 3000; // Wait 3 seconds to batch pushes

function getBatchKey(recipientId: string, type: string, postId?: string): string {
  return `${recipientId}_${type}${postId ? `_${postId}` : ''}`;
}

function batchPush(params: EngagementNotification, title: string, body: string, data: Record<string, string>): void {
  // Critical notifications and chat are never batched
  if (params.priority === 'critical' || params.type === 'chat') {
    sendPushToUser(params.recipientId, title, body, data).catch(() => {});
    return;
  }

  const key = getBatchKey(params.recipientId, params.type, params.postId);

  if (_pushBatch.has(key)) {
    // Already buffered — increment count, update with latest actor data
    const entry = _pushBatch.get(key)!;
    entry.count++;
    entry.latestData = params;
    entry.latestPushData = data;

    // Reset timer
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      _pushBatch.delete(key);
      const count = entry.count;
      const latest = entry.latestData;
      const pushData = entry.latestPushData;
      const batchTitle = count > 1 ? buildBatchTitle(latest, count) : title;
      const batchBody = count > 1 ? buildBatchBody(latest, count) : body;
      sendPushToUser(latest.recipientId, batchTitle, batchBody, pushData).catch(() => {});
    }, BATCH_DELAY);
  } else {
    // First notification of this type — buffer the push
    const capturedTitle = title;
    const capturedBody = body;
    const capturedData = data;
    const timer = setTimeout(() => {
      const entry = _pushBatch.get(key);
      _pushBatch.delete(key);
      // Use latestPushData if batch was updated, otherwise use captured
      const pushData = entry?.latestPushData || capturedData;
      sendPushToUser(params.recipientId, capturedTitle, capturedBody, pushData).catch(() => {});
    }, BATCH_DELAY);

    _pushBatch.set(key, {
      count: 1,
      latestData: params,
      latestPushData: data,
      timer,
    });
  }
}

/** Build batched push title when multiple actors trigger same notification */
function buildBatchTitle(params: EngagementNotification, count: number): string {
  switch (params.type) {
    case 'like': return `${count} people liked your post`;
    case 'comment': return `${count} people commented on your post`;
    case 'follow': return `${count} people started following you`;
    case 'repost': return `${count} people reposted your post`;
    default: return buildPushTitle(params);
  }
}

/** Build batched push body when multiple actors trigger same notification */
function buildBatchBody(params: EngagementNotification, count: number): string {
  const name = params.actorDisplayName || 'Someone';
  switch (params.type) {
    case 'like':
      return params.postCaption
        ? `"${params.postCaption.slice(0, 60)}" and ${count - 1} more`
        : `${name} and ${count - 1} others liked your post`;
    case 'follow':
      return `Including @${params.actorUsername || 'someone'}`;
    case 'repost':
      return params.postCaption
        ? `"${params.postCaption.slice(0, 60)}" and ${count - 1} more`
        : `${name} and ${count - 1} others reposted`;
    default:
      return buildPushBody(params);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CORE DISPATCH — the main entry point for all engagement notifications
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Dispatch an engagement notification — writes to Firestore AND sends push.
 *
 * This is the SINGLE entry point that all notification-creating code should use.
 * It handles:
 *   - Self-notification prevention
 *   - Block checking
 *   - Rate limiting
 *   - Push notification batching (doc is always written immediately)
 *   - Firestore persistence
 */
export async function dispatchEngagementNotification(
  params: EngagementNotification,
): Promise<void> {
  const me = auth()?.currentUser?.uid;
  if (me && params.actorId === params.recipientId) return;

  // Input validation
  if (!params.recipientId?.trim() || !params.actorId?.trim()) return;
  const validTypes = [
    'follow', 'like', 'comment', 'repost', 'mention', 'chat',
    'story_view', 'milestone', 'suggestion', 'call',
    'follow_up_reminder', 'welcome', 'achievement', 'reengagement',
    'trending', 'new_follower_batch',
  ];
  if (!validTypes.includes(params.type)) return;

  // Block check
  try {
    const blockDoc = await firestore()
      .collection('blocks')
      .doc(`${params.actorId}_${params.recipientId}`)
      .get();
    if (blockDoc.exists) return;
  } catch { /* Allow if block check fails — don't silently drop on network error */ }

  // Rate limiting (chat and critical bypass rate limits)
  if (params.type !== 'chat' && params.priority !== 'critical') {
    if (isRateLimited(params.recipientId, params.type)) {
      return;
    }
  }

  // Determine push title/body
  const pushTitle = params.pushTitle || buildPushTitle(params);
  const pushBody = params.pushBody || buildPushBody(params);
  const pushData = params.pushData || buildPushData(params);

  // ══════════════════════════════════════════════════════════════
  // STEP 1: Write Firestore notification doc IMMEDIATELY (no delay).
  // This ensures the notification ALWAYS appears in the tab, even if
  // the sender closes the app right after the action.
  // ══════════════════════════════════════════════════════════════
  const { recipientId, type, actorId, postId } = params;
  let docId: string;
  if (type === 'comment' && postId) {
    docId = `${type}_${actorId}_${postId}_${Date.now()}`;
  } else if (postId) {
    docId = `${type}_${actorId}_${postId}`;
  } else {
    docId = `${type}_${actorId}_${Date.now()}`;
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
      }, { merge: true });
  } catch (e) {
    console.warn('[EngagementEngine] Firestore write failed:', e);
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 2: Send push notification (batched for non-critical types).
  // Chat and critical notifications are sent immediately.
  // Likes/follows/etc. are batched for 3s to combine rapid-fire
  // events ("5 people liked your post") into one push.
  // ══════════════════════════════════════════════════════════════
  batchPush(params, pushTitle, pushBody, pushData);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PUSH CONTENT BUILDERS
   ═══════════════════════════════════════════════════════════════════════════ */

function buildPushTitle(params: EngagementNotification): string {
  const name = params.actorDisplayName || 'Someone';
  switch (params.type) {
    case 'like': return `${name} liked your post`;
    case 'comment': return `${name} commented on your post`;
    case 'follow': return `${name} started following you`;
    case 'repost': return `${name} reposted your post`;
    case 'mention': return `${name} mentioned you`;
    case 'chat': return `Message from ${name}`;
    case 'story_view': return `${name} viewed your story`;
    case 'milestone': return 'Congratulations!';
    case 'achievement': return 'New Achievement!';
    case 'call': return `Incoming call from ${name}`;
    case 'reengagement': return 'We miss you!';
    case 'trending': return 'Trending now';
    case 'welcome': return 'Welcome to Black94!';
    case 'suggestion': return 'Suggested for you';
    default: return 'Black94';
  }
}

function buildPushBody(params: EngagementNotification): string {
  switch (params.type) {
    case 'like':
      return params.postCaption
        ? `"${params.postCaption.slice(0, 80)}${params.postCaption.length > 80 ? '...' : ''}"`
        : 'Your post got a like';
    case 'comment':
      return params.commentContent
        ? `"${params.commentContent.slice(0, 100)}${params.commentContent.length > 100 ? '...' : ''}"`
        : 'New comment on your post';
    case 'follow':
      return `@${params.actorUsername} started following you`;
    case 'repost':
      return params.postCaption
        ? `"${params.postCaption.slice(0, 80)}${params.postCaption.length > 80 ? '...' : ''}"`
        : 'Your post was reposted';
    case 'mention':
      return params.postCaption
        ? `In: "${params.postCaption.slice(0, 80)}${params.postCaption.length > 80 ? '...' : ''}"`
        : 'You were mentioned';
    case 'chat':
      return 'Tap to view the conversation';
    case 'story_view':
      return 'Someone viewed your story';
    case 'milestone':
      return params.commentContent || 'You reached a new milestone!';
    case 'call':
      return 'Tap to answer';
    case 'reengagement':
      return 'See what you missed while you were away';
    case 'trending':
      return 'Check out what\'s trending on Black94';
    case 'welcome':
      return 'Start exploring and connect with people';
    case 'achievement':
      return params.commentContent || 'You unlocked something new!';
    default:
      return 'Tap to open';
  }
}

function buildPushData(params: EngagementNotification): Record<string, string> {
  const data: Record<string, string> = {
    type: params.type,
    recipientId: params.recipientId,
    actorId: params.actorId,
  };
  if (params.postId) data.postId = params.postId;
  if (params.actorUsername) data.actorUsername = params.actorUsername;
  if (params.chatId) data.chatId = params.chatId;
  return data;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MILESTONE TRACKING
   ═══════════════════════════════════════════════════════════════════════════ */

const FOLLOWER_MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 5000, 10000];
const POST_LIKE_MILESTONES = [10, 25, 50, 100, 500, 1000, 5000, 10000];

/**
 * Check and fire follower milestones.
 * Call this after a user gains a new follower.
 */
export async function checkFollowerMilestones(userId: string, followerCount: number): Promise<void> {
  for (const milestone of FOLLOWER_MILESTONES) {
    if (followerCount === milestone) {
      const milestoneKey = `milestone_followers_${milestone}`;
      try {
        // Check if we already sent this milestone
        const doc = await firestore()
          .collection('engagement_milestones')
          .doc(`${userId}_${milestoneKey}`)
          .get();
        if (doc.exists) continue; // Already sent

        // Mark as sent
        await firestore()
          .collection('engagement_milestones')
          .doc(`${userId}_${milestoneKey}`)
          .set({
            type: 'followers',
            value: milestone,
            userId,
            createdAt: firestore.FieldValue.serverTimestamp(),
          });

        // Send celebration notification
        await dispatchEngagementNotification({
          recipientId: userId,
          type: 'milestone',
          actorId: 'system',
          actorDisplayName: 'Black94',
          actorUsername: 'black94',
          actorProfileImage: null,
          actorIsVerified: true,
          actorBadge: 'gold',
          commentContent: `You now have ${milestone} followers! Keep growing your community.`,
          priority: 'normal',
        });
      } catch (e) {
        console.warn('[EngagementEngine] Follower milestone check failed:', e);
      }
    }
  }
}

/**
 * Check and fire post like milestones.
 * Call this after a post receives a like.
 */
export async function checkPostLikeMilestones(
  authorId: string,
  postId: string,
  likeCount: number,
): Promise<void> {
  for (const milestone of POST_LIKE_MILESTONES) {
    if (likeCount === milestone) {
      const milestoneKey = `milestone_post_likes_${postId}_${milestone}`;
      try {
        const doc = await firestore()
          .collection('engagement_milestones')
          .doc(`${authorId}_${milestoneKey}`)
          .get();
        if (doc.exists) continue;

        await firestore()
          .collection('engagement_milestones')
          .doc(`${authorId}_${milestoneKey}`)
          .set({
            type: 'post_likes',
            postId,
            value: milestone,
            userId: authorId,
            createdAt: firestore.FieldValue.serverTimestamp(),
          });

        await dispatchEngagementNotification({
          recipientId: authorId,
          type: 'achievement',
          actorId: 'system',
          actorDisplayName: 'Black94',
          actorUsername: 'black94',
          actorProfileImage: null,
          actorIsVerified: true,
          actorBadge: 'gold',
          postId,
          commentContent: `Your post just hit ${milestone} likes! People are loving your content.`,
          priority: 'normal',
        });
      } catch (e) {
        console.warn('[EngagementEngine] Post like milestone check failed:', e);
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   RE-ENGAGEMENT ENGINE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Track user activity — call this on key interactions (open app, send message, like, etc.)
 * Stores last activity timestamp in Firestore for re-engagement checks.
 */
export async function trackUserActivity(userId: string): Promise<void> {
  try {
    await firestore()
      .collection('user_engagement')
      .doc(userId)
      .set({
        lastActivityAt: firestore.FieldValue.serverTimestamp(),
        openedAppAt: firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
  } catch (e) {
    console.warn('[EngagementEngine] Activity tracking failed:', e);
  }
}

/**
 * Check if a user has been inactive and should receive a re-engagement notification.
 * Call this periodically (e.g., daily check via polling or server-side).
 *
 * Inactive thresholds:
 *   - 3 days: "We miss you!" gentle nudge
 *   - 7 days: "See what you missed" with summary
 *   - 14 days: "Come back" with incentive
 *   - 30 days: Final re-engagement attempt
 */
export async function checkReEngagement(userId: string): Promise<void> {
  try {
    const doc = await firestore().collection('user_engagement').doc(userId).get();
    if (!doc.exists) return;

    const data = doc.data();
    const lastActivity = data?.lastActivityAt;
    if (!lastActivity) return;

    let lastActiveMs: number;
    try {
      lastActiveMs = typeof lastActivity === 'object' && lastActivity.seconds
        ? lastActivity.seconds * 1000
        : new Date(lastActivity).getTime();
    } catch {
      return;
    }

    const inactiveDays = (Date.now() - lastActiveMs) / (1000 * 60 * 60 * 24);

    // Only send ONE re-engagement per threshold
    const thresholds = [
      { days: 3, key: 'reengage_3d', title: 'We miss you!', body: 'Your friends on Black94 have been active. Come see what you missed!' },
      { days: 7, key: 'reengage_7d', title: 'See what\'s new', body: 'New posts and conversations are waiting for you on Black94.' },
      { days: 14, key: 'reengage_14d', title: 'Come back!', body: 'The community is growing. Jump back in and reconnect.' },
      { days: 30, key: 'reengage_30d', title: 'Still here?', body: 'We\'d love to see you back. Check out trending content on Black94.' },
    ];

    for (const t of thresholds) {
      if (inactiveDays >= t.days && inactiveDays < t.days + 1) {
        // Within this threshold window — check if already sent
        const reengageDoc = await firestore()
          .collection('engagement_milestones')
          .doc(`${userId}_${t.key}`)
          .get();
        if (reengageDoc.exists) continue;

        // Mark as sent
        await firestore()
          .collection('engagement_milestones')
          .doc(`${userId}_${t.key}`)
          .set({
            type: 'reengagement',
            value: t.days,
            userId,
            createdAt: firestore.FieldValue.serverTimestamp(),
          });

        // Send re-engagement notification
        await dispatchEngagementNotification({
          recipientId: userId,
          type: 'reengagement',
          actorId: 'system',
          actorDisplayName: 'Black94',
          actorUsername: 'black94',
          actorProfileImage: null,
          actorIsVerified: true,
          actorBadge: 'gold',
          pushTitle: t.title,
          pushBody: t.body,
          priority: 'low',
        });
      }
    }
  } catch (e) {
    console.warn('[EngagementEngine] Re-engagement check failed:', e);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENGAGEMENT SCORING
   ═══════════════════════════════════════════════════════════════════════════ */

export interface EngagementScore {
  totalScore: number;
  activityLevel: 'inactive' | 'low' | 'medium' | 'high' | 'power';
  signals: {
    postsCreated: number;
    likesGiven: number;
    commentsMade: number;
    messagesSent: number;
    storiesPosted: number;
    daysActive: number;
  };
}

/**
 * Compute a user's engagement score based on their activity.
 * Score is 0-100 based on various engagement signals.
 */
export async function computeEngagementScore(userId: string): Promise<EngagementScore> {
  const score: EngagementScore = {
    totalScore: 0,
    activityLevel: 'inactive',
    signals: {
      postsCreated: 0,
      likesGiven: 0,
      commentsMade: 0,
      messagesSent: 0,
      storiesPosted: 0,
      daysActive: 0,
    },
  };

  try {
    // Count posts (limit 100 for performance)
    const postsSnap = await firestore()
      .collection('posts')
      .where('authorId', '==', userId)
      .limit(100)
      .get();
    score.signals.postsCreated = postsSnap.size;

    // Count likes given
    const likesSnap = await firestore()
      .collection('post_likes')
      .where('userId', '==', userId)
      .limit(100)
      .get();
    score.signals.likesGiven = likesSnap.size;

    // Count comments
    const commentsSnap = await firestore()
      .collection('comments')
      .where('authorId', '==', userId)
      .limit(100)
      .get();
    score.signals.commentsMade = commentsSnap.size;

    // Count messages (from any chat involving this user)
    // This is expensive, so we use the engagement doc if available
    const engDoc = await firestore().collection('user_engagement').doc(userId).get();
    if (engDoc.exists) {
      const engData = engDoc.data();
      score.signals.messagesSent = engData?.messagesSent || 0;
      score.signals.storiesPosted = engData?.storiesPosted || 0;

      // Compute days active
      const createdAt = engData?.firstActivityAt;
      if (createdAt) {
        try {
          const createdMs = typeof createdAt === 'object' && createdAt.seconds
            ? createdAt.seconds * 1000
            : new Date(createdAt).getTime();
          score.signals.daysActive = Math.max(1, Math.ceil((Date.now() - createdMs) / (1000 * 60 * 60 * 24)));
        } catch {}
      }
    }

    // Compute weighted score
    const postWeight = 15;
    const likeWeight = 5;
    const commentWeight = 10;
    const messageWeight = 8;
    const storyWeight = 12;

    score.totalScore = Math.min(100, Math.round(
      Math.min(score.signals.postsCreated, 50) * postWeight / 5 +
      Math.min(score.signals.likesGiven, 200) * likeWeight / 20 +
      Math.min(score.signals.commentsMade, 100) * commentWeight / 10 +
      Math.min(score.signals.messagesSent, 200) * messageWeight / 20 +
      Math.min(score.signals.storiesPosted, 50) * storyWeight / 5 +
      Math.min(score.signals.daysActive, 30) * 2
    ));

    // Determine activity level
    if (score.totalScore >= 80) score.activityLevel = 'power';
    else if (score.totalScore >= 50) score.activityLevel = 'high';
    else if (score.totalScore >= 25) score.activityLevel = 'medium';
    else if (score.totalScore >= 5) score.activityLevel = 'low';
    else score.activityLevel = 'inactive';

    // Store score
    await firestore()
      .collection('user_engagement')
      .doc(userId)
      .set({
        engagementScore: score.totalScore,
        activityLevel: score.activityLevel,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

  } catch (e) {
    console.warn('[EngagementEngine] Score computation failed:', e);
  }

  return score;
}

/* ═══════════════════════════════════════════════════════════════════════════
   WELCOME NOTIFICATION — sent on first sign-in
   ═══════════════════════════════════════════════════════════════════════════ */

export async function sendWelcomeNotification(userId: string): Promise<void> {
  try {
    const doc = await firestore()
      .collection('engagement_milestones')
      .doc(`${userId}_welcome_sent`)
      .get();
    if (doc.exists) return;

    await firestore()
      .collection('engagement_milestones')
      .doc(`${userId}_welcome_sent`)
      .set({ type: 'welcome', userId, createdAt: firestore.FieldValue.serverTimestamp() });

    await dispatchEngagementNotification({
      recipientId: userId,
      type: 'welcome',
      actorId: 'system',
      actorDisplayName: 'Black94',
      actorUsername: 'black94',
      actorProfileImage: null,
      actorIsVerified: true,
      actorBadge: 'gold',
      commentContent: 'Welcome to Black94! Start by setting up your profile and connecting with friends.',
      pushTitle: 'Welcome to Black94!',
      pushBody: 'Start exploring and connect with people.',
      priority: 'normal',
    });
  } catch (e) {
    console.warn('[EngagementEngine] Welcome notification failed:', e);
  }
}
