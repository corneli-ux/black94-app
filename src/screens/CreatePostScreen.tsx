import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image, Alert, ScrollView,
  Platform, StyleSheet, KeyboardAvoidingView, ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { ImagePickerAsset, ImagePickerResult } from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';

import { useAppStore } from '../stores/app';
import { createPost } from '../lib/api';
import { uploadOptimizedImage } from '../utils/imageUpload';
import { auth } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const MAX_IMAGES = 4;
const MAX_CAPTION_LENGTH = 500;

const COLORS = {
  bg: '#000000',
  surface: '#16181c',
  textPrimary: '#e7e9ea',
  textSecondary: '#71767b',
  textMuted: '#536471',
  white: '#FFFFFF',
  white25: 'rgba(255,255,255,0.25)',
  white06: 'rgba(255,255,255,0.06)',
  white08: 'rgba(255,255,255,0.08)',
  white50: 'rgba(255,255,255,0.5)',
  accent: '#1d9bf0',
  red: '#f4212e',
  green: '#00ba7c',
  amber: '#ffd400',
};

// ── Image picker helper ─────────────────────────────────────────────────────

async function openImagePicker(limit: number): Promise<ImagePickerResult> {
  try {
    const { launchImageLibraryAsync } = require('expo-image-picker');
    const result: ImagePickerResult = await launchImageLibraryAsync({
      mediaTypes: ['images'],
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

async function openCamera(): Promise<ImagePickerResult> {
  try {
    const { launchCameraAsync } = require('expo-image-picker');
    const result: ImagePickerResult = await launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: false,
      maxWidth: 1200,
    });
    return result;
  } catch (err) {
    console.error('[CreatePost] Camera not available:', err);
    return { canceled: true, assets: null } as any;
  }
}

// ── Screen ───────────────────────────────────────────────────────────────────

const CreatePostScreen: React.FC = () => {
  const navigation = useNavigation<any>();
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
  const [selectedGifUrls, setSelectedGifUrls] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  const captionLength = caption.length;
  const canPost = (caption.trim().length > 0 || selectedImages.length > 0 || selectedGifUrls.length > 0) && !posting;

  // ── Image actions ─────────────────────────────────────────────────────

  const handleAddImages = useCallback(async () => {
    const remaining = MAX_IMAGES - selectedImages.length;
    if (remaining <= 0) {
      Alert.alert('Limit reached', `You can add up to ${MAX_IMAGES} images.`);
      return;
    }
    const result = await openImagePicker(remaining);
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const uris = result.assets.filter((a) => a.uri).map((a) => a.uri!).slice(0, remaining);
    if (uris.length > 0) setSelectedImages((prev) => [...prev, ...uris]);
  }, [selectedImages.length]);

  const handleCamera = useCallback(async () => {
    const remaining = MAX_IMAGES - selectedImages.length;
    if (remaining <= 0) {
      Alert.alert('Limit reached', `You can add up to ${MAX_IMAGES} images.`);
      return;
    }
    const result = await openCamera();
    if (result.canceled || !result.assets?.length) return;
    const uri = result.assets[0].uri;
    if (uri) setSelectedImages((prev) => [...prev, uri]);
  }, [selectedImages.length]);

  const handleRemoveImage = useCallback((index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── GIF ───────────────────────────────────────────────────────────────

  const handleOpenGifPicker = useCallback(() => {
    navigation.navigate('GifPicker', {
      onSelect: (gifUrl: string) => {
        setSelectedGifUrls((prev) => [...prev, gifUrl]);
      },
    });
  }, [navigation]);

  const handleRemoveGif = useCallback((index: number) => {
    setSelectedGifUrls((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Post submission ───────────────────────────────────────────────────

  const handlePost = useCallback(async () => {
    if (!canPost || !user) return;
    const currentUser = auth().currentUser;
    if (!currentUser?.uid) {
      Alert.alert('Not Signed In', 'Please sign in to create a post.');
      return;
    }
    setPosting(true);
    setUploadProgress('');
    try {
      const uploadedUrls: string[] = [];

      // Upload images
      if (selectedImages.length > 0) {
        for (let i = 0; i < selectedImages.length; i++) {
          try {
            setUploadProgress(`Uploading image ${i + 1}/${selectedImages.length}...`);
            const storagePath = `posts/${currentUser?.uid}/${Date.now()}_${i}.jpg`;
            const result = await uploadOptimizedImage(selectedImages[i], storagePath, {
              mimeType: 'image/jpeg',
              onProgress: (loaded, total) => {
                const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
                setUploadProgress(`Uploading image ${i + 1}/${selectedImages.length}... ${pct}%`);
              },
            });
            uploadedUrls.push(result.downloadUrl);
          } catch (err) {
            console.error('[CreatePost] Image upload failed:', err);
            Alert.alert('Upload Error', `Failed to upload image ${i + 1}. Your post will be created without it.`);
          }
        }
      }

      setUploadProgress('Posting...');
      await createPost(caption.trim(), [...uploadedUrls, ...selectedGifUrls]);
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
      setUploadProgress('');
    }
  }, [canPost, user, caption, selectedImages, selectedGifUrls, navigation, triggerFeedRefresh]);

  // ── Image grid ────────────────────────────────────────────────────────

  const mediaCount = selectedImages.length + selectedGifUrls.length;

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
            style={styles.headerBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>New Post</Text>
          <TouchableOpacity
            style={[styles.postButton, canPost && styles.postButtonActive]}
            onPress={handlePost}
            disabled={!canPost}
            activeOpacity={0.7}
          >
            {posting ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text style={[styles.postButtonText, canPost && styles.postButtonTextActive]}>Post</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(20, insets.bottom + 80) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Author row */}
          <View style={styles.authorRow}>
            <Avatar uri={user?.profileImage} name={user?.displayName} size={42} />
            <View style={styles.authorInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.displayName} numberOfLines={1}>
                  {user?.displayName || 'You'}
                </Text>
                <VerifiedBadge badge={user?.badge || ''} isVerified={user?.isVerified || false} size={16} />
              </View>
            </View>
          </View>

          {/* Caption input */}
          <TextInput
            style={styles.captionInput}
            value={caption}
            onChangeText={setCaption}
            placeholder="What's happening?"
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={MAX_CAPTION_LENGTH}
            autoFocus
            textAlignVertical="top"
            scrollEnabled={false}
          />

          {/* Character count */}
          <Text style={[styles.charCount, captionLength > MAX_CAPTION_LENGTH * 0.9 && styles.charCountWarn]}>
            {captionLength}/{MAX_CAPTION_LENGTH}
          </Text>

          {/* Media preview grid */}
          {mediaCount > 0 && (
            <View style={styles.mediaGrid}>
              {selectedImages.map((uri, i) => (
                <View key={`img-${i}`} style={styles.mediaCard}>
                  <Image source={{ uri }} style={styles.mediaThumb} resizeMode="cover" />
                  <TouchableOpacity
                    style={styles.mediaRemove}
                    onPress={() => handleRemoveImage(i)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={14} color={COLORS.white} />
                  </TouchableOpacity>
                </View>
              ))}
              {selectedGifUrls.map((uri, i) => (
                <View key={`gif-${i}`} style={styles.mediaCard}>
                  <Image source={{ uri }} style={styles.mediaThumb} resizeMode="cover" />
                  <View style={styles.gifBadge}>
                    <Text style={styles.gifBadgeText}>GIF</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.mediaRemove}
                    onPress={() => handleRemoveGif(i)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={14} color={COLORS.white} />
                  </TouchableOpacity>
                </View>
              ))}
              {mediaCount < MAX_IMAGES && (
                <TouchableOpacity style={styles.addMediaCard} onPress={handleAddImages} activeOpacity={0.7}>
                  <Ionicons name="add" size={28} color={COLORS.white50} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Upload progress */}
          {uploadProgress ? (
            <View style={styles.progressRow}>
              <ActivityIndicator size="small" color={COLORS.accent} />
              <Text style={styles.progressText}>{uploadProgress}</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Bottom toolbar — sticky above keyboard */}
        <View style={[styles.toolbar, { paddingBottom: Math.max(8, insets.bottom) }]}>
          <View style={styles.toolbarActions}>
            {/* Gallery */}
            <TouchableOpacity style={styles.toolBtn} onPress={handleAddImages} activeOpacity={0.7}>
              <Ionicons name="images-outline" size={22} color={COLORS.accent} />
            </TouchableOpacity>
            {/* Camera */}
            <TouchableOpacity style={styles.toolBtn} onPress={handleCamera} activeOpacity={0.7}>
              <Ionicons name="camera-outline" size={22} color={COLORS.green} />
            </TouchableOpacity>
            {/* GIF */}
            <TouchableOpacity style={styles.toolBtn} onPress={handleOpenGifPicker} activeOpacity={0.7}>
              <Ionicons name="gif-outline" size={22} color={COLORS.amber} />
            </TouchableOpacity>
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
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.white06,
  },
  headerBtn: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  postButton: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 7,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white25,
  },
  postButtonActive: {
    backgroundColor: COLORS.white,
  },
  postButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.white50,
  },
  postButtonTextActive: {
    color: COLORS.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  authorInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  displayName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  captionInput: {
    fontSize: 17,
    color: COLORS.textPrimary,
    lineHeight: 24,
    minHeight: 100,
    maxHeight: 280,
    padding: 0,
    margin: 0,
  },
  charCount: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textMuted,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 12,
  },
  charCountWarn: {
    color: COLORS.red,
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  mediaCard: {
    width: (SCREEN_WIDTH - 32 - 8) / 2,
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.white08,
    position: 'relative',
  },
  mediaThumb: {
    width: '100%',
    height: '100%',
  },
  mediaRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gifBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gifBadgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  addMediaCard: {
    width: (SCREEN_WIDTH - 32 - 8) / 2,
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.white08,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  progressText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  toolbar: {
    backgroundColor: COLORS.bg,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.white06,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  toolBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default CreatePostScreen;
