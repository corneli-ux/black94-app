/**
 * SignupScreen — Black94 sign-up screen (Redesigned).
 *
 * Visual language matches AuthScreen: pure black canvas with a subtle gold
 * glow at the top, staggered entrance animation, and the same primary
 * "Continue with Google" CTA. The secondary "Already have an account?
 * Sign in" link navigates back to AuthScreen.
 *
 * NOTE: AuthScreen now handles both sign-in and sign-up via a tab toggle,
 * so this screen is primarily reached from the "Create new account" link
 * on AuthScreen. It provides the same email/password + Google sign-up
 * flow with a focused single-mode UI.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, Alert, Linking, Platform, Animated, Easing, Dimensions,
  TextInput, KeyboardAvoidingView, ScrollView, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { signInWithGoogle, signUpWithEmailAuth } from '../lib/api';
import { useAppStore } from '../stores/app';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const WEB_CLIENT_ID = (Constants.expoConfig?.extra?.googleWebClientId as string) || '';

export default function SignupScreen() {
  const { setUser, setToken } = useAppStore();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // ── Entrance animation ──
  const fadeLogo = useRef(new Animated.Value(0)).current;
  const fadeTitle = useRef(new Animated.Value(0)).current;
  const fadeFeatures = useRef(new Animated.Value(0)).current;
  const fadeForm = useRef(new Animated.Value(0)).current;
  const fadeFooter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeLogo,     { toValue: 1, duration: 600, easing: Easing.out(Easing.exp), useNativeDriver: true }),
      Animated.timing(fadeTitle,    { toValue: 1, duration: 500, easing: Easing.out(Easing.exp), useNativeDriver: true, delay: 150 }),
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

  const routeAfterAuth = (user: any) => {
    setUser(user);
    setToken(user.id);
    if (!user.username || user.username.trim() === '') {
      navigation.replace('UsernameSetup');
    }
  };

  const handleEmailSignUp = async () => {
    if (busy) return;
    if (!name.trim() || !email.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    Keyboard.dismiss();
    try {
      const user = await signUpWithEmailAuth(email.trim(), password, name.trim());
      if (user) routeAfterAuth(user);
    } catch (e: any) {
      const msg = e?.message || '';
      let friendly = 'Something went wrong. Please try again.';
      if (msg.includes('EMAIL_EXISTS')) friendly = 'This email is already registered. Try signing in.';
      else if (msg.includes('INVALID_EMAIL')) friendly = 'Please enter a valid email address.';
      else if (msg.includes('WEAK_PASSWORD')) friendly = 'Password must be at least 6 characters.';
      else if (msg.includes('TOO_MANY_ATTEMPTS')) friendly = 'Too many attempts. Please try again later.';
      else if (msg.includes('NETWORK')) friendly = 'Network error. Please check your connection.';
      else if (msg) friendly = msg.slice(0, 180);
      Alert.alert('Sign Up Failed', friendly);
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    if (busy) return;
    if (!WEB_CLIENT_ID) {
      Alert.alert('Google Sign-In unavailable', 'Please use email sign-up instead.');
      return;
    }
    setBusy(true);
    try {
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
      GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, scopes: ['profile', 'email'] });
      if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      await GoogleSignin.signIn();
      let idToken: string | null = null;
      try { const t = await GoogleSignin.getTokens(); idToken = t.idToken; } catch {}
      if (!idToken) {
        Alert.alert('Sign Up Failed', 'Could not get authentication token. Please use email sign-up.');
        return;
      }
      const user = await signInWithGoogle(idToken);
      if (user) routeAfterAuth(user);
    } catch (e: any) {
      if (e?.code !== '12501' && e?.code !== 'SIGN_IN_CANCELLED') {
        const errCode = e?.code ? String(e.code) : '';
        const errMsg = (e?.message || '').slice(0, 180);
        let body = 'Please try email sign-up instead.';
        if (errCode === '10' || /DEVELOPER_ERROR/i.test(errMsg)) {
          body = 'Google Sign-In is not configured correctly (DEVELOPER_ERROR). Please use email sign-up.';
        } else if (errCode === '7' || /NETWORK_ERROR/i.test(errMsg)) {
          body = 'Network error. Please check your internet connection.';
        } else if (errMsg) {
          body = `Error: ${errMsg}`;
        }
        Alert.alert('Google Sign-Up Failed', body);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

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
          {/* Logo */}
          <Animated.View style={[s.logoSection, makeEntrance(fadeLogo)]}>
            <View style={s.logoMark}>
              <Text style={s.logoMarkText}>94</Text>
            </View>
            <Text style={s.wordmark}>BLACK94</Text>
          </Animated.View>

          {/* Title */}
          <Animated.View style={makeEntrance(fadeTitle)}>
            <Text style={s.title}>Create your account</Text>
            <Text style={s.subtitle}>
              Join Black94 and start connecting with people who matter.
            </Text>
          </Animated.View>

          {/* Feature chips */}
          <Animated.View style={[s.featuresRow, makeEntrance(fadeFeatures)]}>
            <FeatureChip icon="user-plus" label="Free Forever" />
            <FeatureChip icon="shield" label="E2E Encrypted" />
            <FeatureChip icon="zap" label="No Ads" />
          </Animated.View>

          {/* Form */}
          <Animated.View style={[s.form, makeEntrance(fadeForm)]}>
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

            <View style={s.inputWrap}>
              <Feather name="lock" size={18} color="rgba(255,255,255,0.4)" />
              <TextInput
                style={s.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Password (min 6 characters)"
                placeholderTextColor="rgba(255,255,255,0.3)"
                secureTextEntry
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={handleEmailSignUp}
              />
            </View>

            <TouchableOpacity style={s.primaryBtn} onPress={handleEmailSignUp} disabled={busy} activeOpacity={0.9}>
              {busy
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={s.primaryBtnText}>Create Account</Text>
              }
            </TouchableOpacity>

            {WEB_CLIENT_ID ? (
              <>
                <View style={s.orRow}>
                  <View style={s.orLine} />
                  <Text style={s.orText}>OR</Text>
                  <View style={s.orLine} />
                </View>
                <TouchableOpacity style={s.googleBtn} onPress={handleGoogle} disabled={busy} activeOpacity={0.92}>
                  <GoogleGLogo size={22} />
                  <Text style={s.googleBtnText}>Continue with Google</Text>
                </TouchableOpacity>
              </>
            ) : null}

            <TouchableOpacity
              onPress={() => navigation.navigate('Login' as never)}
              style={s.switchRow}
              activeOpacity={0.7}
            >
              <Text style={s.switchText}>Already have an account? </Text>
              <Text style={s.switchLink}>Sign in</Text>
            </TouchableOpacity>
          </Animated.View>

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

          {/* Footer */}
          <Animated.View style={[s.footer, makeEntrance(fadeFooter)]}>
            <Feather name="shield" size={11} color="rgba(255,255,255,0.22)" />
            <Text style={s.footerText}>End-to-end encrypted · Your data stays yours</Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ── Sub-components ── */

function FeatureChip({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={s.featureChip}>
      <Feather name={icon as any} size={11} color={colors.accent} />
      <Text style={s.featureChipText}>{label}</Text>
    </View>
  );
}

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

/* ── Styles ── */

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },

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

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 56,
    justifyContent: 'center',
  },

  logoSection: { alignItems: 'center', marginBottom: 20 },
  logoMark: {
    width: 72, height: 72, borderRadius: 20,
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
    color: '#000', fontSize: 30, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1.5,
  },
  wordmark: {
    fontSize: 30, fontWeight: '900', color: '#fff', letterSpacing: 8, textAlign: 'center',
  },

  title: {
    fontSize: 22, fontWeight: '800', color: '#fff',
    textAlign: 'center', marginBottom: 6, letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13, color: 'rgba(255,255,255,0.5)',
    textAlign: 'center', lineHeight: 19, paddingHorizontal: 16,
  },

  featuresRow: {
    flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap',
    gap: 8, marginTop: 20, marginBottom: 28, paddingHorizontal: 4,
  },
  featureChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'rgba(212,175,55,0.08)',
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.18)',
  },
  featureChipText: {
    fontSize: 10.5, fontWeight: '600',
    color: 'rgba(255,255,255,0.78)', letterSpacing: 0.3,
  },

  form: { gap: 12, marginBottom: 16 },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    height: 54, borderRadius: 14, paddingHorizontal: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  input: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 0 },

  primaryBtn: {
    height: 54, borderRadius: 14, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#000', letterSpacing: -0.2 },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 6 },
  orLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  orText: { fontSize: 11, color: 'rgba(255,255,255,0.32)', letterSpacing: 2, fontWeight: '600' },

  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, height: 54, backgroundColor: '#fff', borderRadius: 14,
    shadowColor: '#fff', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 12, elevation: 4,
  },
  googleBtnText: { fontSize: 15, fontWeight: '700', color: '#111', letterSpacing: -0.2 },

  switchRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingVertical: 10,
  },
  switchText: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  switchLink: { color: colors.accent, fontWeight: '700', fontSize: 14 },

  legalNotice: {
    fontSize: 11.5, color: 'rgba(255,255,255,0.38)',
    textAlign: 'center', lineHeight: 17, paddingHorizontal: 16, marginBottom: 16,
  },
  legalLink: { color: colors.accent, textDecorationLine: 'underline', fontWeight: '500' },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 10.5, color: 'rgba(255,255,255,0.25)', letterSpacing: 0.3,
  },

  // Google "G" logo
  gLogoWrap: {
    position: 'relative', overflow: 'hidden', backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  gHalf: { position: 'absolute' },
  gCore: {
    position: 'absolute', backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
});
