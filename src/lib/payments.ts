/**
 * payments.ts — Razorpay payment integration for premium subscriptions
 *
 * Provides plan definitions and a payment initiation function that tries
 * the native Razorpay module if available, and returns a clear error
 * message if the module is not installed.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface PaymentPlan {
  id: string;
  name: string;
  amount: number; // in paise (e.g., 49900 = ₹499)
  currency: string;
  duration: 'monthly' | 'yearly';
  features: string[];
}

// ── Plan definitions ───────────────────────────────────────────────────────

export const PLANS: PaymentPlan[] = [
  {
    id: 'pro_monthly',
    name: 'Pro Monthly',
    amount: 49900,
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
    id: 'pro_yearly',
    name: 'Pro Yearly',
    amount: 499000,
    currency: 'INR',
    duration: 'yearly',
    features: [
      '25 posts per day',
      '10 stories per day',
      '50 shop products',
      '100 CRM leads',
      'Analytics dashboard',
      'Priority support',
      'Paid ads access',
      'Affiliate program',
      '2 months free (save ₹998)',
    ],
  },
];

// ── Payment initiation ────────────────────────────────────────────────────

interface InitiatePaymentOptions {
  plan: PaymentPlan;
  userId: string;
  userEmail: string;
  userPhone?: string;
  userName?: string;
}

interface PaymentResult {
  success: boolean;
  paymentId?: string;
  error?: string;
}

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
    const razorpayOptions = {
      description: `${plan.name} subscription`,
      image: '',
      currency: plan.currency,
      key: 'rzp_test_XXXXXXXXXXXXXX', // Replace with your Razorpay test/live key
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
          // data.razorpay_payment_id contains the payment identifier
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
          // Razorpay codes: NETWORK_ERROR, INVALID_OPTIONS, PAYMENT_CANCELLED, etc.
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

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Formats an amount in paise to a human-readable INR string.
 * Example: 49900 → "₹499"
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
