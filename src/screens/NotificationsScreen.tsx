import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { firestore } from '../lib/firebase';
import { auth } from '../lib/firebase';
import { tsToMillis } from '../lib/api';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { useAppStore } from '../stores/app';
import { markAllNotificationsRead } from '../services/notificationEngine';
import { AppIcon } from '../components/icons';
import { Feather } from '@expo/vector-icons';

interface Notification {
  id: string;
  type: 'like' | 'comment' | 'follow' | 'repost' | 'mention' | 'chat' | 'story_view' | 'milestone' | 'suggestion';
  actorId: string;
  actorDisplayName: string;
  actorUsername: string;
  actorProfileImage: string | null;
  actorIsVerified?: boolean;
  actorBadge?: string;
  postCaption?: string;
  postId?: string;
  chatId?: string;
  commentContent?: string;
  read: boolean;
  createdAt: number;
}

/* Notification type icon mapping — matches web SVG icons */
function NotifTypeIcon({ type }: { type: string }) {
  if (type === 'like') return <Feather name="heart" size={14} color={colors.like} />;
  if (type === 'repost') return <Feather name="repeat" size={14} color={colors.repost} />;
  if (type === 'follow') return <Feather name="user-plus" size={14} color={colors.white} />;
  if (type === 'comment') return <Feather name="message-circle" size={14} color={colors.white} />;
  if (type === 'chat') return <Feather name="mail" size={14} color={colors.accentGold} />;
  if (type === 'mention') return <Feather name="at-sign" size={14} color={colors.accent} />;
  if (type === 'story_view') return <Feather name="eye" size={14} color={colors.textSecondary} />;
  return <Feather name="bell" size={14} color={colors.textSecondary} />;
}

export default function NotificationsScreen({ navigation }: any) {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);
  const currentUser = auth()?.currentUser;
  const { setUnreadNotificationCount } = useAppStore();

  const markAllRead = useCallback(async () => {
    if (!currentUser) return;
    try {
      await markAllNotificationsRead(currentUser.uid);
      setUnreadNotificationCount(0);
      // BUG FIX: Also update local state so unread indicators disappear immediately
      setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    } catch (e) {
      if (__DEV__) console.warn('Failed to mark read:', e);
    }
  }, [currentUser, setUnreadNotificationCount]);

  const load = async () => {
    if (!currentUser) { setLoading(false); return; }
    try {
      // Fetch notifications for this user — sort client-side to avoid
      // requiring a composite index (recipientId ASC, createdAt DESC).
      // The old code used orderBy('createdAt', 'desc') which needs a composite
      // index that may not exist. When the index was missing, the custom
      // Firestore REST wrapper returned an empty array (not an error), so the
      // catch/fallback never triggered — notifications were always invisible.
      const snap = await firestore()
        .collection('notifications')
        .where('recipientId', '==', currentUser.uid)
        .limit(50)
        .get();

      const ns: Notification[] = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          type: data.type || 'like',
          actorId: data.actorId || '',
          actorDisplayName: data.actorDisplayName || '',
          actorUsername: data.actorUsername || '',
          actorProfileImage: data.actorProfileImage || null,
          actorIsVerified: data.actorIsVerified || false,
          actorBadge: data.actorBadge || '',
          postCaption: data.postCaption || '',
          postId: data.postId || '',
          chatId: data.chatId || '',
          read: data.read || false,
          createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
        };
      });
      // Sort client-side descending by createdAt
      ns.sort((a, b) => b.createdAt - a.createdAt);
      setNotifs(ns);
      // NOTE: Do NOT auto-mark all as read. Let the user see unread indicators
      // and manually mark them read via the "Mark all read" button.
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset > 2) setCanRefresh(false);
    if (offset <= 0) setCanRefresh(true);
  }, []);

  const handleMomentumScrollBegin = useCallback(() => {
    setCanRefresh(false);
  }, []);

  const handleScrollEndDrag = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset <= 0) setCanRefresh(true);
  }, []);

  useEffect(() => { load(); }, []);

  const renderItem = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      style={[styles.row, !item.read && styles.rowUnread]}
      onPress={() => {
        // Mark individual notification as read
        if (!item.read && currentUser) {
          firestore()
            .collection('notifications')
            .doc(item.id)
            .update({ read: true })
            .catch(() => {});
          setNotifs(prev => prev.map(n => n.id === item.id ? { ...n, read: true } : n));
          // BUG FIX: Decrement the unread badge count so the tab icon updates
          useAppStore.getState().setUnreadNotificationCount(prev => Math.max(0, (prev || 0) - 1));
        }
        // Navigate based on type
        if (item.type === 'follow') {
          navigation.navigate('UserProfile', { userId: item.actorId });
        } else if (item.type === 'chat') {
          if (item.chatId) {
            navigation.navigate('ChatRoom', { chatId: item.chatId });
          } else {
            navigation.navigate('Drawer', { screen: 'MainTabs', params: { screen: 'Messages' } });
          }
        } else if (item.postId) {
          navigation.navigate('PostComments', { postId: item.postId });
        } else {
          navigation.navigate('UserProfile', { userId: item.actorId });
        }
      }}
    >
      <View style={styles.iconWrap}>
        <Avatar uri={item.actorProfileImage} name={item.actorDisplayName} size={36} />
        <View style={styles.typeIcon}>
          <NotifTypeIcon type={item.type} />
        </View>
        {!item.read && <View style={styles.unreadDot} />}
      </View>
      <View style={styles.content}>
        <Text style={styles.text}>
          <Text style={styles.bold}>{item.actorDisplayName}</Text>
          <VerifiedBadge badge={item.actorBadge || ''} isVerified={!!item.actorIsVerified} size={13} />
          <Text style={styles.action}>
            {item.type === 'like' && ' liked your post'}
            {item.type === 'comment' && ' commented on your post'}
            {item.type === 'follow' && ' followed you'}
            {item.type === 'repost' && ' reposted your post'}
            {item.type === 'mention' && ' mentioned you'}
            {item.type === 'chat' && ' sent you a message'}
            {item.type === 'story_view' && ' viewed your story'}
            {item.type === 'milestone' && ' reached a milestone'}
            {item.type === 'suggestion' && ' suggested for you'}
          </Text>
        </Text>
        {item.postCaption ? (
          <Text style={styles.postSnippet} numberOfLines={1}>{item.postCaption}</Text>
        ) : null}
        <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Notifications</Text>
          <TouchableOpacity onPress={markAllRead} activeOpacity={0.5}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={notifs}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          onScroll={handleScroll}
          onMomentumScrollBegin={handleMomentumScrollBegin}
          onScrollEndDrag={handleScrollEndDrag}
          scrollEventThrottle={16}
          nestedScrollEnabled={true}
          refreshControl={
            <RefreshControl
              refreshing={refreshing && canRefresh}
              onRefresh={() => { if (canRefresh) { setRefreshing(true); load(); } }}
              tintColor={colors.accent}
              enabled={true}
              progressViewOffset={-10}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: colors.border }} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 80 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.bgSubtle, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Feather name="bell" size={28} color={colors.textSecondary} />
              </View>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 6 }}>Nothing to see here — yet</Text>
              <Text style={{ color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 40, fontSize: 15 }}>
                Likes, shares, and follows will show up here.
              </Text>
            </View>
          }
        />
      )}
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
  headerTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  markAllText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', padding: 12, paddingHorizontal: 16, gap: 12 },
  rowUnread: { backgroundColor: colors.rowUnreadBg },
  iconWrap: { position: 'relative' },
  typeIcon: {
    position: 'absolute', bottom: -2, right: -4,
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.bg,
  },
  unreadDot: {
    position: 'absolute', top: -2, right: -2,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.white,
  },
  content: { flex: 1 },
  text: { color: colors.text, fontSize: 15, lineHeight: 24 },
  bold: { fontWeight: '700' },
  action: { fontWeight: '400', color: colors.text },
  postSnippet: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
  time: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
});
