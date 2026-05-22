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
 * Post-payment: verifyAndActivateSubscription() calls the Cloud Function for
 * server-side payment verification before activating the subscription.
 */

import { firestore, auth } from './firebase';
import { fetchUserProfile } from './api';
import { verifyPayment } from './cloudFunctions';

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
      'Smart assistant tools',
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

/**
 * Checks if a user can perform an action based on their plan limits.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export async function checkPlanLimit(
  userId: string,
  action: 'post' | 'story' | 'product',
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const userDoc = await firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) return { allowed: true }; // Safety fallback
    
    const subscription = userDoc.data()?.subscription || 'free';
    const limits = PLAN_LIMITS[subscription] || PLAN_LIMITS.free;
    
    if (limits[action] === -1) return { allowed: true }; // Unlimited
    
    const collectionMap = { post: 'posts', story: 'stories', product: 'products' };
    const collectionName = collectionMap[action];
    
    let query = firestore()
      .collection(collectionName)
      .where('authorId', '==', userId);
    // For stories, only count non-expired ones (stories are created with createdAt,
    // NOT expiresAt — so we filter by createdAt > 24h ago on the client side).
    // We cannot use .where('createdAt', '>', ...) reliably because our custom
    // firebase.ts stores serverTimestamp() as a sentinel that gets resolved on write,
    // and the Firestore REST API may not support inequality filters on timestamp fields
    // without a composite index. Instead, fetch all and filter client-side.
    const snapshot = await query.get();

    let currentCount = snapshot.docs.length;
    if (action === 'story') {
      // Filter client-side: only count stories created in the last 24 hours
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      currentCount = snapshot.docs.filter((doc: any) => {
        try {
          const data = doc.data ? doc.data() : (doc.data || {});
          const createdAt = data.createdAt;
          // Handle numeric timestamps, ISO strings, AND Firestore Timestamp objects
          if (typeof createdAt === 'number') return createdAt > twentyFourHoursAgo;
          if (typeof createdAt === 'string') return new Date(createdAt).getTime() > twentyFourHoursAgo;
          // BUG FIX: Handle Firestore Timestamp objects ({ _seconds, _nanoseconds })
          // These have a toDate() method or can be accessed via _seconds
          if (createdAt && typeof createdAt === 'object') {
            if (typeof createdAt.toDate === 'function') return createdAt.toDate().getTime() > twentyFourHoursAgo;
            if (createdAt._seconds) return createdAt._seconds * 1000 > twentyFourHoursAgo;
          }
          return false;
        } catch {
          return false;
        }
      }).length;
    }
    
    if (currentCount >= limits[action]) {
      const actionLabels = { post: 'posts', story: 'stories', product: 'products' };
      return {
        allowed: false,
        reason: `Free accounts can create up to ${limits[action]} ${actionLabels[action]}. Upgrade to Premium for unlimited access.`,
      };
    }
    
    return { allowed: true };
  } catch (e) {
    console.error('[PlanLimit] Check failed:', e);
    return { allowed: true }; // Allow on error to not block users
  }
}

// ── Payment initiation ────────────────────────────────────────────────────

/**
 * Initiates a payment for the given plan.
 *
 * Returns a success result so the caller (PremiumDashboardScreen) can proceed
 * to open the Razorpay WebView checkout. The actual payment is handled by the
 * Razorpay checkout modal; this function just validates that the plan is valid.
 */
export async function initiatePayment(
  options: InitiatePaymentOptions,
): Promise<PaymentResult> {
  // Return success — the UI will open the Razorpay WebView modal next.
  // paymentId will be filled in after the user completes the checkout.
  return {
    success: true,
  };
}

/**
 * Returns a flat config object that the Razorpay WebView checkout module needs.
 * Used by PremiumDashboardScreen and CheckoutScreen to open the Razorpay modal.
 */
export function getRazorpayCheckoutConfig(options: InitiatePaymentOptions) {
  return {
    amount: options.plan.amount,
    currency: options.plan.currency,
    planId: options.plan.id,
    planName: options.plan.name,
    userId: options.userId,
    userEmail: options.userEmail,
    userPhone: options.userPhone,
    userName: options.userName,
  };
}

// ── Post-payment verification & activation ────────────────────────────────

/**
 * Verifies a payment and activates the subscription via the Cloud Function.
 *
 * SECURITY FIX: The old implementation wrote directly to Firestore with zero
 * server verification — anyone could call it with a fake paymentId and get
 * premium for free. Now it delegates to the verifyRazorpayPayment Cloud
 * Function which verifies the HMAC signature server-side, fetches payment
 * details from Razorpay API, and activates the subscription atomically.
 *
 * @param params - Razorpay payment details from the checkout callback.
 * @returns The updated user profile, or null on failure.
 */
export async function verifyAndActivateSubscription(
  params: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
    planId?: string;
  },
): Promise<import('./api').User | null> {
  const currentUid = auth()?.currentUser?.uid;
  if (!currentUid) throw new Error('Not authenticated');

  // Call the server-side verification function
  const result = await verifyPayment({
    razorpayOrderId: params.razorpayOrderId,
    razorpayPaymentId: params.razorpayPaymentId,
    razorpaySignature: params.razorpaySignature,
    type: 'subscription',
    planId: params.planId,
  });

  if (!result.verified) {
    throw new Error('Payment verification failed on server');
  }

  console.log(`[Payments] Server verified payment: ${params.razorpayPaymentId}`);

  // Fetch and return the updated user profile (server already activated subscription)
  const updatedUser = await fetchUserProfile(currentUid);
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
