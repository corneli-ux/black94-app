import React, { useEffect, useState, Component } from 'react';
import { StatusBar, Text, View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import * as Font from 'expo-font';

// Initialize WebBrowser for OAuth callback handling
// Wrap in try-catch for web compatibility
try { WebBrowser.maybeCompleteAuthSession(); } catch (e) { console.warn('[WebBrowser]', e); }
import { onAuthStateChanged, auth, restoreAuth, getValidToken } from './src/lib/firebase';
import Navigation from './src/navigation/AppNavigator';
import { useAppStore } from './src/stores/app';
import { fetchUserProfile } from './src/lib/api';

// Set global default font — clean system font for all text
if (Text.defaultProps == null) {
  Text.defaultProps = {};
}
Text.defaultProps.style = { fontFamily: 'System', color: '#e7e9ea' };

// Prevent native splash from auto-hiding before JS is ready
// Wrap in try-catch — no-op on web
try { SplashScreen.preventAutoHideAsync({ fade: true }); } catch (e) { console.warn('[Splash]', e); }

/* ── Error Boundary ───────────────────────────────────────────────────────── */

class AppErrorBoundary extends Component {
  state = { hasError: false, error: null, errorStack: '' };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    const stack = error?.stack || errorInfo?.componentStack || '';
    console.error('[App] Uncaught error:', error?.message, '\n', stack);
    this.setState({ errorStack: stack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <StatusBar style="light" />
          <ScrollView contentContainerStyle={styles.errorContainer}>
            <Text style={styles.errorTitle}>Something went wrong</Text>
            <Text style={styles.errorMessage}>{this.state.error?.message || 'Unknown error'}</Text>
            {this.state.errorStack ? (
              <Text style={styles.errorStack}>{this.state.errorStack.slice(0, 500)}</Text>
            ) : null}
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => this.setState({ hasError: false, error: null, errorStack: '' })}
            >
              <Text style={styles.retryText}>Try Again</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

/* ── App Component ────────────────────────────────────────────────────────── */

const FORCE_READY_TIMEOUT = 15000;

export default function App() {
  const { user, setUser, setToken, setIsReady, isReady, setLoading } = useAppStore();
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // Load fonts on mount
  useEffect(() => {
    (async () => {
      try {
        await Font.loadAsync({
          'Inter-Regular': require('./assets/fonts/Inter-Regular.ttf'),
          'Inter-Medium': require('./assets/fonts/Inter-Medium.ttf'),
          'Inter-SemiBold': require('./assets/fonts/Inter-SemiBold.ttf'),
          'Inter-Bold': require('./assets/fonts/Inter-Bold.ttf'),
        });
        Text.defaultProps.style = { fontFamily: 'Inter-Regular', color: '#e7e9ea' };
        console.log('[App] Fonts loaded — Inter');
      } catch (e) {
        console.warn('[App] Font loading failed, using system default:', e);
        Text.defaultProps.style = { fontFamily: 'System', color: '#e7e9ea' };
      }
      setFontsLoaded(true);
    })();
  }, []);

  useEffect(() => {
    let unsubscribe = undefined;
    let forceReady = false;

    // Safety timeout — longer to allow auth restoration
    const safetyTimer = setTimeout(() => {
      console.warn('[App] Safety timeout reached — forcing ready');
      forceReady = true;
      setIsReady(true);
    }, FORCE_READY_TIMEOUT);

    (async () => {
      try {
        // Step 1: Try to restore persisted auth from AsyncStorage
        const restored = await restoreAuth();
        const authInstance = auth();

        if (restored && authInstance.currentUser) {
          console.log('[App] Auth restored — validating token...');
          try {
            // Validate the token by making a Firestore call
            const validToken = await getValidToken();
            if (validToken) {
              console.log('[App] Token valid, auto-login successful');
              const fbUser = authInstance.currentUser;
              setToken(fbUser.uid);
              setLoading(false);
              // Set a preliminary user immediately so the app doesn't flash login screen
              // even if the full profile fetch is slow
              setUser({ id: fbUser.uid, email: fbUser.email || '', username: fbUser.displayName?.replace(/\s/g, '').toLowerCase() || fbUser.uid, displayName: fbUser.displayName || 'User', bio: '', profileImage: fbUser.photoURL || null, coverImage: null, role: 'personal', badge: '', subscription: 'free', isVerified: false, createdAt: Date.now() });
              // Cancel safety timeout since auth is validated
              clearTimeout(safetyTimer);
              // Fetch full profile in background and update
              fetchUserProfile(fbUser.uid).then(profile => {
                if (profile) { setUser(profile); }
                // If this is very slow, isReady was already set above
                setIsReady(true);
              }).catch(err => {
                console.warn('[App] Profile fetch failed after restore, keeping preliminary user:', err);
                // isReady was already set above
                setIsReady(true);
              });
              return; // Skip onAuthStateChanged — we handled it
            }
          } catch (e) {
            console.warn('[App] Token validation failed after restore:', e);
            // Token expired, need to refresh or re-login
          }
        }

        // Step 2: Normal auth state listener (for fresh login or sign-up)
        if (!authInstance) {
          console.warn('[App] Firebase Auth null — showing login screen');
          setUser(null);
          setToken(null);
          setIsReady(true);
          return;
        }

        unsubscribe = onAuthStateChanged(authInstance, (fbUser) => {
          if (forceReady) return;

          if (fbUser) {
            setUser(null); setToken(fbUser.uid); setLoading(false);
            fetchUserProfile(fbUser.uid).then(profile => {
              if (profile) { setUser(profile); } else {
                setUser({ id: fbUser.uid, email: fbUser.email || '', username: fbUser.displayName?.replace(/\s/g, '').toLowerCase() || fbUser.uid, displayName: fbUser.displayName || 'User', bio: '', profileImage: fbUser.photoURL || null, coverImage: null, role: 'personal', badge: '', subscription: 'free', isVerified: false, createdAt: Date.now() });
              }
              setIsReady(true);
            }).catch(err => {
              console.warn('[App] Profile fetch failed, using Firebase data:', err);
              setUser({ id: fbUser.uid, email: fbUser.email || '', username: fbUser.displayName?.replace(/\s/g, '').toLowerCase() || fbUser.uid, displayName: fbUser.displayName || 'User', bio: '', profileImage: fbUser.photoURL || null, coverImage: null, role: 'personal', badge: '', subscription: 'free', isVerified: false, createdAt: Date.now() });
              setIsReady(true);
            });
          } else {
            setUser(null);
            setToken(null);
            setLoading(false);
            setIsReady(true);
          }
        });
      } catch (initErr) {
        console.error('[App] Firebase init error:', initErr);
        setUser(null);
        setToken(null);
        setLoading(false);
        setIsReady(true);
      }
    })();

    return () => {
      clearTimeout(safetyTimer);
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Hide native splash once JS is ready — smooth transition, no white flash
  useEffect(() => {
    if (isReady) {
      const hide = async () => {
        try { await SplashScreen.hideAsync({ fade: true }); } catch (e) { console.warn('[Splash]', e); }
      };
      hide();
    }
  }, [isReady]);

  // While not ready, show dark loading screen (matches splash bg #000000)
  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <View style={styles.rootContainer}>
          <StatusBar style="light" backgroundColor="#000000" translucent={false} />
          {!isReady ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.appName}>Black94</Text>
            </View>
          ) : (
            <Navigation />
          )}
        </View>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: {
    color: '#e7e9ea',
    fontSize: 32,
    fontWeight: '800',
  },
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  errorContainer: {
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 40,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#e7e9ea',
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 14,
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  errorStack: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'left',
    marginBottom: 24,
    lineHeight: 16,
  },
  retryButton: {
    backgroundColor: '#1d9bf0',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 8,
  },
  retryText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600',
  },
});
