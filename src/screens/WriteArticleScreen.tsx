import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,  } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { auth, firestore } from '../lib/firebase';
import { useAppStore } from '../stores/app';

const READING_WPM = 200;

export default function WriteArticleScreen() {
  const navigation = useNavigation();
  const { user } = useAppStore();
  const [title, setTitle] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  /* ── Word count & reading time ──────────────────────────────────────── */
  const wordCount = useMemo(() => {
    const text = `${title} ${content}`.trim();
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
  }, [title, content]);

  const readingTime = useMemo(() => {
    if (wordCount === 0) return 0;
    return Math.max(1, Math.ceil(wordCount / READING_WPM));
  }, [wordCount]);

  /* ── Save article ──────────────────────────────────────────────────── */
  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('Title Required', 'Please enter a title for your article.');
      return;
    }
    if (!content.trim()) {
      Alert.alert('Content Required', 'Please write some content for your article.');
      return;
    }

    const userId = user?.id || auth()?.currentUser?.uid;
    if (!userId) {
      Alert.alert('Error', 'You must be signed in to publish an article.');
      return;
    }

    setSaving(true);
    try {
      const authorDocSnap = await firestore()
        .collection('users')
        .doc(userId)
        .get();
      const authorData = authorDocSnap.exists ? authorDocSnap.data() : {};

      await firestore().collection('articles').add({
        authorId: userId,
        authorUsername: authorData.username || '',
        authorDisplayName: authorData.displayName || '',
        authorProfileImage: authorData.profileImage || null,
        authorBadge: authorData.badge || '',
        authorIsVerified: authorData.isVerified || false,
        title: title.trim(),
        coverImageUrl: coverImageUrl.trim() || null,
        content: content.trim(),
        wordCount,
        readingTime,
        readCount: 0,
        likeCount: 0,
        commentCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      Alert.alert('Published', 'Your article has been published successfully.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      console.error('[WriteArticle] Save failed:', e);
      Alert.alert('Error', 'Failed to publish article. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Write Article</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving || !title.trim() || !content.trim()}
        >
          <View
            style={[
              styles.saveBtn,
              (saving || !title.trim() || !content.trim()) && styles.saveBtnDisabled,
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Publish</Text>
            )}
          </View>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title */}
          <TextInput
            style={styles.titleInput}
            placeholder="Article title…"
            placeholderTextColor={colors.textMuted}
            value={title}
            onChangeText={setTitle}
            maxLength={200}
            returnKeyType="next"
          />

          {/* Cover Image URL */}
          <View style={styles.coverSection}>
            <Ionicons name="image-outline" size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.coverInput}
              placeholder="Cover image URL (optional)"
              placeholderTextColor={colors.textSecondary}
              value={coverImageUrl}
              onChangeText={setCoverImageUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="next"
            />
          </View>

          {/* Cover Image Preview */}
          {coverImageUrl.trim() ? (
            <View style={styles.coverPreviewContainer}>
              <View style={styles.coverPreviewPlaceholder}>
                <Ionicons name="image" size={40} color={colors.textSecondary} />
                <Text style={styles.coverPreviewText}>Cover image preview</Text>
              </View>
            </View>
          ) : null}

          {/* Divider */}
          <View style={styles.divider} />

          {/* Content */}
          <TextInput
            style={styles.contentInput}
            placeholder="Write your article here…"
            placeholderTextColor={colors.textMuted}
            value={content}
            onChangeText={setContent}
            multiline
            textAlignVertical="top"
            maxLength={50000}
          />
        </ScrollView>

        {/* Bottom Stats Bar */}
        <View style={styles.statsBar}>
          <Text style={styles.statsText}>
            {wordCount} {wordCount === 1 ? 'word' : 'words'}
          </Text>
          <Text style={styles.statsDivider}>·</Text>
          <Text style={styles.statsText}>
            {readingTime} min {readingTime === 1 ? 'read' : 'read'}
          </Text>
          <Text style={styles.statsDivider}>·</Text>
          <Text style={styles.statsTextLimit}>
            {title.length}/200 title
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  titleInput: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 34,
    paddingVertical: 4,
    marginBottom: 16,
  },
  coverSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  coverInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    paddingVertical: 0,
  },
  coverPreviewContainer: {
    marginTop: 12,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  coverPreviewPlaceholder: {
    height: 180,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  coverPreviewText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  divider: {
    height: 0.5,
    backgroundColor: colors.border,
    marginVertical: 16,
  },
  contentInput: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    minHeight: 400,
    textAlignVertical: 'top',
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  statsText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  statsDivider: {
    color: colors.textMuted,
    fontSize: 13,
  },
  statsTextLimit: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
