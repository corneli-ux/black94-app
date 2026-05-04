import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { auth, firestore } from '../lib/firebase';
import {
  fetchUserProfile,
  toggleFollow,
  checkFollowing,
  User,
  Post,
  tsToMillis,
  parseMediaUrls,
} from '../lib/api';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type ProfileTab = 'posts' | 'replies';

export default function UserProfileScreen({ navigation, route }: any) {
  const { userId } = route.params || {};
  const currentUid = auth()?.currentUser?.uid ?? '';

  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');
  const [refreshing, setRefreshing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [messageLoading, setMessageLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [userData, followersSnap, followingSnap, isFollow, userPostsSnap] = await Promise.all([
        fetchUserProfile(userId),
        firestore().collection('follows').where('followingId', '==', userId).get(),
        firestore().collection('follows').where('followerId', '==', userId).get(),
        currentUid ? checkFollowing(userId) : Promise.resolve(false),
        firestore()
          .collection('posts')
          .where('authorId', '==', userId)
          .orderBy('createdAt', 'desc')
          .limit(20)
          .get(),
      ]);
      setUser(userData);
      setFollowerCount(followersSnap.size);
      setFollowingCount(followingSnap.size);
      setIsFollowing(isFollow);

      const userPosts: Post[] = userPostsSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          authorId: data.authorId || '',
          authorUsername: data.authorUsername || '',
          authorDisplayName: data.authorDisplayName || '',
          authorProfileImage: data.authorProfileImage || null,
          authorBadge: data.authorBadge || '',
          authorIsVerified: data.authorIsVerified || false,
          caption: data.caption || '',
          mediaUrls: parseMediaUrls(data.mediaUrls),
          likeCount: data.likeCount || 0,
          commentCount: data.commentCount || 0,
          repostCount: data.repostCount || 0,
          liked: false,
          bookmarked: false,
          reposted: false,
          createdAt: tsToMillis(data.createdAt),
        };
      });
      setPosts(userPosts);
    } catch (e) {
      console.warn('[UserProfileScreen] load error:', e);
    }
  }, [userId, currentUid]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleToggleFollow = useCallback(async () => {
    if (!currentUid || followLoading) return;
    setFollowLoading(true);
    try {
      const nowFollowing = await toggleFollow(userId, isFollowing);
      setIsFollowing(nowFollowing);
      setFollowerCount((prev) => (nowFollowing ? prev + 1 : Math.max(0, prev - 1)));
    } catch (e) {
      console.warn('[UserProfileScreen] follow error:', e);
    }
    setFollowLoading(false);
  }, [currentUid, userId, followLoading, isFollowing]);

  const handleMessage = useCallback(async () => {
    if (!currentUid || messageLoading) return;
    setMessageLoading(true);
    try {
      // Try to find existing chat
      const [snap1, snap2] = await Promise.all([
        firestore()
          .collection('chats')
          .where('user1Id', '==', currentUid)
          .where('user2Id', '==', userId)
          .get(),
        firestore()
          .collection('chats')
          .where('user1Id', '==', userId)
          .where('user2Id', '==', currentUid)
          .get(),
      ]);
      const existing = [...snap1.docs, ...snap2.docs][0];
      if (existing) {
        navigation.navigate('ChatRoom' as never, { chatId: existing.id } as never);
      } else {
        // Create a new chat
        const chatRef = await firestore().collection('chats').add({
          user1Id: currentUid,
          user2Id: userId,
          lastMessage: '',
          lastMessageTime: firestore.FieldValue.serverTimestamp(),
          unreadUser1: 0,
          unreadUser2: 0,
          createdAt: firestore.FieldValue.serverTimestamp(),
        });
        navigation.navigate('ChatRoom' as never, { chatId: chatRef.id } as never);
      }
    } catch (e) {
      console.warn('[UserProfileScreen] message error:', e);
    }
    setMessageLoading(false);
  }, [currentUid, userId, messageLoading, navigation]);

  const formatCount = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top']}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  const isOwnProfile = currentUid === userId;

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        {/* Cover Image */}
        <View style={styles.coverContainer}>
          {user.coverImage ? (
            <Image source={{ uri: user.coverImage }} style={styles.coverImage} resizeMode="cover" />
          ) : (
            <View style={[styles.coverImage, styles.coverPlaceholder]}>
              <Text style={styles.coverPlaceholderText}>B94</Text>
            </View>
          )}
          <View style={styles.coverGradient} />

          {/* Back button */}
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={20} color={colors.white} />
          </TouchableOpacity>
        </View>

        {/* Profile Image */}
        <View style={styles.profileImageContainer}>
          <Avatar uri={user.profileImage} size={100} borderWidth={4} borderColor={colors.bg} />
        </View>

        {/* User Info */}
        <View style={styles.userInfoSection}>
          <View style={styles.nameRow}>
            <Text style={styles.displayName}>{user.displayName}</Text>
            <VerifiedBadge badge={user.badge} isVerified={user.isVerified} />
          </View>
          <Text style={styles.username}>@{user.username}</Text>
          {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{posts.length}</Text>
              <Text style={styles.statLabel}>Posts</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{formatCount(followerCount)}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{formatCount(followingCount)}</Text>
              <Text style={styles.statLabel}>Following</Text>
            </View>
          </View>

          {/* Action Buttons */}
          {!isOwnProfile && (
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.followBtn, isFollowing ? styles.followingBtn : null]}
                onPress={handleToggleFollow}
                activeOpacity={0.8}
                disabled={followLoading}
              >
                {followLoading ? (
                  <ActivityIndicator size="small" color={isFollowing ? colors.text : colors.bg} />
                ) : (
                  <Text
                    style={[styles.followBtnText, isFollowing ? styles.followingBtnText : null]}
                  >
                    {isFollowing ? 'Following' : 'Follow'}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.messageBtn}
                onPress={handleMessage}
                activeOpacity={0.8}
                disabled={messageLoading}
              >
                {messageLoading ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Text style={styles.messageBtnText}>Message</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Tab Bar */}
        <View style={styles.tabBar}>
          {(['posts', 'replies'] as ProfileTab[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab === 'posts' ? 'Posts' : 'Replies'}
              </Text>
              {activeTab === tab && <View style={styles.tabIndicator} />}
            </TouchableOpacity>
          ))}
        </View>

        {/* Posts Grid */}
        {activeTab === 'posts' && (
          <View style={styles.postsGrid}>
            {posts.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No posts yet</Text>
              </View>
            ) : (
              posts.map((post) => (
                <TouchableOpacity key={post.id} style={styles.postCard}>
                  <View style={styles.postCardInner}>
                    <Text style={styles.postCaption} numberOfLines={3}>{post.caption}</Text>
                    {post.mediaUrls?.length > 0 && (
                      <Image source={{ uri: post.mediaUrls[0] }} style={styles.postThumb} />
                    )}
                  </View>
                  <View style={styles.postStats}>
                    <Text style={styles.postStat}>🤍 {post.likeCount}</Text>
                    <Text style={styles.postStat}>💬 {post.commentCount}</Text>
                    <Text style={styles.postStat}>🔁 {post.repostCount}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {activeTab === 'replies' && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No replies yet</Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverContainer: {
    height: SCREEN_WIDTH * 9 / 16,
    width: '100%',
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  coverPlaceholder: {
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverPlaceholderText: {
    color: 'rgba(255,255,255,0.08)',
    fontSize: 60,
    fontWeight: '800',
  },
  coverGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  backButtonText: {
    fontSize: 20,
    color: colors.white,
  },
  profileImageContainer: {
    marginTop: -50,
    marginHorizontal: 16,
  },
  userInfoSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  displayName: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  username: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
  },
  bio: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 8,
    lineHeight: 22,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 32,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 12,
  },
  followBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  followingBtn: {
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  followBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.bg,
  },
  followingBtnText: {
    color: colors.text,
  },
  messageBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginTop: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    position: 'relative',
  },
  tabActive: {},
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.accent,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    width: '60%',
    height: 2,
    backgroundColor: colors.accent,
    borderRadius: 1,
  },
  postsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 1,
  },
  postCard: {
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  postCardInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
  },
  postCaption: {
    color: colors.text,
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  postThumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  postStats: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
    paddingHorizontal: 16,
  },
  postStat: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  emptyState: {
    paddingVertical: 60,
    alignItems: 'center',
    width: '100%',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
