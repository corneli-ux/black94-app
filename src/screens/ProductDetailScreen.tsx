import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Dimensions, Alert, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis, parseMediaUrls } from '../lib/api';
import { User } from '../lib/api';

const { width: SCREEN_W } = Dimensions.get('window');

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  compareAtPrice?: number;
  images: string[];
  rating: number;
  soldCount: number;
  category: string;
  ownerId: string;
  ownerName: string;
  ownerUsername: string;
  ownerAvatar: string | null;
  active: boolean;
  featured: boolean;
  stock: number;
  sku: string;
  variants: string[];
  tags: string[];
  createdAt: number;
}

interface CartItem {
  productId: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  variant?: string;
}

function StarRating({ rating, size = 14 }: { rating: number; size?: number }) {
  const full = Math.floor(rating);
  const hasHalf = rating - full >= 0.5;
  const stars: string[] = [];
  for (let i = 0; i < 5; i++) {
    if (i < full) stars.push('★');
    else if (i === full && hasHalf) stars.push('★');
    else stars.push('☆');
  }
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {stars.map((s, i) => (
        <Text key={i} style={{ color: colors.accentGold, fontSize: size }}>{s}</Text>
      ))}
    </View>
  );
}

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

export default function ProductDetailScreen({ route, navigation }: any) {
  const { productId } = route.params;
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [selectedVariant, setSelectedVariant] = useState<string>('');
  const [quantity, setQuantity] = useState(1);
  const [addingToCart, setAddingToCart] = useState(false);

  const load = useCallback(async () => {
    try {
      const docSnap = await firestore().collection('products').doc(productId).get();
      if (!docSnap.exists) {
        Alert.alert('Not Found', 'This product does not exist.');
        navigation.goBack();
        return;
      }

      const d = docSnap.data();
      const imgs = parseMediaUrls(d.images || d.imageUrls || d.mediaUrls);

      // Fetch owner info
      let ownerName = '';
      let ownerUsername = '';
      let ownerAvatar: string | null = null;
      try {
        const ownerSnap = await firestore().collection('users').doc(d.ownerId).get();
        if (ownerSnap.exists) {
          const od = ownerSnap.data();
          ownerName = od?.displayName || '';
          ownerUsername = od?.username || '';
          ownerAvatar = od?.profileImage || null;
        }
      } catch {}

      const p: Product = {
        id: docSnap.id,
        name: d.name || d.title || 'Product',
        description: d.description || '',
        price: d.price || 0,
        compareAtPrice: d.compareAtPrice || d.comparePrice || undefined,
        images: imgs,
        rating: d.rating || d.averageRating || 0,
        soldCount: d.soldCount || d.sold || 0,
        category: d.category || '',
        ownerId: d.ownerId || '',
        ownerName,
        ownerUsername,
        ownerAvatar,
        active: d.active !== false,
        featured: d.featured || false,
        stock: d.stock ?? d.stockQuantity ?? 0,
        sku: d.sku || '',
        variants: d.variants || [],
        tags: d.tags || [],
        createdAt: tsToMillis(d.createdAt),
      };
      setProduct(p);

      if (p.variants && p.variants.length > 0) {
        setSelectedVariant(p.variants[0]);
      }
    } catch (e) {
      console.error('[ProductDetail] Load error:', e);
      Alert.alert('Error', 'Failed to load product.');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { load(); }, []);

  const handleAddToCart = async () => {
    const currentUser = auth()?.currentUser;
    if (!currentUser || !product) return;
    setAddingToCart(true);
    try {
      const cartRef = firestore().collection('carts').doc(currentUser.uid);
      const cartSnap = await cartRef.get();
      const cartItem = {
        productId: product.id,
        name: product.name,
        price: product.price,
        image: product.images[0] || '',
        quantity,
        variant: selectedVariant || '',
      };

      if (cartSnap.exists) {
        const cartData = cartSnap.data();
        const items: any[] = cartData.items || [];
        const existingIndex = items.findIndex(
          (i: any) => i.productId === product.id && (i.variant || '') === (selectedVariant || ''),
        );
        if (existingIndex >= 0) {
          items[existingIndex].quantity += quantity;
        } else {
          items.push(cartItem);
        }
        await cartRef.update({
          items,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });
      } else {
        await cartRef.set({
          items: [cartItem],
          createdAt: firestore.FieldValue.serverTimestamp(),
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });
      }

      Alert.alert('Added to Cart', `${product.name} (${quantity}x${selectedVariant ? ` ${selectedVariant}` : ''}) added to your cart.`, [
        { text: 'Continue Shopping', style: 'cancel' },
        { text: 'View Cart', onPress: () => navigation.navigate('Cart') },
      ]);
    } catch (e) {
      console.error('[ProductDetail] Add to cart error:', e);
      Alert.alert('Error', 'Failed to add to cart. Please try again.');
    } finally {
      setAddingToCart(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!product) return null;

  const discount = product.compareAtPrice && product.compareAtPrice > product.price
    ? Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100)
    : 0;

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Product Details</Text>
          <View style={{ width: 36 }} />
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Image Carousel */}
        {product.images.length > 0 ? (
          <View>
            <Image
              source={{ uri: product.images[activeImageIndex] }}
              style={styles.mainImage}
              resizeMode="cover"
            />
            {product.images.length > 1 && (
              <View style={styles.imagePagination}>
                {product.images.map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.paginationDot,
                      i === activeImageIndex && styles.paginationDotActive,
                    ]}
                  />
                ))}
              </View>
            )}
            {product.images.length > 1 && (
              <View style={styles.thumbnailRow}>
                {product.images.map((img, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => setActiveImageIndex(i)}
                    style={[
                      styles.thumbnail,
                      i === activeImageIndex && styles.thumbnailActive,
                    ]}
                  >
                    <Image source={{ uri: img }} style={styles.thumbnailImg} resizeMode="cover" />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.mainImage, styles.noImage]}>
            <Text style={{ color: colors.textMuted, fontSize: 48 }}>📦</Text>
          </View>
        )}

        {/* Product Info */}
        <View style={styles.body}>
          {/* Name + Price */}
          <Text style={styles.productName}>{product.name}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{formatINR(product.price)}</Text>
            {product.compareAtPrice && product.compareAtPrice > product.price && (
              <>
                <Text style={styles.comparePrice}>{formatINR(product.compareAtPrice)}</Text>
                <View style={styles.discountBadge}>
                  <Text style={styles.discountText}>{discount}% OFF</Text>
                </View>
              </>
            )}
          </View>

          {/* Rating + Sold */}
          <View style={styles.ratingRow}>
            <StarRating rating={product.rating} />
            <Text style={styles.ratingValue}>{product.rating.toFixed(1)}</Text>
            <Text style={styles.ratingSep}>•</Text>
            <Text style={styles.soldText}>{product.soldCount} sold</Text>
          </View>

          {/* Owner */}
          <TouchableOpacity
            style={styles.ownerRow}
            onPress={() => navigation.navigate('Storefront', { userId: product.ownerId })}
          >
            <Avatar uri={product.ownerAvatar} name={product.ownerName} size={32} />
            <View style={{ marginLeft: 10 }}>
              <Text style={styles.ownerName}>{product.ownerName}</Text>
              <Text style={styles.ownerHandle}>@{product.ownerUsername}</Text>
            </View>
          </TouchableOpacity>

          {/* Description */}
          {product.description ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.description}>{product.description}</Text>
            </View>
          ) : null}

          {/* Variants */}
          {product.variants && product.variants.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Variants</Text>
              <View style={styles.variantRow}>
                {product.variants.map(v => (
                  <TouchableOpacity
                    key={v}
                    style={[styles.variantChip, selectedVariant === v && styles.variantChipActive]}
                    onPress={() => setSelectedVariant(v)}
                  >
                    <Text style={[styles.variantText, selectedVariant === v && styles.variantTextActive]}>{v}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Tags */}
          {product.tags && product.tags.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tags</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {product.tags.map(tag => (
                  <View key={tag} style={styles.tagChip}>
                    <Text style={styles.tagText}>#{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Stock */}
          <View style={styles.section}>
            <View style={styles.stockRow}>
              <Text style={styles.stockLabel}>Stock</Text>
              <Text style={[styles.stockValue, product.stock <= 5 && { color: colors.accentRed }]}>
                {product.stock > 0 ? `${product.stock} available` : 'Out of stock'}
              </Text>
            </View>
          </View>

          {/* Quantity Selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quantity</Text>
            <View style={styles.quantityRow}>
              <TouchableOpacity
                style={[styles.qtyBtn, quantity <= 1 && { opacity: 0.3 }]}
                onPress={() => setQuantity(q => Math.max(1, q - 1))}
                disabled={quantity <= 1}
              >
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qtyValue}>{quantity}</Text>
              <TouchableOpacity
                style={styles.qtyBtn}
                onPress={() => setQuantity(q => q + 1)}
              >
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Add to Cart Bar */}
      <SafeAreaView edges={['bottom']}>
        <View style={styles.bottomBar}>
          <View style={styles.totalCol}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalPrice}>{formatINR(product.price * quantity)}</Text>
          </View>
          <TouchableOpacity
            style={[styles.addToCartBtn, product.stock <= 0 && { opacity: 0.4 }]}
            onPress={handleAddToCart}
            disabled={product.stock <= 0 || addingToCart}
          >
            {addingToCart ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.addToCartText}>
                {product.stock <= 0 ? 'Out of Stock' : 'Add to Cart'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: colors.text, fontSize: 22 },
  headerTitle: { color: colors.text, fontWeight: '700', fontSize: 16, flex: 1, textAlign: 'center', marginHorizontal: 8 },
  mainImage: { width: SCREEN_W, height: SCREEN_W * 0.9, backgroundColor: '#000000' },
  noImage: { alignItems: 'center', justifyContent: 'center' },
  imagePagination: {
    position: 'absolute', bottom: 12, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  paginationDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  paginationDotActive: { backgroundColor: colors.accent, width: 18 },
  thumbnailRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: colors.bg,
  },
  thumbnail: {
    width: 60, height: 60, borderRadius: 8, borderWidth: 2, borderColor: 'transparent', overflow: 'hidden',
  },
  thumbnailActive: { borderColor: colors.accent },
  thumbnailImg: { width: '100%', height: '100%' },
  body: { paddingHorizontal: 16, paddingTop: 16 },
  productName: { color: colors.text, fontSize: 20, fontWeight: '800', lineHeight: 28, marginBottom: 8 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  price: { color: colors.accent, fontSize: 24, fontWeight: '800' },
  comparePrice: { color: colors.textSecondary, fontSize: 16, textDecorationLine: 'line-through' },
  discountBadge: { backgroundColor: colors.accentGreen, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  discountText: { color: '#000', fontSize: 12, fontWeight: '700' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  ratingValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  ratingSep: { color: colors.textMuted, fontSize: 14 },
  soldText: { color: colors.textSecondary, fontSize: 14 },
  ownerRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: colors.border, marginBottom: 16,
  },
  ownerName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  ownerHandle: { color: colors.textSecondary, fontSize: 13 },
  section: { marginBottom: 20 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
  description: { color: colors.textSecondary, fontSize: 14, lineHeight: 22 },
  variantRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  variantChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  variantChipActive: { borderColor: colors.accent, backgroundColor: 'rgba(29,155,240,0.1)' },
  variantText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  variantTextActive: { color: colors.accent },
  tagChip: { backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  tagText: { color: colors.textSecondary, fontSize: 13 },
  stockRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stockLabel: { color: colors.text, fontSize: 15 },
  stockValue: { color: colors.accentGreen, fontSize: 15, fontWeight: '600' },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  qtyBtn: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  qtyBtnText: { color: colors.text, fontSize: 20, fontWeight: '600' },
  qtyValue: { color: colors.text, fontSize: 18, fontWeight: '700', minWidth: 30, textAlign: 'center' },
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', padding: 16, gap: 16,
    borderTopWidth: 0.5, borderTopColor: colors.border, backgroundColor: colors.bg,
  },
  totalCol: { flex: 1 },
  totalLabel: { color: colors.textSecondary, fontSize: 12, marginBottom: 2 },
  totalPrice: { color: colors.text, fontSize: 22, fontWeight: '800' },
  addToCartBtn: {
    backgroundColor: colors.accent, paddingHorizontal: 28, paddingVertical: 14,
    borderRadius: 24, alignItems: 'center', justifyContent: 'center',
  },
  addToCartText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
