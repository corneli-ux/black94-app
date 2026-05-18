/**
 * handlers.ts — Payment type-specific handlers for Razorpay Cloud Functions
 *
 * Each handler processes a verified payment for a specific use case:
 *  - handleSubscriptionPayment  → Activate premium/business plan
 *  - handleOrderPayment         → Create/confirm e-commerce order
 *  - handlePaidChatPayment      → Grant chat access
 *  - handleWebhookEvent         → Process Razorpay webhook events
 */

import { Firestore } from 'firebase-admin/firestore';

// ── Types ──────────────────────────────────────────────────────────────────

interface PaymentEntity {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  order_id?: string;
  notes?: Record<string, string>;
  captured?: boolean;
  method?: string;
  email?: string;
  contact?: string;
  created_at?: number;
}

// ── Plan definitions (mirrored from client) ────────────────────────────────

const PLAN_CONFIG: Record<string, { badge: string; role?: string }> = {
  premium: { badge: 'blue' },
  business: { badge: 'gold', role: 'business' },
};

// ── Subscription Handler ───────────────────────────────────────────────────

/**
 * Handles post-verification for subscription payments.
 *
 * 1. Updates the user document (subscription, badge, role, isVerified)
 * 2. Creates a subscription record
 *
 * Payload expected:
 *   { planId: 'premium' | 'business' }
 */
export async function handleSubscriptionPayment(
  db: Firestore,
  uid: string,
  paymentId: string,
  orderId: string,
  payment: PaymentEntity,
  payload: { planId: string },
) {
  const { planId } = payload;
  const config = PLAN_CONFIG[planId];

  if (!config) {
    throw new Error(`Unknown plan ID: ${planId}`);
  }

  // 1. Update user document
  const userUpdate: Record<string, any> = {
    subscription: planId,
    badge: config.badge,
    isVerified: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (config.role) {
    userUpdate.role = config.role;
  }

  await db.collection('users').doc(uid).update(userUpdate);

  console.log(`[Payment] Activated ${planId} subscription for user ${uid}`);

  // 2. Create subscription record
  const planNames: Record<string, string> = {
    premium: 'Premium',
    business: 'Business',
  };

  const subscriptionData = {
    userId: uid,
    planId,
    planName: planNames[planId] || planId,
    amount: payment.amount,
    currency: payment.currency,
    paymentId,
    razorpayOrderId: orderId,
    status: 'active',
    activatedAt: new Date().toISOString(),
    duration: 'monthly',
    paymentMethod: payment.method || 'unknown',
    userEmail: payment.email || '',
    userPhone: payment.contact || '',
  };

  await db.collection('subscriptions').doc(paymentId).set(subscriptionData);

  console.log(`[Payment] Created subscription record: ${paymentId}`);

  return {
    planId,
    badge: config.badge,
    activated: true,
  };
}

// ── Order Handler ─────────────────────────────────────────────────────────

/**
 * Handles post-verification for e-commerce order payments.
 *
 * 1. Creates the order document in Firestore with paymentId
 *
 * Payload expected:
 *   { items: any[], shippingAddress: any, shippingPartner: string,
 *     shippingCost: number, subtotal: number, total: number }
 */
export async function handleOrderPayment(
  db: Firestore,
  uid: string,
  paymentId: string,
  orderId: string,
  payment: PaymentEntity,
  payload: {
    items: any[];
    shippingAddress: any;
    shippingPartner: string;
    shippingCost: number;
    subtotal: number;
    total: number;
  },
) {
  const orderData = {
    userId: uid,
    items: payload.items || [],
    shippingAddress: payload.shippingAddress || {},
    shippingPartner: payload.shippingPartner || 'standard',
    shippingCost: payload.shippingCost || 0,
    subtotal: payload.subtotal || 0,
    total: payload.total || payment.amount / 100,
    paymentMethod: 'prepaid',
    paymentId,
    razorpayOrderId: orderId,
    status: 'placed',
    paymentMethodDetail: payment.method || 'unknown',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const orderRef = await db.collection('orders').add(orderData);

  console.log(
    `[Payment] Created order ${orderRef.id} for user ${uid}, payment ${paymentId}`,
  );

  return {
    orderId: orderRef.id,
    status: 'placed',
  };
}

// ── Paid Chat Handler ─────────────────────────────────────────────────────

/**
 * Handles post-verification for paid chat payments.
 *
 * 1. Creates a paid_chat_access document granting DM access
 * 2. Creates a payment record for the chat access
 *
 * Payload expected:
 *   { targetUserId: string, chatPrice: number }
 */
export async function handlePaidChatPayment(
  db: Firestore,
  uid: string,
  paymentId: string,
  orderId: string,
  payment: PaymentEntity,
  payload: { targetUserId: string; chatPrice: number },
) {
  const { targetUserId, chatPrice } = payload;

  if (!targetUserId) {
    throw new Error('targetUserId is required for paid chat payment');
  }

  // 1. Create paid chat access document
  const accessId = `${uid}_${targetUserId}`;
  const accessData = {
    payerId: uid,
    receiverId: targetUserId,
    price: chatPrice,
    paymentId,
    razorpayOrderId: orderId,
    paymentMethod: payment.method || 'unknown',
    status: 'active',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('paid_chat_access').doc(accessId).set(accessData);

  // 2. Create a payment record for tracking
  await db.collection('chat_payments').doc(paymentId).set({
    payerId: uid,
    receiverId: targetUserId,
    amount: payment.amount,
    currency: payment.currency,
    paymentId,
    razorpayOrderId: orderId,
    status: 'completed',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(
    `[Payment] Granted chat access: ${uid} → ${targetUserId}, payment ${paymentId}`,
  );

  return {
    accessId,
    targetUserId,
    chatStarted: true,
  };
}

// ── Webhook Handler ───────────────────────────────────────────────────────

/**
 * Processes Razorpay webhook events.
 *
 * Supported events:
 *  - payment.captured: Updates payment status to captured
 *  - payment.failed: Updates payment status to failed
 *  - payment.refunded: Updates payment status to refunded
 */
export async function handleWebhookEvent(
  db: Firestore,
  event: any,
): Promise<void> {
  const eventType = event.event;
  const payment = event.payload?.payment?.entity;

  if (!payment) {
    console.log(`[Webhook] No payment entity in event ${eventType}`);
    return;
  }

  const paymentId = payment.id;

  switch (eventType) {
    case 'payment.captured':
      // Payment was successfully captured — update subscription/order if needed
      console.log(`[Webhook] Payment captured: ${paymentId}`);
      await updatePaymentRecord(db, paymentId, 'captured', payment);
      break;

    case 'payment.failed':
      // Payment failed — mark any related records
      console.log(`[Webhook] Payment failed: ${paymentId}`);
      await updatePaymentRecord(db, paymentId, 'failed', payment);
      break;

    case 'payment.refunded':
      // Payment was refunded
      console.log(`[Webhook] Payment refunded: ${paymentId}`);
      await updatePaymentRecord(db, paymentId, 'refunded', payment);

      // If it was a subscription, revert the user's plan
      if (payment.notes?.type === 'subscription') {
        const userId = payment.notes?.userId;
        if (userId) {
          await db.collection('users').doc(userId).update({
            subscription: 'free',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[Webhook] Reverted subscription for user ${userId}`);
        }
      }
      break;

    case 'order.paid':
      console.log(`[Webhook] Order paid: ${payment.order_id}`);
      break;

    default:
      console.log(`[Webhook] Unhandled event type: ${eventType}`);
  }
}

/**
 * Updates a payment record in the subscriptions/chat_payments collection.
 */
async function updatePaymentRecord(
  db: Firestore,
  paymentId: string,
  status: string,
  payment: any,
) {
  // Try updating subscription record
  const subRef = db.collection('subscriptions').doc(paymentId);
  const subDoc = await subRef.get();
  if (subDoc.exists) {
    await subRef.update({ status });
    console.log(`[Webhook] Updated subscription ${paymentId} → ${status}`);
    return;
  }

  // Try updating chat payment record
  const chatRef = db.collection('chat_payments').doc(paymentId);
  const chatDoc = await chatRef.get();
  if (chatDoc.exists) {
    await chatRef.update({ status });
    console.log(`[Webhook] Updated chat payment ${paymentId} → ${status}`);
    return;
  }

  // Try updating paid_chat_access record by querying
  try {
    const accessSnap = await db
      .collection('paid_chat_access')
      .where('paymentId', '==', paymentId)
      .get();

    if (!accessSnap.empty) {
      const batch = db.batch();
      accessSnap.docs.forEach((doc) => {
        batch.update(doc.ref, {
          status: status === 'captured' ? 'active' : status,
        });
      });
      await batch.commit();
      console.log(
        `[Webhook] Updated ${accessSnap.size} chat access record(s) → ${status}`,
      );
    }
  } catch (e) {
    console.warn('[Webhook] Failed to query paid_chat_access:', e);
  }
}

// Need admin import for FieldValue
import * as admin from 'firebase-admin';
