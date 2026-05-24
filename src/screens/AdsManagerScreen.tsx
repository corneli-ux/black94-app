import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, RefreshControl, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis } from '../lib/api';

interface AdCampaign {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'completed';
  budget: number;
  impressions: number;
  clicks: number;
  conversions: number;
  createdAt: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'Active', color: colors.accentGreen, bg: colors.greenBg },
  paused: { label: 'Paused', color: colors.accentGold, bg: colors.accentBgStrong },
  completed: { label: 'Completed', color: colors.textSecondary, bg: colors.bgSubtle },
};

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

function formatCTR(impressions: number, clicks: number): string {
  if (impressions === 0) return '0%';
  return ((clicks / impressions) * 100).toFixed(1) + '%';
}

export default function AdsManagerScreen({ navigation }: any) {
  const currentUser = auth()?.currentUser;
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);

  const load = useCallback(async () => {
    if (!currentUser) { setLoading(false); return; }
    try {
      const snap = await firestore()
        .collection('adCampaigns')
        .where('businessId', '==', currentUser.uid)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      const list: AdCampaign[] = snap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name || 'Untitled Campaign',
          status: data.status || 'paused',
          budget: data.budget || data.dailyBudget || 0,
          impressions: data.impressions || 0,
          clicks: data.clicks || 0,
          conversions: data.conversions || 0,
          createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
        };
      });
      setCampaigns(list);
    } catch (e) {
      console.error('[AdsManager] Failed:', e);
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

  const renderItem = ({ item }: { item: AdCampaign }) => {
    const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.paused;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.campaignName}>{item.name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
            <Text style={[styles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
          </View>
        </View>
        <Text style={styles.cardTime}>{timeAgo(item.createdAt)}</Text>

        <View style={styles.metricsRow}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Budget</Text>
            <Text style={styles.metricValue}>{formatINR(item.budget)}</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Impressions</Text>
            <Text style={styles.metricValue}>{item.impressions.toLocaleString()}</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Clicks</Text>
            <Text style={styles.metricValue}>{item.clicks.toLocaleString()}</Text>
          </View>
        </View>

        <View style={styles.metricsRowBottom}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>CTR</Text>
            <Text style={styles.metricValue}>{formatCTR(item.impressions, item.clicks)}</Text>
          </View>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>Conversions</Text>
            <Text style={styles.metricValue}>{item.conversions}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Ads Manager</Text>
          <View style={{ width: 32 }} />
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={campaigns}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing && canRefresh}
              onRefresh={() => { if (canRefresh) { setRefreshing(true); load(); } }}
              tintColor={colors.accent}
              enabled={canRefresh}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📢</Text>
              <Text style={styles.emptyTitle}>No ad campaigns yet</Text>
              <Text style={styles.emptyText}>
                Create your first ad campaign to reach more customers.
              </Text>
            </View>
          }
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('CreateAd')}
        activeOpacity={0.8}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>
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
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100 },
  card: {
    backgroundColor: colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
    padding: 16, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  campaignName: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1, marginRight: 10 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },
  cardTime: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  metricsRow: { flexDirection: 'row', marginTop: 14, gap: 8 },
  metricsRowBottom: { flexDirection: 'row', marginTop: 10, gap: 8 },
  metricItem: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, padding: 10 },
  metricLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '500' },
  metricValue: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 4 },
  emptyState: { alignItems: 'center', paddingTop: 100 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  fab: {
    position: 'absolute', bottom: 30, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOpacity: 0.3, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabIcon: { color: colors.white, fontSize: 28, fontWeight: '700' },
});
