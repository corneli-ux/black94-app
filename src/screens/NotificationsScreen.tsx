import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, Alert,
  SafeAreaView,
} from 'react-native';
import { colors } from '../theme/colors';
import { firestore } from '../lib/firebase';
import { auth } from '../lib/firebase';
import { tsToMillis } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { useAppStore } from '../stores/app';

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

const NOTIF_ICONS: Record<string, string> = {
  like: '❤️', comment: '💬', follow: '👤', repost: '🔁', mention: '@',
};

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
    setCanRefresh(offset <= 0);
  }, []);

  useEffect(() => { load(); }, []);

  const renderItem = ({ item }: { item: Notification }) => (
    <TouchableOpacity
      style={[styles.row, !item.read && styles.rowUnread]}
      onPress={() => {
        // Navigate to the actor's profile
        navigation.navigate('Profile', { userId: item.actorId });
      }}
    >
      <View style={styles.iconWrap}>
        <Avatar uri={item.actorProfileImage} size={44} />
        <View style={styles.typeIcon}>
          <Text style={{ fontSize: 12 }}>{NOTIF_ICONS[item.type] || '🔔'}</Text>
        </View>
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
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing && canRefresh}
              onRefresh={() => { if (canRefresh) { setRefreshing(true); load(); } }}
              tintColor={colors.accent}
              enabled={canRefresh}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: colors.border }} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 80 }}>
              <Text style={{ fontSize: 40, marginBottom: 16 }}>🔔</Text>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 6 }}>No notifications yet</Text>
              <Text style={{ color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 40 }}>
                When someone likes, comments, or follows you, it'll show up here.
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
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  markAllText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', padding: 16, gap: 14 },
  rowUnread: { backgroundColor: '#0a0a0f' },
  iconWrap: { position: 'relative' },
  typeIcon: {
    position: 'absolute', bottom: -2, right: -4,
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#1a1a1a',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.bg,
  },
  content: { flex: 1 },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: '700' },
  action: { fontWeight: '400', color: colors.text },
  postSnippet: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
  time: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
});
