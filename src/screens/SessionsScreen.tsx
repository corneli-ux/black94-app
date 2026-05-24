/**
 * SessionsScreen.tsx — Shows active login sessions for the current user.
 *
 * Fetches sessions from Firestore subcollection: users/{userId}/sessions
 * Each session doc: { deviceName, platform, lastActive, ipAddress, isCurrent }
 *
 * Features:
 * - Device icon based on platform (phone/tablet/desktop)
 * - "Current session" badge for the active one
 * - "Sign out other sessions" bulk action
 * - Individual "Sign out" per session
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { firestore } from '../lib/firebase';
import { AppIcon } from '../components/icons';

interface Session {
  id: string;
  deviceName: string;
  platform: string; // 'ios' | 'android' | 'web' | 'tablet'
  lastActive: any; // Firestore Timestamp
  ipAddress: string;
  isCurrent: boolean;
}

const PLATFORM_ICONS: Record<string, string> = {
  ios: 'phone-portrait-outline',
  android: 'phone-portrait-outline',
  web: 'desktop-outline',
  tablet: 'tablet-portrait-outline',
};

const PLATFORM_LABELS: Record<string, string> = {
  ios: 'iOS',
  android: 'Android',
  web: 'Web',
  tablet: 'Tablet',
};

export default function SessionsScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAppStore();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState<string | null>(null);
  const [signingOutAll, setSigningOutAll] = useState(false);

  // ── Fetch sessions ───────────────────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const snapshot = await firestore()
        .collection('users')
        .doc(user.id)
        .collection('sessions')
        .orderBy('lastActive', 'desc')
        .get();

      const items: Session[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          deviceName: data.deviceName || 'Unknown Device',
          platform: data.platform || 'web',
          lastActive: data.lastActive || null,
          ipAddress: data.ipAddress || '',
          isCurrent: data.isCurrent || false,
        };
      });

      setSessions(items);
    } catch (err) {
      console.error('[Sessions] Failed to fetch:', err);
      Alert.alert('Error', 'Could not load sessions.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // ── Format relative time ─────────────────────────────────────────────
  const formatLastActive = (timestamp: any): string => {
    if (!timestamp) return 'Unknown';
    try {
      const date = typeof timestamp === 'string' || typeof timestamp === 'number'
        ? new Date(timestamp)
        : new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    } catch {
      return 'Unknown';
    }
  };

  // ── Sign out single session ──────────────────────────────────────────
  const handleSignOutSession = async (sessionId: string, deviceName: string) => {
    if (!user?.id) return;

    Alert.alert(
      'Sign Out Device',
      `Sign out "${deviceName}"? That device will need to log in again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setSigningOut(sessionId);
            try {
              await firestore()
                .collection('users')
                .doc(user.id)
                .collection('sessions')
                .doc(sessionId)
                .delete();
              setSessions((prev) => prev.filter((s) => s.id !== sessionId));
            } catch (err) {
              console.error('[Sessions] Sign out error:', err);
              Alert.alert('Error', 'Could not sign out device.');
            } finally {
              setSigningOut(null);
            }
          },
        },
      ],
    );
  };

  // ── Sign out all other sessions ──────────────────────────────────────
  const handleSignOutAllOthers = async () => {
    if (!user?.id) return;

    const otherCount = sessions.filter((s) => !s.isCurrent).length;
    if (otherCount === 0) {
      Alert.alert('No Other Sessions', 'You only have one active session.');
      return;
    }

    Alert.alert(
      'Sign Out All Other Sessions',
      `This will sign out ${otherCount} other device${otherCount > 1 ? 's' : ''}. They will need to log in again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Sign Out ${otherCount} Device${otherCount > 1 ? 's' : ''}`,
          style: 'destructive',
          onPress: async () => {
            setSigningOutAll(true);
            try {
              const batch = firestore().batch();
              sessions.forEach((s) => {
                if (!s.isCurrent) {
                  const ref = firestore()
                    .collection('users')
                    .doc(user.id)
                    .collection('sessions')
                    .doc(s.id);
                  batch.delete(ref);
                }
              });
              await batch.commit();
              setSessions((prev) => prev.filter((s) => s.isCurrent));
              Alert.alert('Done', 'All other sessions have been signed out.');
            } catch (err) {
              console.error('[Sessions] Bulk sign out error:', err);
              Alert.alert('Error', 'Could not sign out all devices.');
            } finally {
              setSigningOutAll(false);
            }
          },
        },
      ],
    );
  };

  // ── Render device icon ───────────────────────────────────────────────
  const getPlatformIcon = (platform: string): string => {
    return PLATFORM_ICONS[platform] || 'phone-portrait-outline';
  };

  const otherSessions = sessions.filter((s) => !s.isCurrent);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* ── Header ──────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={8}
        >
          <AppIcon name="arrow-back" size="lg" color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Active Sessions</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* ── Sign out all button ─────────────────────────────────────── */}
      {otherSessions.length > 0 && (
        <View style={styles.bulkActionRow}>
          <View style={styles.bulkInfo}>
            <AppIcon name="verified-user" size={16} color={colors.accentGreen} />
            <Text style={styles.bulkInfoText}>
              {sessions.length} session{sessions.length > 1 ? 's' : ''} active
            </Text>
          </View>
          <TouchableOpacity
            style={styles.bulkBtn}
            onPress={handleSignOutAllOthers}
            disabled={signingOutAll}
          >
            {signingOutAll ? (
              <ActivityIndicator size="small" color={colors.accentRed} />
            ) : (
              <>
                <AppIcon name="logout" size={16} color={colors.accentRed} />
                <Text style={styles.bulkBtnText}>
                  Sign Out Others
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ── Content ──────────────────────────────────────────────────── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.loadingText}>Loading sessions...</Text>
          </View>
        ) : sessions.length === 0 ? (
          <View style={styles.center}>
            <AppIcon name="phone-android" size="hero" color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No Active Sessions</Text>
            <Text style={styles.emptySub}>
              Your login sessions will appear here.
            </Text>
          </View>
        ) : (
          <>
            {/* ── Current session ── */}
            {sessions
              .filter((s) => s.isCurrent)
              .map((session) => (
                <View key={session.id} style={styles.sessionCard}>
                  <View style={styles.sessionIcon}>
                    <AppIcon
                      name={getPlatformIcon(session.platform)}
                      size="xl"
                      color={colors.accent}
                    />
                  </View>
                  <View style={styles.sessionInfo}>
                    <View style={styles.sessionNameRow}>
                      <Text style={styles.sessionName}>{session.deviceName}</Text>
                      <View style={styles.currentBadge}>
                        <Text style={styles.currentBadgeText}>Current</Text>
                      </View>
                    </View>
                    <View style={styles.sessionDetails}>
                      <Text style={styles.sessionDetail}>
                        {PLATFORM_LABELS[session.platform] || session.platform}
                      </Text>
                      {session.ipAddress ? (
                        <>
                          <Text style={styles.detailDot}>·</Text>
                          <Text style={styles.sessionDetail}>{session.ipAddress}</Text>
                        </>
                      ) : null}
                      <Text style={styles.detailDot}>·</Text>
                      <Text style={styles.sessionDetail}>
                        {formatLastActive(session.lastActive)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.sessionAction}>
                    <AppIcon name="check-circle" size={20} color={colors.accentGreen} />
                  </View>
                </View>
              ))}

            {/* ── Other sessions ── */}
            {otherSessions.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>
                  Other Sessions ({otherSessions.length})
                </Text>
                {otherSessions.map((session) => (
                  <View key={session.id} style={styles.sessionCard}>
                    <View style={styles.sessionIcon}>
                      <AppIcon
                        name={getPlatformIcon(session.platform)}
                        size="xl"
                        color={colors.textSecondary}
                      />
                    </View>
                    <View style={styles.sessionInfo}>
                      <Text style={styles.sessionName}>{session.deviceName}</Text>
                      <View style={styles.sessionDetails}>
                        <Text style={styles.sessionDetail}>
                          {PLATFORM_LABELS[session.platform] || session.platform}
                        </Text>
                        {session.ipAddress ? (
                          <>
                            <Text style={styles.detailDot}>·</Text>
                            <Text style={styles.sessionDetail}>{session.ipAddress}</Text>
                          </>
                        ) : null}
                        <Text style={styles.detailDot}>·</Text>
                        <Text style={styles.sessionDetail}>
                          {formatLastActive(session.lastActive)}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.signOutBtn}
                      onPress={() =>
                        handleSignOutSession(session.id, session.deviceName)
                      }
                      disabled={signingOut === session.id}
                    >
                      {signingOut === session.id ? (
                        <ActivityIndicator size="small" color={colors.accentRed} />
                      ) : (
                        <Text style={styles.signOutBtnText}>Sign Out</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  bulkActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bulkInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bulkInfoText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(244, 63, 94, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.2)',
  },
  bulkBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accentRed,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 12,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySub: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 6,
    textAlign: 'center',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 24,
    marginBottom: 10,
  },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  sessionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(212, 175, 55, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },
  currentBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  currentBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accentGreen,
  },
  sessionDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    flexWrap: 'wrap',
  },
  sessionDetail: {
    fontSize: 12,
    color: colors.textMuted,
  },
  detailDot: {
    fontSize: 12,
    color: colors.textMuted,
    marginHorizontal: 4,
  },
  sessionAction: {
    marginLeft: 8,
  },
  signOutBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(244, 63, 94, 0.08)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.15)',
    marginLeft: 8,
  },
  signOutBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accentRed,
  },
});
