import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis, parseMediaUrls } from '../lib/api';
import { Post } from '../lib/api';

export default function BookmarksScreen() {
  const navigation = useNavigation();
  const [bookmarks, setBookmarks] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);

  const loadBookmarks = useCallback(async () => {
    const userId = auth()?.currentUser?.uid;
    if (!userId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      // Fetch all bookmark docs for the current user
      const snap = await firestore()
        .collection('post_bookmarks')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      const bookmarkEntries = snap.docs.map(d => ({
        id: d.id,
        postId: d.data().postId,
      }));

      // Fetch each post by ID
      const posts: Post[] = [];
      for (const entry of bookmarkEntries) {
        try {
          const postSnap = await firestore()
            .collection('posts')
            .doc(entry.postId)
            .get();
          if (postSnap.exists) {
            const data = postSnap.data();
            posts.push({
              id: postSnap.id,
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
              bookmarked: true,
              reposted: false,
              createdAt: tsToMillis(data.createdAt),
            });
          }
        } catch {
          // Individual post fetch may fail — skip it
        }
      }

      setBookmarks(posts);
    } catch (e) {
      console.error('[Bookmarks] Failed to load:', e);
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
    loadBookmarks();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadBookmarks();
  };

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
          <Text style={styles.headerTitle}>Bookmarks</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      {/* Bookmarks List */}
      <FlatList
        data={bookmarks}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <BookmarkPostCard post={item} navigation={navigation} />}
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
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="bookmark-outline" size={32} color={colors.textSecondary} />
            </View>
            <Text style={styles.emptyTitle}>No bookmarks yet</Text>
            <Text style={styles.emptySubtitle}>
              When you save posts, they'll show up here.
            </Text>
          </View>
        }
        contentContainerStyle={bookmarks.length === 0 ? styles.emptyList : undefined}
      />
    </View>
  );
}

function BookmarkPostCard({ post, navigation }: { post: Post; navigation: any }) {
  return (
    <View style={styles.postCard}>
      {/* Author header */}
      <View style={styles.postHeader}>
        <TouchableOpacity
          onPress={() => {
            if (post.authorId !== auth()?.currentUser?.uid) {
              navigation.navigate('Profile', { userId: post.authorId });
            }
          }}
        >
          <Avatar uri={post.authorProfileImage} size={42} />
        </TouchableOpacity>
        <View style={styles.postMeta}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
            <Text style={styles.displayName} numberOfLines={1}>
              {post.authorDisplayName}
            </Text>
            <VerifiedBadge badge={post.authorBadge} />
            <Text style={styles.handle}>@{post.authorUsername}</Text>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
          </View>
        </View>
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
          <Image
            source={{ uri: post.mediaUrls[0] }}
            style={styles.media}
            resizeMode="cover"
          />
        </View>
      )}

      {/* Stats */}
      {(post.likeCount > 0 || post.commentCount > 0) && (
        <View style={styles.statsRow}>
          {post.commentCount > 0 && (
            <Text style={styles.statText}>
              {post.commentCount} {post.commentCount === 1 ? 'comment' : 'comments'}
            </Text>
          )}
          {post.likeCount > 0 && (
            <Text style={styles.statText}>
              {post.likeCount} {post.likeCount === 1 ? 'like' : 'likes'}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { justifyContent: 'center', alignItems: 'center' },
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
  postCard: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.bg },
  postHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  postMeta: { flex: 1, marginLeft: 10 },
  displayName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  handle: { color: colors.textSecondary, fontSize: 14 },
  dot: { color: colors.textSecondary, fontSize: 14 },
  time: { color: colors.textSecondary, fontSize: 14 },
  caption: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 10,
    marginLeft: 52,
  },
  mediaContainer: {
    marginLeft: 52,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 4,
  },
  media: { width: '100%', height: 220, backgroundColor: '#111' },
  statsRow: {
    flexDirection: 'row',
    gap: 20,
    marginLeft: 52,
    marginTop: 8,
  },
  statText: { color: colors.textSecondary, fontSize: 13 },
  separator: { height: 0.5, backgroundColor: colors.border },
  emptyState: { alignItems: 'center', paddingTop: 100 },
  emptyList: { flexGrow: 1 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.bgInput,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 50,
    lineHeight: 22,
  },
});
