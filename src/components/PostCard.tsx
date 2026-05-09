import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image as RNImage,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
  Animated,
} from 'react-native';
import { Post } from '../lib/api';
import {
  ReplyIcon,
  RepostIcon,
  HeartIcon,
  BookmarkIcon,
  ShareIcon,
  MoreIcon,
  formatCount,
} from './Icons';
import { Avatar, VerifiedBadge } from './Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth } from '../lib/firebase';

/* ── Constants ─────────────────────────────────────────────────────────────── */
const INACTIVE = '#71767b';
const HOVER_REPLY = '#1d9bf0';
const HOVER_REPOST = '#00ba7c';
const HOVER_LIKE = '#f91880';
const HOVER_BOOKMARK = '#1d9bf0';

/* ── Hashtag / Mention Highlighted Text ────────────────────────────────────── */
export function HighlightedCaption({
  text,
  style,
  numberOfLines,
}: {
  text: string;
  style: any;
  numberOfLines?: number;
}) {
  const parts = text.split(/(#\w+|@\w+)/g);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) =>
        /^#[\w]+$/.test(part) || /^@[\w]+$/.test(part) ? (
          <Text key={i} style={{ color: '#1d9bf0' }}>
            {part}
          </Text>
        ) : (
          <Text key={i}>{part}</Text>
        ),
      )}
    </Text>
  );
}

/* ── Double-tap Heart Overlay ─────────────────────────────────────────────── */
function AnimatedHeart({ visible }: { visible: boolean }) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1.2,
          friction: 3,
          useNativeDriver: true,
          speed: 20,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start(() => {
        Animated.parallel([
          Animated.spring(scale, {
            toValue: 1,
            friction: 4,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 600,
            delay: 200,
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
        <HeartIcon size={96} color="#f91880" filled />
      </Animated.View>
    </View>
  );
}

/* ── Action Button (reusable) ─────────────────────────────────────────────── */
function ActionButton({
  icon,
  count,
  activeColor,
  onPress,
}: {
  icon: React.ReactNode;
  count?: number;
  activeColor: string;
  onPress: () => void;
}) {
  const isActive = !!activeColor;
  return (
    <TouchableOpacity
      style={S.actionBtn}
      onPress={onPress}
      activeOpacity={0.6}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
    >
      {icon}
      {count !== undefined && count > 0 && (
        <Text
          style={[
            S.actionCount,
            isActive && { color: activeColor },
          ]}
        >
          {formatCount(count)}
        </Text>
      )}
    </TouchableOpacity>
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
  const [expanded, setExpanded] = useState(false);
  const lastTapRef = useRef(0);

  // Optimistic repost
  const [isReposted, setIsReposted] = useState(post.reposted);
  const [repostCount, setRepostCount] = useState(post.repostCount);

  useEffect(() => {
    setIsReposted(post.reposted);
    setRepostCount(post.repostCount);
  }, [post.reposted, post.repostCount]);

  const goProfile = () => {
    if (post.authorId === currentUser?.uid) {
      navigation.navigate('ProfileSelf');
    } else {
      navigation.navigate('UserProfile', { userId: post.authorId });
    }
  };

  const goComments = () => {
    navigation.navigate('PostComments', {
      postId: post.id,
      postCaption: post.caption,
      postAuthorUsername: post.authorUsername,
      postAuthorDisplayName: post.authorDisplayName,
    });
  };

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (!post.liked) onLike(post.id, post.liked);
      setShowHeart(true);
      setTimeout(() => setShowHeart(false), 900);
    }
    lastTapRef.current = now;
  };

  const handleRepost = () => {
    const next = !isReposted;
    setIsReposted(next);
    setRepostCount((c) => c + (next ? 1 : -1));
    onRepost(post.id, isReposted);
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

  const longCaption = (post.caption?.length || 0) > 140;

  return (
    <View style={S.card}>
      <AnimatedHeart visible={showHeart} />

      {/* ── Row: avatar + content ──────────────────────────────────── */}
      <View style={S.row}>

        {/* Avatar */}
        <TouchableOpacity
          onPress={goProfile}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <Avatar
            uri={post.authorProfileImage}
            name={post.authorDisplayName}
            size={40}
          />
        </TouchableOpacity>

        {/* Content column */}
        <View style={S.body}>

          {/* ── Header ────────────────────────────────────────────── */}
          <View style={S.header}>
            <TouchableOpacity
              onPress={goProfile}
              activeOpacity={0.7}
              style={S.nameRow}
            >
              <Text style={S.name} numberOfLines={1}>
                {post.authorDisplayName || post.authorUsername || 'User'}
              </Text>
              <VerifiedBadge
                badge={post.authorBadge}
                isVerified={post.authorIsVerified}
                size={16}
              />
              <Text style={S.handle}>
                @{post.authorUsername || 'user'}
              </Text>
              <Text style={S.dot}>·</Text>
              <Text style={S.time}>{timeAgo(post.createdAt)}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleMore}
              hitSlop={10}
              style={S.moreWrap}
            >
              <MoreIcon size={18} color={INACTIVE} />
            </TouchableOpacity>
          </View>

          {/* ── Caption ───────────────────────────────────────────── */}
          {post.caption ? (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={goComments}
            >
              <HighlightedCaption
                text={expanded || !longCaption ? post.caption : post.caption.slice(0, 140)}
                style={S.caption}
                numberOfLines={expanded ? undefined : 3}
              />
              {longCaption && !expanded && (
                <TouchableOpacity
                  onPress={() => setExpanded(true)}
                  hitSlop={8}
                >
                  <Text style={S.showMore}>Show more</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ) : null}

          {/* ── Media ─────────────────────────────────────────────── */}
          {post.mediaUrls?.length > 0 && (
            <TouchableOpacity
              activeOpacity={0.95}
              onPress={handleDoubleTap}
            >
              <View style={S.mediaWrap}>
                <RNImage
                  source={{ uri: post.mediaUrls[0] }}
                  style={S.media}
                  resizeMode="cover"
                />
              </View>
            </TouchableOpacity>
          )}

          {/* ── Action Bar ────────────────────────────────────────── */}
          <View style={S.actions}>
            <ActionButton
              icon={<ReplyIcon size={18} color={INACTIVE} />}
              count={post.commentCount}
              activeColor=""
              onPress={goComments}
            />
            <ActionButton
              icon={<RepostIcon size={18} color={isReposted ? HOVER_REPOST : INACTIVE} />}
              count={repostCount}
              activeColor={isReposted ? HOVER_REPOST : ''}
              onPress={handleRepost}
            />
            <ActionButton
              icon={
                <HeartIcon
                  size={18}
                  color={post.liked ? HOVER_LIKE : INACTIVE}
                  filled={post.liked}
                />
              }
              count={post.likeCount}
              activeColor={post.liked ? HOVER_LIKE : ''}
              onPress={() => onLike(post.id, post.liked)}
            />
            <ActionButton
              icon={<ShareIcon size={18} color={INACTIVE} />}
              activeColor=""
              onPress={handleShare}
            />
            <ActionButton
              icon={
                <BookmarkIcon
                  size={18}
                  color={post.bookmarked ? HOVER_BOOKMARK : INACTIVE}
                  filled={post.bookmarked}
                />
              }
              activeColor={post.bookmarked ? HOVER_BOOKMARK : ''}
              onPress={() => onBookmark(post.id, post.bookmarked)}
            />
          </View>
        </View>
      </View>
    </View>
  );
});

export default PostCard;

/* ═══════════════════════════════════════════════════════════════════════════════
   Styles — pixel-perfect X/Twitter dark mode
   ═══════════════════════════════════════════════════════════════════════════════ */
const S = StyleSheet.create({
  /* Card */
  card: {
    backgroundColor: '#000000',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },

  /* Layout */
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    flexWrap: 'nowrap',
    overflow: 'hidden',
  },
  moreWrap: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },

  /* Typography */
  name: {
    fontWeight: '700',
    fontSize: 15,
    color: '#e7e9ea',
    lineHeight: 20,
  },
  handle: {
    color: '#71767b',
    fontSize: 15,
    lineHeight: 20,
  },
  dot: {
    color: '#71767b',
    fontSize: 15,
    lineHeight: 20,
  },
  time: {
    color: '#71767b',
    fontSize: 15,
    lineHeight: 20,
  },
  caption: {
    color: '#e7e9ea',
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
  },
  showMore: {
    color: '#1d9bf0',
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
  },

  /* Media */
  mediaWrap: {
    marginTop: 10,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  media: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#16181c',
  },

  /* Action Bar — X style: evenly spread, left-aligned icons */
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    maxWidth: 425,
    marginLeft: -10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  actionCount: {
    color: '#71767b',
    fontSize: 13,
    lineHeight: 16,
  },

  /* Heart overlay */
  heartOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});

/* Keep exported name for backward compat (not used externally, but safe) */
export const PostCardStyles = S;
