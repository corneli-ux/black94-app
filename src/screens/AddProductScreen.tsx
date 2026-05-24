import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, TextInput, Alert, KeyboardAvoidingView, Platform, Image, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme/colors';
import { auth, firestore } from '../lib/firebase';
import { parseMediaUrls } from '../lib/api';
import { checkPlanLimit } from '../lib/payments';
import { optimizeImage } from '../utils/imageOptimizer';
import { uploadOptimizedImage } from '../utils/imageUpload';

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

const MAX_PRODUCT_IMAGES = 5;

// ── Per-image upload status ───────────────────────────────────────────────

type ImageUploadStatus = 'idle' | 'uploading' | 'done' | 'failed';

interface FormState {
  name: string;
  description: string;
  price: string;
  compareAtPrice: string;
  category: string;
  tags: string;
  images: string[];        // Array of URIs (local file:// or remote https://)
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
  images: [],
  sku: '',
  stock: '1',
  isDigital: false,
  isFeatured: false,
};

// ── Image picker helpers (proper permission handling) ─────────────────────

/**
 * Opens the device gallery with proper permission handling.
 * Returns null if the user denied permission or cancelled.
 */
async function openImagePicker(limit: number): Promise<ImagePicker.ImagePickerAsset[] | null> {
  try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status === 'denied') {
      Alert.alert(
        'Photos Access Denied',
        'BLACK94 needs access to your photos to select images. Please enable it in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => ImagePicker.grantMediaLibraryPermissionsAsync() },
        ],
      );
      return null;
    }

    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow photo library access to select images.');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: limit,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) return null;
    return result.assets.filter((a) => a.uri != null);
  } catch (err) {
    console.error('[AddProduct] Image picker error:', err);
    Alert.alert('Error', 'Something went wrong while opening the gallery. Please try again.');
    return null;
  }
}

/**
 * Opens the device camera with proper permission handling.
 * Returns null if the user denied permission, cancelled, or the device has no camera.
 */
async function openCamera(): Promise<ImagePicker.ImagePickerAsset | null> {
  try {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();

    if (status === 'denied') {
      Alert.alert(
        'Camera Access Denied',
        'BLACK94 needs camera access to take photos. Please enable it in your device Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          ...(Platform.OS === 'ios'
            ? [{ text: 'Open Settings', onPress: () => ImagePicker.grantCameraPermissionsAsync() }]
            : []),
        ],
      );
      return null;
    }

    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Camera permission is required to take photos.');
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) return null;
    return result.assets[0] || null;
  } catch (err: any) {
    if (err?.message?.includes('Camera is not available') || err?.message?.includes('No camera')) {
      Alert.alert('Camera Unavailable', 'Your device does not have a camera or it is being used by another app.');
    } else {
      console.error('[AddProduct] Camera error:', err);
      Alert.alert('Camera Error', 'Something went wrong while opening the camera. Please try again.');
    }
    return null;
  }
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function AddProductScreen({ route, navigation }: any) {
  const currentUser = auth()?.currentUser;
  const editProductId = route?.params?.editProductId || null;
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editProductId);
  const [showCategories, setShowCategories] = useState(false);

  // Upload tracking state
  const [uploadProgress, setUploadProgress] = useState('');
  const [imageStatuses, setImageStatuses] = useState<ImageUploadStatus[]>([]);
  const [imageProgress, setImageProgress] = useState<number[]>([]);
  const [imageLoadErrors, setImageLoadErrors] = useState<Set<number>>(new Set());

  // Abort controller to cancel uploads
  const abortRef = useRef<AbortController | null>(null);

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
          images: imgs,  // Already uploaded URLs — keep as-is
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

  const updateField = (key: keyof FormState, value: string | boolean | string[]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  // ── Image actions ─────────────────────────────────────────────────────

  const handleAddImages = useCallback(async () => {
    if (saving) return;
    const remaining = MAX_PRODUCT_IMAGES - form.images.length;
    if (remaining <= 0) {
      Alert.alert('Limit reached', `You can add up to ${MAX_PRODUCT_IMAGES} images.`);
      return;
    }
    const assets = await openImagePicker(remaining);
    if (!assets || assets.length === 0) return;
    const rawUris = assets.map((a) => a.uri!).slice(0, remaining);
    // BUG FIX: Copy picked images to permanent cache to prevent FileNotFoundException
    try {
      const { copyToSafeCache } = require('../utils/imageUpload');
      const safeUris: string[] = [];
      for (const rawUri of rawUris) {
        try {
          const safeUri = await copyToSafeCache(rawUri);
          safeUris.push(safeUri);
        } catch (copyErr: any) {
          if (__DEV__) console.warn('[AddProduct] Failed to cache image:', copyErr?.message);
        }
      }
      if (safeUris.length > 0) {
        setImageLoadErrors(new Set());
        setForm(prev => ({ ...prev, images: [...prev.images, ...safeUris] }));
      }
      else if (rawUris.length > 0) Alert.alert('Image Error', 'Selected images are no longer available. Please try again.');
    } catch {
      if (rawUris.length > 0) setForm(prev => ({ ...prev, images: [...prev.images, ...rawUris] }));
    }
  }, [form.images.length, saving]);

  const handleCamera = useCallback(async () => {
    if (saving) return;
    const remaining = MAX_PRODUCT_IMAGES - form.images.length;
    if (remaining <= 0) {
      Alert.alert('Limit reached', `You can add up to ${MAX_PRODUCT_IMAGES} images.`);
      return;
    }
    const asset = await openCamera();
    if (!asset?.uri) return;
    // Camera images can also be in volatile cache — copy to safe location
    try {
      const { copyToSafeCache } = require('../utils/imageUpload');
      const safeUri = await copyToSafeCache(asset.uri);
      setImageLoadErrors(new Set());
      setForm(prev => ({ ...prev, images: [...prev.images, safeUri] }));
    } catch {
      setForm(prev => ({ ...prev, images: [...prev.images, asset.uri!] }));
    }
  }, [form.images.length, saving]);

  const handleRemoveImage = useCallback((index: number) => {
    if (saving) return;
    setImageLoadErrors(new Set());
    setForm(prev => ({ ...prev, images: prev.images.filter((_, i) => i !== index) }));
  }, [saving]);

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

    // Check plan limits for new products
    if (!editProductId) {
      const productCheck = await checkPlanLimit(currentUser.uid, 'product');
      if (!productCheck.allowed) {
        Alert.alert('Limit Reached', productCheck.reason || 'Upgrade to Business plan to add products.');
        return;
      }
    }

    setSaving(true);
    setUploadProgress('Preparing images...');

    // Initialize per-image status tracking
    const statuses: ImageUploadStatus[] = form.images.map(() => 'uploading');
    const progresses: number[] = form.images.map(() => 0);
    setImageStatuses(statuses);
    setImageProgress(progresses);

    // Create abort controller for this upload session
    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      // Upload all local images in parallel
      const uploadPromises = form.images.map(async (uri, i) => {
        // Skip images that are already uploaded (remote URLs)
        if (uri.startsWith('http://') || uri.startsWith('https://')) {
          setImageStatuses(prev => {
            const next = [...prev];
            next[i] = 'done';
            return next;
          });
          return uri;
        }

        try {
          // Optimize image
          setUploadProgress(`Optimizing image ${i + 1}...`);
          const optimized = await optimizeImage(uri, {
            maxWidth: 2048,
            jpegQuality: 0.88,
            generateThumbnail: false,
          });

          const ext = optimized.mimeType === 'image/png' ? 'png' : 'jpg';
          const storagePath = `products/${currentUser.uid}/${Date.now()}_${i}.${ext}`;

          const result = await uploadOptimizedImage(optimized.optimizedUri, storagePath, {
            mimeType: optimized.mimeType,
            abortSignal: abortController.signal,
            onProgress: (loaded, total) => {
              const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
              setImageProgress(prev => {
                const next = [...prev];
                next[i] = pct;
                return next;
              });
            },
          });

          // Mark this image as done
          setImageStatuses(prev => {
            const next = [...prev];
            next[i] = 'done';
            return next;
          });

          return result.downloadUrl;
        } catch (err: any) {
          if (abortController.signal.aborted) {
            throw new Error('Upload cancelled');
          }
          // Mark this image as failed
          setImageStatuses(prev => {
            const next = [...prev];
            next[i] = 'failed';
            return next;
          });
          const errMsg = err?.message || String(err);
          console.error(`[AddProduct] Image ${i + 1} upload failed:`, errMsg);
          if (!handleSave._firstUploadError) {
            handleSave._firstUploadError = errMsg;
          }
          return null;
        }
      });

      // Reset stored error for this attempt
      handleSave._firstUploadError = undefined;

      const results = await Promise.all(uploadPromises);

      // Check for failures
      const failedCount = results.filter((r) => r === null).length;
      const successCount = results.length - failedCount;

      if (failedCount > 0 && successCount === 0) {
        const detail = handleSave._firstUploadError || 'Unknown error';
        const shortDetail = detail.length > 200 ? detail.slice(0, 200) + '...' : detail;
        Alert.alert(
          'Upload Failed',
          `Could not upload ${failedCount} image${failedCount > 1 ? 's' : ''}.\n\n${shortDetail}`,
        );
        return;
      }

      if (failedCount > 0) {
        const shouldContinue = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Partial Upload Failure',
            `${failedCount} of ${results.length} image${failedCount > 1 ? 's' : ''} failed to upload. Your product will be saved with ${successCount} image${successCount > 1 ? 's' : ''}.`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Save Anyway', onPress: () => resolve(true) },
            ],
          );
        });
        if (!shouldContinue) return;
      }

      // Build final URL list
      const imageData = results.filter((r): r is string => r !== null);

      setUploadProgress('Saving product...');

      const tagData: string[] = form.tags
        .split(',')
        .map(t => t.trim().replace(/^#/, ''))
        .filter(Boolean);

      const productData: Record<string, any> = {
        name: form.name.trim(),
        // BUG FIX: Store lowercase name for case-insensitive search in shop.ts.
        // searchProducts queries by 'nameLower' — without this field, store
        // search returns no results for most queries.
        nameLower: form.name.trim().toLowerCase(),
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
      if (e?.message === 'Upload cancelled') {
        if (__DEV__) console.log('[AddProduct] Upload cancelled by user.');
        return;
      }
      console.error('[AddProduct] Save error:', e);
      Alert.alert('Product', 'Could not save product. Please try again.');
    } finally {
      setSaving(false);
      setUploadProgress('');
      setImageStatuses([]);
      setImageProgress([]);
      abortRef.current = null;
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
          <TouchableOpacity
            onPress={() => {
              if (saving && abortRef.current) {
                Alert.alert('Cancel Upload?', 'Images are being uploaded. Are you sure you want to cancel?', [
                  { text: 'Keep Uploading', style: 'cancel' },
                  { text: 'Cancel', style: 'destructive', onPress: () => { abortRef.current?.abort(); navigation.goBack(); } },
                ]);
                return;
              }
              navigation.goBack();
            }}
            style={styles.backBtn}
          >
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{editProductId ? 'Edit Product' : 'Add Product'}</Text>
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

          {/* Product Photos */}
          <View style={styles.fieldGroup}>
            <View style={styles.imageSectionHeader}>
              <Text style={styles.fieldLabel}>Product Photos</Text>
              <Text style={styles.imageCount}>{form.images.length}/{MAX_PRODUCT_IMAGES}</Text>
            </View>

            {/* Image thumbnails */}
            {form.images.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScroll}>
                {form.images.map((uri, i) => {
                  const status = imageStatuses[i] || 'idle';
                  const progress = imageProgress[i] || 0;
                  return (
                    <View key={`img-${i}-${uri}`} style={styles.imageCard}>
                      {imageLoadErrors.has(i) ? (
                        <View style={styles.imageThumbError}>
                          <Ionicons name="image-outline" size={28} color={colors.textMuted} />
                        </View>
                      ) : (
                        <Image source={{ uri }} style={styles.imageThumb} resizeMode="cover" onError={() => {
                          setImageLoadErrors(prev => new Set(prev).add(i));
                        }} />
                      )}

                      {/* Upload overlay */}
                      {status !== 'idle' && (
                        <View style={[styles.uploadOverlay, status === 'failed' && styles.uploadOverlayFailed]}>
                          {status === 'uploading' && (
                            <>
                              <ActivityIndicator size="small" color={colors.white} />
                              <Text style={styles.uploadOverlayText}>{progress}%</Text>
                            </>
                          )}
                          {status === 'done' && (
                            <Text style={styles.uploadDoneText}>✓</Text>
                          )}
                          {status === 'failed' && (
                            <Text style={styles.uploadFailText}>!</Text>
                          )}
                        </View>
                      )}

                      {/* Remove button */}
                      {!saving && (
                        <TouchableOpacity
                          style={styles.imageRemove}
                          onPress={() => handleRemoveImage(i)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.imageRemoveText}>✕</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            )}

            {/* Add photo buttons */}
            {!saving && form.images.length < MAX_PRODUCT_IMAGES && (
              <View style={styles.imageActions}>
                <TouchableOpacity style={styles.addPhotoBtn} onPress={handleAddImages} activeOpacity={0.7}>
                  <Text style={styles.addPhotoIcon}>🖼</Text>
                  <Text style={styles.addPhotoText}>Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.addPhotoBtn} onPress={handleCamera} activeOpacity={0.7}>
                  <Text style={styles.addPhotoIcon}>📷</Text>
                  <Text style={styles.addPhotoText}>Camera</Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.fieldHint}>Tap to add up to {MAX_PRODUCT_IMAGES} product images. First image is the main photo.</Text>
          </View>

          {/* Upload progress */}
          {uploadProgress ? (
            <View style={styles.progressRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.progressText}>{uploadProgress}</Text>
            </View>
          ) : null}

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
              <ActivityIndicator color={colors.white} size="small" />
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
  dropdownItemActive: { backgroundColor: 'rgba(42,127,255,0.08)' },
  dropdownText: { color: colors.text, fontSize: 14 },

  // ── Image section ──────────────────────────────────────────────────────
  imageSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  imageCount: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  imageScroll: {
    marginBottom: 12,
  },
  imageCard: {
    width: 100,
    height: 100,
    borderRadius: 10,
    marginRight: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    position: 'relative',
  },
  imageThumb: {
    width: '100%',
    height: '100%',
  },
  imageThumbError: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageRemoveText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlaySoft,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  uploadOverlayFailed: {
    backgroundColor: 'rgba(244,33,46,0.35)',
  },
  uploadOverlayText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '600',
  },
  uploadDoneText: {
    color: colors.accentGreen,
    fontSize: 22,
    fontWeight: '700',
  },
  uploadFailText: {
    color: colors.accentRed,
    fontSize: 22,
    fontWeight: '700',
  },
  imageActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  addPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addPhotoIcon: {
    fontSize: 16,
  },
  addPhotoText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },

  // ── Upload progress ────────────────────────────────────────────────────
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    marginBottom: 8,
  },
  progressText: {
    fontSize: 13,
    color: colors.textSecondary,
  },

  // ── Toggles ────────────────────────────────────────────────────────────
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  toggleTrack: {
    width: 48, height: 28, borderRadius: 14,
    backgroundColor: colors.border, padding: 2,
  },
  toggleTrackActive: { backgroundColor: colors.accent },
  toggleThumb: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.white,
  },
  toggleThumbActive: { alignSelf: 'flex-end' },
  toggleLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  toggleHint: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },

  // ── Save button ────────────────────────────────────────────────────────
  saveBtn: {
    backgroundColor: colors.accent, paddingVertical: 16, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  saveBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
});
