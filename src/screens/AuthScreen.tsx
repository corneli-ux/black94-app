/**
 * AuthScreen — Black94 sign-in (Redesigned).
 *
 * AUTH STRATEGY
 * ─────────────
 * Email/password only. Google Sign-In was removed because the release
 * keystore SHA-1 is registered in multiple Firebase projects, causing
 * DEVELOPER_ERROR on every attempt. Email/password works on any Firebase
 * project with email auth enabled — no SHA-1, no OAuth web client.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, Platform, Alert, Linking, Image, Animated, Easing,
  Dimensions, TextInput, KeyboardAvoidingView, ScrollView, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { signUpWithEmailAuth, signInWithEmailAuth } from '../lib/api';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { Feather } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function AuthScreen() {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const { setUser, setToken } = useAppStore();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  // ── Entrance animation ──
  // Staggered fade-in + slide-up for logo, tagline, features, and form.
  const fadeLogo = useRef(new Animated.Value(0)).current;
  const fadeTagline = useRef(new Animated.Value(0)).current;
  const fadeFeatures = useRef(new Animated.Value(0)).current;
  const fadeForm = useRef(new Animated.Value(0)).current;
  const fadeFooter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeLogo,     { toValue: 1, duration: 600, easing: Easing.out(Easing.exp), useNativeDriver: true }),
      Animated.timing(fadeTagline,  { toValue: 1, duration: 500, easing: Easing.out(Easing.exp), useNativeDriver: true, delay: 150 }),
      Animated.timing(fadeFeatures, { toValue: 1, duration: 500, easing: Easing.out(Easing.exp), useNativeDriver: true, delay: 300 }),
      Animated.timing(fadeForm,     { toValue: 1, duration: 500, easing: Easing.out(Easing.exp), useNativeDriver: true, delay: 450 }),
      Animated.timing(fadeFooter,   { toValue: 1, duration: 500, easing: Easing.out(Easing.exp), useNativeDriver: true, delay: 600 }),
    ]).start();
  }, []);

  const makeEntrance = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [{
      translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
    }],
  });

  const routeAfterAuth = useCallback((user: any) => {
    setUser(user);
    setToken(user.id);
    if (!user.username || user.username.trim() === '') {
      navigation.replace('UsernameSetup');
    }
  }, [setUser, setToken, navigation]);

  // ── Email auth (primary, reliable path) ──
  const handleEmailAuth = useCallback(async () => {
    if (busy) return;
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please enter your email and password.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters.');
      return;
    }
    if (mode === 'signup' && !name.trim()) {
      Alert.alert('Missing name', 'Please enter your name.');
      return;
    }
    setBusy(true);
    Keyboard.dismiss();
    try {
      const user = mode === 'signup'
        ? await signUpWithEmailAuth(email.trim(), password, name.trim())
        : await signInWithEmailAuth(email.trim(), password);
      if (user) routeAfterAuth(user);
    } catch (e: any) {
      const msg = e?.message || '';
      let friendly = 'Something went wrong. Please try again.';
      if (msg.includes('EMAIL_EXISTS')) friendly = 'This email is already registered. Try signing in.';
      else if (msg.includes('EMAIL_NOT_FOUND')) friendly = 'No account found with this email. Try creating one.';
      else if (msg.includes('INVALID_PASSWORD') || msg.includes('INVALID_LOGIN_CREDENTIALS')) friendly = 'Incorrect email or password.';
      else if (msg.includes('INVALID_EMAIL')) friendly = 'Please enter a valid email address.';
      else if (msg.includes('WEAK_PASSWORD')) friendly = 'Password must be at least 6 characters.';
      else if (msg.includes('TOO_MANY_ATTEMPTS')) friendly = 'Too many attempts. Please try again later.';
      else if (msg.includes('NETWORK')) friendly = 'Network error. Please check your connection.';
      else if (msg) friendly = msg.slice(0, 180);
      Alert.alert(mode === 'signup' ? 'Sign Up Failed' : 'Sign In Failed', friendly);
    } finally {
      setBusy(false);
    }
  }, [busy, email, password, name, mode, routeAfterAuth]);

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* ── Pure black with a whisper of depth at top ── */}
      <View style={s.glowLayer} pointerEvents="none">
        <LinearGradient
          colors={['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.01)', 'rgba(0,0,0,0)']}
          locations={[0, 0.5, 1]}
          style={s.glowOuter}
        />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1, zIndex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Logo Wordmark ── */}
          <Animated.View style={[s.logoSection, makeEntrance(fadeLogo)]}>
            <Image
              source={require('../../assets/logo.png')}
              style={s.wordmarkImage}
              resizeMode="contain"
            />
          </Animated.View>

          {/* ── Tagline ── */}
          <Animated.View style={makeEntrance(fadeTagline)}>
            <Text style={s.tagline}>Where conversations happen</Text>
            <Text style={s.subtagline}>
              The next-generation social platform built for genuine connection.
            </Text>
          </Animated.View>

          {/* ── Feature chips ── */}
          <Animated.View style={[s.featuresRow, makeEntrance(fadeFeatures)]}>
            <FeatureChip icon="shield" label="E2E Encrypted" />
            <FeatureChip icon="lock" label="Your Data Stays Yours" />
            <FeatureChip icon="zap" label="No Ads" />
          </Animated.View>

          {/* ── Form ── */}
          <Animated.View style={[s.form, makeEntrance(fadeForm)]}>
            {/* Tab toggle: Sign In / Create Account */}
            <View style={s.tabRow}>
              <TouchableOpacity
                style={[s.tab, mode === 'signin' && s.tabActive]}
                onPress={() => setMode('signin')}
                activeOpacity={0.7}
              >
                <Text style={[s.tabText, mode === 'signin' && s.tabTextActive]}>Sign In</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.tab, mode === 'signup' && s.tabActive]}
                onPress={() => setMode('signup')}
                activeOpacity={0.7}
              >
                <Text style={[s.tabText, mode === 'signup' && s.tabTextActive]}>Create Account</Text>
              </TouchableOpacity>
            </View>

            {/* Name (signup only) */}
            {mode === 'signup' && (
              <View style={s.inputWrap}>
                <Feather name="user" size={18} color="rgba(255,255,255,0.4)" />
                <TextInput
                  style={s.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>
            )}

            {/* Email */}
            <View style={s.inputWrap}>
              <Feather name="mail" size={18} color="rgba(255,255,255,0.4)" />
              <TextInput
                style={s.input}
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor="rgba(255,255,255,0.3)"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            {/* Password */}
            <View style={s.inputWrap}>
              <Feather name="lock" size={18} color="rgba(255,255,255,0.4)" />
              <TextInput
                style={s.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor="rgba(255,255,255,0.3)"
                secureTextEntry
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={handleEmailAuth}
              />
            </View>

            {/* Primary button: Email auth */}
            <TouchableOpacity
              style={s.primaryBtn}
              onPress={handleEmailAuth}
              disabled={busy}
              activeOpacity={0.9}
            >
              {busy
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={s.primaryBtnText}>
                    {mode === 'signup' ? 'Create Account' : 'Sign In'}
                  </Text>
              }
            </TouchableOpacity>
          </Animated.View>

          {/* ── Legal notice ── */}
          <Text style={s.legalNotice}>
            By continuing, you agree to our{' '}
            <Text style={s.legalLink} onPress={() => Linking.openURL('https://black94.web.app/terms-of-service.html')}>
              Terms
            </Text>
            {' '}and{' '}
            <Text style={s.legalLink} onPress={() => Linking.openURL('https://black94.web.app/privacy-policy.html')}>
              Privacy Policy
            </Text>
            .
          </Text>

          {/* ── Footer ── */}
          <Animated.View style={[s.footer, makeEntrance(fadeFooter)]}>
            <Feather name="shield" size={11} color="rgba(255,255,255,0.22)" />
            <Text style={s.footerText}>End-to-end encrypted · Your data stays yours</Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── WebView fallback modal (for DEVELOPER_ERROR) ── */}
    </SafeAreaView>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Compact pill-shaped feature chip with a gold-tinted icon. */
function FeatureChip({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={s.featureChip}>
      <Feather name={icon as any} size={11} color="rgba(255,255,255,0.6)" />
      <Text style={s.featureChipText}>{label}</Text>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════════════ */

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },

  // ── Gold glow at top ──
  glowLayer: {
    position: 'absolute', top: 0, left: 0, right: 0,
    height: SCREEN_HEIGHT * 0.45,
    overflow: 'hidden',
    zIndex: 0,
  },
  bottomVignette: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: SCREEN_HEIGHT * 0.3,
    zIndex: 0,
  },
  glowOuter: {
    position: 'absolute',
    top: -SCREEN_HEIGHT * 0.1,
    left: -SCREEN_WIDTH * 0.2,
    right: -SCREEN_WIDTH * 0.2,
    height: SCREEN_HEIGHT * 0.55,
  },
  glowInner: {
    position: 'absolute',
    top: -SCREEN_HEIGHT * 0.05,
    left: SCREEN_WIDTH * 0.15,
    right: SCREEN_WIDTH * 0.15,
    height: SCREEN_HEIGHT * 0.3,
  },

  // ── Scroll container ──
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 56,
    justifyContent: 'center',
  },

  // ── Logo section ──
  logoSection: {
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 8,
  },
  wordmarkImage: {
    width: 280,
    height: 80,
  },

  // ── Tagline ──
  tagline: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  subtagline: {
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
  },

  // ── Feature chips ──
  featuresRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 20,
    marginBottom: 28,
    paddingHorizontal: 4,
  },
  featureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  featureChipText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 0.3,
  },

  // ── Form ──
  form: {
    gap: 12,
    marginBottom: 20,
  },

  // Tab toggle
  tabRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    padding: 4,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  tab: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    borderRadius: 9,
  },
  tabActive: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  tabText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.2,
  },
  tabTextActive: {
    color: '#fff',
  },

  // Inputs
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 52,
    borderRadius: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    paddingVertical: 0,
  },

  // Primary button (clean white)
  primaryBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
    letterSpacing: -0.2,
  },

  // Legal
  legalNotice: {
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.38)',
    textAlign: 'center',
    lineHeight: 17,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  legalLink: {
    color: colors.accent,
    textDecorationLine: 'underline',
    fontWeight: '500',
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: 0.3,
  },
});
