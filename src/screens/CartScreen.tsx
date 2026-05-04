import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  FlatList,
  Alert,
} from 'react-native';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis, parseMediaUrls } from '../lib/api';
import { User, Post } from '../lib/api';

interface CartItem {
  id: string;
  productId: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  variant?: string;
}

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

// Sample cart items — in production this would come from Zustand cartStore or async storage
const SAMPLE_CART: CartItem[] = [
  {
    id: 'c1',
    productId: 'demo1',
    name: 'Premium Black Hoodie',
    price: 2499,
    image: '',
    quantity: 1,
    variant: 'Large',
  },
  {
    id: 'c2',
    productId: 'demo2',
    name: 'Black94 Logo Tee',
    price: 999,
    image: '',
    quantity: 2,
    variant: 'Medium',
  },
];

export default function CartScreen({ route, navigation }: any) {
  const [cartItems, setCartItems] = useState<CartItem[]>(SAMPLE_CART);

  const subtotal = useMemo(() => {
    return cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }, [cartItems]);

  const totalItems = useMemo(() => {
    return cartItems.reduce((sum, item) => sum + item.quantity, 0);
  }, [cartItems]);

  const handleQuantityChange = (itemId: string, delta: number) => {
    setCartItems(prev =>
      prev.map(item => {
        if (item.id !== itemId) return item;
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty };
      }),
    );
  };

  const handleRemove = (itemId: string) => {
    Alert.alert('Remove Item', 'Remove this item from your cart?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => setCartItems(prev => prev.filter(i => i.id !== itemId)) },
    ]);
  };

  const handleProceed = () => {
    if (cartItems.length === 0) {
      Alert.alert('Cart Empty', 'Add items to your cart first.');
      return;
    }
    navigation.navigate('Checkout', { cartItems, subtotal });
  };

  const renderItem = ({ item }: { item: CartItem }) => (
    <View style={styles.cartItem}>
      {/* Image */}
      <TouchableOpacity
        onPress={() => navigation.navigate('ProductDetail', { productId: item.productId })}
        activeOpacity={0.7}
      >
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.itemImage} resizeMode="cover" />
        ) : (
          <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
            <Text style={{ color: colors.textMuted, fontSize: 24 }}>📦</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Details */}
      <View style={styles.itemDetails}>
        <TouchableOpacity
          onPress={() => navigation.navigate('ProductDetail', { productId: item.productId })}
          activeOpacity={0.7}
        >
          <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
        </TouchableOpacity>
        {item.variant && (
          <Text style={styles.itemVariant}>{item.variant}</Text>
        )}
        <Text style={styles.itemPrice}>{formatINR(item.price)}</Text>
      </View>

      {/* Quantity + Remove */}
      <View style={styles.itemActions}>
        <TouchableOpacity
          style={styles.removeBtn}
          onPress={() => handleRemove(item.id)}
        >
          <Text style={styles.removeIcon}>✕</Text>
        </TouchableOpacity>
        <View style={styles.qtyRow}>
          <TouchableOpacity
            style={[styles.qtyBtn, item.quantity <= 1 && { opacity: 0.3 }]}
            onPress={() => handleQuantityChange(item.id, -1)}
            disabled={item.quantity <= 1}
          >
            <Text style={styles.qtyBtnText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.qtyValue}>{item.quantity}</Text>
          <TouchableOpacity
            style={styles.qtyBtn}
            onPress={() => handleQuantityChange(item.id, 1)}
          >
            <Text style={styles.qtyBtnText}>+</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.itemTotal}>{formatINR(item.price * item.quantity)}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Cart</Text>
          <Text style={styles.headerCount}>{totalItems}</Text>
        </View>
      </SafeAreaView>

      {cartItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🛒</Text>
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptySubtitle}>Browse stores and add products to get started.</Text>
          <TouchableOpacity
            style={styles.shopBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.shopBtnText}>Start Shopping</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <FlatList
            data={cartItems}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />

          {/* Subtotal + Checkout */}
          <SafeAreaView edges={['bottom']}>
            <View style={styles.bottomBar}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryInfo}>
                  <Text style={styles.summaryLabel}>Subtotal ({totalItems} {totalItems === 1 ? 'item' : 'items'})</Text>
                  <Text style={styles.summaryTotal}>{formatINR(subtotal)}</Text>
                </View>
                <TouchableOpacity style={styles.checkoutBtn} onPress={handleProceed}>
                  <Text style={styles.checkoutBtnText}>Proceed to Checkout</Text>
                </TouchableOpacity>
              </View>
            </View>
          </SafeAreaView>
        </>
      )}
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
  headerCount: {
    color: '#fff', fontSize: 12, fontWeight: '700',
    backgroundColor: colors.accent, width: 24, height: 24, borderRadius: 12,
    textAlign: 'center', lineHeight: 24, textAlignVertical: 'center',
  },
  listContent: { padding: 16 },
  separator: { height: 0.5, backgroundColor: colors.border, marginVertical: 4 },
  cartItem: { flexDirection: 'row', gap: 12, paddingVertical: 8 },
  itemImage: { width: 88, height: 88, borderRadius: 10, backgroundColor: '#1a1a1a' },
  itemImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  itemDetails: { flex: 1, justifyContent: 'center' },
  itemName: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 21, marginBottom: 2 },
  itemVariant: { color: colors.textSecondary, fontSize: 13, marginBottom: 2 },
  itemPrice: { color: colors.textSecondary, fontSize: 14 },
  itemActions: { justifyContent: 'space-between', alignItems: 'flex-end', minWidth: 90 },
  removeBtn: { padding: 4 },
  removeIcon: { color: colors.textSecondary, fontSize: 16 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  qtyBtnText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  qtyValue: { color: colors.text, fontSize: 15, fontWeight: '700', minWidth: 24, textAlign: 'center' },
  itemTotal: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 4 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyIcon: { fontSize: 60, marginBottom: 16 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { color: colors.textSecondary, fontSize: 15, textAlign: 'center', marginBottom: 24, lineHeight: 22 },
  shopBtn: {
    backgroundColor: colors.accent, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 24,
  },
  shopBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  bottomBar: {
    borderTopWidth: 0.5, borderTopColor: colors.border, backgroundColor: colors.bg,
  },
  summaryRow: {
    flexDirection: 'row', alignItems: 'center', padding: 16, gap: 16,
  },
  summaryInfo: { flex: 1 },
  summaryLabel: { color: colors.textSecondary, fontSize: 13, marginBottom: 2 },
  summaryTotal: { color: colors.text, fontSize: 20, fontWeight: '800' },
  checkoutBtn: {
    backgroundColor: colors.accent, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 24,
  },
  checkoutBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
