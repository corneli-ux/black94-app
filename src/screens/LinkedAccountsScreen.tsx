/**
 * LinkedAccountsScreen.tsx — Shows linked OAuth accounts for the current user.
 *
 * Displays:
 * - Currently linked Google account (email + "Connected" badge)
 * - Placeholder rows for Twitter/X and Apple ("Not connected" + "Connect" button)
 * - "Unlink Google" option with re-authentication warning
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { auth } from '../lib/firebase';
import { Ionicons } from '@expo/vector-icons';

export default function LinkedAccountsScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAppStore();

  // ── Determine linked providers ───────────────────────────────────────
  const currentUser = auth().currentUser;
  const providerData = currentUser?.providerData || [];
  const googleProvider = providerData.find(
    (p) => p.providerId === 'google.com',
  );
  const isGoogleLinked = !!googleProvider;
  const linkedEmail = googleProvider?.email || user?.email || '';

  // ── Unlink Google ────────────────────────────────────────────────────
  const handleUnlinkGoogle = () => {
    Alert.alert(
      'Unlink Google Account',
      'After unlinking your Google account, you will need to set up an alternative login method or re-authenticate with Google to continue using Black94.\n\nAre you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Coming Soon',
              'Account unlinking requires setting up an alternative login method first. This feature is coming in a future update.',
            );
          },
        },
      ],
    );
  };

  // ── Connect placeholder providers ────────────────────────────────────
  const handleConnectProvider = (providerName: string) => {
    Alert.alert('Coming Soon', `${providerName} sign-in will be available soon.`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* ── Header ──────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Linked Accounts</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* ── Info banner ───────────────────────────────────────────── */}
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.infoBannerText}>
            Manage your connected sign-in methods. You can link multiple accounts for easier login.
          </Text>
        </View>

        {/* ── Connected accounts section ────────────────────────────── */}
        <Text style={styles.sectionTitle}>Connected</Text>
        <View style={styles.card}>
          {/* ── Google ── */}
          <View style={styles.accountRow}>
            <View style={styles.accountIcon}>
              {/* Google "G" using a colored circle */}
              <View style={styles.googleIconBg}>
                <Text style={styles.googleIconLetter}>G</Text>
              </View>
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>Google</Text>
              <Text style={styles.accountEmail}>
                {isGoogleLinked ? linkedEmail : 'Not connected'}
              </Text>
            </View>
            {isGoogleLinked ? (
              <View style={styles.connectedBadge}>
                <Ionicons name="checkmark-circle" size={16} color={colors.accentGreen} />
                <Text style={styles.connectedBadgeText}>Connected</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.connectBtn}
                onPress={() => handleConnectProvider('Google')}
              >
                <Text style={styles.connectBtnText}>Connect</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Unlink Google (only if linked) ──────────────────────── */}
          {isGoogleLinked && (
            <View style={styles.cardDivider} />
          )}
          {isGoogleLinked && (
            <TouchableOpacity
              style={styles.unlinkRow}
              onPress={handleUnlinkGoogle}
            >
              <Ionicons name="unlink-outline" size={18} color={colors.accentRed} />
              <Text style={styles.unlinkText}>Unlink Google Account</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Available accounts section ────────────────────────────── */}
        <Text style={styles.sectionTitle}>Available</Text>
        <View style={styles.card}>
          {/* ── Twitter / X ── */}
          <View style={styles.accountRow}>
            <View style={styles.accountIcon}>
              <View style={styles.twitterIconBg}>
                <Ionicons name="logo-twitter" size={22} color={colors.white} />
              </View>
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>X (Twitter)</Text>
              <Text style={styles.accountEmail}>Not connected</Text>
            </View>
            <TouchableOpacity
              style={styles.connectBtn}
              onPress={() => handleConnectProvider('X (Twitter)')}
            >
              <Text style={styles.connectBtnText}>Connect</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.cardDivider} />

          {/* ── Apple ── */}
          <View style={[styles.accountRow, { borderBottomWidth: 0 }]}>
            <View style={styles.accountIcon}>
              <View style={styles.appleIconBg}>
                <Ionicons name="logo-apple" size={26} color={colors.white} />
              </View>
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>Apple</Text>
              <Text style={styles.accountEmail}>Not connected</Text>
            </View>
            <TouchableOpacity
              style={styles.connectBtn}
              onPress={() => handleConnectProvider('Apple')}
            >
              <Text style={styles.connectBtnText}>Connect</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Security note ─────────────────────────────────────────── */}
        <View style={styles.securityNote}>
          <Ionicons name="shield-checkmark-outline" size={14} color={colors.textMuted} />
          <Text style={styles.securityNoteText}>
            Your login information is encrypted and securely stored. Linking accounts does not grant access to your profile on other platforms.
          </Text>
        </View>

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
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(212, 175, 55, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.15)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 20,
    marginBottom: 10,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  accountIcon: {
    marginRight: 14,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  accountEmail: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },

  // ── Google icon ──
  googleIconBg: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconLetter: {
    fontSize: 22,
    fontWeight: '900',
    color: '#4285F4',
  },

  // ── Twitter icon ──
  twitterIconBg: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#1DA1F2',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Apple icon ──
  appleIconBg: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },

  // ── Connected badge ──
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  connectedBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accentGreen,
  },

  // ── Connect button ──
  connectBtn: {
    backgroundColor: 'rgba(212, 175, 55, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.25)',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  connectBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },

  // ── Unlink row ──
  cardDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 16,
  },
  unlinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  unlinkText: {
    flex: 1,
    fontSize: 14,
    color: colors.accentRed,
    fontWeight: '500',
  },

  // ── Security note ──
  securityNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 20,
    paddingVertical: 4,
  },
  securityNoteText: {
    flex: 1,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
});
