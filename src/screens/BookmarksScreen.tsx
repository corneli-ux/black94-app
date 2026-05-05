import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Dimensions, Share, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis, parseMediaUrls } from '../lib/api';
import { Post } from '../lib/api';

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

  const loadBookmarks = useCallback(async () => {
    const userId = auth()?.currentUser?.uid;
    if (!userId) { setLoading(false); setRefreshing(false); return; }

    try {
      const snap = await firestore()
        .collection('post_bookmarks')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      const bookmarkEntries = snap.docs.map(d => ({ id: d.id, postId: d.data().postId }));
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
      setBookmarks(posts);
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
        renderItem={({ item }) => <FullPostCard post={item} navigation={navigation} onUnbookmark={() => setBookmarks(prev => prev.filter(p => p.id !== item.id))} />}
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
    </View>
  );
}

function FullPostCard({ post, navigation, onUnbookmark }: { post: Post; navigation: any; onUnbookmark: () => void }) {
  const [liked, setLiked] = useState(post.liked);
  const [bookmarked, setBookmarked] = useState(true);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [repostCount, setRepostCount] = useState(post.repostCount);
  const [reposted, setReposted] = useState(post.reposted);

  const handleLike = async () => {
    const next = !liked; setLiked(next); setLikeCount(c => c + (next ? 1 : -1));
    try {
      const uid = auth()?.currentUser?.uid; if (!uid) return;
      if (next) {
        await firestore().collection('post_likes').add({ postId: post.id, userId: uid, createdAt: firestore.FieldValue.serverTimestamp() });
        await firestore().collection('posts').doc(post.id).update({ likeCount: firestore.FieldValue.increment(1) });
      } else {
        const snap = await firestore().collection('post_likes').where('postId', '==', post.id).where('userId', '==', uid).get();
        for (const d of snap.docs) await d.ref.delete();
        await firestore().collection('posts').doc(post.id).update({ likeCount: firestore.FieldValue.increment(-1) });
      }
    } catch {}
  };

  const handleBookmark = async () => {
    setBookmarked(false);
    try {
      const uid = auth()?.currentUser?.uid; if (!uid) return;
      const snap = await firestore().collection('post_bookmarks').where('postId', '==', post.id).where('userId', '==', uid).get();
      for (const d of snap.docs) await d.ref.delete();
    } catch {}
    onUnbookmark();
  };

  const handleComment = () => { Alert.alert('Comments', 'Tap on a post to view comments'); };

  const handleShare = async () => { try { await Share.share({ message: 'Check out this post on Black94!' }); } catch {} };

  const handleRepost = async () => {
    const next = !reposted; setReposted(next); setRepostCount(c => c + (next ? 1 : -1));
    try {
      const uid = auth()?.currentUser?.uid; if (!uid) return;
      if (next) {
        await firestore().collection('post_reposts').add({ postId: post.id, userId: uid, createdAt: firestore.FieldValue.serverTimestamp() });
        await firestore().collection('posts').doc(post.id).update({ repostCount: firestore.FieldValue.increment(1) });
      } else {
        const snap = await firestore().collection('post_reposts').where('postId', '==', post.id).where('userId', '==', uid).get();
        for (const d of snap.docs) await d.ref.delete();
        await firestore().collection('posts').doc(post.id).update({ repostCount: firestore.FieldValue.increment(-1) });
      }
    } catch {}
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
            <View style={styles.mediaContainer}>
              <Image source={{ uri: post.mediaUrls[0] }} style={styles.media} resizeMode="cover" />
            </View>
          )}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleComment}>
              <View style={styles.actionIconWrap}><Ionicons name="chatbubble-outline" size={18} color="#71767b" /></View>
              {formatCount(commentCount) ? <Text style={styles.actionCount}>{formatCount(commentCount)}</Text> : null}
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleRepost}>
              <View style={styles.actionIconWrap}><Ionicons name="repeat" size={18} color={reposted ? '#10b981' : '#71767b'} /></View>
              {formatCount(repostCount) ? <Text style={[styles.actionCount, reposted && { color: '#10b981' }]}>{formatCount(repostCount)}</Text> : null}
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={handleLike}>
              <View style={styles.actionIconWrap}><Ionicons name={liked ? 'heart' : 'heart-outline'} size={18} color={liked ? '#f43f5e' : '#71767b'} /></View>
              {formatCount(likeCount) ? <Text style={[styles.actionCount, liked && { color: '#f43f5e' }]}>{formatCount(likeCount)}</Text> : null}
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} disabled>
              <View style={styles.actionIconWrap}><Ionicons name="trending-up-outline" size={18} color="#71767b" /></View>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity style={styles.actionBtn} onPress={handleBookmark}>
                <View style={styles.actionIconWrap}><Ionicons name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={18} color={bookmarked ? '#FFFFFF' : '#71767b'} /></View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
                <View style={styles.actionIconWrap}><Ionicons name="share-outline" size={18} color="#71767b" /></View>
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
  postCard: { backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', paddingLeft: 16, paddingRight: 16, paddingTop: 4, paddingBottom: 12 },
  contentRow: { flexDirection: 'row', gap: 12 },
  contentColumn: { flex: 1, minWidth: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  displayName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  handle: { color: colors.textSecondary, fontSize: 15 },
  dot: { color: colors.textSecondary, fontSize: 15 },
  time: { color: colors.textSecondary, fontSize: 15 },
  caption: { color: colors.text, fontSize: 15, lineHeight: 20, marginTop: 2 },
  mediaContainer: { marginTop: 12, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  media: { width: '100%', height: Math.min(SCREEN_W * 0.85, 510), backgroundColor: '#111' },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 12, marginLeft: -4, maxWidth: 440, justifyContent: 'space-between' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  actionIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  actionCount: { color: '#94a3b8', fontSize: 13, marginLeft: 2 },
  emptyState: { alignItems: 'center', paddingTop: 100 },
  emptyList: { flexGrow: 1 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  emptySubtitle: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 50, lineHeight: 22 },
  emptyCta: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 20 },
  emptyCtaText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
});
