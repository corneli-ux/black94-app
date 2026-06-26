/**
 * AuthScreen — Black94 sign-in.
 * Primary: Email/password (works 100% — no OAuth web client needed).
 * Secondary: Google Sign-In (when web client is configured).
 * Routes new users to UsernameSetupScreen.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, Platform, Alert, Linking, Image, TextInput,
  KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { signInWithGoogle, signUpWithEmailAuth, signInWithEmailAuth } from '../lib/api';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { Feather } from '@expo/vector-icons';

const WEB_CLIENT_ID = (Constants.expoConfig?.extra?.googleWebClientId as string) || '';

export default function AuthScreen() {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const { setUser, setToken } = useAppStore();
  const navigation = useNavigation<any>();

  const routeAfterAuth = useCallback((user: any) => {
    setUser(user);
    setToken(user.id);
    if (!user.username || user.username.trim() === '') {
      navigation.replace('UsernameSetup');
    }
  }, [setUser, setToken, navigation]);

  // Email auth — the reliable path
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
    try {
      const user = mode === 'signup'
        ? await signUpWithEmailAuth(email.trim(), password, name.trim())
        : await signInWithEmailAuth(email.trim(), password);
      if (user) routeAfterAuth(user);
    } catch (e: any) {
      const msg = e?.message || '';
      let friendly = 'Something went wrong. Please try again.';
      if (msg.includes('EMAIL_EXISTS')) friendly = 'This email is already registered. Try signing in.';
      else if (msg.includes('EMAIL_NOT_FOUND')) friendly = 'No account found. Try creating one.';
      else if (msg.includes('INVALID_PASSWORD') || msg.includes('INVALID_LOGIN_CREDENTIALS')) friendly = 'Incorrect email or password.';
      else if (msg.includes('INVALID_EMAIL')) friendly = 'Please enter a valid email address.';
      Alert.alert(mode === 'signup' ? 'Sign Up Failed' : 'Sign In Failed', friendly);
    } finally {
      setBusy(false);
    }
  }, [busy, email, password, name, mode, routeAfterAuth]);

  // Google auth — secondary
  const handleGoogle = useCallback(async () => {
    if (busy) return;
    if (!WEB_CLIENT_ID) {
      Alert.alert('Google Sign-In unavailable', 'Please use email sign-in.');
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
      if (!idToken) { Alert.alert('Sign In Failed', 'Could not get token. Use email sign-in.'); return; }
      const user = await signInWithGoogle(idToken);
      if (user) routeAfterAuth(user);
    } catch (e: any) {
      if (e?.code !== '12501' && e?.code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Google Sign-In Failed', 'Please use email sign-in instead.');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, routeAfterAuth]);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {/* Logo */}
          <View style={s.logoSection}>
            <Image source={require('../../assets/logo.png')} style={s.logoImage} resizeMode="contain" />
            <Text style={s.tagline}>Where conversations happen</Text>
          </View>

          {/* Form */}
          <View style={s.form}>
            <View style={s.tabRow}>
              <TouchableOpacity
                style={[s.tab, mode === 'signin' && s.tabActive]}
                onPress={() => setMode('signin')}
              >
                <Text style={[s.tabText, mode === 'signin' && s.tabTextActive]}>Sign In</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.tab, mode === 'signup' && s.tabActive]}
                onPress={() => setMode('signup')}
              >
                <Text style={[s.tabText, mode === 'signup' && s.tabTextActive]}>Create Account</Text>
              </TouchableOpacity>
            </View>

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
                />
              </View>
            )}

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
              />
            </View>

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
              />
            </View>

            <TouchableOpacity style={s.primaryBtn} onPress={handleEmailAuth} disabled={busy} activeOpacity={0.9}>
              {busy
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={s.primaryBtnText}>{mode === 'signup' ? 'Create Account' : 'Sign In'}</Text>
              }
            </TouchableOpacity>

            {WEB_CLIENT_ID ? (
              <>
                <View style={s.orRow}>
                  <View style={s.orLine} />
                  <Text style={s.orText}>OR</Text>
                  <View style={s.orLine} />
                </View>
                <TouchableOpacity style={s.googleBtn} onPress={handleGoogle} disabled={busy} activeOpacity={0.9}>
                  <View style={s.gIcon}><Text style={[s.g, { color: '#4285F4' }]}>G</Text></View>
                  <Text style={s.googleBtnText}>Continue with Google</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>

          <Text style={s.notice}>
            By continuing, you agree to our{' '}
            <Text style={s.link} onPress={() => Linking.openURL('https://black94.web.app/terms-of-service.html')}>Terms</Text>
            {' '}and{' '}
            <Text style={s.link} onPress={() => Linking.openURL('https://black94.web.app/privacy-policy.html')}>Privacy Policy</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 40, paddingBottom: 32, justifyContent: 'center' },
  logoSection: { alignItems: 'center', marginBottom: 40 },
  logoImage: { width: 260, height: 72, marginBottom: 12 },
  tagline: { fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5, textTransform: 'uppercase' },

  form: { gap: 14 },
  tabRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 4, marginBottom: 6 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 9 },
  tabActive: { backgroundColor: colors.accent },
  tabText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  tabTextActive: { color: '#000' },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    height: 54, borderRadius: 14, paddingHorizontal: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  input: { flex: 1, color: '#fff', fontSize: 15 },

  primaryBtn: {
    height: 54, borderRadius: 14, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#000', letterSpacing: -0.2 },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  orLine: { flex: 1, height: 0.5, backgroundColor: 'rgba(255,255,255,0.1)' },
  orText: { fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: 1 },

  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    height: 54, backgroundColor: '#fff', borderRadius: 14,
  },
  gIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  g: { fontSize: 15, fontWeight: '900' },
  googleBtnText: { fontSize: 15, fontWeight: '700', color: '#111' },

  notice: { fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: 18, marginTop: 24 },
  link: { color: colors.accent, textDecorationLine: 'underline' },
});
