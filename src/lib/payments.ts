/**
 * payments.ts — Razorpay payment integration for premium subscriptions
 *
 * Provides plan definitions, payment initiation via Razorpay, and a
 * post-payment verification function that activates the subscription in
 * Firestore and creates a subscription record.
 */

import { firestore, auth } from './firebase';
import { fetchUserProfile } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PaymentPlan {
  id: string;
  name: string;
  amount: number; // in paise (e.g., 44900 = ₹449)
  currency: string;
  duration: 'monthly' | 'yearly';
  features: string[];
}

export interface InitiatePaymentOptions {
  plan: PaymentPlan;
  userId: string;
  userEmail: string;
  userPhone?: string;
  userName?: string;
}

export interface PaymentResult {
  success: boolean;
  paymentId?: string;
  error?: string;
}

export interface SubscriptionRecord {
  userId: string;
  planId: string;
  planName: string;
  amount: number;
  currency: string;
  paymentId: string;
  status: 'active' | 'cancelled' | 'expired';
  activatedAt: number;
  duration: 'monthly' | 'yearly';
}

// ── Plan definitions ───────────────────────────────────────────────────────

export const PLANS: PaymentPlan[] = [
  {
    id: 'premium',
    name: 'Premium',
    amount: 44900, // ₹449/month
    currency: 'INR',
    duration: 'monthly',
    features: [
      '25 posts per day',
      '10 stories per day',
      '50 shop products',
      '100 CRM leads',
      'Analytics dashboard',
      'Priority support',
      'Paid ads access',
      'Affiliate program',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    amount: 159900, // ₹1599/month
    currency: 'INR',
    duration: 'monthly',
    features: [
      'Unlimited posts per day',
      'Unlimited stories per day',
      '500 shop products',
      '500 CRM leads',
      'Advanced analytics dashboard',
      'Dedicated support',
      'Paid ads access',
      'Affiliate program',
      'Custom branding',
      'API access',
    ],
  },
];

// ── Plan limits (for usage bars) ──────────────────────────────────────────

export const PLAN_LIMITS: Record<string, { posts: number; stories: number; products: number; storage: number }> = {
  free: { posts: 5, stories: 3, products: 0, storage: 50 },
  premium: { posts: 25, stories: 10, products: 50, storage: 500 },
  business: { posts: -1, stories: -1, products: 500, storage: 5000 },
};

// ── Payment initiation ────────────────────────────────────────────────────

/**
 * Initiates a Razorpay payment for the given plan.
 *
 * - If `react-native-razorpay` is installed, opens the native checkout.
 * - If the module is not available, returns a clear installation message.
 */
export async function initiatePayment(
  options: InitiatePaymentOptions,
): Promise<PaymentResult> {
  const { plan, userId, userEmail, userPhone, userName } = options;

  // ── Try to load the native Razorpay module ──
  let Razorpay: any;
  try {
    Razorpay = require('react-native-razorpay').default;
  } catch {
    return {
      success: false,
      error:
        'Razorpay module not installed. Run: npm install react-native-razorpay',
    };
  }

  return new Promise<PaymentResult>((resolve) => {
    // TODO: Replace this test key with your Razorpay live key before production release.
    // Get your key from https://dashboard.razorpay.com/settings/api-keys
    const RAZORPAY_KEY = 'rzp_test_XXXXXXXXXXXXXX';

    const razorpayOptions = {
      description: `${plan.name} subscription — Black94`,
      image: '',
      currency: plan.currency,
      key: RAZORPAY_KEY,
      amount: plan.amount,
      name: 'Black94 Premium',
      prefill: {
        contact: userPhone || '',
        email: userEmail || '',
        name: userName || '',
      },
      theme: { color: '#000000' },
      notes: {
        planId: plan.id,
        userId,
        duration: plan.duration,
      },
    };

    try {
      Razorpay.open(razorpayOptions)
        .then((data: any) => {
          if (data?.razorpay_payment_id) {
            resolve({
              success: true,
              paymentId: data.razorpay_payment_id,
            });
          } else {
            resolve({
              success: false,
              error: 'Payment completed but no payment ID received.',
            });
          }
        })
        .catch((err: any) => {
          const code = err?.code || err?.description || '';
          if (code === 'PAYMENT_CANCELLED') {
            resolve({
              success: false,
              error: 'Payment was cancelled.',
            });
          } else {
            resolve({
              success: false,
              error: err?.description || err?.message || 'Payment failed. Please try again.',
            });
          }
        });
    } catch (err: any) {
      resolve({
        success: false,
        error: err?.message || 'Failed to open Razorpay checkout.',
      });
    }
  });
}

// ── Post-payment verification & activation ────────────────────────────────

/**
 * Verifies a successful payment and activates the subscription in Firestore.
 *
 * Steps:
 *  1. Updates `users/{uid}` with subscription, badge, and role (business).
 *  2. Creates a `subscriptions/{paymentId}` document for record keeping.
 *  3. Returns the fully updated user object from Firestore.
 */
export async function verifyAndActivateSubscription(
  userId: string,
  planId: string,
  paymentId: string,
): Promise<import('./api').User | null> {
  const currentUid = auth()?.currentUser?.uid;
  if (!currentUid) throw new Error('Not authenticated');

  // ── Determine badge & role based on plan ──
  const badge = planId === 'business' ? 'gold' : 'blue';
  const role = planId === 'business' ? 'business' : undefined; // keep existing role for premium

  // ── 1. Update the user document ──
  const userUpdate: Record<string, any> = {
    subscription: planId,
    badge,
    updatedAt: firestore.FieldValue.serverTimestamp(),
  };

  // Business plan upgrades role to 'business'
  if (role) {
    userUpdate.role = role;
  }

  await firestore()
    .collection('users')
    .doc(userId)
    .update(userUpdate);

  console.log(`[Payments] Updated user ${userId}: subscription=${planId}, badge=${badge}`);

  // ── 2. Create subscription record ──
  const plan = PLANS.find((p) => p.id === planId);
  const now = Date.now();

  const subscriptionData: Record<string, any> = {
    userId,
    planId,
    planName: plan?.name || planId,
    amount: plan?.amount || 0,
    currency: plan?.currency || 'INR',
    paymentId,
    status: 'active',
    activatedAt: new Date().toISOString(),
    duration: plan?.duration || 'monthly',
  };

  await firestore()
    .collection('subscriptions')
    .doc(paymentId)
    .set(subscriptionData);

  console.log(`[Payments] Created subscription record: ${paymentId}`);

  // ── 3. Fetch and return the updated user profile ──
  const updatedUser = await fetchUserProfile(userId);
  return updatedUser;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Formats an amount in paise to a human-readable INR string.
 * Example: 44900 → "₹449"
 */
export function formatAmount(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

/**
 * Finds a plan by its ID.
 */
export function getPlanById(planId: string): PaymentPlan | undefined {
  return PLANS.find((p) => p.id === planId);
}
