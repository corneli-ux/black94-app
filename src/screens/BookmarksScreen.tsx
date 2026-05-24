import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Dimensions, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis, parseMediaUrls, toggleRepost } from '../lib/api';
import { Post } from '../lib/api';
import { refreshFirebaseUrl } from '../utils/imageUpload';
import CommentSheet from '../components/CommentSheet';
import FeedMedia from '../components/FeedMedia';
import { enrichAuthorProfiles } from '../utils/enrichAuthorProfiles';

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
      const POST_DB = 'projects/black94/databases/(default)/documents/posts';
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
        console.warn('[Bookmarks] Batch query failed, falling back to individual reads');
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
        renderItem={({ item }) => <FullPostCard post={item} navigation={navigation} onUnbookmark={() => setBookmarks(prev => prev.filter(p => p.id !== item.id))} onComment={(id) => setCommentPostId(id)} />}
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

function FullPostCard({ post, navigation, onUnbookmark, onComment }: { post: Post; navigation: any; onUnbookmark: () => void; onComment: (id: string) => void }) {
  const [liked, setLiked] = useState(post.liked);
  const [bookmarked, setBookmarked] = useState(true);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [repostCount, setRepostCount] = useState(post.repostCount);
  const [reposted, setReposted] = useState(post.reposted);
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
    console.warn('[Bookmarks] Image failed:', originalUrl?.slice(0, 80));
    if (!refreshAttemptedRef.current && originalUrl) {
      refreshAttemptedRef.current = true;
      try {
        const newUrl = await refreshFirebaseUrl(originalUrl);
        if (newUrl && newUrl !== originalUrl) {
          setRefreshedUrls(prev => ({ ...prev, [originalUrl]: newUrl }));
          return;
        }
      } catch (refreshErr: any) {
        console.warn('[Bookmarks] URL refresh failed:', refreshErr?.message);
      }
    }
  }, []);

  const handleLike = async () => {
    const next = !liked; setLiked(next); setLikeCount(c => c + (next ? 1 : -1));
    try {
      const uid = auth()?.currentUser?.uid; if (!uid) return;
      if (next) {
        await firestore().collection('post_likes').add({ postId: post.id, userId: uid, createdAt: firestore.FieldValue.serverTimestamp() });
        await firestore().collection('posts').doc(post.id).update({ likeCount: firestore.FieldValue.increment(1) });
      } else {
        // BUG FIX: Use deterministic doc ID instead of composite query
        // (postId + userId composite index may not exist). This avoids
        // FAILED_PRECONDITION errors that silently break unlike.
        const likeDocId = `${post.id}_${uid}`;
        await firestore().collection('post_likes').doc(likeDocId).delete().catch(() => {});
        await firestore().collection('posts').doc(post.id).update({ likeCount: firestore.FieldValue.increment(-1) });
      }
    } catch (e) {
      // Revert optimistic state on failure
      setLiked(!next);
      setLikeCount(c => c + (next ? -1 : 1));
    }
  };

  const handleBookmark = async () => {
    try {
      const uid = auth()?.currentUser?.uid; if (!uid) return;
      // BUG FIX: Use deterministic doc ID instead of composite query.
      const bookmarkDocId = `${post.id}_${uid}`;
      await firestore().collection('post_bookmarks').doc(bookmarkDocId).delete().catch(() => {});
      setBookmarked(false);
      onUnbookmark();
    } catch (e) {
      console.warn('[Bookmarks] Unbookmark failed:', e);
    }
  };

  const handleComment = () => { onComment(post.id); };

  const handleShare = async () => { try { await Share.share({ message: 'Check out this post on Black94!' }); } catch {} };

  const handleRepost = async () => {
    const next = !reposted; setReposted(next); setRepostCount(c => c + (next ? 1 : -1));
    try {
      await toggleRepost(post.id, reposted);
    } catch (e) {
      // Revert optimistic state on failure
      setReposted(!next);
      setRepostCount(c => c + (next ? -1 : 1));
    }
  };

  return (
    <View style={styles.postCard}>
      <View style={styles.contentRow}>
        <TouchableOpacity onPress={() => { if (post.authorId !== auth()?.currentUser?.uid) navigation.navigate('UserProfile', { userId: post.authorId }); }}>
          <Avatar uri={post.authorProfileImage} name={post.authorDisplayName} size={48} />
        </TouchableOpacity>
        <View style={styles.contentColumn}>
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
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleComment}>
              <View style={styles.actionIconWrap}><Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} /></View>
              {formatCount(commentCount) ? <Text style={styles.actionCount}>{formatCount(commentCount)}</Text> : null}
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleRepost}>
              <View style={styles.actionIconWrap}><Ionicons name="repeat" size={18} color={reposted ? colors.accentGreen : colors.textMuted} /></View>
              {formatCount(repostCount) ? <Text style={[styles.actionCount, reposted && { color: colors.accentGreen }]}>{formatCount(repostCount)}</Text> : null}
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleLike}>
              <View style={styles.actionIconWrap}><Ionicons name={liked ? 'heart' : 'heart-outline'} size={18} color={liked ? colors.like : colors.textMuted} /></View>
              {formatCount(likeCount) ? <Text style={[styles.actionCount, liked && { color: colors.like }]}>{formatCount(likeCount)}</Text> : null}
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} disabled>
              <View style={styles.actionIconWrap}><Ionicons name="trending-up-outline" size={18} color={colors.textMuted} /></View>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity style={styles.actionBtn} onPress={handleBookmark}>
                <View style={styles.actionIconWrap}><Ionicons name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={18} color={bookmarked ? colors.white : colors.textMuted} /></View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
                <View style={styles.actionIconWrap}><Ionicons name="share-outline" size={18} color={colors.textMuted} /></View>
              </TouchableOpacity>
            </View>
          </View>
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
