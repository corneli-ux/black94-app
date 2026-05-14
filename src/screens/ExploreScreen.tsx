import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis } from '../lib/api';
import { User } from '../lib/api';
import { toggleFollow } from '../lib/api';

/* ── Trending Topics (fetched live from Firestore) ────────────────────────── */
interface TrendingTopic {
  tag: string;
  count: number;
}

async function fetchLiveTrending(): Promise<TrendingTopic[]> {
  try {
    const snap = await firestore()
      .collection('posts')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const tagCounts: Record<string, number> = {};
    snap.docs.forEach(docSnap => {
      const caption = docSnap.data().caption || '';
      const tags = caption.match(/#[\w]+/g);
      if (tags) {
        tags.forEach(tag => {
          const lower = tag.toLowerCase();
          tagCounts[lower] = (tagCounts[lower] || 0) + 1;
        });
      }
    });

    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count }));
  } catch (e) {
    console.error('[Explore] Failed to fetch trending:', e);
    return [];
  }
}

const CATEGORIES = [
  'Trending',
  'Technology',
  'Music',
  'Sports',
  'News',
  'Entertainment',
];

export default function ExploreScreen() {
  const navigation = useNavigation();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [trendingTopics, setTrendingTopics] = useState<TrendingTopic[]>([]);
  const [recommendedUsers, setRecommendedUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);
  const [followedUsers, setFollowedUsers] = useState<Set<string>>(new Set());

  const loadTrending = useCallback(async () => {
    const topics = await fetchLiveTrending();
    setTrendingTopics(topics);
  }, []);

  const loadRecommendedUsers = useCallback(async () => {
    try {
      console.log('[Explore] Loading recommended users...');
      const snap = await firestore()
        .collection('users')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();

      console.log(`[Explore] Got ${snap.docs.length} users from Firestore`);

      const currentUserId = auth()?.currentUser?.uid;

      // Get users the current user already follows
      if (currentUserId) {
        try {
          const followsSnap = await firestore()
            .collection('follows')
            .where('followerId', '==', currentUserId)
            .get();
          const followingIds = new Set<string>(followsSnap.docs.map(d => d.data().followingId as string));
          setFollowedUsers(followingIds);
        } catch { /* skip */ }
      }

      const users: User[] = snap.docs
        .filter(d => d.id !== currentUserId)
        .map(d => {
          const data = d.data();
          return {
            id: d.id,
            email: data.email || '',
            username: data.username || '',
            displayName: data.displayName || '',
            bio: data.bio || '',
            profileImage: data.profileImage || null,
            coverImage: data.coverImage || null,
            role: data.role || 'personal',
            badge: data.badge || '',
            subscription: data.subscription || 'free',
            isVerified: data.isVerified || false,
            createdAt: tsToMillis(data.createdAt),
          };
        });

      setRecommendedUsers(users);
    } catch (e: any) {
      console.error('[Explore] Failed to load recommended users:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    setCanRefresh(offset <= 0);
  }, []);

  useEffect(() => {
    loadTrending();
    loadRecommendedUsers();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadRecommendedUsers();
  };

  const filteredTopics = selectedCategory && selectedCategory !== 'Trending'
    ? trendingTopics.filter(t => t.tag.includes(selectedCategory.toLowerCase()))
    : trendingTopics;

  const handleFollow = useCallback(async (targetId: string) => {
    const currentUser = auth()?.currentUser;
    if (!currentUser || followedUsers.has(targetId)) return;
    try {
      const newState = await toggleFollow(targetId, false);
      if (newState) {
        setFollowedUsers(prev => new Set(prev).add(targetId));
      }
    } catch (e: any) {
      console.error('[Explore] Follow failed:', e?.message);
    }
  }, [followedUsers]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => (navigation as any).openDrawer()} hitSlop={8}>
            <Ionicons name="menu" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Explore</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing && canRefresh}
            onRefresh={() => { if (canRefresh) handleRefresh(); }}
            tintColor={colors.accent}
            enabled={canRefresh}
          />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Search Bar (decorative — navigates to Search screen) */}
        <TouchableOpacity
          style={styles.searchBar}
          onPress={() => navigation.navigate('Search' as never)}
          activeOpacity={0.7}
        >
          <Ionicons name="search" size={20} color="#94a3b8" />
          <Text style={styles.searchPlaceholder}>Search</Text>
        </TouchableOpacity>

        {/* Category Pills */}
        <View style={styles.categoriesWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoriesScroll}
          >
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.categoryPill,
                  selectedCategory === cat && styles.categoryPillActive,
                ]}
                onPress={() =>
                  setSelectedCategory(prev => (prev === cat ? null : cat))
                }
              >
                <Text
                  style={[
                    styles.categoryPillText,
                    selectedCategory === cat && styles.categoryPillTextActive,
                  ]}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Trending Topics */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {selectedCategory ? `Trending in ${selectedCategory}` : 'Trending'}
          </Text>
          <View style={styles.topicList}>
            {filteredTopics.map((topic, idx) => (
              <TouchableOpacity
                key={topic.tag}
                style={styles.topicRow}
                onPress={() => (navigation as any).navigate('Search', { q: topic.tag })}
              >
                <View style={styles.topicContent}>
                  <Text style={styles.topicTag}>{topic.tag}</Text>
                  <Text style={styles.topicPosts}>
                    {topic.count} {topic.count === 1 ? 'post' : 'posts'}
                  </Text>
                </View>
                {idx < filteredTopics.length - 1 && (
                  <View style={styles.topicSeparator} />
                )}
              </TouchableOpacity>
            ))}
            {filteredTopics.length === 0 && (
              <Text style={styles.noTopicsText}>
                No trending topics yet.
              </Text>
            )}
          </View>
        </View>

        {/* Who to follow */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Who to follow</Text>
          {loading ? (
            <View style={styles.usersLoading}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : recommendedUsers.length === 0 ? (
            <View style={styles.emptyUsersWrap}>
              <View style={styles.emptyUsersIcon}>
                <Ionicons name="people-outline" size={28} color="#64748b" />
              </View>
              <Text style={styles.emptyUsersText}>
                Suggestions will appear as more people join.
              </Text>
            </View>
          ) : (
            <View style={styles.userList}>
              {recommendedUsers.map(user => (
                <View key={user.id} style={styles.userRow}>
                  <TouchableOpacity
                    onPress={() =>
                      (navigation as any).navigate('UserProfile', { userId: user.id })
                    }
                  >
                    <Avatar uri={user.profileImage} size={44} name={user.displayName} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.userInfo}
                    onPress={() =>
                      (navigation as any).navigate('UserProfile', { userId: user.id })
                    }
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={styles.userName} numberOfLines={1}>
                        {user.displayName}
                      </Text>
                      <VerifiedBadge badge={user.badge} isVerified={user.isVerified} size={14} />
                    </View>
                    <Text style={styles.userHandle}>@{user.username}</Text>
                    {user.bio ? (
                      <Text style={styles.userBio} numberOfLines={2}>
                        {user.bio}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                  {followedUsers.has(user.id) ? (
                    <TouchableOpacity style={styles.followingBtn}>
                      <Text style={styles.followingBtnText}>Following</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.followBtn}
                      onPress={() => handleFollow(user.id)}
                    >
                      <Text style={styles.followBtnText}>Follow</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  /* Search Bar: decorative, bg-white/[0.06], border border-white/[0.08], pill */
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 25,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  searchPlaceholder: {
    color: '#64748b',
    fontSize: 15,
  },
  /* Category pills */
  categoriesWrap: { marginBottom: 4 },
  categoriesScroll: { paddingHorizontal: 16, gap: 8 },
  categoryPill: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  categoryPillActive: {
    backgroundColor: '#e7e9ea',
  },
  categoryPillText: {
    color: '#e7e9ea',
    fontSize: 14,
    fontWeight: '500',
  },
  categoryPillTextActive: {
    color: '#000000',
  },
  /* Section */
  section: { marginTop: 16 },
  /* Section title: fontSize: 18, fontWeight: 700, color: #e7e9ea */
  sectionTitle: {
    color: '#e7e9ea',
    fontSize: 20,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  /* Trending topic list */
  topicList: {},
  topicRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topicContent: {},
  /* Category: fontSize: 13, color: #94a3b8 */
  topicCategory: {
    color: '#94a3b8',
    fontSize: 13,
  },
  /* Tag: fontSize: 15, fontWeight: 700, color: #e7e9ea */
  topicTag: {
    color: '#e7e9ea',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  /* Posts count: fontSize: 13, color: #64748b */
  topicPosts: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 2,
  },
  topicSeparator: {
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginLeft: 16,
  },
  noTopicsText: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  /* Loading */
  usersLoading: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  /* Empty users */
  emptyUsersWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  emptyUsersIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyUsersText: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
  },
  /* User list */
  userList: {},
  userRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
  },
  userName: {
    color: '#e7e9ea',
    fontWeight: '700',
    fontSize: 14,
  },
  userHandle: {
    color: '#94a3b8',
    fontSize: 13,
  },
  userBio: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
  /* Follow button: bg-[#e7e9ea] text-black text-[13px] font-semibold rounded-full */
  followBtn: {
    backgroundColor: '#e7e9ea',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
    alignSelf: 'center',
  },
  followBtnText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '600',
  },
  /* Following button: border border-[#64748b] text-[#e7e9ea] */
  followingBtn: {
    borderWidth: 1,
    borderColor: '#64748b',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
    alignSelf: 'center',
  },
  followingBtnText: {
    color: '#e7e9ea',
    fontSize: 14,
    fontWeight: '600',
  },
});
