import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, FlatList, Alert, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis, parseMediaUrls } from '../lib/api';
import { User } from '../lib/api';

interface Product {
  id: string;
  name: string;
  price: number;
  images: string[];
  active: boolean;
  featured: boolean;
  soldCount: number;
  stock: number;
  createdAt: number;
}

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

export default function MyStoreScreen({ route, navigation }: any) {
  const currentUser = auth()?.currentUser;
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentUser?.uid) return;
    try {
      const snap = await firestore()
        .collection('products')
        .where('ownerId', '==', currentUser.uid)
        .orderBy('createdAt', 'desc')
        .get();

      const ps: Product[] = snap.docs.map(doc => {
        const d = doc.data();
        const imgs = parseMediaUrls(d.images || d.imageUrls || d.mediaUrls);
        return {
          id: doc.id,
          name: d.name || d.title || 'Product',
          price: d.price || 0,
          images: imgs,
          active: d.active !== false,
          featured: d.featured || false,
          soldCount: d.soldCount || d.sold || 0,
          stock: d.stock ?? d.stockQuantity ?? 0,
          createdAt: tsToMillis(d.createdAt),
        };
      });
      setProducts(ps);
    } catch (e) {
      console.error('[MyStore] Load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const handleToggleActive = async (product: Product) => {
    try {
      await firestore().collection('products').doc(product.id).update({
        active: !product.active,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      setProducts(prev =>
        prev.map(p => p.id === product.id ? { ...p, active: !p.active } : p),
      );
    } catch (e) {
      Alert.alert('Error', 'Failed to update product status.');
    }
  };

  const handleDelete = (product: Product) => {
    Alert.alert(
      'Delete Product',
      `Are you sure you want to delete "${product.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await firestore().collection('products').doc(product.id).delete();
              setProducts(prev => prev.filter(p => p.id !== product.id));
            } catch {
              Alert.alert('Error', 'Failed to delete product.');
            }
          },
        },
      ],
    );
  };

  const handleEdit = (product: Product) => {
    navigation.navigate('AddProduct', { editProductId: product.id });
  };

  const renderItem = ({ item }: { item: Product }) => (
    <View style={[styles.productRow, !item.active && styles.productRowInactive]}>
      {/* Image */}
      <TouchableOpacity
        style={styles.productImageWrap}
        onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
        activeOpacity={0.7}
      >
        {item.images.length > 0 ? (
          <Image source={{ uri: item.images[0] }} style={styles.productImage} resizeMode="cover" />
        ) : (
          <View style={[styles.productImage, styles.productImagePlaceholder]}>
            <Ionicons name="cube-outline" size={24} color={colors.textMuted} />
          </View>
        )}
      </TouchableOpacity>

      {/* Info */}
      <View style={styles.productInfo}>
        <Text style={[styles.productName, !item.active && styles.inactiveText]} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.productPrice}>{formatINR(item.price)}</Text>
        <View style={styles.productMeta}>
          <Text style={styles.metaText}>{item.soldCount} sold</Text>
          <Text style={styles.metaSep}>•</Text>
          <Text style={styles.metaText}>{item.stock} in stock</Text>
        </View>
        {item.featured && (
          <View style={styles.featuredBadge}>
            <Ionicons name="ribbon-outline" size={12} color={colors.accentGold} />
            <Text style={styles.featuredText}>Featured</Text>
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={styles.productActions}>
        <TouchableOpacity
          style={[styles.actionBtn, item.active ? styles.activeBtn : styles.inactiveBtn]}
          onPress={() => handleToggleActive(item)}
        >
          <Text style={[styles.actionBtnText, item.active ? styles.activeBtnText : styles.inactiveBtnText]}>
            {item.active ? 'Active' : 'Inactive'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => handleEdit(item)}>
          <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={() => handleDelete(item)}>
          <Ionicons name="trash-outline" size={18} color={colors.accentRed} />
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>My Store</Text>
          <Text style={styles.headerCount}>{products.length}</Text>
        </View>
      </SafeAreaView>

      {products.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="storefront-outline" size={60} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No products yet</Text>
          <Text style={styles.emptySubtitle}>Tap the + button to add your first product.</Text>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => navigation.navigate('AddProduct')}
          >
            <Text style={styles.addBtnText}>+ Add Product</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      {/* FAB */}
      {products.length > 0 && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('AddProduct')}
          activeOpacity={0.8}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
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
    color: colors.textSecondary, fontSize: 14, fontWeight: '600',
    backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  listContent: { padding: 16 },
  separator: { height: 0.5, backgroundColor: colors.border, marginVertical: 2 },
  productRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, backgroundColor: colors.bgCard, borderRadius: 12, marginBottom: 4,
  },
  productRowInactive: { opacity: 0.5 },
  productImageWrap: { overflow: 'hidden', borderRadius: 10 },
  productImage: { width: 68, height: 68, backgroundColor: '#000000' },
  productImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  productInfo: { flex: 1, justifyContent: 'center' },
  productName: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 20, marginBottom: 2 },
  productPrice: { color: colors.accent, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  productMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { color: colors.textSecondary, fontSize: 12 },
  metaSep: { color: colors.textMuted, fontSize: 10 },
  featuredBadge: { marginTop: 4, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(245, 158, 11, 0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  featuredText: { color: colors.accentGold, fontSize: 11, fontWeight: '600' },
  productActions: { alignItems: 'flex-end', gap: 6 },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  activeBtn: { borderColor: colors.accentGreen },
  inactiveBtn: { borderColor: colors.border },
  activeBtnText: { color: colors.accentGreen, fontSize: 12, fontWeight: '600' },
  inactiveBtnText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  actionBtnText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  iconBtn: { padding: 2 },
  iconBtnText: { fontSize: 18 },
  inactiveText: { color: colors.textSecondary },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyIcon: { fontSize: 60, marginBottom: 16 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { color: colors.textSecondary, fontSize: 15, textAlign: 'center', marginBottom: 24, lineHeight: 22 },
  addBtn: {
    backgroundColor: colors.accent, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 24,
  },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  fab: {
    position: 'absolute', bottom: 28, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6,
    elevation: 8,
  },
  fabText: { color: '#fff', fontSize: 28, fontWeight: '300', marginTop: -2 },
});
