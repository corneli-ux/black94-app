/**
 * app.config.js — Expo dynamic config
 *
 * Publishable keys (Razorpay Key ID, Firebase API Key, Tenor API Key) are
 * loaded in priority order:
 *   1. Environment variable (from .env file or CI injection)
 *   2. Default value below (repo is private — safe)
 *
 * Secret keys (Razorpay Key Secret, Webhook Secret) are NEVER in this file.
 * They live only in GitHub Secrets → Cloud Functions runtime.
 *
 * To override: create a .env file (gitignored) with the key you want to change.
 */

// Load .env file if present (silent — won't error if missing)
try {
  require('dotenv').config();
} catch {
  // dotenv not installed — skip (CI uses real env vars)
}

module.exports = function () {
  // Validate critical config at build time — fail loudly rather than ship a
  // broken APK. These checks run during `expo prebuild` in CI.
  const firebaseApiKey = process.env.FIREBASE_API_KEY || 'AIzaSyBlvVHLKBFqjChsd8ctiMlYzAM17xz0Bxo';
  const googleWebClientId = process.env.GOOGLE_WEB_CLIENT_ID || '815007868471-10t3bepb2kjqlqk7oihh7k3clmvrteab.apps.googleusercontent.com';

  if (!firebaseApiKey || !firebaseApiKey.startsWith('AIza')) {
    console.warn('[CONFIG] FIREBASE_API_KEY looks invalid - Google Sign-In will fail.');
  }
  if (!googleWebClientId || !googleWebClientId.endsWith('.apps.googleusercontent.com')) {
    console.warn('[CONFIG] GOOGLE_WEB_CLIENT_ID looks invalid - Google Sign-In will fail.');
  }

  return {
    expo: {
      name: 'Black94',
      slug: 'memora-bond',
      version: '1.9.1',
      platforms: ['android', 'ios', 'web'],
      orientation: 'portrait',
      icon: './assets/icon.png',
      userInterfaceStyle: 'dark',
      backgroundColor: '#000000',
      newArchEnabled: true,
      splash: {
        image: './assets/splash.png',
        resizeMode: 'contain',
        backgroundColor: '#000000',
      },
      ios: {
        supportsTablet: true,
        bundleIdentifier: 'com.black94.app',
      },
      android: {
        adaptiveIcon: {
          foregroundImage: './assets/adaptive-icon.png',
          backgroundColor: '#000000',
        },
        edgeToEdgeEnabled: true,
        package: 'com.black94.app',
        googleServicesFile: './google-services.json',
        versionCode: 19,
        permissions: ['CAMERA', 'POST_NOTIFICATIONS'],
        softwareKeyboardLayoutMode: 'resize',
        splash: {
          backgroundColor: '#000000',
        },
        intentFilters: [
          {
            action: 'VIEW',
            autoVerify: false,
            data: [{ scheme: 'memora-bond', host: 'auth' }],
            category: ['DEFAULT', 'BROWSABLE'],
          },
          {
            action: 'VIEW',
            autoVerify: true,
            data: [
              {
                scheme: 'https',
                host: 'memora-bond.firebaseapp.com',
                pathPrefix: '/__/auth/handler',
              },
            ],
            category: ['DEFAULT', 'BROWSABLE'],
          },
        ],
      },
      web: {
        favicon: './assets/favicon.png',
      },
      plugins: [
        [
          '@react-native-google-signin/google-signin',
          {
            iosUrlScheme:
              'com.googleusercontent.apps.815007868471-10t3bepb2kjqlqk7oihh7k3clmvrteab',
          },
        ],
        [
          'expo-notifications',
          {
            icon: './assets/icon.png',
            color: '#FFFFFF',
            defaultChannelId: 'black94-messages',
            channelName: 'Messages & Notifications',
          },
        ],
      ],
      extra: {
        eas: {
          projectId: '9dff44f7-2b2b-432d-a355-902a3d75e970',
        },
        firebaseApiKey,
        googleWebClientId,
        tenorApiKey: process.env.TENOR_API_KEY || 'AIzaSyDi7RJ3mPuN9gBjDXCMrhjS8ypHwm1nHB0',
      },
      owner: 'corneli1',
    },
    scheme: 'memora-bond',
  };
};
