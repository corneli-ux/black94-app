import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../stores/app';
import { signInWithGoogle } from '../lib/api';
import { signInWithGoogleWeb } from '../lib/google-web-auth';

const WEB_CLIENT_ID = '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com';

/**
 * AuthScreen — Login screen.
 *
 * Google Sign-In strategy:
 *
 *   ANDROID:
 *     1. Native Google Sign-In SDK first (@react-native-google-signin)
 *        → Official method for Play Store, requires SHA-1 in Firebase Console
 *     2. Chrome Custom Tabs fallback (expo-web-browser)
 *        → Requires black94://auth registered as redirect URI in Google Cloud Console
 *
 *   IOS:
 *     1. expo-web-browser (ASWebAuthenticationSession)
 *        → Works with Firebase's pre-authorized HTTPS redirect URI
 *
 * IMPORTANT: Google blocks OAuth from embedded WebViews (Error 403: disallowed_useragent).
 * We use expo-web-browser which opens Chrome Custom Tabs / Safari — both are "secure browsers".
 */
export default function AuthScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const { setUser, setToken } = useAppStore();
  const insets = useSafeAreaInsets();

  /** Complete sign-in: exchange ID token for Firebase user */
  const completeSignIn = useCallback(async (idToken: string) => {
    const user = await signInWithGoogle(idToken);
    if (user) {
      setUser(user);
      setToken(user.id);
    } else {
      throw new Error('Firebase sign-in returned no user');
    }
  }, [setUser, setToken]);

  /** Try native Google Sign-In */
  const tryNativeGoogleSignIn = useCallback(async (): Promise<string | null> => {
    try {
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');

      GoogleSignin.configure({
        webClientId: WEB_CLIENT_ID,
        offlineAccess: false,
        forceCodeForRefreshToken: false,
      });

      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: false });
      console.log('[AuthScreen] Play Services available, trying native sign-in...');

      const result = await GoogleSignin.signIn();
      const idToken = result.data?.idToken;

      if (idToken) {
        console.log('[AuthScreen] Native sign-in succeeded');
        return idToken;
      }

      console.warn('[AuthScreen] Native sign-in returned no ID token');
      return null;
    } catch (err: any) {
      const code = err?.code;
      if (code === 'DEVELOPER_ERROR' || code === 10 || String(code) === '10') {
        console.warn('[AuthScreen] DEVELOPER_ERROR — SHA-1 not registered, falling back');
      } else {
        console.warn('[AuthScreen] Native sign-in failed:', code, err?.message);
      }
      return null;
    }
  }, []);

  const handleGoogleSignIn = useCallback(async () => {
    setIsLoading(true);

    try {
      if (Platform.OS === 'android') {
        // ═══════════════════════════════════════════════════════════════
        // ANDROID: Native first, Chrome Custom Tabs fallback
        // ═══════════════════════════════════════════════════════════════

        // Step 1: Try native Google Sign-In SDK
        const nativeToken = await tryNativeGoogleSignIn();
        if (nativeToken) {
          await completeSignIn(nativeToken);
          return;
        }

        // Step 2: Fall back to Chrome Custom Tabs (expo-web-browser)
        console.log('[AuthScreen] Using Chrome Custom Tabs (web OAuth)');
        const webToken = await signInWithGoogleWeb();
        if (webToken) {
          await completeSignIn(webToken);
          return;
        }

        throw new Error('All sign-in methods failed');
      }

      // ═══════════════════════════════════════════════════════════════
      // IOS: expo-web-browser (ASWebAuthenticationSession)
      // ═══════════════════════════════════════════════════════════════
      console.log('[AuthScreen] Using web OAuth (iOS)');
      const idToken = await signInWithGoogleWeb();
      if (idToken) {
        await completeSignIn(idToken);
        return;
      }

      throw new Error('Failed to obtain Google ID token');
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error('[AuthScreen] Sign-in failed:', errMsg);
      Alert.alert('Sign In Failed', `Could not sign in with Google.\n\n${errMsg}`);
    } finally {
      setIsLoading(false);
    }
  }, [tryNativeGoogleSignIn, completeSignIn]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={[styles.inner, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Brand */}
        <View style={styles.brandContainer}>
          <BrandLogo />
          <Text style={styles.title}>{mode === 'signin' ? 'Welcome Back' : 'Create Account'}</Text>
          <Text style={styles.subtitle}>
            {mode === 'signin'
              ? 'Sign in to continue to Black94.'
              : 'Join Black94 and start connecting today.'}
          </Text>
        </View>

        {/* Google Sign-In Button */}
        <TouchableOpacity
          style={styles.googleButton}
          onPress={handleGoogleSignIn}
          activeOpacity={0.8}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#555555" size="small" />
          ) : (
            <View style={styles.googleButtonContent}>
              <GoogleLogo />
              <Text style={styles.googleButtonText}>
                {mode === 'signin' ? 'Sign in with Google' : 'Sign up with Google'}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.divider} />
        </View>

        {/* Switch mode */}
        <TouchableOpacity
          style={styles.switchButton}
          activeOpacity={0.7}
          onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          <Text style={styles.switchText}>
            {mode === 'signin' ? 'New to Black94? ' : 'Already have an account? '}
            <Text style={styles.switchLink}>
              {mode === 'signin' ? 'Create Account' : 'Sign In'}
            </Text>
          </Text>
        </TouchableOpacity>

        {/* Terms */}
        <View style={styles.termsContainer}>
          <Text style={styles.termsText}>
            By signing in, you agree to our{' '}
            <Text
              style={styles.termsLink}
              onPress={() => Linking.openURL('https://black94.web.app/terms-of-service.html')}
            >
              Terms of Service
            </Text>{' '}
            and{' '}
            <Text
              style={styles.termsLink}
              onPress={() => Linking.openURL('https://black94.web.app/privacy-policy.html')}
            >
              Privacy Policy
            </Text>
            .
          </Text>
        </View>
      </View>
    </View>
  );
}

/* ─── Sub-components ───────────────────────────────────────────────────────── */

function BrandLogo() {
  const { Image } = require('react-native');
  return (
    <Image
      source={require('../../assets/icon.png')}
      style={styles.logo}
      resizeMode="contain"
      accessibilityLabel="Black94"
    />
  );
}

function GoogleLogo() {
  return (
    <View style={styles.googleLogoContainer}>
      <View style={[styles.googleQuad, { backgroundColor: '#4285F4', borderTopLeftRadius: 10, borderBottomLeftRadius: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0 }]} />
      <View style={[styles.googleQuad, { backgroundColor: '#EA4335', position: 'absolute', top: 0, right: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderTopRightRadius: 10, borderBottomRightRadius: 0 }]} />
      <View style={[styles.googleQuad, { backgroundColor: '#FBBC05', position: 'absolute', bottom: 0, left: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 10, borderTopRightRadius: 0, borderBottomRightRadius: 0 }]} />
      <View style={[styles.googleQuad, { backgroundColor: '#34A853', position: 'absolute', bottom: 0, right: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderTopRightRadius: 0, borderBottomRightRadius: 10 }]} />
    </View>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 20,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 8,
    textAlign: 'center',
  },
  googleButton: {
    width: '100%',
    maxWidth: 320,
    height: 52,
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  googleButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    letterSpacing: -0.1,
  },
  googleLogoContainer: {
    width: 20,
    height: 20,
    borderRadius: 10,
    overflow: 'hidden',
  },
  googleQuad: {
    width: '50%',
    height: '50%',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
    marginTop: 24,
    gap: 12,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  dividerText: {
    fontSize: 12,
    color: '#64748b',
  },
  switchButton: {
    marginTop: 16,
  },
  switchText: {
    fontSize: 14,
    color: '#94a3b8',
  },
  switchLink: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  termsContainer: {
    marginTop: 16,
    maxWidth: 320,
    width: '100%',
    alignItems: 'center',
  },
  termsText: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
  },
  termsLink: {
    color: '#FFFFFF',
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
    textDecorationColor: '#FFFFFF',
  },
});
