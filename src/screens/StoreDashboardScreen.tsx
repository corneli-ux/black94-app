/**
 * StoreDashboardScreen.tsx — Store analytics dashboard for business users
 *
 * All data comes from real Firestore queries:
 *  - Revenue: orders where sellerId/businessId == userId, aggregated by rolling time windows
 *  - Order breakdown: count of orders grouped by status
 *  - Top products: products where ownerId/businessId == userId, sorted by soldCount desc
 *  - Recent orders: last 5 orders for this seller, newest first
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
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
import { firestore } from '../lib/firebase';
import { tsToMillis } from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

interface RevenueData {
  today: number;
  week: number;
  month: number;
  total: number;
}

interface OrderBreakdownItem {
  status: string;
  count: number;
  color: string;
}

interface TopProduct {
  id: string;
  name: string;
  sold: number;
  revenue: number;
  price: number;
  image: string;
}

interface RecentOrder {
  id: string;
  buyerName: string;
  total: number;
  status: string;
  createdAt: number;
}

interface DailyRevenue {
  label: string;
  amount: number;
}

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
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return formatINR(amount);
}

const STATUS_COLORS: Record<string, string> = {
  pending: colors.accentGold,
  confirmed: colors.primary,
  processing: colors.primary,
  shipped: colors.accent,
  delivered: colors.accentGreen,
  cancelled: colors.error,
  refunded: colors.textMuted,
};

function resolveProductImage(data: any): string {
  try {
    const imgs = typeof data.images === 'string' ? JSON.parse(data.images) : data.images;
    if (Array.isArray(imgs) && imgs.length > 0) return imgs[0];
  } catch {
    /* ignore */
  }
  return '';
}

function formatRelativeDate(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ── Component ──────────────────────────────────────────────────────────────

export default function StoreDashboardScreen() {
  const navigation = useNavigation<any>();
  const user = useAppStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revenue, setRevenue] = useState<RevenueData>({ today: 0, week: 0, month: 0, total: 0 });
  const [orderBreakdown, setOrderBreakdown] = useState<OrderBreakdownItem[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [weeklyRevenue, setWeeklyRevenue] = useState<DailyRevenue[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [hasNoProducts, setHasNoProducts] = useState(false);

  // ── Data loading ───────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    const userId = user?.id;
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      // ── Fetch all seller orders ─────────────────────────────────────────
      let allOrders: any[] = [];
      try {
        const sellerSnap = await firestore()
          .collection('orders')
          .where('sellerId', '==', userId)
          .orderBy('createdAt', 'desc')
          .limit(500)
          .get();

        if (sellerSnap && sellerSnap.docs && sellerSnap.docs.length > 0) {
          allOrders = sellerSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
        }
      } catch (e) {
        console.warn('[StoreDashboard] sellerId query failed, trying businessId:', e);
      }

      // Fallback: try businessId
      if (allOrders.length === 0) {
        try {
          const bizSnap = await firestore()
            .collection('orders')
            .where('businessId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(500)
            .get();

          if (bizSnap && bizSnap.docs && bizSnap.docs.length > 0) {
            allOrders = bizSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          }
        } catch (e2) {
          console.warn('[StoreDashboard] businessId fallback failed:', e2);
        }
      }

      // ── Revenue: rolling time windows ───────────────────────────────────
      const now = Date.now();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayStartMs = todayStart.getTime();
      const weekAgoMs = now - 7 * 24 * 60 * 60 * 1000; // rolling 7 days
      const monthAgoMs = now - 30 * 24 * 60 * 60 * 1000; // rolling 30 days

      let todayRev = 0;
      let weekRev = 0;
      let monthRev = 0;
      let totalRev = 0;

      // Weekly chart data (last 7 days, one entry per day)
      const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dailyTotals: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now - i * 86400000);
        const key = DAY_LABELS[d.getDay()];
        dailyTotals[key] = 0;
      }

      for (const order of allOrders) {
        const orderTime = tsToMillis(order.createdAt);
        const total = order.total || 0;
        totalRev += total;
        if (orderTime >= todayStartMs) todayRev += total;
        if (orderTime >= weekAgoMs) weekRev += total;
        if (orderTime >= monthAgoMs) monthRev += total;

        // Accumulate into daily buckets for chart
        if (orderTime >= weekAgoMs) {
          const d = new Date(orderTime);
          const dayLabel = DAY_LABELS[d.getDay()];
          if (dailyTotals[dayLabel] !== undefined) {
            dailyTotals[dayLabel] += total;
          }
        }
      }

      setRevenue({ today: todayRev, week: weekRev, month: monthRev, total: totalRev });
      setTotalOrders(allOrders.length);

      // Build weekly chart array ordered Mon → Sun for display
      const weekChartOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      setWeeklyRevenue(
        weekChartOrder.map((day) => ({
          label: day,
          amount: dailyTotals[day] || 0,
        })),
      );

      // ── Order status breakdown ──────────────────────────────────────────
      const statusCounts: Record<string, number> = {};
      for (const order of allOrders) {
        const raw = (order.status || 'pending').toLowerCase();
        statusCounts[raw] = (statusCounts[raw] || 0) + 1;
      }
      const breakdown: OrderBreakdownItem[] = Object.entries(statusCounts)
        .map(([status, count]) => ({
          status: status.charAt(0).toUpperCase() + status.slice(1),
          count,
          color: STATUS_COLORS[status] || colors.textMuted,
        }))
        .sort((a, b) => b.count - a.count);
      setOrderBreakdown(breakdown);

      // ── Recent orders (last 5) ──────────────────────────────────────────
      const recent: RecentOrder[] = allOrders.slice(0, 5).map((order) => ({
        id: order.id,
        buyerName: order.buyerName || 'Unknown',
        total: order.total || 0,
        status: order.status || 'pending',
        createdAt: tsToMillis(order.createdAt),
      }));
      setRecentOrders(recent);

      // ── Top products ────────────────────────────────────────────────────
      let productsFetched = false;
      try {
        const prodSnap = await firestore()
          .collection('products')
          .where('ownerId', '==', userId)
          .orderBy('soldCount', 'desc')
          .limit(5)
          .get();

        if (prodSnap && prodSnap.docs && prodSnap.docs.length > 0) {
          setTopProducts(
            prodSnap.docs.map((d: any) => {
              const data = d.data();
              return {
                id: d.id,
                name: data.name || 'Product',
                sold: data.soldCount || 0,
                revenue: (data.price || 0) * (data.soldCount || 0),
                price: data.price || 0,
                image: resolveProductImage(data),
              };
            }),
          );
          setHasNoProducts(false);
          productsFetched = true;
        }
      } catch (e) {
        console.warn('[StoreDashboard] ownerId product query failed:', e);
      }

      if (!productsFetched) {
        try {
          const bizProdSnap = await firestore()
            .collection('products')
            .where('businessId', '==', userId)
            .orderBy('soldCount', 'desc')
            .limit(5)
            .get();

          if (bizProdSnap && bizProdSnap.docs && bizProdSnap.docs.length > 0) {
            setTopProducts(
              bizProdSnap.docs.map((d: any) => {
                const data = d.data();
                return {
                  id: d.id,
                  name: data.name || 'Product',
                  sold: data.soldCount || 0,
                  revenue: (data.price || 0) * (data.soldCount || 0),
                  price: data.price || 0,
                  image: resolveProductImage(data),
                };
              }),
            );
            setHasNoProducts(false);
          } else {
            setTopProducts([]);
            setHasNoProducts(true);
          }
        } catch {
          setTopProducts([]);
          setHasNoProducts(true);
        }
      }
    } catch (err) {
      console.error('[StoreDashboardScreen] loadData error:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // ── Derived values ─────────────────────────────────────────────────────

  const maxChartAmount = Math.max(...weeklyRevenue.map((d) => d.amount), 1);

  // ── Loading state ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading dashboard…</Text>
      </SafeAreaView>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* ── Greeting ──────────────────────────────────────────────────── */}
        <View style={styles.greetingRow}>
          <View style={styles.greetingTextWrap}>
            <Text style={styles.greetingLabel}>Welcome back,</Text>
            <Text style={styles.greetingName}>
              {user?.displayName || user?.username || 'Seller'}
            </Text>
          </View>
          <View style={styles.orderCountBadge}>
            <Text style={styles.orderCountValue}>{totalOrders}</Text>
            <Text style={styles.orderCountLabel}>Orders</Text>
          </View>
        </View>

        {/* ── Revenue overview cards ─────────────────────────────────────── */}
        <View style={styles.revenueRow}>
          <View style={[styles.revenueCard, styles.revenueCardToday]}>
            <View style={styles.revenueCardTop}>
              <Ionicons name="today-outline" size={16} color={colors.accentGold} />
              <Text style={styles.revenueLabel}>Today</Text>
            </View>
            <Text style={styles.revenueValue}>{formatCompactINR(revenue.today)}</Text>
          </View>
          <View style={styles.revenueCard}>
            <View style={styles.revenueCardTop}>
              <Ionicons name="calendar-outline" size={16} color={colors.accent} />
              <Text style={styles.revenueLabel}>Last 7 Days</Text>
            </View>
            <Text style={styles.revenueValue}>{formatCompactINR(revenue.week)}</Text>
          </View>
          <View style={styles.revenueCard}>
            <View style={styles.revenueCardTop}>
              <Ionicons name="bar-chart-outline" size={16} color={colors.accentGreen} />
              <Text style={styles.revenueLabel}>30 Days</Text>
            </View>
            <Text style={styles.revenueValue}>{formatCompactINR(revenue.month)}</Text>
          </View>
        </View>

        {/* Total lifetime revenue */}
        <View style={styles.totalRevenueCard}>
          <View style={styles.totalRevenueLeft}>
            <Ionicons name="wallet-outline" size={20} color={colors.primary} />
            <View>
              <Text style={styles.totalRevenueLabel}>Lifetime Revenue</Text>
              <Text style={styles.totalRevenueValue}>{formatINR(revenue.total)}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.viewOrdersBtn}
            onPress={() => navigation.navigate('BusinessOrders' as never)}
            activeOpacity={0.7}
          >
            <Text style={styles.viewOrdersBtnText}>View All</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* ── Weekly revenue chart ────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Weekly Revenue</Text>
          {revenue.week > 0 ? (
            <View style={styles.chartBars}>
              {weeklyRevenue.map((item) => {
                const barHeight = (item.amount / maxChartAmount) * 100;
                return (
                  <View key={item.label} style={styles.chartBarColumn}>
                    <Text style={styles.chartBarValue}>
                      {item.amount > 0 ? formatCompactINR(item.amount) : ''}
                    </Text>
                    <View
                      style={[
                        styles.chartBar,
                        {
                          height: Math.max(barHeight, 4),
                          backgroundColor:
                            item.amount > 0
                              ? item.amount === maxChartAmount
                                ? colors.accentGreen
                                : colors.primary
                              : colors.surfaceLight,
                        },
                      ]}
                    />
                    <Text style={styles.chartBarLabel}>{item.label}</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptySectionText}>No revenue this week</Text>
          )}
        </View>

        {/* ── Order status breakdown ──────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Order Status</Text>
          {orderBreakdown.length > 0 ? (
            <View style={styles.orderBreakdown}>
              {orderBreakdown.map((item) => (
                <View key={item.status} style={styles.breakdownItem}>
                  <View style={styles.breakdownHeader}>
                    <View style={[styles.breakdownDot, { backgroundColor: item.color }]} />
                    <Text style={styles.breakdownLabel}>{item.status}</Text>
                  </View>
                  <View style={styles.breakdownCountWrap}>
                    <Text style={styles.breakdownCount}>{item.count}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptySectionText}>No orders yet</Text>
          )}
        </View>

        {/* ── Top selling products ────────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Top Products</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('AddProduct' as never)}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>
          {topProducts.length > 0 ? (
            topProducts.map((product, i) => (
              <View key={product.id} style={styles.productItem}>
                <View style={styles.productRank}>
                  <Text
                    style={[
                      styles.productRankText,
                      i === 0 && styles.productRankFirst,
                    ]}
                  >
                    {i + 1}
                  </Text>
                </View>
                {product.image ? (
                  <Image
                    source={{ uri: product.image }}
                    style={styles.productImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.productImagePlaceholder}>
                    <Ionicons name="image-outline" size={18} color={colors.textMuted} />
                  </View>
                )}
                <View style={styles.productInfo}>
                  <Text style={styles.productName} numberOfLines={1}>
                    {product.name}
                  </Text>
                  <Text style={styles.productMeta}>
                    {product.sold} sold · {formatINR(product.price)} each
                  </Text>
                </View>
                <Text style={styles.productRevenue}>
                  {formatCompactINR(product.revenue)}
                </Text>
              </View>
            ))
          ) : (
            <View style={styles.emptySectionWrap}>
              <Ionicons name="storefront-outline" size={32} color={colors.textMuted} />
              <Text style={styles.emptySectionText}>
                {hasNoProducts ? 'No products listed yet' : 'No sales data yet'}
              </Text>
              {hasNoProducts && (
                <TouchableOpacity
                  style={styles.addProductBtn}
                  onPress={() => navigation.navigate('AddProduct' as never)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add" size={16} color={colors.white} />
                  <Text style={styles.addProductBtnText}>Add Your First Product</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* ── Recent orders ───────────────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>Recent Orders</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('BusinessOrders' as never)}
              activeOpacity={0.7}
            >
              <Text style={styles.seeAllText}>See All</Text>
            </TouchableOpacity>
          </View>
          {recentOrders.length > 0 ? (
            recentOrders.map((order) => (
              <TouchableOpacity
                key={order.id}
                style={styles.orderItem}
                onPress={() =>
                  navigation.navigate('OrderTracking' as never, {
                    orderId: order.id,
                  } as never)
                }
                activeOpacity={0.7}
              >
                <View style={styles.orderAvatar}>
                  <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                </View>
                <View style={styles.orderInfo}>
                  <Text style={styles.orderBuyer} numberOfLines={1}>
                    {order.buyerName}
                  </Text>
                  <Text style={styles.orderDate}>{formatRelativeDate(order.createdAt)}</Text>
                </View>
                <View style={styles.orderRight}>
                  <Text style={styles.orderTotal}>{formatINR(order.total)}</Text>
                  <View
                    style={[
                      styles.orderBadge,
                      {
                        backgroundColor: `${STATUS_COLORS[order.status] ?? colors.textMuted}20`,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.orderBadgeText,
                        { color: STATUS_COLORS[order.status] ?? colors.textMuted },
                      ]}
                    >
                      {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <Text style={styles.emptySectionText}>No orders yet</Text>
          )}
        </View>

        {/* ── Quick actions ───────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionsGrid}>
            <TouchableOpacity
              style={styles.actionItem}
              onPress={() => navigation.navigate('AddProduct' as never)}
              activeOpacity={0.7}
            >
              <View style={[styles.actionIconBg, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
              </View>
              <Text style={styles.actionLabel}>Add Product</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionItem}
              onPress={() => navigation.navigate('MyStore' as never)}
              activeOpacity={0.7}
            >
              <View style={[styles.actionIconBg, { backgroundColor: 'rgba(16, 185, 129, 0.12)' }]}>
                <Ionicons name="storefront-outline" size={24} color={colors.accentGreen} />
              </View>
              <Text style={styles.actionLabel}>View Store</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionItem}
              onPress={() => navigation.navigate('BusinessOrders' as never)}
              activeOpacity={0.7}
            >
              <View style={[styles.actionIconBg, { backgroundColor: 'rgba(245, 158, 11, 0.12)' }]}>
                <Ionicons name="bag-handle-outline" size={24} color={colors.accentGold} />
              </View>
              <Text style={styles.actionLabel}>Orders</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionItem}
              onPress={() => navigation.navigate('AdsManager' as never)}
              activeOpacity={0.7}
            >
              <View style={[styles.actionIconBg, { backgroundColor: 'rgba(239, 68, 68, 0.12)' }]}>
                <Ionicons name="megaphone-outline" size={24} color={colors.error} />
              </View>
              <Text style={styles.actionLabel}>Manage Ads</Text>
            </TouchableOpacity>
          </View>
        </View>
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
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  // ── Greeting ────────────────────────────────────────────────────────────
  greetingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  greetingTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  greetingLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 2,
  },
  greetingName: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  orderCountBadge: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  orderCountValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  orderCountLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },

  // ── Revenue cards ───────────────────────────────────────────────────────
  revenueRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  revenueCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  revenueCardToday: {
    borderColor: colors.accentGold,
    borderWidth: 1,
  },
  revenueCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  revenueLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
  },
  revenueValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },

  // ── Total revenue card ──────────────────────────────────────────────────
  totalRevenueCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  totalRevenueLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  totalRevenueLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 2,
  },
  totalRevenueValue: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },
  viewOrdersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  viewOrdersBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },

  // ── Card ────────────────────────────────────────────────────────────────
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
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  emptySectionText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
  },
  emptySectionWrap: {
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },

  // ── Weekly chart ────────────────────────────────────────────────────────
  chartBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 140,
    paddingHorizontal: 2,
  },
  chartBarColumn: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  chartBarValue: {
    fontSize: 8,
    color: colors.textMuted,
    fontWeight: '500',
  },
  chartBar: {
    width: 28,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
  },
  chartBarLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 6,
    fontWeight: '500',
  },

  // ── Order breakdown ─────────────────────────────────────────────────────
  orderBreakdown: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  breakdownItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  breakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  breakdownLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  breakdownCountWrap: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  breakdownCount: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
  },

  // ── Top products ────────────────────────────────────────────────────────
  productItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  productRank: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  productRankText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  productRankFirst: {
    color: colors.accentGold,
  },
  productImage: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.surfaceLight,
  },
  productImagePlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  productInfo: {
    flex: 1,
    marginRight: 8,
  },
  productName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  productMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  productRevenue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.accentGreen,
    textAlign: 'right',
  },
  addProductBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  addProductBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.white,
  },

  // ── Recent orders ───────────────────────────────────────────────────────
  orderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  orderAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  orderInfo: {
    flex: 1,
    marginRight: 8,
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
    fontWeight: '700',
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
    textTransform: 'capitalize',
  },

  // ── Quick actions ───────────────────────────────────────────────────────
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionItem: {
    flex: 1,
    minWidth: '42%',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
