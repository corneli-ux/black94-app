/**
 * VideoCallScreen.tsx — Full-screen video call UI shell for Premium users.
 *
 * This screen provides the visual layout for a 1-on-1 video call.
 * WebRTC streaming is not yet integrated — video areas are placeholders
 * showing camera icons. The signaling layer and call controls are functional.
 *
 * Route params: { chatId, otherUserId, otherUserName }
 * - Auto-ends after 60 minutes for non-premium users
 * - Unlimited duration for premium users
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';

const MAX_FREE_DURATION = 60 * 60; // 60 minutes in seconds

export default function VideoCallScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user } = useAppStore();

  const { chatId, otherUserId, otherUserName } = route.params;

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [callActive, setCallActive] = useState(true);
  const [endedEarly, setEndedEarly] = useState(false);
  const [permissionShown, setPermissionShown] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasEndedRef = useRef(false);

  const isPremium = user?.subscription === 'premium' || user?.subscription === 'business';

  // ── Permission rationale dialog (Indus App Store compliance) ──────────
  useEffect(() => {
    if (Platform.OS === 'android' && !permissionShown) {
      Alert.alert(
        'Camera & Microphone Access',
        'Black94 needs access to your camera and microphone for video calls. You can manage these permissions in your device settings at any time.',
        [
          { text: 'OK', onPress: () => setPermissionShown(true) },
        ],
      );
    }
  }, [permissionShown]);

  // ── Timer ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!callActive) return;

    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callActive]);

  // ── Auto-end for non-premium after 60 min ────────────────────────────
  useEffect(() => {
    if (isPremium || !callActive) return;

    if (elapsed >= MAX_FREE_DURATION && !hasEndedRef.current) {
      Alert.alert(
        'Free Call Limit Reached',
        'Video calls are limited to 60 minutes for free users. Upgrade to Premium for unlimited calls.',
        [{ text: 'OK', onPress: () => handleEndCall() }],
      );
    }
  }, [elapsed, isPremium, callActive]);

  // ── End call ─────────────────────────────────────────────────────────
  const handleEndCall = useCallback(() => {
    if (hasEndedRef.current) return;
    hasEndedRef.current = true;
    setCallActive(false);
    setEndedEarly(true);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setTimeout(() => {
      navigation.goBack();
    }, 400);
  }, [navigation]);

  // ── Format timer ─────────────────────────────────────────────────────
  const formatTime = useCallback((seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // ── Time remaining for free users ────────────────────────────────────
  const getRemainingLabel = () => {
    if (isPremium) return null;
    const remaining = MAX_FREE_DURATION - elapsed;
    if (remaining <= 0) return '00:00 remaining';
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return `${mins}:${secs.toString().padStart(2, '0')} remaining`;
  };

  const remainingLabel = getRemainingLabel();
  const isLowTime = !isPremium && (MAX_FREE_DURATION - elapsed) <= 300; // 5 min warning

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* ── Remote Video (full-screen placeholder) ──────────────────── */}
      <View style={styles.remoteVideoArea}>
        {endedEarly && (
          <View style={styles.endedOverlay}>
            <Text style={styles.endedText}>Call Ended</Text>
          </View>
        )}

        {!endedEarly && !isCameraOff ? (
          <View style={styles.videoPlaceholder}>
            <Ionicons name="videocam" size={64} color={colors.border} />
            <Text style={styles.placeholderLabel}>Remote Video</Text>
            <Text style={styles.placeholderSub}>WebRTC integration coming soon</Text>
          </View>
        ) : !endedEarly ? (
          <View style={styles.videoPlaceholder}>
            <Ionicons name="videocam-off" size={64} color={colors.border} />
            <Text style={styles.placeholderLabel}>Camera Off</Text>
          </View>
        ) : null}

        {/* ── Self-view (bottom-right overlay, like FaceTime) ──────── */}
        <View style={[styles.selfViewOverlay, { bottom: insets.bottom + 200 }]}>
          <View style={styles.selfViewContainer}>
            {isCameraOff ? (
              <View style={styles.selfViewPlaceholder}>
                <Ionicons name="videocam-off" size={24} color={colors.border} />
              </View>
            ) : (
              <View style={styles.selfViewPlaceholder}>
                <Ionicons name="camera" size={24} color={colors.border} />
              </View>
            )}
            <View style={styles.selfViewLabel}>
              <Text style={styles.selfViewText}>You</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── Header (caller info + timer) ──────────────────────────────── */}
      <View style={[styles.header, { top: insets.top || 12 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={handleEndCall} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.white} />
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.callerName}>{otherUserName || 'User'}</Text>
          <View style={styles.headerSubRow}>
            <View style={[
              styles.statusDot,
              { backgroundColor: callActive ? colors.accentGreen : colors.error },
            ]} />
            <Text style={styles.headerStatus}>
              {callActive ? 'Connected' : 'Ended'}
            </Text>
            {callActive && (
              <Text style={styles.timerText}>{formatTime(elapsed)}</Text>
            )}
          </View>
        </View>

        {/* End call button in header */}
        <TouchableOpacity
          style={styles.headerEndBtn}
          onPress={handleEndCall}
          hitSlop={8}
        >
          <Ionicons name="call" size={22} color={colors.white} style={styles.endCallIcon} />
        </TouchableOpacity>
      </View>

      {/* ── Controls row at bottom ────────────────────────────────────── */}
      <View style={[styles.controlsRow, { bottom: Math.max(insets.bottom, 20) + 20 }]}>
        {/* Mute mic */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => setIsMuted((prev) => !prev)}
          activeOpacity={0.7}
        >
          <View style={[styles.controlCircle, isMuted && styles.controlCircleActive]}>
            <Ionicons
              name={isMuted ? 'mic-off' : 'mic'}
              size={26}
              color={isMuted ? colors.primaryForeground : colors.text}
            />
          </View>
          <Text style={[styles.controlLabel, isMuted && styles.controlLabelActive]}>
            {isMuted ? 'Muted' : 'Mic'}
          </Text>
        </TouchableOpacity>

        {/* Toggle camera */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => setIsCameraOff((prev) => !prev)}
          activeOpacity={0.7}
        >
          <View style={[styles.controlCircle, isCameraOff && styles.controlCircleActive]}>
            <Ionicons
              name={isCameraOff ? 'videocam-off' : 'videocam'}
              size={26}
              color={isCameraOff ? colors.primaryForeground : colors.text}
            />
          </View>
          <Text style={[styles.controlLabel, isCameraOff && styles.controlLabelActive]}>
            {isCameraOff ? 'Off' : 'Camera'}
          </Text>
        </TouchableOpacity>

        {/* Flip camera */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => setIsFlipped((prev) => !prev)}
          activeOpacity={0.7}
        >
          <View style={[styles.controlCircle, isFlipped && styles.controlCircleActive]}>
            <Ionicons
              name="camera-reverse"
              size={26}
              color={isFlipped ? colors.primaryForeground : colors.text}
            />
          </View>
          <Text style={[styles.controlLabel, isFlipped && styles.controlLabelActive]}>
            Flip
          </Text>
        </TouchableOpacity>

        {/* End call */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={handleEndCall}
          activeOpacity={0.8}
        >
          <View style={styles.endCallCircle}>
            <Ionicons name="call" size={28} color={colors.white} style={styles.endCallIcon} />
          </View>
          <Text style={styles.endCallLabel}>End</Text>
        </TouchableOpacity>
      </View>

      {/* ── Premium time remaining (free users) ────────────────────────── */}
      {!isPremium && callActive && remainingLabel && (
        <View style={[styles.remainingBar, isLowTime && styles.remainingBarWarning]}>
          <Ionicons
            name={isLowTime ? 'warning' : 'time'}
            size={14}
            color={isLowTime ? colors.error : colors.accent}
          />
          <Text style={[styles.remainingText, isLowTime && styles.remainingTextWarning]}>
            {remainingLabel}
          </Text>
          <TouchableOpacity
            style={styles.upgradeBtn}
            onPress={() => {
              Alert.alert(
                'Upgrade to Premium',
                'Get unlimited video call duration with Premium.',
              );
            }}
          >
            <Text style={styles.upgradeBtnText}>Upgrade</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // ── Remote video area ──
  remoteVideoArea: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlaceholder: {
    alignItems: 'center',
    gap: 12,
  },
  placeholderLabel: {
    color: colors.border,
    fontSize: 16,
    fontWeight: '600',
  },
  placeholderSub: {
    color: colors.textMuted,
    fontSize: 12,
  },
  endedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  endedText: {
    color: colors.error,
    fontSize: 22,
    fontWeight: '700',
  },

  // ── Self-view overlay (bottom-right, FaceTime style) ──
  selfViewOverlay: {
    position: 'absolute',
    right: 16,
    width: 120,
    height: 160,
  },
  selfViewContainer: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selfViewPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selfViewLabel: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  selfViewText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // ── Header ──
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 100%)',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    alignItems: 'center',
  },
  callerName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  headerSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  headerStatus: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  timerText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
    marginLeft: 4,
  },
  headerEndBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endCallIcon: {
    transform: [{ rotate: '135deg' }],
  },

  // ── Controls row ──
  controlsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 36,
  },
  controlBtn: {
    alignItems: 'center',
    gap: 8,
  },
  controlCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlCircleActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  controlLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  controlLabelActive: {
    color: colors.accent,
  },
  endCallCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endCallLabel: {
    fontSize: 11,
    color: colors.error,
    fontWeight: '600',
  },

  // ── Remaining time bar (free users) ──
  remainingBar: {
    position: 'absolute',
    bottom: 140,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.2)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  remainingBarWarning: {
    backgroundColor: 'rgba(244, 63, 94, 0.1)',
    borderColor: 'rgba(244, 63, 94, 0.2)',
  },
  remainingText: {
    fontSize: 12,
    color: colors.accent,
    fontWeight: '500',
  },
  remainingTextWarning: {
    color: colors.error,
  },
  upgradeBtn: {
    backgroundColor: colors.accent,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  upgradeBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primaryForeground,
  },
});
