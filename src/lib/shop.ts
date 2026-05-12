/**
 * shop.ts — Shop / E-Commerce Functions
 *
 * Adapted from React Native Firebase to the REST-based firebase.ts client.
 * Handles products, orders, reviews, and shipping partners.
 */

import { firestore } from './firebase';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ShopProduct {
  id: string;
  businessId: string;
  businessName: string;
  businessImage: string;
  name: string;
  description: string;
  price: number;
  compareAtPrice?: number;
  category: string;
  tags: string[];
  images: string;
  stock: number;
  sku: string;
  variants: string;
  isDigital: boolean;
  isFeatured: boolean;
  isActive: boolean;
  rating: number;
  reviewCount: number;
  soldCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShopOrder {
  id: string;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  businessId: string;
  businessName: string;
  items: string; // JSON
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  shippingAddress: string; // JSON
  trackingNumber: string;
  trackingPartner: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  image: string;
  variant: string;
}

export interface ShopReview {
  id: string;
  productId: string;
  buyerId: string;
  buyerName: string;
  buyerImage: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface ShippingPartner {
  id: string;
  name: string;
  logo: string;
  isActive: boolean;
  baseRate: number;
  perKgRate: number;
  estimatedDays: string;
  supportsCOD: boolean;
  supportsPrepaid: boolean;
}

// ── Helper ──────────────────────────────────────────────────────────────────

function tsToISO(value: unknown): string {
  if (value && typeof value === 'object' && 'seconds' in value) {
    const ts = value as { seconds: number };
    return new Date(ts.seconds * 1000).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function docToProduct(id: string, d: any): ShopProduct {
  return {
    id,
    businessId: d.businessId ?? '',
    businessName: d.businessName ?? '',
    businessImage: d.businessImage ?? '',
    name: d.name ?? '',
    description: d.description ?? '',
    price: d.price ?? 0,
    compareAtPrice: d.compareAtPrice,
    category: d.category ?? '',
    tags: Array.isArray(d.tags) ? d.tags : [],
    images: d.images ?? '',
    stock: d.stock ?? 0,
    sku: d.sku ?? '',
    variants: d.variants ?? '[]',
    isDigital: d.isDigital ?? false,
    isFeatured: d.isFeatured ?? false,
    isActive: d.isActive ?? true,
    rating: d.rating ?? 0,
    reviewCount: d.reviewCount ?? 0,
    soldCount: d.soldCount ?? 0,
    createdAt: tsToISO(d.createdAt),
    updatedAt: tsToISO(d.updatedAt),
  };
}

function docToOrder(id: string, d: any): ShopOrder {
  return {
    id,
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
    shippingAddress:
      typeof d.shippingAddress === 'string'
        ? d.shippingAddress
        : JSON.stringify(d.shippingAddress ?? {}),
    trackingNumber: d.trackingNumber ?? '',
    trackingPartner: d.trackingPartner ?? '',
    notes: d.notes ?? '',
    createdAt: tsToISO(d.createdAt),
    updatedAt: tsToISO(d.updatedAt),
  };
}

function docToReview(id: string, d: any): ShopReview {
  return {
    id,
    productId: d.productId ?? '',
    buyerId: d.buyerId ?? '',
    buyerName: d.buyerName ?? '',
    buyerImage: d.buyerImage ?? '',
    rating: d.rating ?? 0,
    comment: d.comment ?? '',
    createdAt: tsToISO(d.createdAt),
  };
}

function docToShippingPartner(id: string, d: any): ShippingPartner {
  return {
    id,
    name: d.name ?? '',
    logo: d.logo ?? '',
    isActive: d.isActive ?? true,
    baseRate: d.baseRate ?? 0,
    perKgRate: d.perKgRate ?? 0,
    estimatedDays: d.estimatedDays ?? '3-5',
    supportsCOD: d.supportsCOD ?? true,
    supportsPrepaid: d.supportsPrepaid ?? true,
  };
}

// ── Product Functions ────────────────────────────────────────────────────────

export async function createProduct(
  data: Omit<ShopProduct, 'id' | 'createdAt' | 'updatedAt' | 'rating' | 'reviewCount' | 'soldCount'>,
): Promise<ShopProduct> {
  const ref = await firestore().collection('products').add({
    ...data,
    rating: 0,
    reviewCount: 0,
    soldCount: 0,
    createdAt: firestore.FieldValue.serverTimestamp(),
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
  const snap = await firestore().collection('products').doc(ref.id).get();
  return docToProduct(snap.id, snap.data());
}

export async function fetchProducts(
  limitCount: number,
  _lastDoc?: any,
  category?: string,
): Promise<{ products: ShopProduct[]; lastDoc: any }> {
  let query: any;

  if (category && category !== 'All') {
    query = firestore()
      .collection('products')
      .where('isActive', '==', true)
      .where('category', '==', category)
      .orderBy('createdAt', 'desc')
      .limit(limitCount);
  } else {
    query = firestore()
      .collection('products')
      .where('isActive', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(limitCount);
  }

  const snap = await query.get();
  const products = snap.docs.map((doc: any) => docToProduct(doc.id, doc.data()));
  const newLastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
  return { products, lastDoc: newLastDoc };
}

export async function fetchProductById(id: string): Promise<ShopProduct | null> {
  const snap = await firestore().collection('products').doc(id).get();
  if (!snap.exists) return null;
  return docToProduct(snap.id, snap.data());
}

export async function fetchBusinessProducts(
  businessId: string,
  limitCount: number,
  _lastDoc?: any,
): Promise<{ products: ShopProduct[]; lastDoc: any }> {
  const query = firestore()
    .collection('products')
    .where('businessId', '==', businessId)
    .where('isActive', '==', true)
    .orderBy('createdAt', 'desc')
    .limit(limitCount);

  const snap = await query.get();
  const products = snap.docs.map((doc: any) => docToProduct(doc.id, doc.data()));
  const newLastDoc = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
  return { products, lastDoc: newLastDoc };
}

export async function updateProduct(id: string, data: Partial<ShopProduct>): Promise<void> {
  await firestore().collection('products').doc(id).update({
    ...data,
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
}

export async function deleteProduct(id: string): Promise<void> {
  await firestore().collection('products').doc(id).update({
    isActive: false,
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
}

export async function fetchFeaturedProducts(): Promise<ShopProduct[]> {
  const snap = await firestore()
    .collection('products')
    .where('isFeatured', '==', true)
    .where('isActive', '==', true)
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get();

  return snap.docs.map((doc: any) => docToProduct(doc.id, doc.data()));
}

export async function fetchCategories(): Promise<string[]> {
  const snap = await firestore()
    .collection('products')
    .where('isActive', '==', true)
    .limit(500)
    .get();

  const categories = new Set<string>();
  snap.docs.forEach((d: any) => {
    const cat = d.data().category;
    if (cat) categories.add(cat);
  });
  return Array.from(categories).sort();
}

export async function searchProducts(
  queryStr: string,
  limitCount: number = 20,
): Promise<ShopProduct[]> {
  const snap = await firestore()
    .collection('products')
    .where('isActive', '==', true)
    .where('name', '>=', queryStr)
    .where('name', '<=', queryStr + '\uf8ff')
    .orderBy('name', 'asc')
    .limit(limitCount)
    .get();

  return snap.docs.map((doc: any) => docToProduct(doc.id, doc.data()));
}

// ── Order Functions ─────────────────────────────────────────────────────────

export async function createOrder(
  orderData: Omit<ShopOrder, 'id' | 'createdAt' | 'updatedAt' | 'status'>,
): Promise<ShopOrder> {
  const ref = await firestore().collection('orders').add({
    ...orderData,
    status: 'pending',
    createdAt: firestore.FieldValue.serverTimestamp(),
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
  const snap = await firestore().collection('orders').doc(ref.id).get();
  return docToOrder(snap.id, snap.data());
}

export async function fetchBuyerOrders(buyerId: string): Promise<ShopOrder[]> {
  const snap = await firestore()
    .collection('orders')
    .where('buyerId', '==', buyerId)
    .orderBy('createdAt', 'desc')
    .get();

  return snap.docs.map((doc: any) => docToOrder(doc.id, doc.data()));
}

export async function fetchBusinessOrders(businessId: string): Promise<ShopOrder[]> {
  const snap = await firestore()
    .collection('orders')
    .where('businessId', '==', businessId)
    .orderBy('createdAt', 'desc')
    .get();

  return snap.docs.map((doc: any) => docToOrder(doc.id, doc.data()));
}

export async function updateOrderStatus(
  orderId: string,
  status: ShopOrder['status'],
  trackingNumber?: string,
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    updatedAt: firestore.FieldValue.serverTimestamp(),
  };
  if (trackingNumber !== undefined) {
    update.trackingNumber = trackingNumber;
  }
  await firestore().collection('orders').doc(orderId).update(update);
}

// ── Review Functions ────────────────────────────────────────────────────────

export async function addReview(
  data: Omit<ShopReview, 'id' | 'createdAt'>,
): Promise<ShopReview> {
  const ref = await firestore().collection('reviews').add({
    ...data,
    createdAt: firestore.FieldValue.serverTimestamp(),
  });
  const snap = await firestore().collection('reviews').doc(ref.id).get();
  return docToReview(snap.id, snap.data());
}

export async function fetchProductReviews(productId: string): Promise<ShopReview[]> {
  const snap = await firestore()
    .collection('reviews')
    .where('productId', '==', productId)
    .orderBy('createdAt', 'desc')
    .get();

  return snap.docs.map((doc: any) => docToReview(doc.id, doc.data()));
}

// ── Shipping Functions ──────────────────────────────────────────────────────

export async function fetchShippingPartners(): Promise<ShippingPartner[]> {
  const snap = await firestore()
    .collection('shippingPartners')
    .where('isActive', '==', true)
    .get();

  return snap.docs.map((doc: any) => docToShippingPartner(doc.id, doc.data()));
}

export function calculateShipping(
  partner: ShippingPartner,
  weight: number = 0.5,
  _pincode?: string,
): number {
  return partner.baseRate + partner.perKgRate * weight;
}
