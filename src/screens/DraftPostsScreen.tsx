import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/colors';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Draft {
  id: string;
  caption: string;
  mediaUrls: string[];
  createdAt: number;
}

const DRAFTS_KEY = '@black94/post_drafts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;

  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

async function loadDrafts(): Promise<Draft[]> {
  try {
    const raw = await AsyncStorage.getItem(DRAFTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Sort newest first
    return parsed
      .filter((d: any) => d && d.id && typeof d.createdAt === 'number')
      .sort((a: Draft, b: Draft) => b.createdAt - a.createdAt);
  } catch (e) {
    console.error('[DraftPosts] Failed to load drafts:', e);
    return [];
  }
}

async function removeDraft(id: string): Promise<void> {
  try {
    const drafts = await loadDrafts();
    const filtered = drafts.filter((d) => d.id !== id);
    await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('[DraftPosts] Failed to remove draft:', e);
  }
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function DraftPostsScreen() {
  const navigation = useNavigation();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  const handleLoadDrafts = useCallback(async () => {
    setLoading(true);
    const loaded = await loadDrafts();
    setDrafts(loaded);
    setLoading(false);
  }, []);

  useEffect(() => {
    handleLoadDrafts();
  }, [handleLoadDrafts]);

  // Refresh drafts when screen comes back into focus (e.g. after composing)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      handleLoadDrafts();
    });
    return unsubscribe;
  }, [navigation, handleLoadDrafts]);

  const handleOpenDraft = useCallback(
    (draft: Draft) => {
      navigation.navigate('CreatePost' as never, {
        draftCaption: draft.caption,
        draftMediaUrls: draft.mediaUrls,
      } as never);
    },
    [navigation],
  );

  const handleDeleteDraft = useCallback(
    (draft: Draft) => {
      Alert.alert('Delete Draft', 'Are you sure you want to delete this draft?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await removeDraft(draft.id);
            setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
          },
        },
      ]);
    },
    [],
  );

  const handleClearAll = useCallback(() => {
    if (drafts.length === 0) return;
    Alert.alert('Delete All Drafts', `Are you sure you want to delete all ${drafts.length} draft${drafts.length !== 1 ? 's' : ''}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete All',
        style: 'destructive',
        onPress: async () => {
          try {
            await AsyncStorage.removeItem(DRAFTS_KEY);
            setDrafts([]);
          } catch (e) {
            console.error('[DraftPosts] Failed to clear drafts:', e);
          }
        },
      },
    ]);
  }, [drafts.length]);

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        {/* Use a subtle indicator instead of large spinner */}
        <View style={styles.loadingWrap}>
          <Ionicons name="document-text-outline" size={32} color={colors.textMuted} />
        </View>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Drafts</Text>
          {drafts.length > 0 ? (
            <TouchableOpacity onPress={handleClearAll} hitSlop={8}>
              <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 20 }} />
          )}
        </View>
      </SafeAreaView>

      <FlatList
        data={drafts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.draftRow}
            onPress={() => handleOpenDraft(item)}
            onLongPress={() => handleDeleteDraft(item)}
            activeOpacity={0.7}
          >
            <View style={styles.draftIconWrap}>
              <Ionicons name="document-text-outline" size={20} color={colors.accent} />
            </View>
            <View style={styles.draftContent}>
              <View style={styles.draftMeta}>
                <Text style={styles.draftLabel}>Draft</Text>
                <Text style={styles.draftTime}>{relativeTime(item.createdAt)}</Text>
              </View>
              {item.caption ? (
                <Text style={styles.draftCaption} numberOfLines={2}>
                  {item.caption}
                </Text>
              ) : (
                <Text style={[styles.draftCaption, { color: colors.textMuted }]} numberOfLines={2}>
                  {item.mediaUrls?.length
                    ? `${item.mediaUrls.length} media item${item.mediaUrls.length !== 1 ? 's' : ''}`
                    : 'Empty draft'}
                </Text>
              )}
              {item.mediaUrls && item.mediaUrls.length > 0 && (
                <View style={styles.mediaCountRow}>
                  <Ionicons name="image-outline" size={12} color={colors.textMuted} />
                  <Text style={styles.mediaCountText}>{item.mediaUrls.length}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              onPress={() => handleDeleteDraft(item)}
              hitSlop={10}
              style={styles.deleteBtn}
            >
              <Ionicons name="close-circle" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="document-text-outline" size={32} color={colors.textSecondary} />
            </View>
            <Text style={styles.emptyTitle}>No drafts</Text>
            <Text style={styles.emptySubtitle}>
              When you start composing a post and leave, it will be saved as a draft here.
            </Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={() => navigation.navigate('CreatePost' as never)}
            >
              <Text style={styles.emptyCtaText}>Create a post</Text>
            </TouchableOpacity>
          </View>
        }
        contentContainerStyle={drafts.length === 0 ? styles.emptyList : undefined}
      />
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
  },
  draftIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(212, 175, 55, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  draftContent: {
    flex: 1,
    marginRight: 8,
  },
  draftMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  draftLabel: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  draftTime: {
    color: colors.textMuted,
    fontSize: 12,
  },
  draftCaption: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
  },
  mediaCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 3,
  },
  mediaCountText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  deleteBtn: {
    padding: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyList: {
    flexGrow: 1,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptySubtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 50,
    lineHeight: 22,
  },
  emptyCta: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: colors.bgInput,
    borderRadius: 20,
  },
  emptyCtaText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
});
