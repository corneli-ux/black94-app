import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity,
  StyleSheet, RefreshControl, TextInput, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, Dimensions, SafeAreaView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { fetchFeed, createPost, toggleLike, toggleBookmark, Post } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_W } = Dimensions.get('window');

function PostCard({ post, onLike, onBookmark, onDelete, navigation }: {
  post: Post;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onDelete: (id: string) => void;
  navigation: any;
}) {
  const currentUser = auth()?.currentUser;

  const handleDoubleTap = () => {
    if (!post.liked) {
      onLike(post.id, post.liked);
    }
  };

  return (
    <View style={styles.postCard}>
      {/* Header */}
      <View style={styles.postHeader}>
        <TouchableOpacity
          onPress={() => {
            if (post.authorId !== currentUser?.uid) {
              navigation.navigate('Profile', { userId: post.authorId });
            }
          }}
        >
          <Avatar uri={post.authorProfileImage} size={44} />
        </TouchableOpacity>
        <View style={styles.postMeta}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
            <Text style={styles.displayName} numberOfLines={1}>{post.authorDisplayName}</Text>
            <VerifiedBadge badge={post.authorBadge} />
            <Text style={styles.handle}>@{post.authorUsername}</Text>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
          </View>
        </View>
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
        <Text style={styles.caption} numberOfLines={4}>
          {post.caption}
        </Text>
      ) : null}

      {/* Media */}
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

      {/* Action bar — matches web: comment, repost, like, views, bookmark, share */}
      <View style={styles.actions}>
        {/* Comment */}
        <TouchableOpacity style={styles.actionBtn}>
          <View style={styles.actionIconWrap}>
            <Ionicons name="chatbubble-outline" size={18} color={colors.textSecondary} />
          </View>
          {post.commentCount > 0 && (
            <Text style={styles.actionCount}>{post.commentCount}</Text>
          )}
        </TouchableOpacity>

        {/* Repost */}
        <TouchableOpacity style={styles.actionBtn} disabled>
          <View style={styles.actionIconWrap}>
            <Ionicons name="repeat" size={18} color={post.reposted ? colors.accentGreen : colors.textSecondary} />
          </View>
          {post.repostCount > 0 && (
            <Text style={[styles.actionCount, post.reposted && { color: colors.accentGreen }]}>
              {post.repostCount}
            </Text>
          )}
        </TouchableOpacity>

        {/* Like */}
        <TouchableOpacity style={styles.actionBtn} onPress={() => onLike(post.id, post.liked)}>
          <View style={styles.actionIconWrap}>
            {post.liked ? (
              <Ionicons name="heart" size={18} color="#f43f5e" />
            ) : (
              <Ionicons name="heart-outline" size={18} color={colors.textSecondary} />
            )}
          </View>
          {post.likeCount > 0 && (
            <Text style={[styles.actionCount, post.liked && { color: '#f43f5e' }]}>
              {post.likeCount}
            </Text>
          )}
        </TouchableOpacity>

        {/* Views / Analytics */}
        <TouchableOpacity style={styles.actionBtn} disabled>
          <View style={styles.actionIconWrap}>
            <Ionicons name="trending-up-outline" size={18} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>

        {/* Bookmark */}
        <TouchableOpacity style={styles.actionBtn} onPress={() => onBookmark(post.id, post.bookmarked)}>
          <View style={styles.actionIconWrap}>
            {post.bookmarked ? (
              <Ionicons name="bookmark" size={18} color="#ffffff" />
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
  );
}

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
      const data = await fetchFeed(30);
      setPosts(data);
    } catch (e) {
      console.error(e);
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

  // Only allow pull-to-refresh when scrolled to top
  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    setCanRefresh(offset <= 0);
  }, []);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  // FAB bottom position: above tab bar (50px) + safe area bottom inset + 8px gap
  const fabBottom = 50 + insets.bottom + 8;

  return (
    <View style={styles.container}>
      {/* Header — matches web: hamburger (avatar) left, logo center, settings right */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.openDrawer()} style={styles.headerBtn}>
            <Avatar uri={currentUser?.photoURL} size={34} />
          </TouchableOpacity>
          {/* Center: logo */}
          <View style={styles.headerCenter}>
            <Text style={styles.logo}>Black94</Text>
          </View>
          {/* Right: settings */}
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
            enabled={canRefresh}
          />
        }
        onScroll={handleScroll}
        scrollEventThrottle={16}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 80 }}>
            <View style={styles.emptyIcon}>
              <Ionicons name="chatbubble-outline" size={36} color={colors.textSecondary} />
            </View>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 12 }}>No posts yet</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 15, marginTop: 4 }}>When people post, their posts will show up here.</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: fabBottom + 72 }}
      />

      {/* FAB — matches web: white circle with + icon */}
      <TouchableOpacity
        style={[styles.fab, { bottom: fabBottom }]}
        onPress={() => setComposeVisible(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={24} color="#000000" />
      </TouchableOpacity>

      {/* Compose Modal */}
      <Modal visible={composeVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setComposeVisible(false)} />
          <View style={styles.composeSheet}>
            <View style={styles.composeHeader}>
              <TouchableOpacity onPress={() => setComposeVisible(false)}>
                <Text style={{ color: colors.text, fontSize: 16 }}>Cancel</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>New Post</Text>
              <TouchableOpacity
                style={[styles.postBtn, !composeText.trim() && { opacity: 0.4 }]}
                onPress={handlePost}
                disabled={posting || !composeText.trim()}
              >
                {posting
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={styles.postBtnText}>Post</Text>
                }
              </TouchableOpacity>
            </View>
            <View style={styles.composeBody}>
              <Avatar uri={currentUser?.photoURL} size={40} />
              <TextInput
                style={styles.composeInput}
                placeholder="What's happening?"
                placeholderTextColor={colors.textSecondary}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10,
    height: 56,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  logo: { color: colors.text, fontSize: 17, fontWeight: '800' },
  postCard: {
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.bg,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  postHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  postMeta: { flex: 1, marginLeft: 10 },
  displayName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  handle: { color: colors.textSecondary, fontSize: 14 },
  dot: { color: colors.textSecondary, fontSize: 14 },
  time: { color: colors.textSecondary, fontSize: 14 },
  moreBtn: { padding: 4, marginLeft: 'auto' },
  caption: { color: colors.text, fontSize: 15, lineHeight: 22, marginBottom: 10, marginLeft: 54 },
  mediaContainer: { marginLeft: 54, borderRadius: 14, overflow: 'hidden', marginBottom: 4 },
  media: { width: '100%', height: 260, backgroundColor: '#111' },
  actions: {
    flexDirection: 'row', alignItems: 'center', marginTop: 10, marginLeft: 54,
    gap: 0, justifyContent: 'space-between', maxWidth: 380,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  actionIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  actionCount: { color: colors.textSecondary, fontSize: 13, marginLeft: 2 },
  separator: { height: 0.5, backgroundColor: 'rgba(255,255,255,0.06)' },
  fab: {
    position: 'absolute', right: 16,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
    elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4, shadowRadius: 6,
  },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalOverlay: { flex: 1, backgroundColor: 'transparent' },
  composeSheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, minHeight: 220,
  },
  composeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  composeBody: { flexDirection: 'row', gap: 12 },
  composeInput: { flex: 1, color: colors.text, fontSize: 16, minHeight: 100, textAlignVertical: 'top' },
  charCount: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 8 },
  postBtn: { backgroundColor: '#ffffff', paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 },
  postBtnText: { color: '#000000', fontWeight: '700' },
});
