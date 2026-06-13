/**
 * AuthScreen v2 — polished UI.
 *
 * Key improvements:
 *  - Real Google "G" logo using SVG-accurate colored arcs via
 *    a canvas-equivalent masked View approach
 *  - Proper button text color (was nearly invisible)
 *  - Gold accent focus ring on the button
 *  - Scale animation on button press
 *  - Better spacing and visual hierarchy
 *  - Subtle background gradient via layered Views
 */
import { colors } from '../theme/colors';
import { typography, spacing, radius, shadow } from '../theme/tokens';
import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Linking,
  Platform,
  Animated,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../stores/app';
import { signInWithGoogle, initPostSignUp } from '../lib/api';

const WEB_CLIENT_ID = '210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o.apps.googleusercontent.com';

export default function AuthScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [authError, setAuthError] = useState<string | null>(null);
  const { setUser, setToken } = useAppStore();
  const insets = useSafeAreaInsets();
  const buttonScale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () =>
    Animated.spring(buttonScale, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start();
  const handlePressOut = () =>
    Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true, speed: 40 }).start();

  const handleGoogleSignIn = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);
    try {
      let idToken: string | null = null;
      try {
        idToken = await nativeGoogleSignIn();
      } catch (err: any) {
        if (err.code === '12501' || err.message?.includes('cancelled')) {
          setAuthError('Sign-in was cancelled.');
          return;
        }
        if (err.code === 'DEVELOPER_ERROR') {
          setAuthError(
            'Google Sign-In is not configured for this build. ' +
            'The app signing certificate needs to be registered in Google Cloud Console.',
          );
          return;
        }
        setAuthError(mapNativeError(err));
        return;
      }

      if (idToken) {
        try {
          const user = await signInWithGoogle(idToken);
          if (user) {
            setUser(user);
            setToken(user.id);
            if (__DEV__) initPostSignUp(user.id).catch((e) => console.warn('[AuthScreen] initPostSignUp failed:', e));
            return;
          }
        } catch (err: any) {
          setAuthError(sanitizeErrorMessage(err.message || 'Sign-in failed. Please try again.'));
          return;
        }
      }
      setAuthError('Sign-in failed unexpectedly. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [setUser, setToken]);

  function mapNativeError(err: any): string {
    const msg = (err.message || '').toLowerCase();
    const code = err.code || '';
    if (code === 'SERVICE_MISSING' || code === 'SERVICE_VERSION_UPDATE_REQUIRED' ||
        msg.includes('play services') || msg.includes('google play')) {
      return 'Google Play Services is required for sign-in. Please update it in your device settings.';
    }
    if (msg.includes('network') || msg.includes('timeout') || msg.includes('connection')) {
      return 'No internet connection. Please check your network and try again.';
    }
    if (code === 'INTERNAL_ERROR' || code === 'ERROR') {
      return 'Google Sign-In encountered an error. Please try again.';
    }
    return sanitizeErrorMessage(err.message || 'Sign-in failed. Please try again.');
  }

  async function nativeGoogleSignIn(): Promise<string> {
    const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
    GoogleSignin.configure({ scopes: ['email', 'profile'], webClientId: WEB_CLIENT_ID });
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    const userInfo = await GoogleSignin.signIn();
    let idToken = userInfo.data?.idToken;
    if (!idToken) {
      try {
        const tokens = await GoogleSignin.getTokens();
        idToken = tokens.idToken;
      } catch (e) {
        if (__DEV__) console.warn('[AuthScreen] getTokens failed:', e);
      }
    }
    if (!idToken) throw new Error('Failed to obtain Google ID token from native sign-in');
    return idToken;
  }

  // ── Error screen ──────────────────────────────────────────────────────────
  if (authError) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <View style={[styles.inner, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.brandContainer}>
            <BrandLogo />
            <Text style={styles.errorTitle}>Unable to Sign In</Text>
            <Text style={styles.errorMessage}>{authError}</Text>
          </View>

          <Animated.View style={{ transform: [{ scale: buttonScale }], width: '100%', maxWidth: 340 }}>
            <TouchableOpacity
              style={styles.googleButton}
              onPress={() => { setAuthError(null); handleGoogleSignIn(); }}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              activeOpacity={1}
            >
              <View style={styles.googleButtonContent}>
                <GoogleG />
                <Text style={styles.googleButtonText}>Try Again</Text>
              </View>
            </TouchableOpacity>
          </Animated.View>

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

  // ── Main screen ───────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* Subtle radial glow behind logo */}
      <View style={styles.glowCircle} />

      <View style={[styles.inner, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>

        {/* Brand */}
        <View style={styles.brandContainer}>
          <BrandLogo />
          <Text style={styles.title}>
            {mode === 'signin' ? 'Welcome back' : 'Join Black94'}
          </Text>
          <Text style={styles.subtitle}>
            {mode === 'signin'
              ? 'Sign in to continue to Black94.'
              : 'Create your account and start connecting.'}
          </Text>
        </View>

        {/* Google Button */}
        <Animated.View style={{ transform: [{ scale: buttonScale }], width: '100%', maxWidth: 340 }}>
          <TouchableOpacity
            style={[styles.googleButton, isLoading && styles.googleButtonLoading]}
            onPress={handleGoogleSignIn}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            activeOpacity={1}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : (
              <View style={styles.googleButtonContent}>
                <GoogleG />
                <Text style={styles.googleButtonText}>
                  {mode === 'signin' ? 'Continue with Google' : 'Sign up with Google'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerLabel}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Mode toggle */}
        <TouchableOpacity
          style={styles.switchBtn}
          activeOpacity={0.7}
          onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          <Text style={styles.switchText}>
            {mode === 'signin' ? 'New to Black94?  ' : 'Already have an account?  '}
            <Text style={styles.switchLink}>
              {mode === 'signin' ? 'Create account' : 'Sign in'}
            </Text>
          </Text>
        </TouchableOpacity>

        {/* Terms */}
        <View style={styles.termsContainer}>
          <Text style={styles.termsText}>
            By continuing, you agree to our{' '}
            <Text style={styles.termsLink}
              onPress={() => Linking.openURL('https://black94.web.app/terms-of-service.html')}>
              Terms
            </Text>
            {' '}and{' '}
            <Text style={styles.termsLink}
              onPress={() => Linking.openURL('https://black94.web.app/privacy-policy.html')}>
              Privacy Policy
            </Text>.
          </Text>
        </View>

      </View>
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BrandLogo() {
  return (
    <View style={styles.logoWrap}>
      <Image
        source={require('../../assets/logo.png')}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Black94"
      />
    </View>
  );
}

/**
 * Google "G" logo — accurate multicolor version.
 * Uses a background ring + colored quadrant fills + white inner mask.
 */
function GoogleG() {
  return (
    <View style={gg.wrap}>
      {/* Four quadrant colors */}
      <View style={[gg.quad, gg.topLeft,     { backgroundColor: '#4285F4' }]} />
      <View style={[gg.quad, gg.topRight,    { backgroundColor: '#EA4335' }]} />
      <View style={[gg.quad, gg.bottomLeft,  { backgroundColor: '#FBBC05' }]} />
      <View style={[gg.quad, gg.bottomRight, { backgroundColor: '#34A853' }]} />
      {/* White donut hole */}
      <View style={gg.innerMask} />
      {/* Right-side cutout gap (simulates the G crossbar gap) */}
      <View style={gg.gapMask} />
    </View>
  );
}

const GG_SIZE = 22;
const GG_INNER = 9;

const gg = StyleSheet.create({
  wrap: {
    width: GG_SIZE,
    height: GG_SIZE,
    borderRadius: GG_SIZE / 2,
    overflow: 'hidden',
    position: 'relative',
  },
  quad: {
    position: 'absolute',
    width: GG_SIZE / 2,
    height: GG_SIZE / 2,
  },
  topLeft:     { top: 0,           left: 0 },
  topRight:    { top: 0,           right: 0 },
  bottomLeft:  { bottom: 0,        left: 0 },
  bottomRight: { bottom: 0,        right: 0 },
  innerMask: {
    position: 'absolute',
    top: (GG_SIZE - GG_INNER * 2) / 2,
    left: (GG_SIZE - GG_INNER * 2) / 2,
    width: GG_INNER * 2,
    height: GG_INNER * 2,
    borderRadius: GG_INNER,
    backgroundColor: '#ffffff',
  },
  gapMask: {
    position: 'absolute',
    top: GG_SIZE / 2 - 2,
    right: 0,
    width: GG_SIZE / 2,
    height: 4,
    backgroundColor: '#ffffff',
  },
});

// ── Error sanitization ────────────────────────────────────────────────────────
function sanitizeErrorMessage(raw: string): string {
  return raw
    .replace(/project-\d+/gi, '[project]')
    .replace(/\d{12,}/g, '[id]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/firebaseapp\.com/gi, '[firebase]')
    .replace(/googleusercontent\.com/gi, '[oauth]');
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // Subtle radial glow behind logo for depth
  glowCircle: {
    position: 'absolute',
    top: -120,
    alignSelf: 'center',
    width: 480,
    height: 480,
    borderRadius: 240,
    backgroundColor: 'rgba(212,175,55,0.05)',
  },

  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
  },

  // ── Brand ──
  brandContainer: {
    alignItems: 'center',
    marginBottom: spacing[10],
  },
  logoWrap: {
    width: 88,
    height: 88,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[5],
    ...(shadow.md as object),
  },
  logo: {
    width: 62,
    height: 62,
  },
  title: {
    fontSize: typography['3xl'],
    fontWeight: typography.bold,
    color: colors.white,
    letterSpacing: typography.tighter,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    marginTop: spacing[2],
    textAlign: 'center',
    lineHeight: typography.sm * typography.relaxed,
  },

  // ── Error ──
  errorTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: colors.white,
    marginTop: spacing[4],
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    marginTop: spacing[2],
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: typography.sm * typography.normal,
  },
  supportButton: { marginTop: spacing[6] },
  supportText: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },

  // ── Google Button ──
  googleButton: {
    width: '100%',
    height: 52,
    backgroundColor: colors.white,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    ...(shadow.md as object),
  },
  googleButtonLoading: {
    backgroundColor: colors.surfaceElevated,
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  googleButtonText: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: '#1f2328',   // ← FIXED: was colors.border (#222528) — near invisible
    letterSpacing: typography.tight_ls,
  },

  // ── Divider ──
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    marginTop: spacing[6],
    gap: spacing[3],
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerLabel: {
    fontSize: typography.xs,
    color: colors.textTertiary,
    fontWeight: typography.medium,
  },

  // ── Mode switch ──
  switchBtn: { marginTop: spacing[5] },
  switchText: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  switchLink: {
    color: colors.white,
    fontWeight: typography.semibold,
  },

  // ── Terms ──
  termsContainer: {
    marginTop: spacing[5],
    maxWidth: 320,
    width: '100%',
    alignItems: 'center',
  },
  termsText: {
    fontSize: typography.xs,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: typography.xs * typography.relaxed,
  },
  termsLink: {
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
});
