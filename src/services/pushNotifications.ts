/**
 * Push Notification Service — expo-notifications integration.
 *
 * Handles:
 *   1. Requesting notification permissions from the user
 *   2. Registering the Expo push token with Firestore (for targeting)
 *   3. Sending push notifications via Expo's Push API
 *   4. Handling incoming notifications (foreground, background, quit)
 *   5. Processing notification taps for deep linking
 *
 * Architecture:
 *   - Uses Expo Push Notification Service (not FCM directly)
 *   - Push tokens stored in Firestore: `user_push_tokens/{userId}/tokens/{tokenId}`
 *   - When events occur (message, like, follow), the notification engine reads
 *     the recipient's push tokens and sends pushes via Expo's HTTP API
 *   - For production: a Firebase Cloud Function can replace client-side sending
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { firestore, auth } from '../lib/firebase';

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════════════════════════ */

// Expo Push API endpoint
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/* ═══════════════════════════════════════════════════════════════════════════
   NOTIFICATION BEHAVIOR (foreground handling)
   ═══════════════════════════════════════════════════════════════════════════ */

// Configure how notifications appear when the app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/* ═══════════════════════════════════════════════════════════════════════════
   PERMISSIONS
   ═══════════════════════════════════════════════════════════════════════════ */

export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[Push] Notification permission not granted:', finalStatus);
      return false;
    }

    // Register for push and store token
    await registerPushToken();
    return true;
  } catch (e) {
    console.error('[Push] Failed to request permissions:', e);
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOKEN REGISTRATION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Get the current Expo push token and store it in Firestore.
 * Tokens are stored per-user so we can target pushes to specific users.
 */
async function registerPushToken(): Promise<string | null> {
  try {
    const projectId = 'black94-app';
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

    if (!token) {
      console.warn('[Push] No push token returned');
      return null;
    }

    const userId = auth()?.currentUser?.uid;
    if (!userId) {
      console.warn('[Push] No user logged in, skipping token registration');
      return token; // Return token but don't store
    }

    // Store token in Firestore: user_push_tokens/{userId}/tokens/{hash(token)}
    // Using a subcollection so a user can have multiple devices
    const tokenId = token.slice(-20); // Last 20 chars as unique ID
    const tokenData = {
      token,
      platform: Platform.OS,
      createdAt: firestore.FieldValue.serverTimestamp(),
      lastUsed: firestore.FieldValue.serverTimestamp(),
    };

    await firestore()
      .collection('user_push_tokens')
      .doc(userId)
      .collection('tokens')
      .doc(tokenId)
      .set(tokenData, { merge: true });

    // Also store the latest token at the user level for quick lookup
    await firestore()
      .collection('user_push_tokens')
      .doc(userId)
      .set({
        latestToken: token,
        platform: Platform.OS,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

    console.log('[Push] Token registered for user:', userId);
    return token;
  } catch (e) {
    console.error('[Push] Token registration failed:', e);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SEND PUSH NOTIFICATION
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PushPayload {
  to: string; // Expo push token
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: 'default' | 'null';
  badge?: number;
  priority?: 'default' | 'high';
}

/**
 * Send a push notification via Expo's Push API.
 * This can be called from the client side — the push token is not a secret.
 *
 * @returns true if the notification was accepted by Expo's API
 */
export async function sendPushNotification(payload: PushPayload): Promise<boolean> {
  try {
    const message = {
      to: payload.to,
      sound: payload.sound || 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      badge: payload.badge,
      priority: payload.priority || 'high',
    };

    const resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const data = await resp.json();
    const success = data.status === 'ok';

    if (!success) {
      // Log individual errors for each receipt
      if (data.errors) {
        console.warn('[Push] Send errors:', JSON.stringify(data.errors));
      }
    }

    return success;
  } catch (e) {
    console.error('[Push] Send failed:', e);
    return false;
  }
}

/**
 * Send a push notification to a specific user by their userId.
 * Reads their push tokens from Firestore and sends to all their devices.
 */
export async function sendPushToUser(
  recipientId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<boolean> {
  try {
    // Read the user's push tokens
    const tokensSnap = await firestore()
      .collection('user_push_tokens')
      .doc(recipientId)
      .collection('tokens')
      .get();

    if (tokensSnap.empty) {
      // No tokens = push not set up for this user, silently skip
      return false;
    }

    const tokens = tokensSnap.docs.map(doc => doc.data().token).filter(Boolean);
    if (tokens.length === 0) return false;

    // Send to all devices in parallel
    const results = await Promise.all(
      tokens.map(token =>
        sendPushNotification({
          to: token,
          title,
          body,
          data,
          sound: 'default',
          priority: 'high',
        })
      )
    );

    const anySuccess = results.some(r => r);
    if (anySuccess) {
      console.log(`[Push] Sent to ${recipientId} (${tokens.length} devices)`);
    }
    return anySuccess;
  } catch (e) {
    console.error('[Push] sendPushToUser failed:', e);
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   NOTIFICATION LISTENERS
   ═══════════════════════════════════════════════════════════════════════════ */

type NotificationTapHandler = (data: Record<string, any>) => void;

let _tapHandler: NotificationTapHandler | null = null;

/**
 * Set up notification listeners for foreground, background, and quit state.
 * Call this once at app startup.
 *
 * @param onNotificationTap — called when user taps a notification
 */
export function setupNotificationListeners(onNotificationTap: NotificationTapHandler): () => void {
  _tapHandler = onNotificationTap;

  // 1. Foreground notification received
  const foregroundSub = Notifications.addNotificationReceivedListener(notification => {
    console.log('[Push] Foreground notification:', notification.request.content.title);
  });

  // 2. Notification tapped (foreground or background)
  const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data || {};
    console.log('[Push] Notification tapped:', JSON.stringify(data));
    if (_tapHandler) {
      _tapHandler(data);
    }
  });

  // Return cleanup function
  return () => {
    foregroundSub.remove();
    responseSub.remove();
  };
}

/**
 * Get the initial notification that opened the app (cold start from notification).
 * Must be called while the app is loading to catch the initial notification.
 */
export async function getInitialNotification(): Promise<Record<string, any> | null> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (response && response.notification) {
      return response.notification.request.content.data || {};
    }
    return null;
  } catch (e) {
    console.error('[Push] getInitialNotification error:', e);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CLEANUP — Remove stale tokens
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Remove push token on logout to prevent sending to a logged-out device.
 */
export async function clearPushToken(): Promise<void> {
  try {
    const userId = auth()?.currentUser?.uid;
    if (!userId) return;

    // Get current token
    const projectId = 'black94-app';
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!tokenData.data) return;

    const tokenId = tokenData.data.slice(-20);
    await firestore()
      .collection('user_push_tokens')
      .doc(userId)
      .collection('tokens')
      .doc(tokenId)
      .delete();

    console.log('[Push] Token cleared on logout');
  } catch (e) {
    console.warn('[Push] Failed to clear token:', e);
  }
}
