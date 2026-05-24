import { colors } from '../theme/colors';
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { auth } from '../lib/firebase';import { AppIcon } from '../components/icons';

import {
  ShopOrder,
  fetchBusinessOrders,
  updateOrderStatus,
} from '../lib/shop';

/* ── Theme compat (mirrors source theme tokens) ─────────────────────────────── */

const C = {
  black: colors.bg,
  white: colors.white,
  surface: colors.surface,
  surfaceBorder: colors.border,
  primary: colors.white,
  textPrimary: colors.text,
  textSecondary: colors.textSecondary,
  textTertiary: colors.textMuted,
  success: colors.accentGreen,
  warning: colors.accentGold,
  danger: colors.error,
  info: '#06b6d4',
  white20: colors.accentBorder,
};

const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
const F = { xs: 10, sm: 12, md: 14, lg: 15, xl: 18, xxl: 22, xxxl: 28 };
const BR = { sm: 6, md: 10, lg: 16, xl: 24 };

/* ── Types ──────────────────────────────────────────────────────────────────── */

type RootStackParamList = {
  OrderTracking: { orderId: string };
};

const STATUS_TABS: Array<{
  key: string;
  label: string;
  color: string;
}> = [
  { key: 'all', label: 'All', color: C.textSecondary },
  { key: 'pending', label: 'Pending', color: C.warning },
  { key: 'confirmed', label: 'Confirmed', color: C.primary },
  { key: 'processing', label: 'Processing', color: C.info },
  { key: 'shipped', label: 'Shipped', color: '#8b5cf6' },
  { key: 'delivered', label: 'Delivered', color: C.success },
  { key: 'cancelled', label: 'Cancelled', color: C.danger },
];

const CrmOrdersScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const uid = auth().currentUser?.uid ?? '';

  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<ShopOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState<ShopOrder | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      const result = await fetchBusinessOrders(uid);
      setOrders(result);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (activeTab === 'all') {
      setFilteredOrders(orders);
    } else {
      setFilteredOrders(orders.filter((o) => o.status === activeTab));
    }
  }, [orders, activeTab]);

  const statusColor = (status: string) => {
    const s = STATUS_TABS.find((t) => t.key === status);
    return s?.color ?? C.textTertiary;
  };

  const handleUpdateStatus = (order: ShopOrder) => {
    const nextStatuses: Record<string, ShopOrder['status'][]> = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['processing', 'cancelled'],
      processing: ['shipped', 'cancelled'],
      shipped: ['delivered'],
      delivered: [],
      cancelled: [],
      refunded: [],
    };

    const options = nextStatuses[order.status] || [];

    if (options.length === 0) {
      Alert.alert('Info', 'No further actions available for this order.');
      return;
    }

    Alert.alert(
      'Update Status',
      `Current: ${order.status.charAt(0).toUpperCase() + order.status.slice(1)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        ...options.map((status) => ({
          text: status.charAt(0).toUpperCase() + status.slice(1),
          onPress: async () => {
            try {
              await updateOrderStatus(order.id, status);
              setOrders((prev) =>
                prev.map((o) => (o.id === order.id ? { ...o, status } : o)),
              );
              setSelectedOrder((prev) => (prev?.id === order.id ? { ...prev, status } : prev));
            } catch {
              Alert.alert('Error', 'Failed to update status');
            }
          },
        })),
      ],
    );
  };

  const parseItems = (itemsJson: string) => {
    try {
      return JSON.parse(itemsJson) || [];
    } catch {
      return [];
    }
  };

  const parseAddress = (addrJson: string) => {
    try {
      return JSON.parse(addrJson) || {};
    } catch {
      return {};
    }
  };

  const renderOrder = ({ item }: { item: ShopOrder }) => {
    const items = parseItems(item.items);
    const itemCount = Array.isArray(items) ? items.length : 0;

    return (
      <TouchableOpacity
        style={styles.orderCard}
        onPress={() => setSelectedOrder(item)}>
        <View style={styles.orderHeader}>
          <Text style={styles.orderId}>#{item.id.slice(-8)}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) + '20' }]}>
            <Text style={[styles.statusText, { color: statusColor(item.status) }]}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>
        </View>

        <View style={styles.orderBody}>
          <View style={styles.orderInfo}>
            <View style={styles.orderBuyerRow}>
              <AppIcon name="person-outline" size="sm" color={C.textSecondary} />
              <Text style={styles.orderBuyer}>{item.buyerName}</Text>
            </View>
            <Text style={styles.orderItems}>
              {itemCount} item{itemCount !== 1 ? 's' : ''}
            </Text>
          </View>
          <View style={styles.orderRight}>
            <Text style={styles.orderTotal}>
              ₹{item.total.toLocaleString('en-IN')}
            </Text>
            <Text style={styles.orderDate}>
              {new Date(item.createdAt).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
              })}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.centerLoader}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Orders</Text>
        <Text style={styles.headerCount}>{orders.length} orders</Text>
      </View>

      {/* Status Tabs */}
      <View style={styles.tabBar}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={STATUS_TABS}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.tabList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.tab,
                activeTab === item.key && {
                  backgroundColor: item.color + '20',
                  borderColor: item.color,
                },
              ]}
              onPress={() => setActiveTab(item.key)}>
              <Text
                style={[
                  styles.tabText,
                  activeTab === item.key && { color: item.color },
                ]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Orders List */}
      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrder}
        contentContainerStyle={styles.ordersList}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <AppIcon name="receipt" size="hero" color={C.white20} />
            <Text style={styles.emptyTitle}>No orders</Text>
            <Text style={styles.emptySubtitle}>
              {activeTab === 'all'
                ? 'Orders will appear when customers purchase'
                : `No ${activeTab} orders`}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadOrders();
            }}
            tintColor={C.primary}
          />
        }
      />

      {/* Order Detail Modal */}
      <Modal
        visible={!!selectedOrder}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedOrder(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedOrder && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    Order #{selectedOrder.id.slice(-8)}
                  </Text>
                  <TouchableOpacity onPress={() => setSelectedOrder(null)}>
                    <AppIcon name="close" size="xl" color={C.white} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.modalBody}>
                  {/* Status */}
                  <View style={styles.modalStatusRow}>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor(selectedOrder.status) + '20' }]}>
                      <Text style={[styles.statusText, { color: statusColor(selectedOrder.status) }]}>
                        {selectedOrder.status.charAt(0).toUpperCase() + selectedOrder.status.slice(1)}
                      </Text>
                    </View>
                    <Text style={styles.modalDate}>
                      {new Date(selectedOrder.createdAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </Text>
                  </View>

                  {/* Buyer */}
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Buyer</Text>
                    <Text style={styles.modalText}>{selectedOrder.buyerName}</Text>
                    <Text style={styles.modalSubtext}>{selectedOrder.buyerEmail}</Text>
                  </View>

                  {/* Items */}
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Items</Text>
                    {parseItems(selectedOrder.items).map((item: any, idx: number) => (
                      <View key={idx} style={styles.modalItem}>
                        <Text style={styles.modalItemName}>
                          {item.productName} x{item.quantity}
                        </Text>
                        <Text style={styles.modalItemPrice}>
                          ₹{(item.price * item.quantity).toLocaleString('en-IN')}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* Totals */}
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Summary</Text>
                    <View style={styles.modalRow}>
                      <Text style={styles.modalLabel}>Subtotal</Text>
                      <Text style={styles.modalValue}>
                        ₹{selectedOrder.subtotal.toLocaleString('en-IN')}
                      </Text>
                    </View>
                    <View style={styles.modalRow}>
                      <Text style={styles.modalLabel}>Shipping</Text>
                      <Text style={styles.modalValue}>
                        ₹{selectedOrder.shipping.toLocaleString('en-IN')}
                      </Text>
                    </View>
                    <View style={styles.modalRow}>
                      <Text style={styles.modalLabel}>Tax</Text>
                      <Text style={styles.modalValue}>
                        ₹{selectedOrder.tax.toLocaleString('en-IN')}
                      </Text>
                    </View>
                    <View style={[styles.modalRow, styles.modalTotalRow]}>
                      <Text style={styles.modalTotalLabel}>Total</Text>
                      <Text style={styles.modalTotalValue}>
                        ₹{selectedOrder.total.toLocaleString('en-IN')}
                      </Text>
                    </View>
                  </View>

                  {/* Shipping */}
                  {selectedOrder.trackingNumber && (
                    <View style={styles.modalSection}>
                      <Text style={styles.modalSectionTitle}>Shipping</Text>
                      <Text style={styles.modalText}>
                        Partner: {selectedOrder.trackingPartner}
                      </Text>
                      <Text style={styles.modalText}>
                        Tracking: {selectedOrder.trackingNumber}
                      </Text>
                    </View>
                  )}

                  {/* Address */}
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Shipping Address</Text>
                    {(() => {
                      const addr = parseAddress(selectedOrder.shippingAddress);
                      return (
                        <>
                          <Text style={styles.modalText}>{addr.name}</Text>
                          <Text style={styles.modalSubtext}>{addr.line1}</Text>
                          {addr.line2 && <Text style={styles.modalSubtext}>{addr.line2}</Text>}
                          <Text style={styles.modalSubtext}>
                            {addr.city}, {addr.state} - {addr.pincode}
                          </Text>
                          <Text style={styles.modalSubtext}>{addr.phone}</Text>
                        </>
                      );
                    })()}
                  </View>

                  {/* Action */}
                  <TouchableOpacity
                    style={styles.updateStatusBtn}
                    onPress={() => handleUpdateStatus(selectedOrder)}>
                    <Text style={styles.updateStatusText}>Update Status</Text>
                  </TouchableOpacity>
                  <View style={{ height: 40 }} />
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.black,
  },
  centerLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: C.black,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceBorder,
  },
  headerTitle: {
    color: C.textPrimary,
    fontSize: F.xl,
    fontWeight: '700',
  },
  headerCount: {
    color: C.textSecondary,
    fontSize: F.sm,
  },
  tabBar: {
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceBorder,
  },
  tabList: {
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    gap: S.sm,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: BR.lg,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.surfaceBorder,
  },
  tabText: {
    color: C.textSecondary,
    fontSize: F.sm,
    fontWeight: '500',
  },
  ordersList: {
    padding: S.lg,
  },
  separator: {
    height: 8,
  },
  orderCard: {
    backgroundColor: C.surface,
    borderRadius: BR.md,
    borderWidth: 1,
    borderColor: C.surfaceBorder,
    padding: S.md,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: S.sm,
  },
  orderId: {
    color: C.textPrimary,
    fontSize: F.sm,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BR.sm,
  },
  statusText: {
    fontSize: F.xs,
    fontWeight: '600',
  },
  orderBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderInfo: {
    flex: 1,
  },
  orderBuyerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  orderBuyer: {
    color: C.textSecondary,
    fontSize: F.sm,
  },
  orderItems: {
    color: C.textTertiary,
    fontSize: F.xs,
    marginTop: 2,
  },
  orderRight: {
    alignItems: 'flex-end',
  },
  orderTotal: {
    color: C.white,
    fontSize: F.md,
    fontWeight: '700',
  },
  orderDate: {
    color: C.textTertiary,
    fontSize: F.xs,
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: S.xl,
  },
  emptyTitle: {
    color: C.textPrimary,
    fontSize: F.lg,
    fontWeight: '600',
    marginTop: S.lg,
  },
  emptySubtitle: {
    color: C.textSecondary,
    fontSize: F.sm,
    marginTop: S.xs,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlayHeavy,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: C.surface,
    borderTopLeftRadius: BR.xl,
    borderTopRightRadius: BR.xl,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: S.lg,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceBorder,
  },
  modalTitle: {
    color: C.textPrimary,
    fontSize: F.lg,
    fontWeight: '600',
  },
  modalBody: {
    padding: S.lg,
  },
  modalStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: S.lg,
  },
  modalDate: {
    color: C.textTertiary,
    fontSize: F.sm,
  },
  modalSection: {
    marginBottom: S.lg,
  },
  modalSectionTitle: {
    color: C.textPrimary,
    fontSize: F.md,
    fontWeight: '600',
    marginBottom: S.xs,
  },
  modalText: {
    color: C.textSecondary,
    fontSize: F.sm,
  },
  modalSubtext: {
    color: C.textTertiary,
    fontSize: F.sm,
    marginTop: 2,
  },
  modalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  modalItemName: {
    color: C.textSecondary,
    fontSize: F.sm,
  },
  modalItemPrice: {
    color: C.textPrimary,
    fontSize: F.sm,
    fontWeight: '600',
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  modalLabel: {
    color: C.textSecondary,
    fontSize: F.sm,
  },
  modalValue: {
    color: C.textPrimary,
    fontSize: F.sm,
    fontWeight: '500',
  },
  modalTotalRow: {
    borderTopWidth: 1,
    borderTopColor: C.surfaceBorder,
    paddingTop: S.sm,
    marginTop: S.xs,
  },
  modalTotalLabel: {
    color: C.textPrimary,
    fontSize: F.md,
    fontWeight: '700',
  },
  modalTotalValue: {
    color: C.white,
    fontSize: F.lg,
    fontWeight: '800',
  },
  updateStatusBtn: {
    backgroundColor: C.primary,
    borderRadius: BR.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: S.md,
  },
  updateStatusText: {
    color: C.black,
    fontSize: F.md,
    fontWeight: '700',
  },
});

export default CrmOrdersScreen;
