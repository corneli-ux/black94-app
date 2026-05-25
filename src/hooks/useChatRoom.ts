import React, { useEffect, useState, useRef, useCallback } from 'react';
import { FlatList, Platform, Alert, Keyboard } from 'react-native';
import { fetchMessages, sendMessage, blockUser, deleteMessage, Message } from '../lib/api';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis } from '../utils/datetime';

// ── LAZY NATIVE MODULES ─────────────────────────────────────────────────────
// These are loaded ONLY when the user actually uses the feature.
// A broken native module (New Arch compat issue, etc.) won't crash chat.
let Audio: any = null;
async function getAudio() {
  if (!Audio) {
    try {
      const mod = await import('expo-av');
      Audio = mod.Audio;
    } catch {
      Alert.alert('Error', 'Audio module not available.');
    }
  }
  return Audio;
}
let ImagePickerModule: any = null;
async function getImagePicker() {
  if (!ImagePickerModule) {
    try {
      ImagePickerModule = await import('expo-image-picker');
    } catch {
      Alert.alert('Error', 'Image picker not available.');
    }
  }
  return ImagePickerModule;
}
let _uploadModule: any = null;
async function getUploadOptimizedImage() {
  if (!_uploadModule) {
    try {
      _uploadModule = await import('../utils/imageUpload');
    } catch { /* non-critical */ }
  }
  return (_uploadModule as any)?.uploadOptimizedImage || null;
}

// ── Types ────────────────────────────────────────────────────────────────────
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

// ── SAFE FETCH WITH TIMEOUT ──────────────────────────────────────────────────
// Prevents Firestore fetch from hanging forever on bad connections.
async function safeFetch<T>(fn: () => Promise<T>, timeoutMs = 10000): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
    ),
  ]);
}

// ── HOOK ─────────────────────────────────────────────────────────────────────
export function useChatRoom({
  routeChat,
  routeChatId,
  shareMessage,
  routeParams,
  navigation,
}: UseChatRoomParams): UseChatRoomReturn {
  // ── Core state ──────────────────────────────────────────────────────────
  const [chat, setChat] = useState(routeChat || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState(shareMessage || '');
  const [loading, setLoading] = useState(!routeChat);

  // ── UI state ───────────────────────────────────────────────────────────
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showNuclearConfirm, setShowNuclearConfirm] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [reactionMsg, setReactionMsg] = useState<Message | null>(null);
  const [contextMsg, setContextMsg] = useState<Message | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);

  // ── Refs ────────────────────────────────────────────────────────────────
  const flatRef = useRef<FlatList>(null);
  const currentUser = auth()?.currentUser;
  const reactionMsgRef = useRef(reactionMsg);
  reactionMsgRef.current = reactionMsg;
  const chatRef = useRef(chat);
  chatRef.current = chat;

  // ── SINGLE INIT: fetch chat by chatId if not passed via route ──────────
  useEffect(() => {
    if (routeChatId && !routeChat) {
      let cancelled = false;
      const fetchChat = async () => {
        try {
          const chatDoc = await safeFetch(() =>
            firestore().collection('chats').doc(routeChatId).get()
          );
          if (cancelled) return;
          if (!chatDoc.exists) {
            setTimeout(() => {
              Alert.alert('Chat Not Found', 'This conversation may have been deleted.');
              navigation.goBack();
            }, 100);
            return;
          }
          const data = chatDoc.data();
          const otherId = data.user1Id === currentUser?.uid ? data.user2Id : data.user1Id;

          // Fetch other user profile
          let otherUser: any = null;
          if (otherId) {
            try {
              const otherSnap = await safeFetch(() =>
                firestore().collection('users').doc(otherId).get()
              );
              if (otherSnap.exists) {
                const d = otherSnap.data();
                otherUser = {
                  id: otherId, email: d.email || '', username: d.username || '',
                  displayName: d.displayName || '', bio: d.bio || '',
                  profileImage: typeof d.profileImage === 'string' ? d.profileImage : null,
                  coverImage: typeof d.coverImage === 'string' ? d.coverImage : null,
                  role: d.role || 'personal', badge: d.badge || '',
                  subscription: d.subscription || 'free', isVerified: d.isVerified || false,
                  createdAt: (() => { try { return tsToMillis(d.createdAt); } catch { return Date.now(); } })(),
                };
              }
            } catch { /* profile fetch failed, chat still works */ }
          }

          if (cancelled) return;
          setChat({
            id: chatDoc.id,
            user1Id: data.user1Id,
            user2Id: data.user2Id,
            lastMessage: data.lastMessage || '',
            lastMessageTime: (() => { try { return tsToMillis(data.lastMessageTime); } catch { return Date.now(); } })(),
            unreadCount: 0,
            otherUser,
          });
        } catch (e) {
          if (__DEV__) console.error('[ChatRoom] Failed to fetch chat:', e);
        } finally {
          setLoading(false);
        }
      };
      fetchChat();
      return () => { cancelled = true; };
    } else if (!routeChat && !routeChatId) {
      setLoading(false);
    }
  }, [routeChatId, routeChat]);

  // ── SINGLE INIT: load messages + reset unread (ONE effect, not 6) ───────
  // REBUILD: Consolidates all the old separate effects into a single
  // well-ordered init function. The old code had 6+ competing useEffects
  // that could fire simultaneously, each doing Firestore operations.
  // This caused a "request storm" that crashed the JS thread.
  useEffect(() => {
    if (!chat?.id) return;
    let cancelled = false;

    const init = async () => {
      try {
        // Step 1: Reset unread count (single API call, fire-and-forget style but awaited)
        try {
          if (chat.user1Id && chat.user2Id) {
            const isUser1 = chat.user1Id === currentUser?.uid;
            const field = isUser1 ? 'unreadUser1' : 'unreadUser2';
            await safeFetch(() =>
              firestore().collection('chats').doc(chat.id).update({ [field]: 0 })
            );
          }
        } catch (e) {
          if (__DEV__) console.warn('[ChatRoom] Unread reset failed:', e?.message);
        }

        if (cancelled) return;

        // Step 2: Load messages (single API call + E2EE decryption)
        try {
          const msgs = await safeFetch(() =>
            fetchMessages(chat.id, 50, currentUser?.uid, chat.otherUser?.id)
          );
          if (cancelled) return;
          setMessages(msgs);
          setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 150);
        } catch (e) {
          if (__DEV__) console.error('[ChatRoom] Load messages failed:', e);
          // Don't crash — show empty chat
          setMessages([]);
        }

        // Step 3: Mark as read (NON-BLOCKING, single batch query, NO sequential updates)
        // CRITICAL FIX: The old code did up to 50 sequential PATCH updates to mark
        // messages as 'read'. Each one called _getValidToken() → fetch(). On expired
        // tokens, this caused a request storm that crashed the JS thread.
        // NEW: Just update the chat's unread count (already done in Step 1).
        // Individual message status updates are best-effort, done silently in the background.
        if (!cancelled && chat.user1Id && chat.user2Id) {
          const otherId = chat.user1Id === currentUser?.uid ? chat.user2Id : chat.user1Id;
          // Fire-and-forget: fetch unread messages and mark as read
          // This runs in the background and doesn't block chat loading
          safeFetch(() => {
            return firestore()
              .collection('chats').doc(chat.id).collection('messages')
              .where('senderId', '==', otherId)
              .where('status', 'in', ['sent', 'delivered'])
              .limit(10)
              .get();
          }).then(async (snap) => {
            if (cancelled) return;
            // Mark as read — but only first 10 (not 50 like before)
            // and we don't await them all sequentially
            const docs = (snap?.docs || []).slice(0, 10);
            for (const doc of docs) {
              if (cancelled) break;
              try {
                await doc.ref.update({ status: 'read' });
              } catch { /* skip */ }
            }
          }).catch(() => { /* completely non-blocking */ });
        }
      } catch (e) {
        if (__DEV__) console.error('[ChatRoom] Init error:', e);
      } finally {
        setLoading(false);
      }
    };

    init();

    // Step 4: Poll for new messages (8s interval)
    const pollTimer = setInterval(() => {
      if (!cancelled && chatRef.current?.id) {
        fetchMessages(chatRef.current.id, 50, currentUser?.uid, chatRef.current.otherUser?.id)
          .then((msgs) => {
            if (cancelled) return;
            setMessages(prev => {
              const serverIds = new Set(msgs.map(m => m.id));
              const stillPending = prev.filter(
                m => m.id.startsWith('tmp-') && !serverIds.has(m.id)
              );
              return [...stillPending, ...msgs];
            });
          })
          .catch(() => { /* polling error — non-fatal */ });
      }
    }, 8000);

    // Navigation focus listener
    const unsubscribe = navigation.addListener('focus', () => {
      if (!cancelled && chatRef.current?.id) {
        fetchMessages(chatRef.current.id, 50, currentUser?.uid, chatRef.current.otherUser?.id)
          .then((msgs) => {
            if (cancelled) return;
            setMessages(prev => {
              const serverIds = new Set(msgs.map(m => m.id));
              const stillPending = prev.filter(
                m => m.id.startsWith('tmp-') && !serverIds.has(m.id)
              );
              return [...stillPending, ...msgs];
            });
          })
          .catch(() => {});
      }
    });

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      unsubscribe();
    };
  }, [chat?.id]);

  // ── Keyboard scroll ────────────────────────────────────────────────────
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, () => {
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
    });
    return () => sub.remove();
  }, []);

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef<any>(null);
  const playbackRef = useRef<any>(null);
  useEffect(() => {
    return () => {
      playbackRef.current?.unloadAsync().catch(() => {});
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      if (recordingRef.current) { recordingRef.current.stopAsync().catch(() => {}); recordingRef.current = null; }
      getAudio().then(A => { if (A) A.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {}); }).catch(() => {});
    };
  }, []);

  // ── GIF callback handler ──────────────────────────────────────────────
  useEffect(() => {
    if (!chat) return;
    const gifUrl = routeParams?.selectedGifUrl;
    if (gifUrl && typeof gifUrl === 'string' && gifUrl.startsWith('http')) {
      navigation.setParams({ selectedGifUrl: undefined });
      sendMediaMessage(gifUrl, 'gif', '');
    }
  }, [routeParams?.selectedGifUrl, chat?.id]);

  // ── Send media message ──────────────────────────────────────────────────
  const sendMediaMessage = async (mediaUrl: string, msgType: string, content: string) => {
    if (!chat) return;
    if (typeof mediaUrl !== 'string' || !mediaUrl.startsWith('http')) {
      Alert.alert('Error', 'Media URL is invalid.');
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
    } catch (e) {
      if (__DEV__) console.error('[ChatRoom] Media send failed:', e);
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
      Alert.alert('Send Failed', 'Could not send. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // ── Send text message ──────────────────────────────────────────────────
  const handleSend = async () => {
    if (!text.trim() || sending || !chat) return;
    const content = text.trim();
    setText('');
    setSending(true);

    // Capture replyTo BEFORE clearing
    const replyContext = replyTo ? {
      replyToId: replyTo.id,
      replyToContent: replyTo.content,
      replyToSenderName: replyTo.senderId === currentUser?.uid
        ? 'You' : (chat?.otherUser?.displayName || 'User'),
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
      if (result && !result.sent) {
        setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
        setText(content);
        Alert.alert('Send Failed', result.reason || 'Message could not be delivered.');
      }
    } catch (e) {
      if (__DEV__) console.error('[ChatRoom] Send failed:', e);
      setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
      setText(content);
    } finally {
      setSending(false);
    }
  };

  // ── Pick image ──────────────────────────────────────────────────────────
  const handlePickImage = async () => {
    setShowAttachMenu(false);
    if (!chat) { Alert.alert('Error', 'Chat not loaded yet.'); return; }
    try {
      const IP = await getImagePicker();
      if (!IP) return;
      const { status } = await IP.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission Required', 'Please allow photo library access.'); return; }
      const result = await IP.launchImageLibraryAsync({
        mediaTypes: IP.MediaTypeOptions.Images, quality: 0.7, allowsMultipleSelection: false, maxWidth: 1200,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      setUploading(true);
      const storagePath = `chats/${chat.id}/${Date.now()}_${asset.fileName || 'photo.jpg'}`;
      const uploadFn = await getUploadOptimizedImage();
      if (!uploadFn) { Alert.alert('Error', 'Image upload not available.'); return; }
      const uploadResult = await uploadFn(asset.uri, storagePath, { mimeType: asset.mimeType || 'image/jpeg' });
      await sendMediaMessage(uploadResult.downloadUrl, 'image', '');
    } catch (err: any) {
      if (__DEV__) console.error('[ChatRoom] Image send error:', err);
      Alert.alert('Upload Failed', err.message || 'Could not upload image.');
    } finally {
      setUploading(false);
    }
  };

  // ── Camera ──────────────────────────────────────────────────────────────
  const handleCamera = async () => {
    setShowAttachMenu(false);
    if (!chat) { Alert.alert('Error', 'Chat not loaded yet.'); return; }
    try {
      const IP = await getImagePicker();
      if (!IP) return;
      const { status } = await IP.requestCameraPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission Required', 'Camera access needed.'); return; }
      const result = await IP.launchCameraAsync({
        mediaTypes: IP.MediaTypeOptions.Images, quality: 0.7, allowsMultipleSelection: false, maxWidth: 1200,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      setUploading(true);
      const storagePath = `chats/${chat.id}/${Date.now()}_camera.jpg`;
      const uploadFn = await getUploadOptimizedImage();
      if (!uploadFn) { Alert.alert('Error', 'Image upload not available.'); return; }
      const uploadResult = await uploadFn(asset.uri, storagePath, { mimeType: asset.mimeType || 'image/jpeg' });
      await sendMediaMessage(uploadResult.downloadUrl, 'image', '');
    } catch (err: any) {
      if (__DEV__) console.error('[ChatRoom] Camera error:', err);
      Alert.alert('Upload Failed', err.message || 'Could not upload photo.');
    } finally {
      setUploading(false);
    }
  };

  // ── GIF picker ──────────────────────────────────────────────────────────
  const handleOpenGifPicker = () => {
    setShowAttachMenu(false);
    navigation.navigate('GifPicker', {
      onSelect: (gifUrl: string) => {
        if (chat) sendMediaMessage(gifUrl, 'gif', '');
      },
    } as never);
  };

  // ── Voice recording ─────────────────────────────────────────────────────
  const handleStartVoiceRecord = async () => {
    setShowAttachMenu(false);
    if (!chat) { Alert.alert('Error', 'Chat not loaded yet.'); return; }
    try {
      const AudioMod = await getAudio();
      if (!AudioMod) return;
      await AudioMod.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await AudioMod.Recording.createAsync(AudioMod.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => setRecordingDuration(prev => prev + 1), 1000);
    } catch (e) {
      if (__DEV__) console.error('[ChatRoom] Failed to start recording:', e);
      Alert.alert('Error', 'Could not start voice recording.');
    }
  };

  const handleStopVoiceRecord = async () => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    const duration = recordingDuration;
    setIsRecording(false);
    setRecordingDuration(0);
    if (duration < 1) { try { await recordingRef.current?.stopAsync(); } catch {} recordingRef.current = null; return; }
    try {
      await recordingRef.current?.stopAsync();
      const uri = recordingRef.current?.getURI();
      recordingRef.current = null;
      if (!uri) return;
      setUploading(true);
      const fileName = `voice_${Date.now()}.m4a`;
      const storagePath = `chats/${chat.id}/${fileName}`;
      let audioUrl = '';
      try {
        const uploadFn = await getUploadOptimizedImage();
        if (!uploadFn) return;
        const uploadResult = await uploadFn(uri, storagePath, { mimeType: 'audio/mp4', skipImageValidation: true });
        audioUrl = uploadResult.downloadUrl;
      } catch { /* upload failed */ }
      if (!audioUrl) { Alert.alert('Upload Failed', 'Could not upload voice message.'); return; }
      await sendMessage(chat.id, chat.otherUser?.id || '', '', { messageType: 'voice', mediaUrl: audioUrl, voiceDuration: duration });
    } catch (e) {
      if (__DEV__) console.error('[ChatRoom] Voice send failed:', e);
    } finally {
      setUploading(false);
      try { const A = await getAudio(); if (A) await A.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
    }
  };

  // ── Voice playback ──────────────────────────────────────────────────────
  const handlePlayVoice = useCallback(async (message: Message) => {
    if (playingVoiceId === message.id) {
      await playbackRef.current?.pauseAsync();
      setPlayingVoiceId(null);
      return;
    }
    await playbackRef.current?.unloadAsync();
    const url = message.mediaUrl;
    if (!url) { Alert.alert('Error', 'Audio file not available'); return; }
    try {
      const AudioMod = await getAudio();
      if (!AudioMod) return;
      await AudioMod.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await AudioMod.Sound.createAsync({ uri: url }, { shouldPlay: true });
      playbackRef.current = sound;
      setPlayingVoiceId(message.id);
      sound.setOnPlaybackStatusUpdate((status: any) => { if (status.didJustFinish) setPlayingVoiceId(null); });
    } catch (e) {
      if (__DEV__) console.error('[ChatRoom] Voice playback failed:', e);
    }
  }, [playingVoiceId]);

  // ── Nuclear Block ──────────────────────────────────────────────────────
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
        Alert.alert('Error', 'Failed to block user.');
      }
    } catch { Alert.alert('Error', 'Failed to block user.'); }
    finally { setBlocking(false); }
  };

  // ── Reaction handler ────────────────────────────────────────────────────
  const handleReaction = useCallback(async (emoji: string) => {
    const target = reactionMsgRef.current;
    const chatId = chatRef.current?.id;
    if (!target || !chatId || !currentUser?.uid) return;
    try {
      const msgSnap = await firestore().collection('chats').doc(chatId).collection('messages').doc(target.id).get();
      const currentReactions = (msgSnap.exists ? msgSnap.data()?.reactions : null) || {};
      if (currentReactions[currentUser.uid] === emoji) {
        delete currentReactions[currentUser.uid];
      } else {
        currentReactions[currentUser.uid] = emoji;
      }
      await firestore().collection('chats').doc(chatId).collection('messages').doc(target.id).update({ reactions: currentReactions });
      setMessages(prev => prev.map(m =>
        m.id === target.id ? { ...m, reactions: { ...Object.fromEntries(Object.entries(m.reactions || {}).filter(([k]) => k !== currentUser.uid)), ...(currentReactions[currentUser.uid] ? { [currentUser.uid]: emoji } : {}) } } : m
      ));
    } catch (e) {
      if (__DEV__) console.warn('[Chat] Reaction failed:', e?.message);
    }
    setReactionMsg(null);
  }, [currentUser?.uid]);

  // ── Delete message ─────────────────────────────────────────────────────
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
    } catch { Alert.alert('Error', 'Failed to delete message'); }
    setContextMsg(null);
  }, [contextMsg, chat?.id]);

  return {
    chat, messages, loading, text, setText,
    sending, uploading, showMenu, setShowMenu,
    showAttachMenu, setShowAttachMenu,
    showNuclearConfirm, setShowNuclearConfirm,
    blocking, replyTo, setReplyTo,
    fullscreenImage, setFullscreenImage,
    reactionMsg, setReactionMsg,
    contextMsg, setContextMsg,
    isRecording, recordingDuration, playingVoiceId,
    handleSend, handlePickImage, handleCamera,
    handleOpenGifPicker, handleStartVoiceRecord,
    handleStopVoiceRecord, handlePlayVoice,
    handleReaction, handleDeleteMessage,
    handleNuclearBlock, flatRef,
  };
}
