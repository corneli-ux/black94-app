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

/**
 * Web client ID from Firebase Console.
 * Used by native Google Sign-In SDK to obtain the ID token.
 */
const WEB_CLIENT_ID = '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com';

/**
 * AuthScreen — Login / Sign-up screen.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ GOOGLE SIGN-IN STRATEGY                                     │
 * │                                                             │
 * │   ANDROID:                                                  │
 * │     Native Google Sign-In SDK ONLY.                         │
 * │     • Stays entirely within the app (no browser).           │
 * │     • Uses @react-native-google-signin/google-signin.       │
 * │     • Requires SHA-1 registered in Firebase Console.        │
 * │     • Requires Google Play Services on the device.          │
 * │                                                             │
 * │     WHY NO BROWSER FALLBACK?                                │
 * │     Browser-based OAuth uses redirect_uri=black94://auth    │
 * │     (custom scheme). Google REJECTS custom scheme redirect  │
 * │     URIs for web clients — only HTTPS is allowed.           │
 * │     Error 400: invalid_request is UNFIXABLE in code.        │
 * │                                                             │
 * │   IOS:                                                      │
 * │     expo-web-browser (ASWebAuthenticationSession).          │
 * │     • Uses HTTPS redirect URI (Firebase handler).           │
 * │     • Stays within the app — system managed.                │
 * └─────────────────────────────────────────────────────────────┘
 */
export default function AuthScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const { setUser, setToken } = useAppStore();
  const insets = useSafeAreaInsets();

  /** Exchange ID token for Firebase user and update store */
  const completeSignIn = useCallback(async (idToken: string) => {
    console.log('[AuthScreen] Completing sign-in with ID token...');
    const user = await signInWithGoogle(idToken);
    if (user) {
      setUser(user);
      setToken(user.id);
      console.log('[AuthScreen] Sign-in complete for:', user.email);
    } else {
      throw new Error('Firebase sign-in returned no user');
    }
  }, [setUser, setToken]);

  /**
   * Android: Native Google Sign-In.
   * Stays entirely within the app — no browser opened.
   */
  const androidNativeSignIn = useCallback(async (): Promise<string> => {
    console.log('[AuthScreen] Starting native Google Sign-In (Android)...');

    const { GoogleSignin } = await import('@react-native-google-signin/google-signin');

    // Configure native Google Sign-In
    // - webClientId: Required to get the ID token (uses the Web OAuth client)
    // - offlineAccess: false (we don't need refresh tokens from Google, Firebase handles this)
    // - forceCodeForRefreshToken: false (we need ID token, not auth code)
    GoogleSignin.configure({
      webClientId: WEB_CLIENT_ID,
      offlineAccess: false,
      forceCodeForRefreshToken: false,
      scopes: ['profile', 'email'],
    });
    console.log('[AuthScreen] GoogleSignin configured with webClientId');

    // Step 1: Verify Google Play Services is available
    // showPlayServicesUpdateDialog: true → prompts user to update if outdated
    const playServicesAvailable = await GoogleSignin.hasPlayServices({
      showPlayServicesUpdateDialog: true,
    });
    console.log('[AuthScreen] Play Services available:', playServicesAvailable);

    // Step 2: Sign in — shows the Google account picker (native UI, within app)
    const result = await GoogleSignin.signIn();
    console.log('[AuthScreen] Native signIn returned, keys:', Object.keys(result));

    // Step 3: Extract ID token
    // @react-native-google-signin v14+ wraps response in .data
    // Older versions return idToken directly on the result object
    const idToken = result.data?.idToken || (result as any).idToken;

    if (!idToken) {
      console.error('[AuthScreen] No ID token in sign-in result:', JSON.stringify(result));
      throw new Error(
        'Google Sign-In succeeded but returned no ID token.\n\n' +
        'This is a temporary issue. Please try again.\n\n' +
        'If it persists, clear Google Play Services cache:\n' +
        'Settings → Apps → Google Play Services → Storage → Clear Cache'
      );
    }

    console.log('[AuthScreen] Got ID token (length:', idToken.length, ')');
    return idToken;
  }, []);

  const handleGoogleSignIn = useCallback(async () => {
    setIsLoading(true);

    try {
      if (Platform.OS === 'android') {
        // ═══════════════════════════════════════════════════════
        // ANDROID: Native Google Sign-In SDK ONLY
        // No browser. No WebView. Stays within the app.
        // ═══════════════════════════════════════════════════════
        const idToken = await androidNativeSignIn();
        await completeSignIn(idToken);
        return;
      }

      // ═══════════════════════════════════════════════════════
      // IOS: expo-web-browser (ASWebAuthenticationSession)
      // Uses HTTPS redirect URI — stays within app experience.
      // ═══════════════════════════════════════════════════════
      console.log('[AuthScreen] Using web OAuth (iOS)');
      const idToken = await signInWithGoogleWeb();
      await completeSignIn(idToken);
    } catch (err: any) {
      const code = err?.code;
      const message = err?.message || String(err);

      console.error('[AuthScreen] Sign-in error:', {
        code,
        message,
        name: err?.name,
        stack: err?.stack?.slice(0, 500),
      });

      // ── DEVELOPER_ERROR (code 10) ──
      // SHA-1 not registered in Google Cloud Console / Firebase Console
      // OR the app's package name doesn't match
      if (code === 'DEVELOPER_ERROR' || code === 10 || String(code) === '10') {
        Alert.alert(
          'Google Sign-In Setup Required',
          'The app\'s signing certificate needs to be registered.\n\n' +
          'Go to Firebase Console:\n' +
          '1. Open project "black94"\n' +
          '2. Project Settings → Android App\n' +
          '3. Add this SHA-1 fingerprint:\n\n' +
          'F5:3F:0D:14:74:1D:8F:88:17:7E:49:AA:B8:2F:D0:2B:A2:D6:DD:C4\n\n' +
          'After adding, download the updated google-services.json\n' +
          'and rebuild the app.',
          [{ text: 'OK' }]
        );
        return;
      }

      // ── SIGN_IN_CANCELLED (code 12501) ──
      // User pressed back / cancelled the account picker — not an error
      if (String(code) === '12501') {
        console.log('[AuthScreen] User cancelled sign-in');
        return;
      }

      // ── Play Services errors ──
      if (
        message?.includes('Play Services') ||
        message?.includes('GOOGLE_PLAY_SERVICES') ||
        message?.includes('ConnectionResult')
      ) {
        Alert.alert(
          'Google Play Services Required',
          'Google Sign-In requires Google Play Services.\n\n' +
          'Please:\n' +
          '1. Update Google Play Services in Play Store\n' +
          '2. Restart your device\n' +
          '3. Try again',
          [{ text: 'OK' }]
        );
        return;
      }

      // ── Network / timeout errors ──
      if (
        message?.includes('network') ||
        message?.includes('timeout') ||
        message?.includes('ETIMEOUT') ||
        message?.includes('ECONNREFUSED')
      ) {
        Alert.alert(
          'Connection Error',
          'Could not connect to Google. Please check your internet connection and try again.',
          [{ text: 'OK' }]
        );
        return;
      }

      // ── All other errors ──
      Alert.alert(
        'Sign In Failed',
        message || 'An unknown error occurred. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsLoading(false);
    }
  }, [androidNativeSignIn, completeSignIn]);

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
