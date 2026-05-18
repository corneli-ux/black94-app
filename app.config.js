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
  return {
    expo: {
      name: 'Black94',
      slug: 'black94',
      version: '1.8.3',
      platforms: ['android', 'ios', 'web'],
      orientation: 'portrait',
      icon: './assets/icon.png',
      userInterfaceStyle: 'dark',
      backgroundColor: '#000000',
      newArchEnabled: true,
      splash: {
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
        versionCode: 13,
        permissions: ['CAMERA'],
        softwareKeyboardLayoutMode: 'resize',
        splash: {
          backgroundColor: '#000000',
        },
        intentFilters: [
          {
            action: 'VIEW',
            autoVerify: false,
            data: [{ scheme: 'black94', host: 'auth' }],
            category: ['DEFAULT', 'BROWSABLE'],
          },
          {
            action: 'VIEW',
            autoVerify: true,
            data: [
              {
                scheme: 'https',
                host: 'black94.firebaseapp.com',
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
              'com.googleusercontent.apps.210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o',
          },
        ],
      ],
      extra: {
        eas: {
          projectId: '9dff44f7-2b2b-432d-a355-902a3d75e970',
        },
        firebaseApiKey: process.env.FIREBASE_API_KEY || 'AIzaSyDOGRbI4V82VJ0KZND3v1ggfO5s3933-3w',
        razorpayKeyId: process.env.RAZORPAY_KEY_ID || 'rzp_live_SqhiNhA1ELaiVP',
        tenorApiKey: process.env.TENOR_API_KEY || 'AIzaSyDi7RJ3mPuN9gBjDXCMrhjS8ypHwm1nHB0',
      },
      owner: 'corneli1',
    },
    scheme: 'black94',
  };
};
