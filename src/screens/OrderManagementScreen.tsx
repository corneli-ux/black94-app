/**
 * OrderManagementScreen.tsx — Business Order Management with ShipRocket Integration
 *
 * Tab-filtered order list with detail modal, ShipRocket shipment creation,
 * tracking timeline, status updates, and pull-to-refresh.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { fetchBusinessOrders, updateOrderStatus, ShopOrder, OrderItem } from '../lib/shop';
import { getShipRocketClient, ShipRocketTrackingActivity } from '../lib/shiprocket';
import { firestore } from '../lib/firebase';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Helpers ────────────────────────────────────────────────────────────────

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function parseOrderItems(itemsJson: string): OrderItem[] {
  try {
    const items = typeof itemsJson === 'string' ? JSON.parse(itemsJson) : itemsJson;
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function parseAddress(addrJson: string): Record<string, string> {
  try {
    const addr = typeof addrJson === 'string' ? JSON.parse(addrJson) : addrJson;
    return addr && typeof addr === 'object' ? addr : {};
  } catch {
    return {};
  }
}

function formatOrderDate(raw: string): string {
  if (!raw) return 'N/A';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  pending: { color: colors.accentGold, bg: 'rgba(245, 158, 11, 0.15)' },
  confirmed: { color: colors.primary, bg: 'rgba(255, 255, 255, 0.15)' },
  processing: { color: colors.primary, bg: 'rgba(255, 255, 255, 0.15)' },
  shipped: { color: colors.accent, bg: 'rgba(6, 182, 212, 0.15)' },
  delivered: { color: colors.accentGreen, bg: 'rgba(34, 197, 94, 0.15)' },
  cancelled: { color: colors.error, bg: 'rgba(239, 68, 68, 0.15)' },
  refunded: { color: colors.textMuted, bg: 'rgba(113, 118, 123, 0.15)' },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'processing', label: 'Processing' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

type FilterKey = typeof FILTERS[number]['key'];

const NEXT_STATUS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

// ── Component ──────────────────────────────────────────────────────────────

export default function OrderManagementScreen() {
  const navigation = useNavigation<any>();
  const user = useAppStore((s) => s.user);

  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Detail modal
  const [detailModal, setDetailModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ShopOrder | null>(null);

  // Shipment creation
  const [shipmentModal, setShipmentModal] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [couriers, setCouriers] = useState<any[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [selectedCourier, setSelectedCourier] = useState('');
  const [creatingShipment, setCreatingShipment] = useState(false);

  // Tracking
  const [trackingModal, setTrackingModal] = useState(false);
  const [trackingActivities, setTrackingActivities] = useState<ShipRocketTrackingActivity[]>([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingStatus, setTrackingStatus] = useState('');

  const [updatingStatus, setUpdatingStatus] = useState(false);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    const userId = user?.id;
    if (!userId) { setOrders([]); setLoading(false); return; }

    try {
      let rawOrders = await fetchBusinessOrders(userId);

      if (rawOrders.length === 0) {
        const sellerSnap = await firestore()
          .collection('orders')
          .where('sellerId', '==', userId)
          .orderBy('createdAt', 'desc')
          .limit(200)
          .get();
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
            shippingAddress: typeof data.shippingAddress === 'string' ? data.shippingAddress : JSON.stringify(data.shippingAddress ?? {}),
            trackingNumber: data.trackingNumber ?? '',
            trackingPartner: data.trackingPartner ?? '',
            notes: data.notes ?? '',
            createdAt: data.createdAt ?? '',
            updatedAt: data.updatedAt ?? '',
          };
        });
      }

      setOrders(rawOrders);
    } catch (err) {
      console.error('[OrderManagement] loadData error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { loadData(); }, [loadData]);
  const onRefresh = useCallback(() => { setRefreshing(true); loadData(); }, [loadData]);

  const filteredOrders = useMemo(() => {
    if (activeFilter === 'all') return orders;
    return orders.filter((o) => o.status === activeFilter);
  }, [orders, activeFilter]);

  // ── Status update ────────────────────────────────────────────────────────

  const handleUpdateStatus = useCallback(async (orderId: string, newStatus: string) => {
    setUpdatingStatus(true);
    try {
      await updateOrderStatus(orderId, newStatus as ShopOrder['status']);
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: newStatus as ShopOrder['status'] } : o)));
      if (selectedOrder?.id === orderId) {
        setSelectedOrder((prev) => prev ? { ...prev, status: newStatus as ShopOrder['status'] } : null);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to update order status.');
    } finally {
      setUpdatingStatus(false);
    }
  }, [selectedOrder]);

  // ── Order detail ─────────────────────────────────────────────────────────

  const openDetail = useCallback((order: ShopOrder) => {
    setSelectedOrder(order);
    setDetailModal(true);
  }, []);

  // ── Create shipment (ShipRocket) ─────────────────────────────────────────

  const openShipmentFlow = useCallback(async (order: ShopOrder) => {
    setSelectedOrder(order);
    setShipmentModal(true);
    setWarehouses([]);
    setCouriers([]);
    setSelectedWarehouse('');
    setSelectedCourier('');

    try {
      const client = await getShipRocketClient(user?.id || '');
      const [wh, cp] = await Promise.all([client.getWarehouses(), client.getCourierPartners()]);
      setWarehouses(wh);
      const allCouriers = [
        ...(cp?.data?.available_courier_companies || []),
        ...(cp?.data?.shipping_couriers || []),
      ];
      const seen = new Set<number>();
      setCouriers(allCouriers.filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return c.active; }));
      if (wh.length > 0) setSelectedWarehouse(String((wh[0] as any).pickup_location || (wh[0] as any).name));
    } catch (e: any) {
      Alert.alert('Shipping', 'Could not load shipping data. Please try again.');
    }
  }, [user?.id]);

  const handleCreateShipment = useCallback(async () => {
    if (!selectedOrder || !user?.id) return;
    if (!selectedWarehouse) { Alert.alert('Select Warehouse', 'Please select a warehouse.'); return; }

    setCreatingShipment(true);
    try {
      const client = await getShipRocketClient(user.id);
      const items = parseOrderItems(selectedOrder.items);
      const addr = parseAddress(selectedOrder.shippingAddress);

      const shipment = await client.createShipment({
        order_id: selectedOrder.id,
        order_date: new Date().toISOString().replace('T', ' ').slice(0, 16),
        pickup_location: selectedWarehouse,
        billing_customer_name: selectedOrder.buyerName?.split(' ')[0] || 'Customer',
        billing_address: addr.address || addr.street || '',
        billing_city: addr.city || '',
        billing_state: addr.state || '',
        billing_country: addr.country || 'India',
        billing_pincode: addr.pincode || addr.postal_code || addr.zip || '',
        billing_phone: addr.phone || '',
        billing_email: selectedOrder.buyerEmail || '',
        shipping_customer_name: selectedOrder.buyerName || 'Customer',
        shipping_address: addr.address || addr.street || '',
        shipping_city: addr.city || '',
        shipping_state: addr.state || '',
        shipping_country: addr.country || 'India',
        shipping_pincode: addr.pincode || addr.postal_code || addr.zip || '',
        shipping_phone: addr.phone || '',
        shipping_email: selectedOrder.buyerEmail || '',
        order_items: items.map((item: any) => ({
          name: (item as any).productName || (item as any).name || 'Product',
          sku: (item as any).sku || (item as any).productId || 'SKU',
          units: (item as any).quantity || 1,
          selling_price: (item as any).price || 0,
        })),
        payment_method: 'prepaid',
        shipping_charges: selectedOrder.shipping || 0,
        giftwrap_charges: 0,
        transaction_charges: 0,
        total_discount: 0,
        sub_total: selectedOrder.subtotal || selectedOrder.total || 0,
        length: 10,
        breadth: 10,
        height: 10,
        weight: 0.5,
      });

      // Update order with AWB
      await updateOrderStatus(selectedOrder.id, 'shipped', shipment.awb_code || shipment.tracking_id);
      setOrders((prev) => prev.map((o) =>
        o.id === selectedOrder.id ? { ...o, status: 'shipped', trackingNumber: shipment.awb_code || shipment.tracking_id, trackingPartner: shipment.courier_name || '' } : o,
      ));

      Alert.alert('Shipment Created', `AWB: ${shipment.awb_code}\nCourier: ${shipment.courier_name}`);
      setShipmentModal(false);
    } catch (e: any) {
      Alert.alert('Shipment', 'Could not create shipment. Please try again.');
    } finally {
      setCreatingShipment(false);
    }
  }, [selectedOrder, user?.id, selectedWarehouse]);

  // ── Track shipment ───────────────────────────────────────────────────────

  const handleTrackShipment = useCallback(async (order: ShopOrder) => {
    if (!order.trackingNumber) {
      Alert.alert('No Tracking', 'This order does not have a tracking number.');
      return;
    }

    setTrackingLoading(true);
    setTrackingModal(true);
    setTrackingActivities([]);
    setTrackingStatus('');

    try {
      const client = await getShipRocketClient(user?.id || '');
      const result = await client.trackShipment(order.trackingNumber);
      setTrackingStatus(result.current_status || 'Unknown');
      setTrackingActivities([
        ...(result.tracking_history || []),
        ...(result.tracking_activities || []),
      ]);
    } catch (e: any) {
      setTrackingStatus('Failed to track');
      Alert.alert('Tracking', 'Could not track shipment. Please try again.');
    } finally {
      setTrackingLoading(false);
    }
  }, [user?.id]);

  // ── Render order card ────────────────────────────────────────────────────

  const renderOrderCard = ({ item }: { item: ShopOrder }) => {
    const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
    const items = parseOrderItems(item.items);
    const itemsCount = items.reduce((sum, i) => sum + (i.quantity || 1), 0);

    return (
      <TouchableOpacity
        style={styles.orderCard}
        onPress={() => openDetail(item)}
        activeOpacity={0.7}
      >
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

        <View style={styles.orderBody}>
          <View style={styles.detailRow}>
            <Ionicons name="person-outline" size={14} color={colors.textMuted} />
            <Text style={styles.detailText}>{item.buyerName || 'Unknown'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="cube-outline" size={14} color={colors.textMuted} />
            <Text style={styles.detailText}>{itemsCount} item(s)</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
            <Text style={styles.detailText}>{formatOrderDate(item.createdAt)}</Text>
          </View>
        </View>

        <View style={styles.orderFooter}>
          <Text style={styles.orderTotal}>{formatINR(item.total)}</Text>
          {item.trackingNumber ? (
            <View style={styles.trackingRow}>
              <Ionicons name="trail-sign-outline" size={12} color={colors.accent} />
              <Text style={styles.trackingText} numberOfLines={1}>{item.trackingNumber}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  // ── Loading state ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading orders…</Text>
      </SafeAreaView>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order Management</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Filter tabs */}
      <View style={styles.filterContainer}>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.key}
          renderItem={({ item: filter }) => {
            const isActive = activeFilter === filter.key;
            const count = filter.key === 'all' ? orders.length : orders.filter((o) => o.status === filter.key).length;
            return (
              <TouchableOpacity
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => setActiveFilter(filter.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>{filter.label}</Text>
                {count > 0 && (
                  <View style={[styles.filterCount, isActive ? styles.filterCountActive : styles.filterCountInactive]}>
                    <Text style={[styles.filterCountText, isActive && styles.filterCountTextActive]}>{count}</Text>
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
        renderItem={renderOrderCard}
        keyExtractor={(item) => item.id}
        contentContainerStyle={filteredOrders.length === 0 ? styles.emptyList : styles.ordersList}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="cube-outline" size={44} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No {activeFilter === 'all' ? '' : activeFilter + ' '}orders</Text>
            <Text style={styles.emptySubtitle}>Orders will appear here when customers make purchases.</Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      />

      {/* ═══ Order Detail Modal ═══ */}
      <Modal visible={detailModal} animationType="slide" transparent onRequestClose={() => setDetailModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedOrder && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Order Details</Text>
                  <TouchableOpacity onPress={() => setDetailModal(false)}>
                    <Ionicons name="close" size={24} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* Order info */}
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>Order #{selectedOrder.id.slice(0, 8).toUpperCase()}</Text>
                    <View style={styles.detailGrid}>
                      <View style={styles.detailField}>
                        <Text style={styles.detailFieldLabel}>Customer</Text>
                        <Text style={styles.detailFieldValue}>{selectedOrder.buyerName}</Text>
                      </View>
                      <View style={styles.detailField}>
                        <Text style={styles.detailFieldLabel}>Status</Text>
                        <View style={[styles.statusBadge, { backgroundColor: (STATUS_CONFIG[selectedOrder.status] ?? STATUS_CONFIG.pending).bg }]}>
                          <Text style={[styles.statusBadgeText, { color: (STATUS_CONFIG[selectedOrder.status] ?? STATUS_CONFIG.pending).color }]}>
                            {selectedOrder.status.charAt(0).toUpperCase() + selectedOrder.status.slice(1)}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.detailField}>
                        <Text style={styles.detailFieldLabel}>Total</Text>
                        <Text style={[styles.detailFieldValue, { fontWeight: '700', fontSize: 18 }]}>{formatINR(selectedOrder.total)}</Text>
                      </View>
                      <View style={styles.detailField}>
                        <Text style={styles.detailFieldLabel}>Date</Text>
                        <Text style={styles.detailFieldValue}>{formatOrderDate(selectedOrder.createdAt)}</Text>
                      </View>
                    </View>
                  </View>

                  {/* Items */}
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>Items</Text>
                    {parseOrderItems(selectedOrder.items).map((item: any, idx: number) => (
                      <View key={idx} style={styles.itemRow}>
                        <Text style={styles.itemName}>{item.productName || item.name || 'Item'}</Text>
                        <Text style={styles.itemQty}>x{item.quantity}</Text>
                        <Text style={styles.itemPrice}>{formatINR(item.price * item.quantity)}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Shipping address */}
                  {selectedOrder.shippingAddress && (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailSectionTitle}>Shipping Address</Text>
                      {(() => {
                        const addr = parseAddress(selectedOrder.shippingAddress);
                        return (
                          <Text style={styles.addressText}>
                            {[addr.name, addr.address, addr.address_2, `${addr.city}, ${addr.state}`, addr.pincode, addr.country].filter(Boolean).join('\n')}
                          </Text>
                        );
                      })()}
                    </View>
                  )}

                  {/* Tracking */}
                  {selectedOrder.trackingNumber && (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailSectionTitle}>Tracking</Text>
                      <Text style={styles.trackingNumberText}>
                        {selectedOrder.trackingPartner ? `${selectedOrder.trackingPartner}: ` : ''}{selectedOrder.trackingNumber}
                      </Text>
                    </View>
                  )}
                </ScrollView>

                {/* Actions */}
                <View style={styles.modalActions}>
                  {/* Update Status */}
                  {(NEXT_STATUS[selectedOrder.status] || []).map((nextStatus) => (
                    <TouchableOpacity
                      key={nextStatus}
                      style={[
                        styles.actionBtn,
                        nextStatus === 'cancelled' && styles.actionBtnDanger,
                      ]}
                      onPress={() => handleUpdateStatus(selectedOrder.id, nextStatus)}
                      disabled={updatingStatus}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.actionBtnText, nextStatus === 'cancelled' && styles.actionBtnTextDanger]}>
                        {nextStatus === 'cancelled' ? 'Cancel' : `Mark ${nextStatus}`}
                      </Text>
                    </TouchableOpacity>
                  ))}

                  {/* Create Shipment */}
                  {(selectedOrder.status === 'confirmed' || selectedOrder.status === 'processing') && (
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: 'rgba(42, 127, 255, 0.15)', borderColor: 'rgba(42, 127, 255, 0.3)' }]} onPress={() => { setDetailModal(false); openShipmentFlow(selectedOrder); }} activeOpacity={0.7}>
                      <Ionicons name="rocket-outline" size={14} color={colors.accent} />
                      <Text style={[styles.actionBtnText, { color: colors.accent }]}>Create Shipment</Text>
                    </TouchableOpacity>
                  )}

                  {/* Track */}
                  {selectedOrder.trackingNumber && (
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.3)' }]} onPress={() => { setDetailModal(false); handleTrackShipment(selectedOrder); }} activeOpacity={0.7}>
                      <Ionicons name="navigate-outline" size={14} color={colors.accentGreen} />
                      <Text style={[styles.actionBtnText, { color: colors.accentGreen }]}>Track</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ═══ Create Shipment Modal ═══ */}
      <Modal visible={shipmentModal} animationType="fade" transparent onRequestClose={() => setShipmentModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Shipment</Text>
              <TouchableOpacity onPress={() => setShipmentModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>Order: {selectedOrder?.id?.slice(0, 8).toUpperCase()}</Text>

            {/* Warehouse selection */}
            <Text style={styles.selectLabel}>Warehouse</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.selectScroll}>
              {warehouses.map((wh) => (
                <TouchableOpacity
                  key={wh.id}
                  style={[styles.selectChip, selectedWarehouse === (wh.pickup_location || String(wh.id)) && styles.selectChipActive]}
                  onPress={() => setSelectedWarehouse(wh.pickup_location || String(wh.id))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.selectChipText, selectedWarehouse === (wh.pickup_location || String(wh.id)) && styles.selectChipTextActive]}>
                    {wh.name}
                  </Text>
                </TouchableOpacity>
              ))}
              {warehouses.length === 0 && <Text style={styles.emptySmall}>No warehouses configured</Text>}
            </ScrollView>

            {/* Courier selection */}
            <Text style={styles.selectLabel}>Courier</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.selectScroll}>
              {couriers.slice(0, 10).map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.selectChip, selectedCourier === String(c.id) && styles.selectChipActive]}
                  onPress={() => setSelectedCourier(String(c.id))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.selectChipText, selectedCourier === String(c.id) && styles.selectChipTextActive]}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShipmentModal(false)} activeOpacity={0.7}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtn, creatingShipment && styles.btnDisabled]} onPress={handleCreateShipment} disabled={creatingShipment} activeOpacity={0.7}>
                {creatingShipment ? <ActivityIndicator size="small" color={colors.bg} /> : <Text style={styles.primaryBtnText}>Create Shipment</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ═══ Tracking Modal ═══ */}
      <Modal visible={trackingModal} animationType="slide" transparent onRequestClose={() => setTrackingModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Shipment Tracking</Text>
              <TouchableOpacity onPress={() => setTrackingModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {trackingLoading ? (
              <ActivityIndicator size="large" color={colors.accent} style={styles.trackingLoader} />
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {trackingStatus ? (
                  <View style={styles.trackingStatusCard}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} />
                    <Text style={styles.trackingStatusText}>{trackingStatus}</Text>
                  </View>
                ) : null}

                {trackingActivities.length > 0 ? (
                  <View style={styles.timeline}>
                    {trackingActivities.map((activity, idx) => (
                      <View key={idx} style={styles.timelineItem}>
                        <View style={styles.timelineDotWrap}>
                          <View style={[styles.timelineDot, idx === 0 && styles.timelineDotActive]} />
                          {idx < trackingActivities.length - 1 && <View style={styles.timelineLine} />}
                        </View>
                        <View style={styles.timelineContent}>
                          <Text style={styles.timelineStatus}>{activity.status}</Text>
                          <Text style={styles.timelineComments}>{activity.comments}</Text>
                          <Text style={styles.timelineMeta}>{activity.location} {activity.date ? `• ${activity.date}` : ''}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : !trackingLoading ? (
                  <Text style={styles.emptySmall}>No tracking events available.</Text>
                ) : null}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg, gap: 12 },
  loadingText: { fontSize: 14, color: colors.textMuted },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: { padding: 4 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },

  // Filters
  filterContainer: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingTop: 8, paddingBottom: 8 },
  filterList: { paddingHorizontal: 16, gap: 8 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.surfaceLight, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  filterChipTextActive: { color: colors.bg, fontWeight: '600' },
  filterCount: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  filterCountInactive: { backgroundColor: 'rgba(255,255,255,0.08)' },
  filterCountActive: { backgroundColor: colors.bg },
  filterCountText: { fontSize: 10, fontWeight: '700', color: colors.textMuted },
  filterCountTextActive: { color: colors.white },

  // Orders
  ordersList: { padding: 16, paddingBottom: 40 },
  emptyList: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingBottom: 40 },
  orderCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  orderIdRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  orderId: { fontSize: 13, fontWeight: '600', color: colors.text, fontFamily: 'monospace' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  statusBadgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  orderBody: { gap: 5, marginBottom: 10 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailText: { fontSize: 13, color: colors.textSecondary },
  orderFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  orderTotal: { fontSize: 16, fontWeight: '700', color: colors.text },
  trackingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trackingText: { fontSize: 11, color: colors.accent, fontWeight: '500', maxWidth: 140 },

  // Empty state
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyIconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.textSecondary },
  emptySubtitle: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 8, paddingHorizontal: 32, lineHeight: 20 },

  // Modal common
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalContent: { backgroundColor: colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 440, borderWidth: 1, borderColor: colors.border, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  modalDesc: { color: colors.textMuted, fontSize: 13, marginBottom: 16 },
  modalActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 16 },
  modalCancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: 'transparent' },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  primaryBtn: { flex: 1.4, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  btnDisabled: { opacity: 0.4 },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: colors.bg },

  // Detail modal sections
  detailSection: { marginBottom: 20 },
  detailSectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 10 },
  detailGrid: { gap: 10 },
  detailField: { marginBottom: 6 },
  detailFieldLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  detailFieldValue: { fontSize: 14, color: colors.text, fontWeight: '500' },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemName: { flex: 1, fontSize: 13, color: colors.text },
  itemQty: { fontSize: 12, color: colors.textMuted, marginHorizontal: 8 },
  itemPrice: { fontSize: 13, fontWeight: '600', color: colors.text },
  addressText: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  trackingNumberText: { fontSize: 14, color: colors.accent, fontWeight: '600', fontFamily: 'monospace' },

  // Action buttons
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.06)' },
  actionBtnDanger: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)' },
  actionBtnText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  actionBtnTextDanger: { color: colors.error },

  // Shipment modal
  selectLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 12, marginBottom: 6 },
  selectScroll: { marginBottom: 4 },
  selectChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, marginRight: 8 },
  selectChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  selectChipText: { fontSize: 13, color: colors.textSecondary },
  selectChipTextActive: { color: colors.bg, fontWeight: '600' },
  emptySmall: { fontSize: 13, color: colors.textMuted, paddingVertical: 8 },

  // Tracking modal
  trackingLoader: { paddingVertical: 40 },
  trackingStatusCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.2)', marginBottom: 16 },
  trackingStatusText: { fontSize: 15, fontWeight: '600', color: colors.accentGreen },
  timeline: { gap: 0 },
  timelineItem: { flexDirection: 'row', gap: 12, paddingBottom: 20 },
  timelineDotWrap: { alignItems: 'center', width: 16 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.textMuted },
  timelineDotActive: { backgroundColor: colors.accentGreen, width: 14, height: 14 },
  timelineLine: { width: 2, flex: 1, backgroundColor: colors.border, minHeight: 20 },
  timelineContent: { flex: 1, paddingBottom: 4 },
  timelineStatus: { fontSize: 14, fontWeight: '600', color: colors.text },
  timelineComments: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  timelineMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
});
