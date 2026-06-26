/**
 * AuthScreen — Black94 sign-in screen.
 * Uses the correct webClientId from app config (memora-bond project).
 * Routes new users to UsernameSetupScreen.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, Platform, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { signInWithGoogle } from '../lib/api';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { Feather } from '@expo/vector-icons';

// Uses the memora-bond web client ID set via GOOGLE_WEB_CLIENT_ID env variable
const WEB_CLIENT_ID = (Constants.expoConfig?.extra?.googleWebClientId as string)
  || '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com';

export default function AuthScreen() {
  const [busy, setBusy] = useState(false);
  const { setUser, setToken } = useAppStore();
  const navigation = useNavigation<any>();

  const handleSignIn = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
      GoogleSignin.configure({
        webClientId: WEB_CLIENT_ID,
        scopes: ['profile', 'email'],
      });
      if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      await GoogleSignin.signIn();

      let idToken: string | null = null;
      try {
        const tokens = await GoogleSignin.getTokens();
        idToken = tokens.idToken;
      } catch {}

      if (!idToken) {
        Alert.alert('Sign In Failed', 'Could not get authentication token. Please try again.');
        return;
      }

      const user = await signInWithGoogle(idToken);
      if (!user) {
        Alert.alert('Sign In Failed', 'Please try again.');
        return;
      }

      setUser(user);
      setToken(user.id);

      // New user (no username yet) → pick a username first
      if (!user.username || user.username.trim() === '') {
        navigation.replace('UsernameSetup');
      }
      // Existing user → App.js restoreAuth handles routing to main app

    } catch (e: any) {
      // Code 12501 = user cancelled — no alert needed
      if (e?.code !== '12501' && e?.code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Sign In Failed', 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, setUser, setToken, navigation]);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <View style={s.inner}>
        {/* Logo section */}
        <View style={s.topSection}>
          <View style={s.logoBox}>
            <Text style={s.logoB}>B</Text>
            <Text style={s.logo94}>94</Text>
          </View>
          <Text style={s.wordmark}>BLACK94</Text>
          <Text style={s.tagline}>Where conversations happen</Text>
        </View>

        {/* Auth buttons */}
        <View style={s.authSection}>
          <TouchableOpacity
            style={s.googleBtn}
            onPress={handleSignIn}
            disabled={busy}
            activeOpacity={0.9}
          >
            {busy ? (
              <ActivityIndicator color="#111" size="small" />
            ) : (
              <>
                <View style={s.googleIconWrap}>
                  <Text style={[s.g, { color: '#4285F4' }]}>G</Text>
                </View>
                <Text style={s.googleBtnText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={s.orRow}>
            <View style={s.orLine} />
            <Text style={s.orText}>OR</Text>
            <View style={s.orLine} />
          </View>

          <Text style={s.notice}>
            By continuing, you agree to our{' '}
            <Text style={s.link} onPress={() => Linking.openURL('https://black94.web.app/terms-of-service.html')}>
              Terms
            </Text>
            {' '}and{' '}
            <Text style={s.link} onPress={() => Linking.openURL('https://black94.web.app/privacy-policy.html')}>
              Privacy Policy
            </Text>
          </Text>
        </View>

        {/* Bottom */}
        <View style={s.bottomSection}>
          <Feather name="shield" size={14} color="rgba(255,255,255,0.2)" />
          <Text style={s.secureText}>End-to-end encrypted · Your data stays yours</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  inner: { flex: 1, paddingHorizontal: 28, justifyContent: 'space-between', paddingTop: 40, paddingBottom: 24 },

  topSection: { alignItems: 'center', paddingTop: 40 },
  logoBox: {
    width: 80, height: 80, borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: -2,
    marginBottom: 20,
    shadowColor: '#fff', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15, shadowRadius: 24, elevation: 0,
  },
  logoB: { fontSize: 30, fontWeight: '900', color: '#000', letterSpacing: -1 },
  logo94: { fontSize: 30, fontWeight: '900', color: '#D4AF37', letterSpacing: -1 },
  wordmark: {
    fontSize: 32, fontWeight: '900', color: '#fff',
    letterSpacing: 6, marginBottom: 10,
  },
  tagline: { fontSize: 14, color: 'rgba(255,255,255,0.35)', letterSpacing: 1 },

  authSection: { gap: 16 },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, height: 58, backgroundColor: '#fff', borderRadius: 16,
    shadowColor: '#fff', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
  },
  googleIconWrap: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#f0f0f0',
    alignItems: 'center', justifyContent: 'center',
  },
  g: { fontSize: 16, fontWeight: '900' },
  googleBtnText: { fontSize: 16, fontWeight: '700', color: '#111', letterSpacing: -0.3 },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orLine: { flex: 1, height: 0.5, backgroundColor: 'rgba(255,255,255,0.08)' },
  orText: { fontSize: 11, color: 'rgba(255,255,255,0.25)', letterSpacing: 1.5 },

  notice: { fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: 18 },
  link: { color: colors.accent, textDecorationLine: 'underline' },

  bottomSection: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  secureText: { fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: 0.2 },
});
