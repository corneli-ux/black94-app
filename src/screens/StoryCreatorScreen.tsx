import React, { useCallback, useLayoutEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, firestore } from '../lib/firebase';
import { fetchUserProfile } from '../lib/api';
import { uploadOptimizedImage } from '../utils/imageUpload';
import { colors } from '../theme/colors';

type StoryFormat = 'text' | 'image' | 'poll';

const GRADIENTS: { key: string; color: string; label: string }[] = [
  { key: 'purple', color: '#667eea', label: 'Purple' },
  { key: 'sunset', color: '#f093fb', label: 'Sunset' },
  { key: 'ocean', color: '#4facfe', label: 'Ocean' },
  { key: 'forest', color: '#43e97b', label: 'Forest' },
  { key: 'fire', color: '#fa709a', label: 'Fire' },
  { key: 'night', color: '#a18cd1', label: 'Night' },
  { key: 'blue', color: '#2193b0', label: 'Blue' },
  { key: 'dark', color: '#232526', label: 'Dark' },
];

const FONT_SIZES = [
  { value: 24, label: 'Small' },
  { value: 32, label: 'Medium' },
  { value: 42, label: 'Large' },
  { value: 56, label: 'Extra Large' },
];

async function uploadImage(uri: string, storagePath: string): Promise<string> {
  const result = await uploadOptimizedImage(uri, storagePath, {
    mimeType: 'image/jpeg',
  });
  return result.downloadUrl;
}

// Lazy image picker
async function openImageLibrary() {
  try {
    const { launchImageLibrary } = require('expo-image-picker');
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      maxWidth: 1080,
    });
    return result;
  } catch (err) {
    console.warn('[StoryCreatorScreen] Image picker not available:', err);
    return null;
  }
}

export default function StoryCreatorScreen({ navigation }: any) {
  const currentUid = auth()?.currentUser?.uid ?? '';

  const [format, setFormat] = useState<StoryFormat>('text');
  const [storyText, setStoryText] = useState('');
  const [selectedGradient, setSelectedGradient] = useState('purple');
  const [fontSize, setFontSize] = useState(32);
  const [imageUri, setImageUri] = useState('');
  const [imageCaption, setImageCaption] = useState('');
  const [audience, setAudience] = useState<'everyone' | 'followers'>('everyone');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={handlePost}
          disabled={posting}
          style={styles.postButton}
          activeOpacity={0.7}
        >
          {posting ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={styles.postButtonText}>Post</Text>
          )}
        </TouchableOpacity>
      ),
    });
  }, [navigation, posting, format, storyText, selectedGradient, fontSize, imageUri, audience, pollQuestion, pollOptions]);

  const pickImage = useCallback(async () => {
    try {
      const result = await openImageLibrary();
      if (!result) return;
      if (result.assets && result.assets.length > 0) {
        setImageUri(result.assets[0].uri ?? '');
      }
    } catch (e) {
      console.warn('[StoryCreatorScreen] image picker error:', e);
    }
  }, []);

  const handlePost = useCallback(async () => {
    if (!currentUid) return;

    if (format === 'text' && !storyText.trim()) {
      Alert.alert('Error', 'Please enter story text');
      return;
    }
    if (format === 'image' && !imageUri) {
      Alert.alert('Error', 'Please select an image');
      return;
    }
    if (format === 'poll') {
      if (!pollQuestion.trim()) {
        Alert.alert('Error', 'Please enter a poll question');
        return;
      }
      const validOptions = pollOptions.filter((o) => o.trim());
      if (validOptions.length < 2) {
        Alert.alert('Error', 'Please enter at least 2 poll options');
        return;
      }
    }

    setPosting(true);
    try {
      let mediaUrl = '';
      let content = '';
      let pollOptionsData: Array<{ id: string; text: string; votes: number; percentage: number }> | undefined;

      let authorUsername = '';
      let authorDisplayName = '';
      let authorProfileImage = '';
      try {
        const userData = await fetchUserProfile(currentUid);
        if (userData) {
          authorUsername = userData.username;
          authorDisplayName = userData.displayName;
          authorProfileImage = userData.profileImage || '';
        }
      } catch {}

      if (format === 'text') {
        mediaUrl = selectedGradient;
        content = storyText.trim();
      } else if (format === 'image') {
        if (imageUri && !imageUri.startsWith('http')) {
          setUploading(true);
          try {
            mediaUrl = await uploadImage(
              imageUri,
              `stories/${currentUid}/${Date.now()}.jpg`,
            );
          } catch (uploadErr: any) {
            console.error('[StoryCreatorScreen] Image upload failed:', uploadErr);
            Alert.alert('Upload Error', 'Failed to upload image. Please try again.');
            setPosting(false);
            setUploading(false);
            return;
          } finally {
            setUploading(false);
          }
        } else {
          mediaUrl = imageUri;
        }
        content = imageCaption.trim();
      } else if (format === 'poll') {
        content = pollQuestion.trim();
        mediaUrl = selectedGradient;
        pollOptionsData = pollOptions
          .filter((o) => o.trim())
          .map((o) => ({
            id: `opt_${Math.random().toString(36).slice(2, 9)}`,
            text: o.trim(),
            votes: 0,
            percentage: 0,
          }));
      }

      await firestore().collection('stories').add({
        authorId: currentUid,
        authorUsername,
        authorDisplayName,
        authorProfileImage,
        authorIsVerified: false,
        format,
        content,
        mediaUrl,
        pollOptions: pollOptionsData || null,
        audience,
        expiry: '24h',
        createdAt: firestore.FieldValue.serverTimestamp(),
        viewCount: 0,
        likeCount: 0,
      });

      Alert.alert('Success', 'Story posted!', [
        { text: 'OK', onPress: () => navigation.navigate('Stories') },
      ]);
    } catch (e: any) {
      Alert.alert('Story', 'Could not post story. Please try again.');
    }
    setPosting(false);
  }, [
    currentUid,
    format,
    storyText,
    selectedGradient,
    imageUri,
    imageCaption,
    audience,
    pollQuestion,
    pollOptions,
    navigation,
  ]);

  const addPollOption = useCallback(() => {
    if (pollOptions.length < 5) {
      setPollOptions((prev) => [...prev, '']);
    }
  }, [pollOptions.length]);

  const updatePollOption = useCallback((index: number, value: string) => {
    setPollOptions((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  }, []);

  const removePollOption = useCallback((index: number) => {
    if (pollOptions.length <= 2) return;
    setPollOptions((prev) => prev.filter((_, i) => i !== index));
  }, [pollOptions.length]);

  const gradientObj = GRADIENTS.find((g) => g.key === selectedGradient);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Format Selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Story Type</Text>
            <View style={styles.formatRow}>
              {(['text', 'image', 'poll'] as StoryFormat[]).map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[styles.formatButton, format === f && styles.formatButtonSelected]}
                  onPress={() => setFormat(f)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.formatButtonText,
                      format === f && styles.formatButtonTextSelected,
                    ]}
                  >
                    {f === 'text' ? '📝 Text' : f === 'image' ? '🖼️ Image' : '📊 Poll'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Preview */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Preview</Text>
            <View style={styles.previewContainer}>
              {format === 'text' && (
                <View style={[styles.previewGradient, { backgroundColor: gradientObj?.color ?? '#667eea' }]}>
                  <Text
                    style={[styles.previewText, { fontSize }]}
                    numberOfLines={5}
                  >
                    {storyText || 'Your story text...'}
                  </Text>
                </View>
              )}

              {format === 'image' && (
                <TouchableOpacity onPress={pickImage} activeOpacity={0.8}>
                  {uploading ? (
                    <View style={[styles.previewImagePlaceholder, { justifyContent: 'center', alignItems: 'center' }]}>
                      <ActivityIndicator size="large" color={colors.accent} />
                      <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 12 }}>Uploading…</Text>
                    </View>
                  ) : imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="contain" />
                  ) : (
                    <View style={styles.previewImagePlaceholder}>
                      <Text style={styles.previewPlaceholderText}>+ Select Image</Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}

              {format === 'poll' && (
                <View style={[styles.previewGradient, { backgroundColor: gradientObj?.color ?? '#667eea' }]}>
                  <Text style={styles.previewPollQuestion}>
                    {pollQuestion || 'Your poll question...'}
                  </Text>
                  <View style={styles.previewPollOptions}>
                    {pollOptions
                      .filter((o) => o.trim())
                      .slice(0, 3)
                      .map((opt, i) => (
                        <View key={i} style={styles.previewPollOption}>
                          <Text style={styles.previewPollOptionText}>{opt}</Text>
                        </View>
                      ))}
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Text Story Fields */}
          {format === 'text' && (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Story Text</Text>
                <TextInput
                  style={styles.textInput}
                  value={storyText}
                  onChangeText={setStoryText}
                  placeholder="What's on your mind?"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  maxLength={200}
                  textAlignVertical="top"
                />
                <Text style={styles.charCount}>{storyText.length}/200</Text>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Background</Text>
                <View style={styles.gradientGrid}>
                  {GRADIENTS.map((g) => (
                    <TouchableOpacity
                      key={g.key}
                      style={[
                        styles.gradientCircle,
                        selectedGradient === g.key && styles.gradientCircleSelected,
                      ]}
                      onPress={() => setSelectedGradient(g.key)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.gradientCircleInner, { backgroundColor: g.color }]} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Font Size</Text>
                <View style={styles.fontSizeRow}>
                  {FONT_SIZES.map((fs) => (
                    <TouchableOpacity
                      key={fs.value}
                      style={[styles.fontSizeButton, fontSize === fs.value && styles.fontSizeButtonSelected]}
                      onPress={() => setFontSize(fs.value)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.fontSizeButtonText,
                          fontSize === fs.value && styles.fontSizeButtonTextSelected,
                        ]}
                      >
                        {fs.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </>
          )}

          {/* Image Story Fields */}
          {format === 'image' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Caption (optional)</Text>
              <TextInput
                style={styles.textInput}
                value={imageCaption}
                onChangeText={setImageCaption}
                placeholder="Add a caption..."
                placeholderTextColor={colors.textMuted}
                maxLength={100}
              />
            </View>
          )}

          {/* Poll Story Fields */}
          {format === 'poll' && (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Poll Question</Text>
                <TextInput
                  style={styles.textInput}
                  value={pollQuestion}
                  onChangeText={setPollQuestion}
                  placeholder="Ask something..."
                  placeholderTextColor={colors.textMuted}
                  maxLength={100}
                />
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Options</Text>
                {pollOptions.map((opt, i) => (
                  <View key={i} style={styles.pollInputRow}>
                    <TextInput
                      style={[styles.textInput, styles.pollInput]}
                      value={opt}
                      onChangeText={(v) => updatePollOption(i, v)}
                      placeholder={`Option ${i + 1}`}
                      placeholderTextColor={colors.textMuted}
                      maxLength={50}
                    />
                    {pollOptions.length > 2 && (
                      <TouchableOpacity
                        onPress={() => removePollOption(i)}
                        style={styles.removePollOption}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.removePollOptionText}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                {pollOptions.length < 5 && (
                  <TouchableOpacity onPress={addPollOption} style={styles.addOptionBtn} activeOpacity={0.7}>
                    <Text style={styles.addOptionText}>+ Add Option</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Background</Text>
                <View style={styles.gradientGrid}>
                  {GRADIENTS.map((g) => (
                    <TouchableOpacity
                      key={g.key}
                      style={[
                        styles.gradientCircle,
                        selectedGradient === g.key && styles.gradientCircleSelected,
                      ]}
                      onPress={() => setSelectedGradient(g.key)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.gradientCircleInner, { backgroundColor: g.color }]} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </>
          )}

          {/* Audience Selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Audience</Text>
            <View style={styles.audienceRow}>
              {(['everyone', 'followers'] as const).map((a) => (
                <TouchableOpacity
                  key={a}
                  style={[styles.audienceButton, audience === a && styles.audienceButtonSelected]}
                  onPress={() => setAudience(a)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.audienceButtonText,
                      audience === a && styles.audienceButtonTextSelected,
                    ]}
                  >
                    {a === 'everyone' ? '🌍 Everyone' : '👥 Followers Only'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  postButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  postButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.accent,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  formatRow: {
    flexDirection: 'row',
    gap: 8,
  },
  formatButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  formatButtonSelected: {
    borderColor: colors.accent,
    backgroundColor: `${colors.accent}15`,
  },
  formatButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  formatButtonTextSelected: {
    color: colors.accent,
  },
  previewContainer: {
    borderRadius: 16,
    overflow: 'hidden',
    height: 300,
  },
  previewGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  previewText: {
    color: colors.white,
    textAlign: 'center',
    lineHeight: 40,
    fontWeight: '700',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewImagePlaceholder: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 16,
  },
  previewPlaceholderText: {
    fontSize: 16,
    color: colors.textMuted,
  },
  previewPollQuestion: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.white,
    textAlign: 'center',
    marginBottom: 16,
  },
  previewPollOptions: {
    width: '100%',
    gap: 8,
  },
  previewPollOption: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    padding: 12,
  },
  previewPollOptionText: {
    fontSize: 14,
    color: colors.white,
    textAlign: 'center',
  },
  textInput: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  charCount: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'right',
    marginTop: 4,
  },
  gradientGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gradientCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  gradientCircleSelected: {
    borderColor: colors.white,
  },
  gradientCircleInner: {
    flex: 1,
  },
  fontSizeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  fontSizeButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  fontSizeButtonSelected: {
    borderColor: colors.accent,
    backgroundColor: `${colors.accent}15`,
  },
  fontSizeButtonText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  fontSizeButtonTextSelected: {
    color: colors.accent,
  },
  pollInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  pollInput: {
    flex: 1,
  },
  removePollOption: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removePollOptionText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  addOptionBtn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  addOptionText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  audienceRow: {
    flexDirection: 'row',
    gap: 8,
  },
  audienceButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  audienceButtonSelected: {
    borderColor: colors.accent,
    backgroundColor: `${colors.accent}15`,
  },
  audienceButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  audienceButtonTextSelected: {
    color: colors.accent,
  },
});
