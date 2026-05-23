import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../lib/firebase';
import { fetchCart, updateCartItemQuantity, removeFromCart, CartItem } from '../lib/api';
import { colors } from '../theme/colors';

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

export default function CartScreen({ route, navigation }: any) {
  const currentUser = auth()?.currentUser;
  const userId = currentUser?.uid;
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  const loadCart = useCallback(
    async (silent = false) => {
      if (!userId) return;
      if (!silent) setLoading(true);
      try {
        const items = await fetchCart(userId);
        setCartItems(items);
      } catch (e) {
        console.error('[Cart] Failed to load cart:', e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    loadCart();
  }, [loadCart]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadCart(true);
  }, [loadCart]);

  const subtotal = useMemo(() => {
    return cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }, [cartItems]);

  const totalItems = useMemo(() => {
    return cartItems.reduce((sum, item) => sum + item.quantity, 0);
  }, [cartItems]);

  const handleQuantityChange = async (productId: string, delta: number) => {
    const item = cartItems.find((i) => i.productId === productId);
    if (!item) return;
    const newQty = item.quantity + delta;
    if (newQty < 1) return;

    setUpdating(productId);
    try {
      await updateCartItemQuantity(userId!, productId, newQty);
      setCartItems((prev) =>
        prev.map((i) => (i.productId === productId ? { ...i, quantity: newQty } : i)),
      );
    } catch (e) {
      console.error('[Cart] Failed to update quantity:', e);
      Alert.alert('Error', 'Failed to update quantity.');
    } finally {
      setUpdating(null);
    }
  };

  const handleRemove = (productId: string) => {
    Alert.alert('Remove Item', 'Remove this item from your cart?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setUpdating(productId);
          try {
            await removeFromCart(userId!, productId);
            setCartItems((prev) => prev.filter((i) => i.productId !== productId));
          } catch (e) {
            console.error('[Cart] Failed to remove:', e);
          } finally {
            setUpdating(null);
          }
        },
      },
    ]);
  };

  const handleProceed = () => {
    if (cartItems.length === 0) {
      Alert.alert('Cart Empty', 'Add items to your cart first.');
      return;
    }
    const checkoutItems = cartItems.map((item) => ({
      id: item.productId,
      productId: item.productId,
      name: item.name,
      price: item.price,
      image: item.image,
      quantity: item.quantity,
    }));
    navigation.navigate('Checkout', { cartItems: checkoutItems, subtotal });
  };

  const renderItem = ({ item }: { item: CartItem }) => {
    const isUpdating = updating === item.productId;

    return (
      <View style={styles.cartItem}>
        <TouchableOpacity
          onPress={() => navigation.navigate('ProductDetail', { productId: item.productId })}
          activeOpacity={0.7}
        >
          {item.image ? (
            <Image source={{ uri: item.image }} style={styles.itemImage} resizeMode="cover" />
          ) : (
            <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
              <Ionicons name="cube-outline" size={28} color={colors.textMuted} />
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.itemDetails}>
          <TouchableOpacity
            onPress={() => navigation.navigate('ProductDetail', { productId: item.productId })}
            activeOpacity={0.7}
          >
            <Text style={styles.itemName} numberOfLines={2}>
              {item.name}
            </Text>
          </TouchableOpacity>
          <Text style={styles.itemOwner}>{item.ownerName}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.itemPrice}>{formatINR(item.price)}</Text>
            {item.comparePrice && item.comparePrice > item.price && (
              <Text style={styles.itemComparePrice}>{formatINR(item.comparePrice)}</Text>
            )}
          </View>
        </View>

        <View style={styles.itemActions}>
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={() => handleRemove(item.productId)}
            disabled={isUpdating}
          >
            <Ionicons name="close" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.qtyRow}>
            <TouchableOpacity
              style={[styles.qtyBtn, item.quantity <= 1 && { opacity: 0.3 }]}
              onPress={() => handleQuantityChange(item.productId, -1)}
              disabled={item.quantity <= 1 || isUpdating}
            >
              {isUpdating ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Ionicons name="remove" size={16} color={colors.text} />
              )}
            </TouchableOpacity>
            <Text style={styles.qtyValue}>{item.quantity}</Text>
            <TouchableOpacity
              style={styles.qtyBtn}
              onPress={() => handleQuantityChange(item.productId, 1)}
              disabled={isUpdating}
            >
              {isUpdating ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Ionicons name="add" size={16} color={colors.text} />
              )}
            </TouchableOpacity>
          </View>
          <Text style={styles.itemTotal}>{formatINR(item.price * item.quantity)}</Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#e7e9ea" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Cart</Text>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{totalItems}</Text>
          </View>
        </View>
      </SafeAreaView>

      {cartItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="cart-outline" size={60} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptySubtitle}>
            Browse stores and add products to get started.
          </Text>
          <TouchableOpacity
            style={styles.shopBtn}
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                navigation.navigate('Drawer', { screen: 'MainTabs', params: { screen: 'Home' } });
              }
            }}
          >
            <Text style={styles.shopBtnText}>Browse Products</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <FlatList
            data={cartItems}
            keyExtractor={(item) => item.productId}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.accent}
              />
            }
          />

          <SafeAreaView edges={['bottom']}>
            <View style={styles.bottomBar}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryInfo}>
                  <Text style={styles.summaryLabel}>
                    Subtotal ({totalItems} {totalItems === 1 ? 'item' : 'items'})
                  </Text>
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
  container: { flex: 1, backgroundColor: '#000000' },
  centerContent: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#e7e9ea',
    fontWeight: '700',
    fontSize: 18,
    flex: 1,
    textAlign: 'center',
  },
  headerBadge: {
    backgroundColor: colors.accent,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  listContent: { padding: 16 },
  separator: { height: 0.5, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 4 },
  cartItem: { flexDirection: 'row', gap: 12, paddingVertical: 8 },
  itemImage: { width: 88, height: 88, borderRadius: 10, backgroundColor: '#000000' },
  itemImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  itemDetails: { flex: 1, justifyContent: 'center' },
  itemName: { color: '#e7e9ea', fontSize: 15, fontWeight: '600', lineHeight: 21, marginBottom: 2 },
  itemOwner: { color: '#71767b', fontSize: 12, marginBottom: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemPrice: { color: '#94a3b8', fontSize: 14 },
  itemComparePrice: { color: '#71767b', fontSize: 12, textDecorationLine: 'line-through' },
  itemActions: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    minWidth: 90,
  },
  removeBtn: { padding: 4 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16181c',
  },
  qtyValue: {
    color: '#e7e9ea',
    fontSize: 15,
    fontWeight: '700',
    minWidth: 24,
    textAlign: 'center',
  },
  itemTotal: { color: '#e7e9ea', fontSize: 15, fontWeight: '700', marginTop: 4 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyTitle: { color: '#e7e9ea', fontSize: 20, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  emptySubtitle: {
    color: '#94a3b8',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  shopBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 24,
  },
  shopBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  bottomBar: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 16,
  },
  summaryInfo: { flex: 1 },
  summaryLabel: { color: '#94a3b8', fontSize: 13, marginBottom: 2 },
  summaryTotal: { color: '#e7e9ea', fontSize: 20, fontWeight: '800' },
  checkoutBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 24,
  },
  checkoutBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
