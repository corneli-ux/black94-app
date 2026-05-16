import React, {
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ScrollView,
  Platform,
  StyleSheet,
  KeyboardAvoidingView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { ImagePickerAsset, ImagePickerResult } from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';

import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppStore } from '../stores/app';
import { createPost } from '../lib/api';
import { Avatar, VerifiedBadge } from '../components/Avatar';

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_IMAGES = 4;
const MAX_CAPTION_LENGTH = 500;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Image Filters ────────────────────────────────────────────────────────────

const IMAGE_FILTERS = [
  { id: 'none', label: 'Original', overlay: 'transparent' },
  { id: 'warm', label: 'Warm', overlay: 'rgba(255, 165, 0, 0.15)' },
  { id: 'cool', label: 'Cool', overlay: 'rgba(0, 100, 255, 0.15)' },
  { id: 'vintage', label: 'Vintage', overlay: 'rgba(128, 128, 0, 0.15)' },
  { id: 'bw', label: 'B&W', overlay: 'rgba(128, 128, 128, 0.5)' },
  { id: 'vivid', label: 'Vivid', overlay: 'rgba(255, 0, 128, 0.12)' },
];

const COLORS = {
  bg: '#000000',
  surface: '#16181c',
  surfaceLight: '#18181b',
  textPrimary: '#e7e9ea',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  primary: '#FFFFFF',
  primaryDisabled: 'rgba(255, 255, 255, 0.25)',
  red: '#f43f5e',
  border: 'rgba(255, 255, 255, 0.06)',
  borderLight: 'rgba(255, 255, 255, 0.08)',
  accent: '#1d9bf0',
  green: '#00ba7c',
} as const;

// ── Emoji data ───────────────────────────────────────────────────────────────

const EMOJI_CATEGORIES = [
  { name: 'Smileys', icon: '\uD83D\uDE0A', emojis: ['\uD83D\uDE00','\uD83D\uDE01','\uD83D\uDE02','\uD83E\uDD23','\uD83D\uDE03','\uD83D\uDE04','\uD83D\uDE05','\uD83D\uDE06','\uD83D\uDE09','\uD83D\uDE0A','\uD83D\uDE0B','\uD83D\uDE0E','\uD83D\uDE0D','\uD83D\uDE18','\uD83D\uDE17','\uD83D\uDE1A','\uD83D\uDE19','\uD83D\uDE1C','\uD83E\uDD17','\uD83D\uDE1F','\uD83E\uDD29','\uD83E\uDD28','\uD83D\uDE36','\uD83D\uDE10','\uD83D\uDE11','\uD83D\uDE2F','\uD83D\uDE07','\uD83D\uDE34','\uD83D\uDE35','\uD83D\uDE2E','\uD83D\uDE2C','\uD83D\uDE2B','\uD83D\uDE2D','\uD83D\uDE30','\uD83D\uDE0C','\uD83D\uDE1B','\uD83D\uDE14','\uD83E\uDD11','\uD83D\uDE20','\uD83D\uDE21','\uD83D\uDE24','\uD83D\uDE22','\uD83D\uDE2A','\uD83D\uDE16','\uD83D\uDE23','\uD83E\uDD2E','\uD83D\uDE33','\uD83D\uDE31','\uD83E\uDD75','\uD83D\uDE3B','\uD83D\uDC7F','\uD83D\uDE08','\uD83E\uDD21','\uD83D\uDC80','\u2620\uFE0F','\uD83D\uDC7B','\uD83D\uDC7D','\uD83E\uDD16'] },
  { name: 'Gestures', icon: '\uD83D\uDC4B', emojis: ['\uD83D\uDC4B','\uD83E\uDD1A','\uD83D\uDD90\uFE0F','\u270B','\uD83E\uDD96','\uD83D\uDC4C','\uD83E\uDD1E','\uD83E\uDD1F','\uD83E\uDD18','\u270C\uFE0F','\uD83E\uDD1C','\uD83D\uDC46','\u261D\uFE0F','\uD83D\uDC47','\uD83D\uDC48','\u2B06\uFE0F','\uD83D\uDC4F','\uD83E\uDD1D','\uD83D\uDE4C','\uD83D\uDE4F','\uD83E\uDD0D','\uD83E\uDD1B','\uD83D\uDC49','\uD83D\uDE4C','\u2764\uFE0F','\uD83E\uDDE1','\uD83D\uDE46','\uD83D\uDE47','\uD83E\uDDCF','\uD83D\uDC4E','\uD83E\uDD2B','\uD83E\uDD0C','\uD83D\uDC50','\uD83E\uDD1A','\uD83D\uDC42','\uD83E\uDDB4','\uD83D\uDC4A','\uD83E\uDDB5','\uD83D\uDC95'] },
  { name: 'Hearts', icon: '\u2764\uFE0F', emojis: ['\u2764\uFE0F','\uD83E\uDDE1','\uD83D\uDD8D','\uD83D\uDC9B','\uD83D\uDC99','\uD83D\uDC9C','\uD83D\uDDA4','\uD83D\uDEE0','\uD83D\uDC9A','\u2764\uFE0F\u200D\uD83D\uDD25','\u2764\uFE0F\u200D\uD83E\uDD0D','\uD83D\uDC9D','\uD83D\uDD17','\uD83D\uDC93','\uD83D\uDC97','\uD83D\uDC98','\uD83D\uDC96','\uD83D\uDC9E','\uD83D\uDD2B','\uD83D\uDD2C'] },
  { name: 'Objects', icon: '\uD83C\uDF89', emojis: ['\uD83D\uDD25','\u2B50','\uD83C\uDF1F','\uD83D\uDCAB','\u2728','\u26A1','\uD83C\uDF89','\uD83C\uDF8A','\uD83C\uDF88','\uD83C\uDF81','\uD83C\uDFC6','\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49','\u26BD','\uD83C\uDFC0','\uD83C\uDFC8','\u26BE','\uD83C\uDFAE','\uD83C\uDFAF','\uD83C\uDFB5','\uD83C\uDFB6','\uD83C\uDFB8','\uD83C\uDFB4','\uD83C\uDFAC','\uD83D\uDCF7','\uD83D\uDCF1','\uD83D\uDCBB','\uD83D\uDCA1','\uD83D\uDCCC','\u2705','\u274C','\u26A1'] },
];

// ── Image picker helper (lazy import to avoid crash if library not linked) ────

async function openImagePicker(limit: number): Promise<ImagePickerResult> {
  try {
    const { launchImageLibraryAsync } = require('expo-image-picker');
    const result: ImagePickerResult = await launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: limit,
      maxWidth: 1200,
    });
    return result;
  } catch (err) {
    console.error('[CreatePost] Image picker not available:', err);
    return { canceled: true, assets: null } as any;
  }
}

// ── Screen ───────────────────────────────────────────────────────────────────

const CreatePostScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const insets = useSafeAreaInsets();
  const rawUser = useAppStore((s) => s.user);
  const triggerFeedRefresh = useAppStore((s) => s.triggerFeedRefresh);
  const user = rawUser
    ? {
        id: rawUser.id ?? '',
        username: rawUser.username ?? '',
        displayName: rawUser.displayName ?? '',
        profileImage: rawUser.profileImage ?? '',
        isVerified: rawUser.isVerified ?? false,
        badge: rawUser.badge ?? '',
      }
    : null;

  const [caption, setCaption] = useState('');
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiCat, setActiveEmojiCat] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState('none');

  const textInputRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  const captionLength = caption.length;
  const canPost = (caption.trim().length > 0 || selectedImages.length > 0) && !posting;

  // ── Image picker ──────────────────────────────────────────────────────

  const handleAddImages = useCallback(async () => {
    const remaining = MAX_IMAGES - selectedImages.length;
    if (remaining <= 0) {
      Alert.alert('Limit reached', `You can add up to ${MAX_IMAGES} images.`);
      return;
    }

    const result = await openImagePicker(remaining);
    if (result.canceled || !result.assets || result.assets.length === 0) return;

    const assets: ImagePickerAsset[] = result.assets ?? [];
    const newUris = assets
      .filter((a) => a.uri)
      .map((a) => a.uri!)
      .slice(0, remaining);

    if (newUris.length > 0) {
      setSelectedImages((prev) => [...prev, ...newUris]);
    }
  }, [selectedImages.length]);

  const handleRemoveImage = useCallback((index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Camera ──────────────────────────────────────────────────────────

  const handleCamera = useCallback(async () => {
    try {
      const { launchCameraAsync } = require('expo-image-picker');
      const remaining = MAX_IMAGES - selectedImages.length;
      if (remaining <= 0) {
        Alert.alert('Limit reached', `You can add up to ${MAX_IMAGES} images.`);
        return;
      }
      const result = await launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsMultipleSelection: false,
        maxWidth: 1200,
      });
      if (result.canceled || !result.assets?.length) return;
      const uri = result.assets[0].uri;
      if (uri) setSelectedImages(prev => [...prev, uri]);
    } catch (err) {
      console.error('[CreatePost] Camera error:', err);
      Alert.alert('Camera', 'Could not access camera.');
    }
  }, [selectedImages.length]);

  // ── Emoji ────────────────────────────────────────────────────────────

  const handleInsertEmoji = useCallback((emoji: string) => {
    setCaption((prev) => prev + emoji);
  }, []);

  // ── Post submission ───────────────────────────────────────────────────

  const handlePost = useCallback(async () => {
    if (!canPost || !user) return;
    setPosting(true);
    try {
      await createPost(caption.trim(), selectedImages);
      triggerFeedRefresh();
      navigation.goBack();
    } catch (err) {
      console.error('[CreatePost] Failed to create post:', err);
      Alert.alert(
        'Post failed',
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setPosting(false);
    }
  }, [canPost, user, caption, selectedImages, navigation, triggerFeedRefresh]);

  // ── Character count color ─────────────────────────────────────────────

  const charCountColor = useMemo(() => {
    if (captionLength >= MAX_CAPTION_LENGTH) return COLORS.red;
    if (captionLength >= MAX_CAPTION_LENGTH * 0.9) return COLORS.red;
    return COLORS.textMuted;
  }, [captionLength]);

  // ── Image grid ────────────────────────────────────────────────────────

  const imageGridItems = useMemo(
    () => [
      ...selectedImages.map((uri, i) => ({
        _type: 'image' as const,
        uri,
        index: i,
      })),
      ...(selectedImages.length < MAX_IMAGES
        ? [{ _type: 'add' as const }]
        : []),
    ],
    [selectedImages],
  );

  // ── Header right action ───────────────────────────────────────────────

  const headerRight = useMemo(
    () => (
      <TouchableOpacity
        style={[
          styles.headerPostButton,
          canPost ? styles.headerPostActive : styles.headerPostInactive,
        ]}
        onPress={handlePost}
        disabled={!canPost}
        activeOpacity={0.7}
      >
        {posting ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : (
          <Text
            style={[
              styles.headerPostText,
              canPost
                ? styles.headerPostTextActive
                : styles.headerPostTextInactive,
            ]}
          >
            Post
          </Text>
        )}
      </TouchableOpacity>
    ),
    [canPost, posting, handlePost],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Custom header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.headerBack}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Post</Text>
          {headerRight}
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(20, insets.bottom + 80) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Author info */}
          <View style={styles.authorRow}>
            <Avatar uri={user?.profileImage} name={user?.displayName} size={40} />
            <View style={styles.authorInfo}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={styles.displayName} numberOfLines={1}>
                  {user?.displayName || 'You'}
                </Text>
                <VerifiedBadge badge={user?.badge || ''} isVerified={user?.isVerified || false} size={16} />
              </View>
              <Text style={styles.username} numberOfLines={1}>
                @{user?.username || 'user'}
              </Text>
            </View>
          </View>

          {/* Caption input */}
          <TextInput
            ref={textInputRef}
            style={styles.captionInput}
            value={caption}
            onChangeText={setCaption}
            placeholder="What's on your mind?"
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={MAX_CAPTION_LENGTH}
            autoFocus
            textAlignVertical="top"
            scrollEnabled={false}
          />

          {/* Character count */}
          <View style={styles.charCountRow}>
            <Text style={[styles.charCount, { color: charCountColor }]}>
              {captionLength}/{MAX_CAPTION_LENGTH}
            </Text>
          </View>

          {/* Image grid */}
          {imageGridItems.length > 0 && (
            <View style={styles.imageGrid}>
              {imageGridItems.map((item, i) => {
                if (item._type === 'add') {
                  return (
                    <TouchableOpacity
                      key="add"
                      style={styles.addImageCard}
                      onPress={handleAddImages}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="image-outline" size={28} color={COLORS.primary} />
                      <Text style={styles.addImageText}>Add Photo</Text>
                    </TouchableOpacity>
                  );
                }

                return (
                  <View key={item.uri} style={styles.imageCard}>
                    <Image
                      source={{ uri: item.uri }}
                      style={styles.imageThumb}
                      resizeMode="cover"
                    />
                    {selectedFilter !== 'none' && (() => {
                      const f = IMAGE_FILTERS.find(x => x.id === selectedFilter);
                      return f ? (
                        <View style={[styles.filterImageOverlay, { backgroundColor: f.overlay }]} />
                      ) : null;
                    })()}
                    <TouchableOpacity
                      style={styles.removeImageBtn}
                      onPress={() => handleRemoveImage(item.index)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="close" size={12} color="#ffffff" />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          {/* Filter picker — shown when images are selected */}
          {selectedImages.length > 0 && (
            <View style={styles.filterRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
                {IMAGE_FILTERS.map((f) => {
                  const isActive = selectedFilter === f.id;
                  const activeFilterData = IMAGE_FILTERS.find(x => x.id === selectedFilter);
                  return (
                    <TouchableOpacity
                      key={f.id}
                      style={[styles.filterCircleWrap, isActive && styles.filterCircleWrapActive]}
                      onPress={() => setSelectedFilter(f.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.filterPreviewBox}>
                        <Image
                          source={{ uri: selectedImages[0] }}
                          style={styles.filterPreviewThumb}
                          resizeMode="cover"
                        />
                        <View
                          style={[
                            styles.filterPreviewOverlay,
                            { backgroundColor: f.overlay },
                          ]}
                        />
                      </View>
                      <Text style={[styles.filterLabel, isActive && styles.filterLabelActive]}>
                        {f.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Add photos button (when no images selected) */}
          {selectedImages.length === 0 && (
            <TouchableOpacity
              style={styles.addPhotoButton}
              onPress={handleAddImages}
              activeOpacity={0.7}
            >
              <Ionicons name="image-outline" size={22} color={COLORS.accent} />
              <Text style={styles.addPhotoText}>Add Photos</Text>
            </TouchableOpacity>
          )}

          {/* Emoji Picker Panel */}
          {showEmojiPicker && (
            <View style={styles.emojiPickerPanel}>
              <View style={styles.emojiCategoryBar}>
                {EMOJI_CATEGORIES.map((cat, idx) => (
                  <TouchableOpacity
                    key={cat.name}
                    style={[styles.emojiCategoryBtn, activeEmojiCat === idx && styles.emojiCategoryBtnActive]}
                    onPress={() => setActiveEmojiCat(idx)}
                  >
                    <Text style={styles.emojiCategoryIcon}>{cat.icon}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.emojiGrid}>
                {EMOJI_CATEGORIES[activeEmojiCat]?.emojis.map((emoji, idx) => (
                  <TouchableOpacity
                    key={`${activeEmojiCat}-${idx}`}
                    style={styles.emojiBtn}
                    onPress={() => handleInsertEmoji(emoji)}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.emojiCharacter}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        {/* Bottom action bar - sticky above keyboard */}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(8, insets.bottom) }]}>
          <View style={styles.bottomBarActions}>
            <TouchableOpacity style={styles.bottomActionBtn} onPress={handleAddImages}>
              <Ionicons name="image-outline" size={22} color={COLORS.accent} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.bottomActionBtn} onPress={handleCamera}>
              <Ionicons name="camera-outline" size={22} color={COLORS.green} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.bottomActionBtn} onPress={() => Alert.alert('GIF', 'GIF support coming in the next update! Stay tuned.')}>
              <Ionicons name="film-outline" size={22} color="#f59e0b" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.bottomActionBtn, showEmojiPicker && styles.bottomActionBtnActive]}
              onPress={() => { setShowEmojiPicker(!showEmojiPicker); }}
            >
              <Ionicons name="happy-outline" size={22} color={showEmojiPicker ? '#f59e0b' : COLORS.accent} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            {captionLength > 0 && (
              <View style={styles.charCircle}>
                <View style={[styles.charCircleTrack, { borderColor: charCountColor }]}>
                  <Text style={[styles.charCircleText, { color: charCountColor }]}>
                    {Math.round((captionLength / MAX_CAPTION_LENGTH) * 100)}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerBack: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  headerPostButton: {
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 8,
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerPostActive: { backgroundColor: COLORS.primary },
  headerPostInactive: { backgroundColor: COLORS.primaryDisabled },
  headerPostText: { fontSize: 15, fontWeight: '700' },
  headerPostTextActive: { color: '#000000' },
  headerPostTextInactive: { color: 'rgba(255, 255, 255, 0.5)' },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  authorInfo: { flex: 1 },
  displayName: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  username: { fontSize: 13, color: COLORS.textSecondary },
  captionInput: {
    fontSize: 17,
    color: '#e7e9ea',
    lineHeight: 24,
    minHeight: 120,
    maxHeight: 300,
    padding: 0,
    margin: 0,
  },
  charCountRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
    marginBottom: 16,
  },
  charCount: { fontSize: 13, fontWeight: '500' },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  imageCard: {
    width: '47%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    position: 'relative',
  },
  imageThumb: { width: '100%', height: '100%' },
  removeImageBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addImageCard: {
    width: '47%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  addImageText: { fontSize: 13, color: COLORS.textSecondary },
  addPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: COLORS.surface,
  },
  addPhotoText: { fontSize: 15, color: COLORS.textSecondary, fontWeight: '500' },

  /* Emoji Picker */
  emojiPickerPanel: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 8,
    marginBottom: 16,
  },
  emojiCategoryBar: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    paddingBottom: 8,
  },
  emojiCategoryBtn: {
    padding: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiCategoryBtnActive: { backgroundColor: 'rgba(255,255,255,0.1)' },
  emojiCategoryIcon: { fontSize: 20 },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  emojiBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  emojiCharacter: { fontSize: 22 },

  /* Bottom Action Bar - sticky */
  bottomBar: {
    backgroundColor: '#000000',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  bottomBarActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bottomActionBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  bottomActionBtnActive: { backgroundColor: 'rgba(245, 158, 11, 0.15)' },

  /* Filter Image Overlay — applied over each image in the grid */
  filterImageOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  /* Filter Picker Row */
  filterRow: {
    marginBottom: 16,
    paddingBottom: 4,
  },
  filterScrollContent: {
    gap: 12,
    paddingRight: 8,
  },
  filterCircleWrap: {
    alignItems: 'center',
    gap: 4,
    opacity: 0.6,
  },
  filterCircleWrapActive: {
    opacity: 1,
  },
  filterPreviewBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  filterPreviewThumb: {
    width: '100%',
    height: '100%',
  },
  filterPreviewOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  filterLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  filterLabelActive: {
    color: COLORS.textPrimary,
    fontWeight: '700',
  },

  /* Character Circle */
  charCircle: { alignItems: 'center', justifyContent: 'center' },
  charCircleTrack: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  charCircleText: { fontSize: 10, fontWeight: '700' },
});

export default CreatePostScreen;
