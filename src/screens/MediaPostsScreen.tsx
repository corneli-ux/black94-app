import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Image, FlatList, TouchableOpacity, StyleSheet,
  Dimensions, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { firestore } from '../lib/firebase';
import { colors } from '../theme/colors';
import { parseMediaUrls } from '../lib/api';

const { width: SCREEN_W } = Dimensions.get('window');
const GAP = 2;
const NUM_COLUMNS = 3;
const THUMB_SIZE = (SCREEN_W - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

interface MediaPost {
  id: string;
  mediaUrl: string;
  isVideo: boolean;
}

function detectIsVideo(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('.mp4') ||
    lower.includes('.mov') ||
    lower.includes('.avi') ||
    lower.includes('.webm') ||
    lower.includes('.mkv')
  );
}

export default function MediaPostsScreen() {
  const route = useRoute();
  const navigation = useNavigation<any>();
  const { userId } = (route.params as { userId: string }) || {};

  const [posts, setPosts] = useState<MediaPost[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPosts = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      const snap = await firestore()
        .collection('posts')
        .where('authorId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

      // Client-side filter: only posts with media
      const items: MediaPost[] = [];
      for (const doc of snap.docs) {
        const data = doc.data();
        const mediaUrls = parseMediaUrls(data.mediaUrls);

        // Check single mediaUrl field too
        if (!mediaUrls.length && data.mediaUrl && typeof data.mediaUrl === 'string') {
          mediaUrls.push(data.mediaUrl);
        }

        if (mediaUrls.length > 0) {
          // Use first media item for the grid thumbnail
          items.push({
            id: doc.id,
            mediaUrl: mediaUrls[0],
            isVideo: detectIsVideo(mediaUrls[0]),
          });
        }
      }

      setPosts(items);
    } catch (e: any) {
      console.error('[MediaPosts] Failed to load:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const renderItem = ({ item }: { item: MediaPost }) => (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => navigation.navigate('PostDetail', { postId: item.id })}
    >
      <View style={styles.thumbContainer}>
        <Image
          source={{ uri: item.mediaUrl }}
          style={styles.thumbnail}
          resizeMode="cover"
        />
        {item.isVideo && (
          <View style={styles.playOverlay}>
            <View style={styles.playCircle}>
              <Ionicons name="play" size={20} color={colors.white} />
            </View>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Media</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : posts.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="images-outline" size={32} color={colors.textSecondary} />
          </View>
          <Text style={styles.emptyTitle}>No media posts</Text>
          <Text style={styles.emptySubtitle}>
            Posts with photos and videos will appear here in a grid view.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.countBar}>
            <Ionicons name="grid-outline" size={14} color={colors.textMuted} />
            <Text style={styles.countText}>
              {posts.length} post{posts.length !== 1 ? 's' : ''}
            </Text>
          </View>
          <FlatList
            data={posts}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            numColumns={NUM_COLUMNS}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.list}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  countBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  countText: { color: colors.textMuted, fontSize: 13, fontWeight: '500' },
  list: { paddingBottom: 20 },
  row: { paddingHorizontal: 2, gap: GAP },
  thumbContainer: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  thumbnail: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
  },
  emptyState: { alignItems: 'center', paddingTop: 100, paddingHorizontal: 40 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  emptySubtitle: {
    color: colors.textSecondary, fontSize: 14, textAlign: 'center',
    lineHeight: 22,
  },
});
