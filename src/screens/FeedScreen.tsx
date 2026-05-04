import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity,
  StyleSheet, RefreshControl, TextInput, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, Dimensions, SafeAreaView,
} from 'react-native';
import { colors } from '../theme/colors';
import { fetchFeed, createPost, toggleLike, toggleBookmark, Post } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const TAB_BAR_HEIGHT = 60;
const FAB_BOTTOM = TAB_BAR_HEIGHT + 20; // Position above tab bar

function PostCard({ post, onLike, onBookmark, onDelete, navigation }: {
  post: Post;
  onLike: (id: string, liked: boolean) => void;
  onBookmark: (id: string, bookmarked: boolean) => void;
  onDelete: (id: string) => void;
  navigation: any;
}) {
  const currentUser = auth()?.currentUser;

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
            <Text style={styles.moreText}>⋮</Text>
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
        <TouchableOpacity
          activeOpacity={0.95}
          onLongPress={() => onLike(post.id, post.liked)}
        >
          <View style={styles.mediaContainer}>
            <Image
              source={{ uri: post.mediaUrls[0] }}
              style={styles.media}
              resizeMode="cover"
            />
          </View>
        </TouchableOpacity>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} disabled>
          <Text style={{ fontSize: 16, color: colors.textSecondary }}>💬</Text>
          {post.commentCount > 0 && (
            <Text style={styles.actionCount}>{post.commentCount}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} disabled>
          <Text style={{ fontSize: 16, color: post.reposted ? colors.accentGreen : colors.textSecondary }}>
            🔁
          </Text>
          {post.repostCount > 0 && (
            <Text style={[styles.actionCount, post.reposted && { color: colors.accentGreen }]}>
              {post.repostCount}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onLike(post.id, post.liked)}>
          <Text style={{ fontSize: 16, color: post.liked ? colors.accentRed : colors.textSecondary }}>
            {post.liked ? '❤️' : '🤍'}
          </Text>
          {post.likeCount > 0 && (
            <Text style={[styles.actionCount, post.liked && { color: colors.accentRed }]}>
              {post.likeCount}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} disabled>
          <Text style={{ fontSize: 16, color: colors.textSecondary }}>📈</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onBookmark(post.id, post.bookmarked)}>
          <Text style={{ fontSize: 16, color: post.bookmarked ? colors.accent : colors.textSecondary }}>
            {post.bookmarked ? '🔖' : '🏷️'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ActionBtn({ icon, count, active, activeColor, onPress, disabled }: {
  icon: string; count?: number; active?: boolean; activeColor?: string;
  onPress?: () => void; disabled?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress} disabled={disabled}>
      <Text style={{ fontSize: 16, color: active ? activeColor : colors.textSecondary }}>{icon}</Text>
      {count !== undefined && count > 0 && (
        <Text style={[styles.actionCount, active && activeColor && { color: activeColor }]}>{count}</Text>
      )}
    </TouchableOpacity>
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

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.openDrawer()}>
            <Avatar uri={currentUser?.photoURL} size={34} />
          </TouchableOpacity>
          <Text style={styles.logo}>Black94</Text>
          <View style={{ width: 34 }} />
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
            <Text style={{ color: colors.textSecondary, fontSize: 16 }}>No posts yet</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + 80 }}
      />

      {/* FAB — positioned above tab bar */}
      <TouchableOpacity
        style={[styles.fab, { bottom: FAB_BOTTOM }]}
        onPress={() => setComposeVisible(true)}
      >
        <Text style={styles.fabText}>✏️</Text>
      </TouchableOpacity>

      {/* Compose Modal */}
      <Modal visible={composeVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
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
                  ? <ActivityIndicator color="#fff" size="small" />
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
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  logo: { color: colors.text, fontSize: 18, fontWeight: '800' },
  postCard: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.bg },
  postHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  postMeta: { flex: 1, marginLeft: 10 },
  displayName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  handle: { color: colors.textSecondary, fontSize: 14 },
  dot: { color: colors.textSecondary, fontSize: 14 },
  time: { color: colors.textSecondary, fontSize: 14 },
  moreBtn: { padding: 4, marginLeft: 'auto' },
  moreText: { color: colors.textSecondary, fontSize: 20 },
  caption: { color: colors.text, fontSize: 15, lineHeight: 22, marginBottom: 10, marginLeft: 54 },
  mediaContainer: { marginLeft: 54, borderRadius: 14, overflow: 'hidden', marginBottom: 4 },
  media: { width: '100%', height: 260, backgroundColor: '#111' },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginLeft: 54, gap: 28 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionCount: { color: colors.textSecondary, fontSize: 13 },
  separator: { height: 0.5, backgroundColor: colors.border },
  fab: {
    position: 'absolute', right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4, shadowRadius: 6,
  },
  fabText: { fontSize: 22 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  composeSheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, minHeight: 220,
  },
  composeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  composeBody: { flexDirection: 'row', gap: 12 },
  composeInput: { flex: 1, color: colors.text, fontSize: 16, minHeight: 100, textAlignVertical: 'top' },
  charCount: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 8 },
  postBtn: { backgroundColor: colors.accent, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 },
  postBtnText: { color: '#fff', fontWeight: '700' },
});
