import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis, parseMediaUrls } from '../lib/api';
import { User, Post } from '../lib/api';

const CATEGORIES = [
  'Electronics',
  'Clothing',
  'Accessories',
  'Home & Living',
  'Beauty & Health',
  'Books & Media',
  'Sports & Fitness',
  'Food & Beverages',
  'Digital Products',
  'Services',
  'Art & Crafts',
  'Automotive',
  'Toys & Games',
  'Other',
];

interface FormState {
  name: string;
  description: string;
  price: string;
  compareAtPrice: string;
  category: string;
  tags: string;
  imageUrls: string;
  sku: string;
  stock: string;
  isDigital: boolean;
  isFeatured: boolean;
}

const INITIAL_FORM: FormState = {
  name: '',
  description: '',
  price: '',
  compareAtPrice: '',
  category: '',
  tags: '',
  imageUrls: '',
  sku: '',
  stock: '1',
  isDigital: false,
  isFeatured: false,
};

export default function AddProductScreen({ route, navigation }: any) {
  const currentUser = auth()?.currentUser;
  const editProductId = route?.params?.editProductId || null;
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editProductId);
  const [showCategories, setShowCategories] = useState(false);

  // Load existing product for editing
  useEffect(() => {
    if (!editProductId) return;
    const loadProduct = async () => {
      try {
        const docSnap = await firestore().collection('products').doc(editProductId).get();
        if (!docSnap.exists) {
          Alert.alert('Error', 'Product not found.');
          navigation.goBack();
          return;
        }
        const d = docSnap.data();
        const imgs = parseMediaUrls(d.images || d.imageUrls || d.mediaUrls);
        setForm({
          name: d.name || d.title || '',
          description: d.description || '',
          price: String(d.price || ''),
          compareAtPrice: String(d.compareAtPrice || d.comparePrice || ''),
          category: d.category || '',
          tags: Array.isArray(d.tags) ? d.tags.join(', ') : (d.tags || ''),
          imageUrls: imgs.join(', '),
          sku: d.sku || '',
          stock: String(d.stock ?? d.stockQuantity ?? '1'),
          isDigital: d.isDigital || d.digital || false,
          isFeatured: d.featured || false,
        });
      } catch (e) {
        console.error('[AddProduct] Load error:', e);
        Alert.alert('Error', 'Failed to load product.');
      } finally {
        setLoading(false);
      }
    };
    loadProduct();
  }, [editProductId]);

  const updateField = (key: keyof FormState, value: string | boolean) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      Alert.alert('Validation', 'Product name is required.');
      return;
    }
    if (!form.price.trim() || isNaN(Number(form.price)) || Number(form.price) <= 0) {
      Alert.alert('Validation', 'Please enter a valid price.');
      return;
    }
    if (!currentUser?.uid) {
      Alert.alert('Error', 'You must be logged in.');
      return;
    }

    setSaving(true);
    try {
      const imageData: string[] = form.imageUrls
        .split(',')
        .map(u => u.trim())
        .filter(Boolean);
      const tagData: string[] = form.tags
        .split(',')
        .map(t => t.trim().replace(/^#/, ''))
        .filter(Boolean);

      const productData: Record<string, any> = {
        name: form.name.trim(),
        description: form.description.trim(),
        price: Number(form.price),
        compareAtPrice: form.compareAtPrice.trim() ? Number(form.compareAtPrice) : null,
        category: form.category,
        tags: tagData,
        images: imageData,
        imageUrls: imageData,
        sku: form.sku.trim(),
        stock: parseInt(form.stock, 10) || 0,
        stockQuantity: parseInt(form.stock, 10) || 0,
        isDigital: form.isDigital,
        digital: form.isDigital,
        featured: form.isFeatured,
        active: true,
        ownerId: currentUser.uid,
        soldCount: 0,
        sold: 0,
        rating: 0,
        averageRating: 0,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      };

      if (editProductId) {
        await firestore().collection('products').doc(editProductId).update(productData);
        Alert.alert('Success', 'Product updated successfully.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        productData.createdAt = firestore.FieldValue.serverTimestamp();
        await firestore().collection('products').add(productData);
        Alert.alert('Success', 'Product created successfully.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (e: any) {
      console.error('[AddProduct] Save error:', e);
      Alert.alert('Error', `Failed to save product: ${e?.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

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
          <Text style={styles.headerTitle}>{editProductId ? 'Edit Product' : 'Add Product'}</Text>
          <View style={{ width: 36 }} />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Product Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Premium Black Hoodie"
              placeholderTextColor={colors.textSecondary}
              value={form.name}
              onChangeText={v => updateField('name', v)}
              maxLength={120}
            />
          </View>

          {/* Description */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Describe your product..."
              placeholderTextColor={colors.textSecondary}
              value={form.description}
              onChangeText={v => updateField('description', v)}
              multiline
              numberOfLines={4}
              maxLength={2000}
            />
          </View>

          {/* Price + Compare Price */}
          <View style={styles.rowGroup}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Price (₹) *</Text>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                value={form.price}
                onChangeText={v => updateField('price', v.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Compare-at Price</Text>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                value={form.compareAtPrice}
                onChangeText={v => updateField('compareAtPrice', v.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          {/* Category */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Category</Text>
            <TouchableOpacity
              style={styles.input}
              onPress={() => setShowCategories(!showCategories)}
            >
              <Text style={[styles.inputText, !form.category && { color: colors.textSecondary }]}>
                {form.category || 'Select a category'}
              </Text>
            </TouchableOpacity>
            {showCategories && (
              <View style={styles.dropdown}>
                <ScrollView nestedScrollEnabled style={{ maxHeight: 200 }}>
                  {CATEGORIES.map(cat => (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.dropdownItem, form.category === cat && styles.dropdownItemActive]}
                      onPress={() => {
                        updateField('category', cat);
                        setShowCategories(false);
                      }}
                    >
                      <Text style={[styles.dropdownText, form.category === cat && { color: colors.accent }]}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Tags */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Tags</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. black, hoodie, premium (comma separated)"
              placeholderTextColor={colors.textSecondary}
              value={form.tags}
              onChangeText={v => updateField('tags', v)}
            />
            <Text style={styles.fieldHint}>Separate multiple tags with commas</Text>
          </View>

          {/* Image URLs */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Image URLs</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="https://example.com/image1.jpg, https://..."
              placeholderTextColor={colors.textSecondary}
              value={form.imageUrls}
              onChangeText={v => updateField('imageUrls', v)}
              multiline
              numberOfLines={3}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.fieldHint}>Comma-separated image URLs</Text>
          </View>

          {/* SKU + Stock */}
          <View style={styles.rowGroup}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>SKU</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. BLK-HOOD-001"
                placeholderTextColor={colors.textSecondary}
                value={form.sku}
                onChangeText={v => updateField('sku', v)}
                autoCapitalize="characters"
              />
            </View>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Stock Quantity</Text>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                value={form.stock}
                onChangeText={v => updateField('stock', v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
              />
            </View>
          </View>

          {/* Toggles */}
          <View style={styles.fieldGroup}>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() => updateField('isDigital', !form.isDigital)}
            >
              <View style={[styles.toggleTrack, form.isDigital && styles.toggleTrackActive]}>
                <View style={[styles.toggleThumb, form.isDigital && styles.toggleThumbActive]} />
              </View>
              <View style={{ marginLeft: 12 }}>
                <Text style={styles.toggleLabel}>Digital Product</Text>
                <Text style={styles.toggleHint}>For downloadable files, courses, etc.</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toggleRow, { marginTop: 12 }]}
              onPress={() => updateField('isFeatured', !form.isFeatured)}
            >
              <View style={[styles.toggleTrack, form.isFeatured && styles.toggleTrackActive]}>
                <View style={[styles.toggleThumb, form.isFeatured && styles.toggleThumbActive]} />
              </View>
              <View style={{ marginLeft: 12 }}>
                <Text style={styles.toggleLabel}>Featured Product</Text>
                <Text style={styles.toggleHint}>Show in featured section on storefront</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>
                {editProductId ? 'Update Product' : 'Save Product'}
              </Text>
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
  headerTitle: { color: colors.text, fontWeight: '700', fontSize: 16, flex: 1, textAlign: 'center', marginHorizontal: 8 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 20 },
  fieldGroup: { marginBottom: 16 },
  rowGroup: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  fieldLabel: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 6 },
  fieldHint: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  input: {
    backgroundColor: colors.bgInput, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontSize: 15,
    borderWidth: 1, borderColor: colors.border,
  },
  inputText: { color: colors.text, fontSize: 15 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  dropdown: {
    backgroundColor: colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, marginTop: 4,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  dropdownItemActive: { backgroundColor: 'rgba(29,155,240,0.08)' },
  dropdownText: { color: colors.text, fontSize: 14 },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  toggleTrack: {
    width: 48, height: 28, borderRadius: 14,
    backgroundColor: colors.border, padding: 2,
  },
  toggleTrackActive: { backgroundColor: colors.accent },
  toggleThumb: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#fff',
  },
  toggleThumbActive: { alignSelf: 'flex-end' },
  toggleLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  toggleHint: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  saveBtn: {
    backgroundColor: colors.accent, paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
