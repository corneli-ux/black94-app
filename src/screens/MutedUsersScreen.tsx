import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, StatusBar, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { firestore } from '../lib/firebase';
import { Avatar } from '../components/Avatar';
import { AppIcon } from '../components/icons';

export default function MutedUsersScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAppStore();
  const [muted, setMuted] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    firestore().collection('users').doc(user.id).collection('muted').get()
      .then(async snap => {
        const ids = snap.docs.map(d => d.id);
        if (!ids.length) { setLoading(false); return; }
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
        const users: any[] = [];
        for (const chunk of chunks) {
          const s = await firestore().collection('users').where(firestore.FieldPath.documentId(), 'in', chunk).get();
          s.docs.forEach(d => users.push({ id: d.id, ...d.data() }));
        }
        setMuted(users);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  const unmute = async (mu: any) => {
    Alert.alert('Unmute', `Unmute @${mu.username}? Their posts will reappear in your feed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unmute', onPress: async () => {
          await firestore().collection('users').doc(user!.id).collection('muted').doc(mu.id).delete().catch(() => {});
          setMuted(prev => prev.filter(u => u.id !== mu.id));
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <AppIcon name="arrow-back" size="lg" color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Muted Accounts</Text>
        <View style={{ width: 22 }} />
      </View>
      {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} /> : (
        <FlatList
          data={muted}
          keyExtractor={i => i.id}
          ListEmptyComponent={
            <View style={styles.empty}>
              <AppIcon name="volume-off" size="hero" color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No muted accounts</Text>
              <Text style={styles.emptySub}>Muted accounts won't know they're muted. Their posts won't appear in your feed.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Avatar uri={item.profileImage} name={item.displayName} size={46} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.name}>{item.displayName || 'User'}</Text>
                <Text style={styles.handle}>@{item.username}</Text>
              </View>
              <TouchableOpacity style={styles.btn} onPress={() => unmute(item)}>
                <Text style={styles.btnText}>Unmute</Text>
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
  btn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  btnText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  emptySub: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
