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
          <Text key={i} style={{ color: '#2a7fff' }}>{part}</Text>
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
        <HeartIcon size={96} color="#f43f5e" filled />
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

      {/* Main row: avatar + content */}
      <View style={PostCardStyles.contentRow}>
        {/* Avatar — aligned to top with header, not stretched */}
        <TouchableOpacity
          onPress={navigateToProfile}
          activeOpacity={0.7}
          hitSlop={8}
          style={PostCardStyles.avatarWrap}
        >
          <Avatar uri={post.authorProfileImage} name={post.authorDisplayName} size={40} />
        </TouchableOpacity>

        {/* Content column */}
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

          {/* Caption — tappable to open comments */}
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

          {/* ── Action bar — rebuilt from scratch ──────────────────── */}
          {/* Layout: [Reply] [Repost] [Like] [Chart] [Bookmark | Share] */}
          <View style={PostCardStyles.actions}>

            {/* Reply */}
            <TouchableOpacity
              style={PostCardStyles.actionBtn}
              onPress={navigateToComments}
            >
              <View style={PostCardStyles.actionIconWrap}>
                <ReplyIcon size={18} color={INACTIVE} />
              </View>
              {formatCount(post.commentCount) ? (
                <Text style={PostCardStyles.actionCount}>{formatCount(post.commentCount)}</Text>
              ) : null}
            </TouchableOpacity>

            {/* Repost */}
            <TouchableOpacity style={PostCardStyles.actionBtn} onPress={handleRepostPress}>
              <View style={PostCardStyles.actionIconWrap}>
                <RepostIcon size={18} color={isReposted ? '#10b981' : INACTIVE} />
              </View>
              {formatCount(localRepostCount) ? (
                <Text style={[PostCardStyles.actionCount, isReposted && { color: '#10b981' }]}>
                  {formatCount(localRepostCount)}
                </Text>
              ) : null}
            </TouchableOpacity>

            {/* Heart / Like */}
            <TouchableOpacity style={PostCardStyles.actionBtn} onPress={() => onLike(post.id, post.liked)}>
              <View style={PostCardStyles.actionIconWrap}>
                <HeartIcon size={18} color={post.liked ? '#f43f5e' : INACTIVE} filled={post.liked} />
              </View>
              {formatCount(post.likeCount) ? (
                <Text style={[PostCardStyles.actionCount, post.liked && { color: '#f43f5e' }]}>
                  {formatCount(post.likeCount)}
                </Text>
              ) : null}
            </TouchableOpacity>

            {/* Chart / Analytics */}
            <TouchableOpacity style={PostCardStyles.actionBtn} disabled>
              <View style={PostCardStyles.actionIconWrap}>
                <ChartIcon size={18} color={INACTIVE} />
              </View>
            </TouchableOpacity>

            {/* Bookmark + Share — grouped at the end */}
            <View style={PostCardStyles.actionPair}>
              <TouchableOpacity style={PostCardStyles.actionBtn} onPress={() => onBookmark(post.id, post.bookmarked)}>
                <View style={PostCardStyles.actionIconWrap}>
                  <BookmarkIcon size={18} color={post.bookmarked ? '#ffffff' : INACTIVE} filled={post.bookmarked} />
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={PostCardStyles.actionBtn} onPress={handleShare}>
                <View style={PostCardStyles.actionIconWrap}>
                  <ShareIcon size={18} color={INACTIVE} />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
});

export default PostCard;

/* ── PostCard Styles ──────────────────────────────────────────────────── */
export const PostCardStyles = StyleSheet.create({
  postCard: {
    backgroundColor: '#000000',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    paddingTop: 2,
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
    color: '#71767b',
    fontSize: 15,
  },
  dot: {
    color: '#71767b',
    fontSize: 15,
  },
  time: {
    color: '#71767b',
    fontSize: 15,
  },
  moreBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  caption: {
    color: '#e7e9ea',
    fontSize: 15,
    lineHeight: 20,
    marginTop: 0,
  },
  seeMore: {
    color: '#2a7fff',
    fontSize: 15,
    fontWeight: '700',
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionPair: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCount: {
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
