import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, RefreshControl, TextInput, Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Dimensions,  } from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { fetchFeed, createPost, toggleLike, toggleBookmark, Post } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_W } = Dimensions.get('window');

const PostCard = React.memo(function PostCard({ post, onLike, onBookmark, onDelete, navigation }: {
  post: Post;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onDelete: (id: string) => void;
  navigation: any;
}) {
  const currentUser = auth()?.currentUser;
  const [showHeart, setShowHeart] = useState(false);
  const lastTapRef = useRef(0);

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

  return (
    <View style={styles.postCard}>
      {/* Double-tap heart overlay — web: animate-heart-burst */}
      {showHeart && (
        <View style={styles.heartOverlay} pointerEvents="none">
          <Ionicons name="heart" size={96} color="#f43f5e" />
        </View>
      )}

      {/* Content row: avatar + content */}
      <View style={styles.contentRow}>
        {/* Avatar — web: size=48 */}
        <TouchableOpacity
          onPress={() => {
            if (post.authorId !== currentUser?.uid) {
              navigation.navigate('UserProfile', { userId: post.authorId });
            }
          }}
        >
          <Avatar uri={post.authorProfileImage} name={post.authorDisplayName} size={48} />
        </TouchableOpacity>

        {/* Content column */}
        <View style={styles.contentColumn} onTouchEnd={handleDoubleTap}>
          {/* Header row — web: flex items-center gap-1 */}
          <View style={styles.headerRow}>
            <View style={styles.headerNameRow}>
              <Text style={styles.displayName} numberOfLines={1}>
                {post.authorDisplayName || post.authorUsername || 'User'}
              </Text>
              <VerifiedBadge badge={post.authorBadge} isVerified={post.authorIsVerified} size={18} />
              <Text style={styles.username}>@{post.authorUsername || 'user'}</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
            </View>

            {/* More button — web: absolute top-0 right-0 w-8 h-8 -mr-2 */}
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

          {/* Caption — web: text-[15px] text-[#e7e9ea], marginTop 2px, lineHeight 20px */}
          {post.caption ? (
            <Text style={styles.caption} numberOfLines={4}>
              {post.caption}
            </Text>
          ) : null}

          {/* Media — web: rounded-2xl, border white/[0.06], max-h-510px, marginTop 12px */}
          {post.mediaUrls?.length > 0 && (
            <TouchableOpacity activeOpacity={0.95} onPress={handleDoubleTap}>
              <View style={styles.mediaContainer}>
                <Image
                  source={{ uri: post.mediaUrls[0] }}
                  style={styles.media}
                  resizeMode="cover"
                />
              </View>
            </TouchableOpacity>
          )}

          {/* Action bar — web: flex justify-between max-w-440px -ml-2, marginTop 12px */}
          <View style={styles.actions}>
            {/* Comment — web: icon in p-2.5 rounded-full, color #94a3b8, hover text-white */}
            <TouchableOpacity style={styles.actionBtn}>
              <View style={styles.actionIconWrap}>
                <Ionicons name="chatbubble-outline" size={18} color={colors.textSecondary} />
              </View>
              {post.commentCount > 0 && (
                <Text style={styles.actionCount}>{post.commentCount}</Text>
              )}
            </TouchableOpacity>

            {/* Repost — web: color #94a3b8, active #10b981 */}
            <TouchableOpacity style={styles.actionBtn} disabled>
              <View style={styles.actionIconWrap}>
                <Ionicons name="repeat" size={18} color={post.reposted ? colors.repost : colors.textSecondary} />
              </View>
              {post.repostCount > 0 && (
                <Text style={[styles.actionCount, post.reposted && { color: colors.repost }]}>
                  {post.repostCount}
                </Text>
              )}
            </TouchableOpacity>

            {/* Like — web: color #94a3b8, active #f43f5e */}
            <TouchableOpacity style={styles.actionBtn} onPress={() => onLike(post.id, post.liked)}>
              <View style={styles.actionIconWrap}>
                {post.liked ? (
                  <Ionicons name="heart" size={18} color={colors.like} />
                ) : (
                  <Ionicons name="heart-outline" size={18} color={colors.textSecondary} />
                )}
              </View>
              {post.likeCount > 0 && (
                <Text style={[styles.actionCount, post.liked && { color: colors.like }]}>
                  {post.likeCount}
                </Text>
              )}
            </TouchableOpacity>

            {/* Views — web: trending-up icon */}
            <TouchableOpacity style={styles.actionBtn} disabled>
              <View style={styles.actionIconWrap}>
                <Ionicons name="trending-up-outline" size={18} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>

            {/* Bookmark + Share */}
            <View style={styles.actionPair}>
              {/* Bookmark — web: color #94a3b8, active #FFFFFF */}
              <TouchableOpacity style={styles.actionBtn} onPress={() => onBookmark(post.id, post.bookmarked)}>
                <View style={styles.actionIconWrap}>
                  {post.bookmarked ? (
                    <Ionicons name="bookmark" size={18} color={colors.bookmark} />
                  ) : (
                    <Ionicons name="bookmark-outline" size={18} color={colors.textSecondary} />
                  )}
                </View>
              </TouchableOpacity>

              {/* Share */}
              <TouchableOpacity style={styles.actionBtn} disabled>
                <View style={styles.actionIconWrap}>
                  <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
});

export default function FeedScreen({ navigation }: any) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [composeVisible, setComposeVisible] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [posting, setPosting] = useState(false);
  const currentUser = auth()?.currentUser;
  const flatListRef = useRef<FlatList>(null);
  const [canRefresh, setCanRefresh] = useState(true);
  const insets = useSafeAreaInsets();

  const loadFeed = useCallback(async () => {
    try {
      const data = await fetchFeed(15);
      console.log('[FeedScreen] Loaded', data.length, 'posts');
      setPosts(data);
    } catch (e: any) {
      console.error('[FeedScreen] Feed load error:', e?.message);
      Alert.alert('Feed Error', `Could not load feed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, []);

  const handleLike = async (postId: string, liked: boolean) => {
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, liked: !liked, likeCount: p.likeCount + (liked ? -1 : 1) }
      : p));
    await toggleLike(postId, liked);
  };

  const handleBookmark = async (postId: string, bookmarked: boolean) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, bookmarked: !bookmarked } : p));
    await toggleBookmark(postId, bookmarked);
  };

  const handleDelete = async (postId: string) => {
    try {
      await firestore().collection('posts').doc(postId).delete();
      setPosts(prev => prev.filter(p => p.id !== postId));
    } catch (e) {
      Alert.alert('Error', 'Failed to delete post');
    }
  };

  const handlePost = async () => {
    if (!composeText.trim()) return;
    setPosting(true);
    try {
      await createPost(composeText.trim());
      setComposeText('');
      setComposeVisible(false);
      loadFeed();
    } catch (e) {
      Alert.alert('Error', 'Failed to post');
    } finally {
      setPosting(false);
    }
  };

  // Scroll tracking for pull-to-refresh guard — only allow refresh at the very top
  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    // Disable refresh as soon as user scrolls down even slightly
    if (offset > 2) setCanRefresh(false);
    // Re-enable only when scrolled back to absolute top
    if (offset <= 0) setCanRefresh(true);
  }, []);

  // Disable refresh during active scroll (momentum)
  const handleMomentumScrollBegin = useCallback(() => {
    setCanRefresh(false);
  }, []);

  // Re-check on scroll end
  const handleScrollEndDrag = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset <= 0) setCanRefresh(true);
  }, []);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const tabBarHeight = 56 + (insets.bottom || 0);
  const fabBottom = tabBarHeight + 8;

  return (
    <View style={styles.container}>
      {/* Header — web: h-[56px] px-5 border-b border-white/[0.06] bg-black */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.headerBtn}>
            <Avatar uri={currentUser?.photoURL} name={currentUser?.displayName} size={34} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.logo}>Black94</Text>
          </View>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => navigation.navigate('Settings')}
          >
            <Ionicons name="settings-outline" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

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
            navigation={navigation}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing && canRefresh}
            onRefresh={() => {
              if (canRefresh) {
                setRefreshing(true);
                loadFeed();
              }
            }}
            tintColor={colors.accent}
            enabled={false}
            progressViewOffset={-10}
          />
        }
        onScroll={handleScroll}
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onScrollEndDrag={handleScrollEndDrag}
        scrollEventThrottle={16}
        nestedScrollEnabled={true}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 80 }}>
            <View style={styles.emptyIcon}>
              <Ionicons name="chatbubble-outline" size={36} color={colors.textSecondary} />
            </View>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 12 }}>No posts yet</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 15, marginTop: 4 }}>When people post, their posts will show up here.</Text>
            <TouchableOpacity
              style={{ marginTop: 20, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface, borderRadius: 8 }}
              onPress={loadFeed}
            >
              <Text style={{ color: colors.accent, fontSize: 14 }}>Tap to retry</Text>
            </TouchableOpacity>
          </View>
        }
        contentContainerStyle={{ paddingBottom: fabBottom + 72 }}
      />

      {/* FAB — web: fixed right-4 z-30 w-14 h-14 rounded-full bg-white text-black */}
      <TouchableOpacity
        style={[styles.fab, { bottom: fabBottom }]}
        onPress={() => setComposeVisible(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={24} color="#000000" />
      </TouchableOpacity>

      {/* Compose Modal — web: ComposeDialog */}
      <Modal visible={composeVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setComposeVisible(false)} />
          <View style={styles.composeSheet}>
            {/* Header — web: px-5 py-3 border-b border-white/[0.08] */}
            <View style={styles.composeHeader}>
              <TouchableOpacity onPress={() => setComposeVisible(false)}>
                <Text style={styles.composeCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>New Post</Text>
              <TouchableOpacity
                style={[styles.postBtn, !composeText.trim() && styles.postBtnDisabled]}
                onPress={handlePost}
                disabled={posting || !composeText.trim()}
              >
                {posting
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={styles.postBtnText}>Post</Text>
                }
              </TouchableOpacity>
            </View>
            {/* Body — web: gap-3.5 p-4, avatar size={38}, text text-[17px] text-[#e7e9ea] */}
            <View style={styles.composeBody}>
              <Avatar uri={currentUser?.photoURL} name={currentUser?.displayName} size={38} />
              <TextInput
                style={styles.composeInput}
                placeholder="What's on your mind?"  // web: exact placeholder text
                placeholderTextColor="#64748b"
                value={composeText}
                onChangeText={setComposeText}
                multiline
                autoFocus
                maxLength={4000}
              />
            </View>
            <Text style={styles.charCount}>{composeText.length}/4000</Text>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const CONTENT_LEFT = 48 + 12; // avatar size + gap = 60

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  /* ── Header — web: h-[56px] px-5 border-b border-white/[0.06] ── */
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10,
    height: 56,
    borderBottomWidth: 0.5, borderBottomColor: colors.separator,
    backgroundColor: colors.bg,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  logo: { color: colors.text, fontSize: 17, fontWeight: '800' },

  /* ── Post Card — EXACT match to web UserPostCard.tsx ──
     Web article: paddingLeft:16 paddingRight:16 paddingTop:4 paddingBottom:12
     border-bottom: 1px solid white/[0.06]
     Web avatar: size=48, Web gap: 12px
     Web more button: absolute top-0 right-0 w-8 h-8 -mr-2 */
  postCard: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  contentRow: {
    flexDirection: 'row',
    gap: 12,
  },
  contentColumn: {
    flex: 1,
    minWidth: 0,
    position: 'relative',  // web: relative — needed for absolute more button
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
    flexWrap: 'nowrap',  // web: no flex-wrap — names stay on one line
    overflow: 'hidden',
  },

  /* ── Post text styles — web exact values ── */
  displayName: {
    color: '#e7e9ea',
    fontWeight: '700',
    fontSize: 15,
  },
  username: {
    color: '#94a3b8',   // web: text-[#94a3b8]
    fontSize: 15,        // web: text-[15px]
  },
  dot: {
    color: '#94a3b8',
    fontSize: 15,
  },
  time: {
    color: '#94a3b8',   // web: text-[#94a3b8]
    fontSize: 15,        // web: text-[15px]
  },
  /* web: absolute top-0 right-0 w-8 h-8 -mr-2 rounded-full hover:bg-white/[0.06] */
  moreBtn: {
    position: 'absolute',
    top: 0,
    right: -8,  // web: -mr-2 = -8px
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 16,
  },

  /* ── Caption — web: text-[15px] text-[#e7e9ea] marginTop:2px lineHeight:20px ── */
  caption: {
    color: '#e7e9ea',
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
  },

  /* ── Media — web: rounded-2xl overflow-hidden border border-white/[0.06] max-h-[510px] marginTop:12px ── */
  mediaContainer: {
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.separator,
  },
  media: {
    width: '100%',
    height: Math.min(SCREEN_W * 0.85, 510),
    backgroundColor: '#111',
  },

  /* ── Action bar — web: flex justify-between max-w-440px -ml-2 marginTop:12px ── */
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginLeft: -4,
    maxWidth: 440,
    justifyContent: 'space-between',
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  actionPair: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  /* web: p-2.5 rounded-full → padding 10, borderRadius 17.5 */
  actionIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  /* web: text-[13px] text-[#94a3b8] */
  actionCount: {
    color: '#94a3b8',
    fontSize: 13,
    marginLeft: 2,
  },

  /* ── Heart overlay — web: w-24 h-24 text-[#f43f5e] animate-heart-burst ── */
  heartOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },

  /* ── FAB — web: fixed right-4 z-30 w-14 h-14 rounded-full bg-white ── */
  fab: {
    position: 'absolute', right: 16,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4, shadowRadius: 6,
    zIndex: 50,
  },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
  },

  /* ── Compose Modal — web: ComposeDialog ── */
  modalOverlay: { flex: 1, backgroundColor: 'transparent' },
  /* web: bg-[#0d0b14] border border-white/[0.08] rounded-t-2xl sm:rounded-2xl */
  composeSheet: {
    backgroundColor: '#0d0b14',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    minHeight: 220,
    borderWidth: 1,
    borderColor: colors.composeBorder,
  },
  /* web: flex items-center justify-between px-5 py-3 border-b border-white/[0.08] */
  composeHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.composeBorder,
    paddingBottom: 12,
  },
  /* web: flex gap-3.5 p-4 */
  composeBody: { flexDirection: 'row', gap: 14 },
  composeInput: {
    flex: 1,
    color: '#e7e9ea',         // web: text-[#e7e9ea]
    fontSize: 17,              // web: text-[17px]
    lineHeight: 24,
    minHeight: 110,            // web: min-h-[110px]
    textAlignVertical: 'top',
  },
  composeCancel: { color: colors.text, fontSize: 16 },
  charCount: {
    color: colors.textMuted,
    fontSize: 13,              // web: text-[13px] text-[#94a3b8]
    textAlign: 'right',
    marginTop: 8,
  },
  /* Post button — web: active bg-[#FFFFFF] text-black hover:bg-[#D1D5DB], disabled bg-white/[0.08] text-[#64748b] */
  postBtn: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 7,
    borderRadius: 20,          // web: rounded-full
  },
  postBtnDisabled: {
    backgroundColor: colors.composeDisabled,
  },
  postBtnText: { color: '#000000', fontWeight: '700' },
});
