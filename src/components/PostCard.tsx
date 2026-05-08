import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, Image as RNImage, TouchableOpacity, StyleSheet,
  Alert, Share, Animated,
} from 'react-native';
import { Post } from '../lib/api';
import {
  ReplyIcon, RepostIcon, HeartIcon, BookmarkIcon, ShareIcon,
  ChartIcon, MoreIcon, formatCount,
} from './Icons';
import { Avatar, VerifiedBadge } from './Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth } from '../lib/firebase';

const CAPTION_EXPANDED_LINES = 3;
const INACTIVE = '#71767b';

/* ── Hashtag/Mention Highlighted Text ────────────────────────────────── */
export function HighlightedCaption({ text, style }: { text: string; style: any }) {
  const parts = text.split(/(#\w+|@\w+)/g);
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        /^#[\w]+$/.test(part) || /^@[\w]+$/.test(part) ? (
          <Text key={i} style={{ color: '#1d9bf0' }}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
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
    <View style={PostCardStyles.heartOverlay} pointerEvents="none">
      <Animated.View style={{ transform: [{ scale }], opacity }}>
        <HeartIcon size={96} color="#f91880" filled />
      </Animated.View>
    </View>
  );
}

/* ── PostCard Props ───────────────────────────────────────────────────── */
interface PostCardProps {
  post: Post;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onDelete: (id: string) => void;
  onRepost: (id: string, reposted: boolean) => void;
  onComment: (id: string, caption?: string, authorUsername?: string, authorDisplayName?: string) => void;
  navigation: any;
}

/* ── PostCard Component ──────────────────────────────────────────────── */
const PostCard = React.memo(function PostCard({ post, onLike, onBookmark, onDelete, onRepost, onComment, navigation }: PostCardProps) {
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

  const navigateToComments = () => {
    navigation.navigate('PostComments', {
      postId: post.id,
      postCaption: post.caption,
      postAuthorUsername: post.authorUsername,
      postAuthorDisplayName: post.authorDisplayName,
    });
  };

  const navigateToProfile = () => {
    if (post.authorId !== currentUser?.uid) {
      navigation.navigate('UserProfile', { userId: post.authorId });
    } else {
      navigation.navigate('ProfileSelf');
    }
  };

  const needsSeeMore = (post.caption?.length || 0) > 140;

  return (
    <View style={PostCardStyles.postCard}>
      <AnimatedHeart visible={showHeart} />

      {/* Main row: avatar + content — name top-aligned with avatar */}
      <View style={PostCardStyles.contentRow}>
        {/* Avatar — aligned to top, level with display name */}
        <TouchableOpacity
          onPress={navigateToProfile}
          activeOpacity={0.7}
          hitSlop={8}
          style={PostCardStyles.avatarWrap}
        >
          <Avatar uri={post.authorProfileImage} name={post.authorDisplayName} size={40} />
        </TouchableOpacity>

        {/* Content column — tight to the right of avatar */}
        <View style={PostCardStyles.contentColumn}>
          {/* Header row: name/badge/username/time ... moreBtn */}
          <View style={PostCardStyles.headerRow}>
            <TouchableOpacity
              onPress={navigateToProfile}
              activeOpacity={0.7}
              style={PostCardStyles.headerNameRow}
            >
              <Text style={PostCardStyles.displayName} numberOfLines={1}>
                {post.authorDisplayName || post.authorUsername || 'User'}
              </Text>
              <VerifiedBadge badge={post.authorBadge} isVerified={post.authorIsVerified} size={16} />
              <Text style={PostCardStyles.username}>@{post.authorUsername || 'user'}</Text>
              <Text style={PostCardStyles.dot}>·</Text>
              <Text style={PostCardStyles.time}>{timeAgo(post.createdAt)}</Text>
            </TouchableOpacity>

            {/* More button */}
            <TouchableOpacity
              style={PostCardStyles.moreBtn}
              onPress={() => {
                Alert.alert('Post', 'Delete this post?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => onDelete(post.id) },
                ]);
              }}
            >
              <MoreIcon size={18} color={INACTIVE} />
            </TouchableOpacity>
          </View>

          {/* Caption — immediately below header, no extra margin */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={navigateToComments}
          >
            {post.caption ? (
              <View>
                <HighlightedCaption
                  text={captionExpanded || !needsSeeMore ? post.caption : post.caption.slice(0, 140)}
                  style={PostCardStyles.caption}
                  numberOfLines={captionExpanded ? undefined : CAPTION_EXPANDED_LINES}
                />
                {needsSeeMore && !captionExpanded && (
                  <TouchableOpacity onPress={() => setCaptionExpanded(true)} hitSlop={8}>
                    <Text style={PostCardStyles.seeMore}>Show more</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
          </TouchableOpacity>

          {/* Media image */}
          {post.mediaUrls?.length > 0 && (
            <TouchableOpacity activeOpacity={0.95} onPress={handleDoubleTap}>
              <View style={PostCardStyles.mediaContainer}>
                <RNImage
                  source={{ uri: post.mediaUrls[0] }}
                  style={PostCardStyles.media}
                  resizeMode="cover"
                />
              </View>
            </TouchableOpacity>
          )}

          {/* ── Action bar — X-style: left-aligned, under content ──── */}
          <View style={PostCardStyles.actions}>

            {/* Reply */}
            <TouchableOpacity
              style={PostCardStyles.actionBtn}
              onPress={navigateToComments}
            >
              <ReplyIcon size={18} color={INACTIVE} />
              {formatCount(post.commentCount) ? (
                <Text style={PostCardStyles.actionCount}>{formatCount(post.commentCount)}</Text>
              ) : null}
            </TouchableOpacity>

            {/* Repost */}
            <TouchableOpacity style={PostCardStyles.actionBtn} onPress={handleRepostPress}>
              <RepostIcon size={18} color={isReposted ? '#00ba7c' : INACTIVE} />
              {formatCount(localRepostCount) ? (
                <Text style={[PostCardStyles.actionCount, isReposted && { color: '#00ba7c' }]}>
                  {formatCount(localRepostCount)}
                </Text>
              ) : null}
            </TouchableOpacity>

            {/* Heart / Like */}
            <TouchableOpacity style={PostCardStyles.actionBtn} onPress={() => onLike(post.id, post.liked)}>
              <HeartIcon size={18} color={post.liked ? '#f91880' : INACTIVE} filled={post.liked} />
              {formatCount(post.likeCount) ? (
                <Text style={[PostCardStyles.actionCount, post.liked && { color: '#f91880' }]}>
                  {formatCount(post.likeCount)}
                </Text>
              ) : null}
            </TouchableOpacity>

            {/* Analytics / Views */}
            <TouchableOpacity style={PostCardStyles.actionBtn} disabled>
              <ChartIcon size={18} color={INACTIVE} />
            </TouchableOpacity>

            {/* Bookmark + Share */}
            <View style={PostCardStyles.actionPair}>
              <TouchableOpacity style={PostCardStyles.actionBtn} onPress={() => onBookmark(post.id, post.bookmarked)}>
                <BookmarkIcon size={18} color={post.bookmarked ? '#1d9bf0' : INACTIVE} filled={post.bookmarked} />
              </TouchableOpacity>

              <TouchableOpacity style={PostCardStyles.actionBtn} onPress={handleShare}>
                <ShareIcon size={18} color={INACTIVE} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
});

export default PostCard;

/* ── PostCard Styles — X/Twitter-matched ─────────────────────────────── */
export const PostCardStyles = StyleSheet.create({
  postCard: {
    backgroundColor: '#000000',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    paddingTop: 12,
    paddingBottom: 4,
    paddingHorizontal: 12,
  },
  contentRow: {
    flexDirection: 'row',
    gap: 10,
  },
  contentColumn: {
    flex: 1,
    minWidth: 0,
  },
  avatarWrap: {
    alignSelf: 'flex-start',
    marginTop: 0,
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
  /* X uses Inter — exact same font loaded in App.js */
  displayName: {
    fontFamily: 'Inter-Bold',
    color: '#e7e9ea',
    fontWeight: '700',
    fontSize: 15,
  },
  username: {
    fontFamily: 'Inter-Regular',
    color: '#71767b',
    fontSize: 15,
  },
  dot: {
    fontFamily: 'Inter-Regular',
    color: '#71767b',
    fontSize: 15,
  },
  time: {
    fontFamily: 'Inter-Regular',
    color: '#71767b',
    fontSize: 15,
  },
  moreBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  /* Caption immediately follows header — no marginTop */
  caption: {
    fontFamily: 'Inter-Regular',
    color: '#e7e9ea',
    fontSize: 15,
    lineHeight: 20,
    marginTop: 0,
  },
  seeMore: {
    fontFamily: 'Inter-Regular',
    color: '#1d9bf0',
    fontSize: 15,
    marginTop: 0,
  },
  mediaContainer: {
    marginTop: 10,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  media: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: '#111111',
  },
  /* ── Action bar — X style: left-aligned, no space-between ── */
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    maxWidth: 425,
    marginLeft: -8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 34,
    minWidth: 34,
    paddingHorizontal: 6,
  },
  actionPair: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionCount: {
    fontFamily: 'Inter-Regular',
    color: '#71767b',
    fontSize: 13,
    marginLeft: 2,
  },
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
