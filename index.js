/* ── No polyfills needed — Firebase uses REST API (pure fetch) ──────────── */

import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import React from 'react';

import App from './App';

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
