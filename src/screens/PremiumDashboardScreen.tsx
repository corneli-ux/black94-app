/**
 * PremiumDashboardScreen.tsx — Premium subscription dashboard
 *
 * Shows current plan, feature comparison table, upgrade options, usage meters.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';

// ── Types ──────────────────────────────────────────────────────────────────

type PlanType = 'free' | 'premium' | 'business';

interface FeatureRow {
  feature: string;
  free: string | boolean;
  premium: string | boolean;
  business: string | boolean;
}

// ── Data ───────────────────────────────────────────────────────────────────

const FEATURES: FeatureRow[] = [
  { feature: 'Posts per day', free: '5', premium: '25', business: 'Unlimited' },
  { feature: 'Stories per day', free: '3', premium: '10', business: 'Unlimited' },
  { feature: 'Shop products', free: '0', premium: '50', business: 'Unlimited' },
  { feature: 'CRM leads', free: false, premium: '100', business: 'Unlimited' },
  { feature: 'Analytics', free: false, premium: true, business: true },
  { feature: 'Priority support', free: false, premium: true, business: true },
  { feature: 'Ads (paid)', free: false, premium: true, business: true },
  { feature: 'Affiliate program', free: false, premium: true, business: true },
];

const USAGE_DATA = {
  postsToday: { current: 3, limit: 5 },
  storiesToday: { current: 1, limit: 3 },
  products: { current: 0, limit: 0 },
  storage: { current: 12, limit: 50 },
};

// ── Component ──────────────────────────────────────────────────────────────

export default function PremiumDashboardScreen() {
  const user = useAppStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [currentPlan, setCurrentPlan] = useState<PlanType>(
    (user?.subscription as PlanType) || 'free',
  );

  useEffect(() => {
    setLoading(false);
  }, [user]);

  const handleUpgrade = useCallback((plan: PlanType) => {
    Alert.alert(
      `Upgrade to ${plan.charAt(0).toUpperCase() + plan.slice(1)}`,
      plan === 'premium'
        ? 'Get access to advanced features, analytics, and more.\n\n₹499/month'
        : 'Full business suite: CRM, shop, ads, analytics.\n\n₹1,499/month',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Upgrade',
          style: 'default',
          onPress: () => {
            Alert.alert('Coming Soon', 'Payment integration in progress.');
          },
        },
      ],
    );
  }, []);

  const planIcon = (plan: PlanType) => {
    switch (plan) {
      case 'free': return '💪';
      case 'premium': return '⭐';
      case 'business': return '🚀';
    }
  };

  const planColor = (plan: PlanType) => {
    switch (plan) {
      case 'free': return colors.textMuted;
      case 'premium': return colors.accentGold;
      case 'business': return colors.primary;
    }
  };

  const renderUsageBar = useCallback(
    (label: string, current: number, limit: number) => {
      if (limit === 0) return null;
      const pct = Math.min((current / limit) * 100, 100);
      return (
        <View style={styles.usageRow} key={label}>
          <Text style={styles.usageLabel}>{label}</Text>
          <View style={styles.usageBarBg}>
            <View
              style={[
                styles.usageBarFill,
                {
                  width: `${pct}%`,
                  backgroundColor:
                    pct > 80 ? colors.error : pct > 50 ? colors.accentGold : colors.primary,
                },
              ]}
            />
          </View>
          <Text style={styles.usageCount}>
            {current}/{limit}
          </Text>
        </View>
      );
    },
    [],
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        {/* Current plan card */}
        <View style={styles.planCard}>
          <View style={styles.planCardHeader}>
            <Text style={styles.planEmoji}>{planIcon(currentPlan)}</Text>
            <View>
              <Text style={styles.planName}>
                {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} Plan
              </Text>
              <Text style={styles.planStatus}>
                {currentPlan === 'free'
                  ? 'Upgrade to unlock premium features'
                  : 'You have access to all features'}
              </Text>
            </View>
          </View>
          {currentPlan === 'free' ? (
            <View style={styles.upgradeRow}>
              <TouchableOpacity
                style={styles.upgradeBtn}
                onPress={() => handleUpgrade('premium')}
                activeOpacity={0.7}>
                <Text style={styles.upgradeBtnText}>Upgrade to Premium</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.upgradeBtnOutline}
                onPress={() => handleUpgrade('business')}
                activeOpacity={0.7}>
                <Text style={styles.upgradeBtnOutlineText}>Go Business</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.billingRow}>
              <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
              <Text style={styles.billingText}>
                Billing period: Monthly · Renews on Feb 15, 2025
              </Text>
            </View>
          )}
        </View>

        {/* Usage meter */}
        <View style={styles.usageCard}>
          <Text style={styles.sectionTitle}>Usage This Month</Text>
          {renderUsageBar('Posts', USAGE_DATA.postsToday.current, USAGE_DATA.postsToday.limit)}
          {renderUsageBar('Stories', USAGE_DATA.storiesToday.current, USAGE_DATA.storiesToday.limit)}
          {renderUsageBar('Storage (MB)', USAGE_DATA.storage.current, USAGE_DATA.storage.limit)}
        </View>

        {/* Feature comparison table */}
        <View style={styles.tableCard}>
          <Text style={styles.sectionTitle}>Feature Comparison</Text>
          <View style={styles.tableHeader}>
            <Text style={styles.tableFeatureCol}>Feature</Text>
            <View style={styles.tableCol}>
              <Text style={[styles.tableColText, { color: colors.textMuted }]}>Free</Text>
            </View>
            <View style={styles.tableCol}>
              <Text style={[styles.tableColText, { color: colors.accentGold }]}>Premium</Text>
            </View>
            <View style={styles.tableCol}>
              <Text style={[styles.tableColText, { color: colors.primary }]}>Business</Text>
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
                    ? feat.free ? '✅' : '❌'
                    : feat.free}
                </Text>
              </View>
              <View style={styles.tableCol}>
                <Text style={styles.tableCellValue}>
                  {typeof feat.premium === 'boolean'
                    ? feat.premium ? '✅' : '❌'
                    : feat.premium}
                </Text>
              </View>
              <View style={styles.tableCol}>
                <Text style={styles.tableCellValue}>
                  {typeof feat.business === 'boolean'
                    ? feat.business ? '✅' : '❌'
                    : feat.business}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Manage subscription */}
        {currentPlan !== 'free' && (
          <TouchableOpacity
            style={styles.manageBtn}
            onPress={() => Alert.alert('Manage', 'Subscription management coming soon.')}
            activeOpacity={0.7}>
            <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.manageBtnText}>Manage Subscription</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </ScrollView>
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
    padding: 16,
    paddingBottom: 40,
  },
  // Plan card
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
    marginBottom: 16,
  },
  planEmoji: {
    fontSize: 36,
  },
  planName: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  planStatus: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  upgradeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  upgradeBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  upgradeBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white,
  },
  upgradeBtnOutline: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  upgradeBtnOutlineText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
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
  },
  // Usage
  usageCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 14,
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
    width: 40,
    textAlign: 'right',
    marginLeft: 8,
  },
  // Table
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
  },
  tableCol: {
    flex: 0.8,
    alignItems: 'center',
  },
  tableColText: {
    fontSize: 12,
    fontWeight: '700',
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
  // Manage button
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  manageBtnText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
