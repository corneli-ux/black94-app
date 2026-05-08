import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, Image as RNImage, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Dimensions, Animated,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { toggleLike, toggleBookmark, toggleRepost, Post } from '../lib/api';
import { Ionicons } from '@expo/vector-icons';
import { auth, firestore } from '../lib/firebase';
import { useAppStore } from '../stores/app';
import PostCard from '../components/PostCard';
import { ReplyIcon } from '../components/Icons';
import { Avatar } from '../components/Avatar';

const { width: SCREEN_W } = Dimensions.get('window');

/* ── Helpers ──────────────────────────────────────────────────────────── */

const TABS = ['Discover', 'Network'] as const;
type Tab = typeof TABS[number];

/* ── Skeleton Loader ──────────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <View style={[styles.postCard, { borderBottomColor: 'transparent' }]}>
      <View style={styles.contentRow}>
        <View style={styles.skeletonAvatar} />
        <View style={{ flex: 1, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[styles.skeletonLine, { width: 100, height: 14 }]} />
            <View style={[styles.skeletonLine, { width: 60, height: 14 }]} />
          </View>
          <View style={[styles.skeletonLine, { width: '90%', height: 14 }]} />
          <View style={[styles.skeletonLine, { width: '70%', height: 14 }]} />
          <View style={[styles.skeletonLine, { width: '40%', height: 14 }]} />
          <View style={{ flexDirection: 'row', marginTop: 12, gap: 56 }}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={styles.skeletonDot} />
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

function SkeletonFeed() {
  return (
    <View>
      {[0, 1, 2, 3, 4].map(i => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

/* ── FeedScreen ───────────────────────────────────────────────────────── */

export default function FeedScreen({ navigation }: any) {
  const { user: storeUser } = useAppStore();
  const [posts, setPosts] = useState<Post[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('Discover');
  const currentUser = auth()?.currentUser;
  const flatListRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();
  const lastDocRef = useRef<any>(null);
  const scrollY = useRef(new Animated.Value(0)).current;

  const PAGE_SIZE = 10;

  const loadFeed = useCallback(async (append = false) => {
    try {
      if (append && (loadingMore || allLoaded)) return;
      if (append) setLoadingMore(true);

      const snapshot = lastDocRef.current
        ? await firestore()
            .collection('posts')
            .orderBy('createdAt', 'desc')
            .startAfter(lastDocRef.current)
            .limit(PAGE_SIZE)
            .get()
        : await firestore()
            .collection('posts')
            .orderBy('createdAt', 'desc')
            .limit(PAGE_SIZE)
            .get();

      if (snapshot.docs.length === 0) {
        setAllLoaded(true);
        if (append) { setLoadingMore(false); return; }
      }

      lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];

      const userId = currentUser?.uid;
      const newPosts: Post[] = snapshot.docs.map(docSnap => {
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
          mediaUrls: (() => {
            const raw = data.mediaUrls;
            if (!raw) return [];
            if (Array.isArray(raw)) return raw.filter(Boolean);
            if (typeof raw === 'string') {
              if (raw.startsWith('data:')) return [raw];
              return raw.split(',').map(u => u.trim()).filter(Boolean);
            }
            return [];
          })(),
          likeCount: data.likeCount || 0,
          commentCount: data.commentCount || 0,
          repostCount: data.repostCount || 0,
          liked: false,
          bookmarked: false,
          reposted: false,
          createdAt: (() => {
            const ts = data.createdAt;
            if (!ts) return Date.now();
            if (typeof ts === 'number') return ts;
            if (typeof ts === 'string') return new Date(ts).getTime() || Date.now();
            if (ts?.toMillis) return ts.toMillis();
            if (ts?.toDate) return ts.toDate().getTime();
            if (ts?.seconds) return ts.seconds * 1000;
            return Date.now();
          })(),
        };
      });

      if (newPosts.length === 0) {
        setAllLoaded(true);
        if (append) { setLoadingMore(false); return; }
      }

      // Batch fetch author profiles
      const uniqueAuthorIds = [...new Set(newPosts.map(p => p.authorId).filter(Boolean))];
      const authorProfileMap: Record<string, any> = {};
      const CHUNK_SIZE = 10; // Firestore IN operator max is 10

      for (let i = 0; i < uniqueAuthorIds.length; i += CHUNK_SIZE) {
        const chunk = uniqueAuthorIds.slice(i, i + CHUNK_SIZE);
        try {
          const userDocs = await Promise.all(
            chunk.map(uid => firestore().collection('users').doc(uid).get().catch(() => null))
          );
          for (const docSnap of userDocs) {
            if (docSnap && docSnap.exists) {
              const d = docSnap.data()!;
              authorProfileMap[docSnap.id] = {
                displayName: d.displayName || d.username || '',
                username: d.username || '',
                profileImage: d.profileImage || null,
                badge: d.badge || '',
                isVerified: d.isVerified || false,
              };
            }
          }
        } catch (e) {
          console.warn('[Feed] Batch author profile fetch failed for chunk:', e);
        }
      }

      for (const post of newPosts) {
        const fresh = authorProfileMap[post.authorId];
        if (fresh) {
          post.authorDisplayName = fresh.displayName || post.authorDisplayName;
          post.authorUsername = fresh.username || post.authorUsername;
          post.authorProfileImage = fresh.profileImage || post.authorProfileImage;
          post.authorBadge = fresh.badge || post.authorBadge;
          post.authorIsVerified = fresh.isVerified || post.authorIsVerified;
        }
      }

      // Batch fetch interactions
      if (userId) {
        const postIds = newPosts.map(p => p.id);
        const likedIds = new Set<string>();
        const bookmarkedIds = new Set<string>();
        const repostedIds = new Set<string>();

        for (let i = 0; i < postIds.length; i += CHUNK_SIZE) {
          const chunk = postIds.slice(i, i + CHUNK_SIZE);
          try {
            let batchSucceeded = true;
            try {
              const [likesSnap, bookmarksSnap, repostsSnap] = await Promise.all([
                firestore().collection('post_likes')
                  .where('postId', 'in', chunk).where('userId', '==', userId).get(),
                firestore().collection('post_bookmarks')
                  .where('postId', 'in', chunk).where('userId', '==', userId).get(),
                firestore().collection('post_reposts')
                  .where('postId', 'in', chunk).where('userId', '==', userId).get(),
              ]);
              for (const doc of likesSnap.docs) { if (doc.data().postId) likedIds.add(doc.data().postId); }
              for (const doc of bookmarksSnap.docs) { if (doc.data().postId) bookmarkedIds.add(doc.data().postId); }
              for (const doc of repostsSnap.docs) { if (doc.data().postId) repostedIds.add(doc.data().postId); }
              if ((likesSnap as any)._missingIndex || (bookmarksSnap as any)._missingIndex || (repostsSnap as any)._missingIndex) {
                batchSucceeded = false;
              }
            } catch (batchErr) {
              batchSucceeded = false;
            }
            if (!batchSucceeded) {
              const individualPromises = chunk.flatMap(postId => [
                firestore().collection('post_likes').doc(`${postId}_${userId}`).get().then(snap => { if (snap.exists) likedIds.add(postId); }).catch(() => {}),
                firestore().collection('post_bookmarks').doc(`${postId}_${userId}`).get().then(snap => { if (snap.exists) bookmarkedIds.add(postId); }).catch(() => {}),
                firestore().collection('post_reposts').doc(`${postId}_${userId}`).get().then(snap => { if (snap.exists) repostedIds.add(postId); }).catch(() => {}),
              ]);
              await Promise.all(individualPromises);
            }
          } catch (e) {
            console.warn('[Feed] Batch interaction fetch failed for chunk:', e);
          }
        }
        for (const post of newPosts) {
          post.liked = likedIds.has(post.id);
          post.bookmarked = bookmarkedIds.has(post.id);
          post.reposted = repostedIds.has(post.id);
        }
      }

      // Backfill commentCount from actual post_comments collection for posts
      // where the cached count is 0 or missing (older posts may not have it)
      const postsWithZeroComments = newPosts.filter(p => !p.commentCount);
      if (postsWithZeroComments.length > 0) {
        try {
          const commentCountPromises = postsWithZeroComments.map(async (post) => {
            try {
              const countSnap = await firestore()
                .collection('post_comments')
                .where('postId', '==', post.id)
                .get();
              const actualCount = countSnap.size;
              if (actualCount > 0) {
                post.commentCount = actualCount;
                // Also backfill to Firestore so next load is fast
                firestore().collection('posts').doc(post.id).update({
                  commentCount: actualCount,
                }).catch(() => {});
              }
            } catch {}
          });
          await Promise.all(commentCountPromises);
        } catch (e) {
          console.warn('[Feed] Comment count backfill failed:', e);
        }
      }

      if (append) {
        setPosts(prev => [...prev, ...newPosts]);
      } else {
        setPosts(newPosts);
      }
    } catch (e: any) {
      console.error('[FeedScreen] Feed load error:', e?.message);
      if (!append) {
        Alert.alert('Feed Error', `Could not load feed: ${e?.message || 'Unknown error'}`);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [currentUser?.uid]);

  useEffect(() => { loadFeed(); }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setAllLoaded(false);
    lastDocRef.current = null;
    loadFeed(false);
  }, [loadFeed]);

  const onEndReached = useCallback(() => {
    if (loadingMore || allLoaded) return;
    loadFeed(true);
  }, [loadingMore, allLoaded, loadFeed]);

  const handleLike = async (postId: string, liked: boolean) => {
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, liked: !liked, likeCount: p.likeCount + (liked ? -1 : 1) }
      : p));
    try { await toggleLike(postId, liked); } catch {}
  };

  const handleBookmark = async (postId: string, bookmarked: boolean) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, bookmarked: !bookmarked } : p));
    try { await toggleBookmark(postId, bookmarked); } catch {}
  };

  const handleRepost = async (postId: string, reposted: boolean) => {
    try { await toggleRepost(postId, reposted); } catch {}
  };

  const handleDelete = async (postId: string) => {
    try {
      await firestore().collection('posts').doc(postId).delete();
      setPosts(prev => prev.filter(p => p.id !== postId));
    } catch {
      Alert.alert('Error', 'Failed to delete post');
    }
  };

  const handleComment = (postId: string, caption?: string, authorUsername?: string, authorDisplayName?: string) => {
    navigation.navigate('PostComments', { postId, postCaption: caption || '', postAuthorUsername: authorUsername || '', postAuthorDisplayName: authorDisplayName || '' });
  };

  const tabBarHeight = 50 + (insets.bottom || 0);
  const fabBottom = tabBarHeight + 16;

  // Scroll-driven FAB visibility
  const [fabVisible, setFabVisible] = useState(true);
  const scrollOffset = useRef(0);

  const handleScroll = useCallback((e: any) => {
    try {
      const y = e.nativeEvent?.contentOffset?.y ?? 0;
      scrollY.setValue(y);
      if (y > 80 && y > scrollOffset.current + 10) {
        setFabVisible(false);
      } else if (y < scrollOffset.current - 5 || y < 40) {
        setFabVisible(true);
      }
      scrollOffset.current = y;
    } catch {}
  }, [scrollY]);

  // Remove skeleton loading screen — show feed directly with empty state
  // This prevents the flash of skeleton lines on app open
  const showContent = true;

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.headerBtn}>
            <Avatar uri={storeUser?.profileImage} name={storeUser?.displayName} size={30} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <RNImage source={require('../../assets/icon.png')} style={styles.logoImage} />
          </View>
          <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('Settings')}>
            <Ionicons name="settings-outline" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Feed Tabs */}
      <View style={styles.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={styles.tabItem}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab ? styles.tabTextActive : styles.tabTextInactive]}>
              {tab}
            </Text>
            {activeTab === tab && <View style={styles.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Feed */}
      <FlatList
        ref={flatListRef}
        data={posts}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onLike={handleLike}
            onBookmark={handleBookmark}
            onDelete={handleDelete}
            onRepost={handleRepost}
            onComment={handleComment}
            navigation={navigation}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            progressViewOffset={0}
          />
        }
        scrollEventThrottle={16}
        nestedScrollEnabled={true}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        onScroll={handleScroll}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.loadMoreIndicator}>
              <ActivityIndicator color={colors.textSecondary} size="small" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 80 }}>
            <View style={styles.emptyIcon}>
              <ReplyIcon size={36} color={colors.textSecondary} />
            </View>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 12 }}>No posts yet</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 15, marginTop: 4 }}>When people post, their posts will show up here.</Text>
            <TouchableOpacity
              style={{ marginTop: 20, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface, borderRadius: 8 }}
              onPress={() => { lastDocRef.current = null; setAllLoaded(false); loadFeed(false); }}
            >
              <Text style={{ color: colors.accent, fontSize: 14 }}>Tap to retry</Text>
            </TouchableOpacity>
          </View>
        }
        contentContainerStyle={{ paddingBottom: tabBarHeight + 20 }}
      />

      {/* Floating Compose Button — hides on scroll down */}
      <Animated.View
        style={{
          position: 'absolute',
          right: 16,
          bottom: fabBottom,
          opacity: fabVisible ? 1 : 0,
          transform: [{ translateY: fabVisible ? 0 : 80 }],
        }}
        pointerEvents={fabVisible ? 'auto' : 'none'}
      >
        <TouchableOpacity
          style={styles.fab}
          onPress={() => navigation.navigate('CreatePost')}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={28} color="#000000" />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

/* ── Styles ───────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  /* ── Header ── */
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8,
    height: 52,
    borderBottomWidth: 0.5, borderBottomColor: colors.separator,
    backgroundColor: colors.bg,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  logoImage: { width: 30, height: 30, resizeMode: 'contain' },

  /* ── Tabs ── */
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: colors.bg,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 12,
    position: 'relative',
  },
  tabText: { fontSize: 15, fontFamily: 'Inter-Regular' },
  tabTextActive: { color: '#ffffff', fontWeight: '700', fontFamily: 'Inter-Bold' },
  tabTextInactive: { color: '#94a3b8', fontWeight: '400', fontFamily: 'Inter-Regular' },
  tabUnderline: {
    position: 'absolute', bottom: 0, left: 24, right: 24,
    height: 2, backgroundColor: '#ffffff', borderRadius: 1,
  },
  tabIndicator: {
    position: 'absolute', bottom: 0,
    height: 2, backgroundColor: '#ffffff', borderRadius: 1,
  },

  /* ── Skeleton ── */
  skeletonAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  skeletonLine: {
    height: 14, borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  skeletonDot: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  /* ── FAB ── */
  fab: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },

  /* ── Load more ── */
  loadMoreIndicator: { paddingVertical: 20, alignItems: 'center' },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
  },
});
