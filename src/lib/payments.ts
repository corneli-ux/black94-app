/**
 * payments.ts — Payment integration for premium subscriptions
 *
 * Provides plan definitions and subscription activation logic.
 *
 * Payment flow:
 *  - Web: Opens Razorpay Checkout.js in a WebView / browser redirect
 *  - Native: Razorpay native SDK integration (requires react-native-razorpay)
 *  - Until payment gateway credentials are provided, the checkout is gated
 *    with a clear message.
 *
 * Post-payment: verifyAndActivateSubscription() writes to Firestore.
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
    amount: 52000, // ₹520/month (₹449 + 15% Google commission, rounded)
    currency: 'INR',
    duration: 'monthly',
    features: [
      'Creator revenue share eligibility',
      'Early access to new features',
      'Ad revenue share (chat & DMs)',
      'Anonymous chat access',
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
    amount: 185000, // ₹1850/month (₹1599 + 15% Google commission, rounded)
    currency: 'INR',
    duration: 'monthly',
    features: [
      'Everything in Premium',
      'Unlimited shop products',
      '500 CRM leads',
      'Store & CRM dashboard',
      'AI-powered features',
      'Custom branding',
      'API access',
      'Dedicated support',
      'Advanced analytics',
    ],
  },
];

// ── Plan limits (for usage bars) ──────────────────────────────────────────

export const PLAN_LIMITS: Record<string, { posts: number; stories: number; products: number; storage: number }> = {
  free: { posts: 5, stories: 3, products: 0, storage: 50 },
  premium: { posts: -1, stories: -1, products: 50, storage: 500 },
  business: { posts: -1, stories: -1, products: 500, storage: 5000 },
};

// ── Payment initiation ────────────────────────────────────────────────────

/**
 * Initiates a payment for the given plan.
 *
 * Currently returns a placeholder result until Razorpay credentials are
 * configured. When ready, integrate:
 *  - Web: Razorpay Checkout.js (loaded via script tag in webbuild)
 *  - Native: react-native-razorpay native module
 */
export async function initiatePayment(
  options: InitiatePaymentOptions,
): Promise<PaymentResult> {
  // Payment gateway credentials pending configuration.
  // When Razorpay key is available, integrate the native or web checkout here.
  return {
    success: false,
    error: 'Payment gateway is being configured. Please try again later.',
  };
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

  // ── Determine role based on plan (badges removed per platform decision) ──
  const badge = ''; // No badge assigned — badges removed per platform decision
  const role = planId === 'business' ? 'business' : undefined;

  // ── 1. Update the user document ──
  const userUpdate: Record<string, any> = {
    subscription: planId,
    // badge intentionally not set — platform decision to remove verification badges
    updatedAt: firestore.FieldValue.serverTimestamp(),
  };

  if (role) {
    userUpdate.role = role;
  }

  await firestore()
    .collection('users')
    .doc(userId)
    .update(userUpdate);

  console.log(`[Payments] Updated user ${userId}: subscription=${planId}`);

  // ── 2. Create subscription record ──
  const plan = PLANS.find((p) => p.id === planId);

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
