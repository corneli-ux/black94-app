import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Share, Image, ScrollView, Modal, TextInput,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, withSpring, withSequence, useSharedValue } from 'react-native-reanimated';
import { colors } from '../theme/colors';
import { spring } from '../constants/animations';
import { AnimatedPressableScale } from '../components/AnimatedPressableScale';
import { scale, verticalScale as vs, fontScale as fs } from '../theme/responsive';
import { votePostPoll, Post, PostPollData, tsToMillis } from '../lib/api';
import * as ExpoLinking from 'expo-linking';
import { refreshFirebaseUrl } from '../utils/imageUpload';
import { AppIcon, RepostIcon } from '../components/icons';
import PostActionsBar from '../components/PostActionsBar';
import { LinearGradient } from 'expo-linear-gradient';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import FeedMedia from '../components/FeedMedia';
import { useAppStore } from '../stores/app';
import { useFocusEffect } from '@react-navigation/native';
import { useFeed, Tab } from '../hooks/useFeed';
import { FeedSkeleton } from '../components/SkeletonLoader';
import { enrichAuthorProfiles } from '../utils/enrichAuthorProfiles';

const SCREEN_W = scale(390);

/* ── Hashtag/Mention Highlighted Text — tappable ────────────────────────── */
function HighlightedCaption({ text, style, navigation }: { text: string; style: any; navigation?: any }) {
  const parts = text.split(/(#[\w]+|@[\w]+)/g);
  return (
    <Text style={style}>
      {parts.map((part, i) => {
        if (/^#[\w]+$/.test(part)) {
          return (
            <Text
              key={i}
              style={{ color: colors.accent }}
              onPress={() => {
                if (navigation) {
                  useAppStore.getState().setSearchQuery(part.slice(1));
                  navigation.navigate('Search');
                }
              }}
            >
              {part}
            </Text>
          );
        }
        if (/^@[\w]+$/.test(part)) {
          return (
            <Text
              key={i}
              style={{ color: colors.accent }}
              onPress={async () => {
                if (!navigation) return;
                const username = part.slice(1);
                try {
                  const snap = await firestore()
                    .collection('users')
                    .where('usernameLower', '==', username.toLowerCase())
                    .limit(1)
                    .get();
                  if (snap.docs.length > 0) {
                    const uid = snap.docs[0].id;
                    navigation.navigate('UserProfile', { userId: uid });
                  }
                } catch {}
              }}
            >
              {part}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>
      })}
    </Text>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const TABS = ['For You', 'Black94', 'Network'] as const;

function formatCount(n: number | undefined): string {
  if (!n) return '';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

/* ── Inline Poll (inside PostCard) ─────────────────────────────────────────── */

function InlinePoll({ post }: { post: Post }) {
  const currentUser = auth()?.currentUser;
  const poll = post.pollData;
  const [localPoll, setLocalPoll] = useState<PostPollData | null>(poll || null);
  const [voted, setVoted] = useState(!!post.pollVoted);
  const [voting, setVoting] = useState(false);

  const prevPostIdRef = React.useRef(post.id);
  React.useEffect(() => {
    if (prevPostIdRef.current !== post.id) {
      setVoted(!!post.pollVoted);
      prevPostIdRef.current = post.id;
    }
    setLocalPoll(poll || null);
  }, [poll, post.id, post.pollVoted]);

  const totalVotes = localPoll?.totalVotes || 0;

  const pollExpired = React.useMemo(() => {
    if (!localPoll?.createdAt || !localPoll?.duration) return false;
    try {
      const created = typeof localPoll.createdAt === 'number' ? localPoll.createdAt : new Date(localPoll.createdAt).getTime();
      const endsAt = created + (localPoll.duration * 60 * 60 * 1000);
      return Date.now() > endsAt;
    } catch { return false; }
  }, [localPoll?.createdAt, localPoll?.duration]);

  const handleVote = async (optionId: string) => {
    if (voted || !currentUser || voting || pollExpired) return;
    setVoting(true);
    try {
      const targetPostId = post.repostOf || post.id;
      const result = await votePostPoll(targetPostId, optionId);
      if (result) {
        setLocalPoll(result);
        setVoted(true);
      }
    } catch (e) {
      if (__DEV__) console.warn('[InlinePoll] Vote failed:', e);
    } finally {
      setVoting(false);
    }
  };

  if (!localPoll) return null;

  return (
    <View style={styles.pollCard}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <Text style={styles.pollQuestion}>{localPoll.question}</Text>
        {pollExpired && <Text style={styles.pollExpiredText}>Poll ended</Text>}
      </View>
      {localPoll.options.map((option) => {
        const votePercent = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
        const isSelected = voted && localPoll.options.some(o => o.id === option.id && o.votes > 0);

        return (
          <TouchableOpacity
            key={option.id}
            style={[styles.pollOptionBtn, (voted || pollExpired) && styles.pollOptionVoted]}
            onPress={() => handleVote(option.id)}
            activeOpacity={0.7}
            disabled={voted || voting || pollExpired}
          >
            {voted && (
              <View style={[styles.pollOptionFill, { width: `${votePercent}%` }, isSelected && styles.pollOptionFillSelected]} />
            )}
            <View style={styles.pollOptionContent}>
              <Text style={[styles.pollOptionText, isSelected && styles.pollOptionTextSelected]}>{option.text}</Text>
              {voted && <Text style={styles.pollOptionPercent}>{votePercent}%</Text>}
            </View>
          </TouchableOpacity>
        );
      })}
      <Text style={styles.pollTotalVotes}>{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</Text>
    </View>
  );
}

/* ── Multi-Image Carousel ─────────────────────────────────────────────── */

function MultiImageCarousel({ mediaUrls, refreshedUrls, onMediaError }: { mediaUrls: string[]; refreshedUrls: Record<string, string>; onMediaError: (url: string) => void; }) {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const scrollViewRef = React.useRef<ScrollView>(null);

  return (
    <View>
      <ScrollView ref={scrollViewRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e) => {
        const offset = e.nativeEvent.contentOffset.x;
        const index = Math.round(offset / SCREEN_W);
        setCurrentIndex(index);
      }}>
        {mediaUrls.map((url, i) => (
          <View key={i} style={{ width: SCREEN_W }}>
            <FeedMedia uri={refreshedUrls[url] || url} onRefreshUrl={() => onMediaError(url)} />
          </View>
        ))}
      </ScrollView>
      {mediaUrls.length > 1 && (
        <View style={carouselStyles.dotsContainer}>
          {mediaUrls.map((_, i) => (
            <View key={i} style={[carouselStyles.dot, i === currentIndex && carouselStyles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const carouselStyles = StyleSheet.create({
  dotsContainer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, position: 'absolute', bottom: 12, left: 0, right: 0 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderWhite40 },
  dotActive: { backgroundColor: colors.white, width: 18 },
});

/* ── PostCard ─────────────────────────────────────────────────────────────── */

const PostCard = React.memo(function PostCard({ post, onLike, onBookmark, onDelete, onRepost, onComment, onEdit, navigation }: {
  post: Post; onLike: (id: string, liked: boolean) => void; onBookmark: (id: string, bookmarked: boolean) => void;
  onDelete: (id: string) => void; onEdit: (post: any) => void; onRepost: (id: string, reposted: boolean) => void;
  onComment: (id: string, caption?: string, authorUsername?: string, authorDisplayName?: string) => void; navigation: any;
}) {
  const currentUser = auth()?.currentUser;
  const [showHeart, setShowHeart] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [refreshedUrls, setRefreshedUrls] = useState<Record<string, string>>({});
  const [qImgFailed, setQImgFailed] = useState(false);
  const refreshAttemptedRef = React.useRef(false);
  const lastTapRef = useRef(0);

  const viewTrackedRef = React.useRef(false);
  React.useEffect(() => {
    if (viewTrackedRef.current || !post.id) return;
    viewTrackedRef.current = true;
    firestore().collection('posts').doc(post.id).update({ viewCount: firestore.FieldValue.increment(1) }).catch(() => {});
  }, [post.id]);

  const CAPTION_LIMIT = 150;
  const isLongCaption = post.caption && post.caption.length > CAPTION_LIMIT;

  const interactionId = post.repostOf || post.id;

  const prevMediaUrlRef = React.useRef(post.mediaUrls?.[0] || '');
  React.useEffect(() => {
    const currentUrl = post.mediaUrls?.[0] || '';
    if (prevMediaUrlRef.current !== currentUrl) {
      setRefreshedUrls({});
      refreshAttemptedRef.current = false;
      prevMediaUrlRef.current = currentUrl;
    }
  }, [post.id, post.mediaUrls]);

  const handleMediaError = React.useCallback(async (originalUrl: string) => {
    if (__DEV__) console.warn('[Feed] Image failed:', originalUrl?.slice(0, 80));
    if (!refreshAttemptedRef.current && originalUrl) {
      refreshAttemptedRef.current = true;
      try {
        const newUrl = await refreshFirebaseUrl(originalUrl);
        if (newUrl && newUrl !== originalUrl) {
          if (__DEV__) console.log('[Feed] Refreshed URL, retrying:', newUrl.slice(0, 80));
          setRefreshedUrls(prev => ({ ...prev, [originalUrl]: newUrl }));
          return;
        }
      } catch (refreshErr: any) {
        if (__DEV__) console.warn('[Feed] URL refresh failed:', refreshErr?.message);
      }
    }
  }, []);

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (!post.liked) onLike(interactionId, post.liked);
      setShowHeart(true);
      setTimeout(() => setShowHeart(false), 900);
    }
    lastTapRef.current = now;
  };

  return (
    <View style={styles.postCard}>
      {showHeart && (
        <View style={styles.heartOverlay} pointerEvents="none">
          <AppIcon name="favorite" size={96} color={colors.like} />
        </View>
      )}

      <View style={styles.contentRow}>
        <TouchableOpacity onPress={() => {
          if (post.authorId !== currentUser?.uid) navigation.navigate('UserProfile', { userId: post.authorId });
          else navigation.navigate('ProfileSelf');
        }} activeOpacity={0.7} hitSlop={8}>
          <Avatar uri={post.authorProfileImage} name={post.authorDisplayName} size={40} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.contentColumn} activeOpacity={0.7} onPress={() => navigation.navigate('PostComments', { postId: interactionId, postCaption: post.caption, postAuthorUsername: post.authorUsername, postAuthorDisplayName: post.authorDisplayName })}>
          {post.repostOf && (
            <View style={styles.repostHeader}>
              <RepostIcon size={14} color={colors.textMuted} />
              <Text style={styles.repostHeaderText}>{post.repostedByDisplayName || post.repostedByUsername || 'Someone'} reposted</Text>
            </View>
          )}

          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => {
              if (post.authorId !== currentUser?.uid) navigation.navigate('UserProfile', { userId: post.authorId });
              else navigation.navigate('ProfileSelf');
            }} activeOpacity={0.7} style={styles.headerNameRow}>
              <Text style={styles.displayName} numberOfLines={1}>{post.authorDisplayName || post.authorUsername || 'User'}</Text>
              <VerifiedBadge badge={post.authorBadge} isVerified={post.authorIsVerified} size={16} />
              <Text style={styles.username}>@{post.authorUsername || 'user'}</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
            </TouchableOpacity>

            {!post.repostOf && (
              <TouchableOpacity style={styles.moreBtn} onPress={() => {
                if (post.authorId === currentUser?.uid) {
                  Alert.alert('Post', 'Choose an action', [
                    { text: 'Edit', onPress: () => onEdit(post) },
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => onDelete(post.id) },
                  ]);
                } else {
                  const reasons = ['Spam or misleading', 'Harassment or bullying', 'Hate speech', 'Inappropriate content', 'Other'];
                  Alert.alert('Report Post', 'Why are you reporting this post?', [
                    { text: 'Cancel', style: 'cancel' },
                    ...reasons.map(reason => ({
                      text: reason, style: 'default' as const,
                      onPress: async () => {
                        try {
                          const interactionId = post.repostOf || post.id;
                          await firestore().collection('reports').add({ type: 'post', targetId: interactionId, targetAuthorId: post.authorId, reporterId: currentUser?.uid, reason, status: 'pending', createdAt: firestore.FieldValue.serverTimestamp() });
                          Alert.alert('Reported', 'Thank you. Our team will review this post.');
                        } catch {}
                      },
                    })),
                  ]);
                }
              }}>
                <AppIcon name="more-horiz" size="md" color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {post.caption ? (
            isLongCaption && !expanded ? (
              <TouchableOpacity onPress={() => setExpanded(true)} activeOpacity={0.7}>
                <HighlightedCaption text={post.caption.slice(0, CAPTION_LIMIT)} style={styles.caption} navigation={navigation} />
                <Text style={styles.seeMoreText}> See more</Text>
              </TouchableOpacity>
            ) : isLongCaption && expanded ? (
              <TouchableOpacity onPress={() => setExpanded(false)} activeOpacity={0.7}>
                <HighlightedCaption text={post.caption} style={styles.caption} navigation={navigation} />
                <Text style={styles.seeMoreText}> See less</Text>
              </TouchableOpacity>
            ) : (
              <HighlightedCaption text={post.caption} style={styles.caption} navigation={navigation} />
            )
          ) : null}

          {post.mediaUrls?.length > 0 && (
            <TouchableOpacity activeOpacity={0.95} onPress={handleDoubleTap}>
              {post.mediaUrls.length === 1 ? (
                <FeedMedia uri={refreshedUrls[post.mediaUrls[0]] || post.mediaUrls[0]} onRefreshUrl={() => handleMediaError(post.mediaUrls[0])} />
              ) : (
                <MultiImageCarousel mediaUrls={post.mediaUrls} refreshedUrls={refreshedUrls} onMediaError={handleMediaError} />
              )}
            </TouchableOpacity>
          )}

          {post.pollData && <InlinePoll post={post} />}

          {(post.factCheckVerified || 0) > 0 && (
            <View style={styles.factCheckBadge}>
              <AppIcon name="check-circle" size="sm" color={colors.accentGreen} />
              <Text style={styles.factCheckText}>Fact-checked · {post.factCheckVerified} verified</Text>
            </View>
          )}
          {(post.factCheckDebunked || 0) > 0 && (
            <View style={styles.factCheckBadge}>
              <AppIcon name="cancel" size="sm" color={colors.error} />
              <Text style={[styles.factCheckText, { color: colors.error }]}>Debunked · {post.factCheckDebunked} flagged</Text>
            </View>
          )}

          {post.quotePostId && (
            <TouchableOpacity style={styles.quoteCard} activeOpacity={0.7} onPress={() => navigation.navigate('PostDetail', { postId: post.quotePostId })}>
              <View style={styles.quoteCardContent}>
                <Text style={styles.quoteCardAuthor}>{post.quoteAuthorDisplayName || post.quoteAuthorUsername || 'User'}</Text>
                {post.quoteCaption ? <Text style={styles.quoteCardCaption} numberOfLines={3}>{post.quoteCaption}</Text> : null}
                {post.quoteMediaUrls && post.quoteMediaUrls.length > 0 && !qImgFailed && (
                  <Image source={{ uri: post.quoteMediaUrls![0] }} style={styles.quoteCardImage} resizeMode="cover" onError={() => setQImgFailed(true)} />
                )}
              </View>
            </TouchableOpacity>
          )}

          <PostActionsBar
            post={post}
            interactionId={interactionId}
            onLike={onLike}
            onRepost={onRepost}
            onBookmark={onBookmark}
            onComment={(id) => navigation.navigate('PostComments', { postId: id, postCaption: post.caption, postAuthorUsername: post.authorUsername, postAuthorDisplayName: post.authorDisplayName })}
            onShare={async () => {
              const webUrl = `https://black94.app/post/${interactionId}`;
              const deepLink = ExpoLinking.createURL('post', { postId: interactionId });
              const author = `@${post.authorUsername || 'user'}`;
              const caption = post.caption ? `\n\n"${post.caption.slice(0, 120)}${post.caption.length > 120 ? '...' : ''}` : '';
              Alert.alert('Share', '', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Copy Link', onPress: async () => { try { await Share.share({ message: `${author} posted on Black94${caption}\n\n${webUrl}`, url: deepLink }); } catch {} },
                { text: 'Send via DM', onPress: () => { navigation.navigate('Drawer', { screen: 'MainTabs', params: { screen: 'Messages', params: { sharePostId: interactionId, shareCaption: post.caption, shareAuthor: post.authorUsername } } }); },
              ]);
            }}
            navigation={navigation}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
});

/* ── Stories Row ───────────────────────────────────────────────────────────── */

const STORY_CIRCLE_SIZE = 48;
const STORY_RING_PAD = 3;

interface StoryBubble {
  authorId: string; authorUsername: string; authorDisplayName: string; authorProfileImage: string | null;
}

const StoriesRow = React.memo(function StoriesRow({ navigation }: { navigation: any }) {
  const [bubbles, setBubbles] = useState<StoryBubble[]>([]);
  const currentUser = auth()?.currentUser;
  const storeUser = useAppStore(s => s.user);

  useEffect(() => {
    (async () => {
      try {
        const snap = await firestore().collection('stories').orderBy('createdAt', 'desc').limit(50).get();
        const now = Date.now();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        const seen = new Set<string>();
        const result: StoryBubble[] = [];
        for (const doc of snap.docs) {
          const d = doc.data();
          const created = (() => { try { return tsToMillis(d.createdAt); } catch { return Date.now(); } })();
          if (now - created > twentyFourHours) continue;
          const aid = d.authorId || '';
          if (aid === currentUser?.uid) continue;
          if (seen.has(aid)) continue;
          result.push({ authorId: aid, authorUsername: d.authorUsername || '', authorDisplayName: d.authorDisplayName || '', authorProfileImage: d.authorProfileImage || null });
        }
        setBubbles(result);
      } catch {}
    })();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (bubbles.length === 0) return;
    (async () => {
      try {
        await enrichAuthorProfiles(bubbles);
        setBubbles(prev => prev.map(b => ({ ...b })));
      } catch {}
    })();
  }, [bubbles.length]);

  if (bubbles.length === 0) return null;

  return (
    <View style={storiesRowStyles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={storiesRowStyles.scrollContent}>
        {bubbles.map((b) => (
          <TouchableOpacity key={b.authorId} style={storiesRowStyles.bubble} onPress={() => navigation.navigate('Stories')}>
            <LinearGradient colors={['#f09433', '#e6683c', '#dc2743', '#cc2366', '#bc1888', '#8a3ab9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={storiesRowStyles.gradientRing}>
              <View style={storiesRowStyles.avatarContainer}>
                <Avatar uri={b.authorProfileImage} name={b.authorDisplayName} size={STORY_CIRCLE_SIZE} />
              </View>
            </LinearGradient>
            <Text style={storiesRowStyles.label} numberOfLines={1}>{b.authorUsername || b.authorDisplayName}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
});

const storiesRowStyles = StyleSheet.create({
  container: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  scrollContent: { paddingHorizontal: 16, gap: 14, alignItems: 'flex-start' },
  bubble: { alignItems: 'center', width: STORY_CIRCLE_SIZE + 20 },
  gradientRing: { width: STORY_CIRCLE_SIZE + STORY_RING_PAD * 2 + 2, height: STORY_CIRCLE_SIZE + STORY_RING_PAD * 2 + 2, borderRadius: (STORY_CIRCLE_SIZE + STORY_RING_PAD * 2 + 2) / 2, alignItems: 'center', justifyContent: 'center' },
  avatarContainer: { borderRadius: STORY_CIRCLE_SIZE / 2, borderWidth: 2, borderColor: colors.bg, overflow: 'hidden' },
  label: { color: colors.textSecondary, fontSize: fs(11), marginTop: 4, textAlign: 'center' },
});

/* ── FAB — Create Post floating action button ───────────────────────────────
 * Animated press: scales down + the plus icon rotates 45° so it momentarily
 * becomes an "x" hint, signalling that the compose sheet can be dismissed.
 */
const Fab = React.memo(function Fab({ bottom, onPress }: { bottom: number; onPress: () => void; }) {
  const rotate = useSharedValue(0);
  const scale = useSharedValue(1);

  const handlePress = useCallback(() => {
    rotate.value = withSequence(
      withSpring(0.25, spring.bouncy),  // ~45° peek
      withSpring(0, spring.snappy),
    );
    scale.value = withSequence(
      withSpring(0.88, spring.snappy),
      withSpring(1, spring.bouncy),
    );
    onPress();
  }, [onPress, rotate, scale]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotate.value}turn` }, { scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.fab,
        { bottom, transform: [{ scale }] },
      ]}
    >
      <AnimatedPressableScale
        scale={0.9}
        springConfig={spring.bouncy}
        onPress={handlePress}
        style={styles.fabInner}
        hitSlop={8}
        activeOpacity={0.95}
      >
        <Animated.View style={iconStyle}>
          <Feather name="plus" size={26} color={colors.primaryForeground} />
        </Animated.View>
      </AnimatedPressableScale>
    </Animated.View>
  );
});

/* ── FeedScreen ───────────────────────────────────────────────────────────── */

export default function FeedScreen({ navigation }: any) {
  const setTabBarVisible = useAppStore(s => s.setTabBarVisible);
  const unreadCount = useAppStore(s => s.unreadNotificationCount);
  const { posts, loading, loadingMore, refreshing, activeTab, setActiveTab, followedUserIds, handleRefresh, handleLike, handleBookmark, handleRepost, handleDelete, handleEdit, handleComment, handleTabChange, loadMore, editingPost, editCaption, setEditCaption, setEditingPost, handleSaveEdit, flatListRef } = useFeed({ navigation });

  const insets = useSafeAreaInsets();

  const [myAvatar, setMyAvatar] = React.useState<string | undefined>(undefined);
  const [myName, setMyName] = React.useState<string | undefined>(undefined);
  const loadMyProfile = useCallback(async () => {
    const uid = auth()?.currentUser?.uid;
    if (!uid) return;
    try {
      const { getUserProfile, invalidateUserCache } = await import('../lib/userCache');
      invalidateUserCache(uid);
      const p = await getUserProfile(uid);
      if (p) { setMyAvatar(p.profileImage); setMyName(p.displayName || p.username); }
    } catch {}
  }, []);
  React.useEffect(() => { loadMyProfile(); }, [loadMyProfile]);

  const [forceLoaded, setForceLoaded] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => { if (loading) setForceLoaded(true); }, 15000);
    return () => clearTimeout(timer);
  }, [loading]);

  useFocusEffect(useCallback(() => {
    setTabBarVisible(true);
    loadMyProfile();
    return () => {};
  }, [setTabBarVisible, loadMyProfile]));

  const showSkeleton = loading && !forceLoaded;

  // ── Coordinated header + tab bar hide/show (spring physics) ─────────────
  // Driven by a single shared value so the header and tab bar move as one
  // system. `headerTranslateY` is animated via withSpring on the UI thread,
  // so it stays smooth even when JS is busy.
  const headerVisibleSV = useSharedValue(1);
  const lastScrollY = useRef(0);
  const showHideTimerRef = useRef<NodeJS.Timeout | null>(null);

  const setHeaderVisible = useCallback((visible: boolean) => {
    headerVisibleSV.value = visible ? 1 : 0;
    setTabBarVisible(visible);
  }, [headerVisibleSV, setTabBarVisible]);

  const handleFeedScroll = useCallback((e: any) => {
    const currentY = e.nativeEvent.contentOffset.y;
    const scrollingDown = currentY > lastScrollY.current + 8;
    const scrollingUp = currentY < lastScrollY.current - 8;

    if (scrollingDown && currentY > 60) {
      setHeaderVisible(false);
      // Auto-reveal if user stops scrolling for a beat — feels alive.
      if (showHideTimerRef.current) clearTimeout(showHideTimerRef.current);
      showHideTimerRef.current = setTimeout(() => setHeaderVisible(true), 1400);
    } else if (scrollingUp || currentY < 20) {
      if (showHideTimerRef.current) clearTimeout(showHideTimerRef.current);
      setHeaderVisible(true);
    }

    lastScrollY.current = currentY;
  }, [setHeaderVisible]);

  // Cleanup the auto-reveal timer on unmount
  useEffect(() => () => {
    if (showHideTimerRef.current) clearTimeout(showHideTimerRef.current);
  }, []);

  // ── Smooth animated style for top header ────────────────────────────────
  // Uses the SAME spring config as AnimatedTabBar so they move in lockstep.
  const headerAnimatedStyle = useAnimatedStyle(() => {
    const visible = headerVisibleSV.value;
    const translateY = withSpring(visible ? 0 : -130, spring.gentle);
    const opacity = withSpring(visible ? 1 : 0, spring.gentle);
    const scale = withSpring(visible ? 1 : 0.97, spring.gentle);
    return { transform: [{ translateY }, { scale }], opacity };
  });

  if (showSkeleton) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.navigate('Profile')} style={styles.headerBtn}>
              <Avatar uri={myAvatar} name={myName} size={32} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Image source={require('../../assets/logo.png')} style={styles.logoImage} />
            </View>
            <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('Notifications')}>
              <Feather name="bell" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        <View style={styles.tabBar}>
          {TABS.map(tab => (
            <TouchableOpacity key={tab} style={styles.tabItem} disabled>
              <Text style={[styles.tabText, activeTab === tab ? styles.tabTextActive : styles.tabTextInactive]}>{tab}</Text>
              {activeTab === tab && <View style={styles.tabUnderline} />}
            </TouchableOpacity>
          ))}
        </View>

        <FeedSkeleton count={5} />
      </View>
    );
  }

  const currentUser = auth()?.currentUser;
  const currentUserId = currentUser?.uid;
  const filterByVisibility = (list: Post[]): Post[] => list.filter(p => {
    if (p.authorId === currentUserId) return true;
    if (p.visibility === 'public' || !p.visibility) return true;
    if (p.visibility === 'followers') return followedUserIds.has(p.authorId);
    return true;
  });

  const displayPosts: Post[] = (() => {
    let filtered: Post[];
    if (activeTab === 'Network') {
      if (followedUserIds.size === 0) return [];
      filtered = posts.filter(p => followedUserIds.has(p.authorId) || followedUserIds.has(p.repostedByUid || ''));
    } else {
      filtered = posts;
    }
    return filterByVisibility(filtered);
  })();

  const tabBarHeight = 50 + (insets.bottom || 0);
  const fabBottom = tabBarHeight + 8;

  return (
    <View style={styles.container}>
      {/* Animated Header */}
      <Animated.View style={[styles.headerAnimatedContainer, headerAnimatedStyle]}>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.navigate('Profile')} style={styles.headerBtn}>
              <Avatar uri={myAvatar} name={myName} size={32} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Image source={require('../../assets/logo.png')} style={styles.logoImage} />
            </View>
            <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('Notifications')}>
              <Feather name="bell" size={22} color={colors.textSecondary} />
              {unreadCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Animated.View>

      {/* Feed Tabs */}
      <View style={styles.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity key={tab} style={styles.tabItem} onPress={() => handleTabChange(tab as Tab)}>
            <Text style={[styles.tabText, activeTab === tab ? styles.tabTextActive : styles.tabTextInactive]}>{tab}</Text>
            {activeTab === tab && <View style={styles.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Feed */}
      <FlatList
        ref={flatListRef}
        data={displayPosts}
        keyExtractor={item => item.id}
        ListHeaderComponent={(activeTab === 'For You' || activeTab === 'Black94') ? <StoriesRow navigation={navigation} /> : null}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            onLike={handleLike}
            onBookmark={handleBookmark}
            onDelete={handleDelete}
            onEdit={handleEdit}
            onRepost={handleRepost}
            onComment={handleComment}
            navigation={navigation}
          />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} progressViewOffset={0} />}
        onScroll={handleFeedScroll}
        scrollEventThrottle={16}
        nestedScrollEnabled={true}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loadingMore ? <View style={styles.loadMoreIndicator}><ActivityIndicator color={colors.textSecondary} size="small" /></View> : null}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}><Feather name="message-circle" size={36} color={colors.textSecondary} /></View>
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptySubtitle}>When people post, their posts will show up here.</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={handleRefresh}>
              <Text style={styles.emptyBtnText}>Tap to retry</Text>
            </TouchableOpacity>
          </View>
        }
        contentContainerStyle={{ paddingBottom: fabBottom + 72 }}
      />

      {/* FAB — animated press scale + rotate via AnimatedPressableScale wrapper.
          The inner plus icon also rotates 90° on press for extra playfulness. */}
      <Fab bottom={fabBottom} onPress={() => navigation.navigate('CreatePost')} />

      {/* Edit post modal */}
      <Modal visible={!!editingPost} transparent animationType="fade" onRequestClose={() => setEditingPost(null)}>
        <TouchableOpacity style={styles.editModalOverlay} activeOpacity={1} onPress={() => setEditingPost(null)}>
          <View style={styles.editModal}>
            <Text style={styles.editModalTitle}>Edit Post</Text>
            <TextInput style={styles.editModalInput} multiline value={editCaption} onChangeText={setEditCaption} maxLength={500} placeholder="What's happening?" placeholderTextColor={colors.textTertiary} autoFocus />
            <Text style={styles.editCharCount}>{editCaption.length}/500</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity style={[styles.editModalBtn, { backgroundColor: colors.surface }]} onPress={() => setEditingPost(null)}>
                <Text style={[styles.editModalBtnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.editModalBtn, { backgroundColor: colors.accent }]} onPress={handleSaveEdit}>
                <Text style={[styles.editModalBtnText, { color: colors.primaryForeground }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

/* ── Styles ───────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  headerAnimatedContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: colors.bg,
  },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: scale(20), paddingTop: scale(8), paddingBottom: scale(10),
    height: scale(56),
    borderBottomWidth: 0.5, borderBottomColor: colors.separator,
    backgroundColor: colors.bg,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  notifBadge: {
    position: 'absolute', top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 2, borderColor: colors.bg,
  },
  notifBadgeText: { color: '#000', fontSize: 10, fontWeight: '800' },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  logoImage: { width: 130, height: 44, resizeMode: 'contain' },

  tabBar: {
    flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)', backgroundColor: colors.bg,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingTop: 12, paddingBottom: 12, position: 'relative' },
  tabText: { fontSize: fs(15) },
  tabTextActive: { color: colors.white, fontWeight: '700', letterSpacing: -0.2 },
  tabTextInactive: { color: colors.textSecondary, fontWeight: '400' },
  tabUnderline: { position: 'absolute', bottom: 0, left: 20, right: 20, height: 2, borderRadius: 1, backgroundColor: colors.accent },

  postCard: { backgroundColor: colors.bg, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  repostHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4, paddingLeft: 52 },
  repostHeaderText: { color: colors.textMuted, fontSize: 13, fontWeight: '500' },
  contentRow: { flexDirection: 'row', gap: 10 },
  contentColumn: { flex: 1, minWidth: 0, position: 'relative' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, flexWrap: 'nowrap', overflow: 'hidden' },
  displayName: { color: colors.white, fontWeight: '700', fontSize: fs(15), lineHeight: vs(20), letterSpacing: -0.1 },
  username: { color: colors.textMuted, fontSize: fs(13), lineHeight: vs(20) },
  dot: { color: colors.textMuted, fontSize: fs(13), lineHeight: vs(20) },
  time: { color: colors.textMuted, fontSize: fs(13), lineHeight: vs(20) },
  moreBtn: { position: 'absolute', top: 0, right: 0, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  caption: { color: '#f0f0f0', fontSize: fs(15), lineHeight: vs(22), marginTop: scale(3) },
  seeMoreText: { color: colors.accent, fontSize: fs(15), lineHeight: vs(20), marginTop: scale(4) },

  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginLeft: -4, maxWidth: scale(440), justifyContent: 'space-between' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actionPair: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  actionIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  actionCount: { color: colors.textMuted, fontSize: fs(13), lineHeight: vs(16), marginLeft: scale(1) },

  factCheckBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.greenFaint, borderRadius: 6, alignSelf: 'flex-start' },
  factCheckText: { color: colors.accentGreen, fontSize: fs(12), lineHeight: vs(16) },

  quoteCard: { marginTop: 10, borderRadius: 16, backgroundColor: colors.surfaceLight, borderWidth: 1, borderColor: colors.borderSubtle, overflow: 'hidden' },
  quoteCardLine: { width: 0, height: 0 },
  quoteCardContent: { flex: 1, padding: 12, gap: 4 },
  quoteCardAuthor: { color: colors.text, fontSize: fs(13), fontWeight: '700' },
  quoteCardCaption: { color: colors.textSecondary, fontSize: fs(13), lineHeight: vs(18) },
  quoteCardImage: { width: '100%', height: 200, borderRadius: 10, marginTop: 6 },

  heartOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 10 },

  loadMoreIndicator: { paddingVertical: 20, alignItems: 'center' },

  fab: { position: 'absolute', right: 16, width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', elevation: 12, shadowColor: colors.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8, zIndex: 999 },
  fabInner: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },

  emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.bgSubtle, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 12 },
  emptySubtitle: { color: colors.textSecondary, fontSize: 15, marginTop: 4 },
  emptyBtn: { marginTop: 20, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface, borderRadius: 8 },
  emptyBtnText: { color: colors.accent, fontSize: 14 },

  pollCard: { backgroundColor: colors.bgSubtle, borderRadius: scale(16), padding: scale(16), marginTop: scale(12), borderWidth: 1, borderColor: colors.separator },
  pollQuestion: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 12, flex: 1 },
  pollExpiredText: { color: colors.like, fontSize: 12, fontWeight: '600' },

  editModalOverlay: { flex: 1, backgroundColor: colors.overlay },
  editModal: { position: 'absolute', bottom: 100, left: 16, right: 16, backgroundColor: colors.avatarFallback, borderRadius: 16, padding: 20 },
  editModalTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 12 },
  editModalInput: { color: colors.text, fontSize: 15, minHeight: 100, maxHeight: 200, textAlignVertical: 'top', backgroundColor: colors.bgSubtleAlt, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.borderSubtleStrong },
  editCharCount: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 4 },
  editModalBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  editModalBtnText: { fontSize: 15, fontWeight: '600' },

  pollOptionBtn: { borderWidth: 1, borderColor: colors.borderSubtleAlt, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 12, marginBottom: 8, backgroundColor: colors.rowUnreadBg, overflow: 'hidden', position: 'relative' },
  pollOptionVoted: { backgroundColor: colors.rowUnreadBg },
  pollOptionFill: { position: 'absolute', top: 0, left: 0, bottom: 0, backgroundColor: colors.bgInput, borderRadius: 10 },
  pollOptionFillSelected: { backgroundColor: colors.accentBorderStrong },
  pollOptionContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pollOptionText: { color: colors.text, fontSize: 14, fontWeight: '500' },
  pollOptionTextSelected: { color: colors.accent, fontWeight: '700' },
  pollOptionPercent: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  pollTotalVotes: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
});