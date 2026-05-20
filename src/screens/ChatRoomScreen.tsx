import { useEffect, useState, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Modal, Image, Linking } from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { sendMessage, blockUser, Message, tsToMillis } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { initE2EE, isE2EEReady, decryptMessage } from '../lib/e2ee';
import { Avatar } from '../components/Avatar';
import { Ionicons } from '@expo/vector-icons';
import { uploadOptimizedImage, copyToSafeCache } from '../utils/imageUpload';
import { optimizeImage } from '../utils/imageOptimizer';
import * as ImagePicker from 'expo-image-picker';

const QUICK_EMOJIS = ['😀','😂','😍','🥺','😎','🤔','👍','❤️','🔥','👏','🙌','💯','😢','😡','🤣','😊','🙏','✨','🎉','👋','🤝','💪','👀','🫡','🫶','🥰','😘','😏','🥳','💩'];

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
  const [showNuclearConfirm, setShowNuclearConfirm] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [e2eeReady, setE2eeReady] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [uploading, setUploading] = useState(false);
  const flatRef = useRef<FlatList>(null);
  const msgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentUser = auth()?.currentUser;

  const insets = useSafeAreaInsets();

  // ── Initialize E2EE & check encryption status ──
  useEffect(() => {
    if (!currentUser?.uid) return;
    initE2EE(currentUser.uid).catch(() => {});
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!chat?.otherUser?.id || !currentUser?.uid) return;
    isE2EEReady(chat.otherUser.id).then(setE2eeReady).catch(() => {});
  }, [chat?.otherUser?.id, currentUser?.uid]);

  // If chatId was passed (e.g., from UserProfileScreen), fetch the chat doc
  useEffect(() => {
    if (routeChatId && !routeChat) {
      const fetchChat = async () => {
        try {
          const chatDoc = await firestore().collection('chats').doc(routeChatId).get();
          if (chatDoc.exists) {
            const data = chatDoc.data();
            const otherId = data.user1Id === currentUser?.uid ? data.user2Id : data.user1Id;
            let otherUser: any = null;
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
                  phone: d.phone || null,
                  createdAt: (() => { try { return tsToMillis(d.createdAt); } catch { return Date.now(); } })(),
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
  }, [routeChatId, routeChat, currentUser?.uid]);

  // Realtime message listener using onSnapshot — replaces polling
  useEffect(() => {
    if (!chat?.id) return;

    // Reset unread count
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

    setLoading(true);

    const loadMessages = async () => {
      try {
        const snap = await firestore()
          .collection('chats')
          .doc(chat.id)
          .collection('messages')
          .orderBy('createdAt', 'asc')
          .limit(50)
          .get();

        const msgs = await Promise.all(
          snap.docs.map(async (docSnap) => {
            const data = docSnap.data();
            const rawContent = data.content || '';
            const senderId = data.senderId || '';
            const msgType = data.messageType || 'text';
            let content: string;

            if (msgType === 'image') {
              content = rawContent;
            } else {
              try {
                const decrypted = await decryptMessage(rawContent, senderId);
                content = decrypted ?? '[Unable to decrypt this message]';
              } catch {
                content = rawContent.startsWith('E2EE:')
                  ? '[Unable to decrypt this message]'
                  : rawContent;
              }
            }

            return {
              id: docSnap.id,
              chatId: chat.id,
              senderId,
              receiverId: data.receiverId || '',
              content,
              messageType: msgType,
              createdAt: (() => { try { return tsToMillis(data.createdAt); } catch { return Date.now(); } })(),
            } as Message & { messageType: string };
          }),
        );
        setMessages(msgs);
        setLoading(false);
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
      } catch (err) {
        console.warn('[ChatRoom] message poll error:', err);
        setLoading(false);
      }
    };

    loadMessages();
    msgPollRef.current = setInterval(loadMessages, 3000);

    return () => {
      if (msgPollRef.current) {
        clearInterval(msgPollRef.current);
        msgPollRef.current = null;
      }
    };
  }, [chat?.id]);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    const content = text.trim();
    setText('');
    setShowEmoji(false);
    setSending(true);
    try {
      await sendMessage(chat.id, chat.otherUser?.id || '', content);
      // No need to call load() — onSnapshot will pick up the new message automatically
    } catch (e: any) {
      console.error('[ChatRoom] Send failed:', e?.message || e);
      // If it looks like an auth error, try once more with a fresh token
      const isAuthError = e?.message?.includes('Not authenticated') ||
        e?.message?.includes('Session expired') ||
        e?.message?.includes('sign in again') ||
        e?.message?.includes('permission');
      if (isAuthError) {
        try {
          const { _invalidateTokenCache } = await import('../lib/firebase');
          _invalidateTokenCache();
        } catch {}
        try {
          await sendMessage(chat.id, chat.otherUser?.id || '', content);
        } catch (retryErr: any) {
          Alert.alert('Send Failed', `${retryErr?.message || 'Unknown error'}. Please try again.`);
        }
      } else {
        Alert.alert('Send Failed', `${e?.message || 'Unknown error'}. Please try again.`);
        setText(content); // Restore the text on failure
      }
    } finally {
      setSending(false);
    }
  };

  const handleNuclearBlock = async () => {
    setShowMenu(false);
    setShowNuclearConfirm(false);
    setBlocking(true);
    try {
      const success = await blockUser(chat.otherUser?.id);
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
  };

  // ── Image Upload Handler ──
  const handleImageSend = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission Denied', 'Please allow access to your photo library to send images.');
        return;
      }

      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['Images'] as ImagePicker.MediaType[],
        quality: 0.8,
      });

      if (pickerResult.canceled || !pickerResult.assets?.length) return;

      const asset = pickerResult.assets[0];
      if (!asset.uri) return;

      setUploading(true);

      // Copy to safe cache before OS cleans the temp file
      const safeUri = await copyToSafeCache(asset.uri);

      // Optimize the image for chat (smaller max size than posts)
      const optimized = await optimizeImage(safeUri, {
        maxWidth: 1024,
        maxHeight: 1024,
        jpegQuality: 0.8,
        generateThumbnail: false,
      });

      // Determine file extension from MIME type
      const ext = optimized.mimeType === 'image/png' ? 'png' : 'jpg';
      const storagePath = `chats/${chat.id}/${Date.now()}.${ext}`;

      // Upload to Firebase Storage
      const result = await uploadOptimizedImage(optimized.optimizedUri, storagePath);

      // Write the image message directly to Firestore
      // (skip E2EE for image URLs — access controlled by Storage rules)
      await firestore().collection('chats').doc(chat.id).collection('messages').add({
        senderId: currentUser?.uid,
        receiverId: chat.otherUser?.id,
        content: result.downloadUrl,
        messageType: 'image',
        createdAt: firestore.FieldValue.serverTimestamp(),
      });

      // Update the chat's last message preview
      try {
        await firestore().collection('chats').doc(chat.id).update({
          lastMessage: '📷 Photo',
          lastMessageTime: firestore.FieldValue.serverTimestamp(),
        });
      } catch (updateErr) {
        console.warn('[ChatRoom] Failed to update lastMessage preview:', updateErr);
      }

      // onSnapshot will pick up the new message automatically
    } catch (e: any) {
      console.error('[ChatRoom] Image upload failed:', e);
      Alert.alert('Upload Failed', e?.message || 'Failed to upload image. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // ── Phone Call Handler ──
  const handlePhoneCall = () => {
    const phone = (chat.otherUser as any)?.phone;
    if (phone) {
      Linking.openURL(`tel:${phone}`).catch(() => {
        Alert.alert('Call Failed', 'Unable to initiate the call.');
      });
    } else {
      const email = chat.otherUser?.email;
      if (email) {
        Alert.alert('No Phone Number', `No phone number available for this user.\n\nEmail: ${email}`);
      } else {
        Alert.alert('No Phone Number', 'No phone number available for this user.');
      }
    }
  };

  const renderMessage = ({ item }: { item: any }) => {
    const isMine = item.senderId === currentUser?.uid;
    const isImage = item.messageType === 'image';

    return (
      <View style={[styles.msgRow, isMine ? styles.msgRowRight : styles.msgRowLeft]}>
        {!isMine && <Avatar uri={chat?.otherUser?.profileImage} name={chat?.otherUser?.displayName} size={28} />}
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {isImage ? (
            <Image
              source={{ uri: item.content }}
              style={styles.imageMessage}
              resizeMode="cover"
              accessible
              accessibilityLabel="Image message"
            />
          ) : (
            <Text style={[styles.bubbleText, isMine && { color: '#000000' }]}>{item.content}</Text>
          )}
          <Text style={[styles.bubbleTime, isMine ? { color: 'rgba(0,0,0,0.5)' } : { color: '#94a3b8' }]}>
            {formatTime(item.createdAt)}
          </Text>
        </View>
      </View>
    );
  };

  if (!chat) {
    return (
      <View style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={[styles.safeArea]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      {/* Header with SafeAreaView for notch */}
      <SafeAreaView edges={['top']}>
      <View style={[styles.header]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#e7e9ea" />
        </TouchableOpacity>
        {chat ? (
          <>
            <Avatar uri={chat.otherUser?.profileImage} name={chat.otherUser?.displayName} size={36} />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.headerName} numberOfLines={1}>
                  {chat.otherUser?.displayName || chat.otherUser?.username || 'Chat'}
                </Text>
                {e2eeReady && (
                  <Ionicons name="lock-closed" size={14} color="#4ade80" style={{ marginLeft: 6 }} />
                )}
              </View>
              <Text style={styles.headerHandle}>
                @{chat.otherUser?.username}
                {e2eeReady ? ' · End-to-end encrypted' : ''}
              </Text>
            </View>
          </>
        ) : (
          <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: 10 }} />
        )}

        <View style={{ width: 36 }} />

        {/* Phone call button */}
        <TouchableOpacity
          style={styles.headerActionBtn}
          onPress={handlePhoneCall}
          activeOpacity={0.7}
          accessibilityLabel="Make phone call"
        >
          <Ionicons name="call" size={20} color="#e7e9ea" />
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
                  onPress={() => {
                    setShowMenu(false);
                    setShowNuclearConfirm(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.nuclearIcon}>💣</Text>
                  <Text style={styles.menuItemTextDelete}>Nuclear Block</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
      </SafeAreaView>

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
          ListFooterComponent={<View style={{ height: 80 }} />}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* Emoji Picker Panel */}
      {showEmoji && (
        <View style={styles.emojiPanel}>
          <View style={styles.emojiGrid}>
            {QUICK_EMOJIS.map((emoji, index) => (
              <TouchableOpacity
                key={index}
                style={styles.emojiItem}
                onPress={() => setText(prev => prev + emoji)}
                activeOpacity={0.7}
              >
                <Text style={styles.emojiText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Input bar */}
        <View style={[styles.inputRow, { paddingBottom: Math.max(8, insets.bottom) }]}>
          <View style={styles.inputPill}>
            {/* Attachment button inside the pill */}
            <TouchableOpacity
              style={styles.inputActionBtn}
              onPress={handleImageSend}
              disabled={uploading}
              activeOpacity={0.7}
              accessibilityLabel="Attach image"
            >
              {uploading ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Ionicons name="attach" size={20} color="#71767b" />
              )}
            </TouchableOpacity>

            <TextInput
              style={styles.pillInput}
              placeholder="Start a message"
              placeholderTextColor="#71767b"
              value={text}
              onChangeText={setText}
              multiline
              maxLength={2000}
            />

            {/* Emoji toggle button inside the pill */}
            <TouchableOpacity
              style={styles.inputActionBtn}
              onPress={() => setShowEmoji(prev => !prev)}
              activeOpacity={0.7}
              accessibilityLabel="Toggle emoji picker"
            >
              <Text style={{ fontSize: 20 }}>{showEmoji ? '⌨️' : '😊'}</Text>
            </TouchableOpacity>
          </View>
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
              ? <ActivityIndicator color={colors.accent} size="small" />
              : <Ionicons name="send" size={18} color={text.trim() ? colors.accent : '#374151'} />
            }
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000000' },
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
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  nuclearIcon: { fontSize: 20 },
  menuItemTextDelete: {
    color: '#f43f5e',
    fontSize: 14,
    fontWeight: '500',
  },
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
  imageMessage: {
    width: 250,
    maxWidth: '100%',
    height: 250,
    borderRadius: 12,
  },
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
    paddingLeft: 4,
    paddingRight: 4,
    paddingVertical: 4,
    maxHeight: 120,
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
  inputActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnInactive: {},
  // Emoji picker panel
  emojiPanel: {
    backgroundColor: '#16181c',
    borderTopWidth: 1,
    borderTopColor: '#374151',
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  emojiItem: {
    width: '16.66%',
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: {
    fontSize: 26,
  },
  // Nuclear block modal
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
