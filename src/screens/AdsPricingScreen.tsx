/**
 * AdsPricingScreen.tsx — Ads Pricing Strategy & Cost Calculator
 *
 * Displays pricing tiers, ad cost calculator, comparison, and tips.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { auth } from '../lib/firebase';
import {
  getAdPricingTiers,
  calculateAdCost,
  AdPricingTier,
  AdCostEstimate,
  AdPlacement,
  formatAdCurrency,
  formatAdNumber,
} from '../lib/ads';

// ── Helpers ────────────────────────────────────────────────────────────────

const PLACEMENT_LABELS: Record<string, string> = {
  feed: 'Feed',
  story: 'Story',
  profile: 'Profile',
  search: 'Search',
  comment: 'Comment',
};

const PLACEMENT_ICONS: Record<string, string> = {
  feed: 'newspaper-outline',
  story: 'play-circle-outline',
  profile: 'person-circle-outline',
  search: 'search-outline',
  comment: 'chatbubble-outline',
};

const PLACEMENT_COLORS: Record<string, string> = {
  feed: colors.accent,
  story: colors.accentGold,
  profile: colors.verified,
  search: colors.accentGreen,
  comment: colors.like,
};

const TIPS = [
  { title: 'Start Small, Scale Up', desc: 'Begin with a low daily budget to test creatives and audiences. Double down on what works.' },
  { title: 'Use CPC for Conversions', desc: 'Cost-per-click ensures you only pay for real engagement. Best for store and product ads.' },
  { title: 'Use CPM for Awareness', desc: 'Cost-per-1000-impressions maximizes reach. Best for brand awareness campaigns.' },
  { title: 'Target Narrowly', desc: 'The tighter your targeting, the lower your CPC/CPM. Start with interest + location.' },
  { title: 'Refresh Creatives Weekly', desc: 'Ad fatigue increases costs. Rotate images and copy every 7-10 days for best results.' },
  { title: 'Monitor Daily', desc: 'Check your campaigns daily. Pause underperformers quickly to save budget.' },
];

// ── Component ──────────────────────────────────────────────────────────────

export default function AdsPricingScreen({ navigation }: any) {
  const uid = auth()?.currentUser?.uid;

  const [tiers, setTiers] = useState<AdPricingTier[]>([]);
  const [loading, setLoading] = useState(true);

  // Calculator state
  const [selectedPlacement, setSelectedPlacement] = useState<AdPlacement>('feed');
  const [billingModel, setBillingModel] = useState<'cpc' | 'cpm'>('cpc');
  const [budgetInput, setBudgetInput] = useState('');
  const [estimate, setEstimate] = useState<AdCostEstimate | null>(null);
  const [calculating, setCalculating] = useState(false);

  // ── Load pricing tiers ───────────────────────────────────────────────────

  const loadTiers = useCallback(async () => {
    try {
      const data = await getAdPricingTiers();
      setTiers(data);
    } catch (e) {
      console.error('[AdsPricing] Failed to load tiers:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTiers(); }, [loadTiers]);

  // ── Calculator ───────────────────────────────────────────────────────────

  const handleCalculate = useCallback(async () => {
    const budget = parseFloat(budgetInput);
    if (isNaN(budget) || budget <= 0) {
      Alert.alert('Invalid Budget', 'Please enter a valid budget amount in rupees.');
      return;
    }

    // Convert rupees to paise for the API
    const budgetPaise = Math.round(budget * 100);
    setCalculating(true);
    try {
      const result = await calculateAdCost(selectedPlacement, billingModel, budgetPaise);
      setEstimate(result);
    } catch (e) {
      Alert.alert('Error', 'Failed to calculate cost.');
    } finally {
      setCalculating(false);
    }
  }, [budgetInput, selectedPlacement, billingModel]);

  // ── Loading state ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading pricing…</Text>
      </SafeAreaView>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Ads Pricing</Text>
          <View style={{ width: 32 }} />
        </View>

        {/* ═══ Section 1: Pricing Tiers Table ═══ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="pricetag-outline" size={20} color={colors.accentGold} />
            <Text style={styles.sectionTitle}>Current Pricing Tiers</Text>
          </View>
          <Text style={styles.sectionDesc}>Prices shown in Indian Rupees (₹).</Text>

          <View style={styles.tableContainer}>
            {/* Table header */}
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, { flex: 1.2 }]}>Placement</Text>
              <Text style={styles.tableHeaderText}>CPC Range</Text>
              <Text style={styles.tableHeaderText}>CPM Range</Text>
              <Text style={styles.tableHeaderText}>Budget/Day</Text>
            </View>

            {tiers.map((tier) => {
              const pColor = PLACEMENT_COLORS[tier.placement] || colors.text;
              return (
                <View key={tier.placement} style={styles.tableRow}>
                  <View style={[styles.tableCell, { flex: 1.2 }]}>
                    <View style={styles.placementCell}>
                      <View style={[styles.placementDot, { backgroundColor: pColor }]} />
                      <Text style={styles.placementName}>{PLACEMENT_LABELS[tier.placement] || tier.placement}</Text>
                    </View>
                  </View>
                  <Text style={styles.tableCell}>{formatAdCurrency(tier.cpcMin)}-{formatAdCurrency(tier.cpcMax)}</Text>
                  <Text style={styles.tableCell}>{formatAdCurrency(tier.cpmMin)}-{formatAdCurrency(tier.cpmMax)}</Text>
                  <Text style={styles.tableCell}>{formatAdCurrency(tier.dailyBudgetMin)}-{formatAdCurrency(tier.dailyBudgetMax)}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ═══ Section 2: Ad Cost Calculator ═══ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="calculator-outline" size={20} color={colors.accent} />
            <Text style={styles.sectionTitle}>Ad Cost Calculator</Text>
          </View>

          {/* Placement selector */}
          <Text style={styles.selectLabel}>Placement</Text>
          <View style={styles.placementRow}>
            {tiers.map((tier) => {
              const isSelected = selectedPlacement === tier.placement;
              return (
                <TouchableOpacity
                  key={tier.placement}
                  style={[styles.placementChip, isSelected && { borderColor: PLACEMENT_COLORS[tier.placement], backgroundColor: PLACEMENT_COLORS[tier.placement] + '15' }]}
                  onPress={() => { setSelectedPlacement(tier.placement); setEstimate(null); }}
                  activeOpacity={0.7}
                >
                  <Ionicons name={(PLACEMENT_ICONS[tier.placement] || 'grid') as any} size={18} color={isSelected ? PLACEMENT_COLORS[tier.placement] : colors.textMuted} />
                  <Text style={[styles.placementChipText, isSelected && { color: PLACEMENT_COLORS[tier.placement] }]}>{PLACEMENT_LABELS[tier.placement]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Billing model toggle */}
          <Text style={styles.selectLabel}>Billing Model</Text>
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleBtn, billingModel === 'cpc' && styles.toggleBtnActive]}
              onPress={() => { setBillingModel('cpc'); setEstimate(null); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.toggleBtnText, billingModel === 'cpc' && styles.toggleBtnTextActive]}>Cost Per Click (CPC)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, billingModel === 'cpm' && styles.toggleBtnActive]}
              onPress={() => { setBillingModel('cpm'); setEstimate(null); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.toggleBtnText, billingModel === 'cpm' && styles.toggleBtnTextActive]}>Cost Per 1K Imps (CPM)</Text>
            </TouchableOpacity>
          </View>

          {/* Budget input */}
          <Text style={styles.selectLabel}>Daily Budget (₹)</Text>
          <View style={styles.budgetInputWrap}>
            <Text style={styles.budgetPrefix}>₹</Text>
            <TextInput
              style={styles.budgetInput}
              placeholder="500"
              placeholderTextColor={colors.textMuted}
              value={budgetInput}
              onChangeText={setBudgetInput}
              keyboardType="decimal-pad"
              returnKeyType="done"
              onSubmitEditing={handleCalculate}
            />
          </View>

          <TouchableOpacity
            style={[styles.calculateBtn, calculating && styles.btnDisabled]}
            onPress={handleCalculate}
            disabled={calculating}
            activeOpacity={0.7}
          >
            {calculating ? (
              <ActivityIndicator size="small" color={colors.bg} />
            ) : (
              <Text style={styles.calculateBtnText}>Calculate Estimate</Text>
            )}
          </TouchableOpacity>

          {/* Results */}
          {estimate && (
            <View style={styles.resultsCard}>
              <Text style={styles.resultsTitle}>Estimated Daily Performance</Text>
              <View style={styles.resultsGrid}>
                <View style={styles.resultItem}>
                  <Ionicons name="flash-outline" size={16} color={colors.accent} />
                  <Text style={styles.resultValue}>{formatAdNumber(estimate.estimatedClicksPerDay)}</Text>
                  <Text style={styles.resultLabel}>Clicks/Day</Text>
                </View>
                <View style={styles.resultItem}>
                  <Ionicons name="eye-outline" size={16} color={colors.accentGold} />
                  <Text style={styles.resultValue}>{formatAdNumber(estimate.estimatedImpressionsPerDay)}</Text>
                  <Text style={styles.resultLabel}>Impressions/Day</Text>
                </View>
                <View style={styles.resultItem}>
                  <Ionicons name="people-outline" size={16} color={colors.accentGreen} />
                  <Text style={styles.resultValue}>{formatAdNumber(estimate.estimatedReach)}</Text>
                  <Text style={styles.resultLabel}>Est. Reach</Text>
                </View>
                <View style={styles.resultItem}>
                  <Ionicons name="wallet-outline" size={16} color={colors.primary} />
                  <Text style={styles.resultValue}>{formatAdCurrency(estimate.avgCpc)}</Text>
                  <Text style={styles.resultLabel}>Avg CPC</Text>
                </View>
              </View>
              {billingModel === 'cpm' && (
                <View style={styles.resultRowFull}>
                  <Text style={styles.resultRowLabel}>Avg CPM:</Text>
                  <Text style={styles.resultRowValue}>{formatAdCurrency(estimate.avgCpm)}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* ═══ Section 3: Placement Comparison ═══ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="bar-chart-outline" size={20} color={colors.verified} />
            <Text style={styles.sectionTitle}>Placement Comparison</Text>
          </View>
          {tiers.map((tier) => {
            const avgCpc = (tier.cpcMin + tier.cpcMax) / 2;
            const avgCpm = (tier.cpmMin + tier.cpmMax) / 2;
            const maxCpc = Math.max(...tiers.map((t) => (t.cpcMin + t.cpcMax) / 2));
            const barWidth = Math.max((avgCpc / maxCpc) * 100, 10);

            return (
              <View key={tier.placement} style={styles.comparisonRow}>
                <View style={[styles.comparisonDot, { backgroundColor: PLACEMENT_COLORS[tier.placement] || colors.textMuted }]} />
                <Text style={styles.comparisonName}>{PLACEMENT_LABELS[tier.placement]}</Text>
                <View style={styles.comparisonBarBg}>
                  <View style={[styles.comparisonBarFill, { width: `${barWidth}%`, backgroundColor: PLACEMENT_COLORS[tier.placement] || colors.textMuted }]} />
                </View>
                <Text style={styles.comparisonValue}>{formatAdCurrency(avgCpc)} CPC</Text>
              </View>
            );
          })}
        </View>

        {/* ═══ Section 4: Set Custom Pricing (Premium) ═══ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="diamond-outline" size={20} color={colors.accentGold} />
            <Text style={styles.sectionTitle}>Set Custom Pricing</Text>
            <View style={styles.premiumBadge}>
              <Text style={styles.premiumBadgeText}>PRO</Text>
            </View>
          </View>
          <View style={styles.premiumCard}>
            <Text style={styles.premiumDesc}>
              Override default pricing tiers with your own custom CPC/CPM ranges per placement. Requires a Premium subscription.
            </Text>
            <TouchableOpacity style={styles.premiumBtn} activeOpacity={0.7}>
              <Ionicons name="star" size={16} color={colors.accentGold} />
              <Text style={styles.premiumBtnText}>Upgrade to Premium</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ═══ Section 5: Tips ═══ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="bulb-outline" size={20} color={colors.accentGold} />
            <Text style={styles.sectionTitle}>Optimization Tips</Text>
          </View>
          {TIPS.map((tip, idx) => (
            <View key={idx} style={styles.tipCard}>
              <View style={styles.tipHeader}>
                <View style={styles.tipNumber}>
                  <Text style={styles.tipNumberText}>{idx + 1}</Text>
                </View>
                <Text style={styles.tipTitle}>{tip.title}</Text>
              </View>
              <Text style={styles.tipDesc}>{tip.desc}</Text>
            </View>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg, gap: 12 },
  loadingText: { fontSize: 14, color: colors.textMuted },
  scrollContent: { padding: 16, paddingBottom: 40 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  backBtn: { padding: 4 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },

  // Section
  section: { marginBottom: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sectionDesc: { color: colors.textMuted, fontSize: 13, marginBottom: 14 },

  // Table
  tableContainer: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  tableHeaderText: { flex: 1, fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  tableRow: { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)', alignItems: 'center' },
  tableCell: { flex: 1, fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  placementCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  placementDot: { width: 8, height: 8, borderRadius: 4 },
  placementName: { fontSize: 13, fontWeight: '600', color: colors.text },

  // Calculator
  selectLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 8, marginTop: 14 },
  placementRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  placementChip: { flexDirection: 'column', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minWidth: 60 },
  placementChipText: { fontSize: 11, fontWeight: '500', color: colors.textMuted },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleBtnText: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  toggleBtnTextActive: { color: colors.bg, fontWeight: '700' },
  budgetInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, height: 50 },
  budgetPrefix: { fontSize: 18, fontWeight: '700', color: colors.textMuted, marginRight: 4 },
  budgetInput: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.text, padding: 0 },
  calculateBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  btnDisabled: { opacity: 0.4 },
  calculateBtnText: { fontSize: 15, fontWeight: '700', color: colors.bg },

  // Results
  resultsCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, marginTop: 14 },
  resultsTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 14 },
  resultsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  resultItem: { flex: 1, minWidth: '42%', backgroundColor: colors.bg, borderRadius: 12, padding: 14, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border },
  resultValue: { fontSize: 18, fontWeight: '800', color: colors.text },
  resultLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },
  resultRowFull: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  resultRowLabel: { fontSize: 14, color: colors.textSecondary },
  resultRowValue: { fontSize: 14, fontWeight: '700', color: colors.text },

  // Comparison
  comparisonRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  comparisonDot: { width: 10, height: 10, borderRadius: 5 },
  comparisonName: { width: 60, fontSize: 13, fontWeight: '600', color: colors.text },
  comparisonBarBg: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  comparisonBarFill: { height: '100%', borderRadius: 4 },
  comparisonValue: { width: 80, fontSize: 12, fontWeight: '600', color: colors.textSecondary, textAlign: 'right' },

  // Premium
  premiumBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: 'rgba(245, 158, 11, 0.15)', marginLeft: 'auto' },
  premiumBadgeText: { fontSize: 10, fontWeight: '700', color: colors.accentGold, textTransform: 'uppercase', letterSpacing: 0.5 },
  premiumCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16 },
  premiumDesc: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginBottom: 14 },
  premiumBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(245, 158, 11, 0.15)', borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.3)', borderRadius: 12, paddingVertical: 13 },
  premiumBtnText: { fontSize: 14, fontWeight: '600', color: colors.accentGold },

  // Tips
  tipCard: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  tipHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  tipNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(42, 127, 255, 0.15)', justifyContent: 'center', alignItems: 'center' },
  tipNumberText: { fontSize: 12, fontWeight: '700', color: colors.accent },
  tipTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  tipDesc: { fontSize: 12, color: colors.textSecondary, lineHeight: 18, paddingLeft: 34 },
});
