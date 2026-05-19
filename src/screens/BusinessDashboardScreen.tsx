import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Dimensions, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { auth, firestore } from '../lib/firebase';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = (SCREEN_W - 48 - 12) / 2;

interface KPIData {
  totalRevenue: number;
  totalOrders: number;
  activeCustomers: number;
  conversionRate: number;
}

const QUICK_ACTIONS = [
  { label: 'CRM', icon: 'people-circle-outline', color: colors.accent, screen: 'CrmLeads' },
  { label: 'Ads Manager', icon: 'megaphone-outline', color: '#ef4444', screen: 'AdsManager' },
  { label: 'Salary', icon: 'wallet-outline', color: '#22c55e', screen: 'Salary' },
  { label: 'Affiliates', icon: 'share-social-outline', color: '#8b5cf6', screen: 'Affiliates' },
  { label: 'Performance', icon: 'stats-chart-outline', color: '#f59e0b', screen: 'Performance' },
  { label: 'Orders', icon: 'bag-handle-outline', color: '#06b6d4', screen: 'BusinessOrders' },
];

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

export default function BusinessDashboardScreen({ navigation }: any) {
  const currentUser = auth()?.currentUser;
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState<KPIData>({
    totalRevenue: 0,
    totalOrders: 0,
    activeCustomers: 0,
    conversionRate: 0,
  });

  const load = useCallback(async () => {
    if (!currentUser) { setLoading(false); return; }
    try {
      // Fetch orders to compute KPIs
      const ordersSnap = await firestore()
        .collection('orders')
        .where('businessId', '==', currentUser.uid)
        .limit(100)
        .get();

      let totalRevenue = 0;
      let totalOrders = ordersSnap.size;
      const customerIds = new Set<string>();
      let conversions = 0;

      ordersSnap.docs.forEach(doc => {
        const data = doc.data();
        totalRevenue += data.totalAmount || data.amount || 0;
        if (data.customerId) customerIds.add(data.customerId);
        if (data.status === 'delivered' || data.status === 'completed') conversions++;
      });

      const conversionRate = totalOrders > 0 ? (conversions / totalOrders) * 100 : 0;

      setKpi({
        totalRevenue,
        totalOrders,
        activeCustomers: customerIds.size,
        conversionRate: Math.round(conversionRate * 10) / 10,
      });
    } catch (e) {
      console.error('[Dashboard] Failed to load:', e);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header area */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Business Dashboard</Text>
          <View style={{ width: 32 }} />
        </View>
      </SafeAreaView>

      {/* KPI Cards */}
      <View style={styles.kpiGrid}>
        <View style={[styles.kpiCard, { width: CARD_W }]}>
          <Ionicons name="cash-outline" size={20} color="#22c55e" />
          <Text style={styles.kpiLabel}>Total Revenue</Text>
          <Text style={styles.kpiValue}>{formatINR(kpi.totalRevenue)}</Text>
        </View>
        <View style={[styles.kpiCard, { width: CARD_W }]}>
          <Ionicons name="cart-outline" size={20} color={colors.primary} />
          <Text style={styles.kpiLabel}>Total Orders</Text>
          <Text style={styles.kpiValue}>{kpi.totalOrders}</Text>
        </View>
        <View style={[styles.kpiCard, { width: CARD_W }]}>
          <Ionicons name="people-outline" size={20} color={colors.accent} />
          <Text style={styles.kpiLabel}>Active Customers</Text>
          <Text style={styles.kpiValue}>{kpi.activeCustomers}</Text>
        </View>
        <View style={[styles.kpiCard, { width: CARD_W }]}>
          <Ionicons name="trending-up-outline" size={20} color="#f59e0b" />
          <Text style={styles.kpiLabel}>Conversion Rate</Text>
          <Text style={styles.kpiValue}>{kpi.conversionRate}%</Text>
        </View>
      </View>

      {/* Quick Actions */}
      <View style={styles.sectionWrap}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {QUICK_ACTIONS.map(action => (
            <TouchableOpacity
              key={action.screen}
              style={styles.actionCard}
              onPress={() => navigation.navigate(action.screen)}
              activeOpacity={0.7}
            >
              <Ionicons name={action.icon as any} size={28} color={action.color} />
              <Text style={styles.actionLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backBtn: { padding: 4 },
  backIcon: { color: colors.text, fontSize: 24 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  kpiGrid: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16,
    marginTop: 8, gap: 12,
  },
  kpiCard: {
    backgroundColor: colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
    padding: 16,
  },
  kpiLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  kpiValue: { color: colors.text, fontSize: 24, fontWeight: '800', marginTop: 6 },
  sectionWrap: { paddingHorizontal: 16, marginTop: 28 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 14 },
  actionsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12,
  },
  actionCard: {
    width: CARD_W, backgroundColor: colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: 20, alignItems: 'center', gap: 10,
  },
  actionIcon: { fontSize: 28 },
  actionLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
