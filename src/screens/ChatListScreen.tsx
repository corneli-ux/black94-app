import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity,
  StyleSheet, TextInput, ActivityIndicator, RefreshControl,
  Alert, SafeAreaView,
} from 'react-native';
import { colors } from '../theme/colors';
import { fetchChatList, Chat } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';

export default function ChatListScreen({ navigation }: any) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [filtered, setFiltered] = useState<Chat[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const currentUser = auth()?.currentUser;

  const load = useCallback(async () => {
    try {
      const data = await fetchChatList();
      setChats(data);
      setFiltered(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const onSearch = (q: string) => {
    setSearch(q);
    if (!q.trim()) { setFiltered(chats); return; }
    const lower = q.toLowerCase();
    setFiltered(chats.filter(c =>
      c.otherUser?.displayName?.toLowerCase().includes(lower) ||
      c.otherUser?.username?.toLowerCase().includes(lower) ||
      c.lastMessage?.toLowerCase().includes(lower)
    ));
  };

  const deleteChat = async (chatId: string, chatName: string) => {
    Alert.alert(
      'Delete Chat',
      `Delete your conversation with ${chatName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete all messages
              const msgsSnap = await firestore()
                .collection('chats').doc(chatId).collection('messages').get();
              for (const doc of msgsSnap.docs) {
                await doc.ref.delete();
              }
              // Delete chat document
              await firestore().collection('chats').doc(chatId).delete();
              setChats(prev => prev.filter(c => c.id !== chatId));
              setFiltered(prev => prev.filter(c => c.id !== chatId));
            } catch (e) {
              Alert.alert('Error', 'Failed to delete chat');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Messages</Text>
          <View style={{ width: 36 }} />
        </View>
      </SafeAreaView>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Text style={{ color: colors.textSecondary, marginRight: 8, fontSize: 15 }}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search chats..."
          placeholderTextColor={colors.textSecondary}
          value={search}
          onChangeText={onSearch}
        />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.chatRow}
              onPress={() => navigation.navigate('ChatRoom', { chat: item })}
              onLongPress={() => {
                const name = item.otherUser?.displayName || item.otherUser?.username || 'this user';
                Alert.alert(
                  name,
                  null,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete Chat', style: 'destructive', onPress: () => deleteChat(item.id, name) },
                  ]
                );
              }}
            >
              <Avatar uri={item.otherUser?.profileImage} size={52} />
              <View style={styles.chatInfo}>
                <View style={styles.chatTopRow}>
                  <Text style={styles.chatName} numberOfLines={1}>
                    {item.otherUser?.displayName || item.otherUser?.username || 'Unknown'}
                  </Text>
                  <Text style={styles.chatTime}>{timeAgo(item.lastMessageTime)}</Text>
                </View>
                <Text style={styles.chatLastMsg} numberOfLines={1}>
                  {item.lastMessage || 'No messages yet'}
                </Text>
              </View>
              {item.unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>{item.unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: colors.border, marginLeft: 82 }} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 80 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 16 }}>No chats yet</Text>
              <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 8 }}>
                Start a conversation from someone's profile
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
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgInput,
    borderRadius: 25, marginHorizontal: 16, marginVertical: 10, paddingHorizontal: 14,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 11 },
  chatRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  chatInfo: { flex: 1 },
  chatTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  chatName: { color: colors.text, fontWeight: '700', fontSize: 15, flex: 1 },
  chatTime: { color: colors.textSecondary, fontSize: 13 },
  chatLastMsg: { color: colors.textSecondary, fontSize: 14 },
  unreadBadge: {
    backgroundColor: colors.accent, width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
