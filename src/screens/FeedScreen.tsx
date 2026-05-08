import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, Image as RNImage, TouchableOpacity, StyleSheet,
  RefreshControl, TextInput, Modal, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert, Dimensions, Share, Animated,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { fetchFeed, createPost, toggleLike, toggleBookmark, toggleRepost, Post } from '../lib/api';
import { Ionicons } from '@expo/vector-icons';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { useAppStore } from '../stores/app';
import {
  ReplyIcon, RepostIcon, HeartIcon, BookmarkIcon, ShareIcon,
  ViewsIcon, ImageIcon, CameraIcon, EmojiIcon, PollIcon,
  LocationIcon, formatCount, MoreIcon,
} from '../components/Icons';

const { width: SCREEN_W } = Dimensions.get('window');
const CAPTION_EXPANDED_LINES = 3;
const MAX_CAPTION_LENGTH = 4000;

/* ── Hashtag/Mention Highlighted Text ────────────────────────────────── */
function HighlightedCaption({ text, style }: { text: string; style: any }) {
  const parts = text.split(/(#\w+|@\w+)/g);
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        /^#[\w]+$/.test(part) || /^@[\w]+$/.test(part) ? (
          <Text key={i} style={{ color: '#2a7fff' }}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

const TABS = ['Discover', 'Network'] as const;
type Tab = typeof TABS[number];

/* ── Lazy image picker ── */
async function openImagePicker() {
  try {
    const { launchImageLibrary } = require('expo-image-picker');
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      selectionLimit: 4,
    });
    return result;
  } catch (err) {
    console.error('[Compose] Image picker not available:', err);
    return { assets: [], didCancel: true, errorCode: 'unavailable', errorMessage: 'Image picker not available' };
  }
}

/* ── Animated Heart Overlay ───────────────────────────────────────────── */
function AnimatedHeart({ visible }: { visible: boolean }) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, { toValue: 1.2, friction: 3, useNativeDriver: true, speed: 20 }),
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start(() => {
        Animated.parallel([
          Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 600, delay: 200, useNativeDriver: true }),
        ]).start();
      });
    } else {
      scale.setValue(0);
      opacity.setValue(0);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.heartOverlay} pointerEvents="none">
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <HeartIcon size={96} color="#f43f5e" filled />
      </Animated.View>
    </View>
  );
}

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

/* ── PostCard ─────────────────────────────────────────────────────────── */

const PostCard = React.memo(function PostCard({ post, onLike, onBookmark, onDelete, onRepost, onComment, navigation }: {
  post: Post;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onDelete: (id: string) => void;
  onRepost: (id: string, reposted: boolean) => void;
  onComment: (id: string, caption?: string, authorUsername?: string, authorDisplayName?: string) => void;
  navigation: any;
}) {
  const currentUser = auth()?.currentUser;
  const [showHeart, setShowHeart] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const lastTapRef = useRef(0);

  // Per-post optimistic repost state
  const [isReposted, setIsReposted] = useState(post.reposted);
  const [localRepostCount, setLocalRepostCount] = useState(post.repostCount);

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

  const needsSeeMore = (post.caption?.length || 0) > 140;

  return (
    <View style={styles.postCard}>
      <AnimatedHeart visible={showHeart} />

      <View style={styles.contentRow}>
        {/* Avatar */}
        <TouchableOpacity
          onPress={() => {
            if (post.authorId !== currentUser?.uid) {
              navigation.navigate('UserProfile', { userId: post.authorId });
            } else {
              navigation.navigate('ProfileSelf');
            }
          }}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <Avatar uri={post.authorProfileImage} name={post.authorDisplayName} size={40} />
        </TouchableOpacity>

        {/* Content column */}
        <TouchableOpacity
          style={styles.contentColumn}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('PostComments', {
            postId: post.id, postCaption: post.caption,
            postAuthorUsername: post.authorUsername,
            postAuthorDisplayName: post.authorDisplayName,
          })}
        >
          {/* Header row */}
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={() => {
                if (post.authorId !== currentUser?.uid) {
                  navigation.navigate('UserProfile', { userId: post.authorId });
                } else {
                  navigation.navigate('ProfileSelf');
                }
              }}
              activeOpacity={0.7}
              style={styles.headerNameRow}
            >
              <Text style={styles.displayName} numberOfLines={1}>
                {post.authorDisplayName || post.authorUsername || 'User'}
              </Text>
              <VerifiedBadge badge={post.authorBadge} isVerified={post.authorIsVerified} size={16} />
              <Text style={styles.username}>@{post.authorUsername || 'user'}</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
            </TouchableOpacity>

            {/* More button */}
            <TouchableOpacity
              style={styles.moreBtn}
              onPress={() => {
                Alert.alert('Post', 'Delete this post?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => onDelete(post.id) },
                ]);
              }}
            >
              <MoreIcon size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Caption with See More */}
          {post.caption ? (
            <View>
              <HighlightedCaption
                text={captionExpanded || !needsSeeMore ? post.caption : post.caption.slice(0, 140)}
                style={styles.caption}
                numberOfLines={captionExpanded ? undefined : CAPTION_EXPANDED_LINES}
              />
              {needsSeeMore && !captionExpanded && (
                <TouchableOpacity onPress={() => setCaptionExpanded(true)} hitSlop={8}>
                  <Text style={styles.seeMore}>Show more</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          {/* Media */}
          {post.mediaUrls?.length > 0 && (
            <TouchableOpacity activeOpacity={0.95} onPress={handleDoubleTap}>
              <View style={styles.mediaContainer}>
                <RNImage
                  source={{ uri: post.mediaUrls[0] }}
                  style={styles.media}
                  resizeMode="cover"
                />
              </View>
            </TouchableOpacity>
          )}

          {/* Action bar */}
          <View style={styles.actions}>
            {/* Reply / Comment */}
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => navigation.navigate('PostComments', {
                postId: post.id, postCaption: post.caption,
                postAuthorUsername: post.authorUsername,
                postAuthorDisplayName: post.authorDisplayName,
              })}
            >
              <View style={styles.actionIconWrap}>
                <ReplyIcon size={18} color={colors.textSecondary} />
              </View>
              {formatCount(post.commentCount) ? (
                <Text style={styles.actionCount}>{formatCount(post.commentCount)}</Text>
              ) : null}
            </TouchableOpacity>

            {/* Repost - Green accent */}
            <TouchableOpacity style={styles.actionBtn} onPress={handleRepostPress}>
              <View style={styles.actionIconWrap}>
                <RepostIcon size={18} color={isReposted ? '#10b981' : colors.textSecondary} />
              </View>
              {formatCount(localRepostCount) ? (
                <Text style={[styles.actionCount, isReposted && { color: '#10b981' }]}>
                  {formatCount(localRepostCount)}
                </Text>
              ) : null}
            </TouchableOpacity>

            {/* Like - Pink/Red fill when active */}
            <TouchableOpacity style={styles.actionBtn} onPress={() => onLike(post.id, post.liked)}>
              <View style={styles.actionIconWrap}>
                <HeartIcon size={18} color={post.liked ? '#f43f5e' : colors.textSecondary} filled={post.liked} />
              </View>
              {formatCount(post.likeCount) ? (
                <Text style={[styles.actionCount, post.liked && { color: '#f43f5e' }]}>
                  {formatCount(post.likeCount)}
                </Text>
              ) : null}
            </TouchableOpacity>

            {/* Views */}
            <TouchableOpacity style={styles.actionBtn} disabled>
              <View style={styles.actionIconWrap}>
                <ViewsIcon size={18} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>

            {/* Bookmark + Share */}
            <View style={styles.actionPair}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => onBookmark(post.id, post.bookmarked)}>
                <View style={styles.actionIconWrap}>
                  <BookmarkIcon size={18} color={post.bookmarked ? '#ffffff' : colors.textSecondary} filled={post.bookmarked} />
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
                <View style={styles.actionIconWrap}>
                  <ShareIcon size={18} color={colors.textSecondary} />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
});

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

  if (loading) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.headerBtn}>
              <View style={styles.avatarPlaceholder} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <RNImage source={require('../../assets/icon.png')} style={styles.logoImage} />
            </View>
            <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('Settings')}>
              <Ionicons name="settings-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>

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

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.headerBtn}>
            <View style={styles.avatarPlaceholder} />
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
        onScroll={(e) => {
          // Animated.event is deprecated; use direct value set instead
          try {
            const y = e.nativeEvent?.contentOffset?.y ?? 0;
            scrollY.setValue(y);
          } catch {}
        }}
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
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  logoImage: { width: 30, height: 30, resizeMode: 'contain' },
  avatarPlaceholder: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
  },

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
  tabText: { fontSize: 15 },
  tabTextActive: { color: '#ffffff', fontWeight: '700' },
  tabTextInactive: { color: '#94a3b8', fontWeight: '400' },
  tabUnderline: {
    position: 'absolute', bottom: 0, left: 24, right: 24,
    height: 2, backgroundColor: '#ffffff', borderRadius: 1,
  },
  tabIndicator: {
    position: 'absolute', bottom: 0,
    height: 2, backgroundColor: '#ffffff', borderRadius: 1,
  },

  /* ── Post Card ── */
  postCard: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  contentRow: { flexDirection: 'row', gap: 10 },
  contentColumn: { flex: 1, minWidth: 0, position: 'relative' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerNameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    flex: 1, flexWrap: 'nowrap', overflow: 'hidden',
  },
  displayName: { color: '#e7e9ea', fontWeight: '700', fontSize: 15 },
  username: { color: '#71767b', fontSize: 15 },
  dot: { color: '#71767b', fontSize: 15 },
  time: { color: '#71767b', fontSize: 15 },
  moreBtn: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 16,
  },
  caption: {
    color: '#e7e9ea', fontSize: 15, lineHeight: 20, marginTop: 2,
  },
  seeMore: {
    color: '#2a7fff', fontSize: 15, fontWeight: '600',
    marginTop: 2,
  },
  mediaContainer: {
    marginTop: 12, borderRadius: 16, overflow: 'hidden',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.08)',
  },
  media: {
    width: '100%',
    height: Math.min(SCREEN_W * 0.85, 510),
    backgroundColor: '#111',
  },

  /* ── Action bar ── */
  actions: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 10, marginLeft: -4, maxWidth: 440,
    justifyContent: 'space-between',
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  actionPair: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  actionIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  actionCount: { color: '#71767b', fontSize: 13, marginLeft: 2 },

  /* ── Heart overlay ── */
  heartOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
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

  /* ── Load more ── */
  loadMoreIndicator: { paddingVertical: 20, alignItems: 'center' },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
  },
});
