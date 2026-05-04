import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Alert,
  Linking,
} from 'react-native';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { signInWithGoogle } from '../lib/api';

/**
 * AuthScreen — Login screen matching black94.web.app exactly.
 *
 * Web layout (from page source):
 *   bg-[#000000], centered column, max-w-[420px]
 *   1) Logo image (w-20 h-20, mb-5)
 *   2) "Welcome Back" heading (text-3xl, font-bold, text-white)
 *   3) "Sign in to continue to Black94." subtitle (text-sm, #94a3b8)
 *   4) Google button (rounded-full, white bg, h-[52px], max-w-[320px])
 *      - Google SVG logo (h-5 w-5)
 *      - "Sign in with Google" text (text-[15px], font-semibold, text-gray-700)
 *   5) Divider row (mt-6, "or" text)
 *   6) "New to Black94? Create Account" link
 *   7) Terms text with links to /terms-of-service.html and /privacy-policy.html
 */
export default function AuthScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const { setUser, setToken } = useAppStore();

  const handleGoogleSignIn = useCallback(async () => {
    setIsLoading(true);
    try {
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');

      GoogleSignin.configure({
        scopes: ['email', 'profile'],
        webClientId: '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com',
        offlineAccess: true,
      });

      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      let idToken = userInfo.data?.idToken;
      if (!idToken) {
        try {
          const tokens = await GoogleSignin.getTokens();
          idToken = tokens.idToken;
        } catch (e) {
          console.warn('[AuthScreen] getTokens failed:', e);
        }
      }
      if (!idToken) throw new Error('Failed to obtain Google ID token');

      const user = await signInWithGoogle(idToken);
      if (user) {
        setUser(user);
        setToken(user.id);
      }
    } catch (error: any) {
      console.error('Google sign-in error:', error);
      if (error.code !== '12501') {
        // DEVELOPER_ERROR troubleshooting hint
        let msg = error.message || 'Something went wrong.';
        if (error.code === 'DEVELOPER_ERROR') {
          msg = 'Google Sign-In configuration error (DEVELOPER_ERROR). ' +
                'The app signing certificate SHA-1 must be registered in ' +
                'Firebase Console > Project Settings > Android App > SHA certificates.';
        }
        Alert.alert('Sign In Error', msg);
      }
    } finally {
      setIsLoading(false);
    }
  }, [setUser, setToken]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.inner}>
        {/* ── Brand: Logo + Title + Subtitle ─────────────────────────── */}
        <View style={styles.brandContainer}>
          {/* Using the same icon.png from assets */}
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
              {/* Google "G" logo — multicolor SVG rendered as 4 colored blocks */}
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
    </SafeAreaView>
  );
}

/* ─── Sub-components ───────────────────────────────────────────────────────── */

/** Brand logo using the app icon from assets */
function BrandLogo() {
  // Dynamically import Image to avoid potential issues
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

/**
 * Google "G" logo — multi-color version matching the web SVG.
 * The web uses a 4-color SVG (blue top-left, red top-right, yellow bottom-left, green bottom-right).
 * We replicate this with overlapping colored quarter-circles.
 */
function GoogleLogo() {
  return (
    <View style={styles.googleLogoContainer}>
      {/* Blue quadrant (top-left) */}
      <View style={[styles.googleQuad, { backgroundColor: '#4285F4', borderTopLeftRadius: 10, borderBottomLeftRadius: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0 }]} />
      {/* Red quadrant (top-right) */}
      <View style={[styles.googleQuad, { backgroundColor: '#EA4335', position: 'absolute', top: 0, right: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderTopRightRadius: 10, borderBottomRightRadius: 0 }]} />
      {/* Yellow quadrant (bottom-left) */}
      <View style={[styles.googleQuad, { backgroundColor: '#FBBC05', position: 'absolute', bottom: 0, left: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 10, borderTopRightRadius: 0, borderBottomRightRadius: 0 }]} />
      {/* Green quadrant (bottom-right) */}
      <View style={[styles.googleQuad, { backgroundColor: '#34A853', position: 'absolute', bottom: 0, right: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderTopRightRadius: 0, borderBottomRightRadius: 10 }]} />
    </View>
  );
}

/* ─── Styles — pixel-perfect match to black94.web.app ──────────────────────── */
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

  /* Brand */
  brandContainer: {
    alignItems: 'center',
    marginBottom: 40,
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

  /* Google Button — web: rounded-full, white bg, h-[52px], max-w-[320px] */
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

  /* Google Logo — 20x20 (h-5 w-5 in web = 20px) */
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

  /* Switch text */
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
    position: 'absolute',
    bottom: 40,
    width: '100%',
    maxWidth: 320,
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
