import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image, ActivityIndicator, Alert, Modal, Keyboard } from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { colors } from '../theme/colors';
import { fetchMessages, sendMessage, blockUser, deleteMessage, Message } from '../lib/api';
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
  const shareMessage = route.params?.shareMessage || null;
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
  }, [route.params?.selectedGifUrl, chat?.id]);

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
      if (silent) {
        // Merge: keep temp messages that haven't appeared in server results yet
        const serverIds = new Set(msgs.map(m => m.id));
        const pendingTemps = messages.filter(m => m.id.startsWith('tmp-') && !serverIds.has(m.id));
        // Also remove temp messages whose content now appears in a server message
        const serverContents = new Set(msgs.map(m => m.content));
        const stillPending = pendingTemps.filter(tmp => !serverContents.has(tmp.content));
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
  }, [chat?.id, messages]);

  useEffect(() => {
    if (!chat) return;
    const resetUnread = async () => {
      try {
        const isUser1 = chat.user1Id === currentUser?.uid;
        const field = isUser1 ? 'unreadUser1' : 'unreadUser2';
        await firestore().collection('chats').doc(chat.id).update({ [field]: 0 });

        // Mark messages from the other user as 'delivered' and 'read'
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
      await sendMessage(chat.id, chat.otherUser?.id || '', content, {
        replyToId: replyTo?.id || undefined,
        replyToContent: replyTo?.content || undefined,
        replyToSenderName: replyTo?.senderId === currentUser?.uid
          ? 'You'
          : (chat?.otherUser?.displayName || 'User'),
      });
      setReplyTo(null);
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
    navigation.navigate('GifPicker');
    // GIF result is picked up via the focus listener below (route.params.selectedGifUrl)
  };

  // ── Voice recording (real recording with expo-av) ────────────────────

  const recordingRef = useRef<Audio.Recording | null>(null);

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
      // Upload the audio file to Firebase Storage-like path
      const fileName = `voice_${Date.now()}.m4a`;
      const response = await FileSystem.uploadAsync(uri, `https://firebasestorage.googleapis.com/v0/b/black94-a8f2f.appspot.com/o/chat_audio%2F${fileName}`, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'file',
      }).catch(() => null);

      let audioUrl = '';
      if (response && response.status === 200) {
        try {
          const body = JSON.parse(response.body);
          audioUrl = `https://firebasestorage.googleapis.com/v0/b/black94-a8f2f.appspot.com/o/chat_audio%2F${fileName}?alt=media&token=${body.downloadTokens?.[fileName] || ''}`;
        } catch {}
      }

      // If upload fails, still send the message with the local URI for testing
      const finalUrl = audioUrl || uri;
      await sendMessage(chat.id, chat.otherUser?.id || '', '', {
        messageType: 'voice',
        mediaUrl: finalUrl,
        voiceDuration: duration,
      });
      await load(true);
    } catch (e) {
      console.error('[ChatRoom] Voice send failed:', e);
    } finally {
      setUploading(false);
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
    }
  };

  // ── Voice playback ────────────────────────────────────────────────────

  const handlePlayVoice = useCallback(async (message: Message) => {
    // If already playing this message, pause it
    if (playingVoiceId === message.id) {
      await playbackRef.current?.pauseAsync();
      setPlayingVoiceId(null);
      return;
    }

    // Stop any currently playing audio
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

  // ── Render message bubble ─────────────────────────────────────────────────

  const handleReaction = async (emoji: string) => {
    if (!reactionMsg) return;
    try {
      await firestore()
        .collection('chats').doc(chat.id)
        .collection('messages').doc(reactionMsg.id)
        .update({
          [`reactions.${currentUser?.uid}`]: emoji,
        });
    } catch {}
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

  const renderMessage = ({ item }: { item: Message }) => {
    const isMine = item.senderId === currentUser?.uid;
    const msgType = item.messageType || 'text';
    const myReaction = item.reactions?.[currentUser?.uid || ''] || null;
    const reactionEntries = item.reactions ? Object.values(item.reactions) as string[] : [];

    // Deleted message placeholder
    if (item.deleted) {
      return (
        <View style={[styles.msgRow, isMine ? styles.msgRowRight : styles.msgRowLeft]}>
          {!isMine && <Avatar uri={chat?.otherUser?.profileImage} name={chat?.otherUser?.displayName} size={28} />}
          <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs, styles.deletedBubble]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="ban-outline" size={14} color={isMine ? 'rgba(0,0,0,0.35)' : '#4a5568'} />
              <Text style={[styles.bubbleText, isMine ? { color: 'rgba(0,0,0,0.35)' } : { color: '#4a5568' }, { fontStyle: 'italic' }]}>
                This message was deleted
              </Text>
            </View>
            <Text style={[styles.bubbleTime, isMine ? { color: 'rgba(0,0,0,0.3)' } : { color: '#4a5568' }]}>
              {formatTime(item.createdAt)}
            </Text>
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.msgRow, isMine ? styles.msgRowRight : styles.msgRowLeft]}>
        {!isMine && <Avatar uri={chat?.otherUser?.profileImage} name={chat?.otherUser?.displayName} size={28} />}
        <TouchableOpacity
          onLongPress={() => {
            if (isMine) {
              setContextMsg(item);
            } else {
              setReactionMsg(item);
            }
          }}
          onPress={() => {
            if (msgType === 'text') setReplyTo(item);
          }}
          activeOpacity={1}
          style={{ maxWidth: '80%' }}
        >
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {/* Image message */}
          {msgType === 'image' && item.mediaUrl ? (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => setFullscreenImage(item.mediaUrl)}
            >
              <Image
                source={{ uri: item.mediaUrl }}
                style={styles.bubbleImage}
                resizeMode="cover"
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

          {/* Voice message */}
          {msgType === 'voice' && (
            <TouchableOpacity
              style={styles.voiceBubble}
              onPress={() => handlePlayVoice(item)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={playingVoiceId === item.id ? 'pause-circle' : 'play-circle'}
                size={36}
                color={isMine ? '#000000' : '#e7e9ea'}
              />
              <View style={styles.voiceWaveform}>
                <View style={[styles.voiceBar, isMine ? { backgroundColor: 'rgba(0,0,0,0.3)' } : { backgroundColor: 'rgba(255,255,255,0.3)' }]} />
                <View style={[styles.voiceBar, isMine ? { backgroundColor: 'rgba(0,0,0,0.5)' } : { backgroundColor: 'rgba(255,255,255,0.5)' }]} />
                <View style={[styles.voiceBar, isMine ? { backgroundColor: 'rgba(0,0,0,0.3)' } : { backgroundColor: 'rgba(255,255,255,0.3)' }]} />
                <View style={[styles.voiceBar, isMine ? { backgroundColor: 'rgba(0,0,0,0.6)' } : { backgroundColor: 'rgba(255,255,255,0.6)' }]} />
                <View style={[styles.voiceBar, isMine ? { backgroundColor: 'rgba(0,0,0,0.2)' } : { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
              </View>
              <Text style={[styles.voiceDuration, isMine ? { color: 'rgba(0,0,0,0.6)' } : { color: '#94a3b8' }]}>
                {item.voiceDuration || 0}s
              </Text>
            </TouchableOpacity>
          )}

          {/* Text content (for text messages or captions) */}
          {item.content && msgType === 'text' ? (
            <Text style={[styles.bubbleText, isMine && { color: '#000000' }]}>{item.content}</Text>
          ) : null}

          {/* Timestamp */}
          <Text style={[styles.bubbleTime, isMine ? { color: 'rgba(0,0,0,0.5)' } : { color: '#94a3b8' }]}>
            {formatTime(item.createdAt)}
          </Text>
          {/* Read receipt indicators — own messages only */}
          {isMine && (
            <View style={styles.receiptRow}>
              {item.status === 'read' ? (
                <Ionicons name="checkmark-done" size={14} color="#38bdf8" />
              ) : item.status === 'delivered' ? (
                <Ionicons name="checkmark-done" size={14} color="rgba(0,0,0,0.3)" />
              ) : (
                <Ionicons name="checkmark" size={14} color="rgba(0,0,0,0.3)" />
              )}
            </View>
          )}
          {/* Reactions display */}
          {reactionEntries.length > 0 && (
            <View style={styles.reactionBadge}>
              <Text style={styles.reactionText}>{reactionEntries.join('')}</Text>
            </View>
          )}
          {/* Reply indicator */}
          {item.replyToContent && (
            <View style={styles.replyIndicator}>
              <Text style={styles.replyIndicatorName}>{item.replyToSenderName || 'Reply'}</Text>
              <Text style={styles.replyIndicatorText} numberOfLines={1}>{item.replyToContent}</Text>
            </View>
          )}
        </View>
        </TouchableOpacity>
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

        {/* Call button — hidden until VoIP SDK integration is complete */}

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

      {/* Reply preview */}
      {replyTo && (
        <View style={styles.replyPreview}>
          <View style={styles.replyPreviewLine} />
          <View style={styles.replyPreviewContent}>
            <Text style={styles.replyPreviewName}>
              {replyTo.senderId === currentUser?.uid ? 'You' : (chat?.otherUser?.displayName || 'User')}
            </Text>
            <Text style={styles.replyPreviewText} numberOfLines={1}>
              {replyTo.content || (replyTo.messageType === 'voice' ? 'Voice message' : replyTo.messageType === 'image' ? 'Photo' : 'GIF')}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8}>
            <Ionicons name="close" size={16} color="#94a3b8" />
          </TouchableOpacity>
        </View>
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
            <TouchableOpacity style={styles.attachItem} onPress={handleStartVoiceRecord} activeOpacity={0.7}>
              <View style={[styles.attachIcon, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
                <Ionicons name="mic-outline" size={22} color="#EF4444" />
              </View>
              <Text style={styles.attachLabel}>Voice</Text>
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

      {/* Message Context Menu (delete for me / everyone) — own messages only */}
      <Modal visible={!!contextMsg} transparent animationType="fade" onRequestClose={() => setContextMsg(null)}>
        <TouchableOpacity style={styles.reactionModalOverlay} activeOpacity={1} onPress={() => setContextMsg(null)}>
          <View style={styles.contextMenu}>
            <TouchableOpacity
              style={styles.contextMenuItem}
              onPress={() => {
                setContextMsg(null);
                setReactionMsg(contextMsg!);
              }}
            >
              <Ionicons name="happy-outline" size={20} color="#e7e9ea" />
              <Text style={styles.contextMenuText}>React</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.contextMenuItem}
              onPress={() => {
                if (contextMsg) {
                  setReplyTo(contextMsg);
                  setContextMsg(null);
                }
              }}
            >
              <Ionicons name="return-down-left" size={20} color="#e7e9ea" />
              <Text style={styles.contextMenuText}>Reply</Text>
            </TouchableOpacity>
            <View style={styles.contextMenuDivider} />
            <TouchableOpacity
              style={[styles.contextMenuItem, { opacity: 0.7 }]}
              onPress={() => handleDeleteMessage('me')}
            >
              <Ionicons name="trash-outline" size={20} color="#e7e9ea" />
              <Text style={styles.contextMenuText}>Delete for Me</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.contextMenuItem, { opacity: 0.9 }]}
              onPress={() => {
                Alert.alert(
                  'Delete for Everyone',
                  'This message will be deleted for all participants. This cannot be undone.',
                  [
                    { text: 'Cancel', style: 'cancel', onPress: () => setContextMsg(null) },
                    { text: 'Delete', style: 'destructive', onPress: () => handleDeleteMessage('everyone') },
                  ],
                );
              }}
            >
              <Ionicons name="trash" size={20} color="#f43f5e" />
              <Text style={[styles.contextMenuText, { color: '#f43f5e' }]}>Delete for Everyone</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Emoji Reaction Picker Modal */}
      <Modal visible={!!reactionMsg} transparent animationType="fade" onRequestClose={() => setReactionMsg(null)}>
        <TouchableOpacity style={styles.reactionModalOverlay} activeOpacity={1} onPress={() => setReactionMsg(null)}>
          <View style={styles.reactionPicker}>
            {['👍', '❤️', '😂', '😮', '😢', '🔥'].map(emoji => (
              <TouchableOpacity key={emoji} style={styles.reactionEmojiBtn} onPress={() => handleReaction(emoji)}>
                <Text style={styles.reactionEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Full-screen image viewer */}
      <Modal visible={!!fullscreenImage} transparent animationType="fade" onRequestClose={() => setFullscreenImage(null)}>
        <TouchableOpacity
          style={styles.imageViewerOverlay}
          activeOpacity={1}
          onPress={() => setFullscreenImage(null)}
        >
          <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            {fullscreenImage ? (
              <Image
                source={{ uri: fullscreenImage }}
                style={styles.fullscreenImage}
                resizeMode="contain"
              />
            ) : null}
            <TouchableOpacity style={styles.imageViewerClose} onPress={() => setFullscreenImage(null)} hitSlop={16}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </SafeAreaView>
        </TouchableOpacity>
      </Modal>

      {/* Recording overlay */}
      {isRecording && (
        <View style={styles.recordingOverlay}>
          <View style={styles.recordingContent}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>Recording...</Text>
            <Text style={styles.recordingDuration}>{recordingDuration}s</Text>
            <TouchableOpacity
              style={styles.recordingStopBtn}
              onPress={handleStopVoiceRecord}
              activeOpacity={0.7}
            >
              <Ionicons name="stop-circle" size={48} color="#f43f5e" />
            </TouchableOpacity>
            <Text style={styles.recordingHint}>Tap to stop</Text>
          </View>
        </View>
      )}
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
  bubbleTime: { fontSize: 11, marginTop: 4, marginRight: 2 },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 2,
  },
  reactionBadge: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  reactionText: { fontSize: 14 },
  reactionModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reactionPicker: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 24,
    padding: 8,
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  reactionEmojiBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reactionEmoji: { fontSize: 28 },
  // ── Context Menu (delete) ──
  contextMenu: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    paddingVertical: 8,
    width: 220,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  contextMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  contextMenuText: {
    fontSize: 15,
    color: '#e7e9ea',
  },
  contextMenuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginHorizontal: 12,
    marginVertical: 4,
  },
  deletedBubble: {
    opacity: 0.6,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  // ── Full-screen image viewer ──
  imageViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  fullscreenImage: {
    width: '100%',
    height: '100%',
  },
  imageViewerClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
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
  // ── Voice message ──
  voiceBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  voiceWaveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 28,
  },
  voiceBar: {
    width: 3,
    height: '100%',
    borderRadius: 2,
  },
  voiceDuration: {
    fontSize: 12,
    fontWeight: '500',
  },
  // ── Recording overlay ──
  recordingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 200,
  },
  recordingContent: {
    alignItems: 'center',
    gap: 12,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#f43f5e',
  },
  recordingText: {
    color: '#e7e9ea',
    fontSize: 16,
    fontWeight: '600',
  },
  recordingDuration: {
    color: '#94a3b8',
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  recordingStopBtn: {
    marginTop: 12,
  },
  recordingHint: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 4,
  },
  // ── Reply preview ──
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    marginHorizontal: 10,
  },
  replyPreviewLine: {
    width: 2,
    height: '100%',
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.accent,
  },
  replyPreviewContent: {
    flex: 1,
    marginLeft: 4,
    gap: 2,
  },
  replyPreviewName: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  replyPreviewText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  replyIndicator: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 4,
  },
  replyIndicatorName: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  replyIndicatorText: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
});
