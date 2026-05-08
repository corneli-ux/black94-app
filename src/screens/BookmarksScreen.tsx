import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis, parseMediaUrls, toggleLike, toggleRepost } from '../lib/api';
import { Post } from '../lib/api';
import CommentSheet from '../components/CommentSheet';
import PostCard from '../components/PostCard';

export default function BookmarksScreen() {
  const navigation = useNavigation();
  const [bookmarks, setBookmarks] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);

  const loadBookmarks = useCallback(async () => {
    const userId = auth()?.currentUser?.uid;
    if (!userId) { setLoading(false); setRefreshing(false); return; }

    try {
      const snap = await firestore()
        .collection('post_bookmarks')
        .where('userId', '==', userId)
        .limit(50)
        .get();

      const bookmarkEntries = snap.docs.map(d => ({ id: d.id, postId: d.data().postId })).filter(e => !!e.postId);
      const posts: Post[] = [];
      for (const entry of bookmarkEntries) {
        try {
          const postSnap = await firestore().collection('posts').doc(entry.postId).get();
          if (postSnap.exists) {
            const data = postSnap.data();
            posts.push({
              id: postSnap.id, authorId: data.authorId || '', authorUsername: data.authorUsername || '',
              authorDisplayName: data.authorDisplayName || '', authorProfileImage: data.authorProfileImage || null,
              authorBadge: data.authorBadge || '', authorIsVerified: data.authorIsVerified || false,
              caption: data.caption || '', mediaUrls: parseMediaUrls(data.mediaUrls),
              likeCount: data.likeCount || 0, commentCount: data.commentCount || 0,
              repostCount: data.repostCount || 0, liked: false, bookmarked: true, reposted: false,
              createdAt: tsToMillis(data.createdAt),
            });
          }
        } catch { /* skip */ }
      }

      const uniqueAuthorIds = [...new Set(posts.map(p => p.authorId).filter(Boolean))];
      const authorMap: Record<string, any> = {};
      try {
        const userDocs = await Promise.all(uniqueAuthorIds.map(uid => firestore().collection('users').doc(uid).get().catch(() => null)));
        for (const docSnap of userDocs) { if (docSnap && docSnap.exists) authorMap[docSnap.id] = docSnap.data(); }
      } catch {}
      for (const post of posts) {
        const fresh = authorMap[post.authorId];
        if (fresh) {
          post.authorDisplayName = fresh.displayName || post.authorDisplayName;
          post.authorUsername = fresh.username || post.authorUsername;
          post.authorProfileImage = fresh.profileImage || post.authorProfileImage;
          post.authorBadge = fresh.badge || post.authorBadge;
          post.authorIsVerified = fresh.isVerified || post.authorIsVerified;
        }
      }
      setBookmarks(posts.sort((a, b) => b.createdAt - a.createdAt));
    } catch (e) { console.error('[Bookmarks] Failed to load:', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const handleScroll = useCallback((event: any) => { setCanRefresh(event.nativeEvent.contentOffset.y <= 0); }, []);
  useEffect(() => { loadBookmarks(); }, []);
  const handleRefresh = () => { setRefreshing(true); loadBookmarks(); };

  if (loading) {
    return (<View style={[styles.container, styles.centered]}><ActivityIndicator color={colors.accent} size="large" /></View>);
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Bookmarks</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      <FlatList
        data={bookmarks}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            navigation={navigation}
            onLike={async (id, liked) => {
              try { await toggleLike(id, liked); } catch {}
            }}
            onBookmark={(id) => {
              setBookmarks(prev => prev.filter(p => p.id !== id));
              try {
                const uid = auth()?.currentUser?.uid; if (!uid) return;
                firestore().collection('post_bookmarks').where('postId', '==', id).where('userId', '==', uid).get()
                  .then(snap => { for (const d of snap.docs) d.ref.delete(); }).catch(() => {});
              } catch {}
            }}
            onDelete={() => {}}
            onRepost={async (id, reposted) => {
              try { await toggleRepost(id, reposted); } catch {}
            }}
            onComment={(id) => setCommentPostId(id)}
          />
        )}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing && canRefresh} onRefresh={() => { if (canRefresh) handleRefresh(); }} tintColor={colors.accent} enabled={canRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="bookmark-outline" size={32} color={colors.textSecondary} />
            </View>
            <Text style={styles.emptyTitle}>No bookmarks yet</Text>
            <Text style={styles.emptySubtitle}>
              Save posts you love by tapping the bookmark icon. They'll show up here.
            </Text>
            <TouchableOpacity style={styles.emptyCta} onPress={() => navigation.navigate('ExploreStack' as never)}>
              <Text style={styles.emptyCtaText}>Explore posts</Text>
            </TouchableOpacity>
          </View>
        }
        contentContainerStyle={bookmarks.length === 0 ? styles.emptyList : undefined}
      />

      <CommentSheet
        visible={!!commentPostId}
        onClose={() => setCommentPostId(null)}
        postId={commentPostId || ''}
        onCommentSent={() => {}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: 100 },
  emptyList: { flexGrow: 1 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  emptySubtitle: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 50, lineHeight: 22 },
  emptyCta: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 20 },
  emptyCtaText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
});
