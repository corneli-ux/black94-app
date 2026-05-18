/**
 * razorpay.ts — Razorpay Checkout via WebView (with server-side order creation)
 *
 * Flow:
 *  1. Client calls Cloud Function `createRazorpayOrder` → gets order_id
 *  2. Client opens Razorpay Checkout.js in a WebView with the order_id
 *  3. User completes payment → WebView posts result back
 *  4. Client calls Cloud Function `verifyRazorpayPayment` → server verifies signature
 *  5. Server activates subscription / creates order / grants chat access
 *
 * The Razorpay key ID is loaded from app.json → extra.razorpayKeyId.
 * Cloud Functions are called via HTTPS REST (no Firebase SDK dependency).
 */

import Constants from 'expo-constants';
import { getValidToken } from './firebase';

// ── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ID = 'black94';
const REGION = 'us-central1'; // Must match the Cloud Functions deployment region

const RAZORPAY_KEY_ID = (Constants.expoConfig?.extra?.razorpayKeyId as string) || '';

// ── Types ────────────────────────────────────────────────────────────────────

export type PaymentType = 'subscription' | 'order' | 'paid_chat';

export interface RazorpayOrderOptions {
  amount: number;       // amount in paise (e.g. 52000 = ₹520)
  currency?: string;    // default 'INR'
  receipt: string;      // unique receipt ID (e.g. "sub_uid_123")
  notes?: Record<string, string>;
}

export interface RazorpayCheckoutOptions extends RazorpayOrderOptions {
  planName: string;     // display name for checkout
  userName?: string;
  userEmail?: string;
  userPhone?: string;
}

export interface RazorpayOrderResult {
  orderId: string;
  amount: number;
  currency: string;
  receipt: string;
}

export interface RazorpayResult {
  success: boolean;
  paymentId?: string;
  razorpayOrderId?: string;
  razorpaySignature?: string;
  error?: string;
}

export interface VerifyPaymentOptions {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  type: PaymentType;
  [key: string]: any; // type-specific fields (planId, items, etc.)
}

export interface VerifyPaymentResult {
  verified: boolean;
  type: PaymentType;
  details: any;
}

// ── Cloud Functions HTTP caller ─────────────────────────────────────────────

/**
 * Calls a Cloud Function via REST (onRequest/Express).
 *
 * The functions use onRequest (not onCall), so:
 *  - Request body is sent directly (no { data: ... } wrapper)
 *  - Response body is the result directly (no { result: ... } wrapper)
 *  - Errors come as proper HTTP status codes with { error: { message } } body
 */
async function callCloudFunction(
  functionName: string,
  data: Record<string, any>,
): Promise<any> {
  let token: string;
  try {
    token = await getValidToken();
  } catch {
    throw new Error('Not authenticated — please sign in again.');
  }

  const url = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${functionName}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  let resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data), // Send data directly — no { data: ... } wrapper
  });

  // ── Retry once with a fresh token on auth errors ──
  // Firebase ID tokens expire after 1 hour. The cached token may be
  // stale by the time it reaches the Cloud Function. Force-refresh and
  // retry (same pattern used by _firestoreFetch in firebase.ts).
  if (resp.status === 401 || resp.status === 403) {
    try {
      token = await getValidToken();
    } catch {
      throw new Error('Session expired — please sign in again.');
    }
    resp = await fetch(url, {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
  }

  const result = await resp.json();

  // onRequest returns errors as proper HTTP status codes
  if (!resp.ok) {
    const errorMessage =
      result.error?.message || result.message || `Cloud function error (${resp.status})`;
    throw new Error(errorMessage);
  }

  // onRequest returns the result directly — no { result: ... } wrapper
  return result;
}

// ── Server-side Order Creation ──────────────────────────────────────────────

/**
 * Creates a Razorpay order via Cloud Function.
 *
 * This is the server-side step that generates a secure order_id
 * to prevent amount tampering on the client.
 */
export async function createRazorpayOrder(
  options: RazorpayOrderOptions,
): Promise<RazorpayOrderResult> {
  try {
    const result = await callCloudFunction('createRazorpayOrder', {
      amount: options.amount,
      currency: options.currency || 'INR',
      receipt: options.receipt,
      notes: options.notes,
    });

    return result as RazorpayOrderResult;
  } catch (error: any) {
    console.error('[Razorpay] Failed to create order:', error);
    throw new Error(
      error?.message || 'Failed to create payment order. Please try again.',
    );
  }
}

// ── Server-side Payment Verification ────────────────────────────────────────

/**
 * Verifies a Razorpay payment via Cloud Function.
 *
 * The server checks the payment signature, fetches payment details from
 * Razorpay, and then activates the subscription / creates order / grants chat access.
 */
export async function verifyRazorpayPayment(
  options: VerifyPaymentOptions,
): Promise<VerifyPaymentResult> {
  try {
    const result = await callCloudFunction('verifyRazorpayPayment', options);
    return result as VerifyPaymentResult;
  } catch (error: any) {
    console.error('[Razorpay] Payment verification failed:', error);
    throw new Error(
      error?.message || 'Payment verification failed. Please contact support.',
    );
  }
}

// ── HTML generator ───────────────────────────────────────────────────────────

function generateCheckoutHTML(
  options: RazorpayCheckoutOptions,
  keyId: string,
  razorpayOrderId: string,
): string {
  const safeName = JSON.stringify(options.userName || '');
  const safeEmail = JSON.stringify(options.userEmail || '');
  const safePhone = JSON.stringify(options.userPhone || '');
  const safeDescription = options.planName
    ? options.planName.replace(/'/g, "\\'")
    : 'Payment';

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #111; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .container { text-align: center; padding: 20px; }
    .spinner { width: 40px; height: 40px; border: 3px solid #333; border-top: 3px solid #fff; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <p>Opening payment gateway...</p>
  </div>
  <script>
    try {
      var options = {
        key: '${keyId}',
        amount: ${options.amount},
        currency: '${options.currency || 'INR'}',
        name: 'Black94',
        description: '${safeDescription}',
        image: '',
        order_id: '${razorpayOrderId}',
        prefill: {
          name: ${safeName},
          email: ${safeEmail},
          contact: ${safePhone},
        },
        theme: {
          color: '#111111'
        },
        handler: function(response) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'success',
            paymentId: response.razorpay_payment_id,
            orderId: response.razorpay_order_id,
            signature: response.razorpay_signature,
          }));
        },
        modal: {
          ondismiss: function() {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'cancelled',
            }));
          }
        },
      };

      var rzp = new Razorpay(options);
      rzp.on('payment.failed', function(response) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'error',
          error: response.error.description || 'Payment failed',
        }));
      });

      rzp.open();
    } catch(e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'error',
        error: e.message || 'Failed to initialize payment',
      }));
    }
  </script>
</body>
</html>`;
}

// ── WebView Checkout ───────────────────────────────────────────────────────

/**
 * Opens the Razorpay checkout in a WebView.
 *
 * Call this AFTER createRazorpayOrder() returns an orderId.
 * Pass the orderId along with the checkout options.
 *
 * Returns:
 *  - `html`          — the full HTML string to load in a WebView
 *  - `keyMissing`    — true if the Razorpay key is not configured
 */
export function openRazorpayCheckout(
  options: RazorpayCheckoutOptions,
  razorpayOrderId: string,
): { html: string; keyMissing: boolean } {
  if (!RAZORPAY_KEY_ID) {
    return { html: '', keyMissing: true };
  }

  return {
    html: generateCheckoutHTML(options, RAZORPAY_KEY_ID, razorpayOrderId),
    keyMissing: false,
  };
}

/**
 * Parse the WebView onMessage event into a RazorpayResult.
 */
export function handleRazorpayMessage(event: any): RazorpayResult {
  try {
    const data = JSON.parse(event.nativeEvent.data);
    if (data.type === 'success') {
      return {
        success: true,
        paymentId: data.paymentId,
        razorpayOrderId: data.orderId,
        razorpaySignature: data.signature,
      };
    }
    if (data.type === 'cancelled') {
      return {
        success: false,
        error: 'Payment was cancelled.',
      };
    }
    return {
      success: false,
      error: data.error || 'Payment failed',
    };
  } catch {
    return { success: false, error: 'Failed to process payment response' };
  }
}

/** Returns true when a Razorpay key is configured in app.json. */
export function isRazorpayConfigured(): boolean {
  return !!RAZORPAY_KEY_ID;
}
