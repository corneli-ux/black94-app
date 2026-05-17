import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, RefreshControl, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis } from '../lib/api';
import { User } from '../lib/api';

interface CampaignPerformance {
  id: string;
  name: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  revenue: number;
  status: string;
}

interface AggregateMetrics {
  totalImpressions: number;
  totalClicks: number;
  ctr: number;
  conversions: number;
  roi: number;
}

const AD_TIPS = [
  {
    icon: '🎯',
    title: 'Improve CTR with Better Headlines',
    description: 'Campaigns with headlines under 40 characters see 23% higher click-through rates.',
  },
  {
    icon: '💰',
    title: 'Optimize Your Budget Allocation',
    description: 'Top 20% of your campaigns drive 80% of conversions. Consider reallocating budget to high-performers.',
  },
  {
    icon: '📱',
    title: 'Focus on Mobile Audiences',
    description: '85% of ad impressions come from mobile devices. Ensure your creatives are mobile-optimized.',
  },
  {
    icon: '⏰',
    title: 'Schedule Ads During Peak Hours',
    description: 'Your audience is most active between 7-10 PM. Schedule campaigns to maximize visibility.',
  },
];

export default function PerformanceScreen({ navigation }: any) {
  const currentUser = auth()?.currentUser;
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([]);
  const [metrics, setMetrics] = useState<AggregateMetrics>({
    totalImpressions: 0,
    totalClicks: 0,
    ctr: 0,
    conversions: 0,
    roi: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);

  const load = useCallback(async () => {
    if (!currentUser) { setLoading(false); return; }
    try {
      const snap = await firestore()
        .collection('adCampaigns')
        .where('businessId', '==', currentUser.uid)
        .limit(100)
        .get();

      const list: CampaignPerformance[] = snap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name || 'Untitled',
          impressions: data.impressions || 0,
          clicks: data.clicks || 0,
          conversions: data.conversions || 0,
          spend: data.budget || data.dailyBudget || 0,
          revenue: data.revenue || 0,
          status: data.status || 'paused',
        };
      });
      setCampaigns(list);

      const totalImpressions = list.reduce((s, c) => s + c.impressions, 0);
      const totalClicks = list.reduce((s, c) => s + c.clicks, 0);
      const totalConversions = list.reduce((s, c) => s + c.conversions, 0);
      const totalSpend = list.reduce((s, c) => s + c.spend, 0);
      const totalRevenue = list.reduce((s, c) => s + c.revenue, 0);

      setMetrics({
        totalImpressions,
        totalClicks,
        ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
        conversions: totalConversions,
        roi: totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend) * 100 : 0,
      });
    } catch (e) {
      console.error('[Performance] Failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUser]);

  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    setCanRefresh(offset <= 0);
  }, []);

  useEffect(() => { load(); }, []);

  const maxImpressions = Math.max(...campaigns.map(c => c.impressions), 1);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Performance</Text>
          <View style={{ width: 32 }} />
        </View>
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing && canRefresh}
            onRefresh={() => { if (canRefresh) { setRefreshing(true); load(); } }}
            tintColor={colors.accent}
            enabled={canRefresh}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {campaigns.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={styles.emptyTitle}>No performance data</Text>
            <Text style={styles.emptyText}>
              Launch ad campaigns to see performance analytics here.
            </Text>
          </View>
        ) : (
          <>
            {/* Aggregate Metrics */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Total Impressions</Text>
                <Text style={styles.metricValue}>{metrics.totalImpressions.toLocaleString()}</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Total Clicks</Text>
                <Text style={styles.metricValue}>{metrics.totalClicks.toLocaleString()}</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>CTR</Text>
                <Text style={styles.metricValue}>{metrics.ctr.toFixed(1)}%</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Conversions</Text>
                <Text style={styles.metricValue}>{metrics.conversions}</Text>
              </View>
              <View style={[styles.metricCard, styles.metricCardWide]}>
                <Text style={styles.metricLabel}>ROI</Text>
                <Text style={[
                  styles.metricValue,
                  { color: metrics.roi >= 0 ? colors.accentGreen : colors.accentRed },
                ]}>
                  {metrics.roi >= 0 ? '+' : ''}{metrics.roi.toFixed(1)}%
                </Text>
              </View>
            </View>

            {/* Campaign Performance Bars */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Campaign Performance</Text>
              {campaigns.map(campaign => {
                const barWidth = (campaign.impressions / maxImpressions) * 100;
                const ctr = campaign.impressions > 0
                  ? ((campaign.clicks / campaign.impressions) * 100).toFixed(1)
                  : '0.0';
                return (
                  <View key={campaign.id} style={styles.campaignBar}>
                    <View style={styles.campaignBarHeader}>
                      <Text style={styles.campaignBarName} numberOfLines={1}>{campaign.name}</Text>
                      <Text style={styles.campaignBarCTR}>CTR: {ctr}%</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${barWidth}%` }]} />
                    </View>
                    <View style={styles.campaignBarStats}>
                      <Text style={styles.barStat}>{campaign.impressions.toLocaleString()} impressions</Text>
                      <Text style={styles.barStat}>{campaign.clicks} clicks</Text>
                      <Text style={styles.barStat}>{campaign.conversions} conv.</Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Performance Tips */}
            <View style={styles.section}>
              <View style={styles.aiHeader}>
                <Text style={styles.sectionTitle}>Tips</Text>
              </View>
              {AD_TIPS.map((tip, index) => (
                <View key={index} style={styles.tipCard}>
                  <Text style={styles.tipIcon}>{tip.icon}</Text>
                  <View style={styles.tipContent}>
                    <Text style={styles.tipTitle}>{tip.title}</Text>
                    <Text style={styles.tipDescription}>{tip.description}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  backIcon: { color: colors.text, fontSize: 24 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  scroll: { flex: 1 },
  metricsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16,
    marginTop: 16, gap: 10,
  },
  metricCard: {
    width: '48%', backgroundColor: colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
    padding: 16,
  },
  metricCardWide: { width: '48%' },
  metricLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
  metricValue: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 6 },
  section: { paddingHorizontal: 16, marginTop: 28 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 14 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aiLabel: { color: colors.accentGold, fontSize: 12, fontWeight: '600' },
  campaignBar: {
    backgroundColor: colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    padding: 14, marginBottom: 10,
  },
  campaignBarHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 8,
  },
  campaignBarName: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1, marginRight: 10 },
  campaignBarCTR: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  barTrack: {
    height: 6, borderRadius: 3, backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%', borderRadius: 3,
    backgroundColor: colors.accent,
  },
  campaignBarStats: {
    flexDirection: 'row', gap: 14, marginTop: 8,
  },
  barStat: { color: colors.textSecondary, fontSize: 12 },
  tipCard: {
    flexDirection: 'row', gap: 12, backgroundColor: colors.surface,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    padding: 14, marginBottom: 10,
  },
  tipIcon: { fontSize: 24 },
  tipContent: { flex: 1 },
  tipTitle: { color: colors.text, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  tipDescription: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  emptyState: { alignItems: 'center', paddingTop: 100 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
});
