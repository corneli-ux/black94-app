import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image, ActivityIndicator, Alert, Modal, Keyboard } from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { fetchMessages, sendMessage, blockUser, Message } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { Avatar } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { uploadOptimizedImage } from '../utils/imageUpload';

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
  const [uploading, setUploading] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showNuclearConfirm, setShowNuclearConfirm] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const flatRef = useRef<FlatList>(null);
  const currentUser = auth()?.currentUser;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const insets = useSafeAreaInsets();

  // ── GIF callback ref ──────────────────────────────────────────────────────
  const gifCallbackRef = useRef<((url: string) => void) | null>(null);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      // Re-poll to pick up any GIF sent via GifPickerScreen
      if (chat?.id) load(true);
    });
    return unsubscribe;
  }, [navigation, chat?.id]);

  // ── GIF callback handler ──────────────────────────────────────────────────
  useEffect(() => {
    if (!chat) return;
    // Check if a GIF URL was passed back from GifPickerScreen
    const gifUrl = route.params?.selectedGifUrl;
    if (gifUrl && typeof gifUrl === 'string' && gifUrl.startsWith('http')) {
      // Clear the param so it doesn't re-trigger
      navigation.setParams({ selectedGifUrl: undefined });
      sendMediaMessage(gifUrl, 'gif', '');
    }
  }, [route.params?.selectedGifUrl]);

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
    // Poll every 2 seconds for near-real-time feel
    pollRef.current = setInterval(() => load(true), 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [chat?.id]);

  // Scroll to bottom when keyboard opens (Android: OS resize + KAV off,
  // but we still need to ensure the last message is visible)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, () => {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return () => sub.remove();
  }, []);

  // ── Send text message ─────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    const content = text.trim();
    setText('');
    setSending(true);
    const tempMsg: Message = {
      id: `tmp-${Date.now()}`, chatId: chat.id,
      senderId: currentUser?.uid || '', receiverId: chat.otherUser?.id || '',
      content, messageType: 'text', createdAt: Date.now(),
    };
    setMessages(prev => [...prev, tempMsg]);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      await sendMessage(chat.id, chat.otherUser?.id || '', content);
      // Don't reload — polling (2s) picks up the server message.
      // Optimistic temp message is already visible for instant feel.
    } catch (e) {
      console.error('[ChatRoom] Send failed:', e);
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
      setText(content); // Restore text on failure
      Alert.alert('Send Failed', 'Could not send your message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // ── Send media message (image or gif) ─────────────────────────────────────

  const sendMediaMessage = async (mediaUrl: string, msgType: string, content: string) => {
    if (!chat) return;
    setSending(true);
    const tempMsg: Message = {
      id: `tmp-media-${Date.now()}`, chatId: chat.id,
      senderId: currentUser?.uid || '', receiverId: chat.otherUser?.id || '',
      content: content || (msgType === 'gif' ? 'GIF' : ''), messageType: msgType,
      mediaUrl, createdAt: Date.now(),
    };
    setMessages(prev => [...prev, tempMsg]);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      await sendMessage(chat.id, chat.otherUser?.id || '', content || '', { messageType: msgType, mediaUrl });
      await load(true);
    } catch (e) {
      console.error('[ChatRoom] Media send failed:', e);
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
      Alert.alert('Send Failed', 'Could not send. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // ── Pick & send image ─────────────────────────────────────────────────────

  const handlePickImage = async () => {
    setShowAttachMenu(false);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow photo library access to send images.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsMultipleSelection: false,
        maxWidth: 1200,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      const asset = result.assets[0];
      setUploading(true);

      // Upload to Firebase Storage
      const storagePath = `chats/${chat.id}/${Date.now()}_${asset.fileName || 'photo.jpg'}`;
      const uploadResult = await uploadOptimizedImage(asset.uri, storagePath, {
        mimeType: asset.mimeType || 'image/jpeg',
      });

      await sendMediaMessage(uploadResult.downloadUrl, 'image', '');
    } catch (err: any) {
      console.error('[ChatRoom] Image send error:', err);
      Alert.alert('Upload Failed', err.message || 'Could not upload image. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // ── Open camera for chat ──────────────────────────────────────────────────

  const handleCamera = async () => {
    setShowAttachMenu(false);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera access is needed to take photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsMultipleSelection: false,
        maxWidth: 1200,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      const asset = result.assets[0];
      setUploading(true);

      const storagePath = `chats/${chat.id}/${Date.now()}_camera.jpg`;
      const uploadResult = await uploadOptimizedImage(asset.uri, storagePath, {
        mimeType: asset.mimeType || 'image/jpeg',
      });

      await sendMediaMessage(uploadResult.downloadUrl, 'image', '');
    } catch (err: any) {
      console.error('[ChatRoom] Camera error:', err);
      Alert.alert('Upload Failed', err.message || 'Could not upload photo. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  // ── Open GIF picker ───────────────────────────────────────────────────────

  const handleOpenGifPicker = () => {
    setShowAttachMenu(false);
    navigation.navigate('GifPicker', {
      onSelect: (gifUrl: string) => {
        // This won't work with React Navigation params for functions,
        // so we use the route.params approach instead
      },
    });
  };

  // ── Nuclear Block ─────────────────────────────────────────────────────────

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

  // ── Render message bubble ─────────────────────────────────────────────────

  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.senderId === currentUser?.uid;
    const msgType = item.messageType || 'text';

    return (
      <View style={[styles.msgRow, isMine ? styles.msgRowRight : styles.msgRowLeft]}>
        {!isMine && <Avatar uri={chat?.otherUser?.profileImage} name={chat?.otherUser?.displayName} size={28} />}
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {/* Image message */}
          {msgType === 'image' && item.mediaUrl ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => {
                // Could open full-screen image viewer here
              }}
            >
              <Image
                source={{ uri: item.mediaUrl }}
                style={styles.bubbleImage}
                resizeMode="cover"
                resizeMode="contain"
              />
            </TouchableOpacity>
          ) : null}

          {/* GIF message */}
          {msgType === 'gif' && item.mediaUrl ? (
            <Image
              source={{ uri: item.mediaUrl }}
              style={styles.bubbleGif}
              resizeMode="contain"
            />
          ) : null}

          {/* Text content (for text messages or captions) */}
          {item.content && msgType === 'text' ? (
            <Text style={[styles.bubbleText, isMine && { color: '#000000' }]}>{item.content}</Text>
          ) : null}

          {/* Timestamp */}
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
    <KeyboardAvoidingView style={[styles.safeArea]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
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
              <Text style={styles.headerName} numberOfLines={1}>
                {chat.otherUser?.displayName || chat.otherUser?.username || 'Chat'}
              </Text>
              <Text style={styles.headerHandle}>@{chat.otherUser?.username}</Text>
            </View>
          </>
        ) : (
          <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: 10 }} />
        )}

        {/* Call button */}
        <TouchableOpacity
          style={styles.headerActionBtn}
          onPress={() => {
            if (!chat?.otherUser) return;
            navigation.navigate('AudioCall', {
              userId: chat.otherUser.id,
              userName: chat.otherUser.displayName || chat.otherUser.username || 'User',
              userProfileImage: chat.otherUser.profileImage,
            });
          }}
          hitSlop={8}
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

      {/* Input bar */}
      <View style={[styles.inputRow, { paddingBottom: Math.max(8, insets.bottom) }]}>
        {/* Attachment button */}
        <TouchableOpacity
          style={styles.inputActionBtn}
          onPress={() => setShowAttachMenu(!showAttachMenu)}
          activeOpacity={0.6}
        >
          <Ionicons name="add-circle-outline" size={22} color={showAttachMenu ? colors.accent : '#71767b'} />
        </TouchableOpacity>

        <View style={styles.inputPill}>
          <TextInput
            style={styles.pillInput}
            placeholder="Start a message"
            placeholderTextColor="#71767b"
            value={text}
            onChangeText={setText}
            multiline
            onFocus={() => setShowAttachMenu(false)}
          />
        </View>
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (text.trim() || sending) && styles.sendBtnActive,
          ]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
          activeOpacity={0.7}
        >
          {sending || uploading
            ? <ActivityIndicator color={colors.accent} size="small" />
            : <Ionicons name="send" size={18} color={text.trim() ? '#FFFFFF' : '#374151'} />
          }
        </TouchableOpacity>
      </View>

      {/* Attachment menu popup */}
      {showAttachMenu && (
        <>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            onPress={() => setShowAttachMenu(false)}
            activeOpacity={1}
          />
          <View style={styles.attachMenu}>
            <TouchableOpacity style={styles.attachItem} onPress={handlePickImage} activeOpacity={0.7}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(59,130,246,0.15)' }]}>
                <Ionicons name="image-outline" size={22} color="#3B82F6" />
              </View>
              <Text style={styles.attachLabel}>Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachItem} onPress={handleCamera} activeOpacity={0.7}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(16,185,129,0.15)' }]}>
                <Ionicons name="camera-outline" size={22} color="#10B981" />
              </View>
              <Text style={styles.attachLabel}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachItem} onPress={handleOpenGifPicker} activeOpacity={0.7}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(168,85,247,0.15)' }]}>
                <Ionicons name="film-outline" size={22} color="#A855F7" />
              </View>
              <Text style={styles.attachLabel}>GIF</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Uploading overlay */}
      {uploading && (
        <View style={styles.uploadingOverlay}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.uploadingText}>Sending photo...</Text>
        </View>
      )}

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
    borderBottomWidth: 0,
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
  // ── Messages ──
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginVertical: 2 },
  msgRowRight: { justifyContent: 'flex-end' },
  msgRowLeft: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
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
  // ── Image in bubble ──
  bubbleImage: {
    width: 220,
    height: 220,
    borderRadius: 14,
    marginBottom: 4,
  },
  bubbleGif: {
    width: 200,
    height: 160,
    borderRadius: 14,
    marginBottom: 4,
  },
  // ── Input bar ──
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 0,
  },
  inputActionBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
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
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  sendBtnActive: {
    backgroundColor: colors.accent,
  },
  sendBtnInactive: {},
  // ── Attachment menu ──
  attachMenu: {
    position: 'absolute',
    bottom: 60,
    left: 14,
    flexDirection: 'row',
    gap: 16,
    backgroundColor: '#16181c',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 16,
    zIndex: 60,
  },
  attachItem: {
    alignItems: 'center',
    gap: 6,
  },
  attachIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachLabel: {
    color: '#e7e9ea',
    fontSize: 11,
    fontWeight: '500',
  },
  // ── Upload overlay ──
  uploadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    zIndex: 100,
  },
  uploadingText: {
    color: '#e7e9ea',
    fontSize: 14,
    fontWeight: '500',
  },
  // ── Nuclear block modal ──
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
