import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, RefreshControl, Alert,  } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { fetchChatList, Chat } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { Ionicons } from '@expo/vector-icons';

export default function ChatListScreen({ navigation }: any) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [filtered, setFiltered] = useState<Chat[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);
  const currentUser = auth()?.currentUser;

  const load = useCallback(async () => {
    try {
      const data = await fetchChatList();
      console.log('[ChatListScreen] Loaded', data.length, 'chats');
      setChats(data);
      setFiltered(data);
    } catch (e: any) {
      console.error('[ChatListScreen] Chat load error:', e?.message);
      Alert.alert('Chat Error', `Could not load chats: ${e?.message || 'Unknown error'}`);
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
      (typeof c.lastMessage === 'string' && c.lastMessage.toLowerCase().includes(lower))
    ));
  };

  const deleteChat = async (chatId: string, chatName: string) => {
    try {
      // Delete all messages in the subcollection using REST batch
      const messagesRef = firestore().collection('chats').doc(chatId).collection('messages');
      const batchSize = 100;
      let query = messagesRef.limit(batchSize);
      let deleted = 0;

      // Batch delete — handles large collections properly
      while (true) {
        const snapshot = await query.get();
        if (snapshot.empty) break;

        const batch = firestore().batch();
        for (const doc of snapshot.docs) {
          // Build a CompatDocRef for each message to pass to batch.delete()
          const msgDocRef = messagesRef.doc(doc.id);
          batch.delete(msgDocRef);
        }
        await batch.commit();
        deleted += snapshot.size;

        // If we deleted less than batchSize, we're done
        if (snapshot.size < batchSize) break;
      }

      console.log(`[ChatDelete] Deleted ${deleted} messages from chat ${chatId}`);

      // Delete the chat document
      await firestore().collection('chats').doc(chatId).delete();

      // Update local state
      setChats(prev => prev.filter(c => c.id !== chatId));
      setFiltered(prev => prev.filter(c => c.id !== chatId));

      Alert.alert('Chat Deleted', `Conversation with ${chatName} has been deleted.`);
    } catch (e) {
      console.error('[ChatDelete] Error:', e);
      Alert.alert('Error', 'Failed to delete chat. Please try again.');
    }
  };

  const confirmDeleteChat = (chatId: string, chatName: string) => {
    Alert.alert(
      'Delete Chat',
      `Delete your conversation with ${chatName}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteChat(chatId, chatName),
        },
      ]
    );
  };

  // Pull-to-refresh guard: only refresh when scrolled to top
  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    setCanRefresh(offset <= 0);
  }, []);

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
        <Ionicons name="search" size={16} color={colors.textSecondary} />
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
          onScroll={handleScroll}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing && canRefresh}
              onRefresh={() => {
                if (canRefresh) {
                  setRefreshing(true);
                  load();
                }
              }}
              tintColor={colors.accent}
              enabled={canRefresh}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.chatRow}
              onPress={() => navigation.navigate('ChatRoom', { chat: item })}
              onLongPress={() => {
                const name = item.otherUser?.displayName || item.otherUser?.username || 'this user';
                confirmDeleteChat(item.id, name);
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
                  {typeof item.lastMessage === 'string'
                    ? item.lastMessage
                    : item.lastMessage?.content || item.lastMessage?.text || JSON.stringify(item.lastMessage)?.slice(0, 50) || 'No messages yet'}
                </Text>
              </View>
              {item.unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>{item.unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: 'rgba(255,255,255,0.06)', marginLeft: 82 }} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 80 }}>
              <View style={styles.emptyIcon}>
                <Ionicons name="chatbubble-outline" size={36} color={colors.textSecondary} />
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 16, marginTop: 12 }}>No chats yet</Text>
              <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 8 }}>
                Start a conversation from someone's profile
              </Text>
              <TouchableOpacity
                style={{ marginTop: 20, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface, borderRadius: 8 }}
                onPress={load}
              >
                <Text style={{ color: colors.accent, fontSize: 14 }}>Tap to retry</Text>
              </TouchableOpacity>
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
    height: 56,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgInput,
    borderRadius: 25, marginHorizontal: 16, marginVertical: 10, paddingHorizontal: 14, gap: 8,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 11 },
  chatRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  chatInfo: { flex: 1 },
  chatTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  chatName: { color: colors.text, fontWeight: '700', fontSize: 15, flex: 1 },
  chatTime: { color: colors.textSecondary, fontSize: 13 },
  chatLastMsg: { color: colors.textSecondary, fontSize: 14 },
  unreadBadge: {
    backgroundColor: colors.accent, minWidth: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center', justifyContent: 'center',
  },
});
