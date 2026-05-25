/* ── No polyfills needed — Firebase uses REST API (pure fetch) ──────────── */

import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import React from 'react';
import { Alert, Platform } from 'react-native';

import App from './App';

// ── GLOBAL ERROR HANDLER — catches unhandled JS errors that bypass React ──
// CRITICAL FIX: Without this, any unhandled promise rejection or synchronous
// error in a native module callback CRASHES the entire app (red screen → kill).
// React error boundaries only catch errors during RENDERING, not:
//   - Unhandled promise rejections
//   - Errors in useEffect callbacks (outside React lifecycle)
//   - Native module callback errors
//   - Errors in event handlers
// This handler shows an Alert with the error message instead of crashing.
//
// The chat crash was caused by concurrent API calls in useChatRoom's resetUnread
// (marking up to 100 messages as 'read' via Promise.allSettled) overwhelming the
// JS thread with unhandled rejections when the auth token was expired.
if (Platform.OS !== 'web') {
  try {
    const { ErrorUtils } = require('react-native');
    // Set both handlers to catch all categories of unhandled errors
    const globalHandler = (error, isFatal) => {
      const msg = error?.message || String(error) || 'Unknown error';
      console.error('[GlobalErrorHandler] Unhandled error:', msg, 'fatal:', isFatal, error);
      // Show user-friendly alert — don't crash the app
      Alert.alert(
        'Something went wrong',
        msg.length > 200 ? msg.slice(0, 200) + '...' : msg,
        [{ text: 'OK', style: 'cancel' }],
      );
      // Return false = don't let RN's default handler crash the app
      return false;
    };
    ErrorUtils.setGlobalHandler(globalHandler);
  } catch (e) {
    console.warn('[index] Failed to set global error handler:', e);
  }
}

// Also catch unhandled promise rejections (Node.js style, works on Hermes)
if (typeof process !== 'undefined' && process.on) {
  process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || String(reason) || 'Unknown promise rejection';
    console.error('[GlobalErrorHandler] Unhandled rejection:', msg);
    if (Platform.OS !== 'web') {
      try {
        Alert.alert(
          'Something went wrong',
          msg.length > 200 ? msg.slice(0, 200) + '...' : msg,
          [{ text: 'OK', style: 'cancel' }],
        );
      } catch (e) { /* ignore */ }
    }
  });
}

// Wrap App in GestureHandlerRootView for web gesture support.
// This is required for @react-navigation/drawer and other gesture-based
// navigation to work properly on web.
function Root() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <App />
    </GestureHandlerRootView>
  );
}

registerRootComponent(Root);
