/**
 * AudioCallScreen.tsx — Full-screen WebRTC audio call UI
 *
 * Architecture:
 *   - Tries to import react-native-webrtc at module level.
 *   - If available, creates real RTCPeerConnections for the call.
 *   - If NOT available, falls back to a simulated call UI.
 *
 * Route params:
 *   chatId: string          — Chat room ID for signaling
 *   callerId: string        — Remote user's UID
 *   callerName: string      — Display name of the caller
 *   callerAvatar: string    — Avatar URL (optional)
 *   isIncoming: boolean     — true = receiving, false = placing
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
  Image,
} from 'react-native';
// useNavigation/useRoute available from @react-navigation/native if needed
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

/* ═══════════════════════════════════════════════════════════════════════════
   WebRTC module detection — try/catch at module scope
   ═══════════════════════════════════════════════════════════════════════════ */

let WebRTCModule: any = null;
try {
  WebRTCModule = require('react-native-webrtc');
} catch {
  // react-native-webrtc not installed — simulated UI will be used
}

const HAS_WEBRTC = !!WebRTCModule;

/* ═══════════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════════ */

type CallStatus = 'ringing' | 'calling' | 'connected' | 'ended';

interface CallScreenParams {
  chatId: string;
  callerId: string;
  callerName: string;
  callerAvatar?: string;
  isIncoming?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════════
   WebRTC signaling helpers (used when react-native-webrtc is available)
   ═══════════════════════════════════════════════════════════════════════════ */

interface SignalingMessage {
  type: 'offer' | 'answer' | 'candidate' | 'hangup';
  callerId: string;
  chatId: string;
  sdp?: any;
  candidate?: any;
}

async function sendSignalingMessage(_msg: SignalingMessage): Promise<void> {
  // Placeholder: integrate with your signaling backend (Firebase Realtime DB,
  // Socket.io, etc.) to relay SDP offers/answers and ICE candidates.
  console.log('[WebRTC] Signal:', _msg.type, 'for chat:', _msg.chatId);
}

/* ═══════════════════════════════════════════════════════════════════════════
   ICE servers configuration
   ═══════════════════════════════════════════════════════════════════════════ */

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/* ═══════════════════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════════════════ */

export default function AudioCallScreen({ route, navigation }: any) {
  const params = (route?.params || {}) as Partial<CallScreenParams>;
  const {
    chatId = '',
    callerId = '',
    callerName = 'Unknown',
    callerAvatar = '',
    isIncoming = false,
  } = params;


  // ── State ──
  const [callStatus, setCallStatus] = useState<CallStatus>(isIncoming ? 'ringing' : 'calling');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showRedFlash, setShowRedFlash] = useState(false);

  // ── Refs ──
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rippleAnim = useRef(new Animated.Value(0)).current;
  const peerConnectionRef = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const mountedRef = useRef(true);

  // ── Cleanup on unmount ──
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      cleanupPeerConnection();
    };
  }, []);

  // ── Simulated call flow (connect after 2 seconds) ──
  useEffect(() => {
    const connectTimeout = setTimeout(() => {
      if (!mountedRef.current) return;

      if (HAS_WEBRTC) {
        setupWebRTC();
      }
      setCallStatus('connected');
    }, 2000);

    return () => clearTimeout(connectTimeout);
  }, []);

  // ── Timer when connected ──
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

  // ── Pulse / ripple animation while ringing/calling ──
  useEffect(() => {
    if (callStatus !== 'ringing' && callStatus !== 'calling') {
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

  /* ═══════════════════════════════════════════════════════════════════════════
     WebRTC setup (real peer connection when module is available)
     ═══════════════════════════════════════════════════════════════════════════ */

  const setupWebRTC = useCallback(async () => {
    if (!HAS_WEBRTC) return;

    try {
      const { mediaDevices, RTCPeerConnection } = WebRTCModule;

      // Get local audio stream
      const stream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStreamRef.current = stream;

      // Create peer connection
      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnectionRef.current = pc;

      // Add local tracks
      stream.getTracks().forEach((track: any) => {
        pc.addTrack(track, stream);
      });

      // ICE candidate handling
      pc.onicecandidate = (event: any) => {
        if (event.candidate) {
          sendSignalingMessage({
            type: 'candidate',
            callerId,
            chatId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      // Remote stream handling
      pc.ontrack = (event: any) => {
        console.log('[WebRTC] Remote track received');
        // Connect remote audio stream to an Audio element if needed
      };

      // Connection state changes
      pc.onconnectionstatechange = () => {
        console.log('[WebRTC] Connection state:', pc.connectionState);
        if (
          pc.connectionState === 'disconnected' ||
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed'
        ) {
          handleEndCall();
        }
      };

      // Create offer (caller) or wait for offer (callee)
      if (!isIncoming) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        sendSignalingMessage({
          type: 'offer',
          callerId,
          chatId,
          sdp: offer,
        });
      }
      // When incoming: your signaling layer should listen for 'offer' messages
      // and call pc.setRemoteDescription() + pc.createAnswer() + pc.setLocalDescription()
      // then send the answer back via sendSignalingMessage({ type: 'answer', ... })
    } catch (err) {
      console.error('[WebRTC] Setup failed:', err);
      // Fall back gracefully — UI still works in simulated mode
    }
  }, [callerId, chatId, isIncoming]);

  const cleanupPeerConnection = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track: any) => track.stop());
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
  }, []);

  /* ═══════════════════════════════════════════════════════════════════════════
     Actions
     ═══════════════════════════════════════════════════════════════════════════ */

  const handleEndCall = useCallback(() => {
    setShowRedFlash(true);
    setCallStatus('ended');
    if (timerRef.current) clearInterval(timerRef.current);
    cleanupPeerConnection();

    // Notify remote peer
    sendSignalingMessage({
      type: 'hangup',
      callerId,
      chatId,
    });

    setTimeout(() => {
      navigation.goBack();
    }, 600);
  }, [navigation, callerId, chatId, cleanupPeerConnection]);

  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);

    // Mute local audio tracks
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track: any) => {
        track.enabled = !newMuted;
      });
    }
  }, [isMuted]);

  const toggleSpeaker = useCallback(() => {
    setIsSpeaker((prev) => !prev);
  }, []);

  /* ═══════════════════════════════════════════════════════════════════════════
     Helpers
     ═══════════════════════════════════════════════════════════════════════════ */

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const getStatusText = (): string => {
    switch (callStatus) {
      case 'ringing':
        return 'Ringing...';
      case 'calling':
        return 'Calling...';
      case 'connected':
        return `Connected ${formatTime(elapsed)}`;
      case 'ended':
        return 'Call Ended';
    }
  };

  const getStatusColor = (): string => {
    switch (callStatus) {
      case 'ringing':
      case 'calling':
        return colors.accentGold;
      case 'connected':
        return colors.accentGreen;
      case 'ended':
        return colors.error;
    }
  };

  const isAnimating = callStatus === 'ringing' || callStatus === 'calling';

  /* ═══════════════════════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════════════════════ */

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* Red flash overlay on end call */}
      {showRedFlash && <View style={styles.redFlash} />}

      {/* Ripple rings while ringing/calling */}
      {isAnimating && (
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
          isAnimating && { transform: [{ scale: pulseAnim }] },
        ]}
      >
        {callerAvatar ? (
          <Image
            source={{ uri: callerAvatar }}
            style={styles.avatarImage}
          />
        ) : (
          <View style={styles.avatarOuter}>
            <View style={styles.avatarInner}>
              <Text style={styles.avatarInitial}>
                {callerName[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          </View>
        )}
      </Animated.View>

      {/* Caller info */}
      <Text style={styles.callerName}>{callerName}</Text>

      {/* Status with dot */}
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
        <Text style={[styles.statusText, { color: getStatusColor() }]}>
          {getStatusText()}
        </Text>
      </View>

      {/* Spacer */}
      <View style={styles.spacer} />

      {/* WebRTC availability indicator (debug, remove in production) */}
      {/* {HAS_WEBRTC && (
        <View style={styles.webrtcBadge}>
          <Ionicons name="shield-checkmark" size={12} color={colors.accentGreen} />
          <Text style={styles.webrtcBadgeText}>WebRTC Active</Text>
        </View>
      )} */}

      {/* Action buttons */}
      <View style={styles.actionsContainer}>
        {/* Mute */}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={toggleMute}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.actionIconBg,
              isMuted && styles.actionIconBgActive,
            ]}
          >
            <Ionicons
              name={isMuted ? 'mic-off' : 'mic'}
              size={28}
              color={isMuted ? colors.text : '#FFFFFF'}
            />
          </View>
          <Text style={[styles.actionLabel, isMuted && styles.actionLabelActive]}>
            {isMuted ? 'Muted' : 'Mic'}
          </Text>
        </TouchableOpacity>

        {/* End Call (centered, larger, red) */}
        <TouchableOpacity
          style={styles.endCallButton}
          onPress={handleEndCall}
          activeOpacity={0.8}
        >
          <View style={styles.endCallIconBg}>
            <Ionicons name="call" size={32} color="#FFFFFF" />
          </View>
          <Text style={styles.endCallLabel}>End</Text>
        </TouchableOpacity>

        {/* Speaker */}
        <TouchableOpacity
          style={styles.actionButton}
          onPress={toggleSpeaker}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.actionIconBg,
              isSpeaker && styles.actionIconBgActive,
            ]}
          >
            <Ionicons
              name={isSpeaker ? 'volume-high' : 'volume-medium'}
              size={28}
              color={isSpeaker ? colors.text : '#FFFFFF'}
            />
          </View>
          <Text style={[styles.actionLabel, isSpeaker && styles.actionLabelActive]}>
            {isSpeaker ? 'Speaker' : 'Phone'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Safe area bottom spacer */}
      <View style={styles.bottomSpacer} />
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Styles
   ═══════════════════════════════════════════════════════════════════════════ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
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

  // ── Avatar ──
  avatarWrapper: {
    marginBottom: 28,
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceLight,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  avatarOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(29, 155, 240, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  avatarInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitial: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
  },

  // ── Caller info ──
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

  // ── Layout ──
  spacer: {
    flex: 1,
  },

  // ── Action buttons ──
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  actionButton: {
    alignItems: 'center',
    gap: 8,
  },
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
    backgroundColor: colors.surfaceElevated,
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
  endCallButton: {
    alignItems: 'center',
    gap: 8,
  },
  endCallIconBg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endCallLabel: {
    fontSize: 12,
    color: colors.error,
    fontWeight: '500',
  },

  // ── Bottom safe area ──
  bottomSpacer: {
    height: 60,
  },

  // ── WebRTC badge (hidden) ──
  webrtcBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 24,
  },
  webrtcBadgeText: {
    fontSize: 11,
    color: colors.accentGreen,
    fontWeight: '600',
  },
});
