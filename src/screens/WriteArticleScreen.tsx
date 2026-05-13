import React, { useState, useMemo, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { auth, firestore } from '../lib/firebase';
import { useAppStore } from '../stores/app';

const READING_WPM = 200;

/* ── Markdown helpers ──────────────────────────────────────────────────── */

function insertMarkdownMarker(content: string, selectionStart: number, selectionEnd: number, prefix: string, suffix: string): { content: string; newCursor: number } {
  if (selectionStart === selectionEnd) {
    // No selection — insert markers at cursor position
    const before = content.slice(0, selectionStart);
    const after = content.slice(selectionStart);
    return {
      content: before + prefix + suffix + after,
      newCursor: selectionStart + prefix.length,
    };
  }
  const selectedText = content.slice(selectionStart, selectionEnd);
  const before = content.slice(0, selectionStart);
  const after = content.slice(selectionEnd);
  return {
    content: before + prefix + selectedText + suffix + after,
    newCursor: selectionEnd + prefix.length + suffix.length,
  };
}

function insertMarkdownAtLineStart(content: string, selectionStart: number, marker: string): { content: string; newCursor: number } {
  // Find the beginning of the current line
  let lineStart = selectionStart;
  if (lineStart > 0 && content[lineStart - 1] === '\n') lineStart--;
  while (lineStart > 0 && content[lineStart - 1] !== '\n') {
    lineStart--;
  }
  const before = content.slice(0, lineStart);
  const after = content.slice(lineStart);
  // Find end of the current line
  const lineEnd = after.indexOf('\n');
  const line = lineEnd >= 0 ? after.slice(0, lineEnd) : after;
  const restOfContent = lineEnd >= 0 ? after.slice(lineEnd) : '';

  return {
    content: before + marker + line + restOfContent,
    newCursor: selectionStart + marker.length,
  };
}

function insertMarkdownListAtLineStart(content: string, selectionStart: number, marker: string): { content: string; newCursor: number } {
  let lineStart = selectionStart;
  if (lineStart > 0 && content[lineStart - 1] === '\n') lineStart--;
  while (lineStart > 0 && content[lineStart - 1] !== '\n') {
    lineStart--;
  }
  const before = content.slice(0, lineStart);
  const after = content.slice(lineStart);
  const lineEnd = after.indexOf('\n');
  const line = lineEnd >= 0 ? after.slice(0, lineEnd) : after;
  const restOfContent = lineEnd >= 0 ? after.slice(lineEnd) : '';

  return {
    content: before + marker + line + restOfContent,
    newCursor: selectionStart + marker.length,
  };
}

function renderMarkdownToReact(md: string): React.ReactNode[] {
  const lines = md.split('\n');
  const elements: React.ReactNode[] = [];
  let inList = false;
  let listType = '';
  let listKey = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Unordered list items
    if (/^[-*]\s+/.test(line)) {
      if (!inList || listType !== 'ul') {
        inList = true;
        listType = 'ul';
        listKey++;
      }
      line = line.replace(/^[-*]\s+/, '');
      elements.push(
        <View key={`li-${listKey}-${i}`} style={styles.previewListItem}>
          <Text style={styles.previewBullet}>•</Text>
          <Text style={styles.previewListItemText}>{renderInlineMarkdown(line)}</Text>
        </View>
      );
      continue;
    }

    // Ordered list items
    if (/^\d+\.\s+/.test(line)) {
      if (!inList || listType !== 'ol') {
        inList = true;
        listType = 'ol';
        listKey++;
      }
      line = line.replace(/^\d+\.\s+/, '');
      elements.push(
        <View key={`oli-${listKey}-${i}`} style={styles.previewListItem}>
          <Text style={styles.previewBullet}>{listKey}.</Text>
          <Text style={styles.previewListItemText}>{renderInlineMarkdown(line)}</Text>
        </View>
      );
      listKey++;
      continue;
    }

    // End list
    if (inList) {
      inList = false;
      listType = '';
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<View key={`blank-${i}`} style={{ height: 10 }} />);
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      line = line.slice(2);
      elements.push(
        <View key={`bq-${i}`} style={styles.previewBlockquote}>
          <View style={styles.previewBlockquoteBar} />
          <Text style={styles.previewBlockquoteText}>{renderInlineMarkdown(line)}</Text>
        </View>
      );
      continue;
    }

    // Headings
    if (line.startsWith('## ')) {
      elements.push(
        <Text key={`h2-${i}`} style={styles.previewH2}>
          {renderInlineMarkdown(line.slice(3))}
        </Text>
      );
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(
        <Text key={`h1-${i}`} style={styles.previewH1}>
          {renderInlineMarkdown(line.slice(2))}
        </Text>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <Text key={`p-${i}`} style={styles.previewParagraph}>
        {renderInlineMarkdown(line)}
      </Text>
    );
  }

  return elements;
}

function renderInlineMarkdown(text: string): string {
  // Strip markdown markers for preview
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1') // Bold
    .replace(/\*(.+?)\*/g, '$1')   // Italic
    .replace(/#{1,6}\s/g, '')      // Headings
    .replace(/^>\s?/gm, '')        // Blockquote
    .replace(/^[-*]\s+/gm, '')    // UL
    .replace(/^\d+\.\s+/gm, '');   // OL
}

interface ToolbarAction {
  icon: string;
  label: string;
  prefix?: string;
  suffix?: string;
  lineMarker?: string;
  listMarker?: string;
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  { icon: 'bold', label: 'Bold', prefix: '**', suffix: '**' },
  { icon: 'italic', label: 'Italic', prefix: '*', suffix: '*' },
  { icon: 'format-h1', label: 'H1', lineMarker: '# ' },
  { icon: 'format-h2', label: 'H2', lineMarker: '## ' },
  { icon: 'list', label: 'Bullet', listMarker: '- ' },
  { icon: 'list-number', label: 'Number', listMarker: '1. ' },
  { icon: 'text', label: 'Quote', lineMarker: '> ' },
];

export default function WriteArticleScreen() {
  const navigation = useNavigation();
  const { user } = useAppStore();
  const [title, setTitle] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [inputRef] = useState<{ selectionStart: number; selectionEnd: number }>({ selectionStart: 0, selectionEnd: 0 });

  const wordCount = useMemo(() => {
    const text = `${title} ${content}`.trim();
    if (!text) return 0;
    // Strip markdown markers from word count
    const cleanText = text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/^>\s?/gm, '')
      .replace(/^[-*]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '');
    return cleanText.split(/\s+/).filter(Boolean).length;
  }, [title, content]);

  const readingTime = useMemo(() => {
    if (wordCount === 0) return 0;
    return Math.max(1, Math.ceil(wordCount / READING_WPM));
  }, [wordCount]);

  const handleToolbarAction = (action: ToolbarAction) => {
    const { selectionStart, selectionEnd } = inputRef;
    let result: { content: string; newCursor: number };

    if (action.prefix && action.suffix) {
      result = insertMarkdownMarker(content, selectionStart, selectionEnd, action.prefix, action.suffix);
    } else if (action.lineMarker) {
      result = insertMarkdownAtLineStart(content, selectionStart, action.lineMarker);
    } else if (action.listMarker) {
      result = insertMarkdownListAtLineStart(content, selectionStart, action.listMarker);
    } else {
      return;
    }

    setContent(result.content);
  };

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
          onPress={() => setIsPreview(!isPreview)}
          style={styles.previewToggle}
          hitSlop={8}
        >
          <Ionicons
            name={isPreview ? 'create-outline' : 'eye-outline'}
            size={20}
            color={colors.accent}
          />
        </TouchableOpacity>
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

          {/* Toolbar */}
          <View style={styles.toolbar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbarScroll}>
              {TOOLBAR_ACTIONS.map((action, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.toolbarBtn}
                  onPress={() => handleToolbarAction(action)}
                  activeOpacity={0.7}
                >
                  <Ionicons name={action.icon as any} size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Content */}
          {!isPreview ? (
            <TextInput
              style={styles.contentInput}
              placeholder="Write your article here…"
              placeholderTextColor={colors.textMuted}
              value={content}
              onChangeText={setContent}
              onSelectionChange={(e) => {
                inputRef.selectionStart = e.nativeEvent.selection.start;
                inputRef.selectionEnd = e.nativeEvent.selection.end;
              }}
              multiline
              textAlignVertical="top"
              maxLength={50000}
            />
          ) : (
            <View style={styles.previewContainer}>
              <Text style={styles.previewLabel}>Preview</Text>
              {content.trim() ? (
                renderMarkdownToReact(content)
              ) : (
                <Text style={styles.previewEmpty}>Start writing to see a preview…</Text>
              )}
            </View>
          )}
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
  previewToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  toolbar: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
    paddingBottom: 10,
    marginBottom: 12,
  },
  toolbarScroll: {
    gap: 4,
    paddingRight: 20,
  },
  toolbarBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 2,
  },
  contentInput: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    minHeight: 400,
    textAlignVertical: 'top',
  },
  previewContainer: {
    minHeight: 400,
    padding: 4,
  },
  previewLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase' as const,
  },
  previewEmpty: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
  previewH1: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 32,
    marginBottom: 8,
    marginTop: 8,
  },
  previewH2: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
    marginBottom: 6,
    marginTop: 6,
  },
  previewParagraph: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 4,
  },
  previewListItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
    paddingLeft: 8,
  },
  previewBullet: {
    color: colors.accent,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
  },
  previewListItemText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    flex: 1,
  },
  previewBlockquote: {
    flexDirection: 'row',
    gap: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: 12,
    paddingVertical: 8,
    marginVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 0,
  },
  previewBlockquoteBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: colors.accent,
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
  },
  previewBlockquoteText: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    fontStyle: 'italic',
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
