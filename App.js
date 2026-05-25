import React, { useEffect, useState, Component } from 'react';
import { StatusBar, Text, View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform } from 'react-native';

const IS_WEB = Platform.OS === 'web';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import * as Font from 'expo-font';

// Initialize WebBrowser for OAuth callback handling
// Wrap in try-catch for web compatibility
try { WebBrowser.maybeCompleteAuthSession(); } catch (e) { if (__DEV__) console.warn('[WebBrowser]', e); }
import { onAuthStateChanged, auth, restoreAuth, getValidToken } from './src/lib/firebase';
import Navigation from './src/navigation/AppNavigator';
import { useAppStore } from './src/stores/app';
import { fetchUserProfile } from './src/lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const USER_CACHE_KEY = '@black94/user_cache';

// NOTE: Text.defaultProps mutation was removed in RN 0.73+
// Default styles are now set explicitly on each <Text> or via a wrapper component.

// Prevent native splash from auto-hiding before JS is ready
// Wrap in try-catch — no-op on web
try { SplashScreen.preventAutoHideAsync({ fade: true }); } catch (e) { if (__DEV__) console.warn('[Splash]', e); }

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

  sanitizeError(msg) {
    if (!msg) return 'Something went wrong';
    return msg
      .replace(/project-\d+/gi, '[project]')
      .replace(/\d{12,}/g, '[id]')
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
      .replace(/https?:\/\/[^\s]+/gi, '[url]')
      .replace(/firebaseapp\.com/gi, '[firebase]')
      .replace(/googleusercontent\.com/gi, '[oauth]')
      .replace(/toMillis|toDate|\.seconds|\.nanoseconds/gi, '[timestamp]')
      .replace(/Property.*doesn't exist/gi, 'A data error occurred');
  }

  render() {
    if (this.state.hasError) {
      const safeMsg = this.sanitizeError(this.state.error?.message);
      return (
        <View style={styles.container}>
          <StatusBar style="light" />
          <ScrollView contentContainerStyle={styles.errorContainer}>
            <Text style={styles.errorTitle}>Something went wrong</Text>
            <Text style={styles.errorMessage}>{safeMsg}</Text>
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
  const { user, setUser, setToken, setIsReady, isReady, setLoading, setPendingNotificationTap } = useAppStore();
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // ── Initialize push notifications at startup ──
  // This runs ONCE before auth. It creates the Android notification channel
  // and registers tap listeners. On web, it's a no-op.
  useEffect(() => {
    if (IS_WEB) return;
    // Dynamic import — expo-notifications uses native modules that crash on web.
    // On native, this is still fast enough because it runs at app startup.
    import('./src/services/pushNotifications').then(({ initNotifications }) => {
      initNotifications((tapData) => {
        if (__DEV__) console.log('[App] Notification tap received:', JSON.stringify(tapData));
        setPendingNotificationTap(tapData);
      }).catch(e => {
        if (__DEV__) console.warn('[App] Notification init failed:', e);
      });
    }).catch(e => {
      if (__DEV__) console.warn('[App] Failed to import pushNotifications:', e);
    });
  }, []);

  // Load fonts on mount
  useEffect(() => {
    (async () => {
      try {
        await Font.loadAsync({
          'Roboto-Regular': require('./assets/fonts/Roboto-Regular.ttf'),
          'Roboto-Medium': require('./assets/fonts/Roboto-Medium.ttf'),
          'Roboto-Bold': require('./assets/fonts/Roboto-Bold.ttf'),
        });
        if (__DEV__) console.log('[App] Fonts loaded — Roboto');
      } catch (e) {
        if (__DEV__) console.warn('[App] Font loading failed, using system default:', e);
      }
      setFontsLoaded(true);
    })();
  }, []);

  useEffect(() => {
    // ── WEB: Skip Firebase auth entirely, set demo user ──
    if (IS_WEB) {
      if (__DEV__) console.log('[App] Web platform detected — bypassing login, setting demo user');
      setUser({
        id: 'web_demo_user',
        email: 'demo@black94.com',
        username: 'black948',
        displayName: 'Black94',
        bio: 'Social platform',
        profileImage: null,
        coverImage: null,
        role: 'personal',
        badge: '',
        subscription: 'free',
        isVerified: true,
        createdAt: Date.now(),
      });
      setToken('web_demo_token');
      setLoading(false);
      setIsReady(true);
      return;
    }

    // ── MOBILE: Normal Firebase auth flow ──
    let unsubscribe = undefined;
    let forceReady = false;

    // FIX: Cache last known user profile so offline opens show correct name.
    // Previously, offline fallback built username from fbUser.displayName which
    // produced WRONG names (e.g., "JohnDoe" instead of stored "johndoe123").
    const loadCachedProfile = async (): Promise<any> => {
      try {
        const raw = await AsyncStorage.getItem(USER_CACHE_KEY);
        if (raw) return JSON.parse(raw);
      } catch {}
      return null;
    };
    const saveCachedProfile = async (profile: any) => {
      try { await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(profile)); } catch {}
    };

    // Safety timeout — longer to allow auth restoration
    const safetyTimer = setTimeout(() => {
      if (__DEV__) console.warn('[App] Safety timeout reached — forcing ready');
      forceReady = true;
      setIsReady(true);
    }, FORCE_READY_TIMEOUT);

    (async () => {
      try {
        // Step 1: Try to restore persisted auth from AsyncStorage
        const restored = await restoreAuth();
        const authInstance = auth();

        if (restored && authInstance.currentUser) {
          if (__DEV__) console.log('[App] Auth restored — validating token...');
          try {
            // Validate the token by making a Firestore call
            const validToken = await getValidToken();
            if (validToken) {
              if (__DEV__) console.log('[App] Token valid, auto-login successful');
              const fbUser = authInstance.currentUser;
              setToken(fbUser.uid);
              setLoading(false);
              // PERF: Set user from cache first, mark ready immediately so the
              // app renders without waiting for the network fetchUserProfile().
              // Previously setIsReady was ONLY called inside the .then/.catch of
              // fetchUserProfile, adding 1-3s of blank-screen delay on every cold start.
              const cached = await loadCachedProfile();
              if (cached && cached.id === fbUser.uid) {
                if (__DEV__) console.log('[App] Using cached profile for offline restore:', cached.username);
                setUser(cached);
              } else {
                // No cache or different user — build from Firebase auth data
                setUser({ id: fbUser.uid, email: fbUser.email || '', username: cached?.username || fbUser.displayName?.replace(/\s/g, '').toLowerCase() || `user_${fbUser.uid.slice(0,8)}`, displayName: cached?.displayName || fbUser.displayName || 'User', bio: cached?.bio || '', profileImage: cached?.profileImage || fbUser.photoURL || null, coverImage: cached?.coverImage || null, role: cached?.role || 'personal', badge: cached?.badge || '', subscription: cached?.subscription || 'free', isVerified: cached?.isVerified ?? false, createdAt: cached?.createdAt || Date.now() });
              }
              // Cancel safety timeout since auth is validated
              clearTimeout(safetyTimer);
              // PERF: Mark the app ready IMMEDIATELY — don't wait for background profile fetch.
              // The cached user data is good enough for first render; the fresh profile
              // will silently update in the background.
              setIsReady(true);
              // CRASH FIX: Initialize E2EE keys during auth restoration.
              // Without this, the FIRST chat open after app restart calls
              // getMyKeyPair() → SecureStore.getItemAsync() cold, which can
              // crash if expo-secure-store has native binary incompatibility.
              // Pre-loading here ensures keys are in memory before any chat.
              import('./src/lib/e2ee').then(({ initE2EE }) => {
                initE2EE(fbUser.uid).catch((e) => { if (__DEV__) console.warn('[App] initE2EE on restore failed:', e); });
              }).catch(() => {});
              // Re-initialize push notifications + activity tracking on auth restore
              // (token may have changed since last session)
              import('./src/lib/api').then(({ initPostSignUp }) => {
                initPostSignUp(fbUser.uid).catch((e) => { if (__DEV__) console.warn('[App] initPostSignUp on restore failed:', e); });
              }).catch(() => {});
              // Fetch full profile in background and update (non-blocking)
              fetchUserProfile(fbUser.uid).then(profile => {
                if (profile) {
                  setUser(profile);
                  saveCachedProfile(profile); // Update cache with fresh data
                }
              }).catch(err => {
                if (__DEV__) console.warn('[App] Profile fetch failed after restore, keeping cached user:', err);
              });
              return; // Skip onAuthStateChanged — we handled it
            }
          } catch (e) {
            if (__DEV__) console.warn('[App] Token validation failed after restore:', e);
            // Token expired, need to refresh or re-login
          }
        }

        // Step 2: Normal auth state listener (for fresh login or sign-up)
        if (!authInstance) {
          if (__DEV__) console.warn('[App] Firebase Auth null — showing login screen');
          setUser(null);
          setToken(null);
          setIsReady(true);
          return;
        }

        unsubscribe = onAuthStateChanged(authInstance, (fbUser) => {
          if (forceReady) return;

          // ── WEB safety: never show login on web ──
          if (Platform.OS === 'web' && !fbUser) {
            setUser({
              id: 'web_demo_user',
              email: 'demo@black94.com',
              username: 'black948',
              displayName: 'Black94',
              bio: 'Social platform',
              profileImage: null,
              coverImage: null,
              role: 'personal',
              badge: '',
              subscription: 'free',
              isVerified: true,
              createdAt: Date.now(),
            });
            setToken('web_demo_token');
            setIsReady(true);
            return;
          }

          if (fbUser) {
            // Do NOT setUser(null) here — it causes a "?" avatar flash while the
            // profile fetch is in-flight.  Instead, fetch the profile and update.
            // If AuthScreen already called setUser(), this enriches it; if not,
            // it populates from scratch.  The safeUser() guard in the store
            // ensures displayName defaults to 'User' so Avatar never shows "?".
            setToken(fbUser.uid);
            setLoading(false);
            fetchUserProfile(fbUser.uid).then(profile => {
              if (profile) {
                setUser(profile);
                saveCachedProfile(profile); // Cache for offline use
              } else {
                // Firestore doc missing — try cached profile, then fallback to Firebase data
                loadCachedProfile().then(cached => {
                  if (cached && cached.id === fbUser.uid) {
                    setUser(cached);
                  } else {
                    setUser({ id: fbUser.uid, email: fbUser.email || '', username: fbUser.displayName?.replace(/\s/g, '').toLowerCase() || `user_${fbUser.uid.slice(0,8)}`, displayName: fbUser.displayName || 'User', bio: '', profileImage: fbUser.photoURL || null, coverImage: null, role: 'personal', badge: '', subscription: 'free', isVerified: false, createdAt: Date.now() });
                  }
                });
              }
              setIsReady(true);
            }).catch(err => {
              if (__DEV__) console.warn('[App] Profile fetch failed, using cached or Firebase data:', err);
              // FIX: Use cached profile if available, don't show wrong name when offline
              loadCachedProfile().then(cached => {
                if (cached && cached.id === fbUser.uid) {
                  setUser(cached);
                } else {
                  setUser({ id: fbUser.uid, email: fbUser.email || '', username: fbUser.displayName?.replace(/\s/g, '').toLowerCase() || `user_${fbUser.uid.slice(0,8)}`, displayName: fbUser.displayName || 'User', bio: '', profileImage: fbUser.photoURL || null, coverImage: null, role: 'personal', badge: '', subscription: 'free', isVerified: false, createdAt: Date.now() });
                }
              });
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
        try { await SplashScreen.hideAsync({ fade: true }); } catch (e) { if (__DEV__) console.warn('[Splash]', e); }
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
    backgroundColor: '#e7e9ea',
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
