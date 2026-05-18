/**
 * AudioCallScreen.tsx — Full-screen audio call UI
 *
 * BETA: This screen shows the call UI but does not establish a real
 * VoIP connection. Audio/VoIP integration (Agora/Twilio) is needed for
 * actual calling functionality.
 *
 * Current flow: Calling (3s timer) → Connected (timer) → End Call → navigate back.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Animated,
  Easing,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors } from '../theme/colors';

type CallStatus = 'calling' | 'connected' | 'ended';

export default function AudioCallScreen({ route, navigation }: any) {
  const { userId, userName } = route.params;

  const [callStatus, setCallStatus] = useState<CallStatus>('calling');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showRedFlash, setShowRedFlash] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rippleAnim = useRef(new Animated.Value(0)).current;

  // ── Preview call flow (no real VoIP connection) ────────────────────────
  useEffect(() => {
    // After 3s, show connected state
    const connectTimeout = setTimeout(() => {
      setCallStatus('connected');
    }, 3000);

    return () => clearTimeout(connectTimeout);
  }, []);

  // ── Timer when connected ───────────────────────────────────────────────
  useEffect(() => {
    if (callStatus === 'connected') {
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callStatus]);

  // ── Pulse animation while calling ──────────────────────────────────────
  useEffect(() => {
    if (callStatus !== 'calling') {
      pulseAnim.stopAnimation();
      rippleAnim.stopAnimation();
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();

    const ripple = Animated.loop(
      Animated.sequence([
        Animated.timing(rippleAnim, {
          toValue: 1,
          duration: 2500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    ripple.start();

    return () => {
      pulse.stop();
      ripple.stop();
    };
  }, [callStatus, pulseAnim, rippleAnim]);

  // ── Format timer ───────────────────────────────────────────────────────
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // ── End call ───────────────────────────────────────────────────────────
  const handleEndCall = useCallback(() => {
    setShowRedFlash(true);
    setCallStatus('ended');
    if (timerRef.current) clearInterval(timerRef.current);

    setTimeout(() => {
      navigation.goBack();
    }, 600);
  }, [navigation]);

  // ── Status text ────────────────────────────────────────────────────────
  const getStatusText = () => {
    switch (callStatus) {
      case 'calling':
        return 'Calling...';
      case 'connected':
        return 'Connected';
      case 'ended':
        return 'Call Ended';
    }
  };

  const getStatusColor = () => {
    switch (callStatus) {
      case 'calling':
        return colors.accentGold;
      case 'connected':
        return colors.accentGreen;
      case 'ended':
        return colors.error;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* Beta banner — audio calls are preview-only */}
      <View style={styles.betaBanner}>
        <Text style={styles.betaBannerText}>BETA — Voice calls coming soon</Text>
      </View>

      {/* Red flash overlay on end call */}
      {showRedFlash && <View style={styles.redFlash} />}

      {/* Gradient overlay */}
      <View style={styles.gradientOverlay} />

      {/* Ripple rings while calling */}
      {callStatus === 'calling' && (
        <View style={styles.rippleContainer}>
          {[0, 1, 2].map((i) => (
            <Animated.View
              key={i}
              style={[
                styles.rippleRing,
                {
                  transform: [{ scale: rippleAnim }],
                  opacity: 1 - (rippleAnim as any)._value,
                },
              ]}
            />
          ))}
        </View>
      )}

      {/* Avatar */}
      <Animated.View
        style={[
          styles.avatarWrapper,
          callStatus === 'calling' && { transform: [{ scale: pulseAnim }] },
        ]}>
        <View style={styles.avatarOuter}>
          <View style={styles.avatarInner}>
            <Text style={styles.avatarInitial}>
              {(userName ?? 'U')[0].toUpperCase()}
            </Text>
          </View>
        </View>
      </Animated.View>

      {/* Caller info */}
      <Text style={styles.callerName}>{userName ?? 'Unknown'}</Text>
      <View style={styles.statusRow}>
        <View
          style={[styles.statusDot, { backgroundColor: getStatusColor() }]}
        />
        <Text style={[styles.statusText, { color: getStatusColor() }]}>
          {getStatusText()}
        </Text>
      </View>

      {/* Timer */}
      {callStatus === 'connected' && (
        <Text style={styles.timerText}>{formatTime(elapsed)}</Text>
      )}
      {callStatus === 'ended' && (
        <Text style={styles.timerText}>{formatTime(elapsed)}</Text>
      )}

      {/* Spacer */}
      <View style={styles.spacer} />

      {/* Action buttons */}
      <View style={styles.actionsContainer}>
        {/* Mute */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            isMuted && styles.actionButtonActive,
          ]}
          onPress={() => setIsMuted((prev) => !prev)}
          activeOpacity={0.7}>
          <View
            style={[
              styles.actionIconBg,
              isMuted && styles.actionIconBgActive,
            ]}>
            <Text style={styles.actionIcon}>
              {isMuted ? '🔇' : '🎙️'}
            </Text>
          </View>
          <Text style={[styles.actionLabel, isMuted && styles.actionLabelActive]}>
            {isMuted ? 'Muted' : 'Mic'}
          </Text>
        </TouchableOpacity>

        {/* Speaker */}
        <TouchableOpacity
          style={[
            styles.actionButton,
            isSpeaker && styles.actionButtonActive,
          ]}
          onPress={() => setIsSpeaker((prev) => !prev)}
          activeOpacity={0.7}>
          <View
            style={[
              styles.actionIconBg,
              isSpeaker && styles.actionIconBgActive,
            ]}>
            <Text style={styles.actionIcon}>
              {isSpeaker ? '🔊' : '🔈'}
            </Text>
          </View>
          <Text
            style={[styles.actionLabel, isSpeaker && styles.actionLabelActive]}>
            {isSpeaker ? 'Speaker' : 'Speaker'}
          </Text>
        </TouchableOpacity>

        {/* End Call */}
        <TouchableOpacity
          style={styles.endCallButton}
          onPress={handleEndCall}
          activeOpacity={0.8}>
          <View style={styles.endCallIconBg}>
            <Text style={styles.endCallIcon}>📱</Text>
          </View>
          <Text style={styles.endCallLabel}>End</Text>
        </TouchableOpacity>
      </View>

      {/* Safe area bottom spacer */}
      <View style={styles.bottomSpacer} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  redFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(239, 68, 68, 0.3)',
    zIndex: 100,
  },
  rippleContainer: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rippleRing: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  avatarWrapper: {
    marginBottom: 24,
  },
  avatarOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(42, 127, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  avatarInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 40,
    fontWeight: '700',
    color: colors.text,
  },
  callerName: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '500',
  },
  timerText: {
    fontSize: 18,
    fontWeight: '300',
    color: colors.textSecondary,
    letterSpacing: 2,
    marginTop: 4,
  },
  spacer: {
    flex: 1,
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  actionButton: {
    alignItems: 'center',
    gap: 8,
  },
  actionButtonActive: {},
  actionIconBg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIconBgActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionIcon: {
    fontSize: 24,
  },
  actionLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  actionLabelActive: {
    color: colors.primary,
  },
  endCallButton: {
    alignItems: 'center',
    gap: 8,
  },
  endCallIconBg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endCallIcon: {
    fontSize: 24,
  },
  endCallLabel: {
    fontSize: 12,
    color: colors.error,
    fontWeight: '500',
  },
  bottomSpacer: {
    height: 60,
  },
  betaBanner: {
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.3)',
    paddingVertical: 6,
    alignItems: 'center',
  },
  betaBannerText: {
    color: '#D4AF37',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
