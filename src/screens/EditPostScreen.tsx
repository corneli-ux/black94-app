import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis } from '../lib/api';

/* ── Constants ──────────────────────────────────────────────────────────────── */

const MAX_CAPTION_LENGTH = 500;

/* ── Screen ────────────────────────────────────────────────────────────────── */

export default function EditPostScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { postId } = (route.params as { postId: string }) || {};
  const insets = useSafeAreaInsets();

  // ── State ───────────────────────────────────────────────────────────────
  const [caption, setCaption] = useState('');
  const [originalCaption, setOriginalCaption] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track whether user has made changes for unsaved-changes warning
  const hasChanges = caption !== originalCaption;
  const captionLength = caption.length;
  const canSave = caption.trim().length > 0
    && caption.length <= MAX_CAPTION_LENGTH
    && hasChanges
    && !saving;

  // ── Fetch post ──────────────────────────────────────────────────────────
  const loadPost = useCallback(async () => {
    if (!postId) {
      setError('No post ID provided');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const docSnap = await firestore().collection('posts').doc(postId).get();

      if (!docSnap.exists) {
        setError('This post doesn\'t exist or has been deleted');
        setLoading(false);
        return;
      }

      const data = docSnap.data();
      if (!data) {
        setError('Failed to load post data');
        setLoading(false);
        return;
      }

      // Verify the current user owns this post
      const currentUid = auth()?.currentUser?.uid;
      if (data.authorId && data.authorId !== currentUid) {
        Alert.alert('Access Denied', 'You can only edit your own posts.');
        navigation.goBack();
        return;
      }

      const loadedCaption = data.caption || '';
      setCaption(loadedCaption);
      setOriginalCaption(loadedCaption);
    } catch (e: any) {
      console.error('[EditPost] Failed to load post:', e?.message);
      setError(e?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [postId, navigation]);

  useEffect(() => {
    loadPost();
  }, [loadPost]);

  // ── Save post ───────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!postId || !canSave) return;

    const trimmedCaption = caption.trim();

    if (trimmedCaption.length === 0) {
      Alert.alert('Error', 'Caption cannot be empty');
      return;
    }

    if (trimmedCaption.length > MAX_CAPTION_LENGTH) {
      Alert.alert('Error', `Caption exceeds ${MAX_CAPTION_LENGTH} character limit`);
      return;
    }

    setSaving(true);

    try {
      await firestore().collection('posts').doc(postId).update({
        caption: trimmedCaption,
        editedAt: firestore.FieldValue.serverTimestamp(),
        isEdited: true,
      });

      // Trigger feed refresh so the feed reflects the updated caption
      try {
        const { useAppStore } = require('../stores/app');
        useAppStore.getState().triggerFeedRefresh();
      } catch {}

      navigation.goBack();
    } catch (e: any) {
      console.error('[EditPost] Failed to save post:', e?.message);
      Alert.alert(
        'Save Failed',
        e?.message || 'Could not update your post. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }, [postId, caption, canSave, navigation]);

  // ── Back with unsaved changes warning ───────────────────────────────────
  const handleBack = useCallback(() => {
    if (hasChanges && !saving) {
      Alert.alert(
        'Unsaved Changes',
        'You have unsaved changes. Are you sure you want to leave?',
        [
          { text: 'Keep Editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
        ],
      );
    } else {
      navigation.goBack();
    }
  }, [hasChanges, saving, navigation]);

  // ── Render: Loading ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  // ── Render: Error ───────────────────────────────────────────────────────
  if (error) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
              <Ionicons name="arrow-back" size={22} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Edit Post</Text>
            <View style={{ width: 40 }} />
          </View>
        </SafeAreaView>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadPost}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

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
            onPress={handleBack}
            hitSlop={8}
            style={styles.headerBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Post</Text>
          <TouchableOpacity
            style={[styles.saveButton, canSave && styles.saveButtonActive]}
            onPress={handleSave}
            disabled={!canSave}
            activeOpacity={0.7}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.bg} />
            ) : (
              <Text style={[styles.saveButtonText, canSave && styles.saveButtonTextActive]}>
                Save
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Caption input area */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.captionInput}
            value={caption}
            onChangeText={setCaption}
            placeholder="What's happening?"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={MAX_CAPTION_LENGTH}
            autoFocus
            textAlignVertical="top"
            scrollEnabled={false}
            editable={!saving}
          />
        </View>

        {/* Character counter */}
        <View style={styles.counterRow}>
          <Text
            style={[
              styles.counterText,
              captionLength > MAX_CAPTION_LENGTH * 0.9 && captionLength <= MAX_CAPTION_LENGTH && styles.counterWarn,
              captionLength > MAX_CAPTION_LENGTH && styles.counterOver,
            ]}
          >
            {captionLength}/{MAX_CAPTION_LENGTH}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
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
    color: colors.text,
  },
  saveButton: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 7,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  saveButtonActive: {
    backgroundColor: colors.white,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
  },
  saveButtonTextActive: {
    color: colors.bg,
  },
  /* Error state */
  errorText: {
    color: colors.text,
    fontSize: 16,
    marginTop: 12,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  retryBtnText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  /* Caption input */
  inputContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  captionInput: {
    fontSize: 17,
    color: colors.text,
    lineHeight: 24,
    minHeight: 200,
    maxHeight: 500,
    padding: 0,
    margin: 0,
  },
  /* Counter */
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: Math.max(16, 20),
  },
  counterText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
  },
  counterWarn: {
    color: colors.accentGold,
  },
  counterOver: {
    color: colors.error,
  },
});
