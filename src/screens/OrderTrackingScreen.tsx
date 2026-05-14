/**
 * OrderTrackingScreen.tsx — Order tracking with stepper timeline
 *
 * Fetches order from Firestore 'orders' collection.
 * Shows vertical stepper, items list, shipping info.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { firestore } from '../lib/firebase';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { ShopOrder, OrderItem } from '../lib/shop';

// ── Types ──────────────────────────────────────────────────────────────────

type OrderStep = 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered';

const ORDER_STEPS: { key: OrderStep; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'processing', label: 'Processing' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function parseItems(itemsStr: string): OrderItem[] {
  try {
    const parsed = JSON.parse(itemsStr);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

function parseAddress(addrStr: string): Record<string, string> {
  try {
    return JSON.parse(addrStr);
  } catch {}
  return {};
}

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function tsToISO(value: unknown): string {
  if (value && typeof value === 'object' && 'seconds' in value) {
    const ts = value as { seconds: number };
    return new Date(ts.seconds * 1000).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return String(value ?? new Date().toISOString());
}

// ── Component ──────────────────────────────────────────────────────────────

export default function OrderTrackingScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { orderId } = route.params;

  const [order, setOrder] = useState<ShopOrder | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadOrder = async () => {
      try {
        const snap = await firestore()
          .collection('orders')
          .doc(orderId)
          .get();

        if (!snap.exists) {
          Alert.alert('Not Found', 'Order not found.');
          navigation.goBack();
          return;
        }

        const d = snap.data()!;
        setOrder({
          id: snap.id,
          buyerId: d.buyerId ?? '',
          buyerName: d.buyerName ?? '',
          buyerEmail: d.buyerEmail ?? '',
          businessId: d.businessId ?? '',
          businessName: d.businessName ?? '',
          items: typeof d.items === 'string' ? d.items : JSON.stringify(d.items ?? []),
          subtotal: d.subtotal ?? 0,
          shipping: d.shipping ?? 0,
          tax: d.tax ?? 0,
          total: d.total ?? 0,
          status: d.status ?? 'pending',
          shippingAddress: typeof d.shippingAddress === 'string'
            ? d.shippingAddress
            : JSON.stringify(d.shippingAddress ?? {}),
          trackingNumber: d.trackingNumber ?? '',
          trackingPartner: d.trackingPartner ?? '',
          notes: d.notes ?? '',
          createdAt: tsToISO(d.createdAt),
          updatedAt: tsToISO(d.updatedAt),
        });
      } catch (err) {
        console.error('[OrderTrackingScreen] loadOrder error:', err);
        Alert.alert('Error', 'Failed to load order details.');
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    };

    loadOrder();
  }, [orderId, navigation]);

  const copyTracking = useCallback(() => {
    if (order?.trackingNumber) {
      Clipboard.setStringAsync(order.trackingNumber);
      Alert.alert('Copied', 'Tracking number copied to clipboard.');
    }
  }, [order]);

  const handleContactSeller = useCallback(() => {
    Alert.alert('Contact Seller', 'Opening chat with seller...');
    // In production: navigate to ChatRoom with business user
  }, []);

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!order) return null;

  const items = parseItems(order.items);
  const address = parseAddress(order.shippingAddress);
  const currentStepIndex = ORDER_STEPS.findIndex(
    (s) => s.key === order.status,
  );
  const isCancelled = order.status === 'cancelled' || order.status === 'refunded';

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        {/* Order ID & date */}
        <View style={styles.orderHeader}>
          <View>
            <Text style={styles.orderIdLabel}>Order ID</Text>
            <Text style={styles.orderIdText}>
              #{order.id.slice(-8).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.orderDate}>
            {formatDate(order.createdAt)}
          </Text>
        </View>

        {/* Status badge */}
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: isCancelled
                ? 'rgba(239, 68, 68, 0.15)'
                : 'rgba(255, 255, 255, 0.15)',
            },
          ]}>
          <Text
            style={[
              styles.statusBadgeText,
              {
                color: isCancelled ? colors.error : colors.primary,
                textTransform: 'capitalize',
              },
            ]}>
            {order.status}
          </Text>
        </View>

        {/* Vertical stepper */}
        <View style={styles.stepperCard}>
          <Text style={styles.sectionTitle}>Order Status</Text>
          <View style={styles.stepper}>
            {ORDER_STEPS.map((step, index) => {
              const isCompleted = index < currentStepIndex;
              const isCurrent = index === currentStepIndex && !isCancelled;
              const isPending = index > currentStepIndex || isCancelled;

              return (
                <View key={step.key} style={styles.stepRow}>
                  {/* Line and dot */}
                  <View style={styles.stepTrack}>
                    <View
                      style={[
                        styles.stepDot,
                        isCompleted && styles.stepDotCompleted,
                        isCurrent && styles.stepDotCurrent,
                      ]}>
                      {isCompleted ? (
                        <Ionicons name="checkmark" size={14} color={colors.white} />
                      ) : isCurrent ? (
                        <View style={styles.stepDotInner} />
                      ) : null}
                    </View>
                    {index < ORDER_STEPS.length - 1 && (
                      <View
                        style={[
                          styles.stepLine,
                          isCompleted && styles.stepLineCompleted,
                        ]}
                      />
                    )}
                  </View>
                  {/* Label */}
                  <Text
                    style={[
                      styles.stepLabel,
                      isCompleted && styles.stepLabelCompleted,
                      isCurrent && styles.stepLabelCurrent,
                      isPending && styles.stepLabelPending,
                    ]}>
                    {step.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Order items */}
        <View style={styles.itemsCard}>
          <Text style={styles.sectionTitle}>Items</Text>
          {items.map((item, i) => (
            <View key={i} style={styles.itemRow}>
              {item.image ? (
                <Image
                  source={{ uri: item.image }}
                  style={styles.itemImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.itemImagePlaceholder}>
                  <Ionicons name="image-outline" size={18} color={colors.textMuted} />
                </View>
              )}
              <View style={styles.itemInfo}>
                <Text style={styles.itemName} numberOfLines={2}>
                  {item.productName}
                </Text>
                <Text style={styles.itemMeta}>
                  Qty: {item.quantity}
                  {item.variant ? ` · ${item.variant}` : ''}
                </Text>
              </View>
              <Text style={styles.itemPrice}>{formatINR(item.price * item.quantity)}</Text>
            </View>
          ))}
        </View>

        {/* Shipping address */}
        <View style={styles.addressCard}>
          <Text style={styles.sectionTitle}>Shipping Address</Text>
          <Text style={styles.addressText}>
            {address.name ?? 'N/A'}
            {'\n'}
            {address.address ?? ''}{'\n'}
            {[address.city, address.state, address.pincode].filter(Boolean).join(', ')}
            {'\n'}
            {address.phone ?? ''}
          </Text>
        </View>

        {/* Tracking info */}
        {(order.trackingNumber || order.trackingPartner) && (
          <View style={styles.trackingCard}>
            <Text style={styles.sectionTitle}>Tracking Info</Text>
            {order.trackingPartner && (
              <View style={styles.trackingRow}>
                <Text style={styles.trackingLabel}>Shipping Partner</Text>
                <Text style={styles.trackingValue}>{order.trackingPartner}</Text>
              </View>
            )}
            {order.trackingNumber && (
              <View style={styles.trackingRow}>
                <Text style={styles.trackingLabel}>Tracking Number</Text>
                <TouchableOpacity
                  onPress={copyTracking}
                  style={styles.trackingNumberRow}>
                  <Text style={styles.trackingValue}>
                    {order.trackingNumber}
                  </Text>
                  <Ionicons
                    name="copy-outline"
                    size={16}
                    color={colors.primary}
                    style={{ marginLeft: 8 }}
                  />
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Total amount */}
        <View style={styles.totalCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>{formatINR(order.subtotal)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Shipping</Text>
            <Text style={styles.totalValue}>
              {order.shipping > 0 ? formatINR(order.shipping) : 'Free'}
            </Text>
          </View>
          {order.tax > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax</Text>
              <Text style={styles.totalValue}>{formatINR(order.tax)}</Text>
            </View>
          )}
          <View style={[styles.totalRow, styles.totalFinalRow]}>
            <Text style={styles.totalFinalLabel}>Total</Text>
            <Text style={styles.totalFinalValue}>{formatINR(order.total)}</Text>
          </View>
        </View>

        {/* Contact seller */}
        <TouchableOpacity
          style={styles.contactBtn}
          onPress={handleContactSeller}
          activeOpacity={0.7}>
          <Ionicons name="chatbubble-outline" size={20} color={colors.white} />
          <Text style={styles.contactBtnText}>Contact Seller</Text>
        </TouchableOpacity>
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
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  // Order header
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  orderIdLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 2,
  },
  orderIdText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  orderDate: {
    fontSize: 13,
    color: colors.textMuted,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    marginBottom: 20,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Section title
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 14,
  },
  // Stepper card
  stepperCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepper: {
    gap: 0,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
  },
  stepTrack: {
    flexDirection: 'column',
    alignItems: 'center',
    width: 28,
    marginRight: 14,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepDotCompleted: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  stepDotCurrent: {
    backgroundColor: colors.background,
    borderColor: colors.primary,
  },
  stepDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  stepLine: {
    width: 2,
    height: 16,
    backgroundColor: colors.border,
  },
  stepLineCompleted: {
    backgroundColor: colors.primary,
  },
  stepLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  stepLabelCompleted: {
    color: colors.primary,
  },
  stepLabelCurrent: {
    color: colors.text,
    fontWeight: '700',
  },
  stepLabelPending: {
    color: colors.textMuted,
  },
  // Items
  itemsCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemImage: {
    width: 52,
    height: 52,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: colors.surfaceLight,
  },
  itemImagePlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 8,
    marginRight: 12,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemInfo: {
    flex: 1,
    marginRight: 12,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    lineHeight: 18,
  },
  itemMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  // Address
  addressCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addressText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  // Tracking
  trackingCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  trackingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  trackingLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
  trackingValue: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
  },
  trackingNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Total
  totalCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  totalLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  totalValue: {
    fontSize: 14,
    color: colors.text,
  },
  totalFinalRow: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalFinalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  totalFinalValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
  // Contact button
  contactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  contactBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
  },
});
