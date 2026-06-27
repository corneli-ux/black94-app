/**
 * AuthScreen — Black94 sign-in (Redesigned).
 *
 * DESIGN PHILOSOPHY
 * ─────────────────
 * Pure black canvas with a subtle gold radial glow that draws the eye to
 * the wordmark. Modern editorial typography — large, confident, spaced.
 * Three feature chips surface the brand promise (E2E encryption, no ads,
 * your data stays yours) above the primary action.
 *
 * AUTH STRATEGY
 * ─────────────
 * Primary: Email/password — works on ANY Firebase project with email auth
 *          enabled. No OAuth web client, no SHA-1, no DEVELOPER_ERROR.
 *          This is the reliable path that always works.
 * Secondary: Google Sign-In — only shown when WEB_CLIENT_ID is configured.
 *            Uses native Google Sign-In with WebView fallback for
 *            DEVELOPER_ERROR (PKCE + Firebase's pre-authorized handler).
 *
 * The Sign In / Create Account tab toggle lets users switch between
 * modes without leaving the screen.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, Platform, Alert, Linking, Image, Modal, Animated, Easing,
  Dimensions, TextInput, KeyboardAvoidingView, ScrollView, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import Constants from 'expo-constants';
import { signInWithGoogle, signUpWithEmailAuth, signInWithEmailAuth } from '../lib/api';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { Feather } from '@expo/vector-icons';
import GoogleSignInWebView from '../components/GoogleSignInWebView';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Web client ID — empty string means Google Sign-In is hidden (email-only mode).
const WEB_CLIENT_ID = (Constants.expoConfig?.extra?.googleWebClientId as string) || '';

export default function AuthScreen() {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showWebView, setShowWebView] = useState(false);
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

  // ── Google auth (secondary, with WebView fallback) ──
  const completeGoogleSignIn = useCallback(async (idToken: string) => {
    try {
      const user = await signInWithGoogle(idToken);
      if (user) routeAfterAuth(user);
    } catch (e: any) {
      console.error('[Auth] Google sign-in completion error:', e?.code, e?.message);
      const errMsg = (e?.message || '').slice(0, 200);
      Alert.alert('Sign In Failed', errMsg || 'Please try again.');
    } finally {
      setShowWebView(false);
      setBusy(false);
    }
  }, [routeAfterAuth]);

  const handleGoogle = useCallback(async () => {
    if (busy) return;
    if (!WEB_CLIENT_ID) {
      Alert.alert('Google Sign-In unavailable', 'Please use email sign-in instead.');
      return;
    }
    setBusy(true);
    try {
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
      GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, scopes: ['profile', 'email'] });
      if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      await GoogleSignin.signIn();

      let idToken: string | null = null;
      try { const t = await GoogleSignin.getTokens(); idToken = t.idToken; } catch (tokenErr: any) {
        console.warn('[Auth] getTokens failed:', tokenErr?.code, tokenErr?.message);
      }
      if (!idToken) {
        console.log('[Auth] No idToken from native — opening WebView fallback');
        setShowWebView(true);
        return;
      }
      await completeGoogleSignIn(idToken);
    } catch (e: any) {
      if (e?.code === '12501' || e?.code === 'SIGN_IN_CANCELLED') {
        setBusy(false);
        return;
      }

      console.error('[Auth] Google sign-in error:', { code: e?.code, message: e?.message });

      const errCode = e?.code ? String(e.code) : '';
      const errMsg = (e?.message || '').slice(0, 180);

      // DEVELOPER_ERROR, SIGN_IN_REQUIRED, INTERNAL_ERROR, or any token/config
      // error → AUTOMATICALLY open the WebView fallback. No alert, no user
      // interaction. The WebView uses PKCE + Firebase's pre-authorized handler
      // and works WITHOUT any SHA-1 registration.
      const shouldAutoFallback =
        errCode === '10' ||
        errCode === '8' ||
        errCode === '5' ||
        /DEVELOPER_ERROR|INTERNAL_ERROR|SIGN_IN_REQUIRED|INVALID_IDP_RESPONSE|INVALID_ID_TOKEN|operation-not-allowed|OPERATION_NOT_ALLOWED/i.test(errMsg);

      if (shouldAutoFallback) {
        console.log('[Auth] Auto-opening WebView fallback for error:', errCode || errMsg.slice(0, 60));
        setShowWebView(true);
        return;
      }

      // Network errors and other transient issues → show alert, don't fallback
      let body = 'Please try email sign-in instead.';
      if (errCode === '7' || /NETWORK_ERROR/i.test(errMsg)) {
        body = 'Network error. Please check your internet connection and try again.';
      } else if (/INVALID_API_KEY/i.test(errMsg)) {
        body = 'Firebase API key is invalid. Please contact support.';
      } else if (errMsg) {
        body = `Error: ${errMsg}`;
      }
      Alert.alert('Google Sign-In Failed', body);
      setBusy(false);
    }
  }, [busy, completeGoogleSignIn]);

  // ── WebView fallback handlers ──
  const handleWebViewToken = useCallback((idToken: string) => {
    console.log('[Auth] WebView sign-in got token, completing...');
    completeGoogleSignIn(idToken);
  }, [completeGoogleSignIn]);

  const handleWebViewError = useCallback((error: string) => {
    console.error('[Auth] WebView sign-in error:', error);
    setShowWebView(false);
    setBusy(false);
    Alert.alert('Sign In Failed', `Web sign-in failed: ${error}\n\nPlease try email sign-in instead.`);
  }, []);

  const handleWebViewCancel = useCallback(() => {
    setShowWebView(false);
    setBusy(false);
  }, []);

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* ── Subtle gold radial glow at top ── */}
      <View style={s.glowLayer} pointerEvents="none">
        <LinearGradient
          colors={['rgba(212,175,55,0.16)', 'rgba(212,175,55,0.04)', 'rgba(0,0,0,0)']}
          locations={[0, 0.4, 1]}
          style={s.glowOuter}
        />
        <LinearGradient
          colors={['rgba(212,175,55,0.22)', 'rgba(212,175,55,0)']}
          locations={[0, 1]}
          style={s.glowInner}
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
          {/* ── Logo + Wordmark ── */}
          <Animated.View style={[s.logoSection, makeEntrance(fadeLogo)]}>
            <View style={s.logoMark}>
              <Text style={s.logoMarkText}>94</Text>
            </View>
            <Text style={s.wordmark}>BLACK94</Text>
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

            {/* Google Sign-In (only if WEB_CLIENT_ID is configured) */}
            {WEB_CLIENT_ID ? (
              <>
                <View style={s.orRow}>
                  <View style={s.orLine} />
                  <Text style={s.orText}>OR</Text>
                  <View style={s.orLine} />
                </View>
                <TouchableOpacity
                  style={s.googleBtn}
                  onPress={handleGoogle}
                  disabled={busy}
                  activeOpacity={0.92}
                >
                  <GoogleGLogo size={22} />
                  <Text style={s.googleBtnText}>Continue with Google</Text>
                </TouchableOpacity>
              </>
            ) : null}
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
      <Modal visible={showWebView} animationType="slide" onRequestClose={handleWebViewCancel}>
        <SafeAreaView style={s.webViewContainer}>
          <View style={s.webViewHeader}>
            <TouchableOpacity onPress={handleWebViewCancel} style={s.webViewCloseBtn} hitSlop={12}>
              <Feather name="x" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={s.webViewTitle}>Sign in with Google</Text>
            <View style={{ width: 22 }} />
          </View>
          <GoogleSignInWebView
            onToken={handleWebViewToken}
            onError={handleWebViewError}
            onCancel={handleWebViewCancel}
          />
        </SafeAreaView>
      </Modal>
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
      <Feather name={icon as any} size={11} color={colors.accent} />
      <Text style={s.featureChipText}>{label}</Text>
    </View>
  );
}

/** Official Google "G" logo rendered as a 4-color ring with a white core.
 *  Avoids bundling an extra PNG asset while staying brand-accurate. */
function GoogleGLogo({ size = 22 }: { size?: number }) {
  const half = size / 2;
  const core = size * 0.66;
  return (
    <View style={[s.gLogoWrap, { width: size, height: size, borderRadius: half }]}>
      <View style={[s.gHalf, { top: 0, left: 0, width: '50%', height: '50%', backgroundColor: '#4285F4', borderTopLeftRadius: half }]} />
      <View style={[s.gHalf, { top: 0, right: 0, width: '50%', height: '50%', backgroundColor: '#EA4335', borderTopRightRadius: half }]} />
      <View style={[s.gHalf, { bottom: 0, left: 0, width: '50%', height: '50%', backgroundColor: '#34A853', borderBottomLeftRadius: half }]} />
      <View style={[s.gHalf, { bottom: 0, right: 0, width: '50%', height: '50%', backgroundColor: '#FBBC05', borderBottomRightRadius: half }]} />
      <View style={[s.gCore, {
        width: core, height: core, borderRadius: core / 2,
        top: (size - core) / 2, left: (size - core) / 2,
      }]}>
        <Text style={{
          fontSize: size * 0.46,
          fontWeight: '900',
          color: '#4285F4',
          fontStyle: 'italic',
          marginTop: -size * 0.02,
        }}>G</Text>
      </View>
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
    marginBottom: 20,
  },
  logoMark: {
    width: 72, height: 72,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
  logoMarkText: {
    color: '#000',
    fontSize: 30,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: -1.5,
  },
  wordmark: {
    fontSize: 30,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 8,
    textAlign: 'center',
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
    backgroundColor: 'rgba(212,175,55,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.18)',
  },
  featureChipText: {
    fontSize: 10.5,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.78)',
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
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  tabText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.2,
  },
  tabTextActive: {
    color: '#000',
  },

  // Inputs
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 54,
    borderRadius: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    paddingVertical: 0,
  },

  // Primary button (gold)
  primaryBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#000',
    letterSpacing: -0.2,
  },

  // OR divider
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginVertical: 6,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  orText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.32)',
    letterSpacing: 2,
    fontWeight: '600',
  },

  // Google button (white)
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    height: 54,
    backgroundColor: '#fff',
    borderRadius: 14,
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  googleBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
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

  // ── Google "G" logo ──
  gLogoWrap: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gHalf: {
    position: 'absolute',
  },
  gCore: {
    position: 'absolute',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── WebView fallback modal ──
  webViewContainer: { flex: 1, backgroundColor: '#000' },
  webViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  webViewCloseBtn: { padding: 4 },
  webViewTitle: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
});
