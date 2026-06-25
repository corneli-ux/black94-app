import { colors } from '../theme/colors';
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image, Alert, ScrollView,
  Platform, StyleSheet, KeyboardAvoidingView, ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import { useAppStore } from '../stores/app';
import { createPost } from '../lib/api';
import { uploadOptimizedImage, copyToSafeCache } from '../utils/imageUpload';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { AppIcon } from '../components/icons';
import { Feather } from '@expo/vector-icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const MAX_IMAGES = 4;
const MAX_CAPTION_LENGTH = 500;

const COLORS = {
  bg: colors.bg,
  surface: colors.surface,
  textPrimary: colors.text,
  textSecondary: colors.textSecondary,
  textMuted: colors.textMuted,
  white: colors.white,
  white25: colors.white25,
  white06: colors.separator,
  white08: colors.borderSubtle,
  white50: colors.white50,
  accent: colors.accent,
  red: colors.delete,
  green: colors.repost,
  amber: colors.accentGold,
  gold: colors.accent,
};

// ── Poll types ────────────────────────────────────────────────────────────
interface PollOption { id: string; text: string; }
interface PollData { question: string; options: PollOption[]; duration: number; }

// ── Per-image upload status ───────────────────────────────────────────────

type ImageUploadStatus = 'idle' | 'uploading' | 'done' | 'failed';

// ── Image picker helpers (proper permission handling) ─────────────────────

/**
 * Opens the device gallery with proper permission handling.
 *
 * On Android 13+ (API 33+), the photo picker doesn't require runtime
 * permissions — the system picker handles it. On older Android and iOS,
 * we request MEDIA_LIBRARY / PHOTO_LIBRARY permission explicitly.
 *
 * Returns null if the user denied permission or cancelled.
 */
async function openImagePicker(limit: number): Promise<ImagePicker.ImagePickerAsset[] | null> {
  try {
    // Request permission explicitly (safe no-op on Android 13+ which uses system picker)
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status === 'denied') {
      // On iOS this means the user tapped "Don't Allow" in the system dialog.
      // We can direct them to Settings to change it.
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
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: limit,
      maxWidth: 1200,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) return null;
    return result.assets.filter((a) => a.uri != null);
  } catch (err) {
    console.error('[CreatePost] Image picker error:', err);
    Alert.alert('Error', 'Something went wrong while opening the gallery. Please try again.');
    return null;
  }
}

/**
 * Opens the device camera with proper permission handling.
 *
 * Camera permission must be explicitly requested before launching the camera.
 * On Android, the permission dialog is shown once. If denied, the user must
 * go to Settings to re-enable it.
 *
 * Returns null if the user denied permission, cancelled, or the device has no camera.
 */
async function openCamera(): Promise<ImagePicker.ImagePickerAsset | null> {
  try {
    // Always request camera permission before launching
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
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsMultipleSelection: false,
      maxWidth: 1200,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) return null;
    return result.assets[0] || null;
  } catch (err: any) {
    // Some devices/emulators don't have a camera — give a clear message
    if (err?.message?.includes('Camera is not available') || err?.message?.includes('No camera')) {
      Alert.alert('Camera Unavailable', 'Your device does not have a camera or it is being used by another app.');
    } else {
      console.error('[CreatePost] Camera error:', err);
      Alert.alert('Camera Error', 'Something went wrong while opening the camera. Please try again.');
    }
    return null;
  }
}

// ── Screen ───────────────────────────────────────────────────────────────────

const CreatePostScreen: React.FC = ({ route }: any) => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const rawUser = useAppStore((s) => s.user);
  const triggerFeedRefresh = useAppStore((s) => s.triggerFeedRefresh);

  // Quote repost context (passed from FeedScreen)
  const quotePostId = route?.params?.quotePostId || null;
  const quoteAuthor = route?.params?.quoteAuthor || '';
  const quoteCaption = route?.params?.quoteCaption || '';

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
  const [imageStatuses, setImageStatuses] = useState<ImageUploadStatus[]>([]);
  const [imageProgress, setImageProgress] = useState<number[]>([]);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [pollData, setPollData] = useState<PollData | null>(null);
  const [pollOptionText, setPollOptionText] = useState('');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollDuration, setPollDuration] = useState(24);
  const [visibility, setVisibility] = useState<'public' | 'followers'>('public');
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [locationTag, setLocationTag] = useState('');
  const [showLocationInput, setShowLocationInput] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionResults, setMentionResults] = useState<any[]>([]);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionSearchTimeout, setMentionSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Thread state
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadPosition, setThreadPosition] = useState(0);
  const [threadMode, setThreadMode] = useState(false);

  // Abort controller to cancel uploads if user navigates away
  const abortRef = useRef<AbortController | null>(null);

  const captionLength = caption.length;
  const canPost = (caption.trim().length > 0 || selectedImages.length > 0 || selectedGifUrls.length > 0 || pollData) && !posting;

  // ── Mention autocomplete ───────────────────────────────────────────
  const handleCaptionChange = useCallback((text: string) => {
    setCaption(text);

    // Detect @mention at cursor position
    const lastAtIndex = text.lastIndexOf('@');
    if (lastAtIndex >= 0) {
      const afterAt = text.slice(lastAtIndex + 1);
      if (afterAt.length > 0 && !afterAt.includes(' ') && !afterAt.includes('\n')) {
        setMentionQuery(afterAt.toLowerCase());
        setShowMentionDropdown(true);
        // Debounced search
        if (mentionSearchTimeout) clearTimeout(mentionSearchTimeout);
        setMentionSearchTimeout(
          setTimeout(() => searchUsers(afterAt.toLowerCase()), 300)
        );
        return;
      }
    }
    setShowMentionDropdown(false);
    setMentionQuery('');
  }, [mentionSearchTimeout]);

  const searchUsers = useCallback(async (query: string) => {
    if (query.length < 1) {
      setMentionResults([]);
      return;
    }
    try {
      const snap = await firestore()
        .collection('users')
        .where('usernameLower', '>=', query)
        .where('usernameLower', '<=', query + '\uf8ff')
        .limit(5)
        .get();
      setMentionResults(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch {
      setMentionResults([]);
    }
  }, []);

  // ── Image actions ─────────────────────────────────────────────────────

  const handleAddImages = useCallback(async () => {
    if (posting) return;
    const remaining = MAX_IMAGES - selectedImages.length;
    if (remaining <= 0) {
      Alert.alert('Limit reached', `You can add up to ${MAX_IMAGES} images.`);
      return;
    }
    const assets = await openImagePicker(remaining);
    if (!assets || assets.length === 0) return;
    // CRITICAL FIX: On Android, expo-image-picker may return content:// URIs
    // that expo-file-system cannot read. Copy to a safe file:// path immediately.
    const safeUris = await Promise.all(
      assets.slice(0, remaining).map(a => copyToSafeCache(a.uri!).catch(() => a.uri!))
    );
    if (safeUris.length > 0) setSelectedImages((prev) => [...prev, ...safeUris]);
  }, [selectedImages.length, posting]);

  const handleCamera = useCallback(async () => {
    if (posting) return;
    const remaining = MAX_IMAGES - selectedImages.length;
    if (remaining <= 0) {
      Alert.alert('Limit reached', `You can add up to ${MAX_IMAGES} images.`);
      return;
    }
    const asset = await openCamera();
    if (!asset?.uri) return;
    const safeUri = await copyToSafeCache(asset.uri!).catch(() => asset.uri!);
    setSelectedImages((prev) => [...prev, safeUri]);
  }, [selectedImages.length, posting]);

  const handleRemoveImage = useCallback((index: number) => {
    if (posting) return;
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  }, [posting]);

  // ── GIF ───────────────────────────────────────────────────────────────

  const handleOpenGifPicker = useCallback(() => {
    if (posting) return;
    navigation.navigate('GifPicker', {
      onSelect: (gifUrl: string) => {
        setSelectedGifUrls((prev) => [...prev, gifUrl]);
      },
    });
  }, [navigation, posting]);

  const handleRemoveGif = useCallback((index: number) => {
    if (posting) return;
    setSelectedGifUrls((prev) => prev.filter((_, i) => i !== index));
  }, [posting]);

  // ── Post submission (parallel uploads + proper error handling) ────────

  const handlePost = useCallback(async () => {
    if (!canPost || !user) return;
    const currentUser = auth().currentUser;
    if (!currentUser?.uid) {
      Alert.alert('Not Signed In', 'Please sign in to create a post.');
      return;
    }

    setPosting(true);
    setUploadProgress('Preparing upload...');

    // Initialize per-image status tracking
    const statuses: ImageUploadStatus[] = selectedImages.map(() => 'uploading');
    const progresses: number[] = selectedImages.map(() => 0);
    setImageStatuses(statuses);
    setImageProgress(progresses);

    // Create abort controller for this upload session
    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      // Upload all images in parallel (not sequential)
      const uploadPromises = selectedImages.map(async (uri, i) => {
        const storagePath = `posts/${currentUser.uid}/${Date.now()}_${i}.jpg`;
        try {
          const result = await uploadOptimizedImage(uri, storagePath, {
            mimeType: 'image/jpeg',
            abortSignal: abortController.signal,
            onProgress: (loaded, total) => {
              const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
              setImageProgress((prev) => {
                const next = [...prev];
                next[i] = pct;
                return next;
              });
            },
          });

          // Mark this image as done
          setImageStatuses((prev) => {
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
          setImageStatuses((prev) => {
            const next = [...prev];
            next[i] = 'failed';
            return next;
          });
          console.error(`[CreatePost] Image ${i + 1} upload failed:`, err);
          return null; // Signal failure but don't throw
        }
      });

      const results = await Promise.all(uploadPromises);

      // Check if ALL images failed
      const failedCount = results.filter((r) => r === null).length;
      const successCount = results.length - failedCount;

      if (failedCount > 0 && successCount === 0) {
        // All uploads failed — do NOT create the post
        Alert.alert(
          'Upload Failed',
          `${failedCount} image${failedCount > 1 ? 's' : ''} could not be uploaded. Please check your connection and try again.`,
        );
        return;
      }

      if (failedCount > 0) {
        // Some uploads failed — ask the user what to do
        const shouldContinue = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Partial Upload Failure',
            `${failedCount} of ${results.length} image${failedCount > 1 ? 's' : ''} failed to upload. Your post will be created with ${successCount} image${successCount > 1 ? 's' : ''}.`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Post Anyway', onPress: () => resolve(true) },
            ],
          );
        });

        if (!shouldContinue) return;
      }

      // Build final URL list: only successfully uploaded images + GIF URLs
      const uploadedUrls = results.filter((r): r is string => r !== null);
      const allMediaUrls = [...uploadedUrls, ...selectedGifUrls];

      setUploadProgress('Posting...');
      const postId = await createPost(caption.trim(), allMediaUrls, pollData || undefined, quotePostId || undefined, visibility, scheduledDate || undefined, locationTag || undefined, threadId || undefined, threadPosition || undefined);

      // If thread mode is active, reset caption/media for next post in thread
      if (threadMode) {
        const newThreadId = threadId || postId; // first post establishes the thread ID
        setThreadId(newThreadId);
        setThreadPosition(threadPosition + 1);
        setCaption('');
        setSelectedImages([]);
        setSelectedGifUrls([]);
        setPollData(null);
        // quotePostId is a const from route.params — just clear local thread state
        setUploadProgress('');
        return; // don't navigate back, stay in composer
      }

      triggerFeedRefresh();
      navigation.goBack();
    } catch (err: any) {
      if (err?.message === 'Upload cancelled') {
        if (__DEV__) console.log('[CreatePost] Upload cancelled by user.');
        return;
      }
      console.error('[CreatePost] Failed to create post:', err);
      Alert.alert(
        'Post failed',
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setPosting(false);
      setUploadProgress('');
      setImageStatuses([]);
      setImageProgress([]);
      abortRef.current = null;
    }
  }, [canPost, user, caption, selectedImages, selectedGifUrls, navigation, triggerFeedRefresh, pollData, visibility, scheduledDate, locationTag, threadMode, threadId, threadPosition]);

  // ── Poll actions ────────────────────────────────────────────────────
  const addPollOption = useCallback(() => {
    if (!pollOptionText.trim() || (pollData?.options.length ?? 0) >= 4) return;
    const newOption: PollOption = { id: `opt_${Date.now()}`, text: pollOptionText.trim() };
    setPollData(prev => prev ? { ...prev, options: [...prev.options, newOption] } : { question: '', options: [newOption], duration: 24 });
    setPollOptionText('');
  }, [pollOptionText, pollData]);

  const removePollOption = useCallback((id: string) => {
    setPollData(prev => prev ? { ...prev, options: prev.options.filter(o => o.id !== id) } : null);
  }, []);

  const removePoll = useCallback(() => { setShowPollCreator(false); setPollData(null); setPollQuestion(''); setPollDuration(24); }, []);

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
            onPress={() => {
              // If uploading, confirm before leaving
              if (posting && abortRef.current) {
                Alert.alert('Cancel Upload?', 'Your post is being uploaded. Are you sure you want to cancel?', [
                  { text: 'Keep Uploading', style: 'cancel' },
                  { text: 'Cancel', style: 'destructive', onPress: () => { abortRef.current?.abort(); navigation.goBack(); } },
                ]);
                return;
              }
              navigation.goBack();
            }}
            style={styles.headerBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <AppIcon name="close" size="lg" color={COLORS.textPrimary} />
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
            onChangeText={handleCaptionChange}
            placeholder="What's happening?"
            placeholderTextColor={COLORS.textMuted}
            multiline
            maxLength={MAX_CAPTION_LENGTH}
            autoFocus
            textAlignVertical="top"
            scrollEnabled={false}
            editable={!posting}
          />

          {/* Quote post preview */}
          {quotePostId && (
            <View style={styles.quotePreview}>
              <View style={styles.quotePreviewLine} />
              <Text style={styles.quotePreviewAuthor}>{quoteAuthor}</Text>
              <Text style={styles.quotePreviewCaption} numberOfLines={2}>{quoteCaption}</Text>
            </View>
          )}

          {/* Character count */}
          <Text style={[styles.charCount, captionLength > MAX_CAPTION_LENGTH * 0.9 && styles.charCountWarn]}>
            {captionLength}/{MAX_CAPTION_LENGTH}
          </Text>

          {/* Media preview grid */}
          {mediaCount > 0 && (
            <View style={styles.mediaGrid}>
              {selectedImages.map((uri, i) => {
                const status = imageStatuses[i] || 'idle';
                const progress = imageProgress[i] || 0;
                return (
                  <View key={`img-${i}`} style={styles.mediaCard}>
                    <Image source={{ uri }} style={styles.mediaThumb} resizeMode="cover" />

                    {/* Upload overlay — shows during upload, success, or failure */}
                    {status !== 'idle' && (
                      <View style={[styles.uploadOverlay, status === 'failed' && styles.uploadOverlayFailed]}>
                        {status === 'uploading' && (
                          <>
                            <ActivityIndicator size="small" color={COLORS.white} />
                            <Text style={styles.uploadOverlayText}>{progress}%</Text>
                          </>
                        )}
                        {status === 'done' && (
                          <AppIcon name="check-circle" size="xl" color={COLORS.green} />
                        )}
                        {status === 'failed' && (
                          <AppIcon name="error-outline" size="xl" color={COLORS.red} />
                        )}
                      </View>
                    )}

                    {/* Remove button — only show when not uploading */}
                    {!posting && (
                      <TouchableOpacity
                        style={styles.mediaRemove}
                        onPress={() => handleRemoveImage(i)}
                        activeOpacity={0.7}
                      >
                        <AppIcon name="close" size="sm" color={COLORS.white} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
              {selectedGifUrls.map((uri, i) => (
                <View key={`gif-${i}`} style={styles.mediaCard}>
                  <Image source={{ uri }} style={styles.mediaThumb} resizeMode="cover" />
                  <View style={styles.gifBadge}>
                    <Text style={styles.gifBadgeText}>GIF</Text>
                  </View>
                  {!posting && (
                    <TouchableOpacity
                      style={styles.mediaRemove}
                      onPress={() => handleRemoveGif(i)}
                      activeOpacity={0.7}
                    >
                      <AppIcon name="close" size="sm" color={COLORS.white} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {!posting && mediaCount < MAX_IMAGES && (
                <TouchableOpacity style={styles.addMediaCard} onPress={handleAddImages} activeOpacity={0.7}>
                  <AppIcon name="add" size="xxl" color={COLORS.white50} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Upload progress summary */}
          {uploadProgress ? (
            <View style={styles.progressRow}>
              <ActivityIndicator size="small" color={COLORS.gold} />
              <Text style={styles.progressText}>{uploadProgress}</Text>
            </View>
          ) : null}

          {/* Poll Preview */}
          {pollData && (
            <View style={styles.pollPreview}>
              <View style={styles.pollHeader}>
                <AppIcon name="poll" size={20} color={COLORS.gold} />
                <Text style={styles.pollTitle}>Poll</Text>
                <TouchableOpacity onPress={removePoll} hitSlop={8}>
                  <AppIcon name="close" size="md" color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.pollQuestionText}>{pollData.question || 'Untitled poll'}</Text>
              {pollData.options.map((opt, i) => (
                <View key={opt.id} style={styles.pollOptionItem}>
                  <View style={styles.pollOptionDot}><Text style={styles.pollOptionIndex}>{i + 1}</Text></View>
                  <Text style={styles.pollOptionText}>{opt.text}</Text>
                </View>
              ))}
              <Text style={styles.pollDurationText}>{pollData.duration}h duration</Text>
            </View>
          )}

          {/* Poll Creator */}
          {showPollCreator && (
            <View style={styles.pollCreator}>
              <Text style={styles.pollCreatorTitle}>Create Poll</Text>
              <TextInput style={styles.pollInput} value={pollQuestion} onChangeText={setPollQuestion} placeholder="Ask a question..." placeholderTextColor={COLORS.textMuted} maxLength={120} />
              {pollData?.options.map((opt, i) => (
                <View key={opt.id} style={styles.pollOptionRow}>
                  <Text style={styles.pollOptionNumber}>{i + 1}.</Text>
                  <Text style={styles.pollOptionLabel}>{opt.text}</Text>
                  <TouchableOpacity onPress={() => removePollOption(opt.id)} hitSlop={8}><AppIcon name="cancel" size="md" color={colors.like} /></TouchableOpacity>
                </View>
              ))}
              <View style={styles.pollAddRow}>
                <TextInput style={styles.pollAddInput} value={pollOptionText} onChangeText={setPollOptionText} placeholder="Add option..." placeholderTextColor={COLORS.textMuted} maxLength={40} onSubmitEditing={addPollOption} />
                <TouchableOpacity onPress={addPollOption} disabled={!pollOptionText.trim() || (pollData?.options.length ?? 0) >= 4} style={styles.pollAddBtn}>
                  <AppIcon name="add" size={20} color={COLORS.gold} />
                </TouchableOpacity>
              </View>
              <View style={styles.pollDurationRow}>
                <Text style={styles.pollDurationLabel}>Duration</Text>
                {[24, 48, 72].map(h => (
                  <TouchableOpacity key={h} onPress={() => setPollDuration(h)} style={[styles.pollDurationBtn, pollDuration === h && styles.pollDurationBtnActive]}>
                    <Text style={[styles.pollDurationBtnText, pollDuration === h && styles.pollDurationBtnTextActive]}>{h}h</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={styles.pollCreateBtn} onPress={() => {
                if (!pollData?.options.length) return;
                setPollData(prev => prev ? { ...prev, question: pollQuestion.trim() || 'Untitled poll' } : prev);
                setShowPollCreator(false);
              }}><Text style={styles.pollCreateBtnText}>Done</Text></TouchableOpacity>
            </View>
          )}

          {/* Schedule Post Section */}
          {scheduleMode && (
            <View style={styles.scheduleSection}>
              <View style={styles.scheduleHeader}>
                <AppIcon name="schedule" size="md" color={COLORS.gold} />
                <Text style={styles.scheduleTitle}>Schedule Post</Text>
                <TouchableOpacity onPress={() => setScheduleMode(false)} hitSlop={8}>
                  <AppIcon name="close" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.scheduleHint}>
                Post will be published at the selected date and time.
              </Text>
              <TextInput
                style={styles.scheduleInput}
                value={scheduledDate}
                onChangeText={setScheduledDate}
                placeholder="e.g. 2025-01-15 14:00"
                placeholderTextColor={COLORS.textMuted}
              />
              <Text style={styles.scheduleFormat}>Format: YYYY-MM-DD HH:MM</Text>
            </View>
          )}

          {/* Location Tag Section */}
          {showLocationInput && (
            <View style={styles.locationSection}>
              <View style={styles.locationHeader}>
                <AppIcon name="location-on" size="md" color={COLORS.green} />
                <Text style={styles.locationTitle}>Add Location</Text>
                <TouchableOpacity onPress={() => { setShowLocationInput(false); setLocationTag(''); }} hitSlop={8}>
                  <AppIcon name="close" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.locationInput}
                value={locationTag}
                onChangeText={setLocationTag}
                placeholder="Enter a place name..."
                placeholderTextColor={COLORS.textMuted}
                maxLength={100}
                returnKeyType="done"
              />
            </View>
          )}

          {/* Thread Mode Indicator */}
          {threadMode && (
            <View style={styles.threadSection}>
              <View style={styles.threadHeader}>
                <AppIcon name="call-split" size="md" color={COLORS.accent} />
                <Text style={styles.threadTitle}>
                  {threadId ? `Thread — Post ${threadPosition + 1}` : 'Thread Mode'}
                </Text>
                <TouchableOpacity onPress={() => setThreadMode(false)} hitSlop={8}>
                  <AppIcon name="close" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.threadHint}>
                {threadId
                  ? 'Publish to add the next post in your thread. Each post is added sequentially.'
                  : 'Your first post will start the thread. Keep posting to add more.'}
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Mention autocomplete dropdown */}
        {showMentionDropdown && mentionResults.length > 0 && (
          <View style={[styles.mentionDropdown, { bottom: 70 + insets.bottom || 70 }]}>
            {mentionResults.map(user => (
              <TouchableOpacity
                key={user.id}
                style={styles.mentionItem}
                onPress={() => {
                  const lastAtIndex = caption.lastIndexOf('@');
                  const newCaption = caption.slice(0, lastAtIndex + 1) + (user.username || '') + ' ';
                  setCaption(newCaption);
                  setShowMentionDropdown(false);
                  setMentionResults([]);
                }}
                activeOpacity={0.7}
              >
                <Avatar uri={user.profileImage} name={user.displayName} size={32} />
                <View style={styles.mentionUserInfo}>
                  <Text style={styles.mentionName}>{user.displayName || user.username}</Text>
                  <Text style={styles.mentionHandle}>@{user.username}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Bottom toolbar */}
        <View style={[styles.toolbar, { paddingBottom: Math.max(8, insets.bottom) }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbarScroll}>
          <View style={styles.toolbarActions}>
            <TouchableOpacity
              style={[styles.toolBtn, posting && styles.toolBtnDisabled]}
              onPress={handleAddImages}
              activeOpacity={0.7}
              disabled={posting}
            >
              <Feather name="image" size={22} color={posting ? COLORS.textMuted : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolBtn, posting && styles.toolBtnDisabled]}
              onPress={handleCamera}
              activeOpacity={0.7}
              disabled={posting}
            >
              <Feather name="camera" size={22} color={posting ? COLORS.textMuted : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolBtn, posting && styles.toolBtnDisabled]}
              onPress={handleOpenGifPicker}
              activeOpacity={0.7}
              disabled={posting}
            >
              <Feather name="film" size={22} color={posting ? COLORS.textMuted : colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolBtn, posting && styles.toolBtnDisabled]}
              onPress={() => !posting && setShowPollCreator(!showPollCreator)}
              activeOpacity={0.7}
              disabled={posting}
            >
              <Feather name="bar-chart-2" size={22} color={posting ? COLORS.textMuted : (pollData ? COLORS.gold : colors.textSecondary)} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolBtn, posting && styles.toolBtnDisabled]}
              onPress={() => {
                if (posting) return;
                setScheduleMode(!scheduleMode);
                if (scheduleMode) setScheduledDate('');
              }}
              activeOpacity={0.7}
              disabled={posting}
            >
              <Feather name="clock" size={22} color={posting ? COLORS.textMuted : (scheduleMode ? COLORS.gold : colors.textSecondary)} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolBtn, posting && styles.toolBtnDisabled]}
              onPress={() => {
                if (posting) return;
                setShowLocationInput(!showLocationInput);
                if (showLocationInput) setLocationTag('');
              }}
              activeOpacity={0.7}
              disabled={posting}
            >
              <Feather name="map-pin" size={22} color={posting ? COLORS.textMuted : (locationTag ? COLORS.gold : colors.textSecondary)} />
            </TouchableOpacity>
            {/* Thread toggle */}
            <TouchableOpacity
              style={[styles.toolBtn, posting && styles.toolBtnDisabled]}
              onPress={() => {
                if (posting) return;
                setThreadMode(!threadMode);
                if (!threadMode) {
                  // Starting a new thread
                  setThreadId(null);
                  setThreadPosition(0);
                }
              }}
              activeOpacity={0.7}
              disabled={posting}
            >
              <Feather name="git-branch" size={22} color={posting ? COLORS.textMuted : (threadMode ? COLORS.accent : colors.textSecondary)} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toolBtn, posting && styles.toolBtnDisabled]}
              onPress={() => {
                if (posting) return;
                Alert.alert('Post Visibility', 'Who can see this post?', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: visibility === 'public' ? '✓ Public' : 'Public',
                    onPress: () => setVisibility('public'),
                  },
                  {
                    text: visibility === 'followers' ? '✓ Followers Only' : 'Followers Only',
                    onPress: () => setVisibility('followers'),
                  },
                ]);
              }}
              activeOpacity={0.7}
              disabled={posting}
            >
              <Feather name={visibility === 'public' ? 'globe' : 'users'} size={22} color={posting ? COLORS.textMuted : (visibility === 'public' ? colors.textSecondary : COLORS.gold)} />
            </TouchableOpacity>
          </View>
          </ScrollView>
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
  quotePreview: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.accent || colors.accent,
  },
  quotePreviewLine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: COLORS.accent || colors.accent,
  },
  quotePreviewAuthor: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  quotePreviewCaption: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 18,
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
    backgroundColor: colors.overlayDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gifBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: colors.overlayHeavy,
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
  // Upload status overlay on individual images
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayMedium,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  uploadOverlayFailed: {
    backgroundColor: colors.destructiveBg,
  },
  uploadOverlayText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
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
  pollPreview: {
    marginHorizontal: 16, marginTop: 16, padding: 14,
    borderRadius: 12, backgroundColor: colors.accentFaint,
    borderWidth: 1, borderColor: colors.accentBorder,
  },
  pollHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  pollTitle: { color: COLORS.gold, fontSize: 15, fontWeight: '700' },
  pollQuestionText: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '600', marginBottom: 8 },
  pollOptionItem: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  pollOptionDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accentBgStrong, alignItems: 'center', justifyContent: 'center' },
  pollOptionIndex: { color: COLORS.gold, fontSize: 12, fontWeight: '700' },
  pollOptionText: { color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  pollDurationText: { color: COLORS.textSecondary, fontSize: 12, marginTop: 8 },
  pollCreator: {
    margin: 16, padding: 16, borderRadius: 14, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: colors.borderSubtle,
  },
  pollCreatorTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 12 },
  pollInput: {
    backgroundColor: colors.bgSubtle, borderWidth: 1, borderColor: colors.borderSubtle,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: COLORS.textPrimary, fontSize: 15,
  },
  pollOptionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, gap: 10, borderBottomWidth: 0.5, borderBottomColor: colors.separator },
  pollOptionNumber: { color: COLORS.textSecondary, fontSize: 14, width: 20 },
  pollOptionLabel: { color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  pollAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  pollAddInput: {
    flex: 1, backgroundColor: colors.bgSubtle, borderWidth: 1, borderColor: colors.borderSubtle,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: COLORS.textPrimary, fontSize: 15,
  },
  pollAddBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentBgStrong, alignItems: 'center', justifyContent: 'center' },
  pollDurationRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  pollDurationLabel: { color: COLORS.textSecondary, fontSize: 13 },
  pollDurationBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.bgInput, borderWidth: 1, borderColor: colors.borderSubtle },
  pollDurationBtnActive: { backgroundColor: colors.accentBorder, borderColor: colors.accentBorderHeavy },
  pollDurationBtnText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  pollDurationBtnTextActive: { color: COLORS.gold, fontSize: 14, fontWeight: '600' },
  pollCreateBtn: { marginTop: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  pollCreateBtnText: { color: colors.primaryForeground, fontSize: 15, fontWeight: '700' },
  toolbar: {
    backgroundColor: COLORS.bg,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.white06,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  toolbarScroll: {
    alignItems: 'center',
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
  toolBtnDisabled: {
    opacity: 0.4,
  },
  scheduleSection: {
    margin: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  scheduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  scheduleTitle: {
    color: COLORS.gold,
    fontSize: 15,
    fontWeight: '700',
  },
  scheduleHint: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginBottom: 10,
  },
  scheduleInput: {
    backgroundColor: colors.bgSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: COLORS.textPrimary,
    fontSize: 15,
  },
  scheduleFormat: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  locationSection: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  locationTitle: {
    color: COLORS.green,
    fontSize: 15,
    fontWeight: '700',
  },
  locationInput: {
    backgroundColor: colors.bgSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: COLORS.textPrimary,
    fontSize: 15,
  },
  /* ── Thread Section ──────────────────────────────────────────────────── */
  threadSection: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.accentBg,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  threadTitle: {
    color: COLORS.accent,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  threadHint: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  mentionDropdown: {
    position: 'absolute',
    bottom: 70,
    left: 16,
    right: 16,
    maxHeight: 200,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    shadowColor: colors.primaryForeground,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
    zIndex: 50,
    overflow: 'hidden',
  },
  mentionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
  },
  mentionUserInfo: {
    flex: 1,
  },
  mentionName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  mentionHandle: {
    color: colors.textMuted,
    fontSize: 12,
  },
});

export default CreatePostScreen;
