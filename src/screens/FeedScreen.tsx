import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Share, Image,
} from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { scale, verticalScale as vs, fontScale as fs } from '../theme/responsive';
import { toggleLike, toggleBookmark, toggleRepost, votePostPoll, Post, PostPollData, tsToMillis, parseMediaUrls } from '../lib/api';
import { Ionicons } from '@expo/vector-icons';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
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

const TABS = ['Black94', 'Network'] as const;
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

  const handleVote = async (optionId: string) => {
    if (voted || !currentUser || voting) return;
    setVoting(true);
    try {
      const result = await votePostPoll(post.id, optionId);
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
      <Text style={styles.pollQuestion}>{localPoll.question}</Text>
      {localPoll.options.map((option) => {
        const votePercent = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0;
        const isSelected = voted && localPoll.options.some(o => o.id === option.id && o.votes > 0);

        return (
          <TouchableOpacity
            key={option.id}
            style={[styles.pollOptionBtn, voted && styles.pollOptionVoted]}
            onPress={() => handleVote(option.id)}
            activeOpacity={0.7}
            disabled={voted || voting}
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

/* ── PostCard ─────────────────────────────────────────────────────────────── */

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
  const [expanded, setExpanded] = useState(false);
  const [hasMediaError, setHasMediaError] = useState(false);
  const [refreshedUrl, setRefreshedUrl] = useState<string | null>(null);
  const refreshAttemptedRef = React.useRef(false);
  const lastTapRef = useRef(0);

  const CAPTION_LIMIT = 150;
  const isLongCaption = post.caption && post.caption.length > CAPTION_LIMIT;

  // Per-post optimistic repost state
  const [isReposted, setIsReposted] = useState(post.reposted);
  const [localRepostCount, setLocalRepostCount] = useState(post.repostCount);

  // Sync when post prop changes
  React.useEffect(() => {
    setIsReposted(post.reposted);
    setLocalRepostCount(post.repostCount);
  }, [post.reposted, post.repostCount]);

  // BUG FIX: Reset hasMediaError when post changes (FlatList recycling).
  // Without this, a recycled PostCard that previously had a media error
  // shows the error overlay on a perfectly valid new post's image.
  const prevMediaUrlRef = React.useRef(post.mediaUrls?.[0] || '');
  React.useEffect(() => {
    const currentUrl = post.mediaUrls?.[0] || '';
    if (prevMediaUrlRef.current !== currentUrl) {
      setHasMediaError(false);
      setRefreshedUrl(null);
      refreshAttemptedRef.current = false;
      prevMediaUrlRef.current = currentUrl;
    }
  }, [post.id, post.mediaUrls]);

  // BUG FIX: When image fails to load, try refreshing the Firebase Storage
  // download URL (token may have expired) before showing the error overlay.
  const handleMediaError = React.useCallback(async (originalUrl: string) => {
    console.warn('[Feed] Image failed:', originalUrl?.slice(0, 80));
    if (!refreshAttemptedRef.current && originalUrl) {
      refreshAttemptedRef.current = true;
      try {
        const { refreshFirebaseUrl } = require('../utils/imageUpload');
        const newUrl = await refreshFirebaseUrl(originalUrl);
        if (newUrl && newUrl !== originalUrl) {
          console.log('[Feed] Refreshed URL, retrying:', newUrl.slice(0, 80));
          setRefreshedUrl(newUrl);
          setHasMediaError(false); // Give it another chance
          return;
        }
      } catch (refreshErr: any) {
        console.warn('[Feed] URL refresh failed:', refreshErr?.message);
      }
    }
    setHasMediaError(true);
  }, []);

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
          onPress={() => navigation.navigate('PostComments', { postId: post.id, postCaption: post.caption, postAuthorUsername: post.authorUsername, postAuthorDisplayName: post.authorDisplayName })}
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
            isLongCaption && !expanded ? (
              <TouchableOpacity onPress={() => setExpanded(true)} activeOpacity={0.7}>
                <HighlightedCaption text={post.caption.slice(0, CAPTION_LIMIT)} style={styles.caption} />
                <Text style={styles.seeMoreText}> See more</Text>
              </TouchableOpacity>
            ) : isLongCaption && expanded ? (
              <TouchableOpacity onPress={() => setExpanded(false)} activeOpacity={0.7}>
                <HighlightedCaption text={post.caption} style={styles.caption} />
                <Text style={styles.seeMoreText}> See less</Text>
              </TouchableOpacity>
            ) : (
              <HighlightedCaption text={post.caption} style={styles.caption} />
            )
          ) : null}

          {/* Media */}
          {post.mediaUrls?.length > 0 && (
            <TouchableOpacity activeOpacity={0.95} onPress={handleDoubleTap}>
              <View style={styles.mediaContainer}>
                <Image
                  source={{ uri: refreshedUrl || post.mediaUrls[0] }}
                  style={styles.media}
                  resizeMode="cover"
                  // BUG FIX: Show placeholder when image fails to load
                  // (expired token, broken URL) instead of a black rectangle.
                  // On first failure, tries refreshing the Firebase URL.
                  onLoad={() => setHasMediaError(false)}
                  onError={() => handleMediaError(post.mediaUrls[0])}
                />
                {hasMediaError && (
                  <View style={[StyleSheet.absoluteFill, styles.mediaErrorOverlay]}>
                    <Ionicons name="image-outline" size={24} color="#71767b" />
                    <Text style={styles.mediaErrorText}>Image failed to load</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )}

          {/* Poll */}
          {post.pollData && (
            <InlinePoll post={post} />
          )}

          {/* Action bar */}
          <View style={styles.actions}>
            {/* Comment */}
            <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('PostComments', { postId: post.id, postCaption: post.caption, postAuthorUsername: post.authorUsername, postAuthorDisplayName: post.authorDisplayName })}>
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
        </TouchableOpacity>
      </View>
    </View>
  );
});

/* ── AdCard ──────────────────────────────────────────────────────────────── */

function AdCard({ ad }: { ad: any }) {
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
          <TouchableOpacity style={styles.adCtaBtn} activeOpacity={0.7}>
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

/* ── FeedScreen ───────────────────────────────────────────────────────────── */

export default function FeedScreen({ navigation }: any) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('Black94');
  const [ads, setAds] = useState<any[]>([]);
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
          // BUG FIX: Include factCheck fields in inline feed loader
          factCheckVerified: data.factCheckVerified || 0,
          factCheckDebunked: data.factCheckDebunked || 0,
          caption: data.caption || '',
          mediaUrls: parseMediaUrls(data.mediaUrls),
          pollData: data.pollData || undefined,
          likeCount: data.likeCount || 0,
          commentCount: data.commentCount || 0,
          repostCount: data.repostCount || 0,
          liked: false,
          bookmarked: false,
          reposted: false,
          createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
        };
      });

      if (newPosts.length === 0) {
        setAllLoaded(true);
        if (append) { setLoadingMore(false); return; }
      }

      // DIAGNOSTIC: Log mediaUrls for posts with images — helps debug image loading failures.
      // If images fail to load, check these URLs: they should be valid Firebase Storage URLs.
      if (__DEV__) {
        for (const p of newPosts) {
          if (p.mediaUrls.length > 0) {
            console.log(`[Feed] Post ${p.id} has ${p.mediaUrls.length} media URL(s): ${p.mediaUrls[0]?.slice(0, 120)}`);
          }
        }
      }

      // Batch fetch author profiles
      const uniqueAuthorIds = [...new Set(newPosts.map(p => p.authorId).filter(Boolean))];
      const authorProfileMap: Record<string, any> = {};
      // BUG FIX: CHUNK_SIZE must be 10 — Firestore IN operator max is 10.
      // The old value of 30 caused ALL batch interaction queries to fail
      // (where postId IN [30 ids]), falling back to individual reads.
      const CHUNK_SIZE = 10;

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

      // BUG FIX: Enrich with silent corruption check (matches api.ts fetchFeed logic)
      for (const post of newPosts) {
        const fresh = authorProfileMap[post.authorId];
        if (!fresh) continue;

        // GUARD: Skip enrichment if profile looks corrupted (empty username + displayName).
        const profileLooksCorrupted = !fresh.username && !fresh.displayName;
        if (profileLooksCorrupted) continue;

        // BUG FIX: Detect silent username corruption — if the fetched username
        // looks like a Google auto-generated one AND differs from stamped data,
        // the user doc is likely corrupted. Keep the stamped data.
        const googleAutoName = fresh.displayName?.replace(/\s/g, '').toLowerCase() || '';
        const isUsernameCorrupted = !!googleAutoName
          && fresh.username === googleAutoName
          && post.authorUsername
          && post.authorUsername !== googleAutoName;

        if (fresh.displayName) post.authorDisplayName = fresh.displayName;
        if (fresh.username && !isUsernameCorrupted) post.authorUsername = fresh.username;
        if (fresh.profileImage) post.authorProfileImage = fresh.profileImage;
        if (fresh.badge) post.authorBadge = fresh.badge;
        // BUG FIX: Use fresh isVerified directly (boolean, not || fallback).
        // Old code used `fresh.isVerified || post.authorIsVerified` which meant
        // if user was UN-verified (false), the old stamped true value persisted.
        post.authorIsVerified = fresh.isVerified;
      }

      // Batch fetch interactions (CHUNK_SIZE = 10 for Firestore IN limit)
      if (userId) {
        const postIds = newPosts.map(p => p.id);
        const likedIds = new Set<string>();
        const bookmarkedIds = new Set<string>();
        const repostedIds = new Set<string>();

        const INTERACTION_CHUNK = 10;
        for (let i = 0; i < postIds.length; i += INTERACTION_CHUNK) {
          const chunk = postIds.slice(i, i + INTERACTION_CHUNK);
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
              if (__DEV__) console.log('[Feed] Using individual interaction reads fallback');
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

        // Batch check poll votes for posts that have polls
        const pollPostIds = newPosts.filter(p => p.pollData).map(p => p.id);
        if (pollPostIds.length > 0) {
          const pollVotedIds = new Set<string>();
          // poll_votes is a subcollection under each post doc
          // Check each poll post individually (subcollection queries can't be batched across parents)
          await Promise.all(
            pollPostIds.map(async (postId) => {
              try {
                const voteDoc = await firestore()
                  .collection('posts').doc(postId)
                  .collection('poll_votes').doc(userId)
                  .get();
                if (voteDoc.exists) {
                  pollVotedIds.add(postId);
                }
              } catch (e) {
                console.warn(`[Feed] Failed to check poll vote for post ${postId}:`, e);
              }
            })
          );
          for (const post of newPosts) {
            if (post.pollData) {
              post.pollVoted = pollVotedIds.has(post.id);
            }
          }
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
        Alert.alert('Feed', 'Unable to load feed right now. Pull down to retry.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [currentUser?.uid]);

  // Fetch active ad campaigns
  useEffect(() => {
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
  }, []);

  // Load feed on mount — use a ref to prevent useFocusEffect from double-loading
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      loadFeed();
    }
  }, [loadFeed]);

  // Reload feed when screen regains focus (e.g. returning from CreatePost)
  // Skip the first focus event since useEffect already loaded above.
  useFocusEffect(
    useCallback(() => {
      if (hasMountedRef.current && !loading) {
        lastDocRef.current = null;
        setAllLoaded(false);
        loadFeed(false);
      }
    }, [loadFeed, loading]),
  );

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
    try { await toggleLike(postId, liked); } catch (e) {
      // Revert optimistic update on failure — prevents ghost likes
      setPosts(prev => prev.map(p => p.id === postId
        ? { ...p, liked, likeCount: p.likeCount }
        : p));
    }
  };

  const handleBookmark = async (postId: string, bookmarked: boolean) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, bookmarked: !bookmarked } : p));
    try { await toggleBookmark(postId, bookmarked); } catch (e) {
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, bookmarked } : p));
    }
  };

  const handleRepost = async (postId: string, reposted: boolean) => {
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, reposted: !reposted, repostCount: p.repostCount + (reposted ? -1 : 1) }
      : p));
    try { await toggleRepost(postId, reposted); } catch (e) {
      // Revert optimistic update on failure
      setPosts(prev => prev.map(p => p.id === postId
        ? { ...p, reposted, repostCount: p.repostCount }
        : p));
    }
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
          <View style={[styles.tabUnderline, { left: SCREEN_W / 2 - 80, right: SCREEN_W / 2 - 80 }]} />
        </View>

        <SkeletonFeed />
      </View>
    );
  }

  // Build interleaved feed: posts with ads inserted after every 5th post
  const feedItems: FeedItem[] = (() => {
    if (ads.length === 0) return posts.map(p => ({ type: 'post' as const, id: p.id, post: p }));
    const items: FeedItem[] = [];
    let adIndex = 0;
    posts.forEach((post, idx) => {
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
        data={feedItems}
        keyExtractor={item => item.id}
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
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  adCtaText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  adSponsored: {
    color: '#71767b',
    fontSize: 11,
    marginTop: 4,
  },

  /* ── Inline Poll ── */
  pollCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    padding: 14,
    backgroundColor: 'rgba(212,175,55,0.04)',
  },
  pollQuestion: { color: '#e7e9ea', fontSize: fs(15), fontWeight: '600' },
  pollOptionBtn: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: scale(20), paddingVertical: scale(12), paddingHorizontal: scale(16),
    backgroundColor: 'rgba(255,255,255,0.04)', marginBottom: scale(8), overflow: 'hidden', position: 'relative', minHeight: scale(44), justifyContent: 'center',
  },
  pollOptionVoted: { backgroundColor: 'rgba(255,255,255,0.08)' },
  pollOptionFill: { position: 'absolute', top: 0, left: 0, bottom: 0, backgroundColor: 'rgba(42,127,255,0.35)', borderRadius: scale(20) },
  pollOptionFillSelected: { backgroundColor: 'rgba(42,127,255,0.5)' },
  pollOptionContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 1 },
  pollOptionText: { color: '#e7e9ea', fontSize: fs(15), lineHeight: vs(20) },
  pollOptionTextSelected: { color: '#ffffff', fontWeight: '600' },
  pollOptionPercent: { color: '#71767b', fontSize: fs(13) },
  pollTotalVotes: { color: '#71767b', fontSize: fs(13), marginTop: scale(8) },
  pollCard: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: scale(16), padding: scale(16), marginTop: scale(12), borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  adCtaBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentGold, borderRadius: scale(16),
    paddingHorizontal: scale(16), paddingVertical: scale(8), marginTop: scale(10),
  },
  adCtaText: { color: '#000000', fontSize: fs(14), fontWeight: '700' },
  adSponsored: { color: '#71767b', fontSize: fs(11), marginTop: scale(6) },
  pollQuestionOriginal: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
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
