import React, { useEffect, useState, useRef, useCallback } from 'react';
import { FlatList, Platform, Alert, Keyboard } from 'react-native';
import { Audio } from 'expo-av';
import { fetchMessages, sendMessage, blockUser, deleteMessage, Message } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import * as ImagePicker from 'expo-image-picker';
import { uploadOptimizedImage } from '../utils/imageUpload';

export interface UseChatRoomParams {
  routeChat: any;
  routeChatId?: string;
  shareMessage?: string;
  routeParams?: any;
  navigation: any;
}

export interface UseChatRoomReturn {
  chat: any;
  messages: Message[];
  loading: boolean;
  text: string;
  setText: (text: string) => void;
  sending: boolean;
  uploading: boolean;
  showMenu: boolean;
  setShowMenu: (v: boolean) => void;
  showAttachMenu: boolean;
  setShowAttachMenu: (v: boolean) => void;
  showNuclearConfirm: boolean;
  setShowNuclearConfirm: (v: boolean) => void;
  blocking: boolean;
  replyTo: Message | null;
  setReplyTo: (msg: Message | null) => void;
  fullscreenImage: string | null;
  setFullscreenImage: (url: string | null) => void;
  reactionMsg: Message | null;
  setReactionMsg: (msg: Message | null) => void;
  contextMsg: Message | null;
  setContextMsg: (msg: Message | null) => void;
  isRecording: boolean;
  recordingDuration: number;
  playingVoiceId: string | null;
  handleSend: () => Promise<void>;
  handlePickImage: () => Promise<void>;
  handleCamera: () => Promise<void>;
  handleOpenGifPicker: () => void;
  handleStartVoiceRecord: () => Promise<void>;
  handleStopVoiceRecord: () => Promise<void>;
  handlePlayVoice: (message: Message) => Promise<void>;
  handleReaction: (emoji: string) => Promise<void>;
  handleDeleteMessage: (mode: 'me' | 'everyone') => Promise<void>;
  handleNuclearBlock: () => Promise<void>;
  flatRef: React.RefObject<FlatList>;
}

export function useChatRoom({
  routeChat,
  routeChatId,
  shareMessage,
  routeParams,
  navigation,
}: UseChatRoomParams): UseChatRoomReturn {
  const [chat, setChat] = useState(routeChat || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState(shareMessage || '');
  const [loading, setLoading] = useState(!routeChat);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showNuclearConfirm, setShowNuclearConfirm] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [reactionMsg, setReactionMsg] = useState<Message | null>(null);
  const [contextMsg, setContextMsg] = useState<Message | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const playbackRef = useRef<Audio.Sound | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const flatRef = useRef<FlatList>(null);
  const currentUser = auth()?.currentUser;
  const unsubRef = useRef<(() => void) | null>(null);

  // ── GIF callback ref ──────────────────────────────────────────────────────
  const gifCallbackRef = useRef<((url: string) => void) | null>(null);

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
      await loadRef.current(true);
    } catch (e) {
      console.error('[ChatRoom] Media send failed:', e);
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
      Alert.alert('Send Failed', 'Could not send. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // ── BUG FIX: Use a messagesRef to avoid stale closure in polling interval.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const load = useCallback(async (silent = false) => {
    if (!chat) return;
    try {
      const msgs = await fetchMessages(chat.id);
      if (silent) {
        const currentMessages = messagesRef.current;
        const serverIds = new Set(msgs.map(m => m.id));
        const stillPending = currentMessages.filter(
          m => m.id.startsWith('tmp-') && !serverIds.has(m.id)
        );
        setMessages([...stillPending, ...msgs]);
      } else {
        setMessages(msgs);
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [chat?.id]);

  // BUG FIX: Use a loadRef so the polling interval always calls the latest load.
  const loadRef = useRef(load);
  loadRef.current = load;

  // ── Navigation focus listener ─────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (chat?.id) loadRef.current(true);
    });
    return unsubscribe;
  }, [navigation, chat?.id]);

  // ── GIF callback handler ──────────────────────────────────────────────────
  useEffect(() => {
    if (!chat) return;
    const gifUrl = routeParams?.selectedGifUrl;
    if (gifUrl && typeof gifUrl === 'string' && gifUrl.startsWith('http')) {
      navigation.setParams({ selectedGifUrl: undefined });
      sendMediaMessage(gifUrl, 'gif', '');
    }
  }, [routeParams?.selectedGifUrl, chat?.id]);

  // ── Fetch chat by chatId ──────────────────────────────────────────────────
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

  // ── Reset unread, load messages, start polling ────────────────────────────
  useEffect(() => {
    if (!chat) return;
    const resetUnread = async () => {
      try {
        const isUser1 = chat.user1Id === currentUser?.uid;
        const field = isUser1 ? 'unreadUser1' : 'unreadUser2';
        await firestore().collection('chats').doc(chat.id).update({ [field]: 0 });

        try {
          const otherSenderId = isUser1 ? chat.user2Id : chat.user1Id;
          if (otherSenderId) {
            const msgSnap = await firestore()
              .collection('chats').doc(chat.id).collection('messages')
              .where('senderId', '==', otherSenderId)
              .where('status', 'in', ['sent', 'delivered'])
              .limit(100)
              .get();
            if (!msgSnap.empty) {
              const batch = firestore().batch();
              msgSnap.docs.forEach(doc => {
                batch.update(doc.ref, { status: 'read' });
              });
              await batch.commit();
            }
          }
        } catch { /* non-critical */ }
      } catch (e) {
        console.warn('Failed to reset unread:', e);
      }
    };
    resetUnread();
    load();
    // Use listen() for change-based updates instead of polling every 2s.
    // This eliminates stale closures, scroll yanking, and reduces Firestore reads
    // by only triggering re-renders when messages actually change.
    const colRef = firestore().collection('chats').doc(chat.id).collection('messages')
      .orderBy('createdAt', 'asc');
    unsubRef.current = colRef.listen(
      ({ docs }) => {
        // Merge: keep temp messages that haven't appeared in server results yet
        const serverIds = new Set(docs.map(m => m.id));
        const stillPending = messagesRef.current.filter(
          m => m.id.startsWith('tmp-') && !serverIds.has(m.id)
        );
        const merged = [...stillPending, ...docs.map(d => ({
          id: d.id,
          ...d.data(),
          chatId: chat.id,
        }))];
        setMessages(merged);
      },
      { pollInterval: 3000 }, // Chat: poll every 3 seconds
    );
    return () => {
      if (unsubRef.current) unsubRef.current();
    };
  }, [chat?.id]);

  // ── Keyboard scroll to bottom ─────────────────────────────────────────────
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
    setReplyTo(null); // Clear reply context immediately
    const tempMsg: Message = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, chatId: chat.id,
      senderId: currentUser?.uid || '', receiverId: chat.otherUser?.id || '',
      content, messageType: 'text', createdAt: Date.now(),
    };
    setMessages(prev => [...prev, tempMsg]);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const result = await sendMessage(chat.id, chat.otherUser?.id || '', content, {
        replyToId: replyTo?.id || undefined,
        replyToContent: replyTo?.content || undefined,
        replyToSenderName: replyTo?.senderId === currentUser?.uid
          ? 'You'
          : (chat?.otherUser?.displayName || 'User'),
      });
      // BUG FIX: Check sendMessage return value — blocked messages appear sent
      if (result && !result.sent) {
        setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
        setText(content);
        Alert.alert('Send Failed', result.reason || 'Message could not be delivered.');
      }
    } catch (e) {
      console.error('[ChatRoom] Send failed:', e);
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
      setText(content); // Restore text on failure
      Alert.alert('Send Failed', 'Could not send your message. Please try again.');
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
    navigation.navigate('GifPicker');
  };

  // ── Voice recording (real recording with expo-av) ────────────────────

  const handleStartVoiceRecord = async () => {
    setShowAttachMenu(false);
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (e) {
      console.error('[ChatRoom] Failed to start recording:', e);
      Alert.alert('Error', 'Could not start voice recording. Please check microphone permissions.');
    }
  };

  const handleStopVoiceRecord = async () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const duration = recordingDuration;
    setIsRecording(false);
    setRecordingDuration(0);

    if (duration < 1) {
      // Too short — discard
      try { await recordingRef.current?.stopAsync(); } catch {}
      recordingRef.current = null;
      return;
    }

    try {
      await recordingRef.current?.stopAsync();
      const uri = recordingRef.current?.getURI();
      recordingRef.current = null;

      if (!uri) {
        console.warn('[ChatRoom] No recording URI after stop');
        return;
      }

      setUploading(true);
      const fileName = `voice_${Date.now()}.m4a`;
      const storagePath = `chats/${chat.id}/${fileName}`;
      let audioUrl = '';
      try {
        const uploadResult = await uploadOptimizedImage(uri, storagePath, {
          mimeType: 'audio/mp4',
          skipImageValidation: true,
        });
        audioUrl = uploadResult.downloadUrl;
      } catch (uploadErr) {
        console.error('[ChatRoom] Voice upload failed:', uploadErr);
      }

      if (!audioUrl) {
        Alert.alert('Upload Failed', 'Could not upload voice message. Please try again.');
        return;
      }
      await sendMessage(chat.id, chat.otherUser?.id || '', '', {
        messageType: 'voice',
        mediaUrl: audioUrl,
        voiceDuration: duration,
      });
      await loadRef.current(true);
    } catch (e) {
      console.error('[ChatRoom] Voice send failed:', e);
    } finally {
      setUploading(false);
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
    }
  };

  // ── Voice playback ────────────────────────────────────────────────────

  const handlePlayVoice = useCallback(async (message: Message) => {
    if (playingVoiceId === message.id) {
      await playbackRef.current?.pauseAsync();
      setPlayingVoiceId(null);
      return;
    }

    await playbackRef.current?.unloadAsync();

    const url = message.mediaUrl;
    if (!url) {
      Alert.alert('Error', 'Audio file not available');
      return;
    }

    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true },
      );
      playbackRef.current = sound;
      setPlayingVoiceId(message.id);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          setPlayingVoiceId(null);
        }
      });
    } catch (e) {
      console.error('[ChatRoom] Voice playback failed:', e);
      Alert.alert('Error', 'Could not play voice message');
    }
  }, [playingVoiceId]);

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

  // ── Reaction handler ─────────────────────────────────────────────────────

  const handleReaction = async (emoji: string) => {
    if (!reactionMsg) return;
    const targetMsg = reactionMsg; // capture for rollback
    try {
      await firestore()
        .collection('chats').doc(chat.id)
        .collection('messages').doc(reactionMsg.id)
        .update({
          [`reactions.${currentUser?.uid}`]: emoji,
        });
      // Optimistically update local state
      setMessages(prev => prev.map(m =>
        m.id === targetMsg.id
          ? { ...m, reactions: { ...m.reactions, [currentUser?.uid || '']: emoji } }
          : m
      ));
    } catch (e) {
      console.warn('[Chat] Reaction failed:', e?.message || e);
      // No rollback needed — the UI shows picker state, not a local reaction
    }
    setReactionMsg(null);
  };

  // ── Delete message handler ──────────────────────────────────────────────
  const handleDeleteMessage = useCallback(async (mode: 'me' | 'everyone') => {
    if (!contextMsg || !chat?.id) return;
    try {
      await deleteMessage(chat.id, contextMsg.id, mode);
      if (mode === 'me') {
        setMessages(prev => prev.filter(m => m.id !== contextMsg.id));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === contextMsg.id ? { ...m, deleted: true, content: '', mediaUrl: null, messageType: 'text', reactions: {} } : m
        ));
      }
    } catch (e: any) {
      Alert.alert('Error', 'Failed to delete message');
    }
    setContextMsg(null);
  }, [contextMsg, chat?.id]);

  return {
    chat,
    messages,
    loading,
    text,
    setText,
    sending,
    uploading,
    showMenu,
    setShowMenu,
    showAttachMenu,
    setShowAttachMenu,
    showNuclearConfirm,
    setShowNuclearConfirm,
    blocking,
    replyTo,
    setReplyTo,
    fullscreenImage,
    setFullscreenImage,
    reactionMsg,
    setReactionMsg,
    contextMsg,
    setContextMsg,
    isRecording,
    recordingDuration,
    playingVoiceId,
    handleSend,
    handlePickImage,
    handleCamera,
    handleOpenGifPicker,
    handleStartVoiceRecord,
    handleStopVoiceRecord,
    handlePlayVoice,
    handleReaction,
    handleDeleteMessage,
    handleNuclearBlock,
    flatRef,
  };
}
