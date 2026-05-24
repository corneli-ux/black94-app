/**
 * cloudFunctions.ts — Typed client-side callers for Firebase Cloud Functions.
 *
 * All Cloud Functions are deployed as HTTPS Express endpoints (onRequest),
 * NOT as https.onCall(). They use raw fetch() with Authorization: Bearer <idToken>.
 *
 * Base URL: https://asia-south1-black94.cloudfunctions.net/{functionName}
 */

import { getValidToken, auth } from './firebase';

const BASE_URL = 'https://asia-south1-black94.cloudfunctions.net';

// ── Helper ──────────────────────────────────────────────────────────────────

/**
 * Get a fresh Firebase ID token for authentication.
 * Throws if the user is not signed in.
 */
async function getAuthToken(): Promise<string> {
  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

/**
 * Generic POST caller for Cloud Functions.
 */
async function callFunction<T>(functionName: string, body: Record<string, any>): Promise<T> {
  const token = await getAuthToken();
  const url = `${BASE_URL}/${functionName}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const errMsg = data.error?.message || data.message || `Cloud Function ${functionName} failed (${resp.status})`;
    const err: any = new Error(errMsg);
    err.status = resp.status;
    err.code = data.error?.status || data.error?.code;
    throw err;
  }

  return data as T;
}

// ── 1. verifyPayment ────────────────────────────────────────────────────────

/**
 * Calls the verifyRazorpayPayment Cloud Function.
 *
 * Verifies the Razorpay payment signature server-side, fetches the payment
 * from Razorpay API, and activates the subscription (or other payment type).
 *
 * @param params - Razorpay payment details from the checkout callback.
 * @returns Verified result with type and details.
 */
export async function verifyPayment(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  type: 'subscription' | 'order' | 'paid_chat';
  planId?: string;
  [key: string]: any;
}): Promise<{ verified: boolean; type: string; details: any }> {
  const uid = auth()?.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');

  return callFunction('verifyRazorpayPayment', params);
}

// ── 2. createPaymentOrder ───────────────────────────────────────────────────

/**
 * Calls the createRazorpayOrder Cloud Function.
 *
 * Creates a Razorpay order server-side. The returned order_id is passed
 * to the Razorpay checkout to prevent amount tampering.
 *
 * @param params - Order creation parameters.
 * @returns Order details with orderId, amount, and currency.
 */
export async function createPaymentOrder(params: {
  amount: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<{ orderId: string; amount: number; currency: string }> {
  return callFunction('createRazorpayOrder', params);
}

// ── 3. deleteAccountServer ─────────────────────────────────────────────────

/**
 * Calls the deleteAccount Cloud Function.
 *
 * Server-side deletion: removes the Firebase Auth user, Firestore user doc,
 * and all user data (posts, stories, push tokens) in one secure operation.
 *
 * @returns { deleted: true } on success.
 */
export async function deleteAccountServer(): Promise<{ deleted: boolean }> {
  const uid = auth()?.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated');
  return callFunction('deleteAccount', { uid });
}
