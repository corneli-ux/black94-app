import React, { useEffect, useState, Component } from 'react';
import { StatusBar, Text, View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';

// Initialize WebBrowser for OAuth callback handling
WebBrowser.maybeCompleteAuthSession();
import { onAuthStateChanged, auth } from './src/lib/firebase';
import Navigation from './src/navigation/AppNavigator';
import { useAppStore } from './src/stores/app';
import { fetchUserProfile } from './src/lib/api';

// Prevent native splash from auto-hiding before JS is ready
SplashScreen.preventAutoHideAsync({ fade: true });

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

const FORCE_READY_TIMEOUT = 1500;

export default function App() {
  const { user, setUser, setToken, setIsReady, isReady, setLoading } = useAppStore();

  useEffect(() => {
    let unsubscribe = undefined;
    let forceReady = false;

    // Safety timeout
    const safetyTimer = setTimeout(() => {
      console.warn('[App] Safety timeout reached — forcing ready');
      forceReady = true;
      setIsReady(true);
    }, FORCE_READY_TIMEOUT);

    try {
      const authInstance = auth();

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
          // Set basic user data IMMEDIATELY from Firebase auth (non-blocking)
          const baseUser = {
            id: fbUser.uid,
            email: fbUser.email || '',
            username: fbUser.displayName?.replace(/\s/g, '').toLowerCase() || fbUser.uid,
            displayName: fbUser.displayName || 'User',
            bio: '',
            profileImage: fbUser.photoURL || null,
            coverImage: null,
            role: 'personal',
            badge: '',
            subscription: 'free',
            isVerified: false,
            createdAt: Date.now(),
          };
          setUser(baseUser);
          setToken(baseUser.id);
          setLoading(false);
          setIsReady(true);

          // Fetch full profile in background (non-blocking)
          fetchUserProfile(fbUser.uid)
            .then(profile => {
              if (profile) setUser(profile);
            })
            .catch(err => {
              console.warn('[App] Background profile fetch failed:', err);
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
          <StatusBar style="light" backgroundColor="#000000" translucent={true} />
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
