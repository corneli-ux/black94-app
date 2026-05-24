import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Image, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { parseMediaUrls } from '../lib/api';
import { tsToMillis } from '../utils/datetime';

interface MentionedPost {
  id: string;
  authorId: string;
  authorDisplayName: string;
  authorUsername: string;
  authorProfileImage: string | null;
  authorBadge: string;
  authorIsVerified: boolean;
  caption: string;
  mediaUrl: string | null;
  createdAt: number;
}

export default function MentionedPostsScreen() {
  const navigation = useNavigation<any>();
  const [posts, setPosts] = useState<MentionedPost[]>([]);
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
      const snap = await firestore()
        .collection('posts')
        .where('mentions', 'array-contains', userId)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();

      const items: MentionedPost[] = snap.docs.map((doc) => {
        const data = doc.data();
        const mediaUrls = parseMediaUrls(data.mediaUrls);
        return {
          id: doc.id,
          authorId: data.authorId || '',
          authorDisplayName: data.authorDisplayName || 'User',
          authorUsername: data.authorUsername || '',
          authorProfileImage: data.authorProfileImage || null,
          authorBadge: data.authorBadge || '',
          authorIsVerified: data.authorIsVerified || false,
          caption: data.caption || '',
          mediaUrl: mediaUrls.length > 0 ? mediaUrls[0] : null,
          createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
        };
      });

      setPosts(items);
    } catch (e: any) {
      console.error('[MentionedPosts] Failed to load:', e?.message);
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

  const renderItem = ({ item }: { item: MentionedPost }) => (
    <TouchableOpacity
      style={styles.postCard}
      onPress={() => navigation.navigate('PostDetail', { postId: item.id })}
      activeOpacity={0.7}
    >
      <View style={styles.postHeader}>
        <Avatar uri={item.authorProfileImage} name={item.authorDisplayName} size={40} />
        <View style={styles.postHeaderInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.displayName} numberOfLines={1}>
              {item.authorDisplayName}
            </Text>
            <VerifiedBadge badge={item.authorBadge} isVerified={item.authorIsVerified} size={16} />
            <Text style={styles.handle}>@{item.authorUsername}</Text>
          </View>
          <Text style={styles.postMeta}>{timeAgo(item.createdAt)}</Text>
        </View>
      </View>
      {item.caption ? (
        <Text style={styles.caption} numberOfLines={3}>{item.caption}</Text>
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
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Mentions</Text>
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
                <Ionicons name="at-outline" size={32} color={colors.textSecondary} />
              </View>
              <Text style={styles.emptyTitle}>No mentions yet</Text>
              <Text style={styles.emptySubtitle}>
                When someone mentions you in a post using @username, it will show up here.
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
  nameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  displayName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  handle: { color: colors.textSecondary, fontSize: 13 },
  postMeta: { color: colors.textSecondary, fontSize: 13, marginTop: 1 },
  caption: { color: colors.text, fontSize: 15, lineHeight: 20, marginTop: 8 },
  thumbnail: {
    width: '100%', height: 200, borderRadius: 10, marginTop: 10,
    backgroundColor: colors.surface,
  },
  emptyList: { flexGrow: 1 },
  emptyState: { alignItems: 'center', paddingTop: 100 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  emptySubtitle: {
    color: colors.textSecondary, fontSize: 14, textAlign: 'center',
    paddingHorizontal: 40, lineHeight: 22,
  },
});
