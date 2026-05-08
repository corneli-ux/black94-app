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
import { Ionicons } from '@expo/vector-icons';

import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppStore } from '../stores/app';
import { createPost } from '../lib/api';
import { uploadFile, getFilePath } from '../lib/storage';
import { auth } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { ImageIcon, GIFIcon, EmojiIcon, CameraIcon } from '../components/Icons';

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_IMAGES = 4;
const MAX_CAPTION_LENGTH = 4000;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COLORS = {
  bg: '#000000',
  surface: '#16181c',
  textPrimary: '#e7e9ea',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  primary: '#FFFFFF',
  red: '#f43f5e',
  accent: '#2a7fff',
  green: '#00ba7c',
  amber: '#f59e0b',
  border: 'rgba(255, 255, 255, 0.06)',
} as const;

// ── Emoji data ───────────────────────────────────────────────────────────────

const EMOJI_CATEGORIES = [
  { name: 'Smileys', icon: '\uD83D\uDE0A', emojis: ['\uD83D\uDE00','\uD83D\uDE01','\uD83D\uDE02','\uD83E\uDD23','\uD83D\uDE03','\uD83D\uDE04','\uD83D\uDE05','\uD83D\uDE06','\uD83D\uDE09','\uD83D\uDE0A','\uD83D\uDE0B','\uD83D\uDE0E','\uD83D\uDE0D','\uD83D\uDE18','\uD83D\uDE17','\uD83D\uDE1A','\uD83D\uDE19','\uD83D\uDE1C','\uD83E\uDD17','\uD83D\uDE1F','\uD83E\uDD29','\uD83E\uDD28','\uD83D\uDE36','\uD83D\uDE10','\uD83D\uDE11','\uD83D\uDE2F','\uD83D\uDE07','\uD83D\uDE34','\uD83D\uDE35','\uD83D\uDE2E','\uD83D\uDE2C','\uD83D\uDE2B','\uD83D\uDE2D','\uD83D\uDE30','\uD83D\uDE0C','\uD83D\uDE1B','\uD83D\uDE14','\uD83E\uDD11','\uD83D\uDE20','\uD83D\uDE21','\uD83D\uDE24','\uD83D\uDE22','\uD83D\uDE2A','\uD83D\uDE16','\uD83D\uDE23','\uD83E\uDD2E','\uD83D\uDE33','\uD83D\uDE31','\uD83E\uDD75','\uD83D\uDE3B','\uD83D\uDC7F','\uD83D\uDE08','\uD83E\uDD21','\uD83D\uDC80','\u2620\uFE0F','\uD83D\uDC7B','\uD83D\uDC7D','\uD83E\uDD16'] },
  { name: 'Gestures', icon: '\uD83D\uDC4B', emojis: ['\uD83D\uDC4B','\uD83E\uDD1A','\uD83D\uDD90\uFE0F','\u270B','\uD83E\uDD96','\uD83D\uDC4C','\uD83E\uDD1E','\uD83E\uDD1F','\uD83E\uDD18','\u270C\uFE0F','\uD83E\uDD1C','\uD83D\uDC46','\u261D\uFE0F','\uD83D\uDC47','\uD83D\uDC48','\u2B06\uFE0F','\uD83D\uDC4F','\uD83E\uDD1D','\uD83D\uDE4C','\uD83D\uDE4F','\uD83E\uDD0D','\uD83E\uDD1B','\uD83D\uDC49','\uD83D\uDE4C','\u2764\uFE0F','\uD83E\uDDE1','\uD83D\uDE46','\uD83D\uDE47','\uD83E\uDDCF','\uD83D\uDC4E','\uD83E\uDD2B','\uD83E\uDD0C','\uD83D\uDC50','\uD83E\uDD1A','\uD83D\uDC42','\uD83E\uDDB4','\uD83D\uDC4A','\uD83E\uDDB5','\uD83D\uDC95'] },
  { name: 'Hearts', icon: '\u2764\uFE0F', emojis: ['\u2764\uFE0F','\uD83E\uDDE1','\uD83D\uDD8D','\uD83D\uDC9B','\uD83D\uDC99','\uD83D\uDC9C','\uD83D\uDDA4','\uD83D\uDEE0','\uD83D\uDC9A','\u2764\uFE0F\u200D\uD83D\uDD25','\u2764\uFE0F\u200D\uD83E\uDD0D','\uD83D\uDC9D','\uD83D\uDD17','\uD83D\uDC93','\uD83D\uDC97','\uD83D\uDC98','\uD83D\uDC96','\uD83D\uDC9E','\uD83D\uDD2B','\uD83D\uDD2C'] },
  { name: 'Objects', icon: '\uD83C\uDF89', emojis: ['\uD83D\uDD25','\u2B50','\uD83C\uDF1F','\uD83D\uDCAB','\u2728','\u26A1','\uD83C\uDF89','\uD83C\uDF8A','\uD83C\uDF88','\uD83C\uDF81','\uD83C\uDFC6','\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49','\u26BD','\uD83C\uDFC0','\uD83C\uDFC8','\u26BE','\uD83C\uDFAE','\uD83C\uDFAF','\uD83C\uDFB5','\uD83C\uDFB6','\uD83C\uDFB8','\uD83C\uDFB4','\uD83C\uDFAC','\uD83D\uDCF7','\uD83D\uDCF1','\uD83D\uDCBB','\uD83D\uDCA1','\uD83D\uDCCC','\u2705','\u274C','\u26A1'] },
];

// ── Image picker helper (uses expo-image-picker) ─────────────────────────────

async function openImagePicker(limit: number) {
  try {
    const { launchImageLibrary } = require('expo-image-picker');
    const result = await launchImageLibrary({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: limit > 1,
      selectionLimit: limit,
    });
    return result;
  } catch (err) {
    console.error('[CreatePost] Image picker not available:', err);
    return { canceled: true, assets: [] };
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
  const [uploading, setUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiCat, setActiveEmojiCat] = useState(0);

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
    if (result.canceled) return;

    const assets = result.assets ?? [];
    const newUris = assets
      .filter((a: any) => a.uri)
      .map((a: any) => a.uri as string)
      .slice(0, remaining);

    if (newUris.length > 0) {
      setSelectedImages((prev) => [...prev, ...newUris]);
    }
  }, [selectedImages.length]);

  const handleRemoveImage = useCallback((index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Camera (opens image picker in camera mode) ─────────────────────────

  const handleCamera = useCallback(async () => {
    try {
      const { launchCamera } = require('expo-image-picker');
      const result = await launchCamera({
        mediaTypes: ['images'],
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.length) return;
      const uri = result.assets[0].uri;
      if (uri) setSelectedImages((prev) => [...prev, uri]);
    } catch (err) {
      Alert.alert('Camera', 'Camera not available on this device.');
    }
  }, []);

  // ── GIF picker (opens image picker filtered to GIF) ────────────────────

  const handleGIF = useCallback(() => {
    navigation.navigate('GifPicker' as never, {
      onSelect: (gifUrl: string) => {
        setSelectedImages((prev) => [...prev, gifUrl]);
      },
    } as never);
  }, [navigation]);

  // ── Emoji ────────────────────────────────────────────────────────────

  const handleInsertEmoji = useCallback((emoji: string) => {
    setCaption((prev) => prev + emoji);
  }, []);

  // ── Post submission ───────────────────────────────────────────────────

  const handlePost = useCallback(async () => {
    if (!canPost || !user) return;
    setPosting(true);
    try {
      // Upload images to Firebase Storage first
      let mediaUrls = selectedImages;
      if (selectedImages.length > 0) {
        setUploading(true);
        const uid = auth()?.currentUser?.uid || user.id;
        const uploadPromises = selectedImages.map((uri) => {
          const filename = uri.split('/').pop() || `image_${Date.now()}.jpg`;
          const path = getFilePath('posts', filename, uid);
          return uploadFile(uri, path);
        });
        mediaUrls = await Promise.all(uploadPromises);
        setUploading(false);
      }

      await createPost(caption.trim(), mediaUrls);
      triggerFeedRefresh();
      navigation.goBack();
    } catch (err) {
      setUploading(false);
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
    if (captionLength >= MAX_CAPTION_LENGTH * 0.9) return COLORS.red;
    return COLORS.textMuted;
  }, [captionLength]);

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
          uploading ? (
            <Text style={[styles.headerPostText, styles.headerPostTextActive]}>
              Uploading...
            </Text>
          ) : (
            <ActivityIndicator size="small" color="#ffffff" />
          )
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
    [canPost, posting, uploading, handlePost],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
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
            placeholder="What is happening?!"
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={MAX_CAPTION_LENGTH}
            autoFocus
            textAlignVertical="top"
            scrollEnabled={false}
          />

          {/* Character count — subtle, right-aligned */}
          {captionLength > 0 && (
            <View style={styles.charCountRow}>
              <Text style={[styles.charCount, { color: charCountColor }]}>
                {MAX_CAPTION_LENGTH - captionLength} characters left
              </Text>
            </View>
          )}

          {/* Image preview strip — horizontal scroll, compact thumbnails */}
          {selectedImages.length > 0 && (
            <View style={styles.imageStrip}>
              {selectedImages.map((uri, i) => (
                <View key={uri} style={styles.imageThumbCard}>
                  <Image source={{ uri }} style={styles.imageThumb} resizeMode="cover" />
                  <TouchableOpacity
                    style={styles.removeImageBtn}
                    onPress={() => handleRemoveImage(i)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={11} color="#ffffff" />
                  </TouchableOpacity>
                </View>
              ))}
              {selectedImages.length < MAX_IMAGES && (
                <TouchableOpacity
                  style={styles.addMoreCard}
                  onPress={handleAddImages}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add" size={22} color={COLORS.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
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

        {/* Bottom action bar — compact icon row */}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(8, insets.bottom) }]}>
          <View style={styles.bottomBarActions}>
            <TouchableOpacity style={styles.bottomActionBtn} onPress={handleAddImages}>
              <ImageIcon size={22} color={COLORS.accent} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.bottomActionBtn} onPress={handleCamera}>
              <CameraIcon size={22} color={COLORS.green} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.bottomActionBtn} onPress={handleGIF}>
              <GIFIcon size={22} color={COLORS.amber} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.bottomActionBtn, showEmojiPicker && styles.bottomActionBtnActive]}
              onPress={() => { setShowEmojiPicker(!showEmojiPicker); }}
            >
              <EmojiIcon size={22} color={showEmojiPicker ? COLORS.amber : COLORS.accent} />
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  headerBack: {
    width: 36,
    height: 36,
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
    paddingVertical: 6,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerPostActive: { backgroundColor: COLORS.accent },
  headerPostInactive: { backgroundColor: 'rgba(42,127,255,0.2)' },
  headerPostText: { fontSize: 14, fontWeight: '700' },
  headerPostTextActive: { color: '#ffffff' },
  headerPostTextInactive: { color: 'rgba(42,127,255,0.5)' },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  authorInfo: { flex: 1 },
  displayName: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  username: { fontSize: 13, color: COLORS.textSecondary },

  captionInput: {
    fontSize: 17,
    color: '#e7e9ea',
    lineHeight: 24,
    minHeight: 100,
    maxHeight: 280,
    padding: 0,
    margin: 0,
  },

  charCountRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
    marginBottom: 8,
  },
  charCount: { fontSize: 12, fontWeight: '500' },

  /* ── Image strip: horizontal, compact ── */
  imageStrip: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    paddingRight: 4,
  },
  imageThumbCard: {
    width: 72,
    height: 72,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: COLORS.border,
    position: 'relative',
  },
  imageThumb: { width: '100%', height: '100%' },
  removeImageBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addMoreCard: {
    width: 72,
    height: 72,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* ── Emoji Picker ── */
  emojiPickerPanel: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 8,
    marginBottom: 12,
  },
  emojiCategoryBar: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
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

  /* ── Bottom Action Bar ── */
  bottomBar: {
    backgroundColor: '#000000',
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  bottomBarActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bottomActionBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  bottomActionBtnActive: { backgroundColor: 'rgba(245, 158, 11, 0.15)' },

  /* Character Circle */
  charCircle: { alignItems: 'center', justifyContent: 'center' },
  charCircleTrack: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  charCircleText: { fontSize: 9, fontWeight: '700' },
});

export default CreatePostScreen;
