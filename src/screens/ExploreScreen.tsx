import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, SafeAreaView, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis } from '../lib/api';
import { User } from '../lib/api';

/* ── Trending Topics (hardcoded samples) ────────────────────────────────── */
const TRENDING_TOPICS = [
  { tag: '#Black94Launch', category: 'Technology', posts: '12.4K' },
  { tag: '#AIRevolution', category: 'Technology', posts: '8.9K' },
  { tag: '#StartupLife', category: 'Business', posts: '6.2K' },
  { tag: '#ChampionsLeague', category: 'Sports', posts: '15.1K' },
  { tag: '#NewMovieRelease', category: 'Entertainment', posts: '9.7K' },
  { tag: '#SpaceExploration', category: 'Science', posts: '4.3K' },
  { tag: '#CryptoUpdate', category: 'Business', posts: '11.8K' },
  { tag: '#GameDev', category: 'Technology', posts: '5.6K' },
  { tag: '#FitnessGoals', category: 'Sports', posts: '7.1K' },
  { tag: '#ClimateTech', category: 'Science', posts: '3.8K' },
];

const CATEGORIES = [
  'Technology',
  'Business',
  'Sports',
  'Entertainment',
  'Science',
];

export default function ExploreScreen() {
  const navigation = useNavigation();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [recommendedUsers, setRecommendedUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);

  const loadRecommendedUsers = useCallback(async () => {
    try {
      const snap = await firestore()
        .collection('users')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();

      const currentUserId = auth()?.currentUser?.uid;
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
    } catch (e) {
      console.error('[Explore] Failed to load recommended users:', e);
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
    loadRecommendedUsers();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadRecommendedUsers();
  };

  const filteredTopics = selectedCategory
    ? TRENDING_TOPICS.filter(t => t.category === selectedCategory)
    : TRENDING_TOPICS;

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.openDrawer()} hitSlop={8}>
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
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <Text style={styles.searchPlaceholder}>Search Black94</Text>
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
            {selectedCategory ? `Trending in ${selectedCategory}` : 'Trending Now'}
          </Text>
          <View style={styles.sectionCard}>
            {filteredTopics.map((topic, idx) => (
              <TouchableOpacity key={topic.tag} style={styles.topicRow}>
                <View style={styles.topicContent}>
                  <View style={styles.topicCategoryRow}>
                    <Text style={styles.topicCategory}>
                      {topic.category} · Trending
                    </Text>
                  </View>
                  <Text style={styles.topicTag}>{topic.tag}</Text>
                  <Text style={styles.topicPosts}>
                    {topic.posts} posts
                  </Text>
                </View>
                {idx < filteredTopics.length - 1 && (
                  <View style={styles.topicSeparator} />
                )}
              </TouchableOpacity>
            ))}
            {filteredTopics.length === 0 && (
              <Text style={styles.noTopicsText}>
                No trending topics in this category.
              </Text>
            )}
          </View>
        </View>

        {/* Recommended Users */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recommended Users</Text>
          {loading ? (
            <View style={styles.usersLoading}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : recommendedUsers.length === 0 ? (
            <View style={styles.sectionCard}>
              <Text style={styles.noUsersText}>
                No recommended users at this time.
              </Text>
            </View>
          ) : (
            <View style={styles.sectionCard}>
              {recommendedUsers.map(user => (
                <TouchableOpacity
                  key={user.id}
                  style={styles.userRow}
                  onPress={() =>
                    navigation.navigate('Profile' as never, { userId: user.id })
                  }
                >
                  <Avatar uri={user.profileImage} size={44} />
                  <View style={styles.userInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text style={styles.userName} numberOfLines={1}>
                        {user.displayName}
                      </Text>
                      <VerifiedBadge badge={user.badge} />
                    </View>
                    <Text style={styles.userHandle}>@{user.username}</Text>
                    {user.bio ? (
                      <Text style={styles.userBio} numberOfLines={2}>
                        {user.bio}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
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
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgInput,
    borderRadius: 25,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  searchPlaceholder: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  categoriesWrap: { marginBottom: 4 },
  categoriesScroll: { paddingHorizontal: 16, gap: 8 },
  categoryPill: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  categoryPillText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  categoryPillTextActive: {
    color: '#fff',
  },
  section: { marginTop: 16 },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  topicRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  topicContent: {},
  topicCategoryRow: { marginBottom: 2 },
  topicCategory: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  topicTag: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginVertical: 2,
  },
  topicPosts: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  topicSeparator: {
    height: 0.5,
    backgroundColor: colors.border,
    marginTop: 14,
  },
  noTopicsText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  usersLoading: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  noUsersText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
  },
  userName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 15,
  },
  userHandle: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  userBio: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
});
