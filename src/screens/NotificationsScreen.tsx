import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Alert,  } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { firestore } from '../lib/firebase';
import { auth } from '../lib/firebase';
import { tsToMillis } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { useAppStore } from '../stores/app';
import { Ionicons } from '@expo/vector-icons';

interface Notification {
  id: string;
  type: 'like' | 'comment' | 'follow' | 'repost' | 'mention';
  actorId: string;
  actorDisplayName: string;
  actorUsername: string;
  actorProfileImage: string | null;
  postCaption?: string;
  postId?: string;
  read: boolean;
  createdAt: number;
}

/* Notification type icon mapping — matches web SVG icons */
function NotifTypeIcon({ type }: { type: string }) {
  const color = type === 'like' ? '#f43f5e'
    : type === 'repost' ? '#10b981'
    : type === 'follow' ? '#3b82f6'
    : type === 'comment' ? '#3b82f6'
    : '#94a3b8';
  const name = type === 'like' ? 'heart'
    : type === 'repost' ? 'repeat'
    : type === 'follow' ? 'person-add'
    : type === 'comment' ? 'chatbubble'
    : 'at';
  return <Ionicons name={name} size={12} color={color} />;
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
      const snap = await firestore()
        .collection('notifications')
        .where('recipientId', '==', currentUser.uid)
        .where('read', '==', false)
        .limit(100)
        .get();

      const batch: Promise<any>[] = [];
      snap.docs.forEach(doc => {
        batch.push(doc.ref.update({ read: true }));
      });
      await Promise.all(batch);
      setUnreadNotificationCount(0);
    } catch (e) {
      console.warn('Failed to mark read:', e);
    }
  }, [currentUser]);

  const load = async () => {
    if (!currentUser) { setLoading(false); return; }
    try {
      const snap = await firestore()
        .collection('notifications')
        .where('recipientId', '==', currentUser.uid)
        .orderBy('createdAt', 'desc')
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
          postCaption: data.postCaption || '',
          postId: data.postId || '',
          read: data.read || false,
          createdAt: tsToMillis(data.createdAt),
        };
      });
      setNotifs(ns);

      // Auto mark all as read (matches web app behavior)
      const unread = ns.filter(n => !n.read);
      if (unread.length > 0) {
        markAllRead();
      }
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
        // Navigate to the actor's profile
        navigation.navigate('UserProfile', { userId: item.actorId });
      }}
    >
      <View style={styles.iconWrap}>
        <Avatar uri={item.actorProfileImage} size={36} />
        <View style={styles.typeIcon}>
          <NotifTypeIcon type={item.type} />
        </View>
        {!item.read && <View style={styles.unreadDot} />}
      </View>
      <View style={styles.content}>
        <Text style={styles.text}>
          <Text style={styles.bold}>{item.actorDisplayName}</Text>
          <Text style={styles.action}>
            {item.type === 'like' && ' liked your post'}
            {item.type === 'comment' && ' commented on your post'}
            {item.type === 'follow' && ' followed you'}
            {item.type === 'repost' && ' reposted your post'}
            {item.type === 'mention' && ' mentioned you'}
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
          <TouchableOpacity onPress={markAllRead}>
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
              enabled={false}
              progressViewOffset={-10}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: colors.border }} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 80 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Ionicons name="notifications-outline" size={28} color="#94a3b8" />
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
  rowUnread: { backgroundColor: 'rgba(255,255,255,0.03)' },
  iconWrap: { position: 'relative' },
  typeIcon: {
    position: 'absolute', bottom: -2, right: -4,
    width: 20, height: 20, borderRadius: 10, backgroundColor: '#000000',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.bg,
  },
  unreadDot: {
    position: 'absolute', top: 0, right: 0,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  content: { flex: 1 },
  text: { color: colors.text, fontSize: 15, lineHeight: 24 },
  bold: { fontWeight: '700' },
  action: { fontWeight: '400', color: colors.text },
  postSnippet: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
  time: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
});
