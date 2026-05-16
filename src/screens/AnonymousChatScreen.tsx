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

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../stores/app';

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

const QUEUE_POLL_INTERVAL = 2000;   // 2 seconds
const MSG_POLL_INTERVAL = 1500;      // 1.5 seconds
const TYPING_POLL_INTERVAL = 3000;   // 3 seconds
const QUEUE_TTL_SECONDS = 60;        // Queue entries expire after 60s

const ADJECTIVES = [
  'Shadow', 'Mystic', 'Cosmic', 'Neon', 'Phantom',
  'Blaze', 'Frost', 'Storm', 'Pixel', 'Ember',
  'Drift', 'Haze', 'Nova', 'Cryptic', 'Silent',
];
const NOUNS = [
  'Wolf', 'Fox', 'Eagle', 'Lynx', 'Raven',
  'Hawk', 'Panther', 'Cobra', 'Tiger', 'Phoenix',
  'Orca', 'Viper', 'Ghost', 'Sage', 'Flux',
];

// ── Helpers ────────────────────────────────────────────────────────────────

function generateAnonymousName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 999) + 1;
  return `${adj}_${noun}${num}`;
}

/** Deterministic room ID from two sorted user IDs */
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
  try {
    const created = new Date(createdAt).getTime();
    return Date.now() - created > maxAgeMs;
  } catch {
    return true;
  }
}

function nowISO(): string {
  return new Date().toISOString();
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AnonymousChatScreen() {
  // ── State ────────────────────────────────────────────────────────────────
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

  // ── Refs ─────────────────────────────────────────────────────────────────
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

  // ── Store & Navigation ────────────────────────────────────────────────────
  const { user } = useAppStore();
  const navigation = useNavigation();

  // Keep roomRef in sync
  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Fetch anon_chat_count from Firestore ─────────────────────────────────
  useEffect(() => {
    if (!myUserId) return;
    const fetchCount = async () => {
      try {
        const doc = await firestore().collection('users').doc(myUserId).get();
        if (doc.exists) {
          setAnonChatCount(doc.data()?.anon_chat_count ?? 0);
        } else {
          setAnonChatCount(0);
        }
      } catch {
        setAnonChatCount(0);
      }
    };
    fetchCount();
  }, [myUserId]);

  // ── Timer management ─────────────────────────────────────────────────────
  const startConnectionTimer = useCallback(() => {
    stopConnectionTimer();
    timerRef.current = setInterval(() => {
      if (mountedRef.current) setElapsed(prev => prev + 1);
    }, 1000);
  }, []);

  const stopConnectionTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startSearchTimer = useCallback(() => {
    stopSearchTimer();
    searchTimerRef.current = setInterval(() => {
      if (mountedRef.current) setSearchElapsed(prev => prev + 1);
    }, 1000);
  }, []);

  const stopSearchTimer = useCallback(() => {
    if (searchTimerRef.current) {
      clearInterval(searchTimerRef.current);
      searchTimerRef.current = null;
    }
  }, []);

  // ── Poll cleanup ─────────────────────────────────────────────────────────
  const stopAllPolling = useCallback(() => {
    if (queuePollRef.current) {
      clearInterval(queuePollRef.current);
      queuePollRef.current = null;
    }
    if (msgPollRef.current) {
      clearInterval(msgPollRef.current);
      msgPollRef.current = null;
    }
    if (typingPollRef.current) {
      clearInterval(typingPollRef.current);
      typingPollRef.current = null;
    }
    if (typingDebounceRef.current) {
      clearTimeout(typingDebounceRef.current);
      typingDebounceRef.current = null;
    }
  }, []);

  // ── Firestore: delete own queue entry ────────────────────────────────────
  const deleteOwnQueueEntry = useCallback(async () => {
    if (!myUserId) return;
    try {
      await firestore().collection('anonQueue').doc(myUserId).delete();
    } catch (e: any) {
      console.warn('[AnonChat] Failed to delete queue entry:', e?.message);
    }
  }, [myUserId]);

  // ── Firestore: update room's lastActivity ────────────────────────────────
  const updateRoomActivity = useCallback(async (roomId: string) => {
    try {
      await firestore().collection('anonRooms').doc(roomId).update({
        lastActivity: nowISO(),
      });
    } catch (e: any) {
      console.warn('[AnonChat] Failed to update room activity:', e?.message);
    }
  }, []);

  // ── Firestore: increment anon_chat_count ────────────────────────────────
  const incrementAnonChatCount = useCallback(async () => {
    if (!myUserId) return;
    try {
      await firestore().collection('users').doc(myUserId).update({
        anon_chat_count: firestore.FieldValue.increment(1),
      });
      setAnonChatCount(prev => (prev ?? 0) + 1);
    } catch (e: any) {
      console.warn('[AnonChat] Failed to increment chat count:', e?.message);
    }
  }, [myUserId]);

  // ── Firestore: set partner typing state ──────────────────────────────────
  const setMyTypingState = useCallback(async (roomId: string, typing: boolean) => {
    try {
      const currentRoom = roomRef.current;
      if (!currentRoom) return;
      // Determine which typing field is ours
      const updateData: Record<string, any> = {};
      if (currentRoom.partnerId === myUserId) {
        updateData.user2Typing = typing;
      } else {
        updateData.user1Typing = typing;
      }
      await firestore().collection('anonRooms').doc(roomId).update(updateData);
    } catch (e: any) {
      console.warn('[AnonChat] Failed to update typing state:', e?.message);
    }
  }, [myUserId]);

  // ── Poll: check queue for match (also detect if someone matched us) ──────
  const pollQueue = useCallback(async () => {
    if (!myUserId || !mountedRef.current) return;

    try {
      const db = firestore();

      // First: check if we've been matched by someone else
      const myQueueDoc = await db.collection('anonQueue').doc(myUserId).get();
      if (myQueueDoc.exists) {
        const myData = myQueueDoc.data();
        if (myData?.status === 'matched' && myData?.partnerId) {
          // Someone matched with us!
          const partnerId = myData.partnerId;
          const roomId = buildRoomId(myUserId, partnerId);

          // Get the room to find partner's name
          const roomDoc = await db.collection('anonRooms').doc(roomId).get();
          let partnerName = 'Stranger';
          if (roomDoc.exists) {
            const roomData = roomDoc.data();
            partnerName =
              roomData?.user1Id === myUserId
                ? roomData?.user2Name || 'Stranger'
                : roomData?.user1Name || 'Stranger';
          }

          // Clean up queue entry
          await deleteOwnQueueEntry();

          // Stop queue polling
          if (queuePollRef.current) {
            clearInterval(queuePollRef.current);
            queuePollRef.current = null;
          }
          stopSearchTimer();

          const newRoom: RoomData = {
            roomId,
            partnerId,
            partnerName,
            myName,
            createdAt: roomDoc.exists ? (roomDoc.data()?.createdAt || nowISO()) : nowISO(),
          };

          if (mountedRef.current) {
            setRoom(newRoom);
            roomRef.current = newRoom;
            setMessages([]);
            lastMsgTimestampRef.current = null;
            setChatState('connected');
            setElapsed(0);
            startConnectionTimer();
            startMessagePolling(newRoom.roomId);
            startTypingPolling(newRoom.roomId);
            incrementAnonChatCount();
          }
          return;
        }
      }

      // Second: look for other waiting users to match with
      const snapshot = await db
        .collection('anonQueue')
        .where('status', '==', 'waiting')
        .get();

      if (!snapshot.empty) {
        const candidates = snapshot.docs.filter(doc => {
          const data = doc.data();
          return (
            doc.id !== myUserId &&
            data.status === 'waiting' &&
            !isStale(data.createdAt, QUEUE_TTL_SECONDS * 1000)
          );
        });

        if (candidates.length > 0) {
          // Pick the oldest candidate
          const partner = candidates.reduce((oldest, current) => {
            const oData = oldest.data();
            const cData = current.data();
            return (oData.createdAt || '') < (cData.createdAt || '') ? oldest : current;
          });

          const partnerData = partner.data();
          const partnerId = partner.id;
          const partnerName = partnerData.anonymousName || 'Stranger';
          const roomId = buildRoomId(myUserId, partnerId);

          // Create the room
          await db.collection('anonRooms').doc(roomId).set({
            user1Id: myUserId,
            user2Id: partnerId,
            user1Name: myName,
            user2Name: partnerName,
            createdAt: nowISO(),
            lastActivity: nowISO(),
            user1Typing: false,
            user2Typing: false,
          });

          // Mark partner as matched
          try {
            await db.collection('anonQueue').doc(partnerId).update({
              status: 'matched',
              partnerId: myUserId,
            });
          } catch (e: any) {
            console.warn('[AnonChat] Failed to mark partner as matched:', e?.message);
          }

          // Mark ourselves as matched
          try {
            await db.collection('anonQueue').doc(myUserId).update({
              status: 'matched',
              partnerId,
            });
          } catch (e: any) {
            console.warn('[AnonChat] Failed to mark self as matched:', e?.message);
          }

          // Clean up our own queue entry after matching
          await deleteOwnQueueEntry();

          // Stop queue polling
          if (queuePollRef.current) {
            clearInterval(queuePollRef.current);
            queuePollRef.current = null;
          }
          stopSearchTimer();

          const newRoom: RoomData = {
            roomId,
            partnerId,
            partnerName,
            myName,
            createdAt: nowISO(),
          };

          if (mountedRef.current) {
            setRoom(newRoom);
            roomRef.current = newRoom;
            setMessages([]);
            lastMsgTimestampRef.current = null;
            setChatState('connected');
            setElapsed(0);
            startConnectionTimer();
            startMessagePolling(newRoom.roomId);
            startTypingPolling(newRoom.roomId);
            incrementAnonChatCount();
          }
        }
      }
    } catch (e: any) {
      console.warn('[AnonChat] Queue poll error:', e?.message);
    }
  }, [myUserId, myName, deleteOwnQueueEntry, stopSearchTimer, startConnectionTimer, incrementAnonChatCount]);

  // ── Start message polling ────────────────────────────────────────────────
  const startMessagePolling = useCallback((roomId: string) => {
    // Clear existing
    if (msgPollRef.current) {
      clearInterval(msgPollRef.current);
      msgPollRef.current = null;
    }

    const poll = async () => {
      if (!mountedRef.current) return;

      try {
        const snapshot = await firestore()
          .collection('anonMessages')
          .where('roomId', '==', roomId)
          .orderBy('createdAt', 'asc')
          .get();

        if (!snapshot.empty && mountedRef.current) {
          const newMessages: AnonMessage[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
              id: doc.id,
              content: data.content || '',
              senderId: data.senderId || '',
              senderName: data.senderName || 'Stranger',
              createdAt: data.createdAt || '',
            };
          });

          setMessages(prev => {
            // Merge: keep existing, add new ones
            const existingIds = new Set(prev.map(m => m.id));
            const trulyNew = newMessages.filter(m => !existingIds.has(m.id));
            if (trulyNew.length === 0) return prev;
            return [...prev, ...trulyNew];
          });

          // Update last seen timestamp
          const latestTimestamp = newMessages[newMessages.length - 1]?.createdAt;
          if (latestTimestamp) {
            lastMsgTimestampRef.current = latestTimestamp;
          }

          // Auto-scroll to bottom
          setTimeout(() => {
            flatListRef.current?.scrollToEnd({ animated: true });
          }, 100);
        }
      } catch (e: any) {
        console.warn('[AnonChat] Message poll error:', e?.message);
      }
    };

    // Immediate fetch, then poll
    poll();
    msgPollRef.current = setInterval(poll, MSG_POLL_INTERVAL);
  }, []);

  // ── Start typing indicator polling ───────────────────────────────────────
  const startTypingPolling = useCallback((roomId: string) => {
    if (typingPollRef.current) {
      clearInterval(typingPollRef.current);
      typingPollRef.current = null;
    }

    const poll = async () => {
      if (!mountedRef.current) return;

      try {
        const doc = await firestore().collection('anonRooms').doc(roomId).get();
        if (doc.exists) {
          const data = doc.data();
          const currentRoom = roomRef.current;
          if (!currentRoom) return;

          // The partner's typing field is the opposite of ours
          let partnerTyping = false;
          if (currentRoom.partnerId === myUserId) {
            partnerTyping = data?.user1Typing === true;
          } else {
            partnerTyping = data?.user2Typing === true;
          }

          if (mountedRef.current) {
            setIsPartnerTyping(partnerTyping);
          }
        }
      } catch (e: any) {
        console.warn('[AnonChat] Typing poll error:', e?.message);
      }
    };

    typingPollRef.current = setInterval(poll, TYPING_POLL_INTERVAL);
  }, [myUserId]);

  // ── Full cleanup (disconnect / unmount) ──────────────────────────────────
  const fullCleanup = useCallback(async () => {
    stopConnectionTimer();
    stopSearchTimer();
    stopAllPolling();

    // Delete queue entry if we're still searching
    await deleteOwnQueueEntry();

    // Update room activity if connected
    const currentRoom = roomRef.current;
    if (currentRoom?.roomId) {
      await updateRoomActivity(currentRoom.roomId);
      // Clear our typing state
      await setMyTypingState(currentRoom.roomId, false);
    }

    roomRef.current = null;
    lastMsgTimestampRef.current = null;
  }, [stopConnectionTimer, stopSearchTimer, stopAllPolling, deleteOwnQueueEntry, updateRoomActivity, setMyTypingState]);

  // ── Handle: Find Stranger ────────────────────────────────────────────────
  const handleFindStranger = useCallback(async () => {
    if (!myUserId) {
      setError('You must be signed in to use anonymous chat.');
      return;
    }

    setError(null);
    setChatState('searching');
    setMessages([]);
    setRoom(null);
    roomRef.current = null;
    setElapsed(0);
    setSearchElapsed(0);
    setIsPartnerTyping(false);
    lastMsgTimestampRef.current = null;

    try {
      // Create our queue entry
      await firestore().collection('anonQueue').doc(myUserId).set({
        userId: myUserId,
        anonymousName: myName,
        status: 'waiting',
        partnerId: null,
        createdAt: nowISO(),
      });

      startSearchTimer();

      // Poll for matches every 2 seconds
      if (queuePollRef.current) clearInterval(queuePollRef.current);
      queuePollRef.current = setInterval(pollQueue, QUEUE_POLL_INTERVAL);

      // Also check immediately
      pollQueue();
    } catch (e: any) {
      console.error('[AnonChat] Failed to join queue:', e?.message);
      setError('Failed to start searching. Please try again.');
      setChatState('landing');
    }
  }, [myUserId, myName, pollQueue, startSearchTimer]);

  // ── Handle: Disconnect (return to landing) ──────────────────────────────
  const handleDisconnect = useCallback(async () => {
    await fullCleanup();
    if (mountedRef.current) {
      setChatState('landing');
      setMessages([]);
      setRoom(null);
      setElapsed(0);
      setIsPartnerTyping(false);
      setError(null);
    }
  }, [fullCleanup]);

  // ── Handle: Next Stranger ────────────────────────────────────────────────
  const handleNext = useCallback(async () => {
    await fullCleanup();
    if (mountedRef.current) {
      // Reset state and immediately start searching again
      setMessages([]);
      setRoom(null);
      roomRef.current = null;
      setElapsed(0);
      setIsPartnerTyping(false);
      lastMsgTimestampRef.current = null;
      setError(null);

      // Transition to searching and start looking
      setChatState('searching');

      try {
        await firestore().collection('anonQueue').doc(myUserId).set({
          userId: myUserId,
          anonymousName: myName,
          status: 'waiting',
          partnerId: null,
          createdAt: nowISO(),
        });

        startSearchTimer();

        if (queuePollRef.current) clearInterval(queuePollRef.current);
        queuePollRef.current = setInterval(pollQueue, QUEUE_POLL_INTERVAL);
        pollQueue();
      } catch (e: any) {
        console.error('[AnonChat] Failed to rejoin queue:', e?.message);
        setError('Failed to find next stranger. Please try again.');
        setChatState('landing');
      }
    }
  }, [fullCleanup, myUserId, myName, pollQueue, startSearchTimer]);

  // ── Handle: Send Message ─────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !room?.roomId || !myUserId) return;

    const content = text;
    setInputText('');

    // Clear our typing state
    if (typingDebounceRef.current) {
      clearTimeout(typingDebounceRef.current);
      typingDebounceRef.current = null;
    }
    await setMyTypingState(room.roomId, false);

    try {
      await firestore().collection('anonMessages').add({
        roomId: room.roomId,
        senderId: myUserId,
        senderName: myName,
        content,
        createdAt: nowISO(),
      });

      // Update room activity
      await updateRoomActivity(room.roomId);

      // Immediately poll to show our message
      const snapshot = await firestore()
        .collection('anonMessages')
        .where('roomId', '==', room.roomId)
        .orderBy('createdAt', 'asc')
        .get();

      if (!snapshot.empty) {
        const allMsgs: AnonMessage[] = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            content: data.content || '',
            senderId: data.senderId || '',
            senderName: data.senderName || 'Stranger',
            createdAt: data.createdAt || '',
          };
        });

        if (mountedRef.current) {
          setMessages(allMsgs);
          const latest = allMsgs[allMsgs.length - 1]?.createdAt;
          if (latest) lastMsgTimestampRef.current = latest;
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
        }
      }
    } catch (e: any) {
      console.error('[AnonChat] Failed to send message:', e?.message);
      setError('Failed to send message. Please try again.');
      // Restore input text on failure
      setInputText(content);
    }
  }, [inputText, room, myUserId, myName, setMyTypingState, updateRoomActivity]);

  // ── Handle: input text change (typing indicator) ────────────────────────
  const handleInputChange = useCallback((text: string) => {
    setInputText(text);

    if (text.trim() && room?.roomId) {
      // Set typing
      setMyTypingState(room.roomId, true);

      // Debounce: clear typing after 3 seconds of no input
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
      typingDebounceRef.current = setTimeout(() => {
        if (room.roomId) setMyTypingState(room.roomId, false);
      }, 3000);
    } else if (!text.trim() && room?.roomId) {
      // Cleared input — not typing anymore
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
      setMyTypingState(room.roomId, false);
    }
  }, [room, setMyTypingState]);

  // ── Pulse animation for search button ────────────────────────────────────
  useEffect(() => {
    if (chatState !== 'landing') {
      pulseAnim.stopAnimation();
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.95,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [chatState, pulseAnim]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      fullCleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived state ────────────────────────────────────────────────────────
  const strangerName = room?.partnerName || '';

  // ── Render: Message bubble ──────────────────────────────────────────────
  const renderMessage = ({ item }: { item: AnonMessage }) => {
    const isMine = item.senderId === myUserId;
    return (
      <View
        style={[styles.msgWrapper, isMine ? styles.msgMine : styles.msgTheirs]}>
        <View
          style={[
            styles.msgBubble,
            isMine ? styles.msgBubbleMine : styles.msgBubbleTheirs,
          ]}>
          {!isMine && (
            <Text style={styles.msgSenderName}>{item.senderName}</Text>
          )}
          <Text style={[styles.msgText, isMine ? styles.msgTextMine : styles.msgTextTheirs]}>
            {item.content}
          </Text>
        </View>
      </View>
    );
  };

  // ── Render: Sign-in required ────────────────────────────────────────────
  if (!myUserId) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.landingContainer}>
          <View style={styles.landingIcon}>
            <Ionicons name="eye-off-outline" size={64} color={colors.accent} />
          </View>
          <Text style={styles.landingTitle}>Anonymous Chat</Text>
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
            <Text style={styles.errorText}>You must be signed in to use anonymous chat.</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render: Loading chat count ──────────────────────────────────────────
  if (anonChatCount === null) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.landingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Render: Paywall (free users who exceeded 10 free chats) ────────────
  const isSubscribed = user?.subscription === 'premium' || user?.subscription === 'business';
  const canUseAnonChat = isSubscribed || anonChatCount < 10;

  if (!canUseAnonChat) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.paywallContainer}>
          <View style={styles.paywallIconWrap}>
            <Ionicons name="eye-off-outline" size={56} color={colors.accent} />
          </View>
          <Text style={styles.paywallTitle}>Free Chats Used</Text>
          <Text style={styles.paywallSubtitle}>
            You've used your 10 free anonymous chats. Upgrade to Premium or Business for unlimited anonymous chats.
          </Text>

          <View style={styles.paywallBenefits}>
            <View style={styles.paywallBenefitRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
              <Text style={styles.paywallBenefitText}>Connect with random people anonymously</Text>
            </View>
            <View style={styles.paywallBenefitRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
              <Text style={styles.paywallBenefitText}>Your identity is always hidden</Text>
            </View>
            <View style={styles.paywallBenefitRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
              <Text style={styles.paywallBenefitText}>Real-time typing indicators</Text>
            </View>
            <View style={styles.paywallBenefitRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
              <Text style={styles.paywallBenefitText}>Instant matching</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.paywallUpgradeBtn}
            onPress={() => navigation.navigate('PremiumDashboard' as never)}
            activeOpacity={0.8}>
            <Ionicons name="diamond" size={20} color={colors.white} />
            <Text style={styles.paywallUpgradeBtnText}>Upgrade to Premium</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.paywallLaterBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}>
            <Text style={styles.paywallLaterBtnText}>Maybe Later</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render: Landing ─────────────────────────────────────────────────────
  if (chatState === 'landing') {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.landingContainer}>
          <View style={styles.landingIcon}>
            <Ionicons name="eye-off-outline" size={64} color={colors.accent} />
          </View>
          <Text style={styles.landingTitle}>Anonymous Chat</Text>
          <Text style={styles.landingSubtitle}>
            Connect with random people anonymously. Your identity is hidden.
          </Text>
          <Text style={styles.yourNameLabel}>Your anonymous name:</Text>
          <View style={styles.nameTag}>
            <Ionicons name="at" size={16} color={colors.accent} />
            <Text style={styles.nameTagText}>{myName}</Text>
          </View>

          {error && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Animated.View
            style={[styles.findBtn, { transform: [{ scale: pulseAnim }] }]}>
            <TouchableOpacity
              style={styles.findBtnInner}
              onPress={handleFindStranger}
              activeOpacity={0.8}>
              <Ionicons name="flash" size={24} color={colors.white} />
              <Text style={styles.findBtnText}>Find Stranger</Text>
            </TouchableOpacity>
          </Animated.View>
          <Text style={styles.disclaimerText}>
            By continuing, you agree to be respectful to others.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render: Searching ───────────────────────────────────────────────────
  if (chatState === 'searching') {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.searchContainer}>
          <Text style={styles.searchYourName}>@{myName}</Text>
          <View style={styles.searchSpinner}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
          <Text style={styles.searchingText}>Finding someone...</Text>
          <Text style={styles.searchingSubtext}>
            {searchElapsed > 0
              ? `Waiting for ${formatDuration(searchElapsed)}...`
              : 'Please wait while we connect you with a stranger'}
          </Text>

          {error && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={handleDisconnect}
            activeOpacity={0.7}>
            <Ionicons name="close" size={18} color={colors.textSecondary} />
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render: Connected (Chat) ────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}>
        {/* Header */}
        <View style={styles.chatHeader}>
          <View style={styles.chatHeaderInfo}>
            <View style={styles.anonAvatar}>
              <Ionicons name="eye-off" size={18} color={colors.white} />
            </View>
            <View>
              <Text style={styles.chatHeaderName}>
                {strangerName || 'Stranger'}
              </Text>
              <View style={styles.chatHeaderMeta}>
                <View style={styles.onlineDot} />
                <Text style={styles.chatHeaderText}>
                  {isPartnerTyping ? 'typing...' : 'Anonymous'}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.timerBadge}>
            <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.timerText}>{formatDuration(elapsed)}</Text>
          </View>
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
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={40}
                color={colors.textMuted}
              />
              <Text style={styles.emptyMsgText}>
                Say something to start the conversation!
              </Text>
            </View>
          }
        />

        {/* Typing indicator */}
        {isPartnerTyping && (
          <View style={styles.typingRow}>
            <View style={styles.typingBubble}>
              <View style={styles.typingDot} />
              <View style={[styles.typingDot, { opacity: 0.6 }]} />
              <View style={[styles.typingDot, { opacity: 0.3 }]} />
            </View>
          </View>
        )}

        {/* Error banner */}
        {error && (
          <View style={styles.errorBannerInline}>
            <Ionicons name="alert-circle-outline" size={14} color={colors.error} />
            <Text style={styles.errorTextInline}>{error}</Text>
          </View>
        )}

        {/* Input + actions */}
        <View style={styles.inputArea}>
          <View style={styles.actionBtns}>
            <TouchableOpacity
              style={styles.nextBtn}
              onPress={handleNext}
              activeOpacity={0.7}>
              <Ionicons name="play-forward-outline" size={20} color={colors.accent} />
              <Text style={styles.nextBtnText}>Next</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.disconnectBtn}
              onPress={handleDisconnect}
              activeOpacity={0.7}>
              <Ionicons name="close" size={20} color={colors.error} />
              <Text style={styles.disconnectBtnText}>Disconnect</Text>
            </TouchableOpacity>
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
              <Ionicons name="send" size={20} color={colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // ── Landing ──────────────────────────────────────────────────────────────
  landingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  landingIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(42, 127, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  landingTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 8,
  },
  landingSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  yourNameLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 8,
  },
  nameTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.accent,
    marginBottom: 16,
  },
  nameTagText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.accent,
  },

  // ── Paywall ──────────────────────────────────────────────────────────────
  paywallContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  paywallIconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(42, 127, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  paywallTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 8,
  },
  paywallSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  paywallBenefits: {
    width: '100%',
    gap: 14,
    marginBottom: 32,
  },
  paywallBenefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  paywallBenefitText: {
    fontSize: 15,
    color: colors.text,
    flexShrink: 1,
  },
  paywallUpgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 16,
    marginBottom: 16,
  },
  paywallUpgradeBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.white,
  },
  paywallLaterBtn: {
    paddingVertical: 10,
  },
  paywallLaterBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },

  // ── Error ────────────────────────────────────────────────────────────────
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 24,
    width: '100%',
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
    flexShrink: 1,
  },
  errorBannerInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginHorizontal: 12,
    borderRadius: 8,
  },
  errorTextInline: {
    fontSize: 12,
    color: colors.error,
  },

  // ── Find button ─────────────────────────────────────────────────────────
  findBtn: {
    width: '100%',
  },
  findBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 18,
  },
  findBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.white,
  },
  disclaimerText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 16,
  },

  // ── Searching ────────────────────────────────────────────────────────────
  searchContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  searchYourName: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 40,
  },
  searchSpinner: {
    marginBottom: 20,
  },
  searchingText: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  searchingSubtext: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 40,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },

  // ── Chat container ───────────────────────────────────────────────────────
  chatContainer: {
    flex: 1,
  },

  // ── Chat header ──────────────────────────────────────────────────────────
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  chatHeaderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  anonAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatHeaderName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  chatHeaderMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accentGreen,
  },
  chatHeaderText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  timerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'] as any,
  },

  // ── Messages ─────────────────────────────────────────────────────────────
  msgList: {
    padding: 12,
    paddingBottom: 4,
  },
  msgWrapper: {
    marginBottom: 8,
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
    backgroundColor: colors.accent,
    borderBottomRightRadius: 4,
  },
  msgBubbleTheirs: {
    backgroundColor: colors.surfaceLight,
    borderBottomLeftRadius: 4,
  },
  msgSenderName: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
    marginBottom: 4,
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
    gap: 12,
  },
  emptyMsgText: {
    color: colors.textMuted,
    fontSize: 14,
  },

  // ── Typing indicator ─────────────────────────────────────────────────────
  typingRow: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    alignSelf: 'flex-start',
    maxWidth: 60,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textMuted,
  },

  // ── Input area ───────────────────────────────────────────────────────────
  inputArea: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: Platform.OS === 'android' ? 10 : 20,
  },
  actionBtns: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(42, 127, 255, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  nextBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  disconnectBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.error,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    maxHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
