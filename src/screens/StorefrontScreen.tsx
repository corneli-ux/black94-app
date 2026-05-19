import { useEffect, useState, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { firestore } from '../lib/firebase';
import { tsToMillis, parseMediaUrls } from '../lib/api';
import { User } from '../lib/api';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_GAP = 10;
const CARD_W = (SCREEN_W - 32 - CARD_GAP) / 2;

interface Product {
  id: string;
  name: string;
  price: number;
  compareAtPrice?: number;
  images: string[];
  rating: number;
  soldCount: number;
  category: string;
  ownerId: string;
  active: boolean;
  featured: boolean;
  createdAt: number;
}

function StarRating({ rating, size = 12 }: { rating: number; size?: number }) {
  const full = Math.floor(rating);
  const hasHalf = rating - full >= 0.5;
  const stars: string[] = [];
  for (let i = 0; i < 5; i++) {
    if (i < full) stars.push('★');
    else if (i === full && hasHalf) stars.push('★');
    else stars.push('☆');
  }
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {stars.map((s, i) => (
        <Text key={i} style={{ color: colors.accentGold, fontSize: size }}>{s}</Text>
      ))}
    </View>
  );
}

function formatINR(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

export default function StorefrontScreen({ route, navigation }: any) {
  const { userId } = route.params || {};

  // BUG FIX: Guard against missing userId (navigation bug or deep link).
  // Without this, firestore().doc(undefined) throws a cryptic error.
  const [owner, setOwner] = useState<User | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [storeRating, setStoreRating] = useState(0);
  const [totalSold, setTotalSold] = useState(0);

  const load = useCallback(async () => {
    try {
      // BUG FIX: Query by ownerId (not businessId). AddProductScreen saves
      // products with 'ownerId', not 'businessId'. The old query used
      // businessId which never matched any products — store appeared empty.
      const [userSnap, productsSnap] = await Promise.all([
        firestore().collection('users').doc(userId).get(),
        firestore().collection('products').where('ownerId', '==', userId).get(),
      ]);

      if (userSnap.exists) {
        const d = userSnap.data();
        setOwner({
          id: userId,
          email: d?.email || '',
          username: d?.username || '',
          displayName: d?.displayName || '',
          bio: d?.bio || '',
          profileImage: d?.profileImage || null,
          coverImage: d?.coverImage || null,
          role: d?.role || 'personal',
          badge: d?.badge || '',
          subscription: d?.subscription || 'free',
          isVerified: d?.isVerified || false,
          createdAt: (() => { try { return tsToMillis(d?.createdAt); } catch { return Date.now(); } })(),
        });
      }

      const ps: Product[] = [];
      let ratingSum = 0;
      let ratingCount = 0;
      let sold = 0;
      // Also filter by active=true (some products may have active=false)
      const activeProducts = productsSnap.docs.filter(d => d.data()?.active !== false);
      for (const doc of activeProducts) {
        const d = doc.data();
        const imgs = parseMediaUrls(d.images || d.imageUrls || d.mediaUrls);
        const p: Product = {
          id: doc.id,
          name: d.name || d.title || 'Product',
          price: d.price || 0,
          compareAtPrice: d.compareAtPrice || d.comparePrice || undefined,
          images: imgs,
          rating: d.rating || d.averageRating || 0,
          soldCount: d.soldCount || d.sold || 0,
          category: d.category || '',
          ownerId: d.ownerId || userId,
          active: d.active !== false,
          featured: d.featured || false,
          createdAt: (() => { try { return tsToMillis(d.createdAt); } catch { return Date.now(); } })(),
        };
        ps.push(p);
        if (p.rating > 0) { ratingSum += p.rating; ratingCount++; }
        sold += p.soldCount;
      }
      setProducts(ps);
      setStoreRating(ratingCount > 0 ? ratingSum / ratingCount : 0);
      setTotalSold(sold);
    } catch (e) {
      console.error('[Storefront] Load error:', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // BUG FIX: load() depends on userId — empty dep array means navigating
  // to a different user's store reuses the stale initial load result.
  useEffect(() => { load(); }, [load]);

  // BUG FIX: Early return AFTER all hooks to avoid "Rendered fewer hooks
  // than expected" crash. Previously this guard was placed before useState
  // and useCallback hooks, causing React to throw when userId was missing.
  if (!userId) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
        <Text style={{ color: '#94a3b8', fontSize: 15 }}>Store not found</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 12 }}>
          <Text style={{ color: '#D4AF37', fontSize: 14 }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const renderProductCard = ({ item }: { item: Product }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
      activeOpacity={0.7}
    >
      <Image
        source={item.images.length > 0 ? { uri: item.images[0] } : undefined}
        style={styles.cardImage}
        resizeMode="cover"
      />
      {item.images.length === 0 && (
        <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
          <Text style={{ color: colors.textMuted, fontSize: 28 }}>📦</Text>
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.cardPrice}>{formatINR(item.price)}</Text>
        <View style={styles.cardMeta}>
          <StarRating rating={item.rating} size={10} />
          <Text style={styles.cardSold}>{item.soldCount} sold</Text>
        </View>
      </View>
    </TouchableOpacity>
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
          <Text style={styles.headerTitle} numberOfLines={1}>
            {owner?.displayName || 'Store'}
          </Text>
          <View style={{ width: 36 }} />
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Cover */}
        <View style={styles.coverWrap}>
          {owner?.coverImage ? (
            <Image source={{ uri: owner.coverImage }} style={styles.cover} resizeMode="cover" />
          ) : (
            <View style={[styles.cover, { backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: 'rgba(255,255,255,0.08)', fontSize: 60, fontWeight: '800' }}>B94</Text>
            </View>
          )}
        </View>

        {/* Avatar + Store Info */}
        <View style={styles.infoSection}>
          <View style={{ marginTop: -36 }}>
            <Avatar uri={owner?.profileImage} name={owner?.displayName} size={72} borderWidth={3} borderColor={colors.bg} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <Text style={styles.storeName}>{owner?.displayName || 'Store'}</Text>
            <VerifiedBadge badge={owner?.badge} isVerified={owner?.isVerified} />
          </View>
          <Text style={styles.storeHandle}>@{owner?.username}</Text>
          {owner?.bio ? <Text style={styles.storeBio} numberOfLines={3}>{owner.bio}</Text> : null}

          {/* Rating + Sold */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <StarRating rating={storeRating} />
              <Text style={styles.statLabel}>{storeRating.toFixed(1)} rating</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{totalSold}</Text>
              <Text style={styles.statLabel}>sold</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{products.length}</Text>
              <Text style={styles.statLabel}>products</Text>
            </View>
          </View>
        </View>

        {/* Products Grid */}
        <View style={styles.productsSection}>
          <Text style={styles.sectionTitle}>Products</Text>
          {products.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No products available yet</Text>
            </View>
          ) : (
            <View style={styles.gridRow}>
              {products.map((item) => (
                <View key={item.id} style={{ width: CARD_W }}>
                  {renderProductCard({ item })}
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
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
  headerTitle: { color: colors.text, fontWeight: '700', fontSize: 16, flex: 1, textAlign: 'center', marginHorizontal: 8 },
  coverWrap: { height: 140, width: '100%', overflow: 'hidden', backgroundColor: '#000000' },
  cover: { width: '100%', height: '100%' },
  infoSection: { paddingHorizontal: 16, paddingTop: 8 },
  storeName: { color: colors.text, fontSize: 20, fontWeight: '800' },
  storeHandle: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },
  storeBio: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 8 },
  statsRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: 16,
    paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: colors.surface, borderRadius: 12,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '700' },
  statLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  statDivider: { width: 0.5, height: 32, backgroundColor: colors.border },
  productsSection: { paddingHorizontal: 16, marginTop: 24 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 14 },
  gridRow: { flexDirection: 'row', flexWrap: 'wrap', gap: CARD_GAP, justifyContent: 'space-between' },
  card: {
    width: CARD_W, backgroundColor: colors.surface, borderRadius: 12, overflow: 'hidden',
    marginBottom: CARD_GAP,
  },
  cardImage: { width: '100%', aspectRatio: 1, backgroundColor: '#000000' },
  cardImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 8 },
  cardName: { color: colors.text, fontSize: 13, fontWeight: '600', lineHeight: 18, marginBottom: 4 },
  cardPrice: { color: colors.accent, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardSold: { color: colors.textSecondary, fontSize: 11 },
  emptyContainer: { alignItems: 'center', paddingTop: 40 },
  emptyText: { color: colors.textSecondary, fontSize: 15 },
});
