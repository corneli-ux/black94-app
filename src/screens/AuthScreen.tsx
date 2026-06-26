/**
 * AuthScreen — Black94 sign-in screen.
 * Uses the correct webClientId from app config (memora-bond project).
 * Routes new users to UsernameSetupScreen.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, Platform, Alert, Linking, Image,
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

  // Log the web client ID prefix on mount so we can verify the correct ID
  // is baked into the build (visible in logcat / Expo dev tools).
  // Mask all but the project number prefix and last 4 chars.
  useEffect(() => {
    const masked = WEB_CLIENT_ID.length > 20
      ? `${WEB_CLIENT_ID.slice(0, 12)}...${WEB_CLIENT_ID.slice(-4)}`
      : '(not set)';
    console.log('[Auth] WEB_CLIENT_ID in use:', masked);
    console.log('[Auth] Firebase API key set:', !!Constants.expoConfig?.extra?.firebaseApiKey);
  }, []);

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
      } catch (tokenErr: any) {
        console.warn('[Auth] getTokens failed:', tokenErr?.code, tokenErr?.message);
      }

      if (!idToken) {
        Alert.alert(
          'Sign In Failed',
          'Could not get authentication token from Google. Please try again.',
        );
        return;
      }

      const user = await signInWithGoogle(idToken);
      if (!user) {
        Alert.alert('Sign In Failed', 'Sign-in was cancelled or failed. Please try again.');
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
      // Code 12501 / SIGN_IN_CANCELLED = user cancelled — no alert needed
      if (e?.code === '12501' || e?.code === 'SIGN_IN_CANCELLED') {
        return;
      }

      // Log the full error for debugging (visible in logcat / Expo dev tools)
      console.error('[Auth] Sign-in error:', {
        code: e?.code,
        message: e?.message,
        name: e?.name,
      });

      // Surface a SPECIFIC error so the user (and we) can diagnose the failure.
      // Generic "Something went wrong" made this impossible to debug remotely.
      const errCode = e?.code ? String(e.code) : '';
      const errMsg = (e?.message || '').slice(0, 180);

      let title = 'Sign In Failed';
      let body = 'Please try again.';

      // Common Google Sign-In error codes
      if (errCode === '10' || /DEVELOPER_ERROR/i.test(errMsg)) {
        // Developer error = SHA-1 not registered, package name mismatch,
        // or webClientId belongs to a different Google Cloud project.
        body = 'Google Sign-In is not configured correctly for this app. ' +
               'Please contact support. (Code: DEVELOPER_ERROR)';
      } else if (errCode === '7' || /NETWORK_ERROR/i.test(errMsg)) {
        body = 'Network error. Please check your internet connection and try again.';
      } else if (errCode === '8' || /INTERNAL_ERROR/i.test(errMsg)) {
        body = 'Google Play Services internal error. Please restart the app and try again.';
      } else if (errCode === '5' || /SIGN_IN_REQUIRED/i.test(errMsg)) {
        body = 'Please sign in to your Google account in device settings first.';
      } else if (/INVALID_IDP_RESPONSE|INVALID_ID_TOKEN|operation-not-allowed|OPERATION_NOT_ALLOWED/i.test(errMsg)) {
        // Firebase Auth REST errors
        body = 'Google Sign-In is not enabled for this Firebase project, or the ' +
               'web client ID is wrong. Please contact support.';
      } else if (/INVALID_API_KEY/i.test(errMsg)) {
        body = 'Firebase API key is invalid. Please contact support.';
      } else if (/permission-denied|PERMISSION_DENIED/i.test(errMsg)) {
        body = 'Permission denied. The Google client ID may not match this Firebase project.';
      } else if (/email-already-in-use|EMAIL_EXISTS/i.test(errMsg)) {
        body = 'This email is already registered with a different sign-in method.';
      } else if (errMsg) {
        // Show the actual error message (truncated) so we can diagnose remotely
        body = `Error: ${errMsg}`;
      }

      Alert.alert(title, body);
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
          <Image
            source={require('../../assets/logo.png')}
            style={s.logoImage}
            resizeMode="contain"
          />
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

  topSection: { alignItems: 'center', paddingTop: 20 },
  logoImage: {
    width: 280, height: 80, marginBottom: 16,
  },
  tagline: { fontSize: 13, color: 'rgba(255,255,255,0.35)', letterSpacing: 1.5, textTransform: 'uppercase' },

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
