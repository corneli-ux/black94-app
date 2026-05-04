/**
 * StoreDashboardScreen.tsx — Store analytics dashboard for business users
 *
 * Shows revenue overview, order breakdown, top products, recent orders,
 * quick actions, and weekly revenue chart placeholder.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';

// ── Types ──────────────────────────────────────────────────────────────────

interface RecentOrder {
  id: string;
  buyerName: string;
  total: number;
  status: string;
  date: string;
}

interface TopProduct {
  name: string;
  sold: number;
  revenue: number;
}

// ── Placeholder data ──────────────────────────────────────────────────────

const REVENUE = {
  today: 12800,
  week: 84500,
  month: 342000,
};

const ORDER_BREAKDOWN = [
  { status: 'Pending', count: 8, color: colors.accentGold },
  { status: 'Processing', count: 5, color: colors.primary },
  { status: 'Shipped', count: 12, color: colors.accent },
  { status: 'Delivered', count: 145, color: colors.accentGreen },
];

const TOP_PRODUCTS: TopProduct[] = [
  { name: 'Wireless Earbuds Pro', sold: 89, revenue: 133500 },
  { name: 'USB-C Hub 7-in-1', sold: 67, revenue: 80400 },
  { name: 'Phone Stand Adjustable', sold: 54, revenue: 32400 },
  { name: 'LED Desk Lamp', sold: 42, revenue: 29400 },
  { name: 'Laptop Sleeve 14"', sold: 38, revenue: 26600 },
];

const RECENT_ORDERS: RecentOrder[] = [
  { id: 'ORD-001', buyerName: 'Rahul M.', total: 2499, status: 'processing', date: '2025-01-28' },
  { id: 'ORD-002', buyerName: 'Priya S.', total: 1499, status: 'pending', date: '2025-01-28' },
  { id: 'ORD-003', buyerName: 'Amit K.', total: 3999, status: 'shipped', date: '2025-01-27' },
  { id: 'ORD-004', buyerName: 'Sneha P.', total: 899, status: 'delivered', date: '2025-01-27' },
  { id: 'ORD-005', buyerName: 'Vikram J.', total: 5499, status: 'delivered', date: '2025-01-26' },
];

const WEEKLY_REVENUE = [
  { day: 'Mon', amount: 52000 },
  { day: 'Tue', amount: 41000 },
  { day: 'Wed', amount: 58000 },
  { day: 'Thu', amount: 39000 },
  { day: 'Fri', amount: 62000 },
  { day: 'Sat', amount: 78000 },
  { day: 'Sun', amount: 45000 },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCompactINR(amount: number): string {
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return formatINR(amount);
}

const statusColors: Record<string, string> = {
  pending: colors.accentGold,
  processing: colors.primary,
  shipped: colors.accent,
  delivered: colors.accentGreen,
  cancelled: colors.error,
};

// ── Component ──────────────────────────────────────────────────────────────

export default function StoreDashboardScreen() {
  const navigation = useNavigation<any>();
  const user = useAppStore((s) => s.user);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      // Placeholder — replace with Firestore fetch
    } catch (err) {
      console.error('[StoreDashboardScreen] loadData error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const maxWeeklyAmount = Math.max(...WEEKLY_REVENUE.map((d) => d.amount));

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <FlatList
      data={[]}
      renderItem={() => null}
      keyExtractor={() => ''}
      ListHeaderComponent={
        <>
          {/* Revenue overview cards */}
          <View style={styles.revenueRow}>
            <View style={[styles.revenueCard, styles.revenueCardExpanded]}>
              <Text style={styles.revenueLabel}>Today</Text>
              <Text style={styles.revenueValue}>{formatCompactINR(REVENUE.today)}</Text>
            </View>
            <View style={styles.revenueCard}>
              <Text style={styles.revenueLabel}>This Week</Text>
              <Text style={styles.revenueValue}>{formatCompactINR(REVENUE.week)}</Text>
            </View>
            <View style={styles.revenueCard}>
              <Text style={styles.revenueLabel}>This Month</Text>
              <Text style={styles.revenueValue}>{formatCompactINR(REVENUE.month)}</Text>
            </View>
          </View>

          {/* Order status breakdown */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Order Status</Text>
            <View style={styles.orderBreakdown}>
              {ORDER_BREAKDOWN.map((item) => (
                <View key={item.status} style={styles.breakdownItem}>
                  <View style={styles.breakdownHeader}>
                    <View
                      style={[
                        styles.breakdownDot,
                        { backgroundColor: item.color },
                      ]}
                    />
                    <Text style={styles.breakdownLabel}>{item.status}</Text>
                  </View>
                  <Text style={styles.breakdownCount}>{item.count}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Weekly revenue chart */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Weekly Revenue</Text>
            <View style={styles.chartBars}>
              {WEEKLY_REVENUE.map((item) => {
                const barHeight = (item.amount / maxWeeklyAmount) * 100;
                return (
                  <View key={item.day} style={styles.chartBarColumn}>
                    <Text style={styles.chartBarValue}>
                      {(item.amount / 1000).toFixed(0)}k
                    </Text>
                    <View
                      style={[styles.chartBar, { height: Math.max(barHeight, 4) }]}
                    />
                    <Text style={styles.chartBarLabel}>{item.day}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Top selling products */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Top Selling Products</Text>
            {TOP_PRODUCTS.map((product, i) => (
              <View key={i} style={styles.productItem}>
                <View style={styles.productRank}>
                  <Text style={styles.productRankText}>#{i + 1}</Text>
                </View>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productSold}>
                    {product.sold} units sold
                  </Text>
                </View>
                <Text style={styles.productRevenue}>
                  {formatINR(product.revenue)}
                </Text>
              </View>
            ))}
          </View>

          {/* Recent orders */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Recent Orders</Text>
            {RECENT_ORDERS.map((order) => (
              <TouchableOpacity
                key={order.id}
                style={styles.orderItem}
                onPress={() =>
                  navigation.navigate('OrderTracking' as never, {
                    orderId: order.id,
                  } as never)
                }
                activeOpacity={0.7}>
                <View style={styles.orderInfo}>
                  <Text style={styles.orderBuyer}>{order.buyerName}</Text>
                  <Text style={styles.orderDate}>
                    {new Date(order.date).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </Text>
                </View>
                <View style={styles.orderRight}>
                  <Text style={styles.orderTotal}>
                    {formatINR(order.total)}
                  </Text>
                  <View
                    style={[
                      styles.orderBadge,
                      {
                        backgroundColor: `${statusColors[order.status] ?? colors.textMuted}20`,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.orderBadgeText,
                        {
                          color: statusColors[order.status] ?? colors.textMuted,
                          textTransform: 'capitalize',
                        },
                      ]}>
                      {order.status}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Quick actions */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.actionsGrid}>
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => navigation.navigate('AddProduct' as never)}
                activeOpacity={0.7}>
                <View style={styles.actionIconBg}>
                  <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                </View>
                <Text style={styles.actionLabel}>Add Product</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => navigation.navigate('MyStore' as never)}
                activeOpacity={0.7}>
                <View style={styles.actionIconBg}>
                  <Ionicons name="storefront-outline" size={24} color={colors.accentGreen} />
                </View>
                <Text style={styles.actionLabel}>View Store</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => navigation.navigate('BusinessOrders' as never)}
                activeOpacity={0.7}>
                <View style={styles.actionIconBg}>
                  <Ionicons name="cube-outline" size={24} color={colors.accentGold} />
                </View>
                <Text style={styles.actionLabel}>Orders</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionItem}
                onPress={() => navigation.navigate('AdsManager' as never)}
                activeOpacity={0.7}>
                <View style={styles.actionIconBg}>
                  <Ionicons name="megaphone-outline" size={24} color={colors.error} />
                </View>
                <Text style={styles.actionLabel}>Manage Ads</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      }
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    />
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  // Revenue cards
  revenueRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  revenueCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  revenueCardExpanded: {
    flex: 1.3,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  revenueLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 4,
  },
  revenueValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  // Card
  card: {
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
  // Order breakdown
  orderBreakdown: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  breakdownItem: {
    flex: 1,
    minWidth: '40%',
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  breakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  breakdownLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  breakdownCount: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  // Weekly chart
  chartBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 130,
    paddingHorizontal: 4,
  },
  chartBarColumn: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  chartBarValue: {
    fontSize: 9,
    color: colors.textMuted,
  },
  chartBar: {
    width: 28,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  chartBarLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 4,
  },
  // Top products
  productItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  productRank: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  productRankText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  productInfo: {
    flex: 1,
    marginRight: 12,
  },
  productName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  productSold: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  productRevenue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accentGreen,
  },
  // Recent orders
  orderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  orderInfo: {
    flex: 1,
    marginRight: 12,
  },
  orderBuyer: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  orderDate: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  orderRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  orderTotal: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  orderBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  orderBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  // Quick actions
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionItem: {
    flex: 1,
    minWidth: '40%',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
