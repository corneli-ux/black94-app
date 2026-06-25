/**
 * payments.ts — STUBBED
 * Payment and subscription logic removed. Will be rebuilt once app ID is confirmed.
 */

/**
 * checkPlanLimit — always returns allowed (no limits while payments are disabled).
 */
export async function checkPlanLimit(
  _userId: string,
  _feature: string,
): Promise<{ allowed: boolean; reason?: string }> {
  return { allowed: true };
}

export async function getUserSubscription(_userId: string): Promise<string> {
  return 'free';
}

export const PLANS: any[] = [];

export function formatAmount(_amount: number): string {
  return '';
}
