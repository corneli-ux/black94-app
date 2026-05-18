/**
 * index.ts — Firebase Cloud Functions entry point
 *
 * Exports:
 *  - createRazorpayOrder   — callable: creates a Razorpay order server-side
 *  - verifyRazorpayPayment — callable: verifies payment signature & activates subscription
 *  - razorpayWebhook       — HTTP: handles Razorpay webhook events
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import express from 'express';
import cors from 'cors';
import Razorpay from 'razorpay';
import {
  handleSubscriptionPayment,
  handleOrderPayment,
  handlePaidChatPayment,
  handleWebhookEvent,
} from './handlers';

// ── Initialize Firebase Admin ──────────────────────────────────────────────

admin.initializeApp();
const db = admin.firestore();

// ── Auth verification helper ───────────────────────────────────────────

/**
 * Extracts the authenticated user's UID from a callable request.
 *
 * The Firebase Functions v2 SDK (firebase-functions@5.x) callable middleware
 * only populates `request.auth` when the call originates from the Firebase
 * Client SDK (which adds internal protocol headers). Direct REST calls via
 * fetch() — even with a valid `Authorization: Bearer <id_token>` header —
 * leave `request.auth` as `null`.
 *
 * This helper works in both cases:
 *  1. Firebase Client SDK call → uses `request.auth` directly.
 *  2. Direct REST call → falls back to `admin.auth().verifyIdToken()`
 *     using the Bearer token from the raw request headers.
 */
async function getAuthenticatedUid(request: any): Promise<string> {
  // Fast path: Firebase Client SDK populated request.auth
  if (request.auth?.uid) {
    return request.auth.uid;
  }

  // Fallback: manually verify the Bearer token from the raw request.
  // Express normalises header names to lowercase.
  const authHeader: string | undefined =
    request.rawRequest?.headers?.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'You must be signed in. No valid auth token found.',
    );
  }

  const idToken = authHeader.slice(7); // strip "Bearer "
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (!decoded.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Token is valid but has no UID.',
      );
    }
    console.log(`[Auth] Verified token for uid=${decoded.uid} (fallback path)`);
    return decoded.uid;
  } catch (error: any) {
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Authentication failed. Please sign in again.',
    );
  }
}

// ── Razorpay Instance (lazy init) ──────────────────────────────────────────

/**
 * Reads RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET from Firebase Functions secrets.
 * Set them with:
 *   firebase functions:secrets:set RAZORPAY_KEY_ID
 *   firebase functions:secrets:set RAZORPAY_KEY_SECRET
 *
 * Lazy-initialized to avoid crashing during Firebase's code analysis phase,
 * when env vars are not yet injected.
 */
let _razorpay: Razorpay | null = null;
function getRazorpay(): Razorpay {
  if (!_razorpay) {
    _razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || '',
      key_secret: process.env.RAZORPAY_KEY_SECRET || '',
    });
  }
  return _razorpay;
}

// ── Callable: createRazorpayOrder ─────────────────────────────────────────

/**
 * Creates a Razorpay order server-side.
 *
 * Called from the client before opening the payment checkout.
 * The returned order_id is passed to the Razorpay checkout to prevent tampering.
 *
 * Input:
 *   { amount: number, currency: string, receipt: string, notes?: Record<string, string> }
 *   - amount: in paise (e.g. 52000 for ₹520)
 *   - receipt: unique identifier (e.g. "sub_uid_123", "order_uid_456", "chat_uid_789")
 *   - notes: optional metadata (userId, planId, type, etc.)
 *
 * Returns:
 *   { orderId: string, amount: number, currency: string }
 */
export const createRazorpayOrder = functions.https.onCall(
  async (request: any) => {
    // Verify the user is authenticated (works with both SDK and direct REST calls)
    const uid = await getAuthenticatedUid(request);

    const { amount, currency = 'INR', receipt, notes = {} } = request.data;

    // Validate required fields
    if (!amount || amount <= 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'A valid amount (in paise) is required.',
      );
    }

    if (!receipt) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'A receipt identifier is required.',
      );
    }

    try {
      const order = await getRazorpay().orders.create({
        amount,
        currency,
        receipt,
        notes: {
          userId: uid,
          ...notes,
        },
      });

      console.log(`[Razorpay] Order created: ${order.id} for ₹${amount / 100}`);

      return {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt,
      };
    } catch (error: any) {
      console.error('[Razorpay] Order creation failed:', error);
      throw new functions.https.HttpsError(
        'internal',
        'Failed to create payment order. Please try again.',
      );
    }
  },
);

// ── Callable: verifyRazorpayPayment ────────────────────────────────────────

/**
 * Verifies a Razorpay payment server-side using the payment signature.
 *
 * Called after the client completes the Razorpay checkout.
 * On successful verification, it dispatches to the appropriate handler
 * based on the payment type (subscription, order, paid_chat).
 *
 * Input:
 *   {
 *     razorpayOrderId: string,
 *     razorpayPaymentId: string,
 *     razorpaySignature: string,
 *     type: 'subscription' | 'order' | 'paid_chat',
 *     ...type-specific fields
 *   }
 *
 * Returns:
 *   { verified: boolean, type: string, details: any }
 */
export const verifyRazorpayPayment = functions.https.onCall(
  async (request: any) => {
    // Verify the user is authenticated (works with both SDK and direct REST calls)
    const uid = await getAuthenticatedUid(request);

    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      type,
      ...payload
    } = request.data;

    // Validate required fields
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Razorpay order ID, payment ID, and signature are required.',
      );
    }

    if (!['subscription', 'order', 'paid_chat'].includes(type)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Invalid payment type: ${type}`,
      );
    }

    // ── Step 1: Verify payment signature ──
    try {
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      if (expectedSignature !== razorpaySignature) {
        console.error(
          `[Razorpay] Signature mismatch for payment ${razorpayPaymentId}`,
        );
        throw new functions.https.HttpsError(
          'permission-denied',
          'Payment verification failed. The payment signature does not match.',
        );
      }
    } catch (error: any) {
      if (error instanceof functions.https.HttpsError) throw error;
      console.error('[Razorpay] Signature verification error:', error);
      throw new functions.https.HttpsError(
        'internal',
        'Payment verification failed.',
      );
    }

    // ── Step 2: Fetch payment details from Razorpay ──
    let paymentDetails: any;
    try {
      paymentDetails = await getRazorpay().payments.fetch(razorpayPaymentId);
      console.log(
        `[Razorpay] Payment verified: ${razorpayPaymentId}, status: ${paymentDetails.status}`,
      );
    } catch (error: any) {
      console.error('[Razorpay] Payment fetch failed:', error);
      throw new functions.https.HttpsError(
        'internal',
        'Could not verify payment with Razorpay. Please contact support.',
      );
    }

    // Only process if payment is captured
    if (paymentDetails.status !== 'captured') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Payment not captured (status: ${paymentDetails.status}).`,
      );
    }

    // ── Step 3: Dispatch to type-specific handler ──
    // uid already resolved above via getAuthenticatedUid(request)

    try {
      let result: any;

      switch (type) {
        case 'subscription':
          result = await handleSubscriptionPayment(
            db,
            uid,
            razorpayPaymentId,
            razorpayOrderId,
            paymentDetails,
            payload,
          );
          break;
        case 'order':
          result = await handleOrderPayment(
            db,
            uid,
            razorpayPaymentId,
            razorpayOrderId,
            paymentDetails,
            payload,
          );
          break;
        case 'paid_chat':
          result = await handlePaidChatPayment(
            db,
            uid,
            razorpayPaymentId,
            razorpayOrderId,
            paymentDetails,
            payload,
          );
          break;
        default:
          throw new functions.https.HttpsError(
            'invalid-argument',
            `Unknown payment type: ${type}`,
          );
      }

      return {
        verified: true,
        type,
        details: result,
      };
    } catch (error: any) {
      console.error(`[Razorpay] Handler error (${type}):`, error);
      throw new functions.https.HttpsError(
        'internal',
        error.message || 'Payment processing failed.',
      );
    }
  },
);

// ── HTTP: Razorpay Webhook ────────────────────────────────────────────────

/**
 * Handles webhook events from Razorpay.
 *
 * Validates the webhook signature, then processes events:
 *  - payment.captured: Update payment records
 *  - payment.failed: Mark payments as failed
 *  - order.paid: Confirm order completion
 *
 * Setup:
 *  1. Deploy this function
 *  2. In Razorpay Dashboard → Settings → Webhooks, add the function URL + /webhook
 *  3. Set the webhook secret in Firebase: firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET
 */
const webhookApp = express();
webhookApp.use(cors({ origin: true }));
webhookApp.use(express.json());

// Raw body capture for signature verification (must be before json parser)
const webhookRawApp = express();
webhookRawApp.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
);

webhookRawApp.post('/webhook', async (req: any, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  // If no secret configured, skip verification (not recommended for production)
  if (webhookSecret && req.rawBody) {
    try {
      const crypto = require('crypto');
      const expectedSig = crypto
        .createHmac('sha256', webhookSecret)
        .update(req.rawBody)
        .digest('hex');
      const actualSig = req.headers['x-razorpay-signature'] as string;

      if (expectedSig !== actualSig) {
        console.error('[Razorpay Webhook] Signature mismatch');
        return res.status(400).json({ error: 'Invalid signature' });
      }
    } catch (error) {
      console.error('[Razorpay Webhook] Verification error:', error);
      return res.status(400).json({ error: 'Signature verification failed' });
    }
  }

  const event = req.body;
  console.log(`[Razorpay Webhook] Event: ${event.event}`);

  try {
    await handleWebhookEvent(db, event);
    return res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('[Razorpay Webhook] Handler error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export const razorpayWebhook = functions.https.onRequest(webhookRawApp);
