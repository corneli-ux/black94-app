/**
 * BusinessOrdersScreen.tsx — Business order management
 *
 * Fetches real orders from Firestore via fetchBusinessOrders (shop.ts)
 * with a direct sellerId fallback. Tab-based filter, status actions,
 * tracking-number modal, pull-to-refresh, empty state.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { fetchBusinessOrders, updateOrderStatus, ShopOrder } from '../lib/shop';
import { firestore } from '../lib/firebase';

// ── Types ──────────────────────────────────────────────────────────────────

type OrderStatus = 'all' | 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

interface DisplayOrder {
  id: string;
  buyerName: string;
  itemsSummary: string;
  itemsCount: number;
  total: number;
  status: string;
  date: string;
  trackingNumber: string;
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

const STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  pending: { color: colors.accentGold, bg: 'rgba(245, 158, 11, 0.15)' },
  confirmed: { color: colors.primary, bg: 'rgba(255, 255, 255, 0.15)' },
  processing: { color: colors.primary, bg: 'rgba(255, 255, 255, 0.15)' },
  shipped: { color: colors.accent, bg: 'rgba(6, 182, 212, 0.15)' },
  delivered: { color: colors.accentGreen, bg: 'rgba(34, 197, 94, 0.15)' },
  cancelled: { color: colors.error, bg: 'rgba(239, 68, 68, 0.15)' },
};

const FILTERS: { key: OrderStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'processing', label: 'Processing' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

function orderToDisplay(order: ShopOrder): DisplayOrder {
  let itemsSummary = '';
  let itemsCount = 0;
  try {
    const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
    if (Array.isArray(items)) {
      itemsCount = items.reduce((sum: number, i: any) => sum + (i.quantity || 1), 0);
      const names = items.map((i: any) => i.productName || i.name || 'Item');
      if (names.length <= 2) {
        itemsSummary = names.join(', ');
      } else {
        itemsSummary = `${names[0]}, ${names[1]} +${names.length - 2} more`;
      }
    }
  } catch {
    /* ignore parse errors */
  }

  return {
    id: order.id,
    buyerName: order.buyerName || 'Unknown Buyer',
    itemsSummary,
    itemsCount,
    total: order.total || 0,
    status: order.status || 'pending',
    date: order.createdAt,
    trackingNumber: order.trackingNumber || '',
  };
}

function formatOrderDate(raw: string): string {
  if (!raw) return 'N/A';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ── Component ──────────────────────────────────────────────────────────────

export default function BusinessOrdersScreen() {
  const navigation = useNavigation<any>();
  const user = useAppStore((s) => s.user);

  const [orders, setOrders] = useState<DisplayOrder[]>([]);
  const [activeFilter, setActiveFilter] = useState<OrderStatus>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Tracking modal state
  const [trackingModal, setTrackingModal] = useState(false);
  const [trackingInput, setTrackingInput] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // ── Data fetching ─────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    const userId = user?.id;
    if (!userId) {
      setOrders([]);
      setLoading(false);
      return;
    }

    try {
      // Primary: use fetchBusinessOrders from shop.ts (queries by businessId)
      let rawOrders: ShopOrder[] = [];
      try {
        rawOrders = await fetchBusinessOrders(userId);
      } catch (e) {
        console.warn('[BusinessOrdersScreen] fetchBusinessOrders failed:', e);
      }

      // Fallback: direct sellerId query in case orders use sellerId instead
      if (rawOrders.length === 0) {
        try {
          const sellerSnap = await firestore()
            .collection('orders')
            .where('sellerId', '==', userId)
            .orderBy('createdAt', 'desc')
            .get();

          if (sellerSnap && sellerSnap.docs.length > 0) {
            rawOrders = sellerSnap.docs.map((d: any) => {
              const data = d.data();
              return {
                id: d.id,
                buyerId: data.buyerId ?? '',
                buyerName: data.buyerName ?? '',
                buyerEmail: data.buyerEmail ?? '',
                businessId: data.businessId ?? userId,
                businessName: data.businessName ?? '',
                items: typeof data.items === 'string' ? data.items : JSON.stringify(data.items ?? []),
                subtotal: data.subtotal ?? 0,
                shipping: data.shipping ?? 0,
                tax: data.tax ?? 0,
                total: data.total ?? 0,
                status: data.status ?? 'pending',
                shippingAddress:
                  typeof data.shippingAddress === 'string'
                    ? data.shippingAddress
                    : JSON.stringify(data.shippingAddress ?? {}),
                trackingNumber: data.trackingNumber ?? '',
                trackingPartner: data.trackingPartner ?? '',
                notes: data.notes ?? '',
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
              };
            });
          }
        } catch (e2) {
          console.warn('[BusinessOrdersScreen] sellerId fallback failed:', e2);
        }
      }

      const displayOrders = rawOrders.map(orderToDisplay);
      setOrders(displayOrders);
    } catch (err) {
      console.error('[BusinessOrdersScreen] loadData error:', err);
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

  const filteredOrders = useMemo(() => {
    if (activeFilter === 'all') return orders;
    return orders.filter((o) => o.status === activeFilter);
  }, [orders, activeFilter]);

  // ── Status update handlers ─────────────────────────────────────────────

  const doUpdateStatus = useCallback(
    async (orderId: string, newStatus: string, trackingNumber?: string) => {
      setUpdatingStatus(true);
      try {
        await updateOrderStatus(
          orderId,
          newStatus as ShopOrder['status'],
          trackingNumber,
        );
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? { ...o, status: newStatus, trackingNumber: trackingNumber || o.trackingNumber }
              : o,
          ),
        );
      } catch (err) {
        console.warn('[BusinessOrdersScreen] updateStatus error:', err);
        Alert.alert('Error', 'Failed to update order status. Please try again.');
      } finally {
        setUpdatingStatus(false);
      }
    },
    [],
  );

  const handleShip = useCallback((orderId: string) => {
    setSelectedOrderId(orderId);
    setTrackingInput('');
    setTrackingModal(true);
  }, []);

  const confirmShip = useCallback(() => {
    if (!selectedOrderId) return;
    doUpdateStatus(selectedOrderId, 'shipped', trackingInput.trim());
    setTrackingModal(false);
    setSelectedOrderId(null);
    setTrackingInput('');
  }, [selectedOrderId, trackingInput, doUpdateStatus]);

  const cancelShip = useCallback(() => {
    setTrackingModal(false);
    setSelectedOrderId(null);
    setTrackingInput('');
  }, []);

  // ── Render helpers ─────────────────────────────────────────────────────

  const renderOrderItem = ({ item }: { item: DisplayOrder }) => {
    const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
    const dateStr = formatOrderDate(item.date);

    // Build available action buttons based on current status
    const actions: { label: string; nextStatus: string; icon: string; isShip?: boolean }[] = [];

    if (item.status === 'pending') {
      actions.push({
        label: 'Accept',
        nextStatus: 'confirmed',
        icon: 'checkmark-circle-outline',
      });
      actions.push({
        label: 'Cancel',
        nextStatus: 'cancelled',
        icon: 'close-circle-outline',
      });
    }
    if (item.status === 'confirmed' || item.status === 'processing') {
      actions.push({
        label: 'Ship',
        nextStatus: 'shipped',
        icon: 'truck-outline',
        isShip: true,
      });
    }
    if (item.status === 'shipped') {
      actions.push({
        label: 'Delivered',
        nextStatus: 'delivered',
        icon: 'checkmark-done-outline',
      });
    }

    return (
      <TouchableOpacity
        style={styles.orderCard}
        onPress={() =>
          navigation.navigate('OrderTracking' as never, { orderId: item.id } as never)
        }
        activeOpacity={0.7}
      >
        {/* Header row: order ID + status badge */}
        <View style={styles.orderHeader}>
          <View style={styles.orderIdRow}>
            <Ionicons name="receipt-outline" size={14} color={colors.textMuted} />
            <Text style={styles.orderId}>{item.id.slice(0, 8).toUpperCase()}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.statusBadgeText, { color: cfg.color }]}>
              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            </Text>
          </View>
        </View>

        {/* Detail rows */}
        <View style={styles.orderDetails}>
          <View style={styles.orderDetailRow}>
            <Ionicons name="person-outline" size={14} color={colors.textMuted} />
            <Text style={styles.orderDetailText}>{item.buyerName}</Text>
          </View>
          <View style={styles.orderDetailRow}>
            <Ionicons name="cube-outline" size={14} color={colors.textMuted} />
            <Text style={styles.orderDetailText} numberOfLines={1}>
              {item.itemsSummary || `${item.itemsCount} item(s)`}
            </Text>
          </View>
          <View style={styles.orderDetailRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
            <Text style={styles.orderDetailText}>{dateStr}</Text>
          </View>
          {item.trackingNumber ? (
            <View style={styles.orderDetailRow}>
              <Ionicons name="trail-sign-outline" size={14} color={colors.accent} />
              <Text style={[styles.orderDetailText, { color: colors.accent }]} numberOfLines={1}>
                {item.trackingNumber}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Footer: total + action buttons */}
        <View style={styles.orderFooter}>
          <Text style={styles.orderTotal}>{formatINR(item.total)}</Text>
          {actions.length > 0 && (
            <View style={styles.actionsRow}>
              {actions.map((action) => (
                <TouchableOpacity
                  key={action.nextStatus}
                  style={[
                    styles.actionBtn,
                    action.nextStatus === 'cancelled' && styles.actionBtnCancel,
                  ]}
                  onPress={(e) => {
                    e.stopPropagation();
                    if (action.isShip) {
                      handleShip(item.id);
                    } else if (action.nextStatus === 'cancelled') {
                      Alert.alert(
                        'Cancel Order?',
                        'This will mark the order as cancelled and notify the buyer.',
                        [
                          { text: 'Keep Order', style: 'cancel' },
                          {
                            text: 'Cancel Order',
                            style: 'destructive',
                            onPress: () => doUpdateStatus(item.id, action.nextStatus),
                          },
                        ],
                      );
                    } else {
                      Alert.alert(
                        `Mark as ${action.nextStatus}?`,
                        'This will update the order status and notify the buyer.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Confirm',
                            style: 'default',
                            onPress: () => doUpdateStatus(item.id, action.nextStatus),
                          },
                        ],
                      );
                    }
                  }}
                  activeOpacity={0.7}
                  disabled={updatingStatus}
                >
                  <Ionicons
                    name={action.icon}
                    size={15}
                    color={
                      action.nextStatus === 'cancelled'
                        ? colors.error
                        : colors.primary
                    }
                  />
                  <Text
                    style={[
                      styles.actionBtnText,
                      action.nextStatus === 'cancelled' && styles.actionBtnTextCancel,
                    ]}
                  >
                    {action.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // ── Loading state ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading orders…</Text>
      </SafeAreaView>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Filter tabs */}
      <View style={styles.filterContainer}>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.key}
          renderItem={({ item: filter }) => {
            const isActive = activeFilter === filter.key;
            // Show count badge for non-"all" tabs
            const count =
              filter.key === 'all'
                ? orders.length
                : orders.filter((o) => o.status === filter.key).length;

            return (
              <TouchableOpacity
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => setActiveFilter(filter.key)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isActive && styles.filterChipTextActive,
                  ]}
                >
                  {filter.label}
                </Text>
                {count > 0 && (
                  <View
                    style={[
                      styles.filterCount,
                      isActive ? styles.filterCountActive : styles.filterCountInactive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterCountText,
                        isActive && styles.filterCountTextActive,
                      ]}
                    >
                      {count}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.filterList}
        />
      </View>

      {/* Orders list */}
      <FlatList
        data={filteredOrders}
        renderItem={renderOrderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          filteredOrders.length === 0 ? styles.emptyList : styles.ordersList
        }
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="cube-outline" size={44} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>
              No {activeFilter === 'all' ? '' : activeFilter + ' '}orders yet
            </Text>
            <Text style={styles.emptySubtitle}>
              {activeFilter === 'all'
                ? 'When customers make purchases, their orders will appear here.'
                : `You don't have any ${activeFilter} orders at the moment.`}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      />

      {/* Tracking number modal */}
      <Modal
        visible={trackingModal}
        transparent
        animationType="fade"
        onRequestClose={cancelShip}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            style={styles.modalContent}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.modalHeader}>
              <Ionicons name="truck-outline" size={24} color={colors.accent} />
              <Text style={styles.modalTitle}>Ship Order</Text>
            </View>
            <Text style={styles.modalSubtitle}>
              Enter the tracking number for this shipment. The buyer will be notified.
            </Text>
            <Text style={styles.modalOrderIdLabel}>
              Order: {selectedOrderId?.slice(0, 8).toUpperCase()}
            </Text>
            <TextInput
              style={styles.trackingInput}
              placeholder="e.g., AWB1234567890"
              placeholderTextColor={colors.textMuted}
              value={trackingInput}
              onChangeText={setTrackingInput}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={confirmShip}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={cancelShip}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalConfirmBtn,
                  !trackingInput.trim() && styles.modalConfirmBtnDisabled,
                ]}
                onPress={confirmShip}
                disabled={!trackingInput.trim() || updatingStatus}
                activeOpacity={0.7}
              >
                {updatingStatus ? (
                  <ActivityIndicator size="small" color={colors.black} />
                ) : (
                  <Text style={styles.modalConfirmText}>Confirm &amp; Ship</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
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
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textMuted,
  },

  // ── Filter tabs ─────────────────────────────────────────────────────────
  filterContainer: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingTop: 8,
    paddingBottom: 8,
  },
  filterList: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.black,
    fontWeight: '600',
  },
  filterCount: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterCountInactive: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  filterCountActive: {
    backgroundColor: colors.black,
  },
  filterCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
  },
  filterCountTextActive: {
    color: colors.white,
  },

  // ── Orders list ─────────────────────────────────────────────────────────
  ordersList: {
    padding: 16,
    paddingBottom: 40,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  orderCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  orderIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  orderId: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  orderDetails: {
    gap: 6,
    marginBottom: 12,
  },
  orderDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  orderDetailText: {
    fontSize: 13,
    color: colors.textSecondary,
    flex: 1,
  },
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  orderTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  actionBtnCancel: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  actionBtnTextCancel: {
    color: colors.error,
  },

  // ── Empty state ─────────────────────────────────────────────────────────
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 32,
    lineHeight: 20,
  },

  // ── Tracking modal ──────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  modalSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 12,
    lineHeight: 18,
  },
  modalOrderIdLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    fontFamily: 'monospace',
    backgroundColor: colors.background,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 16,
    alignSelf: 'flex-start',
    letterSpacing: 0.5,
  },
  trackingInput: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 20,
    letterSpacing: 0.5,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modalConfirmBtn: {
    flex: 1.4,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  modalConfirmBtnDisabled: {
    opacity: 0.4,
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.black,
  },
});
