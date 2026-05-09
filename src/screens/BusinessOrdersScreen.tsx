/**
 * BusinessOrdersScreen.tsx — Business order management
 *
 * Filter tabs, FlatList of orders, status update actions.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { firestore } from '../lib/firebase';

// ── Types ──────────────────────────────────────────────────────────────────

type OrderStatus = 'all' | 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

interface DisplayOrder {
  id: string;
  buyerName: string;
  itemsCount: number;
  total: number;
  status: string;
  date: string;
}

// ── Placeholder data ──────────────────────────────────────────────────────

const PLACEHOLDER_ORDERS: DisplayOrder[] = [
  { id: 'ORD-2025-001', buyerName: 'Rahul Mehta', itemsCount: 2, total: 3498, status: 'pending', date: '2025-01-28T10:30:00Z' },
  { id: 'ORD-2025-002', buyerName: 'Priya Sharma', itemsCount: 1, total: 1499, status: 'pending', date: '2025-01-28T09:15:00Z' },
  { id: 'ORD-2025-003', buyerName: 'Amit Kumar', itemsCount: 3, total: 5897, status: 'processing', date: '2025-01-27T14:20:00Z' },
  { id: 'ORD-2025-004', buyerName: 'Neha Singh', itemsCount: 1, total: 899, status: 'processing', date: '2025-01-27T11:00:00Z' },
  { id: 'ORD-2025-005', buyerName: 'Vikram Joshi', itemsCount: 4, total: 12490, status: 'shipped', date: '2025-01-26T16:45:00Z' },
  { id: 'ORD-2025-006', buyerName: 'Sneha Patel', itemsCount: 2, total: 2998, status: 'shipped', date: '2025-01-26T10:00:00Z' },
  { id: 'ORD-2025-007', buyerName: 'Karan Thakur', itemsCount: 1, total: 499, status: 'delivered', date: '2025-01-25T08:30:00Z' },
  { id: 'ORD-2025-008', buyerName: 'Divya Reddy', itemsCount: 5, total: 8450, status: 'delivered', date: '2025-01-24T14:20:00Z' },
  { id: 'ORD-2025-009', buyerName: 'Arjun Nair', itemsCount: 2, total: 2198, status: 'cancelled', date: '2025-01-23T09:00:00Z' },
  { id: 'ORD-2025-010', buyerName: 'Meera Gupta', itemsCount: 1, total: 1299, status: 'delivered', date: '2025-01-22T11:15:00Z' },
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

const STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  pending: { color: colors.accentGold, bg: 'rgba(245, 158, 11, 0.15)' },
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

// ── Component ──────────────────────────────────────────────────────────────

export default function BusinessOrdersScreen() {
  const navigation = useNavigation<any>();
  const user = useAppStore((s) => s.user);
  const [orders, setOrders] = useState<DisplayOrder[]>([]);
  const [activeFilter, setActiveFilter] = useState<OrderStatus>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [trackingModal, setTrackingModal] = useState(false);
  const [trackingInput, setTrackingInput] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      // Placeholder — replace with Firestore fetch using fetchBusinessOrders
      setOrders(PLACEHOLDER_ORDERS);
    } catch (err) {
      console.error('[BusinessOrdersScreen] loadData error:', err);
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

  const filteredOrders = useMemo(() => {
    if (activeFilter === 'all') return orders;
    return orders.filter((o) => o.status === activeFilter);
  }, [orders, activeFilter]);

  // ── Status update handlers ─────────────────────────────────────────────
  const updateStatus = useCallback(
    async (orderId: string, newStatus: string, trackingNumber?: string) => {
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)),
      );

      try {
        const update: Record<string, unknown> = {
          status: newStatus,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        };
        if (trackingNumber) {
          update.trackingNumber = trackingNumber;
        }
        await firestore().collection('orders').doc(orderId).update(update);
      } catch (err) {
        console.warn('[BusinessOrdersScreen] updateStatus error:', err);
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
    if (selectedOrderId) {
      updateStatus(selectedOrderId, 'shipped', trackingInput);
      setTrackingModal(false);
      setSelectedOrderId(null);
      setTrackingInput('');
    }
  }, [selectedOrderId, trackingInput, updateStatus]);

  // ── Render order item ──────────────────────────────────────────────────
  const renderOrderItem = ({ item }: { item: DisplayOrder }) => {
    const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
    const actions: { label: string; nextStatus: string; icon: string; isShip?: boolean }[] = [];

    if (item.status === 'pending') {
      actions.push({ label: 'Confirm', nextStatus: 'processing', icon: 'checkmark-circle-outline' });
    }
    if (item.status === 'processing') {
      actions.push({ label: 'Ship', nextStatus: 'shipped', icon: 'truck-outline', isShip: true });
    }
    if (item.status === 'shipped') {
      actions.push({ label: 'Deliver', nextStatus: 'delivered', icon: 'checkmark-done-outline' });
    }

    return (
      <TouchableOpacity
        style={styles.orderCard}
        onPress={() =>
          navigation.navigate('OrderTracking' as never, { orderId: item.id } as never)
        }
        activeOpacity={0.7}>
        <View style={styles.orderHeader}>
          <Text style={styles.orderId} numberOfLines={1}>
            {item.id}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.statusBadgeText, { color: cfg.color, textTransform: 'capitalize' }]}>
              {item.status}
            </Text>
          </View>
        </View>

        <View style={styles.orderDetails}>
          <View style={styles.orderDetailRow}>
            <Ionicons name="person-outline" size={14} color={colors.textMuted} />
            <Text style={styles.orderDetailText}>{item.buyerName}</Text>
          </View>
          <View style={styles.orderDetailRow}>
            <Ionicons name="cube-outline" size={14} color={colors.textMuted} />
            <Text style={styles.orderDetailText}>{item.itemsCount} item(s)</Text>
          </View>
          <View style={styles.orderDetailRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
            <Text style={styles.orderDetailText}>
              {new Date(item.date).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Text>
          </View>
        </View>

        <View style={styles.orderFooter}>
          <Text style={styles.orderTotal}>{formatINR(item.total)}</Text>
          {actions.length > 0 && (
            <View style={styles.actionsRow}>
              {actions.map((action) => (
                <TouchableOpacity
                  key={action.nextStatus}
                  style={styles.actionBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    if (action.isShip) {
                      handleShip(item.id);
                    } else {
                      Alert.alert(
                        `Mark as ${action.nextStatus}?`,
                        `This will update the order status.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: action.label,
                            style: 'default',
                            onPress: () => updateStatus(item.id, action.nextStatus),
                          },
                        ],
                      );
                    }
                  }}
                  activeOpacity={0.7}>
                  <Ionicons name={action.icon as any} size={16} color={colors.primary} />
                  <Text style={styles.actionBtnText}>{action.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Filter tabs */}
      <View style={styles.filterContainer}>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.filterChip,
                activeFilter === item.key && styles.filterChipActive,
              ]}
              onPress={() => setActiveFilter(item.key)}
              activeOpacity={0.7}>
              <Text
                style={[
                  styles.filterChipText,
                  activeFilter === item.key && styles.filterChipTextActive,
                ]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.filterList}
        />
      </View>

      {/* Orders list */}
      <FlatList
        data={filteredOrders}
        renderItem={renderOrderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.ordersList}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="cube-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>
              No {activeFilter === 'all' ? '' : activeFilter + ' '}orders
            </Text>
            <Text style={styles.emptySubtitle}>
              Orders will appear here when customers make purchases.
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      />

      {/* Tracking number modal */}
      <Modal
        visible={trackingModal}
        transparent
        animationType="fade"
        onRequestClose={() => setTrackingModal(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            style={styles.modalContent}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <Text style={styles.modalTitle}>Add Tracking Number</Text>
            <Text style={styles.modalSubtitle}>
              Enter the tracking number for this shipment
            </Text>
            <TextInput
              style={styles.trackingInput}
              placeholder="e.g., AWB1234567890"
              placeholderTextColor={colors.textMuted}
              value={trackingInput}
              onChangeText={setTrackingInput}
              autoCapitalize="characters"
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setTrackingModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalConfirmBtn,
                  !trackingInput.trim() && styles.modalConfirmBtnDisabled,
                ]}
                onPress={confirmShip}
                disabled={!trackingInput.trim()}>
                <Text style={styles.modalConfirmText}>Ship Order</Text>
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
  },
  // Filters
  filterContainer: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingTop: 8,
    paddingBottom: 4,
  },
  filterList: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
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
    color: colors.white,
  },
  // Orders list
  ordersList: {
    padding: 16,
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
    marginBottom: 10,
  },
  orderId: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
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
    gap: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  // Empty
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 32,
    lineHeight: 18,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 16,
  },
  trackingInput: {
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  modalConfirmBtnDisabled: {
    opacity: 0.5,
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
  },
});
