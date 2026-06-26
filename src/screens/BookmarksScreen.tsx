import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Dimensions, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis, parseMediaUrls, Post } from '../lib/api';
import { usePostInteractions } from '../hooks/usePostInteractions';
import { refreshFirebaseUrl } from '../utils/imageUpload';
import CommentSheet from '../components/CommentSheet';
import FeedMedia from '../components/FeedMedia';
import { enrichAuthorProfiles } from '../utils/enrichAuthorProfiles';
import { AppIcon, RepostIcon } from '../components/icons';
import PostActionsBar from '../components/PostActionsBar';

const { width: SCREEN_W } = Dimensions.get('window');

const formatCount = (n: number | undefined): string => {
  if (!n) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
};

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

      // Batch-read post docs: use `in` query with __name__ for efficiency.
      // Falls back to parallel individual reads if the batch query fails.
      const POST_DB = 'projects/memora-bond/databases/(default)/documents/posts';
      const BATCH_SIZE = 30;
      const postMap: Record<string, any> = {};

      try {
        // Build reference values for __name__ filter
        for (let i = 0; i < bookmarkEntries.length; i += BATCH_SIZE) {
          const batch = bookmarkEntries.slice(i, i + BATCH_SIZE);
          const refValues = batch.map(e => `${POST_DB}/${e.postId}`);
          // Use where('__name__', 'in', [...]) with full reference paths
          const postSnap = await firestore()
            .collection('posts')
            .where('__name__', 'in', refValues)
            .get();
          for (const doc of postSnap.docs) {
            postMap[doc.id] = doc.data();
          }
        }
      } catch {
        // Fallback: parallel individual reads via Promise.all
        if (__DEV__) console.warn('[Bookmarks] Batch query failed, falling back to individual reads');
        const results = await Promise.all(
          bookmarkEntries.map(async (entry) => {
            try {
              const postSnap = await firestore().collection('posts').doc(entry.postId).get();
              if (postSnap.exists) return { id: entry.postId, data: postSnap.data() };
            } catch { /* skip */ }
            return null;
          }),
        );
        for (const r of results) {
          if (r) postMap[r.id] = r.data;
        }
      }

      // Build post objects from fetched data
      const posts: Post[] = [];
      for (const entry of bookmarkEntries) {
        const data = postMap[entry.postId];
        if (!data) continue;
        posts.push({
          id: entry.postId, authorId: data.authorId || '', authorUsername: data.authorUsername || '',
          authorDisplayName: data.authorDisplayName || '', authorProfileImage: data.authorProfileImage || null,
          authorBadge: data.authorBadge || '', authorIsVerified: data.authorIsVerified || false,
          caption: data.caption || '', mediaUrls: parseMediaUrls(data.mediaUrls),
          likeCount: data.likeCount || 0, commentCount: data.commentCount || 0,
          repostCount: data.repostCount || 0, liked: false, bookmarked: true, reposted: false,
          repostOf: data.repostOf || undefined, repostedByUid: data.repostedByUid || undefined,
          repostedByUsername: data.repostedByUsername || undefined, repostedByDisplayName: data.repostedByDisplayName || undefined,
          createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
        });
      }

      // Enrich author profiles from user docs so that name/avatar
      // changes reflect immediately.
      await enrichAuthorProfiles(posts);

      setBookmarks(posts.sort((a, b) => b.createdAt - a.createdAt));
    } catch (e) { console.error('[Bookmarks] Failed to load:', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const handleScroll = useCallback((event: any) => { setCanRefresh(event.nativeEvent.contentOffset.y <= 0); }, []);
  useEffect(() => { loadBookmarks(); }, []);
  const handleRefresh = () => { setRefreshing(true); loadBookmarks(); };

  // ── Post interactions: like, bookmark, repost ──────────────────────
  const { handlers } = usePostInteractions({
    posts: bookmarks,
    setPosts: setBookmarks,
    currentUserUid: auth()?.currentUser?.uid || null,
  });

  if (loading) {
    return (<View style={[styles.container, styles.centered]}><ActivityIndicator color={colors.accent} size="large" /></View>);
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <AppIcon name="arrow-back" size="lg" color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Bookmarks</Text>
          <View style={{ width: 22 }} />
        </View>
      </SafeAreaView>

      <FlatList
        data={bookmarks}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <FullPostCard
            post={item}
            navigation={navigation}
            onLike={handlers.like}
            onRepost={handlers.repost}
            onUnbookmark={() => setBookmarks(prev => prev.filter(p => p.id !== item.id))}
            onComment={(id) => setCommentPostId(id)}
          />
        )}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing && canRefresh} onRefresh={() => { if (canRefresh) handleRefresh(); }} tintColor={colors.accent} enabled={canRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <AppIcon name="bookmark-border" size="3xl" color={colors.textSecondary} />
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

function FullPostCard({ post, navigation, onLike, onRepost, onUnbookmark, onComment }: {
  post: Post;
  navigation: any;
  onLike: (id: string, liked: boolean) => void;
  onRepost: (id: string, reposted: boolean) => void;
  onUnbookmark: () => void;
  onComment: (id: string) => void;
}) {
  const [refreshedUrls, setRefreshedUrls] = useState<Record<string, string>>({});
  const refreshAttemptedRef = useRef(false);

  // Reset when post changes
  const prevUrlRef = useRef(post.mediaUrls?.[0] || '');
  useEffect(() => {
    const currentUrl = post.mediaUrls?.[0] || '';
    if (prevUrlRef.current !== currentUrl) {
      setRefreshedUrls({});
      refreshAttemptedRef.current = false;
      prevUrlRef.current = currentUrl;
    }
  }, [post.id, post.mediaUrls]);

  const handleMediaError = useCallback(async (originalUrl: string) => {
    if (__DEV__) console.warn('[Bookmarks] Image failed:', originalUrl?.slice(0, 80));
    if (!refreshAttemptedRef.current && originalUrl) {
      refreshAttemptedRef.current = true;
      try {
        const newUrl = await refreshFirebaseUrl(originalUrl);
        if (newUrl && newUrl !== originalUrl) {
          setRefreshedUrls(prev => ({ ...prev, [originalUrl]: newUrl }));
          return;
        }
      } catch (refreshErr: any) {
        if (__DEV__) console.warn('[Bookmarks] URL refresh failed:', refreshErr?.message);
      }
    }
  }, []);

  const interactionId = post.repostOf || post.id;

  const handleBookmark = async () => {
    // Unbookmark: remove from parent list
    onUnbookmark();
    // Also clean up the Firestore doc
    try {
      const uid = auth()?.currentUser?.uid;
      if (uid) {
        const bookmarkDocId = `${interactionId}_${uid}`;
        await firestore().collection('post_bookmarks').doc(bookmarkDocId).delete().catch(() => {});
      }
    } catch (e) {
      if (__DEV__) console.warn('[Bookmarks] Unbookmark failed:', e);
    }
  };

  // handleShare is now handled by PostActionsBar component

  return (
    <View style={styles.postCard}>
      <View style={styles.contentRow}>
        <TouchableOpacity onPress={() => { if (post.authorId !== auth()?.currentUser?.uid) navigation.navigate('UserProfile', { userId: post.authorId }); }}>
          <Avatar uri={post.authorProfileImage} name={post.authorDisplayName} size={48} />
        </TouchableOpacity>
        <View style={styles.contentColumn}>
          {/* Repost indicator */}
          {post.repostOf && (
            <View style={styles.repostHeader}>
              <RepostIcon size={14} color={colors.textMuted} />
              <Text style={styles.repostHeaderText}>
                {post.repostedByDisplayName || post.repostedByUsername || 'Someone'} reposted
              </Text>
            </View>
          )}
          <View style={styles.headerRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, flexWrap: 'nowrap', overflow: 'hidden' }}>
              <Text style={styles.displayName} numberOfLines={1}>{post.authorDisplayName}</Text>
              <VerifiedBadge badge={post.authorBadge} isVerified={post.authorIsVerified} size={18} />
              <Text style={styles.handle}>@{post.authorUsername}</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
            </View>
          </View>
          {post.caption ? <Text style={styles.caption} numberOfLines={4}>{post.caption}</Text> : null}
          {post.mediaUrls?.length > 0 && (
            <FeedMedia
              uri={refreshedUrls[post.mediaUrls[0]] || post.mediaUrls[0]}
              onRefreshUrl={() => handleMediaError(post.mediaUrls[0])}
            />
          )}
          {/* Action bar — shared PostActionsBar component */}
          <PostActionsBar
            post={post}
            interactionId={interactionId}
            onLike={onLike}
            onRepost={onRepost}
            onBookmark={handleBookmark}
            onComment={(id) => onComment(id)}
            navigation={navigation}
          />
        </View>
      </View>
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
  postCard: { backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.separator, paddingLeft: 16, paddingRight: 16, paddingTop: 4, paddingBottom: 12 },
  contentRow: { flexDirection: 'row', gap: 12 },
  contentColumn: { flex: 1, minWidth: 0 },
  repostHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  repostHeaderText: { color: colors.textMuted, fontSize: 13, fontWeight: '500' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  displayName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  handle: { color: colors.textSecondary, fontSize: 15 },
  dot: { color: colors.textSecondary, fontSize: 15 },
  time: { color: colors.textSecondary, fontSize: 15 },
  caption: { color: colors.text, fontSize: 15, lineHeight: 20, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginLeft: 0, maxWidth: 440, justifyContent: 'space-between' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  actionIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  actionCount: { color: colors.textSecondary, fontSize: 13, marginLeft: 2 },
  emptyState: { alignItems: 'center', paddingTop: 100 },
  emptyList: { flexGrow: 1 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.bgSubtle, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  emptySubtitle: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 50, lineHeight: 22 },
  emptyCta: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: colors.bgInput, borderRadius: 20 },
  emptyCtaText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
});
