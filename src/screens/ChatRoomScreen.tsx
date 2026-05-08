import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { fetchMessages, sendMessage, Message } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { Ionicons } from '@expo/vector-icons';

function formatTime(timestamp?: number | string): string {
  if (!timestamp) return '';
  const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function ChatRoomScreen({ route, navigation }: any) {
  const routeChat = route.params?.chat;
  const routeChatId = route.params?.chatId;
  const [chat, setChat] = useState(routeChat || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(!routeChat);
  const [sending, setSending] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const flatRef = useRef<FlatList>(null);
  const currentUser = auth()?.currentUser;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const insets = useSafeAreaInsets();

  // If chatId was passed (e.g., from UserProfileScreen), fetch the chat doc
  useEffect(() => {
    if (routeChatId && !routeChat) {
      const fetchChat = async () => {
        try {
          const chatDoc = await firestore().collection('chats').doc(routeChatId).get();
          if (chatDoc.exists) {
            const data = chatDoc.data();
            const otherId = data.user1Id === currentUser?.uid ? data.user2Id : data.user1Id;
            let otherUser = null;
            try {
              const otherSnap = await firestore().collection('users').doc(otherId).get();
              if (otherSnap.exists) {
                const d = otherSnap.data();
                otherUser = {
                  id: otherId, email: d.email || '', username: d.username || '',
                  displayName: d.displayName || '', bio: d.bio || '',
                  profileImage: d.profileImage || null, coverImage: d.coverImage || null,
                  role: d.role || 'personal', badge: d.badge || '',
                  subscription: d.subscription || 'free', isVerified: d.isVerified || false,
                  createdAt: d.createdAt?.seconds ? d.createdAt.seconds * 1000 : Date.now(),
                };
              }
            } catch {}
            setChat({
              id: chatDoc.id,
              user1Id: data.user1Id,
              user2Id: data.user2Id,
              lastMessage: data.lastMessage || '',
              lastMessageTime: data.lastMessageTime?.seconds ? data.lastMessageTime.seconds * 1000 : Date.now(),
              unreadCount: 0,
              otherUser,
            });
          }
        } catch (e) {
          console.error('[ChatRoom] Failed to fetch chat:', e);
        }
      };
      fetchChat();
    }
  }, [routeChatId, routeChat]);

  const load = useCallback(async (silent = false) => {
    if (!chat) return;
    try {
      const msgs = await fetchMessages(chat.id);
      setMessages(msgs);
      if (!silent) setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [chat?.id]);

  useEffect(() => {
    if (!chat) return;
    // Reset unread count when opening chat
    const resetUnread = async () => {
      try {
        const isUser1 = chat.user1Id === currentUser?.uid;
        const field = isUser1 ? 'unreadUser1' : 'unreadUser2';
        await firestore().collection('chats').doc(chat.id).update({ [field]: 0 });
      } catch (e) {
        console.warn('Failed to reset unread:', e);
      }
    };
    resetUnread();
    load();
    pollRef.current = setInterval(() => load(true), 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [chat?.id]);


  const handleSend = async () => {
    if (!chat || !text.trim() || sending) return;
    const content = text.trim();
    setText('');
    setSending(true);
    const tempMsg: Message = {
      id: `tmp-${Date.now()}`, chatId: chat.id,
      senderId: currentUser?.uid || '', receiverId: chat.otherUser?.id || '',
      content, createdAt: Date.now(),
    };
    setMessages(prev => [...prev, tempMsg]);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      await sendMessage(chat.id, chat.otherUser?.id || '', content);
      await load(true);
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  const handleDeleteChat = () => {
    setShowMenu(false);
    const name = chat?.otherUser?.displayName || chat?.otherUser?.username || 'this user';
    Alert.alert(
      'Delete Chat',
      'Are you sure you want to delete this chat? This will permanently remove all messages and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setShowMenu(false) },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete the chat document first (so it disappears from the list immediately)
              await firestore().collection('chats').doc(chat.id).delete();
              // Then best-effort delete messages in the subcollection
              const messagesRef = firestore().collection('chats').doc(chat.id).collection('messages');
              const batchSize = 100;
              let deleted = 0;
              let hasMore = true;
              while (hasMore) {
                try {
                  const snapshot = await messagesRef.limit(batchSize).get();
                  if (snapshot.empty) break;
                  const deletePromises = snapshot.docs.map(doc =>
                    messagesRef.doc(doc.id).delete().catch(e => {
                      console.warn(`[ChatDelete] Failed to delete msg ${doc.id}:`, e);
                    })
                  );
                  await Promise.all(deletePromises);
                  deleted += snapshot.size;
                  hasMore = snapshot.size >= batchSize;
                } catch (e) {
                  console.warn(`[ChatDelete] Batch ${deleted} failed:`, e);
                  break;
                }
              }
              console.log(`[ChatDelete] Deleted ${deleted} messages from chat ${chat.id}`);
              navigation.goBack();
            } catch (e) {
              console.error('[ChatDelete] Error:', e);
              Alert.alert('Error', 'Failed to delete chat.');
            }
          },
        },
      ]
    );
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.senderId === currentUser?.uid;
    return (
      <View style={[styles.msgRow, isMine ? styles.msgRowRight : styles.msgRowLeft]}>
        {!isMine && <Avatar uri={chat.otherUser?.profileImage} size={28} />}
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <Text style={[styles.bubbleText, isMine && { color: '#000000' }]}>{item.content}</Text>
          <Text style={[styles.bubbleTime, isMine ? { color: 'rgba(0,0,0,0.5)' } : { color: '#94a3b8' }]}>
            {formatTime(item.createdAt)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={[styles.safeArea]} behavior={Platform.OS === 'android' ? 'height' : 'padding'} keyboardVerticalOffset={0}>
      {/* Header — web: bg-[#000000]/90 backdrop-blur-xl, px-4 py-2.5 */}
      <View style={[styles.header, { paddingTop: Math.max(8, insets.top - 4) }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#e7e9ea" />
        </TouchableOpacity>
        {chat ? (
          <>
            <Avatar uri={chat.otherUser?.profileImage} size={36} />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={styles.headerName} numberOfLines={1}>
                {chat.otherUser?.displayName || chat.otherUser?.username || 'Chat'}
              </Text>
              <Text style={styles.headerHandle}>@{chat.otherUser?.username}</Text>
            </View>
          </>
        ) : (
          <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: 10 }} />
        )}

        {/* Search button */}
        <TouchableOpacity
          style={styles.headerActionBtn}
          onPress={() => {}}
          activeOpacity={0.7}
        >
          <Ionicons name="search-outline" size={18} color="#e7e9ea" />
        </TouchableOpacity>

        {/* More menu button */}
        <View style={{ position: 'relative' }}>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={() => setShowMenu(!showMenu)}
            activeOpacity={0.7}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color="#e7e9ea" />
          </TouchableOpacity>

          {/* Dropdown menu */}
          {showMenu && (
            <>
              <TouchableOpacity
                style={StyleSheet.absoluteFillObject}
                onPress={() => setShowMenu(false)}
                activeOpacity={1}
              />
              <View style={styles.dropdownMenu}>
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={handleDeleteChat}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trash-outline" size={18} color="#f43f5e" />
                  <Text style={styles.menuItemTextDelete}>Delete Chat</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>

      {/* Messages */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={{ padding: 16, gap: 4, paddingTop: 8 }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 80 }}>
              <Text style={{ color: '#94a3b8', fontSize: 15 }}>No messages yet. Say hello!</Text>
            </View>
          }
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
          // Bottom padding: on Android, adjustResize already accounts for keyboard
          // so we only need the input bar height. On iOS, we need both.
          ListFooterComponent={<View style={{ height: 80 }} />}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* Input bar — always above keyboard */}
      <View style={{ backgroundColor: '#000000' }}>
        <View style={[
          styles.inputRow,
          { paddingBottom: Math.max(8, insets.bottom) }
        ]}>
          {/* Input pill with inline buttons */}
          <View style={styles.inputPill}>
            {/* Emoji button */}
            <TouchableOpacity style={styles.pillBtn} onPress={() => {}} activeOpacity={0.7}>
              <Ionicons name="happy-outline" size={20} color="#71767b" />
            </TouchableOpacity>

            {/* GIF placeholder button */}
            <TouchableOpacity style={styles.pillBtn} onPress={() => {}} activeOpacity={0.7}>
              <Ionicons name="film-outline" size={20} color="#71767b" />
            </TouchableOpacity>

            {/* Text Input */}
            <TextInput
              style={styles.pillInput}
              placeholder="Start a message"
              placeholderTextColor="#71767b"
              value={text}
              onChangeText={setText}
              multiline
            />

            {/* Attach button */}
            <TouchableOpacity style={styles.pillBtn} onPress={() => {}} activeOpacity={0.7}>
              <Ionicons name="attach-outline" size={18} color="#71767b" />
            </TouchableOpacity>
          </View>

          {/* Send Button */}
          <TouchableOpacity
            style={[
              styles.sendBtn,
              !text.trim() && !sending && styles.sendBtnInactive,
            ]}
            onPress={handleSend}
            disabled={!text.trim() || sending}
            activeOpacity={0.7}
          >
            {sending
              ? <ActivityIndicator color="#3b82f6" size="small" />
              : <Ionicons name="send" size={18} color={text.trim() ? '#3b82f6' : '#374151'} />
            }
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000000' },

  /* ── Header — web: px-4 py-2.5 bg-[#000000]/90 backdrop-blur-xl ── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(0,0,0,0.9)',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  headerName: { color: '#e7e9ea', fontWeight: '700', fontSize: 15 },
  headerHandle: { color: '#94a3b8', fontSize: 12 },

  /* ── Header Action Buttons ── */
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* ── Dropdown Menu ── */
  dropdownMenu: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    minWidth: 180,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
    zIndex: 50,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuItemTextDelete: {
    color: '#f43f5e',
    fontSize: 14,
    fontWeight: '500',
  },

  /* ── Message Bubbles ──
     Web: mine = bg-gradient(135deg, #FFFFFF, #D1D5DB) text-black rounded-2xl rounded-br-sm
          theirs = bg-white/[0.08] text-[#e7e9ea] rounded-2xl rounded-bl-sm border-white/[0.06]
     max-w-[82%], px-3.5 py-2.5, text-[14px] leading-relaxed */
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginVertical: 2 },
  msgRowRight: { justifyContent: 'flex-end' },
  msgRowLeft: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMine: {
    backgroundColor: '#FFFFFF',
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  bubbleText: { color: '#e7e9ea', fontSize: 14, lineHeight: 22 },
  bubbleTime: { fontSize: 11, marginTop: 4 },

  /* ── Input Bar — matches web ChatInputBar ── */
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#374151',
  },
  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 0,
    backgroundColor: '#16181c',
    borderRadius: 22,
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 4,
    maxHeight: 120,
  },
  pillBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillInput: {
    flex: 1,
    backgroundColor: 'transparent',
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 6,
    paddingHorizontal: 4,
    maxHeight: 100,
    minHeight: 0,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnInactive: {
    // inactive state: no background, icon is #374151
  },
});
