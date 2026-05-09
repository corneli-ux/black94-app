/**
 * Real-time polling listeners for Firestore REST API.
 *
 * Since we use Firebase via REST (no SDK / onSnapshot), we simulate
 * real-time behaviour with configurable interval polling.
 *
 * All listeners are paused automatically when the app goes to background
 * (via React-Native AppState) and resumed when it returns to foreground.
 */

import { AppState, type AppStateStatus } from 'react-native';
import { firestore } from './firebase';

/* ═══════════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════════ */

interface ActiveListener {
  /** The setInterval id (or null when paused) */
  timerId: ReturnType<typeof setInterval> | null;
  /** Run one poll cycle immediately */
  tick: () => Promise<void>;
  /** Interval in ms */
  intervalMs: number;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Global listener registry & AppState management
   ═══════════════════════════════════════════════════════════════════════════ */

const listeners = new Map<string, ActiveListener>();
let appStateSubscription: { remove: () => void } | null = null;
let currentAppState: AppStateStatus = 'active';

/**
 * Pause every registered listener (clear intervals but keep refs so we
 * can resume later).
 */
function pauseAll() {
  for (const [key, entry] of listeners) {
    if (entry.timerId !== null) {
      clearInterval(entry.timerId);
      entry.timerId = null;
    }
  }
}

/**
 * Resume every registered listener. Only starts timers for entries that
 * don't already have one running.
 */
function resumeAll() {
  for (const [key, entry] of listeners) {
    if (entry.timerId === null) {
      entry.tick(); // fire immediately on resume
      entry.timerId = setInterval(entry.tick, entry.intervalMs);
    }
  }
}

function onAppStateChange(nextState: AppStateStatus) {
  if (nextState === 'active' && currentAppState !== 'active') {
    resumeAll();
  } else if (nextState !== 'active' && currentAppState === 'active') {
    pauseAll();
  }
  currentAppState = nextState;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Internal helpers
   ═══════════════════════════════════════════════════════════════════════════ */

let _listenerCounter = 0;

/**
 * Register a new polling listener. Returns the unsubscribe function.
 */
function register(
  intervalMs: number,
  tick: () => Promise<void>,
): () => void {
  const id = `listener_${++_listenerCounter}`;

  listeners.set(id, { timerId: null, tick, intervalMs });

  // Start immediately if app is in foreground
  if (currentAppState === 'active') {
    tick();
    const entry = listeners.get(id)!;
    entry.timerId = setInterval(tick, intervalMs);
  }

  // Return unsubscribe
  return () => {
    const entry = listeners.get(id);
    if (entry && entry?.timerId !== null) {
      clearInterval(entry.timerId);
    }
    listeners.delete(id);
  };
}

/**
 * Apply an array of constraint descriptors to a collection ref.
 *
 * Supported constraint shapes:
 *  - { type: 'where',    field, op, value }
 *  - { type: 'orderBy',  field, direction? }   direction defaults to 'asc'
 *  - { type: 'limit',    n }
 */
function applyConstraints(
  ref: ReturnType<ReturnType<typeof firestore>['where']>,
  constraints: any[] = [],
) {
  let current = ref;
  for (const c of constraints) {
    switch (c.type) {
      case 'where':
        current = current.where(c.field, c.op, c.value);
        break;
      case 'orderBy':
        current = current.orderBy(c.field, c.direction ?? 'asc');
        break;
      case 'limit':
        current = current.limit(c.n);
        break;
    }
  }
  return current;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Public API — snapshot listeners
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Poll a single document and invoke the callback with its data (or null
 * if the document has been deleted).
 *
 * @param collectionPath  e.g. 'users' or 'chats/abc123'
 * @param docId           document id
 * @param callback        (data | null) => void
 * @param options         intervalMs (default 3000)
 * @returns unsubscribe function
 */
export function onDocumentSnapshot(
  collectionPath: string,
  docId: string,
  callback: (data: Record<string, any> | null) => void,
  options?: { intervalMs?: number },
): () => void {
  const intervalMs = options?.intervalMs ?? 3000;

  const ref = firestore().collection(collectionPath).doc(docId);

  const tick = async () => {
    try {
      const snap = await ref.get();
      if (snap.exists) {
        callback({ id: snap.id, ...snap.data() });
      } else {
        callback(null);
      }
    } catch (err: any) {
      // Silently swallow — intermittent auth / network errors should not
      // break the polling loop. The next tick will retry.
      if (err?.message?.includes('Session expired') || err?.message?.includes('Not authenticated')) {
        return; // Auth will be re-established on next successful interaction
      }
      console.warn(`[Realtime] onDocumentSnapshot(${collectionPath}/${docId}) error:`, err?.message);
    }
  };

  return register(intervalMs, tick);
}

/**
 * Poll an entire collection (with optional constraints) and invoke the
 * callback with the current array of documents.
 *
 * @param collectionPath  e.g. 'posts' or 'chats/abc123/messages'
 * @param callback        (docs[]) => void  — each doc has an `id` field
 * @param constraints     optional where/orderBy/limit descriptors
 * @param options         intervalMs (default 5000)
 * @returns unsubscribe function
 */
export function onCollectionSnapshot(
  collectionPath: string,
  callback: (docs: Record<string, any>[]) => void,
  constraints?: any[],
  options?: { intervalMs?: number },
): () => void {
  const intervalMs = options?.intervalMs ?? 5000;

  const ref = firestore().collection(collectionPath);
  const query = applyConstraints(ref, constraints ?? []);

  const tick = async () => {
    try {
      const snap = await query.get();
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(docs);
    } catch (err: any) {
      if (err?.message?.includes('Session expired') || err?.message?.includes('Not authenticated')) {
        return;
      }
      console.warn(`[Realtime] onCollectionSnapshot(${collectionPath}) error:`, err?.message);
    }
  };

  return register(intervalMs, tick);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Public API — domain-specific listeners
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Poll messages for a chat room. Ordered by `createdAt desc`, limit 50.
 * Uses a faster 2-second interval since chat is latency-sensitive.
 *
 * Automatically pauses when the app goes to background (managed by the
 * global AppState handler).
 */
export function onMessageListener(
  chatId: string,
  callback: (messages: Record<string, any>[]) => void,
): () => void {
  const intervalMs = 2000;

  const ref = firestore()
    .collection(`chats/${chatId}/messages`)
    .orderBy('createdAt', 'desc')
    .limit(50);

  const tick = async () => {
    try {
      const snap = await ref.get();
      const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(messages);
    } catch (err: any) {
      if (err?.message?.includes('Session expired') || err?.message?.includes('Not authenticated')) {
        return;
      }
      console.warn(`[Realtime] onMessageListener(${chatId}) error:`, err?.message);
    }
  };

  return register(intervalMs, tick);
}

/**
 * Poll all chats involving the given user and compute total unread count.
 *
 * Firestore REST does not support OR queries, so we fire two parallel
 * queries (user1Id == userId  and  user2Id == userId) and merge results.
 */
export function onUnreadCountListener(
  userId: string,
  callback: (count: number) => void,
): () => void {
  const intervalMs = 5000;

  const tick = async () => {
    try {
      const [snap1, snap2] = await Promise.all([
        firestore()
          .collection('chats')
          .where('user1Id', '==', userId)
          .get(),
        firestore()
          .collection('chats')
          .where('user2Id', '==', userId)
          .get(),
      ]);

      let total = 0;

      for (const d of snap1.docs) {
        const data = d.data();
        total += (typeof data.unreadUser1 === 'number' ? data.unreadUser1 : 0);
      }
      for (const d of snap2.docs) {
        const data = d.data();
        total += (typeof data.unreadUser2 === 'number' ? data.unreadUser2 : 0);
      }

      callback(total);
    } catch (err: any) {
      if (err?.message?.includes('Session expired') || err?.message?.includes('Not authenticated')) {
        return;
      }
      console.warn(`[Realtime] onUnreadCountListener(${userId}) error:`, err?.message);
    }
  };

  return register(intervalMs, tick);
}

/**
 * Poll unread notification count for a user.
 * Queries `notifications` where `recipientId == userId` and `read == false`.
 */
export function onNotificationCountListener(
  userId: string,
  callback: (count: number) => void,
): () => void {
  const intervalMs = 10000;

  const ref = firestore()
    .collection('notifications')
    .where('recipientId', '==', userId)
    .where('read', '==', false);

  const tick = async () => {
    try {
      const snap = await ref.get();
      callback(snap.size);
    } catch (err: any) {
      if (err?.message?.includes('Session expired') || err?.message?.includes('Not authenticated')) {
        return;
      }
      console.warn(`[Realtime] onNotificationCountListener(${userId}) error:`, err?.message);
    }
  };

  return register(intervalMs, tick);
}

/* ═══════════════════════════════════════════════════════════════════════════
   App lifecycle helpers
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Start listening to AppState changes so all registered listeners are
 * automatically paused when the app goes to background and resumed when
 * it returns to foreground.
 *
 * Call this once at app startup (e.g. in the root component's useEffect).
 */
export function startAllListeners(): void {
  if (appStateSubscription) return; // already subscribed

  currentAppState = AppState.currentState;
  appStateSubscription = AppState.addEventListener('change', onAppStateChange);
  resumeAll();
}

/**
 * Stop all polling listeners and tear down the AppState subscription.
 *
 * Call this when the app is shutting down or when all listeners should
 * be permanently stopped.
 */
export function stopAllListeners(): void {
  pauseAll();
  listeners.clear();

  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
}
