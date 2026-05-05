import React, {
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, Alert, ScrollView, Platform, StyleSheet, KeyboardAvoidingView, ActivityIndicator,  } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Avatar } from '../components/Avatar';
import { useAppStore } from '../stores/app';
import { createPost } from '../lib/api';
import { colors } from '../theme/colors';

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_IMAGES = 4;
const MAX_CAPTION_LENGTH = 500;

// Use theme colors for consistency across the app
const C = {
  bg: colors.bg,
  surface: colors.surface,
  surfaceLight: colors.surfaceLight,
  textPrimary: colors.text,
  textSecondary: '#94a3b8',
  textMuted: colors.textMuted,
  primary: '#FFFFFF',
  primaryDisabled: 'rgba(255, 255, 255, 0.25)',
  red: '#f43f5e',
  border: 'rgba(255, 255, 255, 0.06)',
  borderLight: 'rgba(255, 255, 255, 0.08)',
  bgInput: colors.bgInput,
} as const;

// ── Image picker helper (lazy import to avoid crash if library not linked) ────

async function openImagePicker() {
  try {
    const { launchImageLibrary } = require('expo-image-picker');
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      selectionLimit: MAX_IMAGES,
    });
    return result;
  } catch (err) {
    console.error('[CreatePost] Image picker not available:', err);
    return { assets: [], didCancel: true, errorCode: 'unavailable', errorMessage: 'Image picker not available' };
  }
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function CreatePostScreen() {
  const navigation = useNavigation();
  const rawUser = useAppStore((s) => s.user);
  const user = rawUser
    ? {
        uid: (rawUser.uid as string) ?? '',
        username: (rawUser.username as string) ?? '',
        displayName: (rawUser.displayName as string) ?? '',
        profileImage: (rawUser.profileImage as string) ?? '',
        isVerified: (rawUser.isVerified as boolean) ?? false,
        badge: (rawUser.badge as string) ?? '',
      }
    : null;

  const [caption, setCaption] = useState('');
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);

  const textInputRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  const captionLength = caption.length;
  const canPost = caption.trim().length > 0 && !posting;

  // ── Image picker ──────────────────────────────────────────────────────

  const handleAddImages = useCallback(async () => {
    const remaining = MAX_IMAGES - selectedImages.length;
    if (remaining <= 0) {
      Alert.alert('Limit reached', `You can add up to ${MAX_IMAGES} images.`);
      return;
    }

    const result = await openImagePicker();

    if (result.didCancel || result.errorCode) return;

    const assets = result.assets ?? [];
    const newUris = assets
      .filter((a: any) => a.uri)
      .map((a: any) => a.uri)
      .slice(0, remaining);

    if (newUris.length > 0) {
      setSelectedImages((prev) => [...prev, ...newUris]);
    }
  }, [selectedImages.length]);

  const handleRemoveImage = useCallback((index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Post submission ───────────────────────────────────────────────────

  const handlePost = useCallback(async () => {
    if (!canPost || !user) return;

    setPosting(true);

    try {
      const mediaUrls = selectedImages.length > 0 ? selectedImages : [];

      await createPost(caption.trim(), mediaUrls);

      // Navigate back
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
  }, [canPost, user, caption, selectedImages, navigation]);

  // ── Character count color ─────────────────────────────────────────────

  const charCountColor = useMemo(() => {
    if (captionLength >= MAX_CAPTION_LENGTH) return C.red;
    if (captionLength >= MAX_CAPTION_LENGTH * 0.9) return C.red;
    return C.textMuted;
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
    <SafeAreaView style={styles.safeArea}>
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Custom header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerBack}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.headerBackIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Post</Text>
        {headerRight}
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Author info */}
        <View style={styles.authorRow}>
          <Avatar
            uri={user?.profileImage}
            size={40}
          />
          <View style={styles.authorInfo}>
            <Text style={styles.displayName} numberOfLines={1}>
              {user?.displayName || 'You'}
            </Text>
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
          placeholderTextColor={C.textMuted}
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
                    <Text style={styles.addImageIcon}>+</Text>
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
                  <TouchableOpacity
                    style={styles.removeImageBtn}
                    onPress={() => handleRemoveImage(item.index)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.removeImageIcon}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {/* Add photos button (when no images selected) */}
        {selectedImages.length === 0 && (
          <TouchableOpacity
            style={styles.addPhotoButton}
            onPress={handleAddImages}
            activeOpacity={0.7}
          >
            <Text style={styles.addPhotoIcon}>🖼</Text>
            <Text style={styles.addPhotoText}>Add Photos</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: C.bg,
  },
  container: {
    flex: 1,
    backgroundColor: '#000000',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
  },
  headerBack: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerBackIcon: {
    fontSize: 26,
    color: C.textPrimary,
    fontWeight: '400',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: C.textPrimary,
  },
  headerPostButton: {
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 8,
    minWidth: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerPostActive: {
    backgroundColor: '#ffffff',
  },
  headerPostInactive: {
    backgroundColor: C.primaryDisabled,
  },
  headerPostText: {
    fontSize: 15,
    fontWeight: '700',
  },
  headerPostTextActive: {
    color: '#000000',
  },
  headerPostTextInactive: {
    color: 'rgba(255, 255, 255, 0.5)',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  authorInfo: {
    flex: 1,
  },
  displayName: {
    fontSize: 15,
    fontWeight: '700',
    color: C.textPrimary,
  },
  username: {
    fontSize: 13,
    color: C.textSecondary,
  },
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
    marginBottom: 20,
  },
  charCount: {
    fontSize: 13,
    fontWeight: '500',
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  imageCard: {
    width: '47%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.borderLight,
    position: 'relative',
  },
  imageThumb: {
    width: '100%',
    height: '100%',
  },
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
  removeImageIcon: {
    fontSize: 12,
    color: '#ffffff',
    fontWeight: '600',
  },
  addImageCard: {
    width: '47%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    backgroundColor: C.surface,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  addImageIcon: {
    fontSize: 28,
    color: C.primary,
  },
  addImageText: {
    fontSize: 13,
    color: C.textSecondary,
  },
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
    backgroundColor: C.surface,
  },
  addPhotoIcon: {
    fontSize: 20,
  },
  addPhotoText: {
    fontSize: 15,
    color: C.textSecondary,
    fontWeight: '500',
  },
});
