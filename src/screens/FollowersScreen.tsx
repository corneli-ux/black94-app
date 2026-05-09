import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { firestore } from '../lib/firebase';
import { auth } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';

interface FollowerUser {
  id: string;
  username: string;
  displayName: string;
  profileImage: string | null;
  isVerified: boolean;
  badge: string;
  isFollowing: boolean;
}

type Mode = 'followers' | 'following';

export default function FollowersScreen({ route, navigation }: any) {
  const { targetUserId, mode: initialMode } = route.params || {};
  const [mode, setMode] = useState<Mode>(initialMode || 'followers');
  const [users, setUsers] = useState<FollowerUser[]>([]);
  const [loading, setLoading] = useState(true);
  const currentUser = auth()?.currentUser;
  const { user: loggedInUser } = useAppStore();

  const loadUsers = useCallback(async () => {
    if (!targetUserId) return;
    setLoading(true);
    try {
      const collection = firestore().collection('follows');
      const field = mode === 'followers' ? 'followingId' : 'followerId';
      const userField = mode === 'followers' ? 'followerId' : 'followingId';
      const snap = await collection.where(field, '==', targetUserId).limit(100).get();

      const userIds: string[] = [...new Set(snap.docs.map((d: any) => d.data()[userField]).filter(Boolean) as string[])];
      if (userIds.length === 0) { setUsers([]); setLoading(false); return; }

      const CHUNK = 30;
      const userMap: Record<string, any> = {};
      for (let i = 0; i < userIds.length; i += CHUNK) {
        const chunk = userIds.slice(i, i + CHUNK);
        const docs = await Promise.all(chunk.map(uid => firestore().collection('users').doc(uid).get().catch(() => null)));
        for (const doc of docs) { if (doc && doc.exists) { userMap[doc.id] = doc.data(); } }
      }

      // Check which of these the current user follows
      let followingSet = new Set<string>();
      if (currentUser) {
        const followCheckIds = userIds.filter(id => id !== currentUser.uid);
        for (let i = 0; i < followCheckIds.length; i += CHUNK) {
          const chunk = followCheckIds.slice(i, i + CHUNK);
          const checks = await Promise.all(chunk.map(uid => firestore().collection('follows').doc(`${currentUser.uid}_${uid}`).get().catch(() => null)));
          for (const doc of checks) { if (doc && doc.exists) followingSet.add(doc.id.replace(`${currentUser.uid}_`, '')); }
        }
      }

      const list: FollowerUser[] = userIds.map((uid: string) => {
        const d = userMap[uid] || {};
        return {
          id: uid, username: d.username || '', displayName: d.displayName || '', profileImage: d.profileImage || null,
          isVerified: d.isVerified || false, badge: d.badge || '', isFollowing: followingSet.has(uid),
        };
      });
      setUsers(list);
    } catch (e: any) {
      console.error('[FollowersScreen] Load error:', e?.message);
    }
    setLoading(false);
  }, [targetUserId, mode, currentUser?.uid]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleToggleFollow = async (targetId: string, currentlyFollowing: boolean) => {
    const userId = currentUser?.uid;
    if (!userId) return;
    const ref = firestore().collection('follows').doc(`${userId}_${targetId}`);
    try {
      if (currentlyFollowing) {
        await ref.delete();
      } else {
        await ref.set({ followerId: userId, followingId: targetId, createdAt: firestore.FieldValue.serverTimestamp() });
      }
      setUsers(prev => prev.map(u => u.id === targetId ? { ...u, isFollowing: !currentlyFollowing } : u));
    } catch (e) { console.warn('[FollowersScreen] Follow toggle failed:', e); }
  };

  const title = mode === 'followers' ? 'Followers' : 'Following';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}><Ionicons name="arrow-back" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={styles.headerTitle}>{targetUserId === currentUser?.uid ? 'Your ' : ''}{title}</Text>
        <View style={{ width: 22 }} />
      </View>
      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, mode === 'followers' && styles.tabActive]} onPress={() => setMode('followers')}>
          <Text style={[styles.tabText, mode === 'followers' && styles.tabTextActive]}>Followers</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, mode === 'following' && styles.tabActive]} onPress={() => setMode('following')}>
          <Text style={[styles.tabText, mode === 'following' && styles.tabTextActive]}>Following</Text>
        </TouchableOpacity>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : users.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={48} color="#64748b" />
          <Text style={styles.emptyText}>No {title.toLowerCase()} yet</Text>
        </View>
      ) : (
        <FlatList data={users} keyExtractor={item => item.id} renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => { if (item.id !== currentUser?.uid) navigation.navigate('UserProfile', { userId: item.id }); }}>
            <Avatar uri={item.profileImage} name={item.displayName || item.username} size={44} />
            <View style={styles.userInfo}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={styles.name} numberOfLines={1}>{item.displayName || item.username}</Text>
                <VerifiedBadge badge={item.badge} isVerified={item.isVerified} size={16} />
              </View>
              <Text style={styles.handle}>@{item.username}</Text>
            </View>
            {item.id !== currentUser?.uid && (
              <TouchableOpacity
                style={[styles.followBtn, item.isFollowing && styles.followingBtn]}
                onPress={() => handleToggleFollow(item.id, item.isFollowing)}
              >
                <Text style={[styles.followBtnText, item.isFollowing && styles.followingBtnText]}>
                  {item.isFollowing ? 'Following' : 'Follow'}
                </Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)' },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  tabs: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14, position: 'relative' as const },
  tabActive: {},
  tabText: { color: '#94a3b8', fontSize: 15, fontWeight: '500' },
  tabTextActive: { color: '#e7e9ea', fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { color: '#94a3b8', fontSize: 15, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.04)' },
  userInfo: { flex: 1, minWidth: 0 },
  name: { color: '#e7e9ea', fontSize: 15, fontWeight: '700' },
  handle: { color: '#94a3b8', fontSize: 14 },
  followBtn: { backgroundColor: '#e7e9ea', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 6 },
  followingBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#64748b' },
  followBtnText: { color: '#000000', fontWeight: '700', fontSize: 14 },
  followingBtnText: { color: '#e7e9ea' },
});
