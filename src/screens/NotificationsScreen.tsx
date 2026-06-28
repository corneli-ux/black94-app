import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  interpolateColor,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
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
import { AnimatedPressableScale } from '../components/AnimatedPressableScale';
import { spring, DURATIONS } from '../constants/animations';

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

/* ── Day bucket helper ────────────────────────────────────────────────── */
function dayBucket(ts: number): string {
  const now = new Date();
  const then = new Date(ts);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;

  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfYesterday) return 'Yesterday';
  if (ts >= startOfWeek) return 'Earlier this week';
  return 'Earlier';
}

/* ── Row — animated unread background cross-fade when marked read ─────── */
function NotifRow({
  item, onPress,
}: { item: Notification; onPress: () => void; }) {
  // 0 = unread, 1 = read. Spring cross-fades the row background.
  const state = useSharedValue(item.read ? 1 : 0);

  useEffect(() => {
    state.value = withSpring(item.read ? 1 : 0, spring.gentle);
  }, [item.read, state]);

  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(state.value, [0, 1], [colors.rowUnreadBg, colors.bg]),
  }));

  const dotStyle = useAnimatedStyle(() => ({
    opacity: withTiming(state.value === 0 ? 1 : 0, { duration: DURATIONS.fast }),
    transform: [{ scale: withSpring(state.value === 0 ? 1 : 0.4, spring.snappy) }],
  }));

  return (
    <AnimatedPressableScale
      scale={0.99}
      springConfig={spring.snappy}
      onPress={onPress}
      style={[styles.row, bgStyle]}
    >
      <View style={styles.iconWrap}>
        <Avatar uri={item.actorProfileImage} name={item.actorDisplayName} size={36} />
        <View style={styles.typeIcon}>
          <NotifTypeIcon type={item.type} />
        </View>
        <Animated.View style={[styles.unreadDot, dotStyle]} pointerEvents="none" />
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
    </AnimatedPressableScale>
  );
}

/* ── Section header for day grouping ──────────────────────────────────── */
function SectionHeader({ label }: { label: string }) {
  return (
    <Animated.View entering={FadeIn.duration(DURATIONS.fast)}>
      <Text style={styles.sectionHeader}>{label}</Text>
    </Animated.View>
  );
}

/* ── Mark all read button with success flash ──────────────────────────── */
function MarkAllButton({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const flash = useSharedValue(0);

  const handlePress = useCallback(() => {
    onPress();
    // Flash green + scale punch to confirm the action landed.
    flash.value = withSequence(
      withSpring(1, spring.bouncy),
      withSpring(0, spring.gentle),
    );
  }, [onPress, flash]);

  const style = useAnimatedStyle(() => ({
    color: interpolateColor(flash.value, [0, 1], [colors.accent, colors.accentGreen]),
    transform: [{ scale: 1 + flash.value * 0.08 }],
  }));

  return (
    <AnimatedPressableScale
      scale={0.96}
      springConfig={spring.snappy}
      onPress={handlePress}
      disabled={disabled}
      hitSlop={8}
    >
      <Animated.Text style={[styles.markAllText, style]}>Mark all read</Animated.Text>
    </AnimatedPressableScale>
  );
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
      setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    } catch (e) {
      if (__DEV__) console.warn('Failed to mark read:', e);
    }
  }, [currentUser, setUnreadNotificationCount]);

  const load = async () => {
    if (!currentUser) { setLoading(false); return; }
    try {
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
      ns.sort((a, b) => b.createdAt - a.createdAt);
      setNotifs(ns);
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

  const handleRowPress = useCallback((item: Notification) => {
    // Mark individual notification as read
    if (!item.read && currentUser) {
      firestore()
        .collection('notifications')
        .doc(item.id)
        .update({ read: true })
        .catch(() => {});
      setNotifs(prev => prev.map(n => n.id === item.id ? { ...n, read: true } : n));
      // BUG FIX: setUnreadNotificationCount takes a number, not a callback.
      // Read the current count from the store and decrement it explicitly.
      const current = useAppStore.getState().unreadNotificationCount;
      setUnreadNotificationCount(Math.max(0, current - 1));
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
  }, [currentUser, navigation, setUnreadNotificationCount]);

  // Build sectioned data: [{ section: 'Today', data: [...] }, ...]
  const sectioned = (() => {
    const buckets: { [key: string]: Notification[] } = {};
    for (const n of notifs) {
      const key = dayBucket(n.createdAt);
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(n);
    }
    // Preserve a sensible order: Today → Yesterday → Earlier this week → Earlier
    const order = ['Today', 'Yesterday', 'Earlier this week', 'Earlier'];
    return order
      .filter(k => buckets[k] && buckets[k].length > 0)
      .map(k => ({ section: k, data: buckets[k] }));
  })();

  // Flatten with section headers as sticky items for FlatList.
  const flatData: Array<{ type: 'header'; label: string } | { type: 'row'; item: Notification }> = [];
  for (const s of sectioned) {
    flatData.push({ type: 'header', label: s.section });
    for (const n of s.data) flatData.push({ type: 'row', item: n });
  }

  const renderItem = ({ item, index }: { item: any; index: number }) => {
    if (item.type === 'header') {
      return <SectionHeader label={item.label} />;
    }
    return (
      <Animated.View
        entering={FadeInDown.delay(Math.min(index * 30, 240)).springify().damping(20).stiffness(200)}
      >
        <NotifRow
          item={item.item}
          onPress={() => handleRowPress(item.item)}
        />
      </Animated.View>
    );
  };

  const hasUnread = notifs.some(n => !n.read);

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Notifications</Text>
          <MarkAllButton onPress={markAllRead} disabled={!hasUnread} />
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={flatData}
          keyExtractor={(item: any, index) => item.type === 'header' ? `h-${item.label}` : `r-${item.item.id}`}
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
            <Animated.View
              style={styles.emptyWrap}
              entering={FadeIn.springify().damping(20).stiffness(200)}
            >
              <View style={styles.emptyIcon}>
                <Feather name="bell" size={28} color={colors.textSecondary} />
              </View>
              <Text style={styles.emptyTitle}>Nothing to see here — yet</Text>
              <Text style={styles.emptySubtitle}>
                Likes, shares, and follows will show up here.
              </Text>
            </Animated.View>
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
  sectionHeader: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: colors.bg,
  },
  emptyWrap: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.bgSubtle,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  emptySubtitle: { color: colors.textSecondary, textAlign: 'center', fontSize: 15 },
});
