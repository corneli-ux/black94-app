/**
 * AudioCallScreen.tsx — Full-screen audio call UI with real Firestore signaling
 *
 * Call flow:
 * 1. Caller taps call button -> initiateCall() creates Firestore call doc (status: ringing)
 * 2. Receiver gets in-app notification -> taps to navigate to this screen
 * 3. Receiver taps "Accept" -> answerCall() updates status to 'connected'
 * 4. Caller polls and detects 'connected' -> shows connected state
 * 5. Either party taps "End" -> endCall() updates status to 'ended'
 *
 * Audio streaming requires a VoIP SDK (Agora/Twilio/ZEGO) integration.
 * The signaling layer (ringing -> answer -> end) is fully functional via Firestore.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { initiateCall, answerCall, endCall as endCallApi, pollCallStatus, CallData } from '../lib/api';
import { auth } from '../lib/firebase';
import { Avatar } from '../components/Avatar';
import { Platform } from 'react-native';
import { AppIcon } from '../components/icons';

type CallRole = 'caller' | 'receiver';
type CallStatus = 'initiating' | 'ringing' | 'connected' | 'ended';

const RING_TIMEOUT = 45000;
const POLL_INTERVAL = 1500;

export default function AudioCallScreen({ route, navigation }: any) {
  const { userId, userName, userProfileImage, callId: routeCallId, role: routeRole } = route.params;
  const insets = useSafeAreaInsets();

  const currentUser = auth()?.currentUser;
  const myId = currentUser?.uid;

  const [role, setRole] = useState<CallRole>(routeRole === 'receiver' ? 'receiver' : 'caller');
  const [callStatus, setCallStatus] = useState<CallStatus>(routeRole === 'receiver' ? 'ringing' : 'initiating');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showRedFlash, setShowRedFlash] = useState(false);
  const [callData, setCallData] = useState<CallData | null>(null);
  const [permissionShown, setPermissionShown] = useState(false);

  // ── Permission rationale dialog (Indus App Store compliance) ──────────
  useEffect(() => {
    if (Platform.OS === 'android' && !permissionShown) {
      Alert.alert(
        'Microphone Access',
        'Black94 needs access to your microphone for voice calls. You can manage this permission in your device settings at any time.',
        [
          { text: 'OK', onPress: () => setPermissionShown(true) },
        ],
      );
    }
  }, [permissionShown]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rippleAnims = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];
  const hasEndedRef = useRef(false);

  // Resolve the display name and profile image for the other party
  const displayName = callData
    ? (role === 'caller'
        ? (userName || 'Unknown')
        : (callData.callerName || 'Unknown'))
    : (userName || 'Unknown');

  const displayImage = callData
    ? (role === 'caller'
        ? (userProfileImage || null)
        : (callData.callerProfileImage || null))
    : (userProfileImage || null);

  // ── Caller: initiate the call ──────────────────────────────────────────
  useEffect(() => {
    if (role !== 'caller' || !userId || !myId) return;

    const startCall = async () => {
      try {
        const call = await initiateCall(userId, userName, userProfileImage || null);
        setCallData(call);
        setCallStatus('ringing');

        pollRef.current = setInterval(async () => {
          if (hasEndedRef.current) return;
          try {
            const updated = await pollCallStatus(call.id);
            if (!updated) {
              handleEnd();
              return;
            }
            setCallData(updated);
            if (updated.status === 'connected') {
              setCallStatus('connected');
              if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
              if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
            } else if (updated.status === 'ended' || updated.status === 'missed') {
              handleEnd();
            }
          } catch {}
        }, POLL_INTERVAL);

        ringTimeoutRef.current = setTimeout(() => {
          if (callStatus === 'ringing' && !hasEndedRef.current) {
            Alert.alert('Unanswered', `${userName || 'User'} didn't answer the call.`);
            handleEnd();
          }
        }, RING_TIMEOUT);

      } catch (e: any) {
        console.error('[Call] Failed to initiate:', e?.message || e);
        Alert.alert('Call Failed', e?.message || 'Could not start the call. Please try again.');
        navigation.goBack();
      }
    };

    startCall();

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
    };
  }, [role, userId, myId]);

  // ── Receiver: poll for call status ─────────────────────────────────────
  useEffect(() => {
    if (role !== 'receiver' || !routeCallId) return;

    pollRef.current = setInterval(async () => {
      if (hasEndedRef.current) return;
      try {
        const updated = await pollCallStatus(routeCallId);
        if (!updated) {
          handleEnd();
          return;
        }
        setCallData(updated);
        if (updated.status === 'ended' || updated.status === 'missed') {
          Alert.alert('Call Ended', 'The caller ended the call.');
          handleEnd();
        }
      } catch {}
    }, POLL_INTERVAL);

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [role, routeCallId]);

  // ── Receiver: answer the call ──────────────────────────────────────────
  const handleAccept = useCallback(async () => {
    if (!routeCallId) return;
    try {
      setCallStatus('connected');
      await answerCall(routeCallId);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    } catch (e: any) {
      console.error('[Call] Failed to answer:', e?.message || e);
      Alert.alert('Error', 'Could not answer the call.');
      handleEnd();
    }
  }, [routeCallId]);

  // ── Receiver: decline the call ─────────────────────────────────────────
  const handleDecline = useCallback(() => {
    handleEnd();
  }, []);

  // ── End call (shared) ─────────────────────────────────────────────────
  const handleEnd = useCallback(async () => {
    if (hasEndedRef.current) return;
    hasEndedRef.current = true;

    setShowRedFlash(true);
    setCallStatus('ended');
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }

    const callIdToUpdate = callData?.id || routeCallId;
    if (callIdToUpdate) {
      try { await endCallApi(callIdToUpdate); } catch {}
    }

    setTimeout(() => {
      navigation.goBack();
    }, 600);
  }, [callData, routeCallId, navigation]);

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

  // ── Pulse + ripple animations while ringing ────────────────────────────
  useEffect(() => {
    if (callStatus !== 'ringing') {
      pulseAnim.stopAnimation();
      rippleAnims.forEach(a => a.stopAnimation());
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.06,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();

    const ripples = rippleAnims.map((anim, i) => {
      const ripple = Animated.loop(
        Animated.sequence([
          Animated.delay(i * 800),
          Animated.timing(anim, {
            toValue: 1,
            duration: 2400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      ripple.start();
      return ripple;
    });

    return () => {
      pulse.stop();
      ripples.forEach(r => r.stop());
    };
  }, [callStatus, pulseAnim]);

  // ── Helpers ────────────────────────────────────────────────────────────
  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const getStatusText = () => {
    switch (callStatus) {
      case 'initiating': return 'Calling...';
      case 'ringing': return role === 'caller' ? 'Ringing...' : 'Incoming Call';
      case 'connected': return 'Connected';
      case 'ended': return 'Call Ended';
    }
  };

  const getStatusColor = () => {
    switch (callStatus) {
      case 'initiating': return '#D4AF37';
      case 'ringing': return '#D4AF37';
      case 'connected': return '#4ade80';
      case 'ended': return '#f43f5e';
    }
  };

  const statusColor = getStatusColor();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* Red flash overlay on end call */}
      {showRedFlash && <View style={styles.redFlash} />}

      {/* Audio streaming notice */}
      <View style={styles.audioNotice}>
        <AppIcon name="info" size="sm" color={colors.white50} />
        <Text style={styles.audioNoticeText}>Audio streaming coming soon — call signaling is active</Text>
      </View>

      {/* Top area — back hint (for caller initiating) */}
      <View style={[styles.topArea, { paddingTop: insets.top || 12 }]}>
        <Text style={styles.topHint}>
          {callStatus === 'initiating' ? 'BLACK94 Voice Call' :
           callStatus === 'ringing' && role === 'receiver' ? 'Incoming Voice Call' :
           callStatus === 'connected' ? 'Voice Call Active' : ''}
        </Text>
      </View>

      {/* Ripple rings while ringing */}
      {callStatus === 'ringing' && (
        <View style={styles.rippleContainer}>
          {rippleAnims.map((anim, i) => (
            <Animated.View
              key={i}
              style={[
                styles.rippleRing,
                {
                  transform: [{ scale: anim }],
                  opacity: 1 - (anim as any)._value,
                },
              ]}
            />
          ))}
        </View>
      )}

      {/* Avatar with pulse animation */}
      <Animated.View
        style={[
          styles.avatarWrapper,
          callStatus === 'ringing' && { transform: [{ scale: pulseAnim }] },
        ]}>
        <View style={styles.avatarRing}>
          <Avatar
            uri={displayImage}
            name={displayName}
            size={108}
          />
        </View>
      </Animated.View>

      {/* Caller info */}
      <Text style={styles.callerName}>{displayName}</Text>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={[styles.statusText, { color: statusColor }]}>
          {getStatusText()}
        </Text>
      </View>

      {/* Timer */}
      {(callStatus === 'connected' || (callStatus === 'ended' && elapsed > 0)) && (
        <Text style={styles.timerText}>{formatTime(elapsed)}</Text>
      )}

      {/* Spacer */}
      <View style={styles.spacer} />

      {/* ── Connected: Mute / Speaker / End ── */}
      {callStatus === 'connected' ? (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => setIsMuted((prev) => !prev)}
            activeOpacity={0.7}>
            <View style={[styles.actionCircle, isMuted && styles.actionCircleActive]}>
              <AppIcon
                name={isMuted ? 'mic-off' : 'mic'}
                size={26}
                color={isMuted ? colors.primaryForeground : colors.text}
              />
            </View>
            <Text style={[styles.actionLabel, isMuted && styles.actionLabelActive]}>
              {isMuted ? 'Muted' : 'Mic'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => setIsSpeaker((prev) => !prev)}
            activeOpacity={0.7}>
            <View style={[styles.actionCircle, isSpeaker && styles.actionCircleActive]}>
              <AppIcon
                name={isSpeaker ? 'volume-up' : 'volume-down'}
                size={26}
                color={isSpeaker ? colors.primaryForeground : colors.text}
              />
            </View>
            <Text style={[styles.actionLabel, isSpeaker && styles.actionLabelActive]}>
              Speaker
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleEnd}
            activeOpacity={0.8}>
            <View style={styles.endCircle}>
              <AppIcon name="call" size="xxl" color={colors.white} />
            </View>
            <Text style={styles.endLabel}>End</Text>
          </TouchableOpacity>
        </View>
      ) : (callStatus === 'ringing' || callStatus === 'initiating') ? (
        /* ── Ringing / Initiating: Accept / Decline / Cancel ── */
        <View style={styles.actionsRow}>
          {role === 'receiver' ? (
            <>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={handleDecline}
                activeOpacity={0.8}>
                <View style={styles.declineCircle}>
                  <AppIcon name="call" size={30} color={colors.white} />
                </View>
                <Text style={styles.declineLabel}>Decline</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionBtn}
                onPress={handleAccept}
                activeOpacity={0.8}>
                <View style={styles.acceptCircle}>
                  <AppIcon name="call" size={30} color={colors.white} />
                </View>
                <Text style={styles.acceptLabel}>Accept</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleEnd}
              activeOpacity={0.8}>
              <View style={styles.endCircle}>
                <AppIcon name="call" size="xxl" color={colors.white} />
              </View>
              <Text style={styles.endLabel}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      {/* Bottom safe area spacer */}
      <View style={{ height: Math.max(insets.bottom, 40) + 20 }} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primaryForeground,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  redFlash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    zIndex: 100,
  },
  audioNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    backgroundColor: colors.bgInput,
  },
  audioNoticeText: {
    color: colors.white50,
    fontSize: 11,
  },
  topArea: {
    width: '100%',
    alignItems: 'center',
    paddingBottom: 8,
  },
  topHint: {
    color: colors.textTertiary,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  rippleContainer: {
    position: 'absolute',
    top: '28%',
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
    borderWidth: 1.5,
    borderColor: colors.accentBgStrong,
  },
  avatarWrapper: {
    marginTop: 20,
    marginBottom: 20,
  },
  avatarRing: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.accentFaint,
    borderWidth: 2.5,
    borderColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
  },
  callerName: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
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

  // ── Action buttons row ──
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 48,
    marginBottom: 12,
  },
  actionBtn: {
    alignItems: 'center',
    gap: 10,
  },
  actionCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionCircleActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  actionLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  actionLabelActive: {
    color: colors.accent,
  },

  // ── End call ──
  endCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.like,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '135deg' }],
  },
  endLabel: {
    fontSize: 12,
    color: colors.like,
    fontWeight: '500',
  },

  // ── Accept (receiver) ──
  acceptCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accentGreen,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acceptLabel: {
    fontSize: 14,
    color: colors.accentGreen,
    fontWeight: '600',
  },

  // ── Decline (receiver) ──
  declineCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.like,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '135deg' }],
  },
  declineLabel: {
    fontSize: 14,
    color: colors.like,
    fontWeight: '600',
  },
});
