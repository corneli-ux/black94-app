import React, { useState, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, TextInput, Alert, KeyboardAvoidingView, Platform, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis, parseMediaUrls } from '../lib/api';
import { User, Post } from '../lib/api';

const SHIPPING_PARTNERS = [
  { id: 'standard', name: 'Standard Shipping', price: 99, days: '5-7 days' },
  { id: 'express', name: 'Express Shipping', price: 199, days: '2-3 days' },
  { id: 'overnight', name: 'Overnight Delivery', price: 349, days: 'Next day' },
  { id: 'free', name: 'Free Shipping', price: 0, days: '7-10 days' },
];

interface CartItem {
  id: string;
  productId: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  variant?: string;
}

interface ShippingForm {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
}

const INITIAL_SHIPPING: ShippingForm = {
  fullName: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  pincode: '',
};

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

export default function CheckoutScreen({ route, navigation }: any) {
  const passedCart: CartItem[] = route?.params?.cartItems || [];
  const passedSubtotal: number = route?.params?.subtotal || 0;

  // Cart items must be passed from navigation params (from CartScreen)
  const [cartItems] = useState<CartItem[]>(passedCart);

  // Redirect to cart if no items passed
  useEffect(() => {
    if (passedCart.length === 0) {
      Alert.alert('Empty Cart', 'Your cart is empty. Add items before checking out.', [
        { text: 'Go to Cart', onPress: () => navigation.navigate('Cart') },
      ]);
    }
  }, [passedCart, navigation]);

  const [shippingForm, setShippingForm] = useState<ShippingForm>(INITIAL_SHIPPING);
  const [selectedPartner, setSelectedPartner] = useState(SHIPPING_PARTNERS[0]);
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'prepaid'>('prepaid');
  const [placingOrder, setPlacingOrder] = useState(false);

  const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shippingCost = selectedPartner.price;
  const total = subtotal + shippingCost;

  const updateShippingField = (key: keyof ShippingForm, value: string) => {
    setShippingForm(prev => ({ ...prev, [key]: value }));
  };

  const validateShipping = (): boolean => {
    if (!shippingForm.fullName.trim()) { Alert.alert('Required', 'Please enter your full name.'); return false; }
    if (!shippingForm.phone.trim() || shippingForm.phone.length < 10) {
      Alert.alert('Required', 'Please enter a valid phone number.');
      return false;
    }
    if (!shippingForm.addressLine1.trim()) { Alert.alert('Required', 'Please enter your address.'); return false; }
    if (!shippingForm.city.trim()) { Alert.alert('Required', 'Please enter your city.'); return false; }
    if (!shippingForm.state.trim()) { Alert.alert('Required', 'Please enter your state.'); return false; }
    if (!shippingForm.pincode.trim() || shippingForm.pincode.length < 6) {
      Alert.alert('Required', 'Please enter a valid pincode.');
      return false;
    }
    return true;
  };

  const handlePlaceOrder = async () => {
    if (!validateShipping()) return;
    if (cartItems.length === 0) {
      Alert.alert('Error', 'No items in cart.');
      return;
    }

    setPlacingOrder(true);
    try {
      const currentUser = auth()?.currentUser;
      const orderData: Record<string, any> = {
        userId: currentUser?.uid || 'anonymous',
        items: cartItems.map(item => ({
          productId: item.productId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          variant: item.variant || null,
        })),
        shippingAddress: { ...shippingForm },
        shippingPartner: selectedPartner.id,
        shippingCost,
        subtotal,
        total,
        paymentMethod,
        status: 'placed',
        createdAt: firestore.FieldValue.serverTimestamp(),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      };

      await firestore().collection('orders').add(orderData);

      Alert.alert(
        'Order Placed! 🎉',
        `Your order of ${formatINR(total)} has been placed successfully. You'll receive updates on your order status.`,
        [
          {
            text: 'OK',
            onPress: () => navigation.navigate('Cart'),
          },
        ],
      );
    } catch (e: any) {
      console.error('[Checkout] Place order error:', e);
      Alert.alert('Order', 'Could not place order. Please try again.');
    } finally {
      setPlacingOrder(false);
    }
  };

  const inputProps = {
    style: styles.input,
    placeholderTextColor: colors.textSecondary,
    autoCapitalize: 'none' as const,
    autoCorrect: false,
  };

  return (
    <View style={styles.container}>
      {/* Minimal Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Checkout</Text>
          <View style={{ width: 36 }} />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Shipping Address */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Shipping Address</Text>

            <TextInput
              {...inputProps}
              placeholder="Full Name *"
              value={shippingForm.fullName}
              onChangeText={v => updateShippingField('fullName', v)}
              autoCapitalize="words"
            />
            <View style={styles.fieldSpacer} />

            <TextInput
              {...inputProps}
              placeholder="Phone Number *"
              value={shippingForm.phone}
              onChangeText={v => updateShippingField('phone', v.replace(/[^0-9+]/g, ''))}
              keyboardType="phone-pad"
              maxLength={15}
            />
            <View style={styles.fieldSpacer} />

            <TextInput
              {...inputProps}
              placeholder="Address Line 1 *"
              value={shippingForm.addressLine1}
              onChangeText={v => updateShippingField('addressLine1', v)}
            />
            <View style={styles.fieldSpacer} />

            <TextInput
              {...inputProps}
              placeholder="Address Line 2 (optional)"
              value={shippingForm.addressLine2}
              onChangeText={v => updateShippingField('addressLine2', v)}
            />
            <View style={styles.rowGroup}>
              <TextInput
                {...inputProps}
                style={[styles.input, styles.inputHalf]}
                placeholder="City *"
                value={shippingForm.city}
                onChangeText={v => updateShippingField('city', v)}
                autoCapitalize="words"
              />
              <TextInput
                {...inputProps}
                style={[styles.input, styles.inputHalf]}
                placeholder="State *"
                value={shippingForm.state}
                onChangeText={v => updateShippingField('state', v)}
                autoCapitalize="words"
              />
            </View>
            <View style={styles.fieldSpacer} />

            <TextInput
              {...inputProps}
              placeholder="Pincode *"
              value={shippingForm.pincode}
              onChangeText={v => updateShippingField('pincode', v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={6}
            />
          </View>

          {/* Shipping Partner */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Shipping Method</Text>
            {SHIPPING_PARTNERS.map(partner => (
              <TouchableOpacity
                key={partner.id}
                style={[styles.partnerCard, selectedPartner.id === partner.id && styles.partnerCardActive]}
                onPress={() => setSelectedPartner(partner)}
              >
                <View style={styles.partnerRadio}>
                  <View style={[styles.radioOuter, selectedPartner.id === partner.id && styles.radioOuterActive]}>
                    {selectedPartner.id === partner.id && <View style={styles.radioInner} />}
                  </View>
                </View>
                <View style={styles.partnerInfo}>
                  <Text style={styles.partnerName}>{partner.name}</Text>
                  <Text style={styles.partnerDays}>{partner.days}</Text>
                </View>
                <Text style={styles.partnerPrice}>
                  {partner.price === 0 ? 'FREE' : formatINR(partner.price)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Order Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Order Summary</Text>
            <View style={styles.summaryCard}>
              {cartItems.map(item => (
                <View key={item.id} style={styles.summaryItem}>
                  <View style={styles.summaryItemLeft}>
                    <Text style={styles.summaryItemName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.summaryItemQty}>
                      {item.quantity}x{item.variant ? ` ${item.variant}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.summaryItemPrice}>{formatINR(item.price * item.quantity)}</Text>
                </View>
              ))}
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryRowLabel}>Subtotal</Text>
                <Text style={styles.summaryRowValue}>{formatINR(subtotal)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryRowLabel}>Shipping</Text>
                <Text style={styles.summaryRowValue}>
                  {shippingCost === 0 ? 'FREE' : formatINR(shippingCost)}
                </Text>
              </View>
              <View style={[styles.summaryDivider, { marginTop: 0 }]} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryTotalLabel}>Total</Text>
                <Text style={styles.summaryTotalValue}>{formatINR(total)}</Text>
              </View>
            </View>
          </View>

          {/* Payment Method */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Payment Method</Text>
            <View style={styles.paymentRow}>
              <TouchableOpacity
                style={[styles.paymentOption, paymentMethod === 'prepaid' && styles.paymentOptionActive]}
                onPress={() => setPaymentMethod('prepaid')}
              >
                <View style={[styles.radioOuter, paymentMethod === 'prepaid' && styles.radioOuterActive]}>
                  {paymentMethod === 'prepaid' && <View style={styles.radioInner} />}
                </View>
                <View style={{ marginLeft: 10 }}>
                  <Text style={styles.paymentLabel}>Prepaid</Text>
                  <Text style={styles.paymentHint}>Pay online via UPI/Card/Net Banking</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.paymentOption, paymentMethod === 'cod' && styles.paymentOptionActive]}
                onPress={() => setPaymentMethod('cod')}
              >
                <View style={[styles.radioOuter, paymentMethod === 'cod' && styles.radioOuterActive]}>
                  {paymentMethod === 'cod' && <View style={styles.radioInner} />}
                </View>
                <View style={{ marginLeft: 10 }}>
                  <Text style={styles.paymentLabel}>Cash on Delivery</Text>
                  <Text style={styles.paymentHint}>Pay when you receive your order</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* Place Order Button */}
          <TouchableOpacity
            style={[styles.placeOrderBtn, placingOrder && { opacity: 0.6 }]}
            onPress={handlePlaceOrder}
            disabled={placingOrder}
          >
            {placingOrder ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.placeOrderBtnText}>Place Order</Text>
                <Text style={styles.placeOrderBtnTotal}>{formatINR(total)}</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: colors.text, fontSize: 22 },
  headerTitle: { color: colors.text, fontWeight: '700', fontSize: 18, flex: 1, textAlign: 'center' },
  scrollContent: { paddingHorizontal: 16, paddingTop: 20 },
  section: { marginBottom: 24 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 12 },
  input: {
    backgroundColor: colors.bgInput, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 13,
    color: colors.text, fontSize: 15,
    borderWidth: 1, borderColor: colors.border,
  },
  inputHalf: { flex: 1 },
  fieldSpacer: { height: 10 },
  rowGroup: { flexDirection: 'row', gap: 10 },
  partnerCard: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    marginBottom: 8,
  },
  partnerCardActive: { borderColor: colors.accent, backgroundColor: 'rgba(29,155,240,0.06)' },
  partnerRadio: { width: 30 },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOuterActive: { borderColor: colors.accent },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  partnerInfo: { flex: 1, marginLeft: 6 },
  partnerName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  partnerDays: { color: colors.textSecondary, fontSize: 13, marginTop: 1 },
  partnerPrice: { color: colors.text, fontSize: 15, fontWeight: '700' },
  summaryCard: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  summaryItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  summaryItemLeft: { flex: 1, marginRight: 12 },
  summaryItemName: { color: colors.text, fontSize: 14, fontWeight: '500' },
  summaryItemQty: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  summaryItemPrice: { color: colors.text, fontSize: 14, fontWeight: '600' },
  summaryDivider: { height: 0.5, backgroundColor: colors.border, marginVertical: 10 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  summaryRowLabel: { color: colors.textSecondary, fontSize: 14 },
  summaryRowValue: { color: colors.text, fontSize: 14 },
  summaryTotalLabel: { color: colors.text, fontSize: 16, fontWeight: '700' },
  summaryTotalValue: { color: colors.accent, fontSize: 18, fontWeight: '800' },
  paymentRow: { gap: 8 },
  paymentOption: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    borderRadius: 10, borderWidth: 1, borderColor: colors.border,
  },
  paymentOptionActive: { borderColor: colors.accent, backgroundColor: 'rgba(29,155,240,0.06)' },
  paymentLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  paymentHint: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  placeOrderBtn: {
    backgroundColor: colors.accent, paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
    flexDirection: 'row', gap: 10,
  },
  placeOrderBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  placeOrderBtnTotal: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
