/**
 * AudioCallScreen.tsx — Full-screen audio call UI with real Firestore signaling
 *
 * Call flow:
 * 1. Caller taps call button → initiateCall() creates Firestore call doc (status: ringing)
 * 2. Receiver gets in-app notification → taps to navigate to this screen
 * 3. Receiver taps "Accept" → answerCall() updates status to 'connected'
 * 4. Caller polls and detects 'connected' → shows connected state
 * 5. Either party taps "End" → endCall() updates status to 'ended'
 *
 * Audio streaming requires a VoIP SDK (Agora/Twilio/ZEGO) integration.
 * The signaling layer (ringing → answer → end) is fully functional via Firestore.
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
  ActivityIndicator,
  Alert,
} from 'react-native';
import { colors } from '../theme/colors';
import { initiateCall, answerCall, endCall as endCallApi, pollCallStatus, CallData } from '../lib/api';
import { auth } from '../lib/firebase';

type CallRole = 'caller' | 'receiver';
type CallStatus = 'initiating' | 'ringing' | 'connected' | 'ended';

const RING_TIMEOUT = 45000; // 45 seconds before auto-ending unanswered call
const POLL_INTERVAL = 1500; // Poll every 1.5 seconds

export default function AudioCallScreen({ route, navigation }: any) {
  const { userId, userName, userProfileImage, callId: routeCallId, role: routeRole } = route.params;

  const currentUser = auth()?.currentUser;
  const myId = currentUser?.uid;

  // Determine role: if routeRole is 'receiver', we're answering. Otherwise, we're calling.
  const [role, setRole] = useState<CallRole>(routeRole === 'receiver' ? 'receiver' : 'caller');
  const [callStatus, setCallStatus] = useState<CallStatus>(routeRole === 'receiver' ? 'ringing' : 'initiating');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showRedFlash, setShowRedFlash] = useState(false);
  const [callData, setCallData] = useState<CallData | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rippleAnim = useRef(new Animated.Value(0)).current;
  const hasEndedRef = useRef(false);

  // ── Caller: initiate the call ──────────────────────────────────────────
  useEffect(() => {
    if (role !== 'caller' || !userId || !myId) return;

    const startCall = async () => {
      try {
        const call = await initiateCall(userId, userName, userProfileImage || null);
        setCallData(call);
        setCallStatus('ringing');

        // Start polling for status changes
        pollRef.current = setInterval(async () => {
          if (hasEndedRef.current) return;
          try {
            const updated = await pollCallStatus(call.id);
            if (!updated) {
              // Call doc was deleted
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

        // Auto-end after 45s if no answer
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

  // ── Receiver: poll for call status (caller may end the call while ringing) ──
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

  // ── End call (shared by caller and receiver) ───────────────────────────
  const handleEnd = useCallback(async () => {
    if (hasEndedRef.current) return;
    hasEndedRef.current = true;

    setShowRedFlash(true);
    setCallStatus('ended');
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }

    // Fire-and-forget: update the call document
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

  // ── Pulse animation while ringing ──────────────────────────────────────
  useEffect(() => {
    if (callStatus !== 'ringing') {
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

  // ── Status text ────────────────────────────────────────────────────────
  const getStatusText = () => {
    switch (callStatus) {
      case 'initiating':
        return 'Calling...';
      case 'ringing':
        return role === 'caller' ? 'Ringing...' : 'Incoming Call';
      case 'connected':
        return 'Connected';
      case 'ended':
        return 'Call Ended';
    }
  };

  const getStatusColor = () => {
    switch (callStatus) {
      case 'initiating':
        return '#D4AF37';
      case 'ringing':
        return '#D4AF37';
      case 'connected':
        return '#4ade80';
      case 'ended':
        return '#f43f5e';
    }
  };

  const displayName = callData
    ? (role === 'caller'
        ? (userName || 'Unknown')
        : (callData.callerName || 'Unknown'))
    : (userName || 'Unknown');

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* Red flash overlay on end call */}
      {showRedFlash && <View style={styles.redFlash} />}

      {/* Gradient overlay */}
      <View style={styles.gradientOverlay} />

      {/* Ripple rings while ringing */}
      {callStatus === 'ringing' && (
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
          callStatus === 'ringing' && { transform: [{ scale: pulseAnim }] },
        ]}>
        <View style={styles.avatarOuter}>
          <View style={styles.avatarInner}>
            <Text style={styles.avatarInitial}>
              {(displayName ?? 'U')[0].toUpperCase()}
            </Text>
          </View>
        </View>
      </Animated.View>

      {/* Caller info */}
      <Text style={styles.callerName}>{displayName}</Text>
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
      {callStatus === 'ended' && elapsed > 0 && (
        <Text style={styles.timerText}>{formatTime(elapsed)}</Text>
      )}

      {/* Spacer */}
      <View style={styles.spacer} />

      {/* Action buttons — shown when connected */}
      {callStatus === 'connected' ? (
        <View style={styles.actionsContainer}>
          {/* Mute */}
          <TouchableOpacity
            style={styles.actionButton}
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
            style={styles.actionButton}
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
              Speaker
            </Text>
          </TouchableOpacity>

          {/* End Call */}
          <TouchableOpacity
            style={styles.endCallButton}
            onPress={handleEnd}
            activeOpacity={0.8}>
            <View style={styles.endCallIconBg}>
              <Text style={styles.endCallIcon}>📱</Text>
            </View>
            <Text style={styles.endCallLabel}>End</Text>
          </TouchableOpacity>
        </View>
      ) : callStatus === 'ringing' || callStatus === 'initiating' ? (
        /* Ringing / Initiating — Accept/Decline buttons */
        <View style={styles.ringingActionsContainer}>
          {role === 'receiver' ? (
            <>
              {/* Decline */}
              <TouchableOpacity
                style={styles.declineButton}
                onPress={handleDecline}
                activeOpacity={0.8}>
                <View style={styles.declineIconBg}>
                  <Text style={styles.declineIcon}>📞</Text>
                </View>
                <Text style={styles.declineLabel}>Decline</Text>
              </TouchableOpacity>

              {/* Accept */}
              <TouchableOpacity
                style={styles.acceptButton}
                onPress={handleAccept}
                activeOpacity={0.8}>
                <View style={styles.acceptIconBg}>
                  <Text style={styles.acceptIcon}>✓</Text>
                </View>
                <Text style={styles.acceptLabel}>Accept</Text>
              </TouchableOpacity>
            </>
          ) : (
            /* Caller: only end button while ringing */
            <TouchableOpacity
              style={styles.endCallButton}
              onPress={handleEnd}
              activeOpacity={0.8}>
              <View style={styles.endCallIconBg}>
                <Text style={styles.endCallIcon}>📱</Text>
              </View>
              <Text style={styles.endCallLabel}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}

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
    borderColor: 'rgba(212, 175, 55, 0.2)',
  },
  avatarWrapper: {
    marginBottom: 24,
  },
  avatarOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#D4AF37',
  },
  avatarInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#16181c',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 40,
    fontWeight: '700',
    color: '#D4AF37',
  },
  callerName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#e7e9ea',
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
    color: '#94a3b8',
    letterSpacing: 2,
    marginTop: 4,
  },
  spacer: {
    flex: 1,
  },
  // Connected actions (mute, speaker, end)
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
    backgroundColor: '#16181c',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  actionIconBgActive: {
    backgroundColor: '#D4AF37',
    borderColor: '#D4AF37',
  },
  actionIcon: {
    fontSize: 24,
  },
  actionLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },
  actionLabelActive: {
    color: '#D4AF37',
  },
  endCallButton: {
    alignItems: 'center',
    gap: 8,
  },
  endCallIconBg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#f43f5e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  endCallIcon: {
    fontSize: 24,
  },
  endCallLabel: {
    fontSize: 12,
    color: '#f43f5e',
    fontWeight: '500',
  },
  // Ringing actions (accept, decline)
  ringingActionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 60,
  },
  acceptButton: {
    alignItems: 'center',
    gap: 8,
  },
  acceptIconBg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#4ade80',
    justifyContent: 'center',
    alignItems: 'center',
  },
  acceptIcon: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000000',
  },
  acceptLabel: {
    fontSize: 14,
    color: '#4ade80',
    fontWeight: '600',
  },
  declineButton: {
    alignItems: 'center',
    gap: 8,
  },
  declineIconBg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#f43f5e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  declineIcon: {
    fontSize: 24,
  },
  declineLabel: {
    fontSize: 14,
    color: '#f43f5e',
    fontWeight: '600',
  },
  bottomSpacer: {
    height: 60,
  },
});
