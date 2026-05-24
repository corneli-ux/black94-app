import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Share, Alert, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ExpoClipboard from 'expo-clipboard';
import { colors } from '../theme/colors';
import { Avatar, VerifiedBadge } from '../components/Avatar';
import { timeAgo } from '../utils/timeAgo';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis } from '../lib/api';
import { User } from '../lib/api';

const LINK_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

function generateQRPattern(text: string): number[][] {
  const size = 21;
  const grid: number[][] = Array.from({ length: size }, () => Array(size).fill(0));

  // Add finder patterns (3 corners)
  const drawFinder = (x: number, y: number) => {
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
      if (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)) {
        grid[y + i][x + j] = 1;
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  // Fill data area deterministically from text
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y][x] === 0) {
        hash = (hash * 1103515245 + 12345) & 0x7fffffff;
        grid[y][x] = hash % 3 === 0 ? 1 : 0;
      }
    }
  }
  return grid;
}

export default function ShareProfileScreen({ route, navigation }: any) {
  const currentUser = auth()?.currentUser;
  const targetUserId = route?.params?.userId || currentUser?.uid;
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareLink, setShareLink] = useState('');
  const [countdown, setCountdown] = useState(300); // 5 minutes in seconds
  const [linkGenerated, setLinkGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<any>(null);

  const generateLink = useCallback(async () => {
    const token = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    const link = `https://black94.app/u/${user?.username || targetUserId}?ref=${token}`;

    // Save token to Firestore with 5-minute expiry
    try {
      await firestore().collection('profileShares').doc(token).set({
        userId: targetUserId,
        createdAt: firestore.FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        used: false,
      });
    } catch (e) {
      if (__DEV__) console.warn('[ShareProfile] Failed to save share token:', e);
    }

    setShareLink(link);
    setLinkGenerated(true);
    setCountdown(300);
  }, [user, targetUserId]);

  useEffect(() => {
    const load = async () => {
      try {
        const docSnap = await firestore().collection('users').doc(targetUserId).get();
        if (docSnap.exists) {
          const data = docSnap.data();
          setUser({
            id: targetUserId,
            email: data?.email || '',
            username: data?.username || '',
            displayName: data?.displayName || '',
            bio: data?.bio || '',
            profileImage: data?.profileImage || null,
            coverImage: data?.coverImage || null,
            role: data?.role || 'personal',
            badge: data?.badge || '',
            subscription: data?.subscription || 'free',
            isVerified: data?.isVerified || false,
            createdAt: (() => { try { return tsToMillis(data?.createdAt); } catch { return Date.now(); } })(),
          });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [targetUserId]);

  useEffect(() => {
    if (user) generateLink();
  }, [user, generateLink]);

  useEffect(() => {
    if (!linkGenerated) return;

    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setLinkGenerated(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [linkGenerated]);

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleShare = async () => {
    if (!shareLink) return;
    try {
      await Share.share({
        message: `Check out ${user?.displayName || 'this profile'} on Black94!\n${shareLink}`,
        url: shareLink,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleCopyLink = async () => {
    if (!shareLink) return;
    try {
      await ExpoClipboard.setStringAsync(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Alert.alert('Copied!', shareLink);
    }
  };

  const handleRegenerate = () => {
    generateLink();
  };

  const initial = user?.displayName?.charAt(0)?.toUpperCase() || '?';

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: colors.textSecondary, fontSize: 15 }}>User not found</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '600' }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <SafeAreaView edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Share Profile</Text>
          <View style={{ width: 32 }} />
        </View>
      </SafeAreaView>

      {/* Profile Summary */}
      <View style={styles.profileCard}>
        <View style={styles.profileTop}>
          <Avatar uri={user.profileImage} name={user.displayName} size={72} borderWidth={2} borderColor={colors.border} />
          <View style={styles.profileInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.displayName}>{user.displayName}</Text>
              <VerifiedBadge badge={user.badge} isVerified={user.isVerified} />
            </View>
            <Text style={styles.handle}>@{user.username}</Text>
          </View>
        </View>
        {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
        <Text style={styles.joinedText}>
          Joined {timeAgo(user.createdAt)} ago
        </Text>
      </View>

      {/* QR Code Placeholder */}
      <View style={styles.qrSection}>
        <Text style={styles.sectionLabel}>QR Code</Text>
        {(() => {
          const pattern = generateQRPattern(shareLink);
          const cellSize = 6;
          return (
            <View style={styles.qrContainer}>
              {pattern.map((row, y) => (
                <View key={y} style={{ flexDirection: 'row' }}>
                  {row.map((cell, x) => (
                    <View key={x} style={{
                      width: cellSize, height: cellSize,
                      backgroundColor: cell ? colors.white : colors.surface,
                    }} />
                  ))}
                </View>
              ))}
            </View>
          );
        })()}
      </View>

      {/* Link Section */}
      <View style={styles.linkSection}>
        <Text style={styles.sectionLabel}>Shareable Link</Text>

        {linkGenerated ? (
          <>
            <View style={styles.linkRow}>
              <View style={styles.linkBox}>
                <Text style={styles.linkText} numberOfLines={1}>{shareLink}</Text>
              </View>
              <TouchableOpacity onPress={handleCopyLink} style={styles.copyBtn}>
                <Text style={styles.copyBtnText}>{copied ? '✓ Copied' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>

            {/* Countdown */}
            <View style={styles.countdownRow}>
              <View style={[styles.countdownDot, countdown > 60 && styles.dotActive]} />
              <Text style={styles.countdownText}>
                Link expires in {formatCountdown(countdown)}
              </Text>
              <TouchableOpacity onPress={handleRegenerate}>
                <Text style={styles.regenerateText}>Regenerate</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.expiredBox}>
            <Text style={styles.expiredText}>Link expired</Text>
            <TouchableOpacity onPress={handleRegenerate} style={styles.regenerateBtn}>
              <Text style={styles.regenerateBtnText}>Generate New Link</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Share Button */}
      <TouchableOpacity
        style={[styles.shareBtn, !linkGenerated && styles.shareBtnDisabled]}
        onPress={handleShare}
        disabled={!linkGenerated}
      >
        <Text style={styles.shareBtnText}>Share Link</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  backIcon: { color: colors.text, fontSize: 24 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  profileCard: {
    marginHorizontal: 16, marginTop: 20, padding: 20,
    backgroundColor: colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  profileInfo: { flex: 1 },
  displayName: { color: colors.text, fontSize: 20, fontWeight: '800' },
  handle: { color: colors.textSecondary, fontSize: 15, marginTop: 2 },
  bio: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 12 },
  joinedText: { color: colors.textSecondary, fontSize: 13, marginTop: 8 },
  qrSection: { paddingHorizontal: 16, marginTop: 24 },
  sectionLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 10, textTransform: 'uppercase' },
  qrContainer: { padding: 12, backgroundColor: colors.surface, borderRadius: 12, alignSelf: 'center' },
  linkSection: { paddingHorizontal: 16, marginTop: 28 },
  linkRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  linkBox: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  linkText: { color: colors.text, fontSize: 13, flex: 1 },
  copyBtn: {
    backgroundColor: colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: colors.accent,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  copyBtnText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  countdownRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
  },
  countdownDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accentRed,
  },
  dotActive: { backgroundColor: colors.accentGreen },
  countdownText: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  regenerateText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  expiredBox: {
    backgroundColor: colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    padding: 24, alignItems: 'center',
  },
  expiredText: { color: colors.textSecondary, fontSize: 15, marginBottom: 14 },
  regenerateBtn: {
    backgroundColor: colors.accent, borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  regenerateBtnText: { color: colors.primaryForeground, fontSize: 14, fontWeight: '700' },
  shareBtn: {
    marginHorizontal: 16, marginTop: 24, borderRadius: 12,
    backgroundColor: colors.accent, paddingVertical: 16, alignItems: 'center',
  },
  shareBtnDisabled: { opacity: 0.4 },
  shareBtnText: { color: colors.primaryForeground, fontSize: 16, fontWeight: '700' },
});
