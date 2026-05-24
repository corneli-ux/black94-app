import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { colors } from '../theme/colors';
import { timeAgo } from '../utils/timeAgo';
import { tsToMillis } from '../utils/datetime';

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

interface ViewerEntry {
  viewerId: string;
  viewedAt: number;
  displayName: string;
  username: string;
  profileImage: string | null;
  isVerified: boolean;
  badge: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCREEN
   ═══════════════════════════════════════════════════════════════════════════ */

export default function StoryViewersScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { storyId } = (route.params as { storyId: string }) || {};

  const [viewers, setViewers] = useState<ViewerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadViewers = useCallback(async () => {
    if (!storyId) {
      setLoading(false);
      return;
    }

    try {
      // Fetch all viewer docs from the subcollection, ordered by viewedAt desc
      const snap = await firestore()
        .collection('stories')
        .doc(storyId)
        .collection('viewers')
        .orderBy('viewedAt', 'desc')
        .limit(200)
        .get();

      const entries = snap.docs.map((d: any) => {
        const data = d.data();
        return {
          viewerId: data.viewerId || '',
          viewedAt: (() => {
            try {
              return tsToMillis(data.viewedAt);
            } catch {
              return Date.now();
            }
          })(),
          // May already be embedded in the viewer doc; will be overwritten by
          // the user profile fetch below if missing.
          displayName: data.displayName || '',
          username: data.username || '',
          profileImage: data.profileImage || null,
          isVerified: data.isVerified || false,
          badge: data.badge || '',
        };
      });

      // De-duplicate viewerIds in case of duplicate docs
      const uniqueEntries = new Map<string, ViewerEntry>();
      for (const entry of entries) {
        if (!uniqueEntries.has(entry.viewerId)) {
          uniqueEntries.set(entry.viewerId, entry);
        }
      }

      // Batch-fetch user profiles for all viewers that don't have data yet
      const viewerIds = Array.from(uniqueEntries.keys());
      const needsProfile = viewerIds.filter(
        (id) => !uniqueEntries.get(id)?.displayName,
      );

      if (needsProfile.length > 0) {
        const CHUNK = 30;
        for (let i = 0; i < needsProfile.length; i += CHUNK) {
          const chunk = needsProfile.slice(i, i + CHUNK);
          const docs = await Promise.all(
            chunk.map((uid) =>
              firestore()
                .collection('users')
                .doc(uid)
                .get()
                .catch(() => null),
            ),
          );
          for (const doc of docs) {
            if (doc && doc.exists) {
              const data = doc.data();
              const existing = uniqueEntries.get(doc.id);
              if (existing) {
                uniqueEntries.set(doc.id, {
                  ...existing,
                  displayName: data.displayName || existing.displayName || '',
                  username: data.username || existing.username || '',
                  profileImage: data.profileImage || existing.profileImage || null,
                  isVerified: data.isVerified || existing.isVerified || false,
                  badge: data.badge || existing.badge || '',
                });
              }
            }
          }
        }
      }

      // Sort by viewedAt (most recent first) and convert to array
      const sorted = Array.from(uniqueEntries.values()).sort(
        (a, b) => b.viewedAt - a.viewedAt,
      );

      setViewers(sorted);
    } catch (e: any) {
      console.error('[StoryViewersScreen] Load error:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [storyId]);

  useEffect(() => {
    loadViewers();
  }, [loadViewers]);

  /* ── Render helpers ─────────────────────────────────────────────────────── */

  const renderViewer = ({ item }: { item: ViewerEntry }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
      onPress={() =>
        navigation.navigate('UserProfile', { userId: item.viewerId })
      }
    >
      <Avatar uri={item.profileImage} name={item.displayName || item.username} size={44} />
      <View style={styles.userInfo}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {item.displayName || item.username || 'User'}
          </Text>
          <VerifiedBadge badge={item.badge} isVerified={item.isVerified} size={16} />
        </View>
        <View style={styles.handleRow}>
          <Text style={styles.handle}>
            @{item.username || 'user'}
          </Text>
          <Text style={styles.separator}>·</Text>
          <Text style={styles.time}>{timeAgo(item.viewedAt)}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );

  /* ── Screen layout ──────────────────────────────────────────────────────── */

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Story Views</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Viewer count */}
      {!loading && viewers.length > 0 && (
        <View style={styles.countBar}>
          <Ionicons name="eye-outline" size={16} color={colors.textMuted} />
          <Text style={styles.countText}>
            {viewers.length} view{viewers.length !== 1 ? 's' : ''}
          </Text>
        </View>
      )}

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : viewers.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="eye-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyText}>No views yet</Text>
          <Text style={styles.emptySubtext}>
            When someone views your story, they'll appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={viewers}
          keyExtractor={(item) => item.viewerId}
          renderItem={renderViewer}
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════════════ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  countBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
  },
  countText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySubtext: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  list: {
    paddingBottom: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  handle: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  separator: {
    color: colors.textMuted,
    fontSize: 14,
  },
  time: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
