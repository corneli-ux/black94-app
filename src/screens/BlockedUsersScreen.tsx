import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, StatusBar, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { firestore } from '../lib/firebase';
import { Avatar } from '../components/Avatar';

interface BlockedUser { id: string; displayName: string; username: string; profileImage?: string; }

export default function BlockedUsersScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAppStore();
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    firestore().collection('users').doc(user.id).collection('blocked').get()
      .then(async snap => {
        const ids = snap.docs.map(d => d.id);
        if (!ids.length) { setLoading(false); return; }
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
        const users: BlockedUser[] = [];
        for (const chunk of chunks) {
          const s = await firestore().collection('users').where(firestore.FieldPath.documentId(), 'in', chunk).get();
          s.docs.forEach(d => {
            const data = d.data();
            users.push({ id: d.id, displayName: data.displayName || 'User', username: data.username || '', profileImage: data.profileImage });
          });
        }
        setBlocked(users);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  const unblock = (bu: BlockedUser) => {
    Alert.alert('Unblock', `Unblock @${bu.username}? They will be able to follow you and see your posts again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock', onPress: async () => {
          setUnblocking(bu.id);
          try {
            await firestore().collection('users').doc(user!.id).collection('blocked').doc(bu.id).delete();
            setBlocked(prev => prev.filter(u => u.id !== bu.id));
          } catch { Alert.alert('Error', 'Could not unblock. Try again.'); }
          finally { setUnblocking(null); }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Blocked Accounts</Text>
        <View style={{ width: 22 }} />
      </View>
      {loading
        ? <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} />
        : (
          <FlatList
            data={blocked}
            keyExtractor={i => i.id}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="ban-outline" size={48} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>No blocked accounts</Text>
                <Text style={styles.emptySub}>People you block won't be able to follow you or see your posts.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Avatar uri={item.profileImage} name={item.displayName} size={46} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.name}>{item.displayName}</Text>
                  <Text style={styles.handle}>@{item.username}</Text>
                </View>
                <TouchableOpacity style={styles.unblockBtn} onPress={() => unblock(item)} disabled={unblocking === item.id}>
                  {unblocking === item.id
                    ? <ActivityIndicator size="small" color={colors.text} />
                    : <Text style={styles.unblockText}>Unblock</Text>}
                </TouchableOpacity>
              </View>
            )}
          />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  handle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  unblockBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  unblockText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  emptySub: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
