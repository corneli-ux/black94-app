/**
 * index.ts — Firebase Cloud Functions entry point — v3
 *
 * Exports:
 *  - createRazorpayOrder   — HTTP: creates a Razorpay order server-side
 *  - verifyRazorpayPayment — HTTP: verifies payment signature & activates subscription
 *  - razorpayWebhook       — HTTP: handles Razorpay webhook events
 *
 * All payment endpoints use onRequest (Express) instead of onCall because
 * the client calls them via raw fetch(), not the Firebase Client SDK.
 * onRequest gives direct access to req.headers.authorization which is
 * critical for proper auth token verification.
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

// ── Auth middleware for Express routes ─────────────────────────────────────

/**
 * Express middleware that extracts and verifies the Firebase ID token
 * from the Authorization: Bearer <token> header.
 *
 * On success: sets req.uid and calls next().
 * On failure: returns 401 JSON response.
 */
async function authenticateRequest(req: any, res: any, next: any) {
  await _ensureSecrets();
  const authHeader = req.headers.authorization || req.headers.Authorization;

  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    console.warn('[Auth] Missing or malformed Authorization header');
    return res.status(401).json({
      error: {
        code: 401,
        message: 'You must be signed in. No valid auth token found.',
        status: 'UNAUTHENTICATED',
      },
    });
  }

  const idToken = authHeader.slice(7);

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (!decoded.uid) {
      return res.status(401).json({
        error: {
          code: 401,
          message: 'Token is valid but has no UID.',
          status: 'UNAUTHENTICATED',
        },
      });
    }
    req.uid = decoded.uid;
    console.log(`[Auth] Verified token for uid=${decoded.uid}`);
    next();
  } catch (error: any) {
    console.error('[Auth] Token verification failed:', error?.message || error);
    return res.status(401).json({
      error: {
        code: 401,
        message: 'Authentication failed. Please sign in again.',
        status: 'UNAUTHENTICATED',
      },
    });
  }
}

// ── Secret loading for 1st Gen ──────────────────────────────────────────
// 1st Gen functions (v5) inject secrets set via `firebase functions:secrets:set`
// into process.env automatically — BUT only if the function's service account
// has the "Secret Manager Secret Accessor" IAM role. The deploy workflow
// grants this access after setting the secrets.
//
// Fallback: if process.env is empty (IAM not yet propagated), try reading
// directly from Secret Manager as a last resort.
const _projectId = process.env.GCLOUD_PROJECT || 'black94';
let _secretsLoaded = false;

async function _ensureSecrets(): Promise<void> {
  if (_secretsLoaded) return;

  // Fast path: env vars already injected by the runtime
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    _secretsLoaded = true;
    return;
  }

  // Slow path: read directly from Secret Manager
  try {
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
    const client = new SecretManagerServiceClient();

    for (const name of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
      try {
        const [version] = await client.accessSecretVersion({
          name: `projects/${_projectId}/secrets/${name}/versions/latest`,
        });
        const payload = version.payload?.data?.toString() || '';
        if (payload) {
          process.env[name] = payload;
        }
      } catch (e: any) {
        console.error(`[Secrets] Failed to load ${name}:`, e?.message || e);
      }
    }
  } catch (e: any) {
    console.error('[Secrets] Secret Manager client failed:', e?.message || e);
  }

  // Reset cached Razorpay instance so it picks up the new env values
  _resetRazorpayInstance();
  _secretsLoaded = true;
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

/** Reset cached Razorpay instance after secrets are loaded. */
function _resetRazorpayInstance(): void {
  _razorpay = null;
}

// ── HTTP: createRazorpayOrder ─────────────────────────────────────────────

/**
 * Creates a Razorpay order server-side.
 *
 * Called from the client before opening the payment checkout.
 * The returned order_id is passed to the Razorpay checkout to prevent tampering.
 *
 * Request:
 *   POST with Authorization: Bearer <token>
 *   Body: { amount, currency, receipt, notes }
 *   - amount: in paise (e.g. 52000 for ₹520)
 *   - receipt: unique identifier (e.g. "sub_uid_123")
 *   - notes: optional metadata
 *
 * Response (200):
 *   { orderId, amount, currency, receipt }
 *
 * Errors:
 *   401 — not authenticated
 *   400 — missing/invalid fields
 *   500 — Razorpay API error
 */
const orderApp = express();
orderApp.use(cors({ origin: true }));
orderApp.use(express.json());
orderApp.post('/', authenticateRequest, async (req: any, res) => {
  const uid = req.uid;
  const { amount, currency = 'INR', receipt, notes = {} } = req.body;

  // ── Critical: Check Razorpay credentials BEFORE attempting API call ──
  const rzpKeyId = process.env.RAZORPAY_KEY_ID || '';
  const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET || '';
  console.log(`[Razorpay] Creating order: amount=${amount}, currency=${currency}`);
  if (!rzpKeyId || !rzpKeySecret) {
    console.error('[Razorpay] CRITICAL: RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET not set. ' +
      'Run: firebase functions:secrets:set RAZORPAY_KEY_ID && firebase functions:secrets:set RAZORPAY_KEY_SECRET');
    return res.status(500).json({
      error: {
        code: 500,
        message: `Payment service is not configured. Please contact support. (KEY_ID: ${rzpKeyId ? 'set' : 'EMPTY'}, KEY_SECRET: ${rzpKeySecret ? 'set' : 'EMPTY'})`,
        status: 'INTERNAL',
      },
    });
  }

  // Validate required fields
  if (!amount || amount <= 0) {
    return res.status(400).json({
      error: {
        code: 400,
        message: `A valid amount (in paise) is required. Got: ${amount}`,
        status: 'INVALID_ARGUMENT',
      },
    });
  }

  if (!receipt) {
    return res.status(400).json({
      error: {
        code: 400,
        message: 'A receipt identifier is required.',
        status: 'INVALID_ARGUMENT',
      },
    });
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

    return res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
    });
  } catch (error: any) {
    const detail = error?.error?.description || error?.description || error?.message || JSON.stringify(error);
    console.error('[Razorpay] Order creation failed:', error?.statusCode, error?.code, detail);
    return res.status(500).json({
      error: {
        code: 500,
        message: `Payment error: ${detail}`,
        status: 'INTERNAL',
      },
    });
  }
});

export const createRazorpayOrder = functions.https.onRequest(orderApp);

// ── HTTP: verifyRazorpayPayment ───────────────────────────────────────────

/**
 * Verifies a Razorpay payment server-side using the payment signature.
 *
 * Called after the client completes the Razorpay checkout.
 * On successful verification, it dispatches to the appropriate handler.
 *
 * Request:
 *   POST with Authorization: Bearer <token>
 *   Body: { razorpayOrderId, razorpayPaymentId, razorpaySignature, type, ... }
 *   - type: 'subscription' | 'order' | 'paid_chat'
 *
 * Response (200):
 *   { verified: true, type, details }
 *
 * Errors:
 *   401 — not authenticated
 *   400 — missing/invalid fields
 *   403 — signature mismatch
 *   500 — server error
 */
const verifyApp = express();
verifyApp.use(cors({ origin: true }));
verifyApp.use(express.json());
verifyApp.post('/', authenticateRequest, async (req: any, res) => {
  const uid = req.uid;
  const {
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    type,
    ...payload
  } = req.body;

  // Validate required fields
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return res.status(400).json({
      error: {
        code: 400,
        message: 'Razorpay order ID, payment ID, and signature are required.',
        status: 'INVALID_ARGUMENT',
      },
    });
  }

  if (!['subscription', 'order', 'paid_chat'].includes(type)) {
    return res.status(400).json({
      error: {
        code: 400,
        message: `Invalid payment type: ${type}`,
        status: 'INVALID_ARGUMENT',
      },
    });
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
      return res.status(403).json({
        error: {
          code: 403,
          message: 'Payment verification failed. The payment signature does not match.',
          status: 'PERMISSION_DENIED',
        },
      });
    }
  } catch (error: any) {
    console.error('[Razorpay] Signature verification error:', error);
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Payment verification failed.',
        status: 'INTERNAL',
      },
    });
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
    return res.status(500).json({
      error: {
        code: 500,
        message: 'Could not verify payment with Razorpay. Please contact support.',
        status: 'INTERNAL',
      },
    });
  }

  // Only process if payment is captured
  if (paymentDetails.status !== 'captured') {
    return res.status(400).json({
      error: {
        code: 400,
        message: `Payment not captured (status: ${paymentDetails.status}).`,
        status: 'FAILED_PRECONDITION',
      },
    });
  }

  // ── Step 3: Dispatch to type-specific handler ──
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
        return res.status(400).json({
          error: {
            code: 400,
            message: `Unknown payment type: ${type}`,
            status: 'INVALID_ARGUMENT',
          },
        });
    }

    return res.status(200).json({
      verified: true,
      type,
      details: result,
    });
  } catch (error: any) {
    console.error(`[Razorpay] Handler error (${type}):`, error);
    return res.status(500).json({
      error: {
        code: 500,
        message: error.message || 'Payment processing failed.',
        status: 'INTERNAL',
      },
    });
  }
});

export const verifyRazorpayPayment = functions.https.onRequest(verifyApp);

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
