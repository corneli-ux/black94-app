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
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis, parseMediaUrls, Post } from '../lib/api';
import FeedMedia from '../components/FeedMedia';
import { enrichAuthorProfiles } from '../utils/enrichAuthorProfiles';

/* ── Constants ──────────────────────────────────────────────────────────────── */

const FOLLOWED_HASHTAGS_KEY = '@black94/followedHashtags';
const PAGE_SIZE = 20;

/* ── Post row item ──────────────────────────────────────────────────────────── */

function HashtagPostCard({
  post,
  navigation,
}: {
  post: Post;
  navigation: any;
}) {
  const handlePress = () => {
    navigation.navigate('PostDetail' as never, { postId: post.id });
  };

  const handleAuthorPress = () => {
    const currentUserId = auth()?.currentUser?.uid;
    if (post.authorId === currentUserId) {
      navigation.navigate('ProfileSelf' as never);
    } else {
      navigation.navigate('UserProfile' as never, { userId: post.authorId });
    }
  };

  return (
    <TouchableOpacity
      style={styles.postCard}
      activeOpacity={0.7}
      onPress={handlePress}
    >
      {/* Avatar + Content */}
      <View style={styles.contentRow}>
        <TouchableOpacity
          onPress={handleAuthorPress}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <Avatar
            uri={post.authorProfileImage}
            name={post.authorDisplayName}
            size={40}
          />
        </TouchableOpacity>

        <View style={styles.contentColumn}>
          {/* Header: name · handle · time */}
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={handleAuthorPress}
              activeOpacity={0.7}
              style={styles.headerNameRow}
            >
              <Text style={styles.displayName} numberOfLines={1}>
                {post.authorDisplayName || post.authorUsername || 'User'}
              </Text>
              <VerifiedBadge
                badge={post.authorBadge}
                isVerified={post.authorIsVerified}
                size={16}
              />
              <Text style={styles.handle}>@{post.authorUsername || 'user'}</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
            </TouchableOpacity>
          </View>

          {/* Caption */}
          {post.caption ? (
            <Text style={styles.caption} numberOfLines={4}>
              {post.caption}
            </Text>
          ) : null}

          {/* Media */}
          {post.mediaUrls?.length > 0 && (
            <View style={styles.mediaContainer}>
              <FeedMedia uri={post.mediaUrls[0]} />
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

/* ── HashtagScreen ──────────────────────────────────────────────────────────── */

export default function HashtagScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { tag } = (route.params as { tag: string }) || {};

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Follow state (persisted in AsyncStorage) ─────────────────────────────
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    if (!tag) return;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(FOLLOWED_HASHTAGS_KEY);
        const followed: string[] = raw ? JSON.parse(raw) : [];
        setIsFollowing(followed.map(t => t.toLowerCase()).includes(tag.toLowerCase()));
      } catch { /* ignore parse errors */ }
    })();
  }, [tag]);

  // ── Toggle follow ────────────────────────────────────────────────────────
  const handleToggleFollow = useCallback(async () => {
    if (!tag || followLoading) return;
    setFollowLoading(true);

    try {
      const raw = await AsyncStorage.getItem(FOLLOWED_HASHTAGS_KEY);
      const followed: string[] = raw ? JSON.parse(raw) : [];
      const idx = followed.findIndex(t => t.toLowerCase() === tag.toLowerCase());

      if (idx >= 0) {
        followed.splice(idx, 1);
        setIsFollowing(false);
      } else {
        followed.push(tag);
        setIsFollowing(true);
      }

      await AsyncStorage.setItem(FOLLOWED_HASHTAGS_KEY, JSON.stringify(followed));
    } catch (e) {
      if (__DEV__) console.warn('[HashtagScreen] Follow toggle failed:', e);
    } finally {
      setFollowLoading(false);
    }
  }, [tag, followLoading]);

  // ── Fetch posts ──────────────────────────────────────────────────────────
  const fetchPosts = useCallback(async () => {
    if (!tag) {
      setError('No hashtag provided');
      setLoading(false);
      return;
    }

    try {
      // Query posts where `hashtags` array contains the tag (case-insensitive).
      // Firestore `array-contains` is case-sensitive, so we try the original
      // tag first, then lowercase as fallback.
      let snap = await firestore()
        .collection('posts')
        .where('hashtags', 'array-contains', tag)
        .orderBy('createdAt', 'desc')
        .limit(PAGE_SIZE)
        .get();

      // If the tag is mixed-case and Firestore returned nothing, try lowercase
      if (snap.empty && tag !== tag.toLowerCase()) {
        try {
          const fallbackSnap = await firestore()
            .collection('posts')
            .where('hashtags', 'array-contains', tag.toLowerCase())
            .orderBy('createdAt', 'desc')
            .limit(PAGE_SIZE)
            .get();
          if (!fallbackSnap.empty) snap = fallbackSnap;
        } catch { /* stick with original empty result */ }
      }

      // Map to Post objects (same shape as BookmarksScreen / FeedScreen)
      const mapped: Post[] = snap.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          authorId: data.authorId || '',
          authorUsername: data.authorUsername || '',
          authorDisplayName: data.authorDisplayName || '',
          authorProfileImage: data.authorProfileImage || null,
          authorBadge: data.authorBadge || '',
          authorIsVerified: data.authorIsVerified || false,
          caption: data.caption || '',
          mediaUrls: parseMediaUrls(data.mediaUrls),
          likeCount: data.likeCount || 0,
          commentCount: data.commentCount || 0,
          repostCount: data.repostCount || 0,
          liked: false,
          bookmarked: false,
          reposted: false,
          createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
        };
      });

      // Enrich author profiles from user docs so that name/avatar
      // changes reflect immediately.
      await enrichAuthorProfiles(mapped);

      setPosts(mapped);
      setError(null);
    } catch (e: any) {
      if (__DEV__) console.error('[HashtagScreen] Failed to fetch posts:', e?.message);
      // Check for missing composite index error
      if (e?._missingIndex) {
        setError('This query requires an index. Please try again later.');
      } else {
        setError(e?.message || 'Something went wrong');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tag]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPosts();
  }, [fetchPosts]);

  // ── Render: Loading ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  // ── Render: Error ────────────────────────────────────────────────────────
  if (error && posts.length === 0) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
              <Ionicons name="arrow-back" size={22} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>#{tag}</Text>
            </View>
            <View style={{ width: 22 }} />
          </View>
        </SafeAreaView>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchPosts}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
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
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>#{tag}</Text>
          </View>
          <TouchableOpacity
            style={[
              styles.followBtn,
              isFollowing && styles.followingBtn,
            ]}
            onPress={handleToggleFollow}
            activeOpacity={0.7}
            disabled={followLoading}
          >
            {followLoading ? (
              <ActivityIndicator size="small" color={isFollowing ? colors.text : colors.bg} />
            ) : (
              <Text
                style={[
                  styles.followBtnText,
                  isFollowing && styles.followingBtnText,
                ]}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Posts list */}
      <FlatList
        data={posts}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <HashtagPostCard post={item} navigation={navigation} />
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
              <Ionicons name="hash" size={32} color={colors.textSecondary} />
            </View>
            <Text style={styles.emptyTitle}>No posts with #{tag} yet</Text>
            <Text style={styles.emptySubtitle}>
              Be the first to post with this hashtag.
            </Text>
          </View>
        }
        contentContainerStyle={posts.length === 0 ? styles.emptyList : undefined}
        showsVerticalScrollIndicator={false}
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
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  /* Follow button */
  followBtn: {
    backgroundColor: colors.text,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followBtnText: {
    color: colors.primaryForeground,
    fontSize: 14,
    fontWeight: '600',
  },
  followingBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.textTertiary,
  },
  followingBtnText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  /* Post card */
  postCard: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 4,
    paddingBottom: 12,
  },
  contentRow: {
    flexDirection: 'row',
    gap: 12,
  },
  contentColumn: {
    flex: 1,
    minWidth: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    flexWrap: 'nowrap',
    overflow: 'hidden',
  },
  displayName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 15,
  },
  handle: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  dot: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  time: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  caption: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
  },
  mediaContainer: {
    marginTop: 8,
    borderRadius: 12,
    overflow: 'hidden',
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
  /* Error */
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
    backgroundColor: colors.bgInput,
  },
  retryBtnText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
});
