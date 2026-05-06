import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity, StyleSheet,
  RefreshControl, TextInput, Modal, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert, Dimensions, Share,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { fetchFeed, createPost, toggleLike, toggleBookmark, toggleRepost, Post } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import CommentSheet from '../components/CommentSheet';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_W } = Dimensions.get('window');

/* ── Hashtag/Mention Highlighted Text ────────────────────────────────── */
function HighlightedCaption({ text, style }: { text: string; style: any }) {
  const parts = text.split(/(#\w+|@\w+)/g);
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        /^#[\w]+$/.test(part) || /^@[\w]+$/.test(part) ? (
          <Text key={i} style={{ color: '#FFFFFF' }}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const TABS = ['Discover', 'Network'] as const;
type Tab = typeof TABS[number];

function formatCount(n: number | undefined): string {
  if (!n) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

/* ── Skeleton Loader ──────────────────────────────────────────────────────── */

function SkeletonCard() {
  return (
    <View style={[styles.postCard, { borderBottomColor: 'transparent' }]}>
      <View style={styles.contentRow}>
        {/* Avatar placeholder */}
        <View style={styles.skeletonAvatar} />
        <View style={{ flex: 1, gap: 8 }}>
          {/* Name + time */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[styles.skeletonLine, { width: 100, height: 14 }]} />
            <View style={[styles.skeletonLine, { width: 60, height: 14 }]} />
          </View>
          {/* Caption lines */}
          <View style={[styles.skeletonLine, { width: '90%', height: 14 }]} />
          <View style={[styles.skeletonLine, { width: '70%', height: 14 }]} />
          <View style={[styles.skeletonLine, { width: '40%', height: 14 }]} />
          {/* Action bar dots */}
          <View style={{ flexDirection: 'row', marginTop: 12, marginLeft: -4, gap: 56 }}>
            {[0, 1, 2, 3, 4].map(i => (
              <View key={i} style={[styles.skeletonDot]} />
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

/* ── PostCard ─────────────────────────────────────────────────────────────── */

const PostCard = React.memo(function PostCard({ post, onLike, onBookmark, onDelete, onRepost, onComment, navigation }: {
  post: Post;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onDelete: (id: string) => void;
  onRepost: (id: string, reposted: boolean) => void;
  onComment: (id: string, caption?: string) => void;
  navigation: any;
}) {
  const currentUser = auth()?.currentUser;
  const [showHeart, setShowHeart] = useState(false);
  const lastTapRef = useRef(0);

  // Per-post optimistic repost state
  const [isReposted, setIsReposted] = useState(post.reposted);
  const [localRepostCount, setLocalRepostCount] = useState(post.repostCount);

  // Sync when post prop changes
  React.useEffect(() => {
    setIsReposted(post.reposted);
    setLocalRepostCount(post.repostCount);
  }, [post.reposted, post.repostCount]);

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (!post.liked) {
        onLike(post.id, post.liked);
      }
      setShowHeart(true);
      setTimeout(() => setShowHeart(false), 900);
    }
    lastTapRef.current = now;
  };

  const handleRepostPress = () => {
    const next = !isReposted;
    setIsReposted(next);
    setLocalRepostCount(prev => prev + (next ? 1 : -1));
    onRepost(post.id, isReposted);
  };

  const handleShare = async () => {
    try {
      await Share.share({ message: 'Check out this post on Black94!' });
    } catch {}
  };

  return (
    <View style={styles.postCard}>
      {/* Double-tap heart overlay */}
      {showHeart && (
        <View style={styles.heartOverlay} pointerEvents="none">
          <Ionicons name="heart" size={96} color="#f43f5e" />
        </View>
      )}

      {/* Content row: avatar + content */}
      <View style={styles.contentRow}>
        {/* Avatar */}
        <TouchableOpacity
          onPress={() => {
            if (post.authorId !== currentUser?.uid) {
              navigation.navigate('UserProfile', { userId: post.authorId });
            }
          }}
        >
          <Avatar uri={post.authorProfileImage} name={post.authorDisplayName} size={48} />
        </TouchableOpacity>

        {/* Content column */}
        <View style={styles.contentColumn} onTouchEnd={handleDoubleTap}>
          {/* Header row */}
          <View style={styles.headerRow}>
            <View style={styles.headerNameRow}>
              <Text style={styles.displayName} numberOfLines={1}>
                {post.authorDisplayName || post.authorUsername || 'User'}
              </Text>
              <VerifiedBadge badge={post.authorBadge} isVerified={post.authorIsVerified} size={18} />
              <Text style={styles.username}>@{post.authorUsername || 'user'}</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
            </View>

            {/* More button */}
            {post.authorId === currentUser?.uid && (
              <TouchableOpacity
                style={styles.moreBtn}
                onPress={() => {
                  Alert.alert('Post', 'Delete this post?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => onDelete(post.id) },
                  ]);
                }}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Caption */}
          {post.caption ? (
            <HighlightedCaption text={post.caption} style={styles.caption} />
          ) : null}

          {/* Media */}
          {post.mediaUrls?.length > 0 && (
            <TouchableOpacity activeOpacity={0.95} onPress={handleDoubleTap}>
              <View style={styles.mediaContainer}>
                <Image
                  source={{ uri: post.mediaUrls[0] }}
                  style={styles.media}
                  resizeMode="cover"
                />
              </View>
            </TouchableOpacity>
          )}

          {/* Action bar */}
          <View style={styles.actions}>
            {/* Comment */}
            <TouchableOpacity style={styles.actionBtn} onPress={() => onComment(post.id, post.caption)}>
              <View style={styles.actionIconWrap}>
                <Ionicons name="chatbubble-outline" size={18} color={colors.textSecondary} />
              </View>
              {formatCount(post.commentCount) ? (
                <Text style={styles.actionCount}>{formatCount(post.commentCount)}</Text>
              ) : null}
            </TouchableOpacity>

            {/* Repost */}
            <TouchableOpacity style={styles.actionBtn} onPress={handleRepostPress}>
              <View style={styles.actionIconWrap}>
                <Ionicons
                  name="repeat"
                  size={18}
                  color={isReposted ? colors.repost : colors.textSecondary}
                />
              </View>
              {formatCount(localRepostCount) ? (
                <Text style={[styles.actionCount, isReposted && { color: colors.repost }]}>
                  {formatCount(localRepostCount)}
                </Text>
              ) : null}
            </TouchableOpacity>

            {/* Like */}
            <TouchableOpacity style={styles.actionBtn} onPress={() => onLike(post.id, post.liked)}>
              <View style={styles.actionIconWrap}>
                {post.liked ? (
                  <Ionicons name="heart" size={18} color={colors.like} />
                ) : (
                  <Ionicons name="heart-outline" size={18} color={colors.textSecondary} />
                )}
              </View>
              {formatCount(post.likeCount) ? (
                <Text style={[styles.actionCount, post.liked && { color: colors.like }]}>
                  {formatCount(post.likeCount)}
                </Text>
              ) : null}
            </TouchableOpacity>

            {/* Views */}
            <TouchableOpacity style={styles.actionBtn} disabled>
              <View style={styles.actionIconWrap}>
                <Ionicons name="trending-up-outline" size={18} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>

            {/* Bookmark + Share */}
            <View style={styles.actionPair}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => onBookmark(post.id, post.bookmarked)}>
                <View style={styles.actionIconWrap}>
                  {post.bookmarked ? (
                    <Ionicons name="bookmark" size={18} color={colors.bookmark} />
                  ) : (
                    <Ionicons name="bookmark-outline" size={18} color={colors.textSecondary} />
                  )}
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
                <View style={styles.actionIconWrap}>
                  <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
});

/* ── FeedScreen ───────────────────────────────────────────────────────────── */

export default function FeedScreen({ navigation }: any) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [composeVisible, setComposeVisible] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [posting, setPosting] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('Discover');
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [commentCaption, setCommentCaption] = useState<string>('');
  const currentUser = auth()?.currentUser;
  const flatListRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();
  const lastDocRef = useRef<any>(null);

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

      // Save cursor for next page
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
      const CHUNK_SIZE = 30;

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
            // Try batch query first (needs composite index). If it fails
            // (e.g., missing index), fall back to individual doc reads.
            let batchSucceeded = true;
            try {
              const [likesSnap, bookmarksSnap, repostsSnap] = await Promise.all([
                firestore().collection('post_likes')
                  .where('postId', 'in', chunk)
                  .where('userId', '==', userId)
                  .get(),
                firestore().collection('post_bookmarks')
                  .where('postId', 'in', chunk)
                  .where('userId', '==', userId)
                  .get(),
                firestore().collection('post_reposts')
                  .where('postId', 'in', chunk)
                  .where('userId', '==', userId)
                  .get(),
              ]);

              for (const doc of likesSnap.docs) {
                const d = doc.data();
                if (d.postId) likedIds.add(d.postId);
              }
              for (const doc of bookmarksSnap.docs) {
                const d = doc.data();
                if (d.postId) bookmarkedIds.add(d.postId);
              }
              for (const doc of repostsSnap.docs) {
                const d = doc.data();
                if (d.postId) repostedIds.add(d.postId);
              }

              // Check if any result has the _missingIndex flag
              if ((likesSnap as any)._missingIndex || (bookmarksSnap as any)._missingIndex || (repostsSnap as any)._missingIndex) {
                batchSucceeded = false;
              }
            } catch (batchErr) {
              console.warn('[Feed] Batch interaction query failed, falling back to individual reads:', batchErr);
              batchSucceeded = false;
            }

            // Fallback: individual reads using composite doc IDs
            if (!batchSucceeded) {
              console.log('[Feed] Using individual interaction reads fallback');
              const individualPromises = chunk.flatMap(postId => [
                firestore().collection('post_likes').doc(`${postId}_${userId}`).get().then(snap => {
                  if (snap.exists) likedIds.add(postId);
                }).catch(() => {}),
                firestore().collection('post_bookmarks').doc(`${postId}_${userId}`).get().then(snap => {
                  if (snap.exists) bookmarkedIds.add(postId);
                }).catch(() => {}),
                firestore().collection('post_reposts').doc(`${postId}_${userId}`).get().then(snap => {
                  if (snap.exists) repostedIds.add(postId);
                }).catch(() => {}),
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

  const handleComment = (postId: string) => { setCommentPostId(postId); };

  const handlePost = async () => {
    if (!composeText.trim()) return;
    setPosting(true);
    try {
      await createPost(composeText.trim());
      setComposeText('');
      setComposeVisible(false);
      // Reload from scratch
      lastDocRef.current = null;
      setAllLoaded(false);
      loadFeed(false);
    } catch {
      Alert.alert('Error', 'Failed to post');
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Header with logo */}
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.headerBtn}>
              <Ionicons name="menu" size={22} color="#e7e9ea" />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Image source={require('../../assets/icon.png')} style={styles.logoImage} />
            </View>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => navigation.navigate('Settings')}
            >
              <Ionicons name="settings-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        {/* Tabs */}
        <View style={styles.tabBar}>
          {TABS.map(tab => (
            <TouchableOpacity key={tab} style={styles.tabItem} disabled>
              <Text style={[styles.tabText, tab === 'Discover' ? styles.tabTextActive : styles.tabTextInactive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={[styles.tabIndicator, { left: SCREEN_W / 2 - 80, right: SCREEN_W / 2 - 80 }]} />
        </View>

        <SkeletonFeed />
      </View>
    );
  }

  const tabBarHeight = 50 + (insets.bottom || 0);
  const fabBottom = tabBarHeight + 8;

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.headerBtn}>
            <Ionicons name="menu" size={22} color="#e7e9ea" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Image source={require('../../assets/icon.png')} style={styles.logoImage} />
          </View>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => navigation.navigate('Settings')}
          >
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
            onComment={(id, caption) => { setCommentPostId(id); setCommentCaption(caption || ''); }}
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
              <Ionicons name="chatbubble-outline" size={36} color={colors.textSecondary} />
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
        contentContainerStyle={{ paddingBottom: fabBottom + 72 }}
      />

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: fabBottom }]}
        onPress={() => setComposeVisible(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={24} color="#000000" />
      </TouchableOpacity>

      {/* Compose Modal */}
      <Modal visible={composeVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setComposeVisible(false)} />
          <View style={styles.composeSheet}>
            {/* Header */}
            <View style={styles.composeHeader}>
              {/* Cancel = X icon */}
              <TouchableOpacity
                style={styles.composeCloseBtn}
                onPress={() => setComposeVisible(false)}
              >
                <Ionicons name="close" size={20} color="#e7e9ea" />
              </TouchableOpacity>
              <Text style={styles.composeTitle}>New Post</Text>
              <TouchableOpacity
                style={[styles.postBtn, !composeText.trim() && styles.postBtnDisabled]}
                onPress={handlePost}
                disabled={posting || !composeText.trim()}
              >
                {posting
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={[styles.postBtnText, !composeText.trim() && styles.postBtnTextDisabled]}>Post</Text>
                }
              </TouchableOpacity>
            </View>

            {/* Body */}
            <View style={styles.composeBody}>
              <Avatar uri={currentUser?.photoURL} name={currentUser?.displayName} size={38} />
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.composeInput}
                  placeholder="What's on your mind?"
                  placeholderTextColor="#64748b"
                  value={composeText}
                  onChangeText={setComposeText}
                  multiline
                  autoFocus
                  maxLength={4000}
                />
                {/* Action buttons row below input */}
                <View style={styles.composeActions}>
                  <TouchableOpacity style={styles.composeActionBtn}>
                    <Ionicons name="camera-outline" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.composeActionBtn}>
                    <Ionicons name="happy-outline" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                {/* Character count (only show when > 3400) */}
                {composeText.length > 3400 && (
                  <Text style={[
                    styles.charCountBottom,
                    composeText.length > 4000 * 0.95 && { color: colors.error },
                  ]}>
                    {composeText.length}/4000
                  </Text>
                )}
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <CommentSheet
        visible={!!commentPostId}
        onClose={() => { setCommentPostId(null); setCommentCaption(''); loadFeed(false); }}
        postId={commentPostId || ''}
        postCaption={commentCaption}
        onCommentSent={() => { setPosts(prev => prev.map(p => p.id === commentPostId ? { ...p, commentCount: (p.commentCount || 0) + 1 } : p)); }}
      />
    </View>
  );
}

/* ── Styles ───────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  /* ── Header ── */
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10,
    height: 56,
    borderBottomWidth: 0.5, borderBottomColor: colors.separator,
    backgroundColor: colors.bg,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  logoImage: { width: 28, height: 28, resizeMode: 'contain' },

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
  tabText: {
    fontSize: 15,
  },
  tabTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  tabTextInactive: {
    color: '#94a3b8',
    fontWeight: '400',
  },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: '#ffffff',
  },
  /* Only used in skeleton loading indicator */
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 1,
    backgroundColor: '#ffffff',
  },

  /* ── Post Card — exact match to web UserPostCard ── */
  postCard: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
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
    position: 'relative',
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
    color: '#e7e9ea',
    fontWeight: '700',
    fontSize: 15,
  },
  username: {
    color: '#94a3b8',
    fontSize: 15,
  },
  dot: {
    color: '#94a3b8',
    fontSize: 15,
  },
  time: {
    color: '#94a3b8',
    fontSize: 15,
  },
  moreBtn: {
    position: 'absolute',
    top: 0,
    right: -8,
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 16,
  },
  caption: {
    color: '#e7e9ea',
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
  },
  mediaContainer: {
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  media: {
    width: '100%',
    height: Math.min(SCREEN_W * 0.85, 510),
    backgroundColor: '#111',
  },

  /* ── Action bar ── */
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginLeft: -4,
    maxWidth: 440,
    justifyContent: 'space-between',
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  actionPair: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  actionIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  actionCount: {
    color: '#94a3b8',
    fontSize: 13,
    marginLeft: 2,
  },

  /* ── Heart overlay ── */
  heartOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },

  /* ── Skeleton ── */
  skeletonAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  skeletonLine: {
    height: 14,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  skeletonDot: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },

  /* ── Load more indicator ── */
  loadMoreIndicator: {
    paddingVertical: 20,
    alignItems: 'center',
  },

  /* ── FAB ── */
  fab: {
    position: 'absolute', right: 16,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
    elevation: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 8,
    zIndex: 999,
  },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
  },

  /* ── Compose Modal ── */
  modalOverlay: { flex: 1, backgroundColor: 'transparent' },
  composeSheet: {
    backgroundColor: '#0d0b14',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    minHeight: 220,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  composeHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 0,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    paddingBottom: 12,
  },
  composeCloseBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  composeTitle: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
    position: 'absolute',
    left: 0, right: 0,
    textAlign: 'center',
  },
  composeBody: { flexDirection: 'row', gap: 14 },
  composeInput: {
    flex: 1,
    color: '#e7e9ea',
    fontSize: 17,
    lineHeight: 24,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  composeActions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  composeActionBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  charCountBottom: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'right',
    marginTop: 4,
  },
  postBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 7,
    borderRadius: 20,
  },
  postBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  postBtnText: { color: '#000000', fontWeight: '700' },
  postBtnTextDisabled: { color: '#64748b' },
});
