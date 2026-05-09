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
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Post } from '../lib/api';
import { Avatar, VerifiedBadge } from './Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth } from '../lib/firebase';

/* ── Constants ─────────────────────────────────────────────────────────────── */
const INACTIVE = '#71767b';

/* ── Helpers ───────────────────────────────────────────────────────────────── */
const formatCount = (count: number): string => {
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
  if (count >= 10_000) return Math.floor(count / 1_000) + 'K';
  if (count >= 1_000) return (count / 1_000).toFixed(1) + 'K';
  return count.toString();
};

/* ── Double-tap Star Overlay ──────────────────────────────────────────────── */
function AnimatedStar({ visible }: { visible: boolean }) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1.3,
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
    <View style={S.starOverlay} pointerEvents="none">
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <Feather name="star" size={96} color="#f4d03f" fill="#f4d03f" />
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
  const [showStar, setShowStar] = useState(false);
  const lastTapRef = useRef(0);

  // Optimistic state
  const [isLiked, setIsLiked] = useState(post.liked);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [isReposted, setIsReposted] = useState(post.reposted);
  const [repostCount, setRepostCount] = useState(post.repostCount);

  useEffect(() => {
    setIsLiked(post.liked);
    setLikeCount(post.likeCount);
  }, [post.liked, post.likeCount]);

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
    onComment(post.id, post.caption, post.authorUsername, post.authorDisplayName);
  };

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (!post.liked) {
        setIsLiked(true);
        setLikeCount((c) => c + 1);
        onLike(post.id, post.liked);
      }
      setShowStar(true);
      setTimeout(() => setShowStar(false), 900);
    }
    lastTapRef.current = now;
  };

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

  const handleShare = async () => {
    try {
      await Share.share({ message: 'Check out this post on Black94!' });
    } catch {}
  };

  const handleBookmark = () => {
    onBookmark(post.id, post.bookmarked);
  };

  const handleMore = () => {
    Alert.alert('Post', 'Delete this post?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(post.id) },
    ]);
  };

  const stopProp = (callback: () => void) => (e: any) => {
    e?.stopPropagation?.();
    callback();
  };

  return (
    <Pressable
      style={S.container}
      onPress={goComments}
      android_ripple={{ color: '#1f2937', borderless: false }}
    >
      <AnimatedStar visible={showStar} />

      {/* Header: Avatar + Content */}
      <View style={S.header}>
        <Pressable onPress={stopProp(goProfile)} hitSlop={8}>
          <Avatar
            uri={post.authorProfileImage}
            name={post.authorDisplayName}
            size={40}
          />
        </Pressable>

        <View style={S.headerContent}>
          {/* User Row */}
          <View style={S.userRow}>
            <Pressable
              onPress={stopProp(goProfile)}
              style={S.namePress}
            >
              <Text style={S.name} numberOfLines={1}>
                {post.authorDisplayName || post.authorUsername || 'User'}
              </Text>
            </Pressable>
            <VerifiedBadge
              badge={post.authorBadge}
              isVerified={post.authorIsVerified}
              size={14}
            />
            <Text style={S.handle}>@{post.authorUsername || 'user'}</Text>
            <Text style={S.dot}>·</Text>
            <Text style={S.timestamp}>{timeAgo(post.createdAt)}</Text>

            {/* More button */}
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={stopProp(handleMore)}
              hitSlop={10}
              style={S.moreBtn}
            >
              <Feather name="more-horizontal" size={18} color={INACTIVE} />
            </Pressable>
          </View>

          {/* Post Content */}
          {post.caption ? (
            <Text style={S.content} numberOfLines={4}>
              {post.caption}
            </Text>
          ) : null}

          {/* Media */}
          {post.mediaUrls?.length > 0 && (
            <Pressable onPress={stopProp(handleDoubleTap)}>
              <View style={S.mediaContainer}>
                <Image
                  source={{ uri: post.mediaUrls[0] }}
                  style={S.media}
                  resizeMode="cover"
                />
              </View>
            </Pressable>
          )}

          {/* Action Bar */}
          <View style={S.actions}>
            {/* Reply */}
            <Pressable
              style={S.actionButton}
              onPress={stopProp(goComments)}
            >
              <Feather name="message-circle" size={18} color={INACTIVE} />
              {post.commentCount > 0 && (
                <Text style={S.actionCount}>
                  {formatCount(post.commentCount)}
                </Text>
              )}
            </Pressable>

            {/* Repost */}
            <Pressable
              style={S.actionButton}
              onPress={stopProp(handleRepost)}
            >
              <Feather
                name="repeat"
                size={18}
                color={isReposted ? '#00ba7c' : INACTIVE}
              />
              {repostCount > 0 && (
                <Text
                  style={[
                    S.actionCount,
                    isReposted && { color: '#00ba7c' },
                  ]}
                >
                  {formatCount(repostCount)}
                </Text>
              )}
            </Pressable>

            {/* Like (Star) */}
            <Pressable
              style={S.actionButton}
              onPress={stopProp(handleLike)}
            >
              <Feather
                name="star"
                size={18}
                color={isLiked ? '#f4d03f' : INACTIVE}
                fill={isLiked ? '#f4d03f' : 'none'}
              />
              {likeCount > 0 && (
                <Text
                  style={[
                    S.actionCount,
                    isLiked && { color: '#f4d03f' },
                  ]}
                >
                  {formatCount(likeCount)}
                </Text>
              )}
            </Pressable>

            {/* Views */}
            <Pressable style={S.actionButton} onPress={stopProp(() => {})}>
              <Feather name="eye" size={18} color={INACTIVE} />
            </Pressable>

            {/* Bookmark */}
            <Pressable
              style={S.actionButton}
              onPress={stopProp(handleBookmark)}
            >
              <Feather
                name="bookmark"
                size={18}
                color={post.bookmarked ? '#1d9bf0' : INACTIVE}
                fill={post.bookmarked ? '#1d9bf0' : 'none'}
              />
            </Pressable>

            {/* Share */}
            <Pressable
              style={S.actionButton}
              onPress={stopProp(handleShare)}
            >
              <Feather name="share" size={18} color={INACTIVE} />
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
});

export default PostCard;

/* ═══════════════════════════════════════════════════════════════════════════════
   Styles
   ═══════════════════════════════════════════════════════════════════════════════ */
const S = StyleSheet.create({
  container: {
    backgroundColor: '#000000',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2f3336',
  },
  header: {
    flexDirection: 'row',
  },
  headerContent: {
    flex: 1,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  namePress: {
    marginRight: 2,
  },
  name: {
    color: '#e7e9ea',
    fontSize: 15,
    fontWeight: '700',
  },
  handle: {
    color: '#71767b',
    fontSize: 15,
    marginLeft: 4,
  },
  dot: {
    color: '#71767b',
    marginHorizontal: 4,
    fontSize: 15,
  },
  timestamp: {
    color: '#71767b',
    fontSize: 15,
  },
  moreBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    color: '#e7e9ea',
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 8,
  },
  mediaContainer: {
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2f3336',
  },
  media: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#16181c',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingRight: 20,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginRight: 4,
  },
  actionCount: {
    color: '#71767b',
    fontSize: 13,
    marginLeft: 6,
  },
  starOverlay: {
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

/* Backward compat */
export { formatCount };
export const PostCardStyles = S;
export function HighlightedCaption({ text, style, numberOfLines }: { text: string; style: any; numberOfLines?: number }) {
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {text}
    </Text>
  );
}
