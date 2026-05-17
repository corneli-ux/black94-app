import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Linking,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../stores/app';
import { signInWithGoogle } from '../lib/api';

const WEB_CLIENT_ID = '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com';

/**
 * AuthScreen — Login screen matching black94.web.app exactly.
 *
 * Auth strategy:
 *   ALL platforms: Native Google Sign-In ONLY.
 *   WHY: Web OAuth opens a real browser tab (Chrome Custom Tabs / Safari) where
 *   Google can show raw error pages exposing project IDs, developer emails, and
 *   OAuth error details BEFORE our code runs. We cannot sanitize what the user
 *   already sees. Native sign-in uses the system account picker — errors come
 *   back as error codes that we catch and display as branded Black94 messages.
 *
 * Error handling:
 *   All error messages are sanitized to remove project IDs, developer emails,
 *   Firebase URLs, and other internal identifiers. The user only sees
 *   branded Black94 error messages — never Google's raw error page content.
 */
export default function AuthScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [authError, setAuthError] = useState<string | null>(null);
  const { setUser, setToken } = useAppStore();
  const insets = useSafeAreaInsets();

  const handleGoogleSignIn = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);
    let lastError: Error | null = null;

    try {
      // ═══════════════════════════════════════════════════════════════════
      // Native Google Sign-In ONLY — both platforms.
      // Web OAuth is intentionally NOT used because it opens a real browser
      // where Google can show raw error pages (project IDs, dev emails) that
      // we cannot intercept before the user sees them.
      // ═══════════════════════════════════════════════════════════════════

      let idToken: string | null = null;
      try {
        idToken = await nativeGoogleSignIn();
      } catch (err: any) {
        lastError = err;
        console.error('[AuthScreen] Native Google sign-in failed:', err.code, err.message);

        // User explicitly cancelled the account picker
        if (err.code === '12501' || err.message?.includes('cancelled')) {
          setAuthError('Sign-in was cancelled.');
          return;
        }

        // DEVELOPER_ERROR = SHA-1 certificate not registered in Google Cloud Console
        if (err.code === 'DEVELOPER_ERROR') {
          setAuthError(
            'Google Sign-In is not configured for this build. ' +
            'The app signing certificate needs to be registered in Google Cloud Console.',
          );
          return;
        }

        // Map other common native SDK errors to user-friendly messages
        const userMsg = mapNativeError(err);
        setAuthError(userMsg);
        return;
      }

      // If we got here, native sign-in returned an ID token — sign into Firebase
      if (idToken) {
        console.log('[AuthScreen] Native auth succeeded, signing in to Firebase...');
        try {
          const user = await signInWithGoogle(idToken);
          if (user) {
            setUser(user);
            setToken(user.id);
            return; // Success!
          }
        } catch (err: any) {
          console.error('[AuthScreen] Firebase sign-in failed:', err.message);
          setAuthError(sanitizeErrorMessage(err.message || 'Sign-in failed. Please try again.'));
          return;
        }
      }

      // Should not reach here, but handle gracefully
      setAuthError('Sign-in failed unexpectedly. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [setUser, setToken]);

  /**
   * Map native Google Sign-In SDK errors to user-friendly messages.
   * The SDK uses numeric status codes; we map them to safe, branded text.
   */
  function mapNativeError(err: any): string {
    const msg = (err.message || '').toLowerCase();
    const code = err.code || '';

    // Google Play Services not available / outdated
    if (code === 'SERVICE_MISSING' || code === 'SERVICE_VERSION_UPDATE_REQUIRED' ||
        msg.includes('play services') || msg.includes('google play')) {
      return 'Google Play Services is required for sign-in. Please update it in your device settings.';
    }

    // Network errors
    if (msg.includes('network') || msg.includes('timeout') || msg.includes('connection')) {
      return 'No internet connection. Please check your network and try again.';
    }

    // Internal error from Google Sign-In SDK
    if (code === 'INTERNAL_ERROR' || code === 'ERROR') {
      return 'Google Sign-In encountered an error. Please try again.';
    }

    // Sanitize and return the raw message for anything else
    return sanitizeErrorMessage(err.message || 'Sign-in failed. Please try again.');
  }

  /** Native Google Sign-In — uses system account picker on both platforms */
  async function nativeGoogleSignIn(): Promise<string> {
    const { GoogleSignin } = await import('@react-native-google-signin/google-signin');

    GoogleSignin.configure({
      scopes: ['email', 'profile'],
      webClientId: WEB_CLIENT_ID,
    });

    // hasPlayServices is Android-only; on iOS it doesn't exist and would crash
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    const userInfo = await GoogleSignin.signIn();

    // Get ID token from sign-in result
    let idToken = userInfo.data?.idToken;
    if (!idToken) {
      try {
        const tokens = await GoogleSignin.getTokens();
        idToken = tokens.idToken;
      } catch (e) {
        console.warn('[AuthScreen] getTokens failed:', e);
      }
    }
    if (!idToken) throw new Error('Failed to obtain Google ID token from native sign-in');
    return idToken;
  }

  // ── Error state: full-screen branded error ──
  if (authError) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <View style={[styles.inner, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.brandContainer}>
            <BrandLogo />
            <Text style={styles.errorTitle}>Unable to Sign In</Text>
            <Text style={styles.errorMessage}>{authError}</Text>
          </View>

          <TouchableOpacity
            style={styles.googleButton}
            onPress={() => { setAuthError(null); handleGoogleSignIn(); }}
            activeOpacity={0.8}
          >
            <View style={styles.googleButtonContent}>
              <GoogleLogo />
              <Text style={styles.googleButtonText}>Try Again</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.supportButton}
            activeOpacity={0.7}
            onPress={() => Linking.openURL('mailto:tabiblia.ai@gmail.com?subject=Black94%20Sign-In%20Issue')}
          >
            <Text style={styles.supportText}>Need help? Contact support</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={[styles.inner, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* ── Brand: Logo + Title + Subtitle ─────────────────────────── */}
        <View style={styles.brandContainer}>
          {/* Using the same icon.png from assets (same image as web /logo.png) */}
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

        {/* ── Terms (normal flow, matching web mt-4) ───────────────── */}
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

/** Brand logo using the app icon from assets */
function BrandLogo() {
  const { Image } = require('react-native');
  return (
    <Image
      source={require('../../assets/logo.png')}
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

/* ─── Error sanitization ──────────────────────────────────────────────────── */

/**
 * Strip project IDs, emails, and other identifiers from error messages.
 * Ensures the user NEVER sees internal details like project-210565807767
 * or developer contact emails in error messages.
 */
function sanitizeErrorMessage(raw: string): string {
  return raw
    .replace(/project-\d+/gi, '[project]')
    .replace(/\d{12,}/g, '[id]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/firebaseapp\.com/gi, '[firebase]')
    .replace(/googleusercontent\.com/gi, '[oauth]')
    .replace(/google\.com\/sign in\/oauth\/error/gi, '[google auth]');
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
    paddingHorizontal: 24, // web: px-6 = 24px
  },

  /* Brand — web: mb-8 = 32px container margin */
  brandContainer: {
    alignItems: 'center',
    marginBottom: 32, // web: mb-8
  },
  logo: {
    width: 80,   // web: w-20
    height: 80,  // web: h-20
    marginBottom: 20, // web: mb-5
  },
  title: {
    fontSize: 30,     // web: text-3xl
    fontWeight: '700', // web: font-bold
    color: '#FFFFFF',
    letterSpacing: -0.5, // web: tracking-tight
  },
  subtitle: {
    fontSize: 14,     // web: text-sm
    color: '#94a3b8', // web: text-[#94a3b8]
    marginTop: 8,     // web: mt-2
    textAlign: 'center',
  },

  /* Error state */
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 16,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 8,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 20,
  },
  supportButton: {
    marginTop: 24,
  },
  supportText: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
  },

  /* Google Button — web: rounded-full, bg-white, h-[52px], max-w-[320px] */
  googleButton: {
    width: '100%',
    maxWidth: 320,    // web: max-w-[320px]
    height: 52,       // web: h-[52px]
    backgroundColor: '#FFFFFF',
    borderRadius: 26,  // web: rounded-full (pill shape)
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,          // web: gap-3 = 12px
  },
  googleButtonText: {
    fontSize: 15,     // web: text-[15px]
    fontWeight: '600', // web: font-semibold
    color: '#374151', // web: text-gray-700
    letterSpacing: -0.1,
  },

  /* Google Logo — 20x20 (web: h-5 w-5 = 20px) */
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

  /* Divider — web: mt-6 = 24px, gap-3 = 12px */
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
    marginTop: 24,    // web: mt-6
    gap: 12,          // web: gap-3
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)', // web: bg-white/[0.08]
  },
  dividerText: {
    fontSize: 12,     // web: text-[12px]
    color: '#64748b', // web: text-[#64748b]
  },

  /* Switch text — web: mt-4 = 16px */
  switchButton: {
    marginTop: 16,    // web: mt-4
  },
  switchText: {
    fontSize: 14,     // web: text-[14px]
    color: '#94a3b8',
  },
  switchLink: {
    color: '#FFFFFF',
    fontWeight: '600',
  },

  /* Terms — web: mt-4 = 16px, normal flow (NOT absolute) */
  termsContainer: {
    marginTop: 16,    // web: mt-4
    maxWidth: 320,
    width: '100%',
    alignItems: 'center',
  },
  termsText: {
    fontSize: 11,     // web: text-[11px]
    color: '#64748b', // web: text-[#64748b]
    textAlign: 'center',
    lineHeight: 18,   // web: leading-relaxed
  },
  termsLink: {
    color: '#FFFFFF',
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
    textDecorationColor: '#FFFFFF',
  },
});
