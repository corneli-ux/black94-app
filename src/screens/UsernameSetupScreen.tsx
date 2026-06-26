/**
 * UsernameSetupScreen
 * 
 * Shown to new users after Google Sign-In.
 * Lets them pick a unique username with real-time availability check.
 * Like Instagram/Twitter onboarding.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { firestore } from '../lib/firebase';
import { useAppStore } from '../stores/app';
import { auth } from '../lib/firebase';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

type AvailabilityState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

export default function UsernameSetupScreen({ navigation }: any) {
  const [username, setUsername] = useState('');
  const [availability, setAvailability] = useState<AvailabilityState>('idle');
  const [saving, setSaving] = useState(false);
  const { user, setUser } = useAppStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-fill with a cleaned version of the display name as suggestion
  useEffect(() => {
    if (user?.displayName) {
      const suggested = user.displayName.replace(/\s+/g, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
      setUsername(suggested.slice(0, 20));
    }
  }, [user?.displayName]);

  const checkAvailability = useCallback(async (value: string) => {
    if (!value || value.length < 3) {
      setAvailability('idle');
      return;
    }
    if (!USERNAME_REGEX.test(value)) {
      setAvailability('invalid');
      return;
    }
    setAvailability('checking');
    try {
      const snap = await firestore().collection('usernames').doc(value.toLowerCase()).get();
      // If doc exists and belongs to someone else, it's taken
      const data = snap.exists ? snap.data() : null;
      const myUid = auth()?.currentUser?.uid;
      if (snap.exists && data?.uid !== myUid) {
        setAvailability('taken');
      } else {
        setAvailability('available');
      }
    } catch {
      setAvailability('idle');
    }
  }, []);

  const handleUsernameChange = useCallback((text: string) => {
    // Only allow valid chars, lowercase, max 20
    const cleaned = text.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    setUsername(cleaned);
    setAvailability('idle');

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (cleaned.length >= 3) {
      debounceRef.current = setTimeout(() => checkAvailability(cleaned), 600);
    }
  }, [checkAvailability]);

  const handleContinue = useCallback(async () => {
    if (availability !== 'available') return;
    const uid = auth()?.currentUser?.uid;
    if (!uid) return;

    setSaving(true);
    try {
      const lower = username.toLowerCase();

      // Claim the username
      await firestore().collection('usernames').doc(lower).set({ uid });

      // Update user doc
      await firestore().collection('users').doc(uid).update({
        username: lower,
        usernameLower: lower,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });

      // Update local store
      if (user) {
        setUser({ ...user, username: lower });
      }

      // Navigate to main app
      navigation.replace('Drawer');
    } catch (e: any) {
      console.error('[UsernameSetup] Error:', e);
    } finally {
      setSaving(false);
    }
  }, [username, availability, user, setUser, navigation]);

  const statusColor = availability === 'available' ? '#22c55e'
    : availability === 'taken' ? '#ef4444'
    : availability === 'invalid' ? '#f59e0b'
    : colors.textMuted;

  const statusText = availability === 'available' ? `@${username} is available`
    : availability === 'taken' ? `@${username} is already taken`
    : availability === 'invalid' ? '3-20 characters: letters, numbers, underscores only'
    : availability === 'checking' ? 'Checking availability...'
    : 'Letters, numbers and underscores only';

  const canContinue = availability === 'available' && !saving;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.content}>
          {/* Header */}
          <View style={s.header}>
            <View style={s.logoMark}>
              <Text style={s.logoText}>94</Text>
            </View>
            <Text style={s.title}>Choose your username</Text>
            <Text style={s.subtitle}>
              Your username is how people find and mention you.{'\n'}You can change it later.
            </Text>
          </View>

          {/* Input */}
          <View style={s.inputSection}>
            <View style={[s.inputRow, availability === 'available' && s.inputRowValid,
              availability === 'taken' && s.inputRowTaken]}>
              <Text style={s.atSign}>@</Text>
              <TextInput
                style={s.input}
                value={username}
                onChangeText={handleUsernameChange}
                placeholder="username"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                maxLength={20}
              />
              {availability === 'checking' && (
                <ActivityIndicator size="small" color={colors.textMuted} />
              )}
              {availability === 'available' && (
                <Feather name="check-circle" size={20} color="#22c55e" />
              )}
              {availability === 'taken' && (
                <Feather name="x-circle" size={20} color="#ef4444" />
              )}
            </View>

            {/* Status */}
            {availability !== 'idle' && (
              <View style={s.statusRow}>
                <Text style={[s.statusText, { color: statusColor }]}>{statusText}</Text>
              </View>
            )}

            {/* Suggestions when taken */}
            {availability === 'taken' && user?.displayName && (
              <View style={s.suggestions}>
                <Text style={s.suggestionsLabel}>Try one of these:</Text>
                <View style={s.suggestionsRow}>
                  {[
                    username + Math.floor(Math.random() * 99 + 1),
                    username + '_',
                    username + Math.floor(Math.random() * 999 + 100),
                  ].map((sug, i) => (
                    <TouchableOpacity
                      key={i}
                      style={s.suggestionChip}
                      onPress={() => handleUsernameChange(sug.slice(0, 20))}
                    >
                      <Text style={s.suggestionText}>@{sug.slice(0, 20)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* Rules */}
          <View style={s.rules}>
            {[
              '3-20 characters',
              'Letters, numbers, and underscores only',
              'Case insensitive (@Das = @das)',
            ].map((rule, i) => (
              <View key={i} style={s.ruleRow}>
                <View style={s.ruleDot} />
                <Text style={s.ruleText}>{rule}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Continue button */}
        <View style={s.footer}>
          <TouchableOpacity
            style={[s.continueBtn, !canContinue && s.continueBtnDisabled]}
            onPress={handleContinue}
            disabled={!canContinue}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color={colors.bg} />
              : <Text style={[s.continueBtnText, !canContinue && s.continueBtnTextDisabled]}>
                  Continue
                </Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 32 },
  header: { marginBottom: 40, alignItems: 'center' },
  logoMark: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  logoText: { color: colors.bg, fontSize: 22, fontWeight: '900', fontStyle: 'italic' },
  title: { fontSize: 26, fontWeight: '800', color: colors.white, textAlign: 'center', marginBottom: 10 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  inputSection: { marginBottom: 28 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0f0f0f',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14, paddingHorizontal: 16, height: 56,
    gap: 8,
  },
  inputRowValid: { borderColor: '#22c55e' },
  inputRowTaken: { borderColor: '#ef4444' },
  atSign: { fontSize: 18, color: colors.textMuted, fontWeight: '600' },
  input: { flex: 1, color: colors.white, fontSize: 18, fontWeight: '600', letterSpacing: 0.5 },
  statusRow: { marginTop: 8, paddingLeft: 4 },
  statusText: { fontSize: 13, fontWeight: '500' },
  suggestions: { marginTop: 16 },
  suggestionsLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  suggestionsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  suggestionChip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  suggestionText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  rules: { gap: 8 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ruleDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.textMuted },
  ruleText: { fontSize: 13, color: colors.textMuted },
  footer: { padding: 24, paddingBottom: 32 },
  continueBtn: {
    backgroundColor: colors.accent, borderRadius: 14,
    height: 54, alignItems: 'center', justifyContent: 'center',
  },
  continueBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.08)' },
  continueBtnText: { fontSize: 16, fontWeight: '700', color: colors.bg },
  continueBtnTextDisabled: { color: colors.textMuted },
});
