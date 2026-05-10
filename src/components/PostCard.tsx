import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  Alert,
  Share,
  Animated,
  ImageResizeMode,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Post } from '../lib/api';
import { Avatar, VerifiedBadge } from './Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth } from '../lib/firebase';

/* ═══════════════════════════════════════════════════════════════════════════════
   X-App PostCard — Pixel-perfect rebuild
   ═══════════════════════════════════════════════════════════════════════════════ */

/* ── Color Tokens ──────────────────────────────────────────────────────────── */
const C = {
  bg: '#000000',
  text: '#e7e9ea',
  textSecondary: '#71767b',
  textLink: '#1d9bf0',
  likeActive: '#f91880',
  repostActive: '#00ba7c',
  bookmarkActive: '#1d9bf0',
  divider: '#2f3336',
  ripple: 'rgba(255,255,255,0.04)',
};

/* ── Helpers ───────────────────────────────────────────────────────────────── */
const formatCount = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 10_000) return Math.floor(n / 1_000) + 'K';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toString();
};

/* Clamp image aspect ratio to sane bounds so no card becomes unusably tall or short */
const clampRatio = (w: number, h: number): number => {
  if (!w || !h) return 16 / 9;
  const ratio = w / h;
  // min ~ 0.56 (9:16 portrait), max ~ 2.0 (2:1 wide)
  return Math.max(0.56, Math.min(2.0, ratio));
};

/* Feather icon wrapper — fill prop IS supported at runtime but missing from types */
function FIcon(props: { name: string; size: number; color: string; fill?: string | boolean }) {
  return <Feather {...(props as any)} />;
}

/* ── Double-Tap Heart Overlay ──────────────────────────────────────────────── */
function AnimatedHeart({ visible }: { visible: boolean }) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1.4,
          friction: 3,
          useNativeDriver: true,
          speed: 18,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }),
      ]).start(() => {
        Animated.parallel([
          Animated.spring(scale, {
            toValue: 1.1,
            friction: 4,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 500,
            delay: 250,
            useNativeDriver: true,
          }),
        ]).start();
      });
    } else {
      scale.setValue(0);
      opacity.setValue(0);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={S.heartOverlay} pointerEvents="none">
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <FIcon name="heart" size={80} color={C.likeActive} fill={C.likeActive} />
      </Animated.View>
    </View>
  );
}

/* ── Props ─────────────────────────────────────────────────────────────────── */
interface PostCardProps {
  post: Post;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onDelete: (id: string) => void;
  onRepost: (id: string, reposted: boolean) => void;
  onComment: (id: string, caption?: string, authorUsername?: string, authorDisplayName?: string) => void;
  navigation: any;
}

/* ── PostCard ──────────────────────────────────────────────────────────────── */
const PostCard = React.memo(function PostCard({
  post,
  onLike,
  onBookmark,
  onDelete,
  onRepost,
  onComment,
  navigation,
}: PostCardProps) {
  const currentUser = auth()?.currentUser;
  const [showHeart, setShowHeart] = useState(false);
  const lastTapRef = useRef(0);

  // Dynamic image aspect ratio — null = not yet measured, falls back to 16/9
  const [mediaRatio, setMediaRatio] = useState<number | null>(null);

  // Optimistic state
  const [isLiked, setIsLiked] = useState(post.liked);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [isReposted, setIsReposted] = useState(post.reposted);
  const [repostCount, setRepostCount] = useState(post.repostCount);
  const [isBookmarked, setIsBookmarked] = useState(post.bookmarked);

  // Sync from props
  useEffect(() => {
    setIsLiked(post.liked);
    setLikeCount(post.likeCount);
  }, [post.liked, post.likeCount]);

  useEffect(() => {
    setIsReposted(post.reposted);
    setRepostCount(post.repostCount);
  }, [post.reposted, post.repostCount]);

  useEffect(() => {
    setIsBookmarked(post.bookmarked);
  }, [post.bookmarked]);

  /* ── Navigation ─────────────────────────────────────── */
  const goProfile = () => {
    if (post.authorId === currentUser?.uid) {
      navigation.navigate('ProfileSelf');
    } else {
      navigation.navigate('UserProfile', { userId: post.authorId });
    }
  };

  const goComments = () => {
    onComment(post.id, post.caption, post.authorUsername, post.authorDisplayName);
  };

  /* ── Double Tap ─────────────────────────────────────── */
  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (!isLiked) {
        setIsLiked(true);
        setLikeCount((c) => c + 1);
        onLike(post.id, post.liked);
      }
      setShowHeart(true);
      setTimeout(() => setShowHeart(false), 900);
    }
    lastTapRef.current = now;
  };

  /* ── Image Load — measure natural dimensions ── */
  const handleMediaLoad = (e: any) => {
    const src = e.nativeEvent?.source;
    if (src?.width && src?.height) {
      setMediaRatio(clampRatio(src.width, src.height));
    }
  };

  /* ── Actions ────────────────────────────────────────── */
  const handleLike = () => {
    const next = !isLiked;
    setIsLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    onLike(post.id, isLiked);
  };

  const handleRepost = () => {
    const next = !isReposted;
    setIsReposted(next);
    setRepostCount((c) => c + (next ? 1 : -1));
    onRepost(post.id, isReposted);
  };

  const handleBookmark = () => {
    const next = !isBookmarked;
    setIsBookmarked(next);
    onBookmark(post.id, post.bookmarked);
  };

  const handleShare = async () => {
    try {
      await Share.share({ message: 'Check out this post on Black94!' });
    } catch {}
  };

  const handleMore = () => {
    Alert.alert('Post', 'Delete this post?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(post.id) },
    ]);
  };

  const stop = (cb: () => void) => (e: any) => {
    e?.stopPropagation?.();
    cb();
  };

  /* ── Render ─────────────────────────────────────────── */
  return (
    <Pressable
      style={S.container}
      onPress={goComments}
      android_ripple={{ color: C.ripple, borderless: false }}
    >
      <AnimatedHeart visible={showHeart} />

      {/* ─ Row: Avatar | Content ─ */}
      <View style={S.row}>
        {/* Avatar — top-aligned, no extra margin */}
        <Pressable onPress={stop(goProfile)} hitSlop={8} style={S.avatarWrap}>
          <Avatar
            uri={post.authorProfileImage}
            name={post.authorDisplayName}
            size={40}
          />
        </Pressable>

        {/* Content Column */}
        <View style={S.content}>
          {/* User Info Row — aligns top of text with top of avatar */}
          <View style={S.userRow}>
            <Pressable onPress={stop(goProfile)} style={S.namePress} hitSlop={4}>
              <Text style={S.displayName} numberOfLines={1}>
                {post.authorDisplayName || post.authorUsername || 'User'}
              </Text>
            </Pressable>
            <VerifiedBadge
              badge={post.authorBadge}
              isVerified={post.authorIsVerified}
              size={16}
            />
            <Text style={S.username} numberOfLines={1}>
              @{post.authorUsername || 'user'}
            </Text>
            <Text style={S.dot}>·</Text>
            <Text style={S.time}>{timeAgo(post.createdAt)}</Text>

            {/* Spacer + More */}
            <View style={S.userRowSpacer} />
            <Pressable onPress={stop(handleMore)} hitSlop={10} style={S.moreBtn}>
              <Feather name="more-horizontal" size={18} color={C.textSecondary} />
            </Pressable>
          </View>

          {/* Caption — 0px gap from userRow, text lineHeight provides natural spacing */}
          {post.caption ? (
            <Text style={S.caption} numberOfLines={6}>
              {post.caption}
            </Text>
          ) : null}

          {/* Media — 0px gap from caption/name, dynamic aspect ratio from actual image */}
          {post.mediaUrls?.length > 0 && (
            <Pressable onPress={stop(handleDoubleTap)} style={S.mediaWrap}>
              <View style={S.mediaBorder}>
                <Image
                  source={{ uri: post.mediaUrls[0] }}
                  style={[
                    S.media,
                    mediaRatio ? { aspectRatio: mediaRatio } : undefined,
                  ]}
                  resizeMode="cover"
                  onLoad={handleMediaLoad}
                />
              </View>
            </Pressable>
          )}

          {/* ── Action Buttons Strip ── */}
          <View style={S.actions}>
            {/* Comment */}
            <Pressable style={S.actionBtn} onPress={stop(goComments)}>
              <Feather name="message-circle" size={18} color={C.textSecondary} />
              {post.commentCount > 0 && (
                <Text style={S.actionCount}>{formatCount(post.commentCount)}</Text>
              )}
            </Pressable>

            {/* Repost */}
            <Pressable style={S.actionBtn} onPress={stop(handleRepost)}>
              <Feather
                name="repeat"
                size={18}
                color={isReposted ? C.repostActive : C.textSecondary}
              />
              {repostCount > 0 && (
                <Text style={[S.actionCount, isReposted && { color: C.repostActive }]}>
                  {formatCount(repostCount)}
                </Text>
              )}
            </Pressable>

            {/* Like */}
            <Pressable style={S.actionBtn} onPress={stop(handleLike)}>
              <FIcon
                name="heart"
                size={18}
                color={isLiked ? C.likeActive : C.textSecondary}
                fill={isLiked ? C.likeActive : 'none'}
              />
              {likeCount > 0 && (
                <Text style={[S.actionCount, isLiked && { color: C.likeActive }]}>
                  {formatCount(likeCount)}
                </Text>
              )}
            </Pressable>

            {/* Views / Analytics */}
            <Pressable style={S.actionBtn} onPress={stop(() => {})}>
              <Feather name="trending-up" size={18} color={C.textSecondary} />
            </Pressable>

            {/* Bookmark */}
            <Pressable style={S.actionBtn} onPress={stop(handleBookmark)}>
              <FIcon
                name="bookmark"
                size={18}
                color={isBookmarked ? C.bookmarkActive : C.textSecondary}
                fill={isBookmarked ? C.bookmarkActive : 'none'}
              />
            </Pressable>

            {/* Share */}
            <Pressable style={S.actionBtn} onPress={stop(handleShare)}>
              <Feather name="share-2" size={18} color={C.textSecondary} />
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
});

export default PostCard;

/* ═══════════════════════════════════════════════════════════════════════════════
   Styles — X App Pixel-Perfect
   ═══════════════════════════════════════════════════════════════════════════════ */
const S = StyleSheet.create({
  container: {
    backgroundColor: C.bg,
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 0,
    paddingBottom: 0,
    /* 1px thread line between cards */
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
  },

  /* ── Row: Avatar + Content ── */
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatarWrap: {
    marginRight: 10,
    marginTop: 10,
  },

  /* ── Content column ── */
  content: {
    flex: 1,
    minWidth: 0,
  },

  /* ── User info row ── */
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    marginTop: 2,
  },
  namePress: {
    marginRight: 4,
  },
  displayName: {
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    lineHeight: 20,
  },
  username: {
    fontSize: 15,
    fontWeight: '400',
    color: C.textSecondary,
    lineHeight: 20,
  },
  dot: {
    fontSize: 15,
    color: C.textSecondary,
    marginHorizontal: 4,
    lineHeight: 20,
  },
  time: {
    fontSize: 15,
    fontWeight: '400',
    color: C.textSecondary,
    lineHeight: 20,
  },
  userRowSpacer: {
    flex: 1,
    minWidth: 8,
  },
  moreBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
  },

  /* ── Caption — sits flush against userRow ── */
  caption: {
    fontSize: 15,
    fontWeight: '400',
    color: C.text,
    lineHeight: 20,
    marginTop: 0,
    marginBottom: 0,
    letterSpacing: 0.1,
  },

  /* ── Media — dynamic aspect ratio, flush against caption or userRow ── */
  mediaWrap: {
    marginTop: 0,
    marginBottom: 4,
  },
  mediaBorder: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.divider,
    overflow: 'hidden',
  },
  media: {
    width: '100%',
    aspectRatio: 16 / 9,  /* fallback until onLoad measures real ratio */
    backgroundColor: '#16181c',
  },

  /* ── Action Buttons ── */
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginLeft: -12,
    paddingRight: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 2,
    minWidth: 36,
  },
  actionCount: {
    fontSize: 13,
    fontWeight: '400',
    color: C.textSecondary,
    marginLeft: 6,
    lineHeight: 18,
  },

  /* ── Double-tap heart overlay ── */
  heartOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});

/* ═══════════════════════════════════════════════════════════════════════════════
   Backward-compat Exports
   ═══════════════════════════════════════════════════════════════════════════════ */
export { formatCount };
export const PostCardStyles = S;
export function HighlightedCaption({ text, style, numberOfLines }: {
  text: string;
  style: any;
  numberOfLines?: number;
}) {
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {text}
    </Text>
  );
}
