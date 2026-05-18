/**
 * PremiumDashboardScreen.tsx — Premium subscription dashboard
 *
 * Shows current plan with prominent badge, real Firestore usage stats,
 * feature comparison table, upgrade flow via Razorpay, success modal,
 * and manage subscription controls.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { auth, firestore } from '../lib/firebase';
import {
  PLANS,
  PLAN_LIMITS,
  formatAmount,
  getPlanById,
} from '../lib/payments';
import type { PaymentPlan } from '../lib/payments';
import { fetchUserProfile } from '../lib/api';
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  openRazorpayCheckout,
  handleRazorpayMessage,
  isRazorpayConfigured,
} from '../lib/razorpay';
import type { RazorpayResult } from '../lib/razorpay';

// ── Types ──────────────────────────────────────────────────────────────────

type PlanType = 'free' | 'premium' | 'business';

interface FeatureRow {
  feature: string;
  free: string | boolean;
  premium: string | boolean;
  business: string | boolean;
}

interface UsageStats {
  products: { current: number; limit: number };
  storage: { current: number; limit: number };
}

// ── Data ───────────────────────────────────────────────────────────────────

const FEATURES: FeatureRow[] = [
  { feature: 'Shop products', free: '0', premium: '50', business: 'Unlimited' },
  { feature: 'Analytics', free: false, premium: true, business: true },
  { feature: 'Priority support', free: false, premium: true, business: true },
  { feature: 'Ads (paid)', free: false, premium: true, business: true },
  { feature: 'Affiliate Program', free: false, premium: true, business: true },
  { feature: 'Creator Revenue Share', free: false, premium: 'Eligible*', business: 'Eligible*' },
  { feature: 'Early Access', free: false, premium: true, business: true },
  { feature: 'Ad Revenue Share', free: false, premium: true, business: true },
  { feature: 'Anonymous Chat', free: false, premium: true, business: true },
  { feature: 'Store / CRM', free: false, premium: false, business: true },
];

// ── Usage fetching helpers ─────────────────────────────────────────────────

async function fetchUsageStats(userId: string, currentPlan: PlanType): Promise<UsageStats> {
  const limits = PLAN_LIMITS[currentPlan] || PLAN_LIMITS.free;

  // Default stats — will be overwritten with real data
  const stats: UsageStats = {
    products: { current: 0, limit: limits.products === -1 ? 999 : limits.products },
    storage: { current: 0, limit: limits.storage },
  };

  try {
    // ── Product count: query products where ownerId == userId ──
    const productsSnap = await firestore()
      .collection('products')
      .where('ownerId', '==', userId)
      .get();
    stats.products.current = productsSnap.size;
  } catch (e) {
    console.warn('[Premium] Failed to fetch product count:', e);
  }

  try {
    // ── Storage estimate: fetch user doc and estimate from profile/cover image URLs ──
    const userDoc = await firestore().collection('users').doc(userId).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    const profileUrl = userData?.profileImage || '';
    const coverUrl = userData?.coverImage || '';

    // Base64 data URIs: the size is embedded in the string length
    let estimatedMB = 0;
    for (const url of [profileUrl, coverUrl]) {
      if (url && url.startsWith('data:')) {
        // Approximate: base64 is ~75% of raw size; divide by 1M for MB
        const base64Length = url.split(',')[1]?.length || 0;
        estimatedMB += (base64Length * 0.75) / (1024 * 1024);
      } else if (url) {
        // HTTPS URL — we can't know the file size from the URL alone
        estimatedMB += 0.5; // rough estimate per hosted image
      }
    }
    stats.storage.current = Math.round(estimatedMB);
  } catch (e) {
    console.warn('[Premium] Failed to estimate storage:', e);
  }

  return stats;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PremiumDashboardScreen() {
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);

  const [loading, setLoading] = useState(true);
  const [currentPlan, setCurrentPlan] = useState<PlanType>(
    (user?.subscription as PlanType) || 'free',
  );
  const [usage, setUsage] = useState<UsageStats>({
    products: { current: 0, limit: PLAN_LIMITS.free.products },
    storage: { current: 0, limit: PLAN_LIMITS.free.storage },
  });

  // Payment state
  const [paymentLoading, setPaymentLoading] = useState(false);

  // Razorpay WebView modal state
  const [razorpayModalVisible, setRazorpayModalVisible] = useState(false);
  const [razorpayHTML, setRazorpayHTML] = useState('');
  const pendingPlanRef = useRef<PaymentPlan | null>(null);
  const pendingUserIdRef = useRef<string | null>(null);

  // Success modal state
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [activatedPlan, setActivatedPlan] = useState<PaymentPlan | null>(null);

  // ── Load real usage stats ──
  const loadUsageStats = useCallback(async (plan: PlanType) => {
    const uid = auth()?.currentUser?.uid;
    if (!uid) return;

    try {
      const stats = await fetchUsageStats(uid, plan);
      setUsage(stats);
    } catch (e) {
      console.warn('[Premium] Failed to load usage stats:', e);
    }
  }, []);

  useEffect(() => {
    const plan = (user?.subscription as PlanType) || 'free';
    setCurrentPlan(plan);
    loadUsageStats(plan).finally(() => setLoading(false));
  }, [user, loadUsageStats]);

  // ── Upgrade handler ──
  const handleUpgrade = useCallback(
    async (planType: PlanType) => {
      const uid = auth()?.currentUser?.uid;
      if (!uid) {
        Alert.alert('Error', 'You must be signed in to upgrade.');
        return;
      }

      const plan = getPlanById(planType);
      if (!plan) {
        Alert.alert('Error', `Unknown plan: ${planType}`);
        return;
      }

      Alert.alert(
        `Upgrade to ${plan.name}`,
        `${plan.features.slice(0, 3).join(' · ')} and more.\n\n${formatAmount(plan.amount)}/month`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Pay Now',
            style: 'default',
            onPress: () => processPayment(plan, uid),
          },
        ],
      );
    },
    [],
  );

  // ── Handle Razorpay WebView result ──
  const handleRazorpayResult = useCallback(async (result: RazorpayResult) => {
    setRazorpayModalVisible(false);
    setRazorpayHTML('');

    const plan = pendingPlanRef.current;
    const userId = pendingUserIdRef.current;
    pendingPlanRef.current = null;
    pendingUserIdRef.current = null;

    if (!plan || !userId) {
      setPaymentLoading(false);
      return;
    }

    if (!result.success || !result.paymentId) {
      setPaymentLoading(false);
      if (result.error && result.error !== 'Payment was cancelled.') {
        Alert.alert('Payment Failed', result.error);
      }
      return;
    }

    try {
      // Verify payment server-side (signature check + subscription activation)
      const verifyResult = await verifyRazorpayPayment({
        razorpayOrderId: result.razorpayOrderId || '',
        razorpayPaymentId: result.paymentId,
        razorpaySignature: result.razorpaySignature || '',
        type: 'subscription',
        planId: plan.id,
      });

      if (verifyResult.verified) {
        // Fetch the updated user profile (server already activated subscription)
        const updatedUser = await fetchUserProfile(userId);
        if (updatedUser) {
          setUser(updatedUser);
          setCurrentPlan(plan.id as PlanType);
          await loadUsageStats(plan.id as PlanType);
        }
        setActivatedPlan(plan);
        setSuccessModalVisible(true);
      } else {
        Alert.alert('Error', 'Payment verification failed. Please contact support.');
      }
    } catch (e: any) {
      console.error('[Premium] Upgrade error:', e);
      Alert.alert('Upgrade', e.message || 'Something went wrong. Please try again.');
    } finally {
      setPaymentLoading(false);
    }
  }, [setUser, loadUsageStats]);

  const processPayment = async (plan: PaymentPlan, userId: string) => {
    setPaymentLoading(true);

    if (!isRazorpayConfigured()) {
      setPaymentLoading(false);
      Alert.alert(
        'Payment Unavailable',
        'Razorpay key not configured. Set the RAZORPAY_KEY_ID environment variable.',
      );
      return;
    }

    // Step 1: Create Razorpay order server-side (prevents amount tampering)
    let orderResult;
    try {
      orderResult = await createRazorpayOrder({
        amount: plan.amount,
        currency: plan.currency,
        receipt: `sub_${userId}_${Date.now()}`,
        notes: { userId, planId: plan.id, type: 'subscription' },
      });
    } catch (e: any) {
      setPaymentLoading(false);
      Alert.alert('Error', e.message || 'Could not create payment order. Please try again.');
      return;
    }

    const { html, keyMissing } = openRazorpayCheckout(
      {
        amount: plan.amount,
        currency: plan.currency,
        receipt: orderResult.receipt,
        planName: `Black94 ${plan.name} Subscription`,
        userName: user?.displayName || user?.username || '',
        userEmail: user?.email || '',
        userPhone: '',
      },
      orderResult.orderId,
    );

    if (keyMissing) {
      setPaymentLoading(false);
      Alert.alert('Error', 'Razorpay key is missing. Please contact support.');
      return;
    }

    // Store refs for the callback
    pendingPlanRef.current = plan;
    pendingUserIdRef.current = userId;

    // Open Razorpay WebView modal
    setRazorpayHTML(html);
    setRazorpayModalVisible(true);
  };

  // ── Manage plan: view details & cancel subscription ──
  const handleManagePlan = useCallback(() => {
    const user = useAppStore.getState().user;
    if (!user || user.subscription === 'free') {
      Alert.alert('No Active Subscription', 'You are currently on the free plan.');
      return;
    }

    Alert.alert(
      'Manage Subscription',
      `Your ${user.subscription.charAt(0).toUpperCase() + user.subscription.slice(1)} plan is active and will renew automatically.\n\nTo cancel, change your plan, or update billing details, contact support or cancel below.`,
      [
        { text: 'OK', style: 'default' },
        {
          text: 'Cancel Subscription',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Cancel Subscription',
              'Are you sure you want to cancel? You will lose access to premium features at the end of your billing period.',
              [
                { text: 'Keep Subscription', style: 'cancel' },
                {
                  text: 'Cancel',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      const uid = auth()?.currentUser?.uid;
                      if (!uid) return;

                      // Update user subscription back to free and remove business role
                      await firestore().collection('users').doc(uid).update({
                        subscription: 'free',
                        badge: '',
                        role: '',  // Clear role — custom firebase.ts doesn't support FieldValue.delete()
                        updatedAt: firestore.FieldValue.serverTimestamp(),
                      });

                      // Mark any active subscription records as cancelled
                      const subs = await firestore()
                        .collection('subscriptions')
                        .where('userId', '==', uid)
                        .where('status', '==', 'active')
                        .get();

                      const batch = firestore().batch();
                      subs.docs.forEach(doc => {
                        batch.update(doc.ref, { status: 'cancelled', cancelledAt: new Date().toISOString() });
                      });
                      if (subs.docs.length > 0) await batch.commit();

                      // Refresh the app store user data
                      const updatedUser = await firestore().collection('users').doc(uid).get();
                      if (updatedUser.exists) {
                        useAppStore.getState().setUser({ id: uid, ...updatedUser.data() });
                      }

                      Alert.alert('Subscription Cancelled', 'Your subscription has been cancelled. You can continue using premium features until the end of your billing period.');
                    } catch (e: any) {
                      console.error('[PremiumDashboard] Cancel failed:', e);
                      Alert.alert('Error', 'Failed to cancel subscription. Please try again or contact support.');
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, []);

  // ── Visual helpers ──
  const planIcon = (plan: PlanType, size: number = 36) => {
    switch (plan) {
      case 'free': return <Ionicons name="fitness-outline" size={size} color={planColor(plan)} />;
      case 'premium': return <Ionicons name="star" size={size} color={planColor(plan)} />;
      case 'business': return <Ionicons name="rocket" size={size} color={planColor(plan)} />;
    }
  };

  const planColor = (plan: PlanType) => {
    switch (plan) {
      case 'free': return colors.textMuted;
      case 'premium': return colors.accentGold;
      case 'business': return colors.verified;
    }
  };

  const planBorderColor = (plan: PlanType) => {
    switch (plan) {
      case 'free': return colors.border;
      case 'premium': return colors.accentGold;
      case 'business': return colors.verified;
    }
  };

  const planBadgeLabel = (plan: PlanType) => {
    switch (plan) {
      case 'free': return null;
      case 'premium': return 'Premium Badge';
      case 'business': return 'Gold Badge + Business Role';
    }
  };

  const renderUsageBar = useCallback(
    (label: string, current: number, limit: number) => {
      if (limit === 0) return null;
      const isUnlimited = limit >= 999;
      const pct = isUnlimited ? 0 : Math.min((current / limit) * 100, 100);
      return (
        <View style={styles.usageRow} key={label}>
          <Text style={styles.usageLabel}>{label}</Text>
          <View style={styles.usageBarBg}>
            <View
              style={[
                styles.usageBarFill,
                {
                  width: isUnlimited ? '0%' : `${Math.max(pct, current > 0 ? 4 : 0)}%`,
                  backgroundColor: isUnlimited
                    ? colors.accentGreen
                    : pct > 80
                      ? colors.error
                      : pct > 50
                        ? colors.accentGold
                        : colors.primary,
                },
              ]}
            />
          </View>
          <Text style={styles.usageCount}>
            {isUnlimited ? `${current} / ∞` : `${current}/${limit}`}
          </Text>
        </View>
      );
    },
    [],
  );

  // ── Loading state ──
  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  // ── Render ──
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>

        {/* ═══ Current plan card ═══ */}
        <View style={[styles.planCard, { borderColor: planBorderColor(currentPlan) }]}>
          <View style={styles.planCardHeader}>
            {planIcon(currentPlan)}
            <View style={styles.planInfo}>
              <Text style={styles.planName}>
                {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} Plan
              </Text>
              <Text style={styles.planStatus}>
                {currentPlan === 'free'
                  ? 'Upgrade to unlock premium features'
                  : 'You have access to all features'}
              </Text>
            </View>
            {/* Prominent plan badge */}
            {currentPlan !== 'free' && (
              <View
                style={[
                  styles.planBadge,
                  {
                    backgroundColor:
                      currentPlan === 'premium'
                        ? `${colors.accentGold}22`
                        : `${colors.verified}22`,
                    borderColor:
                      currentPlan === 'premium'
                        ? colors.accentGold
                        : colors.verified,
                  },
                ]}>
                <Ionicons
                  name={currentPlan === 'premium' ? 'star' : 'rocket'}
                  size={12}
                  color={
                    currentPlan === 'premium'
                      ? colors.accentGold
                      : colors.verified
                  }
                />
                <Text
                  style={[
                    styles.planBadgeText,
                    {
                      color:
                        currentPlan === 'premium'
                          ? colors.accentGold
                          : colors.verified,
                    },
                  ]}>
                  {currentPlan === 'premium' ? 'Premium' : 'Business'}
                </Text>
              </View>
            )}
          </View>

          {/* Badge info line for subscribed users */}
          {planBadgeLabel(currentPlan) && (
            <View style={styles.badgeInfoRow}>
              <Ionicons
                name="shield-checkmark"
                size={16}
                color={planColor(currentPlan)}
              />
              <Text style={[styles.badgeInfoText, { color: planColor(currentPlan) }]}>
                {planBadgeLabel(currentPlan)}
                {currentPlan === 'business' && ' · 2 free affiliate badges included'}
              </Text>
            </View>
          )}

          {/* Affiliate badges info for business */}
          {currentPlan === 'business' && (
            <View style={styles.affiliateInfoCard}>
              <View style={styles.affiliateInfoHeader}>
                <Ionicons name="people" size={16} color={colors.verified} />
                <Text style={styles.affiliateInfoTitle}>Affiliate Badges</Text>
              </View>
              <Text style={styles.affiliateInfoDesc}>
                Your Business plan includes 2 free badges you can assign to team members or affiliates. Use them to build brand authority.
              </Text>
              <View style={styles.affiliateBadgeRow}>
                <View style={styles.affiliateBadgeSlot}>
                  <Ionicons name="medal" size={20} color={colors.verifiedGold} />
                  <Text style={styles.affiliateBadgeLabel}>Badge Slot 1</Text>
                </View>
                <View style={styles.affiliateBadgeSlot}>
                  <Ionicons name="medal" size={20} color={colors.verifiedGold} />
                  <Text style={styles.affiliateBadgeLabel}>Badge Slot 2</Text>
                </View>
              </View>
            </View>
          )}

          {/* Upgrade buttons or billing info */}
          {currentPlan === 'free' ? (
            <View style={styles.upgradeRow}>
              <TouchableOpacity
                style={styles.upgradeBtn}
                onPress={() => handleUpgrade('premium')}
                activeOpacity={0.7}
                disabled={paymentLoading}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="star" size={16} color={colors.accentGold} />
                  <Text style={styles.upgradeBtnTitle}>Premium</Text>
                </View>
                <Text style={styles.upgradeBtnPrice}>{formatAmount(PLANS[0].amount)}/mo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.upgradeBtnOutline}
                onPress={() => handleUpgrade('business')}
                activeOpacity={0.7}
                disabled={paymentLoading}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="rocket" size={16} color={colors.accentGold} />
                  <Text style={styles.upgradeBtnOutlineTitle}>Business</Text>
                </View>
                <Text style={styles.upgradeBtnOutlinePrice}>{formatAmount(PLANS[1].amount)}/mo</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.billingRow}>
              <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
              <Text style={styles.billingText}>
                Billing period: Monthly · Renews automatically
              </Text>
            </View>
          )}
        </View>

        {/* ═══ Payment loading overlay indicator ═══ */}
        {paymentLoading && (
          <View style={styles.paymentLoadingCard}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.paymentLoadingText}>Processing payment…</Text>
          </View>
        )}

        {/* ═══ Usage meter ═══ */}
        <View style={styles.usageCard}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="pie-chart-outline" size={18} color={colors.primary} />
            <Text style={styles.sectionTitle}>Usage This Month</Text>
          </View>
          {usage.products.limit > 0 && renderUsageBar('Products', usage.products.current, usage.products.limit)}
          {renderUsageBar('Storage (MB)', usage.storage.current, usage.storage.limit)}
        </View>

        {/* ═══ Feature comparison table ═══ */}
        <View style={styles.tableCard}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="list-outline" size={18} color={colors.primary} />
            <Text style={styles.sectionTitle}>Feature Comparison</Text>
          </View>
          <View style={styles.tableHeader}>
            <Text style={styles.tableFeatureCol}>Feature</Text>
            <View style={styles.tableCol}>
              <Text style={[styles.tableColText, { color: colors.textMuted }]}>Free</Text>
            </View>
            <View style={styles.tableCol}>
              <Text style={[styles.tableColText, { color: colors.accentGold }]}>Premium</Text>
            </View>
            <View style={styles.tableCol}>
              <Text style={[styles.tableColText, { color: colors.verified }]}>Business</Text>
            </View>
          </View>
          {FEATURES.map((feat) => (
            <View key={feat.feature} style={styles.tableRow}>
              <Text style={styles.tableFeatureCol} numberOfLines={1}>
                {feat.feature}
              </Text>
              <View style={styles.tableCol}>
                <Text style={styles.tableCellValue}>
                  {typeof feat.free === 'boolean'
                    ? feat.free ? '✓' : '–'
                    : feat.free}
                </Text>
              </View>
              <View style={styles.tableCol}>
                <Text style={styles.tableCellValue}>
                  {typeof feat.premium === 'boolean'
                    ? feat.premium ? '✓' : '–'
                    : feat.premium}
                </Text>
              </View>
              <View style={styles.tableCol}>
                <Text style={styles.tableCellValue}>
                  {typeof feat.business === 'boolean'
                    ? feat.business ? '✓' : '–'
                    : feat.business}
                </Text>
              </View>
            </View>
          ))}
          <Text style={styles.tableDisclaimer}>
            * Creator Revenue Share is available when the program launches and you meet platform requirements.
          </Text>
        </View>

        {/* ═══ Manage subscription (subscribed users only) ═══ */}
        {currentPlan !== 'free' && (
          <TouchableOpacity
            style={styles.manageBtn}
            onPress={handleManagePlan}
            activeOpacity={0.7}>
            <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.manageBtnText}>Manage Subscription</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* ═══ Razorpay WebView Modal ═══ */}
      <Modal
        visible={razorpayModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          setRazorpayModalVisible(false);
          setRazorpayHTML('');
          setPaymentLoading(false);
          pendingPlanRef.current = null;
          pendingUserIdRef.current = null;
        }}>
        <SafeAreaView style={styles.razorpayModalContainer} edges={['top', 'bottom']}>
          <View style={styles.razorpayModalHeader}>
            <TouchableOpacity
              onPress={() => {
                setRazorpayModalVisible(false);
                setRazorpayHTML('');
                setPaymentLoading(false);
                pendingPlanRef.current = null;
                pendingUserIdRef.current = null;
              }}
              hitSlop={8}
              style={{ padding: 8 }}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.razorpayModalTitle}>Payment</Text>
            <View style={{ width: 40 }} />
          </View>
          {razorpayHTML ? (
            <WebView
              source={{ html: razorpayHTML }}
              onMessage={(event) => handleRazorpayResult(handleRazorpayMessage(event))}
              style={{ flex: 1 }}
              javaScriptEnabled
              domStorageEnabled
            />
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* ═══ Success Modal ═══ */}
      <Modal
        visible={successModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSuccessModalVisible(false)}>
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setSuccessModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="checkmark-circle" size={56} color={colors.accentGreen} />
            </View>
            <Text style={styles.modalTitle}>Welcome to {activatedPlan?.name}!</Text>
            <Text style={styles.modalDesc}>
              {activatedPlan?.id === 'business'
                ? 'Your Business plan is now active. You\'ve been upgraded with a Gold badge, Business role, and 2 free affiliate badges.'
                : 'Your Premium plan is now active. You\'ve been upgraded with a Premium badge and access to all premium features.'}
            </Text>
            <TouchableOpacity
              style={styles.modalBtn}
              activeOpacity={0.7}
              onPress={() => setSuccessModalVisible(false)}>
              <Text style={styles.modalBtnText}>Start Exploring</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 40,
  },

  // ── Plan card ──
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  planCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  planInfo: {
    flex: 1,
  },
  planName: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    fontFamily: 'Roboto-Bold',
  },
  planStatus: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
    fontFamily: 'Roboto-Regular',
  },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  planBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Roboto-Bold',
  },
  badgeInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: `${colors.surfaceLight}88`,
    borderRadius: 8,
  },
  badgeInfoText: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: 'Roboto-Medium',
  },

  // ── Affiliate badges info ──
  affiliateInfoCard: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: `${colors.verified}44`,
  },
  affiliateInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  affiliateInfoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    fontFamily: 'Roboto-Bold',
  },
  affiliateInfoDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 10,
    fontFamily: 'Roboto-Regular',
  },
  affiliateBadgeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  affiliateBadgeSlot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: `${colors.verifiedGold}44`,
  },
  affiliateBadgeLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontFamily: 'Roboto-Medium',
  },

  // ── Upgrade buttons ──
  upgradeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  upgradeBtn: {
    flex: 1,
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  upgradeBtnTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
    fontFamily: 'Roboto-Bold',
  },
  upgradeBtnPrice: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    fontFamily: 'Roboto-Regular',
  },
  upgradeBtnOutline: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.accentGold,
  },
  upgradeBtnOutlineTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accentGold,
    fontFamily: 'Roboto-Bold',
  },
  upgradeBtnOutlinePrice: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    fontFamily: 'Roboto-Regular',
  },
  billingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderRadius: 8,
    padding: 12,
  },
  billingText: {
    fontSize: 13,
    color: colors.textSecondary,
    flex: 1,
    fontFamily: 'Roboto-Regular',
  },

  // ── Payment loading ──
  paymentLoadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: `${colors.accentGold}66`,
  },
  paymentLoadingText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.accentGold,
    fontFamily: 'Roboto-Medium',
  },

  // ── Usage ──
  usageCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    fontFamily: 'Roboto-Bold',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    fontFamily: 'Roboto-Bold',
  },
  usageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  usageLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    width: 90,
    fontFamily: 'Roboto-Regular',
  },
  usageBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: colors.surfaceLight,
    borderRadius: 4,
    overflow: 'hidden',
  },
  usageBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  usageCount: {
    fontSize: 12,
    color: colors.textMuted,
    width: 50,
    textAlign: 'right',
    marginLeft: 8,
    fontFamily: 'Roboto-Regular',
  },

  // ── Feature table ──
  tableCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 4,
  },
  tableFeatureCol: {
    flex: 1.2,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    paddingRight: 8,
    fontFamily: 'Roboto-Bold',
  },
  tableCol: {
    flex: 0.8,
    alignItems: 'center',
  },
  tableColText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Roboto-Bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableCellValue: {
    fontSize: 13,
    color: colors.text,
    textAlign: 'center',
  },
  tableDisclaimer: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 16,
    marginTop: 12,
    fontFamily: 'Roboto-Regular',
  },

  // ── Manage button ──
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.accentGold,
    gap: 12,
  },
  manageBtnText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
    fontFamily: 'Roboto-Medium',
  },

  // ── Success modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 32,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  modalIconWrap: {
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 10,
    fontFamily: 'Roboto-Bold',
  },
  modalDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
    fontFamily: 'Roboto-Regular',
  },
  modalBtn: {
    backgroundColor: '#D4AF37',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
  },
  modalBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000000',
    fontFamily: 'Roboto-Bold',
  },

  // ── Razorpay WebView modal ──
  razorpayModalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  razorpayModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  razorpayModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    fontFamily: 'Roboto-Bold',
  },
});
