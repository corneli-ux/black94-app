import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, RefreshControl, Alert, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { fetchChatList, Chat } from '../lib/api';
import { auth, firestore, getValidToken } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { Ionicons } from '@expo/vector-icons';

type TabType = 'chat' | 'ads';

export default function ChatListScreen({ navigation }: any) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [filtered, setFiltered] = useState<Chat[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const currentUser = auth()?.currentUser;

  const load = useCallback(async () => {
    try {
      // Ensure auth token is fresh before querying Firestore
      try { await getValidToken(); } catch {}
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
      // Delete the chat document first (so it disappears from the list immediately)
      await firestore().collection('chats').doc(chatId).delete();

      // Then best-effort delete messages in the subcollection
      const messagesRef = firestore().collection('chats').doc(chatId).collection('messages');
      const batchSize = 100;
      let deleted = 0;
      let hasMore = true;

      while (hasMore) {
        try {
          const snapshot = await messagesRef.limit(batchSize).get();
          if (snapshot.empty) break;

          const deletePromises = snapshot.docs.map(doc =>
            messagesRef.doc(doc.id).delete().catch(e => {
              console.warn(`[ChatDelete] Failed to delete message ${doc.id}:`, e);
            })
          );
          await Promise.all(deletePromises);
          deleted += snapshot.size;
          hasMore = snapshot.size >= batchSize;
        } catch (e) {
          console.warn(`[ChatDelete] Batch failed at ${deleted} messages, continuing...`, e);
          break;
        }
      }

      console.log(`[ChatDelete] Deleted ${deleted} messages from chat ${chatId}`);

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

  // Pull-to-refresh: simplified scroll tracking
  const handleScroll = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    setCanRefresh(offset <= 0);
  }, []);

  const handleMomentumScrollBegin = useCallback(() => {
    setCanRefresh(false);
  }, []);

  const handleScrollEndDrag = useCallback((event: any) => {
    const offset = event.nativeEvent.contentOffset.y;
    if (offset <= 0) setCanRefresh(true);
  }, []);

  const getLastMessageContent = (item: Chat): string => {
    if (typeof item.lastMessage === 'string') {
      return item.lastMessage;
    }
    if (item.lastMessage?.content) return item.lastMessage.content;
    if (item.lastMessage?.text) return item.lastMessage.text;
    if (item.lastMessage) return JSON.stringify(item.lastMessage)?.slice(0, 50);
    return 'No messages yet';
  };

  const getLastMessageTime = (item: Chat): number => {
    if (item.lastMessageTime) return item.lastMessageTime;
    if (item.lastMessage && typeof item.lastMessage === 'object' && item.lastMessage.createdAt) {
      return new Date(item.lastMessage.createdAt).getTime();
    }
    return 0;
  };

  // Empty states
  const renderNoResults = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIcon}>
        <Ionicons name="search-outline" size={32} color="#94a3b8" />
      </View>
      <Text style={styles.emptyTitle}>No results</Text>
      <Text style={styles.emptySubtitle}>No chats found matching "{search}"</Text>
    </View>
  );

  const renderNoChats = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIcon}>
        <Ionicons name="chatbubble-outline" size={32} color="#94a3b8" />
      </View>
      <Text style={styles.emptyTitle}>No messages yet</Text>
      <Text style={styles.emptySubtitle}>Start a conversation to see messages here.</Text>
    </View>
  );

  // Chat Ads placeholder
  const renderChatAds = () => (
    <View style={styles.adsContainer}>
      <View style={styles.emptyIcon}>
        <Ionicons name="card-outline" size={32} color="#64748b" />
      </View>
      <Text style={styles.adsEmptyText}>No ads right now</Text>
      <Text style={styles.adsEmptySubtext}>Check back later for new sponsored content</Text>
    </View>
  );

  // Tab switcher
  const renderTabSwitcher = () => (
    <View style={styles.tabBar}>
      <TouchableOpacity
        style={styles.tabButton}
        onPress={() => setActiveTab('chat')}
        activeOpacity={0.7}
      >
        <View style={styles.tabContent}>
          <Ionicons
            name="chatbubble-outline"
            size={18}
            color={activeTab === 'chat' ? '#FFFFFF' : '#94a3b8'}
          />
          <Text style={[styles.tabText, activeTab === 'chat' && styles.tabTextActive]}>
            Chats
          </Text>
        </View>
        {activeTab === 'chat' && <View style={styles.tabIndicator} />}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.tabButton}
        onPress={() => setActiveTab('ads')}
        activeOpacity={0.7}
      >
        <View style={styles.tabContent}>
          <Ionicons
            name="card-outline"
            size={18}
            color={activeTab === 'ads' ? '#FFFFFF' : '#94a3b8'}
          />
          <Text style={[styles.tabText, activeTab === 'ads' && styles.tabTextActive]}>
            Chat Ads
          </Text>
          <View style={[styles.newBadge, activeTab === 'ads' && styles.newBadgeActive]}>
            <Text style={[styles.newBadgeText, activeTab === 'ads' && styles.newBadgeTextActive]}>NEW</Text>
          </View>
        </View>
        {activeTab === 'ads' && <View style={styles.tabIndicator} />}
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Messages</Text>
          <TouchableOpacity
            style={styles.newMsgBtn}
            onPress={() => navigation.navigate('Explore')}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Tab Switcher */}
      {renderTabSwitcher()}

      {/* Tab Content */}
      {activeTab === 'ads' ? (
        renderChatAds()
      ) : (
        <>
          {/* Search */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={16} color="#64748b" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search chats..."
              placeholderTextColor="#64748b"
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
              onMomentumScrollBegin={handleMomentumScrollBegin}
              onScrollEndDrag={handleScrollEndDrag}
              scrollEventThrottle={16}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={load}
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
                  activeOpacity={0.7}
                >
                  <View style={styles.avatarWrap}>
                    <Avatar uri={item.otherUser?.profileImage} size={48} />
                    {item.unreadCount > 0 && (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadText}>{item.unreadCount}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.chatInfo}>
                    <View style={styles.chatTopRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                        <Text style={styles.chatName} numberOfLines={1}>
                          {item.otherUser?.displayName || item.otherUser?.username || 'Unknown'}
                        </Text>
                        <VerifiedBadge badge={item.otherUser?.badge} isVerified={item.otherUser?.isVerified} size={14} />
                      </View>
                      <Text style={styles.chatTime}>{timeAgo(getLastMessageTime(item))}</Text>
                    </View>
                    <View style={styles.chatBottomRow}>
                      <Text
                        style={[
                          styles.chatLastMsg,
                          item.unreadCount > 0 && styles.chatLastMsgUnread,
                        ]}
                        numberOfLines={1}
                      >
                        {getLastMessageContent(item)}
                      </Text>
                    </View>
                    <View style={styles.chatInfoBorder} />
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                search.trim() ? renderNoResults() : renderNoChats()
              }
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  /* ── Header — matches web ChatListView header ── */
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    height: 56,
  },
  headerTitle: { color: '#e7e9ea', fontSize: 20, fontWeight: '700' },
  newMsgBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  /* ── Tab Switcher ── */
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#000000',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    position: 'relative',
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tabText: {
    fontSize: 15,
    color: '#94a3b8',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#e7e9ea',
    fontWeight: '700',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '25%',
    right: '25%',
    height: 3,
    backgroundColor: '#FFFFFF',
    borderRadius: 3,
  },
  newBadge: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  newBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  newBadgeTextActive: {
    color: '#FFFFFF',
  },

  /* ── Search ── */
  searchContainer: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    height: 40,
    position: 'relative',
    justifyContent: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: 12,
    zIndex: 1,
  },
  searchInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    paddingLeft: 36,
    color: '#e7e9ea',
    fontSize: 14,
    height: 40,
  },

  /* ── Chat Row — matches web px-5 py-3.5 ── */
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 12,
  },
  avatarWrap: {
    position: 'relative',
    shrink: 0,
  },
  chatInfo: {
    flex: 1,
    minWidth: 0,
  },
  chatInfoBorder: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  chatTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  chatName: {
    color: '#e7e9ea',
    fontWeight: '700',
    fontSize: 15,
    flex: 1,
  },
  chatTime: {
    color: '#94a3b8',
    fontSize: 13,
    marginLeft: 8,
  },
  chatBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  chatLastMsg: {
    color: '#94a3b8',
    fontSize: 14,
    flex: 1,
  },
  chatLastMsgUnread: {
    color: '#e7e9ea',
    fontWeight: '600',
  },

  /* ── Unread Badge ── */
  unreadBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '700',
  },

  /* ── Empty States ── */
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 112,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    color: '#e7e9ea',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptySubtitle: {
    color: '#94a3b8',
    fontSize: 15,
    textAlign: 'center',
  },

  /* ── Chat Ads ── */
  adsContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  adsEmptyText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  adsEmptySubtext: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 4,
  },
});
