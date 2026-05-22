import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Share, Image, Linking, ScrollView, Modal, TextInput,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { scale, verticalScale as vs, fontScale as fs } from '../theme/responsive';
import { toggleLike, toggleBookmark, toggleRepost, votePostPoll, Post, PostPollData, tsToMillis, parseMediaUrls } from '../lib/api';
import * as ExpoLinking from 'expo-linking';
import { refreshFirebaseUrl } from '../utils/imageUpload';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import FeedMedia from '../components/FeedMedia';
import { useAppStore } from '../stores/app';
import Svg, { Path, Polyline } from 'react-native-svg';

const SCREEN_W = scale(390);

/* ── Repost Icon (matches web app SVG exactly) ──────────────────────────── */
function RepostIcon({ size = 18, color = '#94a3b8' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="23 4 23 10 17 10" />
      <Path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </Svg>
  );
}

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
              style={{ color: '#1d9bf0' }}
              onPress={() => {
                if (navigation) {
                  // Store hashtag in Zustand and navigate to Search, which will pick it up
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
              style={{ color: '#1d9bf0' }}
              onPress={async () => {
                if (!navigation) return;
                const username = part.slice(1);
                // Look up user by username in Firestore, then navigate to their profile
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
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const TABS = ['For You', 'Black94', 'Network'] as const;
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
          <View style={{ flexDirection: 'row', marginTop: 12, gap: 56 }}>
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

/* ── Inline Poll (inside PostCard) ─────────────────────────────────────────── */

function InlinePoll({ post }: { post: Post }) {
  const currentUser = auth()?.currentUser;
  const poll = post.pollData;
  const [localPoll, setLocalPoll] = useState<PostPollData | null>(poll || null);
  // Initialize voted state from post.pollVoted (batch-checked during feed load)
  // so it survives re-renders instead of resetting to false every time.
  const [voted, setVoted] = useState(!!post.pollVoted);
  const [voting, setVoting] = useState(false);

  // Sync poll data when post prop changes, but preserve voted state
  // unless this is a genuinely new post (different ID).
  const prevPostIdRef = React.useRef(post.id);
  React.useEffect(() => {
    if (prevPostIdRef.current !== post.id) {
      // New post — reset voted state from the new post's pollVoted flag
      setVoted(!!post.pollVoted);
      prevPostIdRef.current = post.id;
    }
    setLocalPoll(poll || null);
  }, [poll, post.id, post.pollVoted]);

  const totalVotes = localPoll?.totalVotes || 0;

  // Check if poll has expired (duration is in hours)
  const pollExpired = React.useMemo(() => {
    if (!localPoll?.createdAt || !localPoll?.duration) return false;
    try {
      const created = typeof localPoll.createdAt === 'number'
        ? localPoll.createdAt
        : new Date(localPoll.createdAt).getTime();
      const endsAt = created + (localPoll.duration * 60 * 60 * 1000);
      return Date.now() > endsAt;
    } catch { return false; }
  }, [localPoll?.createdAt, localPoll?.duration]);

  const handleVote = async (optionId: string) => {
    if (voted || !currentUser || voting || pollExpired) return;
    setVoting(true);
    try {
      // For reposts, vote on the ORIGINAL post's poll
      const targetPostId = post.repostOf || post.id;
      const result = await votePostPoll(targetPostId, optionId);
      if (result) {
        setLocalPoll(result);
        setVoted(true);
      }
    } catch (e) {
      console.warn('[InlinePoll] Vote failed:', e);
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
              <View
                style={[
                  styles.pollOptionFill,
                  { width: `${votePercent}%` },
                  isSelected && styles.pollOptionFillSelected,
                ]}
              />
            )}
            <View style={styles.pollOptionContent}>
              <Text style={[styles.pollOptionText, isSelected && styles.pollOptionTextSelected]}>
                {option.text}
              </Text>
              {voted && (
                <Text style={styles.pollOptionPercent}>{votePercent}%</Text>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
      <Text style={styles.pollTotalVotes}>{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</Text>
    </View>
  );
}

/* ── Multi-Image Carousel — horizontal paging between images ──────────── */

function MultiImageCarousel({ mediaUrls, refreshedUrls, onMediaError }: {
  mediaUrls: string[];
  refreshedUrls: Record<string, string>;
  onMediaError: (url: string) => void;
}) {
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const scrollViewRef = React.useRef<ScrollView>(null);

  return (
    <View>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const offset = e.nativeEvent.contentOffset.x;
          const index = Math.round(offset / SCREEN_W);
          setCurrentIndex(index);
        }}
      >
        {mediaUrls.map((url, i) => (
          <View key={i} style={{ width: SCREEN_W }}>
            <FeedMedia
              uri={refreshedUrls[url] || url}
              onRefreshUrl={() => onMediaError(url)}
            />
          </View>
        ))}
      </ScrollView>
      {/* Page dots */}
      {mediaUrls.length > 1 && (
        <View style={carouselStyles.dotsContainer}>
          {mediaUrls.map((_, i) => (
            <View
              key={i}
              style={[
                carouselStyles.dot,
                i === currentIndex && carouselStyles.dotActive,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const carouselStyles = StyleSheet.create({
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  dotActive: {
    backgroundColor: '#FFFFFF',
    width: 18,
  },
});

/* ── PostCard ─────────────────────────────────────────────────────────────── */

const PostCard = React.memo(function PostCard({ post, onLike, onBookmark, onDelete, onRepost, onComment, onEdit, navigation }: {
  post: Post;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (post: any) => void;
  onRepost: (id: string, reposted: boolean) => void;
  onComment: (id: string, caption?: string, authorUsername?: string, authorDisplayName?: string) => void;
  navigation: any;
}) {
  const currentUser = auth()?.currentUser;
  const [showHeart, setShowHeart] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [refreshedUrls, setRefreshedUrls] = useState<Record<string, string>>({});
  const refreshAttemptedRef = React.useRef(false);
  const lastTapRef = useRef(0);

  // Auto-track view once when post becomes visible (debounced)
  const viewTrackedRef = React.useRef(false);
  React.useEffect(() => {
    if (viewTrackedRef.current || !post.id) return;
    viewTrackedRef.current = true;
    // Fire-and-forget: increment viewCount in Firestore
    firestore().collection('posts').doc(post.id).update({
      viewCount: firestore.FieldValue.increment(1),
    }).catch(() => {});
  }, [post.id]);

  const CAPTION_LIMIT = 150;
  const isLongCaption = post.caption && post.caption.length > CAPTION_LIMIT;

  // For reposts, all interactions (like, comment, bookmark, repost) should
  // target the ORIGINAL post, not the repost wrapper.
  const interactionId = post.repostOf || post.id;

  // Per-post optimistic repost state
  const [isReposted, setIsReposted] = useState(post.reposted);
  const [localRepostCount, setLocalRepostCount] = useState(post.repostCount);

  // Sync when post prop changes
  React.useEffect(() => {
    setIsReposted(post.reposted);
    setLocalRepostCount(post.repostCount);
  }, [post.reposted, post.repostCount]);

  // BUG FIX: Reset refreshedUrls when post changes (FlatList recycling).
  // Without this, a recycled PostCard may use a stale refreshed URL
  // from a previous post.
  const prevMediaUrlRef = React.useRef(post.mediaUrls?.[0] || '');
  React.useEffect(() => {
    const currentUrl = post.mediaUrls?.[0] || '';
    if (prevMediaUrlRef.current !== currentUrl) {
      setRefreshedUrls({});
      refreshAttemptedRef.current = false;
      prevMediaUrlRef.current = currentUrl;
    }
  }, [post.id, post.mediaUrls]);

  // BUG FIX: When image fails to load, try refreshing the Firebase Storage
  // download URL (token may have expired) before showing the error overlay.
  // FeedMedia handles display — this only manages the URL refresh logic.
  const handleMediaError = React.useCallback(async (originalUrl: string) => {
    console.warn('[Feed] Image failed:', originalUrl?.slice(0, 80));
    if (!refreshAttemptedRef.current && originalUrl) {
      refreshAttemptedRef.current = true;
      try {
        const newUrl = await refreshFirebaseUrl(originalUrl);
        if (newUrl && newUrl !== originalUrl) {
          console.log('[Feed] Refreshed URL, retrying:', newUrl.slice(0, 80));
          setRefreshedUrls(prev => ({ ...prev, [originalUrl]: newUrl }));
          return; // FeedMedia will auto-retry via uri prop change
        }
      } catch (refreshErr: any) {
        console.warn('[Feed] URL refresh failed:', refreshErr?.message);
      }
    }
    // Refresh failed or already attempted — FeedMedia shows error state
  }, []);

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (!post.liked) {
        onLike(interactionId, post.liked);
      }
      setShowHeart(true);
      setTimeout(() => setShowHeart(false), 900);
    }
    lastTapRef.current = now;
  };

  const handleRepostPress = () => {
    if (isReposted) {
      // Already reposted — undo it
      setIsReposted(false);
      setLocalRepostCount(prev => prev - 1);
      onRepost(interactionId, true);
      return;
    }
    // Show options: Repost or Quote Repost
    Alert.alert('Repost', 'How would you like to repost?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Repost',
        onPress: () => {
          setIsReposted(true);
          setLocalRepostCount(prev => prev + 1);
          onRepost(interactionId, false);
        },
      },
      {
        text: 'Quote Repost',
        onPress: () => {
          // Navigate to CreatePost with the quoted post context
          navigation.navigate('CreatePost', {
            quotePostId: interactionId,
            quoteAuthor: `@${post.authorUsername || 'user'}`,
            quoteCaption: (post.caption || '').slice(0, 100),
          });
        },
      },
    ]);
  };

  const handleShare = async () => {
    const author = `@${post.authorUsername || 'user'}`;
    const caption = post.caption ? `\n\n"${post.caption.slice(0, 120)}${post.caption.length > 120 ? '...' : ''}"` : '';
    // Generate a proper deep link URL using expo-linking
    const deepLink = ExpoLinking.createURL('post', { postId: interactionId });
    const webUrl = `https://black94.app/post/${interactionId}`;
    Alert.alert('Share', '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Copy Link',
        onPress: async () => {
          try {
            await Share.share({
              message: `${author} posted on Black94${caption}\n\n${webUrl}`,
              url: deepLink,
            });
          } catch {}
        },
      },
      {
        text: 'Send via DM',
        onPress: () => {
          navigation.navigate('ChatList', { sharePostId: interactionId, shareCaption: post.caption, shareAuthor: post.authorUsername });
        },
      },
    ]);
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
        {/* Avatar — tap navigates to profile */}
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

        {/* Content column — tap to open replies */}
        <TouchableOpacity
          style={styles.contentColumn}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('PostComments', { postId: interactionId, postCaption: post.caption, postAuthorUsername: post.authorUsername, postAuthorDisplayName: post.authorDisplayName })}
        >
          {/* Repost indicator */}
          {post.repostOf && (
            <View style={styles.repostHeader}>
              <RepostIcon size={14} color="#71767b" />
              <Text style={styles.repostHeaderText}>
                {post.repostedByDisplayName || post.repostedByUsername || 'Someone'} reposted
              </Text>
            </View>
          )}

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

            {/* More button — only show for own posts, not reposts */}
            {!post.repostOf && post.authorId === currentUser?.uid && (
              <TouchableOpacity
                style={styles.moreBtn}
                onPress={() => {
                  Alert.alert('Post', 'Choose an action', [
                    { text: 'Edit', onPress: () => onEdit(post) },
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => onDelete(post.id) },
                  ]);
                }}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Caption — with tappable hashtags and mentions */}
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

          {/* Media — FeedMedia handles aspect-ratio-aware sizing & errors */}
          {post.mediaUrls?.length > 0 && (
            <TouchableOpacity activeOpacity={0.95} onPress={handleDoubleTap}>
              {post.mediaUrls.length === 1 ? (
                <FeedMedia
                  uri={refreshedUrls[post.mediaUrls[0]] || post.mediaUrls[0]}
                  onRefreshUrl={() => handleMediaError(post.mediaUrls[0])}
                />
              ) : (
                <MultiImageCarousel
                  mediaUrls={post.mediaUrls}
                  refreshedUrls={refreshedUrls}
                  onMediaError={handleMediaError}
                />
              )}
            </TouchableOpacity>
          )}

          {/* Poll */}
          {post.pollData && (
            <InlinePoll post={post} />
          )}

          {/* Fact Check Indicator */}
          {(post.factCheckVerified || 0) > 0 && (
            <View style={styles.factCheckBadge}>
              <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
              <Text style={styles.factCheckText}>
                Fact-checked · {post.factCheckVerified} verified
              </Text>
            </View>
          )}
          {(post.factCheckDebunked || 0) > 0 && (
            <View style={styles.factCheckBadge}>
              <Ionicons name="close-circle" size={14} color="#ef4444" />
              <Text style={[styles.factCheckText, { color: '#ef4444' }]}>
                Debunked · {post.factCheckDebunked} flagged
              </Text>
            </View>
          )}

          {/* Action bar */}
          <View style={styles.actions}>
            {/* Comment */}
            <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('PostComments', { postId: interactionId, postCaption: post.caption, postAuthorUsername: post.authorUsername, postAuthorDisplayName: post.authorDisplayName })}>
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
                <RepostIcon
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
            <TouchableOpacity style={styles.actionBtn} onPress={() => onLike(interactionId, post.liked)}>
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
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={async () => {
                // Increment view count in Firestore and update local state
                firestore().collection('posts').doc(interactionId).update({
                  viewCount: firestore.FieldValue.increment(1),
                }).catch(() => {});
              }}
            >
              <View style={styles.actionIconWrap}>
                <Ionicons name="trending-up-outline" size={18} color={colors.textSecondary} />
              </View>
              {formatCount(post.viewCount) ? (
                <Text style={styles.actionCount}>{formatCount(post.viewCount)}</Text>
              ) : null}
            </TouchableOpacity>

            {/* Bookmark + Share */}
            <View style={styles.actionPair}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => onBookmark(interactionId, post.bookmarked)}>
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
        </TouchableOpacity>
      </View>
    </View>
  );
});

/* ── AdCard ──────────────────────────────────────────────────────────────── */

// Track which ad IDs have already been impression-counted this session
const _impressionTracker = new Set<string>();

function AdCard({ ad }: { ad: any }) {
  // Fire-and-forget impression tracking on first render
  React.useEffect(() => {
    if (ad.id && !_impressionTracker.has(ad.id)) {
      _impressionTracker.add(ad.id);
      // Small delay to avoid counting during fast scrolls
      const timer = setTimeout(() => {
        firestore().collection('ads').doc(ad.id).update({
          impressions: firestore.FieldValue.increment(1),
        }).catch(() => {});
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [ad.id]);

  return (
    <View style={styles.adCard}>
      <View style={styles.adBadgeRow}>
        <Ionicons name="megaphone-outline" size={14} color={colors.accentGold} />
        <Text style={styles.adBadgeText}>Promoted</Text>
      </View>
      <View style={styles.adBody}>
        <Text style={styles.adHeadline} numberOfLines={1}>{ad.headline || 'Ad'}</Text>
        {ad.description ? <Text style={styles.adDescription} numberOfLines={2}>{ad.description}</Text> : null}
        {ad.ctaText ? (
          <TouchableOpacity
            style={styles.adCtaBtn}
            activeOpacity={0.7}
            onPress={() => {
              // Track ad click in Firestore, then open link
              if (ad.id) {
                firestore().collection('ads').doc(ad.id).update({
                  clicks: firestore.FieldValue.increment(1),
                }).catch(() => {});
              }
              const url = ad.link || ad.url || ad.destinationUrl;
              if (url) {
                Linking.openURL(url).catch(() => {});
              }
            }}
          >
            <Text style={styles.adCtaText}>{ad.ctaText}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.adSponsored}>Sponsored</Text>
    </View>
  );
}

/* ── Feed item union type ────────────────────────────────────────────────── */

type FeedItem =
  | { type: 'post'; id: string; post: Post }
  | { type: 'ad'; id: string; ad: any };

/* ── Map a Firestore doc → Post ──────────────────────────────────────────── */
function docToPost(docSnap: any): Post {
  const data = docSnap.data();
  return {
    id: docSnap.id,
    authorId: data.authorId || '',
    authorUsername: data.authorUsername || '',
    authorDisplayName: data.authorDisplayName || '',
    authorProfileImage: data.authorProfileImage || null,
    authorBadge: data.authorBadge || '',
    authorIsVerified: data.authorIsVerified || false,
    factCheckVerified: data.factCheckVerified || 0,
    factCheckDebunked: data.factCheckDebunked || 0,
    caption: data.caption || '',
    mediaUrls: parseMediaUrls(data.mediaUrls),
    pollData: data.pollData || undefined,
    likeCount: data.likeCount || 0,
    commentCount: data.commentCount || 0,
    repostCount: data.repostCount || 0,
    viewCount: data.viewCount || 0,
    liked: false,
    bookmarked: false,
    reposted: false,
    createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
    repostOf: data.repostOf || undefined,
    repostedByUid: data.repostedByUid || undefined,
    repostedByUsername: data.repostedByUsername || undefined,
    repostedByDisplayName: data.repostedByDisplayName || undefined,
    visibility: data.visibility || 'public',
  };
}

/* ── Stories Row — embedded at top of feed (Instagram-style) ──────────────── */

const STORY_CIRCLE_SIZE = 48;
const STORY_RING_PAD = 3;

interface StoryBubble {
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorProfileImage: string | null;
}

function StoriesRow({ navigation }: { navigation: any }) {
  const [bubbles, setBubbles] = useState<StoryBubble[]>([]);
  const currentUser = auth()?.currentUser;
  const storeUser = useAppStore(s => s.user);

  useEffect(() => {
    (async () => {
      try {
        const snap = await firestore()
          .collection('stories')
          .orderBy('createdAt', 'desc')
          .limit(50)
          .get();
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
          seen.add(aid);
          result.push({
            authorId: aid,
            authorUsername: d.authorUsername || '',
            authorDisplayName: d.authorDisplayName || '',
            authorProfileImage: d.authorProfileImage || null,
          });
        }
        setBubbles(result);
      } catch {}
    })();
  }, [currentUser?.uid]);

  if (bubbles.length === 0) return null;

  return (
    <View style={storiesRowStyles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={storiesRowStyles.scrollContent}
      >
        {bubbles.map((b) => (
          <TouchableOpacity
            key={b.authorId}
            style={storiesRowStyles.bubble}
            onPress={() => navigation.navigate('Stories')}
          >
            <LinearGradient
              colors={['#f09433', '#e6683c', '#dc2743', '#cc2366', '#bc1888', '#8a3ab9']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={storiesRowStyles.gradientRing}
            >
              <View style={storiesRowStyles.avatarContainer}>
                <Avatar uri={b.authorProfileImage} name={b.authorDisplayName} size={STORY_CIRCLE_SIZE} />
              </View>
            </LinearGradient>
            <Text style={storiesRowStyles.label} numberOfLines={1}>
              {b.authorUsername || b.authorDisplayName}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const storiesRowStyles = StyleSheet.create({
  container: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 14,
    alignItems: 'flex-start',
  },
  bubble: {
    alignItems: 'center',
    width: STORY_CIRCLE_SIZE + 20,
  },
  gradientRing: {
    width: STORY_CIRCLE_SIZE + STORY_RING_PAD * 2 + 2,
    height: STORY_CIRCLE_SIZE + STORY_RING_PAD * 2 + 2,
    borderRadius: (STORY_CIRCLE_SIZE + STORY_RING_PAD * 2 + 2) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarContainer: {
    borderRadius: STORY_CIRCLE_SIZE / 2,
    borderWidth: 2,
    borderColor: '#0f0f0f',
    overflow: 'hidden',
  },
  label: {
    color: colors.textSecondary,
    fontSize: fs(11),
    marginTop: 4,
    textAlign: 'center',
  },
});

/* ── FeedScreen ───────────────────────────────────────────────────────────── */

export default function FeedScreen({ navigation }: any) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('Black94');
  const [ads, setAds] = useState<any[]>([]);
  const [followedUserIds, setFollowedUserIds] = useState<Set<string>>(new Set());
  const currentUser = auth()?.currentUser;
  const flatListRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();
  const lastDocRef = useRef<any>(null);
  // Holds the Firestore real-time unsubscribe fn for the top-of-feed listener
  const realtimeUnsubRef = useRef<(() => void) | null>(null);

  const PAGE_SIZE = 10;

  const enrichAuthorProfiles = useCallback(async (postsToEnrich: Post[]) => {
    const uniqueAuthorIds = [...new Set(postsToEnrich.map(p => p.authorId).filter(Boolean))];
    const CHUNK_SIZE = 10;
    const authorProfileMap: Record<string, any> = {};
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
    for (const post of postsToEnrich) {
      const fresh = authorProfileMap[post.authorId];
      if (!fresh) continue;
      if (fresh.profileImage) post.authorProfileImage = fresh.profileImage;
      if (fresh.badge) post.authorBadge = fresh.badge;
      post.authorIsVerified = fresh.isVerified;
    }
  }, []);

  const enrichInteractions = useCallback(async (postsToEnrich: Post[], userId: string) => {
    const postIds = postsToEnrich.map(p => p.repostOf || p.id);
    const likedIds = new Set<string>();
    const bookmarkedIds = new Set<string>();
    const repostedIds = new Set<string>();
    const CHUNK = 10;
    for (let i = 0; i < postIds.length; i += CHUNK) {
      const chunk = postIds.slice(i, i + CHUNK);
      try {
        await Promise.all(chunk.flatMap(postId => [
          firestore().collection('post_likes').doc(`${postId}_${userId}`).get().then(s => { if (s.exists) likedIds.add(postId); }).catch(() => {}),
          firestore().collection('post_bookmarks').doc(`${postId}_${userId}`).get().then(s => { if (s.exists) bookmarkedIds.add(postId); }).catch(() => {}),
          firestore().collection('post_reposts').doc(`${postId}_${userId}`).get().then(s => { if (s.exists) repostedIds.add(postId); }).catch(() => {}),
        ]));
      } catch (e) { console.warn('[Feed] Interaction fetch failed:', e); }
    }
    for (const post of postsToEnrich) {
      const iid = post.repostOf || post.id;
      post.liked = likedIds.has(iid);
      post.bookmarked = bookmarkedIds.has(iid);
      post.reposted = repostedIds.has(iid);
    }
    const pollPostIds = postsToEnrich.filter(p => p.pollData).map(p => p.id);
    if (pollPostIds.length > 0) {
      const pollVotedIds = new Set<string>();
      await Promise.all(pollPostIds.map(async (postId) => {
        try {
          const v = await firestore().collection('posts').doc(postId).collection('poll_votes').doc(userId).get();
          if (v.exists) pollVotedIds.add(postId);
        } catch {}
      }));
      for (const post of postsToEnrich) {
        if (post.pollData) post.pollVoted = pollVotedIds.has(post.repostOf || post.id);
      }
    }
  }, []);

  const enrichPostsInBackground = useCallback(async (postsToEnrich: Post[], userId: string | undefined) => {
    if (postsToEnrich.length === 0) return;
    await Promise.all([
      enrichAuthorProfiles(postsToEnrich),
      userId ? enrichInteractions(postsToEnrich, userId) : Promise.resolve(),
    ]);
    setPosts(prev => {
      const enrichedIds = new Set(postsToEnrich.map(p => p.id));
      return prev.map(p => {
        if (!enrichedIds.has(p.id)) return p;
        return postsToEnrich.find(ep => ep.id === p.id) || p;
      });
    });
  }, []);

  /* ── Real-time listener: watches for NEW posts arriving at the top ────── */
  // We attach a live onSnapshot query limited to posts newer than the newest
  // post we already have. When it fires with a new doc, we prepend it and
  // run enrichment in the background — no pull-to-refresh required.
  const attachRealtimeListener = useCallback((newestCreatedAt: number) => {
    // Tear down any existing listener first
    if (realtimeUnsubRef.current) {
      realtimeUnsubRef.current();
      realtimeUnsubRef.current = null;
    }

    const userId = auth()?.currentUser?.uid;

    const unsub = firestore()
      .collection('posts')
      .orderBy('createdAt', 'desc')
      // Only listen for posts strictly newer than what we already have.
      // We use a Firestore Timestamp approximation from the millis value.
      .where('createdAt', '>', new Date(newestCreatedAt))
      .onSnapshot(
        snapshot => {
          if (snapshot.empty) return;
          // docChanges gives us only the delta (added/modified/removed)
          const added = snapshot.docChanges()
            .filter(ch => ch.type === 'added')
            .map(ch => docToPost(ch.doc));

          if (added.length === 0) return;

          if (__DEV__) console.log(`[Feed] Real-time: ${added.length} new post(s) arrived`);

          setPosts(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const fresh = added.filter(p => !existingIds.has(p.id));
            if (fresh.length === 0) return prev;
            return [...fresh, ...prev];
          });

          // Enrich in background (author profiles + interaction state)
          enrichPostsInBackground(added, userId);
        },
        err => {
          // Non-fatal — live listener failing just means no auto-refresh
          console.warn('[Feed] Real-time listener error:', err?.message);
        }
      );

    realtimeUnsubRef.current = unsub;
  }, [enrichPostsInBackground]);

  const loadFeed = useCallback(async (append = false) => {
    try {
      if (append && (loadingMore || allLoaded)) return;
      if (append) setLoadingMore(true);

      // For "For You" tab: fetch recent posts and sort by engagement score
      if (activeTab === 'For You') {
        try {
          const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const snapshot = append
            ? await firestore()
                .collection('posts')
                .orderBy('createdAt', 'desc')
                .startAfter(lastDocRef.current)
                .limit(PAGE_SIZE)
                .get()
            : await firestore()
                .collection('posts')
                .where('createdAt', '>', twentyFourHoursAgo)
                .orderBy('createdAt', 'desc')
                .limit(PAGE_SIZE * 3) // Fetch more to sort from
                .get();

          const userId = currentUser?.uid;
          let scoredPosts: Post[] = snapshot.docs.map(docToPost);

          // Sort by engagement score: 3*likes + 2*reposts + comments
          scoredPosts.sort((a, b) => {
            const scoreA = (a.likeCount || 0) * 3 + (a.repostCount || 0) * 2 + (a.commentCount || 0);
            const scoreB = (b.likeCount || 0) * 3 + (b.repostCount || 0) * 2 + (b.commentCount || 0);
            return scoreB - scoreA;
          });

          // Take top PAGE_SIZE after sorting
          const newPosts = scoredPosts.slice(0, PAGE_SIZE);

          if (newPosts.length === 0) {
            setAllLoaded(true);
            if (append) { setLoadingMore(false); return; }
          }

          if (!append) {
            lastDocRef.current = snapshot.docs[Math.min(snapshot.docs.length - 1, PAGE_SIZE - 1)];
          }

          if (append) {
            setPosts(prev => [...prev, ...newPosts]);
          } else {
            setPosts(newPosts);
          }
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
          enrichPostsInBackground(newPosts, userId);
          return;
        } catch (e: any) {
          console.error('[FeedScreen] For You feed error:', e?.message);
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }

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
      const newPosts: Post[] = snapshot.docs.map(docToPost);

      if (newPosts.length === 0) {
        setAllLoaded(true);
        if (append) { setLoadingMore(false); return; }
      }

      if (__DEV__) {
        for (const p of newPosts) {
          if (p.mediaUrls.length > 0) {
            console.log(`[Feed] Post ${p.id} has ${p.mediaUrls.length} media URL(s): ${p.mediaUrls[0]?.slice(0, 120)}`);
          }
        }
      }

      // IMMEDIATELY show posts to the user — enrichment runs in background
      if (append) {
        setPosts(prev => [...prev, ...newPosts]);
      } else {
        setPosts(newPosts);
        // Attach the real-time listener anchored to the newest post's createdAt
        if (newPosts.length > 0) {
          attachRealtimeListener(newPosts[0].createdAt);
        }
      }
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);

      // Fire-and-forget enrichment (author profiles + interactions + poll votes)
      enrichPostsInBackground(newPosts, userId);
    } catch (e: any) {
      console.error('[FeedScreen] Feed load error:', e?.message);
      if (!append) {
        Alert.alert('Feed', 'Unable to load feed right now. Pull down to retry.');
      }
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [currentUser?.uid, loadingMore, allLoaded, attachRealtimeListener, activeTab]);

  // Fetch active ad campaigns (deferred 2s so feed loads first)
  useEffect(() => {
    const timer = setTimeout(() => {
      (async () => {
        try {
          const adSnap = await firestore()
            .collection('adCampaigns')
            .where('status', '==', 'active')
            .limit(5)
            .get();
          const adList = adSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
          setAds(adList);
          if (__DEV__) console.log(`[Ads] Loaded ${adList.length} active campaigns`);
        } catch (e) {
          console.warn('[Ads] Failed to fetch ad campaigns:', e);
        }
      })();
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Load followed user IDs for Network tab
  useEffect(() => {
    if (!currentUser?.uid) return;
    (async () => {
      try {
        const snap = await firestore()
          .collection('user_following')
          .doc(currentUser.uid)
          .collection('following')
          .get();
        const ids = new Set(snap.docs.map(d => d.id));
        setFollowedUserIds(ids);
        if (__DEV__) console.log(`[Feed] Loaded ${ids.size} followed users for Network tab`);
      } catch (e) {
        console.warn('[Feed] Failed to load followed users:', e);
      }
    })();
  }, [currentUser?.uid]);

  // Load feed on mount
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      loadFeed();
    }
  }, [loadFeed]);

  // Tear down real-time listener on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (realtimeUnsubRef.current) {
        realtimeUnsubRef.current();
        realtimeUnsubRef.current = null;
      }
    };
  }, []);

  // Reload feed when screen regains focus ONLY if explicitly requested
  // (e.g. after creating a post). Avoids unnecessary full re-fetch on every tab switch.
  const feedRefreshKey = useAppStore(s => s.feedRefreshKey);
  useEffect(() => {
    if (hasMountedRef.current && feedRefreshKey > 0 && !loading) {
      lastDocRef.current = null;
      setAllLoaded(false);
      loadFeed(false);
    }
  }, [feedRefreshKey]);

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
    // Match both the repost wrapper (p.id) and original post (p.repostOf)
    setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId)
      ? { ...p, liked: !liked, likeCount: p.likeCount + (liked ? -1 : 1) }
      : p));
    try { await toggleLike(postId, liked); } catch (e) {
      // Revert optimistic update on failure — prevents ghost likes
      // FIX: undo the count change by reversing the direction
      setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId)
        ? { ...p, liked, likeCount: p.likeCount + (liked ? 1 : -1) }
        : p));
    }
  };

  const handleBookmark = async (postId: string, bookmarked: boolean) => {
    setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId) ? { ...p, bookmarked: !bookmarked } : p));
    try { await toggleBookmark(postId, bookmarked); } catch (e) {
      setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId) ? { ...p, bookmarked } : p));
    }
  };

  const handleRepost = async (postId: string, reposted: boolean) => {
    // Optimistic: update repost count on all posts matching this postId
    setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId)
      ? { ...p, reposted: !reposted, repostCount: p.repostCount + (reposted ? -1 : 1) }
      : p));

    try {
      const result = await toggleRepost(postId, reposted);

      if (!result) {
        // toggleRepost returned false — the repost write failed
        // Revert optimistic state (the catch block below won't fire since
        // toggleRepost didn't throw)
        // FIX: undo the count change by reversing the direction
        setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId)
          ? { ...p, reposted, repostCount: p.repostCount + (reposted ? 1 : -1) }
          : p));
        if (__DEV__) console.warn('[Feed] Repost write failed (toggleRepost returned false)');
        return;
      }

      if (!reposted) {
        // ── New repost: add the repost card to the top of the feed ──
        // Wait for Firestore to commit the write before reading back.
        // Without this delay, the .get() races the write and returns exists=false.
        await new Promise(resolve => setTimeout(resolve, 600));

        const newRepostId = `repost_${postId}_${currentUser?.uid}`;
        try {
          const repostSnap = await firestore().collection('posts').doc(newRepostId).get();
          if (repostSnap.exists) {
            const newPost = docToPost(repostSnap);
            newPost.reposted = true;
            newPost.createdAt = Date.now(); // sort to top immediately
            // Mark this post so enrichment won't race to undo the reposted flag
            newPost._justReposted = true;
            // Prepend only if not already present (guard against double-tap races)
            setPosts(prev =>
              prev.some(p => p.id === newPost.id) ? prev : [newPost, ...prev]
            );

            // Bug 4 fix: re-anchor the real-time listener to include the new repost
            attachRealtimeListener(Date.now());
          } else {
            // Doc still not readable after delay — trigger a full feed reload
            if (__DEV__) console.warn('[Feed] Repost doc not found after delay, triggering full reload');
            useAppStore.getState().triggerFeedRefresh();
          }
        } catch (fetchErr) {
          if (__DEV__) console.warn('[Feed] Failed to fetch new repost, triggering full reload:', fetchErr);
          useAppStore.getState().triggerFeedRefresh();
        }
      } else {
        // ── Unrepost: remove the repost card from the feed immediately ──
        const removedRepostId = `repost_${postId}_${currentUser?.uid}`;
        setPosts(prev => prev.filter(p => p.id !== removedRepostId));
      }
    } catch (e) {
      // Revert optimistic update on failure
      // FIX: undo the count change by reversing the direction
      setPosts(prev => prev.map(p => (p.id === postId || p.repostOf === postId)
        ? { ...p, reposted, repostCount: p.repostCount + (reposted ? 1 : -1) }
        : p));
    }
  };

  const handleDelete = async (postId: string) => {
    try {
      await firestore().collection('posts').doc(postId).delete();
      // Remove the original post AND any repost wrappers pointing to it
      setPosts(prev => prev.filter(p => p.id !== postId && p.repostOf !== postId));
    } catch {
      Alert.alert('Error', 'Failed to delete post');
    }
  };

  // ── Edit post ──────────────────────────────────────────────────────────
  const [editingPost, setEditingPost] = useState<{ id: string; caption: string } | null>(null);
  const [editCaption, setEditCaption] = useState('');

  const handleStartEdit = (post: any) => {
    setEditingPost({ id: post.id, caption: post.caption || '' });
    setEditCaption(post.caption || '');
  };

  const handleSaveEdit = async () => {
    if (!editingPost || editCaption.trim().length === 0) {
      Alert.alert('Error', 'Caption cannot be empty');
      return;
    }
    if (editCaption.length > 500) {
      Alert.alert('Error', 'Caption exceeds 500 character limit');
      return;
    }
    try {
      await firestore().collection('posts').doc(editingPost.id).update({
        caption: editCaption.trim(),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      setPosts(prev => prev.map(p =>
        p.id === editingPost.id ? { ...p, caption: editCaption.trim() } : p
      ));
      setEditingPost(null);
    } catch {
      Alert.alert('Error', 'Failed to update post');
    }
  };

  const handleComment = (postId: string, caption?: string, authorUsername?: string, authorDisplayName?: string) => {
    navigation.navigate('PostComments', { postId, postCaption: caption || '', postAuthorUsername: authorUsername || '', postAuthorDisplayName: authorDisplayName || '' });
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
              <Image source={require('../../assets/logo.png')} style={styles.logoImage} />
            </View>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => navigation.navigate('PremiumDashboard')}
            >
              <Ionicons name="diamond-outline" size={22} color={colors.accent} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        {/* Tabs */}
        <View style={styles.tabBar}>
          {TABS.map(tab => (
            <TouchableOpacity key={tab} style={styles.tabItem} disabled>
              <Text style={[styles.tabText, activeTab === tab ? styles.tabTextActive : styles.tabTextInactive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={[styles.tabUnderline, { left: SCREEN_W / 3 - 24, right: SCREEN_W * 2 / 3 - 24 }]} />
        </View>

        <SkeletonFeed />
      </View>
    );
  }

  // Build interleaved feed: posts with ads inserted after every 5th post
  // Network tab shows only posts from followed users
  // When user follows nobody, Network tab shows empty state instead of all posts
  // Visibility filter: followers-only posts only shown to followers or the author
  const currentUserId = currentUser?.uid;
  const filterByVisibility = (list: Post[]): Post[] =>
    list.filter(p => {
      if (p.authorId === currentUserId) return true; // always show own posts
      if (p.visibility === 'public' || !p.visibility) return true; // public or legacy posts
      if (p.visibility === 'followers') return followedUserIds.has(p.authorId);
      return true;
    });

  const feedItems: FeedItem[] = (() => {
    let displayPosts: Post[];
    if (activeTab === 'Network') {
      if (followedUserIds.size === 0) {
        return []; // Empty state — user follows nobody
      }
      displayPosts = posts.filter(p => followedUserIds.has(p.authorId));
    } else {
      displayPosts = posts;
    }
    // Enforce visibility on ALL tabs
    displayPosts = filterByVisibility(displayPosts);
    if (displayPosts.length === 0) return displayPosts.map(p => ({ type: 'post' as const, id: p.id, post: p }));
    const items: FeedItem[] = [];
    let adIndex = 0;
    displayPosts.forEach((post, idx) => {
      items.push({ type: 'post', id: post.id, post });
      if ((idx + 1) % 5 === 0 && adIndex < ads.length) {
        items.push({ type: 'ad', id: `ad_${ads[adIndex].id}_${idx}`, ad: ads[adIndex] });
        adIndex++;
      }
    });
    return items;
  })();

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
            <Image source={require('../../assets/logo.png')} style={styles.logoImage} />
          </View>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => navigation.navigate('PremiumDashboard')}
          >
            <Ionicons name="diamond-outline" size={22} color={colors.accent} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Feed Tabs */}
      <View style={styles.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={styles.tabItem}
            onPress={() => {
              if (activeTab !== tab) {
                setActiveTab(tab);
                lastDocRef.current = null;
                setAllLoaded(false);
                setPosts([]);
                setLoading(true);
                loadFeed(false);
              }
            }}
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
        data={feedItems}
        keyExtractor={item => item.id}
        ListHeaderComponent={(activeTab === 'For You' || activeTab === 'Black94') ? <StoriesRow navigation={navigation} /> : null}
        renderItem={({ item }) => {
          if (item.type === 'ad') {
            return <AdCard ad={item.ad} />;
          }
          return (
            <PostCard
              post={item.post}
              onLike={handleLike}
              onBookmark={handleBookmark}
              onDelete={handleDelete}
              onEdit={handleStartEdit}
              onRepost={handleRepost}
              onComment={handleComment}
              navigation={navigation}
            />
          );
        }}
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
        onPress={() => navigation.navigate('CreatePost')}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={24} color="#000000" />
      </TouchableOpacity>

      {/* Edit post modal */}
      <Modal visible={!!editingPost} transparent animationType="fade" onRequestClose={() => setEditingPost(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setEditingPost(null)}>
          <View style={styles.editModal}>
            <Text style={styles.editModalTitle}>Edit Post</Text>
            <TextInput
              style={styles.editModalInput}
              multiline
              value={editCaption}
              onChangeText={setEditCaption}
              maxLength={500}
              placeholder="What's happening?"
              placeholderTextColor="#64748b"
              autoFocus
            />
            <Text style={styles.editCharCount}>{editCaption.length}/500</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity style={[styles.editModalBtn, { backgroundColor: colors.surface }]} onPress={() => setEditingPost(null)}>
                <Text style={[styles.editModalBtnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.editModalBtn, { backgroundColor: colors.accent }]} onPress={handleSaveEdit}>
                <Text style={[styles.editModalBtnText, { color: '#000' }]}>Save</Text>
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

  /* ── Header ── */
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: scale(20), paddingTop: scale(8), paddingBottom: scale(10),
    height: scale(56),
    borderBottomWidth: 0.5, borderBottomColor: colors.separator,
    backgroundColor: colors.bg,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  logoImage: { width: 130, height: 44, resizeMode: 'contain' },

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
    fontSize: fs(15),
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
  repostHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
    paddingLeft: 52,
  },
  repostHeaderText: {
    color: '#71767b',
    fontSize: 13,
    fontWeight: '500',
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
    fontSize: fs(15),
    lineHeight: vs(20),
  },
  username: {
    color: '#71767b',
    fontSize: fs(15),
    lineHeight: vs(20),
  },
  dot: {
    color: '#71767b',
    fontSize: fs(15),
    lineHeight: vs(20),
  },
  time: {
    color: '#71767b',
    fontSize: fs(15),
    lineHeight: vs(20),
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
    fontSize: fs(15),
    lineHeight: vs(20),
    marginTop: scale(4),
  },
  seeMoreText: {
    color: colors.accent,
    fontSize: fs(15),
    lineHeight: vs(20),
    marginTop: scale(4),
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
    height: Math.min(SCREEN_W * 0.85, vs(510)),
    backgroundColor: '#1a1a1a',
  },
  mediaErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  mediaErrorText: {
    color: '#71767b',
    fontSize: 13,
    fontWeight: '500',
  },

  /* ── Action bar — X/Twitter exact spacing ── */
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginLeft: -4,
    maxWidth: scale(440),
    justifyContent: 'space-between',
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actionPair: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  actionIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  actionCount: {
    color: '#71767b',
    fontSize: fs(13),
    lineHeight: vs(16),
    marginLeft: scale(1),
  },

  /* ── Fact check badge ── */
  factCheckBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  factCheckText: {
    color: '#22c55e',
    fontSize: fs(12),
    lineHeight: vs(16),
  },

  /* ── Multi-image badge removed — replaced by MultiImageCarousel ── */

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

  /* ── Ad Card ── */
  adCard: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.accentGold,
  },
  adBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  adBadgeText: {
    color: colors.accentGold,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  adBody: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 14,
    marginBottom: 6,
  },
  adHeadline: {
    color: '#e7e9ea',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
    marginBottom: 4,
  },
  adDescription: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 10,
  },
  adCtaBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentGold,
    borderRadius: scale(16),
    paddingHorizontal: scale(16),
    paddingVertical: scale(8),
    marginTop: scale(10),
  },
  adCtaText: {
    color: '#000000',
    fontSize: fs(14),
    fontWeight: '700',
  },
  adSponsored: {
    color: '#71767b',
    fontSize: fs(11),
    marginTop: scale(6),
  },

  /* ── Inline Poll ── */
  pollCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: scale(16),
    padding: scale(16),
    marginTop: scale(12),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  pollQuestion: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
    flex: 1,
  },
  pollExpiredText: {
    color: '#f43f5e',
    fontSize: 12,
    fontWeight: '600',
  },
  /* ── Edit post modal ──────────────────────────────────────────────── */
  editModal: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
  },
  editModalTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
  },
  editModalInput: {
    color: colors.text,
    fontSize: 15,
    minHeight: 100,
    maxHeight: 200,
    textAlignVertical: 'top',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  editCharCount: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'right',
    marginTop: 4,
  },
  editModalBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  editModalBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  pollOptionBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
    position: 'relative',
  },
  pollOptionVoted: {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  pollOptionFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
  },
  pollOptionFillSelected: {
    backgroundColor: 'rgba(212,175,55,0.18)',
  },
  pollOptionContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pollOptionText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  pollOptionTextSelected: {
    color: colors.accent,
    fontWeight: '700',
  },
  pollOptionPercent: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  pollTotalVotes: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
});
