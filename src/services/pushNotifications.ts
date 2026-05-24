/**
 * Push Notification Service — expo-notifications integration.
 *
 * Handles:
 *   1. Requesting notification permissions from the user
 *   2. Creating Android notification channels (required for Android 8+)
 *   3. Registering the Expo push token with Firestore (for targeting)
 *   4. Sending push notifications via Expo's Push API
 *   5. Handling incoming notifications (foreground, background, quit)
 *   6. Processing notification taps for deep linking
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

// Android notification channel ID
const CHANNEL_ID = 'black94-messages';

/* ═══════════════════════════════════════════════════════════════════════════
   ANDROID NOTIFICATION CHANNEL — required for Android 8+
   Without this, background notifications will NOT appear on Android 8+.
   ═══════════════════════════════════════════════════════════════════════════ */

let _channelCreated = false;

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android' || _channelCreated) return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Messages & Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FFFFFF',
      enableVibrate: true,
      enableLights: true,
      showBadge: true,
      bypassDnd: false,
      lockscreenVisibility: Notifications.AndroidImportance.HIGH,
    });
    _channelCreated = true;
    if (__DEV__) console.log('[Push] Android notification channel created:', CHANNEL_ID);
  } catch (e) {
    if (__DEV__) console.warn('[Push] Failed to create Android channel:', e);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   NOTIFICATION BEHAVIOR (foreground handling)
   ═══════════════════════════════════════════════════════════════════════════ */

// Configure how notifications appear when the app is in foreground.
// This MUST run at module load time (not lazily) so it's registered before
// any push arrives. Import this module at the app entry point.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/* ═══════════════════════════════════════════════════════════════════════════
   INIT — call once at app startup (before any navigation)
   ═══════════════════════════════════════════════════════════════════════════ */

type NotificationTapHandler = (data: Record<string, any>) => void;

let _tapHandler: NotificationTapHandler | null = null;
let _cleanupListeners: (() => void) | null = null;
let _initialized = false;

/**
 * Initialize the notification system. Call this ONCE at app startup.
 *
 * This does three things:
 *   1. Creates the Android notification channel (background notifications won't
 *      appear on Android 8+ without a channel)
 *   2. Registers foreground + background tap listeners
 *   3. Checks for a cold-start notification (app opened from killed state)
 *
 * @param onNotificationTap — called when user taps a notification
 */
export async function initNotifications(onNotificationTap: NotificationTapHandler): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  if (__DEV__) console.log('[Push] Initializing notification system...');

  // 1. Create Android notification channel FIRST — this is critical for
  //    background/killed notifications to appear on Android 8+
  await ensureAndroidChannel();

  // 2. Set up notification listeners
  _tapHandler = onNotificationTap;

  // Foreground notification received (app is open)
  Notifications.addNotificationReceivedListener(notification => {
    if (__DEV__) console.log('[Push] Foreground notification:', notification.request.content.title);
  });

  // Notification tapped (foreground or background) — this is what routes
  // the user to the correct screen when they tap a notification
  Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data || {};
    if (__DEV__) console.log('[Push] Notification tapped:', JSON.stringify(data));
    if (_tapHandler) {
      _tapHandler(data);
    }
  });

  // 3. Check for cold-start notification (app was killed, opened from notification)
  try {
    const lastResponse = await Notifications.getLastNotificationResponseAsync();
    if (lastResponse?.notification) {
      const data = lastResponse.notification.request.content.data || {};
      if (__DEV__) console.log('[Push] Cold-start notification detected:', JSON.stringify(data));
      // BUG FIX: Increased from 500ms to 1500ms.
      // 500ms was too short on slow/mid-range devices — the navigator hadn't
      // mounted yet (navRef.current was still null), so the tap was silently
      // dropped and the user was never routed to the correct screen.
      setTimeout(() => {
        if (_tapHandler) _tapHandler(data);
      }, 1500);
    }
  } catch (e) {
    if (__DEV__) console.warn('[Push] Cold-start notification check failed:', e);
  }

  if (__DEV__) console.log('[Push] Notification system initialized');
}

/* ═══════════════════════════════════════════════════════════════════════════
   PERMISSIONS
   ═══════════════════════════════════════════════════════════════════════════ */

// BUG FIX: Module-level flag prevents requestNotificationPermissions() from
// showing the OS permission dialog more than once per app session.
// Previously this was called from setUser() in app.ts, which fires on every
// profile update — meaning the permission prompt could reappear unexpectedly.
let _pushPermissionRequested = false;

export async function requestNotificationPermissions(): Promise<boolean> {
  // BUG FIX: Removed the early-return guard on _pushPermissionRequested.
  // Previously, if permissions were requested before login (no user yet),
  // the token registration was skipped because the user wasn't authenticated.
  // After login, this function was a no-op due to the flag, so the push token
  // was never registered. Now we always proceed to ensure the token is stored.
  _pushPermissionRequested = true;

  try {
    // Ensure Android channel exists before requesting permissions
    await ensureAndroidChannel();

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      // On Android 13+, this prompts for POST_NOTIFICATIONS runtime permission
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      if (__DEV__) console.warn('[Push] Notification permission not granted:', finalStatus);
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
    // IMPORTANT: This must match the EAS project (@owner/slug).
    // Using a wrong projectId causes tokens to be registered under a
    // non-existent project, and Expo silently rejects push sends.
    const projectId = '@corneli1/black94';
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

    if (!token) {
      if (__DEV__) console.warn('[Push] No push token returned');
      return null;
    }

    const userId = auth()?.currentUser?.uid;
    if (!userId) {
      if (__DEV__) console.warn('[Push] No user logged in, skipping token registration');
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

    if (__DEV__) console.log('[Push] Token registered for user:', userId);
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
  channelId?: string; // Android notification channel
}

/**
 * Send a push notification via Expo's Push API.
 * This can be called from the client side — the push token is not a secret.
 *
 * @returns true if the notification was accepted by Expo's API
 */
export async function sendPushNotification(payload: PushPayload): Promise<boolean> {
  try {
    const message: Record<string, any> = {
      to: payload.to,
      sound: payload.sound || 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      badge: payload.badge,
      priority: payload.priority || 'high',
    };

    // CRITICAL: Always include the Android notification channel ID.
    // The recipient might be on Android even if the SENDER is on iOS/web.
    // Without channelId, Android 8+ silently drops background notifications.
    message.channelId = payload.channelId || CHANNEL_ID;

    const resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const responseJson = await resp.json();

    // BUG FIX: Expo Push API returns { data: [{ id, status, message?, details? }] }
    // — an array of per-message receipts, NOT a top-level { status: 'ok' }.
    // The old check (data.status === 'ok') always evaluated to false because
    // data.status is undefined — pushes appeared to fail even when delivered.
    const receipts: Array<{ status: string; id?: string; message?: string; details?: any }> =
      responseJson?.data || [];
    const success = receipts.length > 0 && receipts.every(r => r.status === 'ok');

    if (!success) {
      // Log top-level API errors (auth failures, malformed request, etc.)
      if (responseJson?.errors) {
        if (__DEV__) console.warn('[Push] Send errors:', JSON.stringify(responseJson.errors));
      }
      // Log per-receipt errors (invalid token, device unregistered, etc.)
      for (const receipt of receipts) {
        if (receipt.status === 'error') {
          if (__DEV__) console.warn('[Push] Receipt error:', receipt.id, receipt.message, receipt.details);
        }
      }
    } else {
      if (__DEV__) console.log('[Push] Notification sent successfully to:', payload.to.slice(-8));
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
    // Read the user's push tokens from subcollection
    const tokensSnap = await firestore()
      .collection('user_push_tokens')
      .doc(recipientId)
      .collection('tokens')
      .get();

    let tokens: string[] = [];
    if (!tokensSnap.empty) {
      tokens = tokensSnap.docs.map(doc => doc.data().token).filter(Boolean);
    }

    // Fallback: if subcollection is empty, check the parent doc's latestToken field.
    // This handles cases where only registerPushToken() parent doc write succeeded
    // but the subcollection write failed (e.g., permission issue or race condition).
    if (tokens.length === 0) {
      try {
        const parentDoc = await firestore()
          .collection('user_push_tokens')
          .doc(recipientId)
          .get();
        if (parentDoc.exists) {
          const parentData = parentDoc.data();
          const latestToken = parentData?.latestToken;
          if (latestToken) {
            tokens.push(latestToken);
            if (__DEV__) console.log('[Push] Using latestToken fallback for', recipientId);
          }
        }
      } catch (fallbackErr) {
        if (__DEV__) console.warn('[Push] latestToken fallback read failed:', fallbackErr);
      }
    }

    if (tokens.length === 0) {
      // No tokens = push not set up for this user, silently skip
      if (__DEV__) console.log('[Push] No push tokens found for user:', recipientId);
      return false;
    }

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
      if (__DEV__) console.log(`[Push] Sent to ${recipientId} (${tokens.length} devices)`);
    }
    return anySuccess;
  } catch (e) {
    console.error('[Push] sendPushToUser failed:', e);
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CLEANUP — Remove stale tokens
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Remove push token on logout to prevent sending to a logged-out device.
 * Also resets the session permission flag so the next login can re-request.
 */
export async function clearPushToken(): Promise<void> {
  try {
    const userId = auth()?.currentUser?.uid;
    if (!userId) return;

    // Get current token
    const projectId = '@corneli1/black94';
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!tokenData.data) return;

    const tokenId = tokenData.data.slice(-20);
    await firestore()
      .collection('user_push_tokens')
      .doc(userId)
      .collection('tokens')
      .doc(tokenId)
      .delete();

    // Reset permission flag so next login session can request again if needed
    _pushPermissionRequested = false;

    if (__DEV__) console.log('[Push] Token cleared on logout');
  } catch (e) {
    if (__DEV__) console.warn('[Push] Failed to clear token:', e);
  }
}
