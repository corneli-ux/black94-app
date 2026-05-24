import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { firestore } from '../lib/firebase';
import { useAppStore } from '../stores/app';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScheduledPost {
  id: string;
  caption: string;
  scheduledDate: string; // ISO timestamp string from Firestore
  mediaUrls?: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatScheduledDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;

    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const isTomorrow = (() => {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return (
        date.getDate() === tomorrow.getDate() &&
        date.getMonth() === tomorrow.getMonth() &&
        date.getFullYear() === tomorrow.getFullYear()
      );
    })();

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = date.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });

    if (isToday) return `Today at ${timeStr}`;
    if (isTomorrow) return `Tomorrow at ${timeStr}`;
    return `${dateStr} at ${timeStr}`;
  } catch {
    return isoString;
  }
}

function isFutureDate(isoString: string): boolean {
  try {
    return new Date(isoString).getTime() > Date.now();
  } catch {
    return false;
  }
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function ScheduledPostsScreen() {
  const navigation = useNavigation();
  const user = useAppStore((s) => s.user);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadScheduledPosts = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const snap = await firestore()
        .collection('posts')
        .where('authorId', '==', user.id)
        .orderBy('scheduledDate', 'asc')
        .limit(50)
        .get();

      // Client-side filter: only keep posts with a scheduledDate in the future
      const scheduled = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            caption: data.caption || '',
            scheduledDate: data.scheduledDate || '',
            mediaUrls: data.mediaUrls || [],
          };
        })
        .filter((p) => p.scheduledDate && isFutureDate(p.scheduledDate));

      setPosts(scheduled);
    } catch (e) {
      console.error('[ScheduledPosts] Failed to load:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadScheduledPosts();
  }, [loadScheduledPosts]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadScheduledPosts();
  }, [loadScheduledPosts]);

  const handleCancelPost = useCallback(
    (post: ScheduledPost) => {
      Alert.alert('Cancel Scheduled Post', 'Are you sure you want to delete this scheduled post? This action cannot be undone.', [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Post',
          style: 'destructive',
          onPress: async () => {
            try {
              await firestore().collection('posts').doc(post.id).delete();
              setPosts((prev) => prev.filter((p) => p.id !== post.id));
            } catch (e) {
              console.error('[ScheduledPosts] Failed to delete:', e);
              Alert.alert('Error', 'Failed to cancel scheduled post. Please try again.');
            }
          },
        },
      ]);
    },
    [],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Scheduled Posts</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.postRow}
            onLongPress={() => handleCancelPost(item)}
            activeOpacity={0.7}
          >
            <View style={styles.postContent}>
              <View style={styles.dateRow}>
                <Ionicons name="calendar-outline" size={16} color={colors.accent} style={{ marginRight: 6 }} />
                <Text style={styles.dateText}>{formatScheduledDate(item.scheduledDate)}</Text>
              </View>
              {item.caption ? (
                <Text style={styles.caption} numberOfLines={2}>{item.caption}</Text>
              ) : (
                <Text style={styles.caption} numberOfLines={2} style={[styles.caption, { color: colors.textMuted }]}>
                  No caption
                </Text>
              )}
            </View>
            <View style={styles.rightSection}>
              <View style={styles.statusBadge}>
                <Text style={styles.statusBadgeText}>Scheduled</Text>
              </View>
              <TouchableOpacity
                onPress={() => handleCancelPost(item)}
                hitSlop={10}
                style={styles.deleteBtn}
              >
                <Ionicons name="close-circle" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="calendar-outline" size={32} color={colors.textSecondary} />
            </View>
            <Text style={styles.emptyTitle}>No scheduled posts</Text>
            <Text style={styles.emptySubtitle}>
              Posts you schedule will appear here, ordered by date.
            </Text>
          </View>
        }
        contentContainerStyle={posts.length === 0 ? styles.emptyList : undefined}
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
  postRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
  },
  postContent: {
    flex: 1,
    marginRight: 12,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  dateText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  caption: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
  },
  rightSection: {
    alignItems: 'flex-end',
    gap: 8,
  },
  statusBadge: {
    backgroundColor: 'rgba(212, 175, 55, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusBadgeText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
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
    backgroundColor: colors.bgSubtle,
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
});
