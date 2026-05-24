import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Image, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { parseMediaUrls } from '../lib/api';
import { tsToMillis } from '../utils/datetime';
import { enrichAuthorProfiles } from '../utils/enrichAuthorProfiles';
import { AppIcon } from '../components/icons';

interface LikedPost {
  id: string;
  authorId: string;
  authorDisplayName: string;
  authorUsername: string;
  authorProfileImage: string | null;
  caption: string;
  mediaUrl: string | null;
  createdAt: number;
}

export default function LikedPostsScreen() {
  const navigation = useNavigation<any>();
  const [posts, setPosts] = useState<LikedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadPosts = useCallback(async () => {
    const userId = auth()?.currentUser?.uid;
    if (!userId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      // 1. Fetch all like docs for this user
      const likesSnap = await firestore()
        .collection('post_likes')
        .where('userId', '==', userId)
        .limit(50)
        .orderBy('createdAt', 'desc')
        .get();

      const likeEntries = likesSnap.docs
        .map((d) => ({ id: d.id, postId: d.data().postId }))
        .filter((e) => !!e.postId);

      if (likeEntries.length === 0) {
        setPosts([]);
        return;
      }

      // 2. Batch-read post documents
      const BATCH_SIZE = 30;
      const POST_DB = 'projects/black94/databases/(default)/documents/posts';
      const postMap: Record<string, any> = {};

      try {
        for (let i = 0; i < likeEntries.length; i += BATCH_SIZE) {
          const batch = likeEntries.slice(i, i + BATCH_SIZE);
          const refValues = batch.map((e) => `${POST_DB}/${e.postId}`);
          const postSnap = await firestore()
            .collection('posts')
            .where('__name__', 'in', refValues)
            .get();
          for (const doc of postSnap.docs) {
            postMap[doc.id] = doc.data();
          }
        }
      } catch {
        // Fallback: individual reads
        const results = await Promise.all(
          likeEntries.map(async (entry) => {
            try {
              const postSnap = await firestore()
                .collection('posts')
                .doc(entry.postId)
                .get();
              if (postSnap.exists) return { id: entry.postId, data: postSnap.data() };
            } catch { /* skip */ }
            return null;
          }),
        );
        for (const r of results) {
          if (r) postMap[r.id] = r.data;
        }
      }

      // 3. Build display objects
      const items: LikedPost[] = [];
      for (const entry of likeEntries) {
        const data = postMap[entry.postId];
        if (!data) continue;
        const mediaUrls = parseMediaUrls(data.mediaUrls);
        items.push({
          id: entry.postId,
          authorId: data.authorId || '',
          authorDisplayName: data.authorDisplayName || 'User',
          authorUsername: data.authorUsername || '',
          authorProfileImage: data.authorProfileImage || null,
          caption: data.caption || '',
          mediaUrl: mediaUrls.length > 0 ? mediaUrls[0] : null,
          createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
        });
      }

      // Enrich author profiles from user docs so that name/avatar
      // changes reflect immediately.
      await enrichAuthorProfiles(items);

      setPosts(items);
    } catch (e: any) {
      console.error('[LikedPosts] Failed to load:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadPosts();
  };

  const renderItem = ({ item }: { item: LikedPost }) => (
    <TouchableOpacity
      style={styles.postCard}
      onPress={() => navigation.navigate('PostDetail', { postId: item.id })}
      activeOpacity={0.7}
    >
      <View style={styles.postHeader}>
        <Avatar uri={item.authorProfileImage} name={item.authorDisplayName} size={40} />
        <View style={styles.postHeaderInfo}>
          <Text style={styles.displayName} numberOfLines={1}>
            {item.authorDisplayName}
          </Text>
          <Text style={styles.postMeta}>
            @{item.authorUsername} · {timeAgo(item.createdAt)}
          </Text>
        </View>
        <AppIcon name="favorite" size="md" color={colors.like} />
      </View>
      {item.caption ? (
        <Text style={styles.caption} numberOfLines={2}>{item.caption}</Text>
      ) : null}
      {item.mediaUrl && (
        <Image source={{ uri: item.mediaUrl }} style={styles.thumbnail} resizeMode="cover" />
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <AppIcon name="arrow-back" size="lg" color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Likes</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
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
                <AppIcon name="favorite-border" size="3xl" color={colors.textSecondary} />
              </View>
              <Text style={styles.emptyTitle}>No liked posts yet</Text>
              <Text style={styles.emptySubtitle}>
                Posts you like will appear here. Tap the heart icon on any post to like it.
              </Text>
            </View>
          }
          contentContainerStyle={posts.length === 0 ? styles.emptyList : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  postCard: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  postHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  postHeaderInfo: { flex: 1, minWidth: 0 },
  displayName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  postMeta: { color: colors.textSecondary, fontSize: 13 },
  caption: { color: colors.text, fontSize: 15, lineHeight: 20, marginTop: 8 },
  thumbnail: {
    width: '100%', height: 200, borderRadius: 10, marginTop: 10,
    backgroundColor: colors.surface,
  },
  emptyList: { flexGrow: 1 },
  emptyState: { alignItems: 'center', paddingTop: 100 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.bgSubtle,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  emptySubtitle: {
    color: colors.textSecondary, fontSize: 14, textAlign: 'center',
    paddingHorizontal: 40, lineHeight: 22,
  },
});
