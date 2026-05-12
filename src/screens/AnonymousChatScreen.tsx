/**
 * AnonymousChatScreen.tsx — Omegle-style anonymous chat
 *
 * States: Landing → Searching → Connected
 * All in-memory, no persistence. Simulated stranger replies.
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
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';

// ── Types ──────────────────────────────────────────────────────────────────

type ChatState = 'landing' | 'searching' | 'connected';

interface AnonMessage {
  id: string;
  content: string;
  isMine: boolean;
  timestamp: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const ADJECTIVES = ['Shadow', 'Mystic', 'Cosmic', 'Neon', 'Phantom', 'Blaze', 'Frost', 'Storm', 'Pixel', 'Ember', 'Drift', 'Haze'];
const NOUNS = ['Wolf', 'Fox', 'Eagle', 'Lynx', 'Raven', 'Hawk', 'Panther', 'Cobra', 'Tiger', 'Phoenix'];

function generateUsername(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 99) + 1;
  return `${adj}_${noun}${num}`;
}

const STRANGER_REPLIES = [
  'Hey! How are you? 😊',
  "That's cool, tell me more!",
  'I love meeting new people here.',
  'Where are you from?',
  'Haha, nice one! 😂',
  "I've been using Black94 for a while now.",
  'What do you do for fun?',
  "That's really interesting.",
  'Same here!',
  'Have you tried the anonymous mode before?',
  'So what brings you here today?',
  "I'm just chilling, looking for interesting conversations.",
  "That's a great point!",
  "I never thought about it that way.",
  'Nice to meet you! 🙌',
  'Absolutely agree with you on that.',
  "Let's talk about something fun. What's your favorite movie?",
];

let msgIdCounter = 0;

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AnonymousChatScreen() {
  const [chatState, setChatState] = useState<ChatState>('landing');
  const [messages, setMessages] = useState<AnonMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [strangerName, setStrangerName] = useState('');
  const [myName] = useState(() => generateUsername());
  const [elapsed, setElapsed] = useState(0);
  const [isStrangerTyping, setIsStrangerTyping] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Timer management ───────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopTimer();
    if (replyTimeoutRef.current) {
      clearTimeout(replyTimeoutRef.current);
      replyTimeoutRef.current = null;
    }
    setIsStrangerTyping(false);
  }, [stopTimer]);

  // ── Simulated stranger reply ───────────────────────────────────────────
  const triggerStrangerReply = useCallback(() => {
    const delay = 1500 + Math.random() * 3000;

    replyTimeoutRef.current = setTimeout(() => {
      setIsStrangerTyping(true);

      // "Typing" for 1-3 seconds
      setTimeout(() => {
        setIsStrangerTyping(false);
        const reply = STRANGER_REPLIES[Math.floor(Math.random() * STRANGER_REPLIES.length)];
        setMessages((prev) => [
          ...prev,
          {
            id: `msg_${++msgIdCounter}`,
            content: reply,
            isMine: false,
            timestamp: Date.now(),
          },
        ]);
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 1000 + Math.random() * 2000);
    }, delay);
  }, []);

  // ── Find stranger ──────────────────────────────────────────────────────
  const handleFindStranger = useCallback(() => {
    setChatState('searching');
    setMessages([]);
    setElapsed(0);
    setStrangerName(generateUsername());

    // Simulate finding someone after 2-4 seconds
    setTimeout(() => {
      setChatState('connected');
      startTimer();

      // Stranger sends first message after a moment
      setTimeout(() => {
        setMessages([
          {
            id: `msg_${++msgIdCounter}`,
            content: `Hi! I'm ${strangerName || 'Stranger'}. Nice to meet you! 👋`,
            isMine: false,
            timestamp: Date.now(),
          },
        ]);
      }, 800);
    }, 2000 + Math.random() * 2000);
  }, [startTimer, strangerName]);

  // ── Disconnect ────────────────────────────────────────────────────────
  const handleDisconnect = useCallback(() => {
    cleanup();
    setChatState('landing');
    setMessages([]);
    setStrangerName('');
    setElapsed(0);
  }, [cleanup]);

  // ── Next stranger ─────────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    cleanup();
    setChatState('searching');
    setMessages([]);
    setElapsed(0);
    setStrangerName(generateUsername());

    setTimeout(() => {
      setChatState('connected');
      startTimer();

      setTimeout(() => {
        setMessages([
          {
            id: `msg_${++msgIdCounter}`,
            content: `Hey! I'm ${strangerName}. What's up? 😄`,
            isMine: false,
            timestamp: Date.now(),
          },
        ]);
      }, 600);
    }, 2000 + Math.random() * 2000);
  }, [cleanup, startTimer, strangerName]);

  // ── Send message ───────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    if (!inputText.trim()) return;

    const newMsg: AnonMessage = {
      id: `msg_${++msgIdCounter}`,
      content: inputText.trim(),
      isMine: true,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, newMsg]);
    setInputText('');
    flatListRef.current?.scrollToEnd({ animated: true });

    // Trigger stranger reply
    triggerStrangerReply();
  }, [inputText, triggerStrangerReply]);

  // ── Pulse animation for search button ──────────────────────────────────
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

  // ── Cleanup on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  // ── Render message ────────────────────────────────────────────────────
  const renderMessage = ({ item }: { item: AnonMessage }) => {
    const isMine = item.isMine;
    return (
      <View
        style={[styles.msgWrapper, isMine ? styles.msgMine : styles.msgTheirs]}>
        <View
          style={[
            styles.msgBubble,
            isMine ? styles.msgBubbleMine : styles.msgBubbleTheirs,
          ]}>
          {!isMine && (
            <Text style={styles.msgSenderName}>{strangerName}</Text>
          )}
          <Text style={[styles.msgText, isMine ? styles.msgTextMine : styles.msgTextTheirs]}>
            {item.content}
          </Text>
        </View>
      </View>
    );
  };

  // ── Landing state ─────────────────────────────────────────────────────
  if (chatState === 'landing') {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.landingContainer}>
          <View style={styles.landingIcon}>
            <Ionicons name="incognito-outline" size={64} color={colors.primary} />
          </View>
          <Text style={styles.landingTitle}>Anonymous Chat</Text>
          <Text style={styles.landingSubtitle}>
            Connect with random people anonymously. Your identity is hidden.
          </Text>
          <Text style={styles.yourNameLabel}>Your anonymous name:</Text>
          <View style={styles.nameTag}>
            <Ionicons name="at" size={16} color={colors.primary} />
            <Text style={styles.nameTagText}>{myName}</Text>
          </View>
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

  // ── Searching state ───────────────────────────────────────────────────
  if (chatState === 'searching') {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.searchContainer}>
          <Text style={styles.searchYourName}>@{myName}</Text>
          <View style={styles.searchSpinner}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
          <Text style={styles.searchingText}>Finding someone...</Text>
          <Text style={styles.searchingSubtext}>
            Please wait while we connect you with a stranger
          </Text>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={handleDisconnect}
            activeOpacity={0.7}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Connected state ───────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.chatContainer}
        behavior="padding">
        {/* Header */}
        <View style={styles.chatHeader}>
          <View style={styles.chatHeaderInfo}>
            <View style={styles.anonAvatar}>
              <Ionicons name="incognito" size={18} color={colors.white} />
            </View>
            <View>
              <Text style={styles.chatHeaderName}>{strangerName}</Text>
              <View style={styles.chatHeaderMeta}>
                <View style={styles.onlineDot} />
                <Text style={styles.chatHeaderText}>Anonymous</Text>
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
          ListEmptyComponent={
            <View style={styles.emptyMsg}>
              <Text style={styles.emptyMsgText}>Say something to start the conversation!</Text>
            </View>
          }
        />

        {/* Typing indicator */}
        {isStrangerTyping && (
          <View style={styles.typingRow}>
            <Text style={styles.typingText}>{strangerName} is typing...</Text>
          </View>
        )}

        {/* Input + actions */}
        <View style={styles.inputArea}>
          <View style={styles.actionBtns}>
            <TouchableOpacity
              style={styles.nextBtn}
              onPress={handleNext}
              activeOpacity={0.7}>
              <Ionicons name="skip-forward" size={20} color={colors.primary} />
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
              onChangeText={setInputText}
              onSubmitEditing={handleSend}
              multiline
              maxLength={500}
              returnKeyType="send"
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
  // Landing
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
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
    gap: 4,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary,
    marginBottom: 40,
  },
  nameTagText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  findBtn: {
    width: '100%',
  },
  findBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.primary,
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
  // Searching
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
  // Chat
  chatContainer: {
    flex: 1,
  },
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
    backgroundColor: colors.primary,
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
    fontVariant: ['tabular-nums'],
  },
  // Messages
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
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  msgBubbleTheirs: {
    backgroundColor: colors.surfaceLight,
    borderBottomLeftRadius: 4,
  },
  msgSenderName: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
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
  },
  emptyMsgText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  // Typing
  typingRow: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  typingText: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  // Input area
  inputArea: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 20,
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
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  nextBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
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
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
