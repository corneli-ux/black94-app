import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { firestore } from '../lib/firebase';

/* ── Types ──────────────────────────────────────────────────────────────────── */

interface TrendingItem {
  tag: string;
  count: number;
}

/* ── Fetch trending hashtags ───────────────────────────────────────────────── */

async function fetchTrending(): Promise<TrendingItem[]> {
  // Fetch the 50 most recent posts
  const snap = await firestore()
    .collection('posts')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  const tagCounts: Record<string, number> = {};

  for (const docSnap of snap.docs) {
    const data = docSnap.data();

    // Primary source: `hashtags` array field on the document
    const hashtags: string[] = data.hashtags || [];
    for (const tag of hashtags) {
      const lower = (tag || '').toLowerCase().replace(/^#/, '');
      if (lower) {
        tagCounts[lower] = (tagCounts[lower] || 0) + 1;
      }
    }

    // Fallback: extract from caption text for posts missing the array field
    if (hashtags.length === 0 && data.caption) {
      const captionTags = data.caption.match(/#([\w]+)/g);
      if (captionTags) {
        for (const ct of captionTags) {
          const lower = ct.slice(1).toLowerCase();
          if (lower) {
            tagCounts[lower] = (tagCounts[lower] || 0) + 1;
          }
        }
      }
    }
  }

  // Sort by frequency descending, take top 20
  return Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));
}

/* ── Trend row component ───────────────────────────────────────────────────── */

function TrendRow({
  item,
  index,
  onPress,
}: {
  item: TrendingItem;
  index: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.trendRow}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <Text style={styles.trendRank}>{index + 1}</Text>
      <View style={styles.trendContent}>
        <Text style={styles.trendTag}>#{item.tag}</Text>
        <Text style={styles.trendCount}>
          {item.count.toLocaleString()} {item.count === 1 ? 'post' : 'posts'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

/* ── TrendingScreen ─────────────────────────────────────────────────────────── */

export default function TrendingScreen() {
  const navigation = useNavigation();
  const [trends, setTrends] = useState<TrendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTrends = useCallback(async () => {
    try {
      const result = await fetchTrending();
      setTrends(result);
      setError(null);
    } catch (e: any) {
      if (__DEV__) console.error('[TrendingScreen] Failed to fetch trends:', e?.message);
      setError(e?.message || 'Something went wrong');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadTrends();
  }, [loadTrends]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadTrends();
  }, [loadTrends]);

  const handleTrendPress = useCallback(
    (tag: string) => {
      navigation.navigate('Hashtag' as never, { tag });
    },
    [navigation],
  );

  // ── Render: Loading ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Trending</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      {/* Trends list */}
      <FlatList
        data={trends}
        keyExtractor={item => item.tag}
        renderItem={({ item, index }) => (
          <TrendRow
            item={item}
            index={index}
            onPress={() => handleTrendPress(item.tag)}
          />
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
            {error ? (
              <>
                <View style={styles.emptyIcon}>
                  <Ionicons name="alert-circle-outline" size={32} color={colors.textSecondary} />
                </View>
                <Text style={styles.emptyTitle}>Something went wrong</Text>
                <Text style={styles.emptySubtitle}>{error}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={loadTrends}>
                  <Text style={styles.retryBtnText}>Retry</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.emptyIcon}>
                  <Ionicons name="trending-up-outline" size={32} color={colors.textSecondary} />
                </View>
                <Text style={styles.emptyTitle}>No trending topics right now</Text>
                <Text style={styles.emptySubtitle}>
                  Check back later for what&apos;s buzzing on Black94.
                </Text>
              </>
            )}
          </View>
        }
        contentContainerStyle={trends.length === 0 ? styles.emptyList : undefined}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => (
          <View style={styles.separator} />
        )}
      />
    </View>
  );
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  /* Header */
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
  /* Trend row */
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  trendRank: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '600',
    width: 28,
    textAlign: 'center',
  },
  trendContent: {
    flex: 1,
    marginLeft: 8,
  },
  trendTag: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  trendCount: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  separator: {
    height: 0.5,
    backgroundColor: colors.bgInput,
    marginLeft: 52,
  },
  /* Empty state */
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
  /* Error retry */
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.bgInput,
  },
  retryBtnText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
});
