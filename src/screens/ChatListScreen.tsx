import { useEffect, useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, RefreshControl, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { fetchChatList, Chat, fetchUserPrivacySettings, checkFollowing, searchUsers, User, tsToMillis, createGroupChat, fetchGroupMembers } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { Ionicons } from '@expo/vector-icons';

type TabType = 'chat';

export default function ChatListScreen({ navigation, route }: any) {
  const sharePostId = route?.params?.sharePostId || null;
  const shareCaption = route?.params?.shareCaption || '';
  const shareAuthor = route?.params?.shareAuthor || '';
  const [chats, setChats] = useState<Chat[]>([]);
  const [filtered, setFiltered] = useState<Chat[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canRefresh, setCanRefresh] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const currentUser = auth()?.currentUser;

  // Compose modal state
  const [composeModalVisible, setComposeModalVisible] = useState(false);
  const [composeSearch, setComposeSearch] = useState('');
  const [composeResults, setComposeResults] = useState<User[]>([]);
  const [composeSearching, setComposeSearching] = useState(false);
  const [composeChecking, setComposeChecking] = useState<string | null>(null);

  // Group chat creation state
  const [showGroupCreate, setShowGroupCreate] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      // PERF: Removed getValidToken() call from every load cycle.
      // It was being called every 5 seconds (now 15s) even though the token
      // is refreshed automatically by Firebase SDK on each request.
      // Only call it once on initial mount via a ref guard.
      const data = await fetchChatList();
      if (__DEV__) console.log('[ChatListScreen] Loaded', data.length, 'chats');
      setChats(data);
      setFiltered(search.trim() ? data.filter((c: any) =>
        (c.otherUser?.displayName || '').toLowerCase().includes(search.trim().toLowerCase()) ||
        (c.otherUser?.username || '').toLowerCase().includes(search.trim().toLowerCase()) ||
        (c.lastMessage || '').toLowerCase().includes(search.trim().toLowerCase())
      ) : data);
    } catch (e: any) {
      console.error('[ChatListScreen] Chat load error:', e?.message);
      console.error('[ChatListScreen] Error stack:', e?.stack);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload chat list every time the screen comes into focus
  const hasMountedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasMountedRef.current) {
        hasMountedRef.current = true;
        return;
      }
      load();
    }, [load]),
  );

  // Initial load on mount + polling every 15 seconds.
  // PERF: Was 5 seconds — too aggressive. Each poll calls fetchChatList which
  // makes Firestore reads. 15s is a good balance between freshness and cost.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // Group chat creation handler
  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedMembers.length === 0) return;
    try {
      const chatId = await createGroupChat(selectedMembers, groupName.trim());
      setShowGroupCreate(false);
      setGroupName('');
      setSelectedMembers([]);
      navigation.navigate('ChatRoom', { chatId });
    } catch (e: any) {
      console.error('[ChatList] Group creation failed:', e);
      Alert.alert('Error', 'Failed to create group chat. Please try again.');
    }
  };

  // Load available users when group create modal opens
  useEffect(() => {
    if (!showGroupCreate) return;
    (async () => {
      try {
        const currentUser = auth()?.currentUser;
        const snap = await firestore()
          .collection('users')
          .orderBy('createdAt', 'desc')
          .limit(50)
          .get();
        const users = snap.docs
          .filter(d => d.id !== currentUser?.uid)
          .map(d => ({ id: d.id, ...d.data() }));
        setAvailableUsers(users);
      } catch (e) {
        console.error('[ChatList] Failed to load users:', e);
      }
    })();
  }, [showGroupCreate]);

  const handleCompose = useCallback(() => {
    setComposeModalVisible(true);
    setComposeSearch('');
    setComposeResults([]);
  }, []);

  const handleComposeSearch = useCallback(async (query: string) => {
    setComposeSearch(query);
    if (!query.trim() || query.trim().length < 2) {
      setComposeResults([]);
      setComposeSearching(false);
      return;
    }
    setComposeSearching(true);
    try {
      const results = await searchUsers(query);
      // Exclude current user from results
      const filtered = results.filter(u => u.id !== currentUser?.uid);
      setComposeResults(filtered);
    } catch (e) {
      console.error('[ChatList] Compose search error:', e);
      setComposeResults([]);
    } finally {
      setComposeSearching(false);
    }
  }, [currentUser]);

  const handleSelectUser = useCallback(async (targetUser: User) => {
    setComposeChecking(targetUser.id);
    try {
      const privacy = await fetchUserPrivacySettings(targetUser.id);

      if (privacy.dmPermission === 'followers') {
        const isFollowing = await checkFollowing(targetUser.id);
        if (!isFollowing) {
          Alert.alert('Cannot Message', 'You need to follow this user to send them a message.');
          setComposeChecking(null);
          return;
        }
      }

      if (privacy.dmPermission === 'paid') {
        // Try dynamic import of PaidChatScreen — fallback to normal chat
        setComposeModalVisible(false);
        setComposeChecking(null);
        try {
          // Dynamic import to handle the case where PaidChatScreen may not exist yet
          await import('../screens/PaidChatScreen');
          // BUG FIX: PaidChatScreen expects { targetUserId, chatPrice }, NOT { targetUser }
          navigation.navigate('PaidChat', {
            targetUserId: targetUser.id,
            chatPrice: privacy.paidChatPrice || 0,
          });
          return;
        } catch (e) {
          console.warn('[ChatList] PaidChatScreen not available, falling back to normal chat:', e);
          // Fall through to normal chat creation
        }
      }

      // Allowed — create or find existing chat
      setComposeModalVisible(false);
      setComposeChecking(null);
      await createOrOpenChat(targetUser);
    } catch (e) {
      console.error('[ChatList] DM permission check error:', e);
      Alert.alert('Error', 'Could not check messaging permissions. Please try again.');
    } finally {
      setComposeChecking(null);
    }
  }, [navigation, currentUser]);

  const createOrOpenChat = useCallback(async (targetUser: User) => {
    const myId = currentUser?.uid;
    if (!myId) return;

    try {
      // BUG FIX: Use single-where queries + client-side filter instead of
      // compound queries. Compound queries (where user1Id==x AND user2Id==y)
      // require a composite Firestore index. Without the index, the query
      // fails with FAILED_PRECONDITION and is silently caught, causing a
      // NEW duplicate chat to be created EVERY TIME the user opens a chat.
      // Single-where queries (where user1Id==x) do NOT need composite indexes.
      const [snap1, snap2] = await Promise.all([
        firestore().collection('chats').where('user1Id', '==', myId).get(),
        firestore().collection('chats').where('user2Id', '==', myId).get(),
      ]);

      // Client-side filter for the specific user pair
      const existingChat = [...snap1.docs, ...snap2.docs].find((docSnap: any) => {
        const d = docSnap.data();
        const otherId = d.user1Id === myId ? d.user2Id : d.user1Id;
        return otherId === targetUser.id;
      });

      if (existingChat) {
        const chatData = existingChat.data();
        const chatObj: Chat = {
          id: existingChat.id,
          user1Id: chatData.user1Id,
          user2Id: chatData.user2Id,
          lastMessage: typeof chatData.lastMessage === 'string'
            ? chatData.lastMessage
            : (chatData.lastMessage?.content || chatData.lastMessage?.text || ''),
          lastMessageTime: (() => { try { return tsToMillis(chatData.lastMessageTime); } catch { return Date.now(); } })(),
          unreadCount: 0,
          otherUser: targetUser,
        };
        navigation.navigate('ChatRoom', { chat: chatObj });
        return;
      }

      // Create a new chat
      const chatRef = await firestore().collection('chats').add({
        user1Id: myId,
        user2Id: targetUser.id,
        lastMessage: '',
        lastMessageTime: firestore.FieldValue.serverTimestamp(),
        unreadUser1: 0,
        unreadUser2: 0,
        createdAt: firestore.FieldValue.serverTimestamp(),
      });

      const chatObj: Chat = {
        id: chatRef.id,
        user1Id: myId,
        user2Id: targetUser.id,
        lastMessage: '',
        lastMessageTime: Date.now(),
        unreadCount: 0,
        otherUser: targetUser,
      };
      navigation.navigate('ChatRoom', { chat: chatObj });
    } catch (e) {
      console.error('[ChatList] Failed to create/open chat:', e);
      Alert.alert('Error', 'Could not start conversation. Please try again.');
    }
  }, [currentUser, navigation]);

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

      if (__DEV__) console.log(`[ChatDelete] Deleted ${deleted} messages from chat ${chatId}`);

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
      // Never display raw E2EE ciphertext in the chat list preview
      if (item.lastMessage.startsWith('E2EE:')) {
        return '🔒 Encrypted message';
      }
      return item.lastMessage;
    }
    const msg = item.lastMessage as any;
    if (msg?.content) {
      if (typeof msg.content === 'string' && msg.content.startsWith('E2EE:')) {
        return '🔒 Encrypted message';
      }
      return msg.content;
    }
    if (msg?.text) return msg.text;
    if (msg) return JSON.stringify(msg)?.slice(0, 50);
    return 'No messages yet';
  };

  const getLastMessageTime = (item: Chat): number => {
    if (item.lastMessageTime) return item.lastMessageTime;
    const msg = item.lastMessage as any;
    if (msg && typeof msg === 'object' && msg.createdAt) {
      return new Date(msg.createdAt).getTime();
    }
    return 0;
  };

  // Empty states
  const renderNoResults = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIcon}>
        <Ionicons name="search-outline" size={32} color={colors.textSecondary} />
      </View>
      <Text style={styles.emptyTitle}>No results</Text>
      <Text style={styles.emptySubtitle}>No chats found matching "{search}"</Text>
    </View>
  );

  const renderNoChats = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIcon}>
        <Ionicons name="chatbubble-outline" size={32} color={colors.textSecondary} />
      </View>
      <Text style={styles.emptyTitle}>No messages yet</Text>
      <Text style={styles.emptySubtitle}>Start a conversation to see messages here.</Text>
    </View>
  );

  // Chat Ads tab content
  const renderChatAds = () => (
    <View style={styles.adsContainer}>
      <View style={styles.emptyIcon}>
        <Ionicons name="card-outline" size={32} color={colors.textTertiary} />
      </View>
      <Text style={styles.adsEmptyText}>No ads right now</Text>
      <Text style={styles.adsEmptySubtext}>Check back later for new sponsored content</Text>
    </View>
  );


  // Tab switcher
  const renderTabHeader = () => (
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
            color={activeTab === 'chat' ? colors.white : colors.textSecondary}
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
            color={activeTab === 'ads' ? colors.white : colors.textSecondary}
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

  // Compose modal for user search + DM permission enforcement
  const renderComposeModal = () => (
    <Modal
      visible={composeModalVisible}
      animationType="slide"
      transparent={false}
      onRequestClose={() => setComposeModalVisible(false)}
    >
      <KeyboardAvoidingView
        style={styles.composeModalContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          {/* Modal Header */}
          <View style={styles.composeHeader}>
            <TouchableOpacity
              onPress={() => setComposeModalVisible(false)}
              hitSlop={8}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.composeTitle}>New Message</Text>
            <View style={{ width: 24 }} />
          </View>

          {/* Search Input */}
          <View style={styles.composeSearchContainer}>
            <Ionicons name="search" size={18} color={colors.textTertiary} style={styles.composeSearchIcon} />
            <TextInput
              style={styles.composeSearchInput}
              placeholder="Search by username or name..."
              placeholderTextColor={colors.textTertiary}
              value={composeSearch}
              onChangeText={handleComposeSearch}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
            />
            {composeSearching && (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: 8 }} />
            )}
          </View>

          {/* Results */}
          <View style={styles.composeResultsContainer}>
            {composeSearch.trim().length >= 2 && !composeSearching && composeResults.length === 0 && (
              <View style={styles.composeEmptyContainer}>
                <Ionicons name="person-outline" size={36} color={colors.textTertiary} />
                <Text style={styles.composeEmptyText}>No users found</Text>
                <Text style={styles.composeEmptySubtext}>Try a different username or name</Text>
              </View>
            )}

            {composeSearch.trim().length < 2 && (
              <View style={styles.composeEmptyContainer}>
                <Ionicons name="chatbubble-ellipses-outline" size={36} color={colors.textTertiary} />
                <Text style={styles.composeEmptyText}>Find someone to message</Text>
                <Text style={styles.composeEmptySubtext}>Enter a username or display name (min. 2 characters)</Text>
              </View>
            )}

            {composeResults.map(user => (
              <TouchableOpacity
                key={user.id}
                style={styles.composeResultRow}
                onPress={() => handleSelectUser(user)}
                disabled={composeChecking === user.id}
                activeOpacity={0.7}
              >
                <Avatar uri={user.profileImage} name={user.displayName} size={44} />
                <View style={styles.composeResultInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.composeResultName} numberOfLines={1}>
                      {user.displayName || user.username}
                    </Text>
                    <VerifiedBadge badge={user.badge} isVerified={user.isVerified} size={14} />
                  </View>
                  <Text style={styles.composeResultUsername}>@{user.username}</Text>
                </View>
                {composeChecking === user.id ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{sharePostId ? 'Share to...' : 'Messages'}</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TouchableOpacity
              style={styles.createGroupBtn}
              onPress={() => setShowGroupCreate(true)}
              activeOpacity={0.7}
              hitSlop={8}
            >
              <Ionicons name="people-outline" size={22} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.newMsgBtn}
              onPress={handleCompose}
              activeOpacity={0.7}
            >
              <Ionicons name="create-outline" size={22} color={colors.accent} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {/* Tab Switcher */}
      {renderTabHeader()}

      {/* Tab Content */}
      {activeTab === 'chat' ? (
      <>
          {/* Search */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={16} color={colors.textTertiary} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search chats..."
              placeholderTextColor={colors.textTertiary}
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
                />
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.chatRow}
                  onPress={() => {
                    if (sharePostId) {
                      // In share mode: send the post as a message to this chat
                      const shareMessage = `📎 @${shareAuthor} posted:\n${shareCaption.slice(0, 100)}${shareCaption.length > 100 ? '...' : ''}\n\nhttps://black94.app/post/${sharePostId}`;
                      navigation.navigate('ChatRoom', { chat: item, shareMessage });
                    } else {
                      navigation.navigate('ChatRoom', { chat: item });
                    }
                  }}
                  onLongPress={() => {
                    const name = item.otherUser?.displayName || item.otherUser?.username || 'this user';
                    confirmDeleteChat(item.id, name);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.avatarWrap}>
                    <Avatar uri={item.otherUser?.profileImage} name={item.otherUser?.displayName} size={48} />
                    {item.unreadCount > 0 && (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text>
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
      ) : renderChatAds()}
      {/* Compose Modal */}
      {renderComposeModal()}

      {/* Group Chat Creation Modal */}
      <Modal visible={showGroupCreate} transparent animationType="slide" onRequestClose={() => setShowGroupCreate(false)}>
        <View style={styles.groupModalOverlay}>
          <View style={styles.groupModal}>
            {/* Header */}
            <View style={styles.groupModalHeader}>
              <TouchableOpacity onPress={() => setShowGroupCreate(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
              <Text style={styles.groupModalTitle}>New Group</Text>
              <View style={{ width: 22 }} />
            </View>

            {/* Group name input */}
            <View style={styles.groupNameInput}>
              <Ionicons name="chatbubbles-outline" size={20} color={colors.textSecondary} />
              <TextInput
                style={styles.groupNameText}
                value={groupName}
                onChangeText={setGroupName}
                placeholder="Group name"
                placeholderTextColor={colors.textTertiary}
                maxLength={40}
              />
            </View>

            {/* Selected members */}
            {selectedMembers.length > 0 && (
              <View style={styles.selectedMembersRow}>
                <Text style={styles.selectedMembersLabel}>{selectedMembers.length} member{selectedMembers.length !== 1 ? 's' : ''} selected</Text>
              </View>
            )}

            {/* User list */}
            <FlatList
              data={availableUsers}
              keyExtractor={item => item.id}
              renderItem={({ item }) => {
                const isSelected = selectedMembers.includes(item.id);
                return (
                  <TouchableOpacity
                    style={styles.groupUserRow}
                    onPress={() => {
                      setSelectedMembers(prev =>
                        isSelected
                          ? prev.filter(id => id !== item.id)
                          : [...prev, item.id]
                      );
                    }}
                    activeOpacity={0.7}
                  >
                    <Avatar uri={item.profileImage} name={item.displayName} size={40} />
                    <View style={styles.groupUserInfo}>
                      <Text style={styles.groupUserName} numberOfLines={1}>
                        {item.displayName || item.username}
                      </Text>
                      <Text style={styles.groupUserHandle}>@{item.username}</Text>
                    </View>
                    <View style={[styles.groupCheckbox, isSelected && styles.groupCheckboxSelected]}>
                      {isSelected && <Ionicons name="checkmark" size={16} color={colors.primaryForeground} />}
                    </View>
                  </TouchableOpacity>
                );
              }}
              style={{ flex: 1, marginHorizontal: 16 }}
            />

            {/* Create button */}
            <TouchableOpacity
              style={[
                styles.groupCreateBtn,
                (!groupName.trim() || selectedMembers.length === 0) && styles.groupCreateBtnDisabled,
              ]}
              onPress={handleCreateGroup}
              disabled={!groupName.trim() || selectedMembers.length === 0}
              activeOpacity={0.7}
            >
              <Text style={styles.groupCreateBtnText}>Create Group</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  headerTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  newMsgBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  /* ── Compose Modal ── */
  composeModalContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  composeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
  },
  composeTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  composeSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    height: 44,
    backgroundColor: colors.bgSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  composeSearchIcon: {},
  composeSearchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    height: 44,
    paddingVertical: 0,
  },
  composeResultsContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  composeEmptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  composeEmptyText: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginTop: 16,
  },
  composeEmptySubtext: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
  },
  composeResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
  },
  composeResultInfo: {
    flex: 1,
    minWidth: 0,
  },
  composeResultName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  composeResultUsername: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },

  /* ── Tab Switcher ── */
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
    backgroundColor: colors.bg,
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
    color: colors.textSecondary,
    fontWeight: '500',
  },
  tabTextActive: {
    color: colors.text,
    fontWeight: '700',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '25%',
    right: '25%',
    height: 3,
    backgroundColor: colors.white,
    borderRadius: 3,
  },
  newBadge: {
    backgroundColor: colors.bgInput,
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
    color: colors.textTertiary,
  },
  newBadgeTextActive: {
    color: colors.white,
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
    top: 12,
    zIndex: 1,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.bgSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    paddingLeft: 36,
    color: colors.text,
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
    flexShrink: 0,
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
    backgroundColor: colors.bgInput,
  },
  chatTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  chatName: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 15,
    flex: 1,
  },
  chatTime: {
    color: colors.textSecondary,
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
    color: colors.textSecondary,
    fontSize: 14,
    flex: 1,
  },
  chatLastMsgUnread: {
    color: colors.text,
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
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    color: colors.primaryForeground,
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
    backgroundColor: colors.bgSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptySubtitle: {
    color: colors.textSecondary,
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
    color: colors.textSecondary,
    fontSize: 14,
  },
  adsEmptySubtext: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 4,
  },

  /* ── Group Chat ── */
  createGroupBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupModalOverlay: {
    flex: 1,
    backgroundColor: colors.overlayHeavy,
    justifyContent: 'flex-end',
  },
  groupModal: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '85%',
    paddingBottom: 20,
  },
  groupModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
  },
  groupModalTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  groupNameInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.bgSubtle,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  groupNameText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
  },
  selectedMembersRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  selectedMembersLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  groupUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 0,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.separator,
  },
  groupUserInfo: {
    flex: 1,
  },
  groupUserName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  groupUserHandle: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  groupCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupCheckboxSelected: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  groupCreateBtn: {
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.text,
    alignItems: 'center',
  },
  groupCreateBtnDisabled: {
    opacity: 0.4,
  },
  groupCreateBtnText: {
    color: colors.primaryForeground,
    fontSize: 15,
    fontWeight: '700',
  },
});
