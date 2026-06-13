/**
 * AnonymousChatScreen.tsx — Omegle-style anonymous chat via Firestore
 *
 * States: Landing → Searching → Connected
 *
 * ALL data is real Firestore — NO mocks, NO simulations, NO hardcoded replies.
 * Uses polling (Firestore REST API has no onSnapshot) for:
 *   - Queue matching (every 2s)
 *   - New messages (every 1.5s)
 *   - Typing indicator (every 3s)
 *
 * Firestore collections:
 *   anonQueue   — users waiting to be matched
 *   anonRooms   — active chat rooms (doc ID = sorted userId pair)
 *   anonMessages — messages within a room
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Animated,
  Easing,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { firestore, auth } from '../lib/firebase';
import { encryptMessage, decryptMessage, initE2EE } from '../lib/e2ee';
import { colors } from '../theme/colors';
import { tokens } from '../theme/tokens';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../stores/app';
import { AppIcon } from '../components/icons';
import { Button, Card } from '../components/ui';

// ── Types ──────────────────────────────────────────────────────────────────

type ChatState = 'landing' | 'searching' | 'connected';

interface AnonMessage {
  id: string;
  content: string;
  senderId: string;
  senderName: string;
  createdAt: string;
}

interface QueueEntry {
  userId: string;
  anonymousName: string;
  status: 'waiting' | 'matched';
  partnerId: string | null;
  createdAt: string;
}

interface RoomData {
  roomId: string;
  partnerId: string;
  partnerName: string;
  myName: string;
  createdAt: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const QUEUE_POLL_INTERVAL = 2000;
const MSG_POLL_INTERVAL = 1500;
const TYPING_POLL_INTERVAL = 3000;
const QUEUE_TTL_SECONDS = 60;
const NO_ONE_ONLINE_TIMEOUT = 30;

const ANON_CHAT_UNAVAILABLE_MSG = 'Could not connect to matching server. Please try again in a moment.';

const ADJECTIVES = ['Shadow', 'Mystic', 'Cosmic', 'Neon', 'Phantom', 'Blaze', 'Frost', 'Storm', 'Pixel', 'Ember', 'Drift', 'Haze', 'Nova', 'Cryptic', 'Silent'];
const NOUNS = ['Wolf', 'Fox', 'Eagle', 'Lynx', 'Raven', 'Hawk', 'Panther', 'Cobra', 'Tiger', 'Phoenix', 'Orca', 'Viper', 'Ghost', 'Sage', 'Flux'];

// ── Helpers ────────────────────────────────────────────────────────────────

function generateAnonymousName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 999) + 1;
  return `${adj}_${noun}${num}`;
}

function buildRoomId(uid1: string, uid2: string): string {
  const sorted = [uid1, uid2].sort();
  return `${sorted[0]}_${sorted[1]}`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function isStale(createdAt: string, maxAgeMs: number): boolean {
  try { return Date.now() - new Date(createdAt).getTime() > maxAgeMs; } catch { return true; }
}

function nowISO(): string { return new Date().toISOString(); }

// ── Component ──────────────────────────────────────────────────────────────

export default function AnonymousChatScreen() {
  const [chatState, setChatState] = useState<ChatState>('landing');
  const [messages, setMessages] = useState<AnonMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [myName] = useState(() => generateAnonymousName());
  const [room, setRoom] = useState<RoomData | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const [searchElapsed, setSearchElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [anonChatCount, setAnonChatCount] = useState<number | null>(null);

  const myUserId = auth().currentUser?.uid ?? '';
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queuePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const mountedRef = useRef(true);
  const lastMsgTimestampRef = useRef<string | null>(null);
  const roomRef = useRef<RoomData | null>(null);

  useEffect(() => { if (myUserId) initE2EE(myUserId).catch(() => {}); }, [myUserId]);

  const { user } = useAppStore();
  const navigation = useNavigation();

  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (!myUserId) return;
    firestore().collection('users').doc(myUserId).get()
      .then(doc => setAnonChatCount(doc.exists ? (doc.data()?.anon_chat_count ?? 0) : 0))
      .catch(() => setAnonChatCount(0));
  }, [myUserId]);

  const startConnectionTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    timerRef.current = setInterval(() => { if (mountedRef.current) setElapsed(prev => prev + 1); }, 1000);
  }, []);

  const stopConnectionTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const stopSearchTimer = useCallback(() => {
    if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
  }, []);

  const startSearchTimer = useCallback(() => {
    stopSearchTimer();
    searchTimerRef.current = setInterval(() => {
      if (mountedRef.current) setSearchElapsed(prev => {
        const next = prev + 1;
        if (next === NO_ONE_ONLINE_TIMEOUT) setError('No one is online right now. Keep waiting or try again later.');
        return next;
      });
    }, 1000);
  }, [stopSearchTimer]);

  const stopAllPolling = useCallback(() => {
    [queuePollRef, msgPollRef, typingPollRef].forEach(ref => { if (ref.current) { clearInterval(ref.current); ref.current = null; } });
    if (typingDebounceRef.current) { clearTimeout(typingDebounceRef.current); typingDebounceRef.current = null; }
  }, []);

  const deleteOwnQueueEntry = useCallback(async () => {
    if (!myUserId) return;
    try { await firestore().collection('anonQueue').doc(myUserId).delete(); }
    catch (e: any) { if (__DEV__) console.warn('[AnonChat] Failed to delete queue entry:', e?.message); }
  }, [myUserId]);

  const updateRoomActivity = useCallback(async (roomId: string) => {
    try { await firestore().collection('anonRooms').doc(roomId).update({ lastActivity: nowISO() }); }
    catch (e: any) { if (__DEV__) console.warn('[AnonChat] Failed to update room activity:', e?.message); }
  }, []);

  const incrementAnonChatCount = useCallback(async () => {
    if (!myUserId) return;
    try {
      await firestore().collection('users').doc(myUserId).update({ anon_chat_count: firestore.FieldValue.increment(1) });
      setAnonChatCount(prev => (prev ?? 0) + 1);
    } catch (e: any) { if (__DEV__) console.warn('[AnonChat] Failed to increment chat count:', e?.message); }
  }, [myUserId]);

  const setMyTypingState = useCallback(async (roomId: string, typing: boolean) => {
    try {
      const currentRoom = roomRef.current;
      if (!currentRoom) return;
      const updateData: Record<string, any> = {};
      if (currentRoom.partnerId === myUserId) updateData.user2Typing = typing;
      else updateData.user1Typing = typing;
      await firestore().collection('anonRooms').doc(roomId).update(updateData);
    } catch (e: any) { if (__DEV__) console.warn('[AnonChat] Failed to update typing state:', e?.message); }
  }, [myUserId]);

  const startMessagePolling = useCallback((roomId: string) => {
    if (msgPollRef.current) { clearInterval(msgPollRef.current); msgPollRef.current = null; }
    const poll = async () => {
      if (!mountedRef.current) return;
      try {
        const snapshot = await firestore().collection('anonMessages').where('roomId', '==', roomId).orderBy('createdAt', 'asc').limit(100).get();
        if (!snapshot.empty && mountedRef.current) {
          const newMessages: AnonMessage[] = await Promise.all(
            snapshot.docs.map(async doc => {
              const data = doc.data();
              const rawContent = data.content || '';
              const senderId = data.senderId || '';
              let content: string;
              try {
                const decrypted = await decryptMessage(rawContent, senderId);
                content = decrypted ?? '[Unable to decrypt this message]';
              } catch {
                content = rawContent.startsWith('E2EE:') ? '[Unable to decrypt this message]' : rawContent;
              }
              return { id: doc.id, content, senderId, senderName: data.senderName || 'Stranger', createdAt: data.createdAt || '' };
            }),
          );
          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const trulyNew = newMessages.filter(m => !existingIds.has(m.id));
            if (trulyNew.length === 0) return prev;
            return [...prev, ...trulyNew];
          });
          const latestTimestamp = newMessages[newMessages.length - 1]?.createdAt;
          if (latestTimestamp) lastMsgTimestampRef.current = latestTimestamp;
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        }
      } catch (e: any) { if (__DEV__) console.warn('[AnonChat] Message poll error:', e?.message); }
    };
    poll();
    msgPollRef.current = setInterval(poll, MSG_POLL_INTERVAL);
  }, []);

  const startTypingPolling = useCallback((roomId: string) => {
    if (typingPollRef.current) { clearInterval(typingPollRef.current); typingPollRef.current = null; }
    const poll = async () => {
      if (!mountedRef.current) return;
      try {
        const doc = await firestore().collection('anonRooms').doc(roomId).get();
        if (doc.exists) {
          const data = doc.data();
          const currentRoom = roomRef.current;
          if (!currentRoom) return;
          const partnerTyping = currentRoom.partnerId === myUserId ? data?.user1Typing === true : data?.user2Typing === true;
          if (mountedRef.current) setIsPartnerTyping(partnerTyping);
        }
      } catch (e: any) { if (__DEV__) console.warn('[AnonChat] Typing poll error:', e?.message); }
    };
    typingPollRef.current = setInterval(poll, TYPING_POLL_INTERVAL);
  }, [myUserId]);

  const pollQueue = useCallback(async () => {
    if (!myUserId || !mountedRef.current) return;
    try {
      const db = firestore();
      const myQueueDoc = await db.collection('anonQueue').doc(myUserId).get();
      if (myQueueDoc.exists) {
        const myData = myQueueDoc.data();
        if (myData?.status === 'matched' && myData?.partnerId) {
          const partnerId = myData.partnerId;
          const roomId = buildRoomId(myUserId, partnerId);
          const roomDoc = await db.collection('anonRooms').doc(roomId).get();
          let partnerName = 'Stranger';
          if (roomDoc.exists) {
            const roomData = roomDoc.data();
            partnerName = roomData?.user1Id === myUserId ? roomData?.user2Name || 'Stranger' : roomData?.user1Name || 'Stranger';
          }
          await deleteOwnQueueEntry();
          if (queuePollRef.current) { clearInterval(queuePollRef.current); queuePollRef.current = null; }
          stopSearchTimer();
          const newRoom: RoomData = { roomId, partnerId, partnerName, myName, createdAt: roomDoc.exists ? (roomDoc.data()?.createdAt || nowISO()) : nowISO() };
          if (mountedRef.current) {
            setRoom(newRoom); roomRef.current = newRoom;
            setMessages([]); lastMsgTimestampRef.current = null;
            setChatState('connected'); setElapsed(0);
            startConnectionTimer(); startMessagePolling(newRoom.roomId); startTypingPolling(newRoom.roomId); incrementAnonChatCount();
          }
          return;
        }
      }
      const snapshot = await db.collection('anonQueue').where('status', '==', 'waiting').get();
      if (!snapshot.empty) {
        const candidates = snapshot.docs.filter(doc => doc.id !== myUserId && doc.data().status === 'waiting' && !isStale(doc.data().createdAt, QUEUE_TTL_SECONDS * 1000));
        if (candidates.length > 0) {
          const partner = candidates.reduce((oldest, current) => (oldest.data().createdAt || '') < (current.data().createdAt || '') ? oldest : current);
          const partnerData = partner.data();
          const partnerId = partner.id;
          const partnerName = partnerData.anonymousName || 'Stranger';
          const roomId = buildRoomId(myUserId, partnerId);
          await db.collection('anonRooms').doc(roomId).set({ user1Id: myUserId, user2Id: partnerId, user1Name: myName, user2Name: partnerName, createdAt: nowISO(), lastActivity: nowISO(), user1Typing: false, user2Typing: false });
          try { await db.collection('anonQueue').doc(partnerId).update({ status: 'matched', partnerId: myUserId }); } catch (e: any) { if (__DEV__) console.warn('[AnonChat] Failed to mark partner as matched:', e?.message); }
          try { await db.collection('anonQueue').doc(myUserId).update({ status: 'matched', partnerId }); } catch (e: any) { if (__DEV__) console.warn('[AnonChat] Failed to mark self as matched:', e?.message); }
          await deleteOwnQueueEntry();
          if (queuePollRef.current) { clearInterval(queuePollRef.current); queuePollRef.current = null; }
          stopSearchTimer();
          const newRoom: RoomData = { roomId, partnerId, partnerName, myName, createdAt: nowISO() };
          if (mountedRef.current) {
            setRoom(newRoom); roomRef.current = newRoom;
            setMessages([]); lastMsgTimestampRef.current = null;
            setChatState('connected'); setElapsed(0);
            startConnectionTimer(); startMessagePolling(newRoom.roomId); startTypingPolling(newRoom.roomId); incrementAnonChatCount();
          }
        }
      }
    } catch (e: any) { if (__DEV__) console.warn('[AnonChat] Queue poll error:', e?.message); }
  }, [myUserId, myName, deleteOwnQueueEntry, stopSearchTimer, startConnectionTimer, startMessagePolling, startTypingPolling, incrementAnonChatCount]);

  const fullCleanup = useCallback(async () => {
    stopConnectionTimer(); stopSearchTimer(); stopAllPolling();
    await deleteOwnQueueEntry();
    const currentRoom = roomRef.current;
    if (currentRoom?.roomId) { await updateRoomActivity(currentRoom.roomId); await setMyTypingState(currentRoom.roomId, false); }
    roomRef.current = null; lastMsgTimestampRef.current = null;
  }, [stopConnectionTimer, stopSearchTimer, stopAllPolling, deleteOwnQueueEntry, updateRoomActivity, setMyTypingState]);

  const joinQueue = useCallback(async () => {
    setError(null); setChatState('searching'); setMessages([]); setRoom(null); roomRef.current = null;
    setElapsed(0); setSearchElapsed(0); setIsPartnerTyping(false); lastMsgTimestampRef.current = null;
    try {
      await firestore().collection('anonQueue').doc(myUserId).set({ userId: myUserId, anonymousName: myName, status: 'waiting', partnerId: null, createdAt: nowISO() });
      startSearchTimer();
      if (queuePollRef.current) clearInterval(queuePollRef.current);
      queuePollRef.current = setInterval(pollQueue, QUEUE_POLL_INTERVAL);
      pollQueue();
    } catch (e: any) {
      console.error('[AnonChat] Failed to join queue:', e?.message);
      setError(ANON_CHAT_UNAVAILABLE_MSG); setChatState('landing');
    }
  }, [myUserId, myName, pollQueue, startSearchTimer]);

  const handleFindStranger = useCallback(async () => {
    if (!myUserId) { setError('You must be signed in to use anonymous chat.'); return; }
    const ageVerified = await AsyncStorage.getItem('@black94/age_verified');
    if (ageVerified !== 'true') {
      Alert.alert('Age Verification Required',
        'Anonymous chat is only available for users aged 18 and over. Please confirm your age to continue.',
        [{ text: 'Cancel', style: 'cancel' },
         { text: 'I am 18 or older', style: 'default', onPress: async () => {
           await AsyncStorage.setItem('@black94/age_verified', 'true').catch(() => {});
           joinQueue();
         }}]);
      return;
    }
    joinQueue();
  }, [myUserId, joinQueue]);

  const handleDisconnect = useCallback(async () => {
    await fullCleanup();
    if (mountedRef.current) { setChatState('landing'); setMessages([]); setRoom(null); setElapsed(0); setIsPartnerTyping(false); setError(null); }
  }, [fullCleanup]);

  const handleNext = useCallback(async () => {
    await fullCleanup();
    if (mountedRef.current) joinQueue();
  }, [fullCleanup, joinQueue]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !room?.roomId || !myUserId) return;
    const content = text;
    setInputText('');
    if (typingDebounceRef.current) { clearTimeout(typingDebounceRef.current); typingDebounceRef.current = null; }
    await setMyTypingState(room.roomId, false);
    try {
      const otherId = room.partnerId;
      let storedContent: string;
      if (otherId) {
        try {
          const encrypted = await encryptMessage(content, myUserId, otherId);
          storedContent = encrypted || '[Encryption not ready]';
        } catch { storedContent = '[Encryption not ready]'; }
      } else {
        setError('Encryption not ready. Please wait for partner to connect.'); setInputText(content); return;
      }
      await firestore().collection('anonMessages').add({ roomId: room.roomId, senderId: myUserId, senderName: myName, content: storedContent, createdAt: nowISO() });
      await updateRoomActivity(room.roomId);
    } catch (e: any) {
      console.error('[AnonChat] Failed to send message:', e?.message);
      setError('Could not send message. Please try again.'); setInputText(content);
    }
  }, [inputText, room, myUserId, myName, setMyTypingState, updateRoomActivity]);

  const handleInputChange = useCallback((text: string) => {
    setInputText(text);
    if (text.trim() && room?.roomId) {
      setMyTypingState(room.roomId, true);
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
      typingDebounceRef.current = setTimeout(() => { if (room.roomId) setMyTypingState(room.roomId, false); }, 3000);
    } else if (!text.trim() && room?.roomId) {
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
      setMyTypingState(room.roomId, false);
    }
  }, [room, setMyTypingState]);

  useEffect(() => {
    if (chatState !== 'landing') { pulseAnim.stopAnimation(); return; }
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.05, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 0.95, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [chatState, pulseAnim]);

  useEffect(() => { return () => { mountedRef.current = false; fullCleanup(); }; /* eslint-disable-next-line */ }, []);

  const strangerName = room?.partnerName || '';

  const renderMessage = ({ item }: { item: AnonMessage }) => {
    const isMine = item.senderId === myUserId;
    return (
      <View style={[styles.msgWrapper, isMine ? styles.msgMine : styles.msgTheirs]}>
        {!isMine && <Text style={styles.msgSenderName}>{item.senderName}</Text>}
        <Text style={styles.minimalMsgText}>{item.content}</Text>
      </View>
    );
  };

  // ── Render: Sign-in required ────────────────────────────────────────────
  if (!myUserId) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.landingContainer}>
          <View style={styles.landingIcon}><AppIcon name="visibility-off" size={64} color={colors.accent} /></View>
          <Text style={styles.landingTitle}>Anonymous Chat</Text>
          <Card style={styles.infoBanner}>
            <AppIcon name="info-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.infoText}>You must be signed in to use anonymous chat.</Text>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  if (anonChatCount === null) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.landingContainer}><ActivityIndicator size="large" color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  const isSubscribed = user?.subscription === 'premium' || user?.subscription === 'business';
  const canUseAnonChat = isSubscribed || anonChatCount < 10;

  // ── Render: Paywall ─────────────────────────────────────────────────────
  if (!canUseAnonChat) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.paywallContainer}>
          <View style={styles.paywallIconWrap}><AppIcon name="visibility-off" size={56} color={colors.accent} /></View>
          <Text style={styles.paywallTitle}>Free Chats Used</Text>
          <Text style={styles.paywallSubtitle}>You've used your 10 free anonymous chats. Upgrade to Premium or Business for unlimited anonymous chats.</Text>
          <View style={styles.paywallBenefits}>
            {['Connect with random people anonymously', 'Your identity is always hidden', 'Real-time typing indicators', 'Instant matching'].map(b => (
              <View key={b} style={styles.paywallBenefitRow}>
                <AppIcon name="check-circle" size={20} color={colors.accent} />
                <Text style={styles.paywallBenefitText}>{b}</Text>
              </View>
            ))}
          </View>
          <Button variant="primary" size="lg" label="Upgrade to Premium"
            leftIcon={<AppIcon name="diamond" size={20} color={colors.white} />}
            onPress={() => navigation.navigate('PremiumDashboard' as never)}
            style={{ width: '100%', marginBottom: tokens.spacing[4] }}
          />
          <Button variant="ghost" size="md" label="Maybe Later"
            onPress={() => navigation.goBack()}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ── Render: Landing ─────────────────────────────────────────────────────
  if (chatState === 'landing') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.landingContainer}>
          <View style={styles.landingIcon}><AppIcon name="visibility-off" size={64} color={colors.accent} /></View>
          <Text style={styles.landingTitle}>Anonymous Chat</Text>
          <Text style={styles.landingSubtitle}>Connect with random people anonymously. Your identity is hidden.</Text>
          <Card style={styles.safetyBanner}>
            <AppIcon name="verified-user" size="sm" color={colors.accentGold} />
            <Text style={styles.safetyBannerText}>Anonymous chat is for users aged 18+. Be respectful. Inappropriate behaviour will be reported and may result in a ban.</Text>
          </Card>
          <Text style={styles.yourNameLabel}>Your anonymous name:</Text>
          <Card style={styles.nameTag}>
            <AppIcon name="alternate-email" size={16} color={colors.accent} />
            <Text style={styles.nameTagText}>{myName}</Text>
          </Card>
          {error && (
            <Card style={styles.infoBanner}>
              <AppIcon name="info-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.infoText}>{error}</Text>
            </Card>
          )}
          <Animated.View style={[styles.findBtn, { transform: [{ scale: pulseAnim }] }]}>
            <Button variant="primary" size="lg" label="Find Stranger"
              leftIcon={<AppIcon name="flash-on" size="xl" color={colors.white} />}
              onPress={handleFindStranger}
            />
          </Animated.View>
          <Text style={styles.disclaimerText}>By continuing, you agree to be respectful to others.</Text>
          <Text style={styles.safetyNoteText}>Tap the Report button during any chat to report abuse. All chats are end-to-end encrypted.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render: Searching ───────────────────────────────────────────────────
  if (chatState === 'searching') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.searchContainer}>
          <Text style={styles.searchYourName}>@{myName}</Text>
          <ActivityIndicator size="large" color={colors.accent} style={{ marginBottom: tokens.spacing[5] }} />
          <Text style={styles.searchingText}>Finding someone...</Text>
          <Text style={styles.searchingSubtext}>
            {searchElapsed > 0 ? `Waiting for ${formatDuration(searchElapsed)}...` : 'Please wait while we connect you with a stranger'}
          </Text>
          {error && (
            <Card style={styles.infoBanner}>
              <AppIcon name="info-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.infoText}>{error}</Text>
            </Card>
          )}
          <Button variant="ghost" size="md" label="Cancel"
            leftIcon={<AppIcon name="close" size="md" color={colors.textSecondary} />}
            onPress={handleDisconnect}
            style={{ borderWidth: 1, borderColor: colors.border }}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ── Render: Connected (Chat) ────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.chatContainer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
        {/* Header */}
        <View style={styles.chatHeader}>
          <View style={styles.chatHeaderInfo}>
            <View style={styles.anonAvatar}><AppIcon name="visibility-off" size="md" color={colors.white} /></View>
            <View>
              <Text style={styles.chatHeaderName}>{strangerName || 'Stranger'}</Text>
              <View style={styles.chatHeaderMeta}>
                <View style={styles.onlineDot} />
                <Text style={styles.chatHeaderText}>{isPartnerTyping ? 'typing...' : 'Anonymous'}</Text>
              </View>
            </View>
          </View>
          <View style={styles.timerBadge}>
            <AppIcon name="schedule" size="sm" color={colors.textSecondary} />
            <Text style={styles.timerText}>{formatDuration(elapsed)}</Text>
          </View>
          <TouchableOpacity
            style={styles.reportBtn}
            onPress={() => {
              Alert.alert('Report User', 'If this user is behaving inappropriately, you can report them. This will disconnect the chat and submit a report.',
                [{ text: 'Cancel', style: 'cancel' },
                 { text: 'Report & Disconnect', style: 'destructive', onPress: async () => {
                   try {
                     if (room?.roomId) await firestore().collection('reports').add({ type: 'anonymous_chat', roomId: room.roomId, reporterId: myUserId, reportedId: room.partnerId, createdAt: nowISO(), status: 'pending' });
                   } catch (e: any) { if (__DEV__) console.warn('[AnonChat] Report failed:', e?.message); }
                   await fullCleanup();
                   if (mountedRef.current) { setChatState('landing'); setMessages([]); setRoom(null); setElapsed(0); setIsPartnerTyping(false); setError('Report submitted. Thank you for keeping the community safe.'); }
                 }}]);
            }}
            hitSlop={8} activeOpacity={0.7}>
            <AppIcon name="outlined-flag" size="md" color={colors.error} />
          </TouchableOpacity>
        </View>

        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.msgList}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyMsg}>
              <AppIcon name="forum" size={40} color={colors.textMuted} />
              <Text style={styles.emptyMsgText}>Say something to start the conversation!</Text>
            </View>
          }
        />

        {isPartnerTyping && (
          <View style={styles.typingRow}>
            <View style={styles.typingBubble}>
              <View style={styles.typingDot} />
              <View style={[styles.typingDot, { opacity: 0.6 }]} />
              <View style={[styles.typingDot, { opacity: 0.3 }]} />
            </View>
          </View>
        )}

        {error && (
          <View style={styles.errorBannerInline}>
            <AppIcon name="error-outline" size="sm" color={colors.error} />
            <Text style={styles.errorTextInline}>{error}</Text>
          </View>
        )}

        {/* Input + actions */}
        <View style={styles.inputArea}>
          <View style={styles.actionBtns}>
            <Button variant="ghost" size="sm" label="Next"
              leftIcon={<AppIcon name="play-forward-outline" size={20} color={colors.accent} />}
              onPress={handleNext}
              style={styles.nextBtn}
            />
            <Button variant="destructive" size="sm" label="Disconnect"
              leftIcon={<AppIcon name="close" size={20} color={colors.white} />}
              onPress={handleDisconnect}
            />
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Type a message..."
              placeholderTextColor={colors.textMuted}
              value={inputText}
              onChangeText={handleInputChange}
              onSubmitEditing={handleSend}
              multiline
              maxLength={500}
              returnKeyType="send"
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!inputText.trim()}>
              <AppIcon name="send" size={20} color={colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  landingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: tokens.spacing[8] },
  landingIcon: { width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(42,127,255,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: tokens.spacing[6] },
  landingTitle: { fontSize: tokens.typography.size['2xl'], fontWeight: '800', color: colors.text, marginBottom: tokens.spacing[2] },
  landingSubtitle: { fontSize: tokens.typography.size.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: tokens.spacing[8] },
  yourNameLabel: { fontSize: tokens.typography.size.sm, color: colors.textMuted, marginBottom: tokens.spacing[2] },
  nameTag: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing[1] + 2, paddingHorizontal: tokens.spacing[4], paddingVertical: tokens.spacing[2] + 2, borderRadius: tokens.radius.full, borderColor: colors.accent, marginBottom: tokens.spacing[4] },
  nameTagText: { fontSize: tokens.typography.size.base, fontWeight: '600', color: colors.accent },

  paywallContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: tokens.spacing[8] },
  paywallIconWrap: { width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(42,127,255,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: tokens.spacing[6] },
  paywallTitle: { fontSize: tokens.typography.size['2xl'], fontWeight: '800', color: colors.text, marginBottom: tokens.spacing[2] },
  paywallSubtitle: { fontSize: tokens.typography.size.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: tokens.spacing[7] },
  paywallBenefits: { width: '100%', gap: tokens.spacing[3] + 2, marginBottom: tokens.spacing[8] },
  paywallBenefitRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing[2] + 2 },
  paywallBenefitText: { fontSize: tokens.typography.size.base, color: colors.text, flexShrink: 1 },

  infoBanner: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing[2], paddingHorizontal: tokens.spacing[3] + 2, paddingVertical: tokens.spacing[2] + 2, marginBottom: tokens.spacing[6], width: '100%' },
  infoText: { fontSize: tokens.typography.size.sm, color: colors.textSecondary, flexShrink: 1 },
  errorBannerInline: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing[1] + 2, backgroundColor: colors.destructiveFaint, paddingHorizontal: tokens.spacing[3], paddingVertical: tokens.spacing[1] + 2, marginHorizontal: tokens.spacing[3], borderRadius: tokens.radius.sm + 2 },
  errorTextInline: { fontSize: tokens.typography.size.xs, color: colors.error },

  findBtn: { width: '100%', marginTop: tokens.spacing[2] },
  disclaimerText: { fontSize: tokens.typography.size.xs, color: colors.textMuted, textAlign: 'center', marginTop: tokens.spacing[5], lineHeight: 16 },
  safetyNoteText: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: tokens.spacing[1] + 2, lineHeight: 15, paddingHorizontal: tokens.spacing[5] },
  safetyBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.spacing[2], marginHorizontal: tokens.spacing[6], paddingVertical: tokens.spacing[2] + 2, paddingHorizontal: tokens.spacing[3], borderColor: colors.accentBgStrong, marginTop: tokens.spacing[3], marginBottom: tokens.spacing[6] },
  safetyBannerText: { flex: 1, fontSize: tokens.typography.size.xs, color: colors.textSecondary, lineHeight: 17 },
  reportBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.destructiveFaint, alignItems: 'center', justifyContent: 'center' },

  searchContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: tokens.spacing[8] },
  searchYourName: { fontSize: tokens.typography.size.sm, color: colors.textMuted, marginBottom: tokens.spacing[10] },
  searchingText: { fontSize: tokens.typography.size.xl, fontWeight: '600', color: colors.text, marginBottom: tokens.spacing[2] },
  searchingSubtext: { fontSize: tokens.typography.size.sm, color: colors.textMuted, textAlign: 'center', marginBottom: tokens.spacing[10] },

  chatContainer: { flex: 1 },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: tokens.spacing[4], paddingVertical: tokens.spacing[3], borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceCard },
  chatHeaderInfo: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing[2] + 2 },
  anonAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  chatHeaderName: { fontSize: tokens.typography.size.base, fontWeight: '600', color: colors.text },
  chatHeaderMeta: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing[1], marginTop: 1 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentGreen },
  chatHeaderText: { fontSize: tokens.typography.size.xs, color: colors.textMuted },
  timerBadge: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing[1], backgroundColor: colors.surfaceElevated, paddingHorizontal: tokens.spacing[2] + 2, paddingVertical: tokens.spacing[1] + 1, borderRadius: tokens.radius.sm + 2 },
  timerText: { fontSize: tokens.typography.size.sm, fontWeight: '600', color: colors.textSecondary, fontVariant: ['tabular-nums'] as any },

  msgList: { padding: tokens.spacing[3], paddingBottom: tokens.spacing[1] },
  msgWrapper: { marginBottom: tokens.spacing[2], maxWidth: '80%' },
  msgMine: { alignSelf: 'flex-end' },
  msgTheirs: { alignSelf: 'flex-start' },
  msgSenderName: { fontSize: 11, fontWeight: '600', color: colors.accent, marginBottom: tokens.spacing[1] },
  minimalMsgText: { fontSize: tokens.typography.size.base, lineHeight: 22, color: colors.white },
  emptyMsg: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: tokens.spacing[3] },
  emptyMsgText: { color: colors.textMuted, fontSize: tokens.typography.size.sm },

  typingRow: { paddingHorizontal: tokens.spacing[4], paddingBottom: tokens.spacing[1] },
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing[1], paddingHorizontal: tokens.spacing[3] + 2, paddingVertical: tokens.spacing[2] + 2, borderRadius: 18, borderBottomLeftRadius: 4, alignSelf: 'flex-start', maxWidth: 60 },
  typingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textMuted },

  inputArea: { backgroundColor: colors.surfaceCard, borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: Platform.OS === 'android' ? tokens.spacing[2] + 2 : tokens.spacing[5] },
  actionBtns: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: tokens.spacing[2] + 2, borderTopWidth: 1, borderTopColor: colors.border },
  nextBtn: { backgroundColor: 'rgba(42,127,255,0.1)' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: tokens.spacing[3], paddingVertical: tokens.spacing[2], gap: tokens.spacing[2] },
  input: { flex: 1, backgroundColor: colors.background, borderRadius: 20, paddingHorizontal: tokens.spacing[4], paddingVertical: tokens.spacing[2] + 2, fontSize: tokens.typography.size.base, color: colors.text, maxHeight: 80, borderWidth: 1, borderColor: colors.border },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
