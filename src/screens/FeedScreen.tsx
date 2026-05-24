import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Share, Image, Linking, ScrollView, Modal, TextInput,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { scale, verticalScale as vs, fontScale as fs } from '../theme/responsive';
import { votePostPoll, Post, PostPollData, tsToMillis } from '../lib/api';
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
import { useFeed, Tab } from '../hooks/useFeed';

const SCREEN_W = scale(390);

/* ── Repost Icon (matches web app SVG exactly) ──────────────────────────── */
function RepostIcon({ size = 18, color = colors.textSecondary }: { size?: number; color?: string }) {
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
              style={{ color: colors.accent }}
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
              style={{ color: colors.accent }}
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
    backgroundColor: colors.white,
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

  // Single-layer repost state: all optimistic updates flow through the
  // useFeed hook. The PostCard reads directly from the post prop.
  // Previous dual-layer state (hook + local) caused flickering races.

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
    if (post.reposted) {
      // Already reposted — undo it (hook handles optimistic update)
      onRepost(interactionId, true);
      return;
    }
    // Show options: Repost or Quote Repost
    Alert.alert('Repost', 'How would you like to repost?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Repost',
        onPress: () => {
          onRepost(interactionId, false);
        },
      },
      {
        text: 'Quote Repost',
        onPress: () => {
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
          <Ionicons name="heart" size={96} color={colors.like} />
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
              <RepostIcon size={14} color={colors.textMuted} />
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

            {/* More button — Edit/Delete for own posts, Report for others */}
            {!post.repostOf && (
              <TouchableOpacity
                style={styles.moreBtn}
                onPress={() => {
                  if (post.authorId === currentUser?.uid) {
                    Alert.alert('Post', 'Choose an action', [
                      { text: 'Edit', onPress: () => onEdit(post) },
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => onDelete(post.id) },
                    ]);
                  } else {
                    // Report flow for other users' posts
                    const reasons = [
                      'Spam or misleading',
                      'Harassment or bullying',
                      'Hate speech',
                      'Inappropriate content',
                      'Other',
                    ];
                    Alert.alert('Report Post', 'Why are you reporting this post?', [
                      { text: 'Cancel', style: 'cancel' },
                      ...reasons.map(reason => ({
                        text: reason,
                        style: 'default' as const,
                        onPress: async () => {
                          try {
                            const interactionId = post.repostOf || post.id;
                            await firestore().collection('reports').add({
                              type: 'post',
                              targetId: interactionId,
                              targetAuthorId: post.authorId,
                              reporterId: currentUser?.uid,
                              reason,
                              status: 'pending',
                              createdAt: firestore.FieldValue.serverTimestamp(),
                            });
                            Alert.alert('Reported', 'Thank you. Our team will review this post.');
                          } catch {}
                        },
                      })),
                    ]);
                  }
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
              <Ionicons name="checkmark-circle" size={14} color={colors.accentGreen} />
              <Text style={styles.factCheckText}>
                Fact-checked · {post.factCheckVerified} verified
              </Text>
            </View>
          )}
          {(post.factCheckDebunked || 0) > 0 && (
            <View style={styles.factCheckBadge}>
              <Ionicons name="close-circle" size={14} color={colors.error} />
              <Text style={[styles.factCheckText, { color: colors.error }]}>
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
                  color={post.reposted ? colors.repost : colors.textSecondary}
                />
              </View>
              {formatCount(post.repostCount) ? (
                <Text style={[styles.actionCount, post.reposted && { color: colors.repost }]}>
                  {formatCount(post.repostCount)}
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
    borderBottomColor: colors.separator,
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
  const {
    posts,
    loading,
    loadingMore,
    refreshing,
    activeTab,
    setActiveTab,
    ads,
    followedUserIds,
    handleRefresh,
    handleLike,
    handleBookmark,
    handleRepost,
    handleDelete,
    handleEdit,
    handleComment,
    handleTabChange,
    loadMore,
    editingPost,
    editCaption,
    setEditCaption,
    setEditingPost,
    handleSaveEdit,
    flatListRef,
  } = useFeed({ navigation });

  const insets = useSafeAreaInsets();

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Header with logo */}
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.headerBtn}>
              <Ionicons name="menu" size={22} color={colors.text} />
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
  const currentUser = auth()?.currentUser;
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
            <Ionicons name="menu" size={22} color={colors.text} />
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
            onPress={() => handleTabChange(tab as Tab)}
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
              onEdit={handleEdit}
              onRepost={handleRepost}
              onComment={handleComment}
              navigation={navigation}
            />
          );
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
            progressViewOffset={0}
          />
        }
        scrollEventThrottle={16}
        nestedScrollEnabled={true}
        onEndReached={loadMore}
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
              onPress={handleRefresh}
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
        <Ionicons name="add" size={24} color={colors.primaryForeground} />
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
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />
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
    borderBottomColor: colors.separator,
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
    color: colors.white,
    fontWeight: '700',
  },
  tabTextInactive: {
    color: colors.textSecondary,
    fontWeight: '400',
  },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: colors.white,
  },

  /* ── Post Card — exact match to web UserPostCard ── */
  postCard: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
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
    color: colors.textMuted,
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
    color: colors.text,
    fontWeight: '700',
    fontSize: fs(15),
    lineHeight: vs(20),
  },
  username: {
    color: colors.textMuted,
    fontSize: fs(15),
    lineHeight: vs(20),
  },
  dot: {
    color: colors.textMuted,
    fontSize: fs(15),
    lineHeight: vs(20),
  },
  time: {
    color: colors.textMuted,
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
    color: colors.text,
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
    borderColor: colors.separator,
  },
  media: {
    width: '100%',
    height: Math.min(SCREEN_W * 0.85, vs(510)),
    backgroundColor: colors.bg,
  },
  mediaErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  mediaErrorText: {
    color: colors.textMuted,
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
    color: colors.textMuted,
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
    color: colors.accentGreen,
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
    backgroundColor: colors.bgInput,
  },
  skeletonLine: {
    height: 14,
    borderRadius: 4,
    backgroundColor: colors.bgInput,
  },
  skeletonDot: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.bgInput,
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
    backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center',
    elevation: 20, shadowColor: colors.primaryForeground, shadowOffset: { width: 0, height: 4 },
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
    borderBottomColor: colors.separator,
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
    borderColor: colors.separator,
    padding: 14,
    marginBottom: 6,
  },
  adHeadline: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
    marginBottom: 4,
  },
  adDescription: {
    color: colors.textSecondary,
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
    color: colors.primaryForeground,
    fontSize: fs(14),
    fontWeight: '700',
  },
  adSponsored: {
    color: colors.textMuted,
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
    borderColor: colors.separator,
  },
  pollQuestion: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
    flex: 1,
  },
  pollExpiredText: {
    color: colors.like,
    fontSize: 12,
    fontWeight: '600',
  },
  /* ── Edit post modal ──────────────────────────────────────────────── */
  editModal: {
    position: 'absolute',
    bottom: 100,
    left: 16,
    right: 16,
    backgroundColor: colors.avatarFallback,
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
    backgroundColor: colors.bgInput,
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
