/**
 * DualPaneChatScreen.tsx — Desktop-style dual pane chat for tablets
 *
 * Left pane: chat list. Right pane: active chat room.
 * On phone: tabs to switch. On tablet: side by side.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { firestore, auth } from '../lib/firebase';
import { fetchUserProfile, blockUser, sendMessage } from '../lib/api';
import { decryptMessage } from '../lib/e2ee';
import { colors } from '../theme/colors';

// ── Types ──────────────────────────────────────────────────────────────────

interface ChatItem {
  id: string;
  user1Id: string;
  user2Id: string;
  lastMessage?: string;
  lastMessageTime?: any;
  createdAt: string;
  updatedAt: string;
  otherUser?: {
    uid: string;
    username: string;
    displayName: string;
    profileImage: string;
    isVerified?: boolean;
  };
}

interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  receiverId: string;
  content: string;
  messageType: string;
  mediaUrl: string | null;
  status: string;
  createdAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function tsToISO(value: unknown): string {
  if (value && typeof value === 'object' && 'seconds' in value) {
    return new Date((value as any).seconds * 1000).toISOString();
  }
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IS_TABLET = SCREEN_WIDTH >= 768;

// ── Component ──────────────────────────────────────────────────────────────

export default function DualPaneChatScreen({ navigation }: any) {
  const currentUserId = auth().currentUser?.uid ?? '';

  const [chats, setChats] = useState<ChatItem[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [phoneTab, setPhoneTab] = useState<'list' | 'room'>('list');
  const [showNuclearConfirm, setShowNuclearConfirm] = useState(false);
  const [blocking, setBlocking] = useState(false);

  const messagesEndRef = useRef<FlatList>(null);
  const msgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedChat = useMemo(
    () => chats.find((c) => c.id === selectedChatId) ?? null,
    [chats, selectedChatId],
  );

  // ── Load chats ────────────────────────────────────────────────────────
  const loadChats = useCallback(async () => {
    if (!currentUserId) return;
    try {
      // No .orderBy('lastMessageTime') — composite index may not exist.
      // Sort client-side instead.
      const [snap1, snap2] = await Promise.all([
        firestore()
          .collection('chats')
          .where('user1Id', '==', currentUserId)
          .get(),
        firestore()
          .collection('chats')
          .where('user2Id', '==', currentUserId)
          .get(),
      ]);

      const chatMap = new Map<string, any>();
      for (const snap of [snap1, snap2]) {
        for (const doc of snap.docs) {
          if (!chatMap.has(doc.id)) {
            const d = doc.data();
            chatMap.set(doc.id, {
              id: doc.id,
              ...d,
              createdAt: tsToISO(d.createdAt),
              updatedAt: tsToISO(d.updatedAt),
            });
          }
        }
      }

      const enriched = await Promise.all(
        Array.from(chatMap.values()).map(async (c: any) => {
          const otherId =
            c.user1Id === currentUserId ? c.user2Id : c.user1Id;
          let otherUser: ChatItem['otherUser'] | undefined;
          try {
            const other = await fetchUserProfile(otherId);
            if (other) {
              otherUser = {
                uid: other.id,
                username: other.username,
                displayName: other.displayName,
                profileImage: other.profileImage || '',
                isVerified: other.isVerified,
              };
            }
          } catch {
            // User fetch failed, continue without other user info
          }
          return {
            ...c,
            otherUser,
          } as ChatItem;
        }),
      );

      // Sort chats by lastMessageTime descending
      enriched.sort((a, b) => {
        const tA = a.lastMessageTime?.seconds ? a.lastMessageTime.seconds * 1000 : (a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0);
        const tB = b.lastMessageTime?.seconds ? b.lastMessageTime.seconds * 1000 : (b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0);
        return tB - tA;
      });

      setChats(enriched);

      // Auto-select first chat on tablet
      if (IS_TABLET && enriched.length > 0 && !selectedChatId) {
        setSelectedChatId(enriched[0].id);
      }
    } catch (err) {
      console.error('[DualPaneChatScreen] loadChats error:', err);
    } finally {
      setLoadingChats(false);
    }
  }, [currentUserId, selectedChatId]);

  useFocusEffect(
    useCallback(() => {
      loadChats();
    }, [loadChats]),
  );

  // ── Load messages for selected chat (with polling instead of onSnapshot) ──
  useEffect(() => {
    if (!selectedChatId) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      try {
        const snap = await firestore()
          .collection('chats')
          .doc(selectedChatId)
          .collection('messages')
          .orderBy('createdAt', 'desc')
          .limit(50)
          .get();

        // Decrypt all messages in parallel
        const msgs = await Promise.all(
          snap.docs.map(async (doc) => {
            const data = doc.data();
            const rawContent = data.content ?? '';
            const senderId = data.senderId ?? '';

            // Attempt E2E decryption; null = tampered → placeholder, NEVER raw ciphertext
            let content: string;
            try {
              const decrypted = await decryptMessage(rawContent, senderId);
              content = decrypted ?? '[Unable to decrypt this message]';
            } catch {
              content = rawContent.startsWith('E2EE:')
                ? '[Unable to decrypt this message]'
                : rawContent;
            }

            return {
              id: doc.id,
              chatId: data.chatId ?? '',
              senderId,
              receiverId: data.receiverId ?? '',
              content,
              messageType: data.messageType ?? 'text',
              mediaUrl: data.mediaUrl ?? null,
              status: data.status ?? 'sent',
              createdAt: tsToISO(data.createdAt),
            };
          }),
        );

        msgs.reverse();
        setMessages(msgs);
      } catch (err) {
        console.warn('[DualPaneChatScreen] msg poll error:', err);
      } finally {
        setLoadingMessages(false);
      }
    };

    setLoadingMessages(true);
    loadMessages();

    // Poll every 2 seconds for near-real-time chat
    msgPollRef.current = setInterval(loadMessages, 2000);

    return () => {
      if (msgPollRef.current) {
        clearInterval(msgPollRef.current);
        msgPollRef.current = null;
      }
    };
  }, [selectedChatId]);

  // ── Auto scroll to bottom ──────────────────────────────────────────────
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => messagesEndRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  // ── Send message ───────────────────────────────────────────────────────
  const [sending, setSending] = useState(false);
  const handleSend = useCallback(async () => {
    if (!messageText.trim() || !selectedChat || !currentUserId || sending) return;

    const otherId =
      selectedChat.user1Id === currentUserId
        ? selectedChat.user2Id
        : selectedChat.user1Id;

    const content = messageText.trim();
    setMessageText('');
    setSending(true);

    // Optimistic: add temp message immediately for instant feel
    const tempMsg: ChatMessage = {
      id: `tmp-${Date.now()}`,
      chatId: selectedChat.id,
      senderId: currentUserId,
      receiverId: otherId,
      content,
      messageType: 'text',
      mediaUrl: null,
      status: 'sent',
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempMsg]);
    setTimeout(() => messagesEndRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      await sendMessage(selectedChat.id, otherId, content);
      // Don't reload — polling (2s) will pick up the server message.
      // The optimistic temp message is already visible.
    } catch (err: any) {
      console.error('[DualPaneChatScreen] send error:', err?.message || err);
      // Remove optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
      setMessageText(content);
    } finally {
      setSending(false);
    }
  }, [messageText, selectedChat, currentUserId, sending]);

  const openChat = useCallback(
    (chatId: string) => {
      setSelectedChatId(chatId);
      if (!IS_TABLET) setPhoneTab('room');
    },
    [],
  );

  // ── Nuclear Block ──────────────────────────────────────────────────────
  const handleNuclearBlock = useCallback(async () => {
    if (!selectedChat) return;
    const otherId =
      selectedChat.user1Id === currentUserId
        ? selectedChat.user2Id
        : selectedChat.user1Id;
    setShowNuclearConfirm(false);
    setBlocking(true);
    try {
      const success = await blockUser(otherId);
      if (success) {
        Alert.alert('Nuclear Block', 'Chat permanently deleted for both users');
        navigation.replace('Drawer');
      } else {
        Alert.alert('Error', 'Failed to block user. Please try again.');
      }
    } catch (e) {
      console.error('[NuclearBlock] Error:', e);
      Alert.alert('Error', 'Failed to block user.');
    } finally {
      setBlocking(false);
    }
  }, [selectedChat, currentUserId, navigation]);

  // ── Render chat list item ──────────────────────────────────────────────
  const renderChatItem = ({ item }: { item: ChatItem }) => {
    const isSelected = item.id === selectedChatId;
    return (
      <TouchableOpacity
        style={[styles.chatItem, isSelected && styles.chatItemSelected]}
        onPress={() => openChat(item.id)}
        activeOpacity={0.7}>
        <View style={styles.avatarBg}>
          {item.otherUser?.profileImage ? (
            <Image source={{ uri: item.otherUser.profileImage }} style={styles.avatar} />
          ) : (
            <Text style={styles.avatarInitial}>
              {(item.otherUser?.displayName ?? 'U')[0].toUpperCase()}
            </Text>
          )}
        </View>
        <View style={styles.chatContent}>
          <Text style={styles.chatName} numberOfLines={1}>
            {item.otherUser?.displayName ?? 'Unknown'}
          </Text>
          <Text style={styles.chatTime}>{formatTime(item.updatedAt)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // ── Render message bubble ──────────────────────────────────────────────
  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isMine = item.senderId === currentUserId;
    const msgType = item.messageType || 'text';
    return (
      <View
        style={[styles.msgWrapper, isMine ? styles.msgMine : styles.msgTheirs]}>
        <View
          style={[
            styles.msgBubble,
            isMine ? styles.msgBubbleMine : styles.msgBubbleTheirs,
          ]}>
          {msgType === 'image' && item.mediaUrl ? (
            <Image
              source={{ uri: item.mediaUrl }}
              style={{ width: 220, height: 220, borderRadius: 14, marginBottom: 4 }}
              resizeMode="contain"
            />
          ) : null}
          {msgType === 'gif' && item.mediaUrl ? (
            <Image
              source={{ uri: item.mediaUrl }}
              style={{ width: 200, height: 160, borderRadius: 14, marginBottom: 4 }}
              resizeMode="contain"
            />
          ) : null}
          {item.content && msgType === 'text' ? (
            <Text style={[styles.msgText, isMine ? styles.msgTextMine : styles.msgTextTheirs]}>
              {item.content}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  // ── Chat room pane ─────────────────────────────────────────────────────
  const renderChatRoom = () => {
    if (!selectedChat) {
      return (
        <View style={styles.emptyRoom}>
          <Ionicons name="chatbubbles-outline" size={56} color={colors.textMuted} />
          <Text style={styles.emptyRoomText}>Select a conversation</Text>
        </View>
      );
    }

    return (
      <KeyboardAvoidingView
        style={styles.roomContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Room header */}
        <View style={styles.roomHeader}>
          <TouchableOpacity onPress={() => !IS_TABLET && setPhoneTab('list')}>
            {!IS_TABLET && <Ionicons name="arrow-back" size={22} color={colors.text} />}
          </TouchableOpacity>
          <Text style={styles.roomName}>
            {selectedChat.otherUser?.displayName ?? 'Chat'}
          </Text>
          {/* Call button */}
          <TouchableOpacity
            style={styles.callBtn}
            onPress={() => {
              if (!selectedChat.otherUser) return;
              navigation.navigate('AudioCall', {
                userId: selectedChat.otherUser.id,
                userName: selectedChat.otherUser.displayName || selectedChat.otherUser.username || 'User',
                userProfileImage: selectedChat.otherUser.profileImage,
              });
            }}
            hitSlop={8}
          >
            <Ionicons name="call" size={20} color="#e7e9ea" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.blockBtn}
            onPress={() => setShowNuclearConfirm(true)}
            hitSlop={8}
          >
            <Ionicons name="alert-circle-outline" size={22} color="#f43f5e" />
          </TouchableOpacity>
        </View>

        {/* Nuclear Block Confirmation Modal */}
        <Modal
          visible={showNuclearConfirm}
          transparent
          animationType="fade"
          onRequestClose={() => setShowNuclearConfirm(false)}
        >
          <View style={styles.nuclearOverlay}>
            <View style={styles.nuclearDialog}>
              <View style={styles.nuclearIconContainer}>
                <Ionicons name="alert-circle" size={48} color="#f43f5e" />
              </View>
              <Text style={styles.nuclearTitle}>💣 Nuclear Block</Text>
              <Text style={styles.nuclearMessage}>
                This will permanently delete ALL messages, media, and attachments for BOTH users. This cannot be undone.
              </Text>
              <Text style={styles.nuclearSubtitle}>
                The user will also be blocked from contacting you again.
              </Text>
              <View style={styles.nuclearActions}>
                <TouchableOpacity
                  style={styles.nuclearCancelBtn}
                  onPress={() => setShowNuclearConfirm(false)}
                >
                  <Text style={styles.nuclearCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.nuclearConfirmBtn}
                  onPress={handleNuclearBlock}
                  disabled={blocking}
                >
                  {blocking ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.nuclearConfirmText}>Block Forever</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Messages */}
        {loadingMessages ? (
          <View style={styles.msgLoading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={messagesEndRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.msgList}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyMsg}>
                <Text style={styles.emptyMsgText}>No messages yet. Say hi!</Text>
              </View>
            }
          />
        )}

        {/* Input bar */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor={colors.textMuted}
            value={messageText}
            onChangeText={setMessageText}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!messageText.trim() || sending) && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={!messageText.trim()}>
            <Ionicons name="send" size={20} color={colors.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  };

  // ── Chat list pane ─────────────────────────────────────────────────────
  const renderChatList = () => (
    <View style={styles.listPane}>
      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Messages</Text>
      </View>
      {loadingChats ? (
        <View style={styles.listLoading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={chats}
          renderItem={renderChatItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.chatList}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadChats().finally(() => setRefreshing(false));
              }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyList}>
              <Ionicons name="chatbubble-ellipses-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyListText}>No conversations yet</Text>
            </View>
          }
        />
      )}
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {IS_TABLET ? (
        // Tablet: side by side
        <View style={styles.tabletLayout}>
          <View style={styles.tabletLeftPane}>{renderChatList()}</View>
          <View style={styles.divider} />
          <View style={styles.tabletRightPane}>{renderChatRoom()}</View>
        </View>
      ) : (
        // Phone: tab switching
        <View style={styles.phoneLayout}>
          {/* Phone tab bar */}
          <View style={styles.phoneTabBar}>
            <TouchableOpacity
              style={[styles.phoneTab, phoneTab === 'list' && styles.phoneTabActive]}
              onPress={() => setPhoneTab('list')}>
              <Text style={[styles.phoneTabText, phoneTab === 'list' && styles.phoneTabTextActive]}>
                Chats
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.phoneTab, phoneTab === 'room' && styles.phoneTabActive]}
              onPress={() => selectedChatId && setPhoneTab('room')}>
              <Text style={[styles.phoneTabText, phoneTab === 'room' && styles.phoneTabTextActive]}>
                Chat
              </Text>
            </TouchableOpacity>
          </View>
          {phoneTab === 'list' ? renderChatList() : renderChatRoom()}
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // Tablet layout
  tabletLayout: {
    flex: 1,
    flexDirection: 'row',
  },
  tabletLeftPane: {
    width: '40%',
  },
  tabletRightPane: {
    flex: 1,
  },
  divider: {
    width: 0,
    backgroundColor: 'transparent',
  },
  // Phone layout
  phoneLayout: {
    flex: 1,
  },
  phoneTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 0,
    backgroundColor: colors.surface,
  },
  phoneTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  phoneTabActive: {
    borderBottomWidth: 0,
  },
  phoneTabText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
  phoneTabTextActive: {
    color: colors.text,
    fontWeight: '700',
  },
  // List pane
  listPane: {
    flex: 1,
  },
  listHeader: {
    padding: 16,
    paddingBottom: 8,
  },
  listTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  listLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatList: {
    paddingVertical: 4,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  chatItemSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  avatarBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarInitial: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.white,
  },
  chatContent: {
    flex: 1,
  },
  chatName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  chatTime: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyListText: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 12,
  },
  // Chat room
  roomContainer: {
    flex: 1,
  },
  roomHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 0,
    gap: 12,
  },
  roomName: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  emptyRoom: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyRoomText: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 12,
  },
  msgLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  msgList: {
    padding: 12,
    paddingBottom: 8,
  },
  msgWrapper: {
    marginBottom: 6,
    maxWidth: '80%',
  },
  msgMine: {
    alignSelf: 'flex-end',
  },
  msgTheirs: {
    alignSelf: 'flex-start',
  },
  msgBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  msgBubbleMine: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  msgBubbleTheirs: {
    backgroundColor: colors.surfaceLight,
    borderBottomLeftRadius: 4,
  },
  msgText: {
    fontSize: 15,
    lineHeight: 20,
  },
  msgTextMine: {
    color: colors.white,
  },
  msgTextTheirs: {
    color: colors.text,
  },
  emptyMsg: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyMsgText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  // Input bar
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 0,
    gap: 8,
    backgroundColor: colors.surface,
    // Let SafeAreaView handle bottom inset instead of hardcoding
    paddingBottom: 8,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  // Nuclear block
  callBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockBtn: {
    padding: 4,
    marginLeft: 'auto',
  },
  nuclearOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  nuclearDialog: {
    backgroundColor: '#16181c',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.3)',
  },
  nuclearIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(244,63,94,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  nuclearTitle: {
    color: '#f43f5e',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  nuclearMessage: {
    color: '#e7e9ea',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 8,
  },
  nuclearSubtitle: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
  },
  nuclearActions: {
    flexDirection: 'row',
    gap: 12,
  },
  nuclearCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
  },
  nuclearCancelText: {
    color: '#e7e9ea',
    fontSize: 15,
    fontWeight: '600',
  },
  nuclearConfirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#f43f5e',
    alignItems: 'center',
  },
  nuclearConfirmText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
