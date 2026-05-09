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
import GoogleSignInWebView from '../components/GoogleSignInWebView';

const WEB_CLIENT_ID = '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com';

/**
 * AuthScreen — Login screen matching black94.web.app exactly.
 *
 * Google Sign-In strategy:
 *   Android: WebView-based OAuth (intercepts Firebase redirect, no console setup needed)
 *   iOS:     expo-web-browser OAuth (ASWebAuthenticationSession intercepts HTTPS redirects)
 *
 * WHY WebView on Android:
 *   Chrome Custom Tabs cannot intercept HTTPS redirects on Android.
 *   Custom scheme redirects (black94://) require Google Cloud Console registration.
 *   WebView loads Google auth page, intercepts redirect to pre-authorized
 *   Firebase handler URL, extracts auth code — NO console configuration needed.
 */
export default function AuthScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [showWebView, setShowWebView] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const { setUser, setToken } = useAppStore();
  const insets = useSafeAreaInsets();

  /** Called when GoogleSignInWebView successfully gets an ID token */
  const handleWebViewToken = useCallback(async (idToken: string) => {
    setShowWebView(false);
    try {
      console.log('[AuthScreen] WebView auth succeeded, signing in to Firebase...');
      const user = await signInWithGoogle(idToken);
      if (user) {
        setUser(user);
        setToken(user.id);
      }
    } catch (err: any) {
      console.error('[AuthScreen] Firebase sign-in failed:', err);
      Alert.alert('Sign In Failed', err.message || 'Could not sign in to Firebase.');
      setIsLoading(false);
    }
  }, [setUser, setToken]);

  /** Called when GoogleSignInWebView encounters an error */
  const handleWebViewError = useCallback((error: string) => {
    setShowWebView(false);
    setIsLoading(false);
    console.error('[AuthScreen] WebView sign-in error:', error);
    Alert.alert('Sign In Failed', `Google sign-in failed: ${error}`);
  }, []);

  /** Called when user closes/dismisses the WebView */
  const handleWebViewCancel = useCallback(() => {
    setShowWebView(false);
    setIsLoading(false);
  }, []);

  const handleGoogleSignIn = useCallback(async () => {
    setIsLoading(true);

    try {
      if (Platform.OS === 'android') {
        // ═══════════════════════════════════════════════════════════════
        // ANDROID: Use WebView to handle Google OAuth.
        //
        // This bypasses both native sign-in (needs SHA-1 in Firebase) and
        // Chrome Custom Tabs (can't intercept HTTPS redirects).
        // The WebView intercepts Google's redirect to the pre-authorized
        // Firebase handler URL, extracts the auth code, and exchanges it.
        // ═══════════════════════════════════════════════════════════════
        console.log('[AuthScreen] Using WebView-based Google sign-in (Android)');
        setShowWebView(true);
        return; // WebView handles the rest via callbacks
      }

      // ═══════════════════════════════════════════════════════════════
      // iOS: Use expo-web-browser OAuth.
      // ASWebAuthenticationSession can intercept HTTPS redirects.
      // ═══════════════════════════════════════════════════════════════
      console.log('[AuthScreen] Using web OAuth (iOS)');
      const idToken = await signInWithGoogleWeb();
      if (idToken) {
        console.log('[AuthScreen] Web OAuth succeeded, signing in to Firebase...');
        const user = await signInWithGoogle(idToken);
        if (user) {
          setUser(user);
          setToken(user.id);
          return;
        }
      }
      throw new Error('Failed to obtain Google ID token');
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error('[AuthScreen] Sign-in failed:', errMsg);
      Alert.alert('Sign In Failed', `Could not sign in with Google.\n\nError: ${errMsg}`);
    } finally {
      if (Platform.OS !== 'android') {
        setIsLoading(false);
      }
    }
  }, [setUser, setToken]);

  // ═══════════════════════════════════════════════════════════════════
  // WebView mode: full-screen Google sign-in
  // ═══════════════════════════════════════════════════════════════════
  if (showWebView && Platform.OS === 'android') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <View style={styles.webViewHeader}>
          <TouchableOpacity onPress={handleWebViewCancel} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.webViewTitle}>Sign in with Google</Text>
          <View style={styles.closeButton} /> {/* Spacer for centering */}
        </View>
        <GoogleSignInWebView
          onToken={handleWebViewToken}
          onError={handleWebViewError}
          onCancel={handleWebViewCancel}
        />
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // Normal auth screen
  // ═══════════════════════════════════════════════════════════════════
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={[styles.inner, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* ── Brand: Logo + Title + Subtitle ─────────────────────────── */}
        <View style={styles.brandContainer}>
          <BrandLogo />
          <Text style={styles.title}>{mode === 'signin' ? 'Welcome Back' : 'Create Account'}</Text>
          <Text style={styles.subtitle}>
            {mode === 'signin'
              ? 'Sign in to continue to Black94.'
              : 'Join Black94 and start connecting today.'}
          </Text>
        </View>

        {/* ── Google Sign-In Button ─────────────────────────────────── */}
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

        {/* ── Divider ("or") ────────────────────────────────────────── */}
        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.divider} />
        </View>

        {/* ── Switch between Sign In / Sign Up ───────────────────────── */}
        <TouchableOpacity
          style={styles.switchButton}
          activeOpacity={0.7}
          onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          <Text style={styles.switchText}>
            {mode === 'signin'
              ? 'New to Black94? '
              : 'Already have an account? '}
            <Text style={styles.switchLink}>
              {mode === 'signin' ? 'Create Account' : 'Sign In'}
            </Text>
          </Text>
        </TouchableOpacity>

        {/* ── Terms ─────────────────────────────────────────────────── */}
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

  /* WebView header */
  webViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
  },
  closeButton: {
    width: 60,
    height: 36,
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#4285F4',
    fontSize: 16,
    fontWeight: '600',
  },
  webViewTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },

  /* Brand */
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

  /* Google Button */
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

  /* Google Logo */
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

  /* Divider */
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

  /* Switch */
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

  /* Terms */
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
