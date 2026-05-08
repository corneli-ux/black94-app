import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = (SCREEN_W - 48 - 12) / 2;

interface KPIData {
  totalRevenue: number;
  totalOrders: number;
  productsCount: number;
  activeCustomers: number;
  conversionRate: number;
}

interface RecentOrder {
  id: string;
  customerName: string;
  customerAvatar?: string;
  total: number;
  status: string;
  createdAt: string;
}

const QUICK_ACTIONS = [
  { label: 'CRM', icon: '👥', screen: 'CRM' },
  { label: 'Ads Manager', icon: '📢', screen: 'AdsManager' },
  { label: 'Salary', icon: '💰', screen: 'Salary' },
  { label: 'Affiliates', icon: '🤝', screen: 'Affiliates' },
  { label: 'Performance', icon: '📊', screen: 'Performance' },
  { label: 'Orders', icon: '📦', screen: 'Orders' },
];

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

function formatStatus(status: string): { label: string; color: string } {
  const s = (status || '').toLowerCase();
  if (s === 'delivered' || s === 'completed') return { label: 'Delivered', color: colors.accentGreen };
  if (s === 'shipped' || s === 'in_transit') return { label: 'Shipped', color: colors.accent };
  if (s === 'cancelled') return { label: 'Cancelled', color: colors.error };
  if (s === 'pending') return { label: 'Pending', color: colors.accentGold };
  if (s === 'processing') return { label: 'Processing', color: colors.accent };
  return { label: status || 'Unknown', color: colors.textSecondary };
}

export default function BusinessDashboardScreen({ navigation }: any) {
  const currentUser = auth()?.currentUser;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kpi, setKpi] = useState<KPIData>({
    totalRevenue: 0,
    totalOrders: 0,
    productsCount: 0,
    activeCustomers: 0,
    conversionRate: 0,
  });
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const mountedRef = useRef(true);

  const load = useCallback(async (isRefresh = false) => {
    if (!currentUser) {
      if (!isRefresh) setLoading(false);
      setRefreshing(false);
      return;
    }

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      // ── Fetch orders (for revenue, count, customers, and recent list) ──
      const ordersSnap = await firestore()
        .collection('orders')
        .where('businessId', '==', currentUser.uid)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      let totalRevenue = 0;
      const customerIds = new Set<string>();
      let conversions = 0;

      ordersSnap.docs.forEach((doc: any) => {
        const data = doc.data();
        totalRevenue += data.total || data.totalAmount || data.amount || 0;
        if (data.customerId) customerIds.add(data.customerId);
        if (data.status === 'delivered' || data.status === 'completed') conversions++;
      });

      const totalOrders = ordersSnap.size;
      const conversionRate = totalOrders > 0 ? (conversions / totalOrders) * 100 : 0;

      // ── Fetch recent orders (top 5, already sorted desc) ──
      const recent: RecentOrder[] = ordersSnap.docs.slice(0, 5).map((doc: any) => {
        const data = doc.data();
        return {
          id: doc.id,
          customerName: data.customerName || data.customerId || 'Customer',
          customerAvatar: data.customerAvatar || null,
          total: data.total || data.totalAmount || data.amount || 0,
          status: data.status || 'pending',
          createdAt: data.createdAt,
        };
      });

      // ── Fetch products count ──
      let productsCount = 0;
      try {
        const productsSnap = await firestore()
          .collection('products')
          .where('businessId', '==', currentUser.uid)
          .get();
        productsCount = productsSnap.size;
      } catch (e) {
        console.warn('[Dashboard] Products query failed, showing 0:', e);
      }

      if (mountedRef.current) {
        setKpi({
          totalRevenue,
          totalOrders,
          productsCount,
          activeCustomers: customerIds.size,
          conversionRate: Math.round(conversionRate * 10) / 10,
        });
        setRecentOrders(recent);
      }
    } catch (e: any) {
      console.error('[Dashboard] Failed to load:', e);
      if (mountedRef.current) {
        setError(e?.message || 'Failed to load dashboard data');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [currentUser]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const onRefresh = useCallback(() => {
    load(true);
  }, [load]);

  // ── Loading state ──
  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
    >
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

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => load(true)} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* KPI Cards */}
      <View style={styles.kpiGrid}>
        <View style={[styles.kpiCard, { width: CARD_W }]}>
          <Text style={styles.kpiLabel}>Total Revenue</Text>
          <Text style={styles.kpiValue}>{formatINR(kpi.totalRevenue)}</Text>
        </View>
        <View style={[styles.kpiCard, { width: CARD_W }]}>
          <Text style={styles.kpiLabel}>Total Orders</Text>
          <Text style={styles.kpiValue}>{kpi.totalOrders}</Text>
        </View>
        <View style={[styles.kpiCard, { width: CARD_W }]}>
          <Text style={styles.kpiLabel}>Products</Text>
          <Text style={styles.kpiValue}>{kpi.productsCount}</Text>
        </View>
        <View style={[styles.kpiCard, { width: CARD_W }]}>
          <Text style={styles.kpiLabel}>Active Customers</Text>
          <Text style={styles.kpiValue}>{kpi.activeCustomers}</Text>
        </View>
        <View style={[styles.kpiCard, { width: CARD_W }]}>
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
              <Text style={styles.actionIcon}>{action.icon}</Text>
              <Text style={styles.actionLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Recent Orders */}
      <View style={styles.sectionWrap}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Orders</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Orders')} activeOpacity={0.7}>
            <Text style={styles.seeAllText}>See All</Text>
          </TouchableOpacity>
        </View>

        {recentOrders.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No orders yet</Text>
          </View>
        ) : (
          <View style={styles.ordersList}>
            {recentOrders.map((order) => {
              const statusInfo = formatStatus(order.status);
              return (
                <TouchableOpacity
                  key={order.id}
                  style={styles.orderCard}
                  activeOpacity={0.7}
                >
                  <Avatar
                    uri={order.customerAvatar}
                    name={order.customerName}
                    size={40}
                  />
                  <View style={styles.orderInfo}>
                    <Text style={styles.orderCustomerName} numberOfLines={1}>
                      {order.customerName}
                    </Text>
                    <View style={styles.orderMeta}>
                      <Text style={styles.orderTime}>
                        {order.createdAt ? timeAgo(new Date(order.createdAt).getTime()) : '—'}
                      </Text>
                      <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '1A' }]}>
                        <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>
                          {statusInfo.label}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <Text style={styles.orderTotal}>{formatINR(order.total)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: { padding: 4 },
  backIcon: { color: colors.text, fontSize: 24 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
    marginRight: 12,
  },
  retryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 8,
  },
  retryText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    marginTop: 8,
    gap: 12,
  },
  kpiCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  kpiLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  kpiValue: { color: colors.text, fontSize: 24, fontWeight: '800', marginTop: 6 },
  sectionWrap: { paddingHorizontal: 16, marginTop: 28 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  seeAllText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionCard: {
    width: CARD_W,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 20,
    alignItems: 'center',
    gap: 10,
  },
  actionIcon: { fontSize: 28 },
  actionLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  emptyState: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  ordersList: {
    gap: 8,
  },
  orderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 12,
  },
  orderInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  orderCustomerName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  orderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  orderTime: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  orderTotal: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
});
