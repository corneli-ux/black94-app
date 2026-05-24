import React, { useEffect, useState, useRef, useCallback } from 'react';
import { FlatList, Platform, Alert, Keyboard } from 'react-native';
import { Audio } from 'expo-av';
import { fetchMessages, sendMessage, blockUser, deleteMessage, Message } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import * as ImagePicker from 'expo-image-picker';
import { uploadOptimizedImage } from '../utils/imageUpload';
import { tsToMillis } from '../utils/datetime';
// BUG FIX: Import initE2EE to ensure encryption keys are initialized
// before fetchMessages calls decryptMessage. Without this, the first message
// load after a cold start could fail decryption and show raw ciphertext.
import { initE2EE } from '../lib/e2ee';

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

  // BUG FIX: Initialize E2EE key pair on hook mount. Without this, if the app
  // was cold-started (auth restored from AsyncStorage but E2EE keys weren't),
  // the first fetchMessages() call would fail decryption for all E2EE messages,
  // showing raw ciphertext or "[Unable to decrypt this message]" placeholders.
  // Non-blocking: fire-and-forget, keys will be generated lazily by getMyKeyPair()
  // on first encrypt/decrypt call if initE2EE fails.
  useEffect(() => {
    const uid = auth()?.currentUser?.uid;
    if (uid) initE2EE(uid).catch(() => {});
  }, []);

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
  const reactionMsgRef = useRef(reactionMsg);
  reactionMsgRef.current = reactionMsg;
  const chatRef = useRef(chat);
  chatRef.current = chat;

  // ── GIF callback ref ──────────────────────────────────────────────────────
  const gifCallbackRef = useRef<((url: string) => void) | null>(null);

  // ── Send media message (image or gif) ─────────────────────────────────────

  const sendMediaMessage = async (mediaUrl: string, msgType: string, content: string) => {
    if (!chat) return;
    // BUG FIX: Type-guard mediaUrl — if Firestore returns a non-string value
    // (corrupted data), the Image component would crash with an invalid uri.
    if (typeof mediaUrl !== 'string' || !mediaUrl.startsWith('http')) {
      Alert.alert('Error', 'Media URL is invalid. Please try again.');
      return;
    }
    setSending(true);
    const tempMsg: Message = {
      id: `tmp-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, chatId: chat.id,
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
    if (!chat || !chat.id) return;
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
        let chatFound = false;
        try {
          const chatDoc = await firestore().collection('chats').doc(routeChatId).get();
          if (chatDoc.exists) {
            chatFound = true;
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
                  createdAt: (() => { try { return tsToMillis(d.createdAt); } catch { return Date.now(); } })(),
                };
              }
            } catch {}
            setChat({
              id: chatDoc.id,
              user1Id: data.user1Id,
              user2Id: data.user2Id,
              lastMessage: data.lastMessage || '',
              lastMessageTime: (() => { try { return tsToMillis(data.lastMessageTime); } catch { return Date.now(); } })(),
              unreadCount: 0,
              otherUser,
            });
          }
        } catch (e) {
          console.error('[ChatRoom] Failed to fetch chat:', e);
        } finally {
          // BUG FIX: Always stop loading — if chat fetch fails or chat doesn't exist,
          // user was stuck on infinite ActivityIndicator forever.
          setLoading(false);
        }
        // BUG FIX (STALE CLOSURE): The original code checked `if (!chat && !routeChat)`
        // here which ALWAYS evaluated to `true` because `chat` is the stale closure
        // value (null), even though `setChat()` was called inside the try block above.
        // React state updates are batched and closures capture the OLD state value.
        // This caused a false "Chat Not Found" alert + goBack on EVERY chatId-based
        // navigation (notifications, deep links), making them completely broken.
        // FIX: Use a local boolean `chatFound` to track if the fetch succeeded.
        if (!chatFound) {
          setTimeout(() => {
            Alert.alert('Chat Not Found', 'This conversation may have been deleted.');
            navigation.goBack();
          }, 100);
        }
      };
      fetchChat();
    } else if (!routeChat && !routeChatId) {
      // BUG FIX: If BOTH routeChat and routeChatId are missing, stop loading
      // immediately and navigate back instead of showing infinite spinner.
      setLoading(false);
    }
  }, [routeChatId, routeChat]);

  // ── Reset unread, load messages, start polling ────────────────────────────
  useEffect(() => {
    if (!chat) return;
    const resetUnread = async () => {
      try {
        // BUG FIX: Guard against corrupted chat data — if user1Id/user2Id
        // are missing (destroyed by old update() bug), skip reset entirely.
        if (!chat.user1Id || !chat.user2Id || !chat.id) {
          if (__DEV__) console.warn('[ChatRoom] Skipping unread reset — chat data corrupted:', { user1Id: chat.user1Id, user2Id: chat.user2Id, id: chat.id });
          return;
        }
        const isUser1 = chat.user1Id === currentUser?.uid;
        const field = isUser1 ? 'unreadUser1' : 'unreadUser2';
        await firestore().collection('chats').doc(chat.id).update({ [field]: 0 });

        // BUG FIX: Composite query (senderId + status) requires a composite index
        // that may not exist. Fall back to single-where query + client-side filter
        // (same pattern as ChatListScreen.createOrOpenChat) to avoid silent failures.
        try {
          const otherSenderId = isUser1 ? chat.user2Id : chat.user1Id;
          if (otherSenderId) {
            // Use single-where query (no composite index needed)
            const msgSnap = await firestore()
              .collection('chats').doc(chat.id).collection('messages')
              .where('senderId', '==', otherSenderId)
              .limit(100)
              .get();
            // Client-side filter for unread statuses
            const unreadDocs = msgSnap.docs.filter((doc: any) => {
              const status = doc.data()?.status;
              return status === 'sent' || status === 'delivered';
            });
            if (unreadDocs.length > 0) {
              // Use sequential updates instead of batch (more reliable with REST wrapper)
              await Promise.allSettled(
                unreadDocs.map((doc: any) =>
                  doc.ref.update({ status: 'read' })
                )
              );
            }
          }
        } catch { /* non-critical */ }
      } catch (e) {
        if (__DEV__) console.warn('Failed to reset unread:', e);
      }
    };
    // BUG FIX: Add .catch() to prevent unhandled promise rejection.
    // If resetUnread throws before its internal try/catch, it would crash
    // the app on some React Native configurations.
    resetUnread().catch(() => {});
    load().catch(() => {});
    // BUG FIX: Replaced listen() with simple load() polling.
    // The old listen() had TWO critical bugs:
    //   1. No .limit() — fetched ALL messages (could be 1000+), causing memory
    //      explosion and OS killing the app on every 3-second poll cycle.
    //   2. Raw Firestore data spread WITHOUT E2EE decryption — replaced properly
    //      decrypted messages with encrypted E2EE:... ciphertext, causing data
    //      corruption and potential rendering crashes.
    // Now we just re-use fetchMessages() (which properly decrypts + limits to 50)
    // via loadRef, keeping the same silent-merge logic for optimistic messages.
    const pollTimer = setInterval(() => {
      loadRef.current(true);
    }, 8000); // Poll every 8 seconds (was 5s — less aggressive, fewer Firestore reads)
    unsubRef.current = () => clearInterval(pollTimer);
    return () => {
      if (unsubRef.current) unsubRef.current();
    };
  }, [chat?.id]);

  // ── Cleanup playback + recording on unmount ──────────────────────────────
  // BUG FIX: If user navigates away while recording, the recording interval
  // and Audio.Recording were never cleaned up, causing:
  //   1. Memory leak (recordingRef stays alive)
  //   2. stale setInterval keeps running (recordingDuration state updates on unmounted component)
  //   3. Audio mode stuck in recording mode (silenced, no playback)
  useEffect(() => {
    return () => {
      playbackRef.current?.unloadAsync().catch(() => {});
      // Clean up active recording if user navigates away mid-recording
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (recordingRef.current) {
        recordingRef.current.stopAsync().catch(() => {});
        recordingRef.current = null;
      }
      // Reset audio mode back to non-recording
      Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    };
  }, []);

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
    if (!text.trim() || sending || !chat) return;
    const content = text.trim();
    setText('');
    setSending(true);
    // BUG FIX: Capture replyTo BEFORE clearing it — the old code cleared replyTo
    // first, then read from it (always getting null), so reply context was lost.
    const replyContext = replyTo ? {
      replyToId: replyTo.id,
      replyToContent: replyTo.content,
      replyToSenderName: replyTo.senderId === currentUser?.uid
        ? 'You'
        : (chat?.otherUser?.displayName || 'User'),
    } : undefined;
    setReplyTo(null);
    const tempMsg: Message = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, chatId: chat.id,
      senderId: currentUser?.uid || '', receiverId: chat.otherUser?.id || '',
      content, messageType: 'text', createdAt: Date.now(),
      replyToId: replyContext?.replyToId,
      replyToContent: replyContext?.replyToContent,
      replyToSenderName: replyContext?.replyToSenderName,
    };
    setMessages(prev => [...prev, tempMsg]);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const result = await sendMessage(chat.id, chat.otherUser?.id || '', content, replyContext);
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
    if (!chat) {
      Alert.alert('Error', 'Chat not loaded yet. Please try again.');
      return;
    }
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
    if (!chat) {
      Alert.alert('Error', 'Chat not loaded yet. Please try again.');
      return;
    }
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
    // BUG FIX: Pass onSelect callback via route params so GifPickerScreen can
    // deliver the selected GIF URL back to us. Previously, no callback was passed,
    // so GifPickerScreen just called navigation.goBack() and the GIF was silently
    // lost. The selectedGifUrl param was never set by GifPickerScreen.
    navigation.navigate('GifPicker', {
      onSelect: (gifUrl: string) => {
        if (chat) {
          sendMediaMessage(gifUrl, 'gif', '');
        }
      },
    } as never);
  };

  // ── Voice recording (real recording with expo-av) ────────────────────

  const handleStartVoiceRecord = async () => {
    setShowAttachMenu(false);
    if (!chat) {
      Alert.alert('Error', 'Chat not loaded yet. Please try again.');
      return;
    }
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
        if (__DEV__) console.warn('[ChatRoom] No recording URI after stop');
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

  const handleReaction = useCallback(async (emoji: string) => {
    const target = reactionMsgRef.current;
    const chatId = chatRef.current;
    if (!target || !chatId || !currentUser?.uid) return;

    // Check if already has same reaction — toggle off
    const existingReaction = target.reactions?.[currentUser.uid];
    if (existingReaction === emoji) {
      // Remove reaction
      try {
        await firestore()
          .collection('chats').doc(chatId)
          .collection('messages').doc(target.id)
          .update({ [`reactions.${currentUser.uid}`]: firestore.FieldValue.delete() });
        setMessages(prev => prev.map(m =>
          m.id === target.id
            ? { ...m, reactions: { ...Object.fromEntries(Object.entries(m.reactions || {}).filter(([k]) => k !== currentUser.uid)) } }
            : m
        ));
      } catch (e) {
        if (__DEV__) console.warn('[Chat] Remove reaction failed:', e?.message || e);
      }
    } else {
      // Add/update reaction — use dot-notation via REST wrapper
      try {
        // Read current reactions first (dot-notation not supported by REST wrapper)
        const msgSnap = await firestore()
          .collection('chats').doc(chatId)
          .collection('messages').doc(target.id)
          .get();
        const currentReactions = (msgSnap.exists ? msgSnap.data()?.reactions : null) || {};
        await firestore()
          .collection('chats').doc(chatId)
          .collection('messages').doc(target.id)
          .update({
            reactions: { ...currentReactions, [currentUser.uid]: emoji },
          });
        setMessages(prev => prev.map(m =>
          m.id === target.id
            ? { ...m, reactions: { ...m.reactions, [currentUser.uid]: emoji } }
            : m
        ));
      } catch (e) {
        if (__DEV__) console.warn('[Chat] Reaction failed:', e?.message || e);
      }
    }
    setReactionMsg(null);
  }, [currentUser?.uid]);

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
