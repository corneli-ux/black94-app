/**
 * app.config.js — Expo dynamic config
 *
 * Sensitive values (Firebase API Key, Razorpay Key ID) are read from
 * environment variables at build time so they are NEVER committed to git.
 *
 * This file auto-loads a .env file via dotenv (silent — no error if missing).
 *
 * Setup:
 *   Local dev:  copy .env.example → .env, fill in the values:
 *     cp .env.example .env
 *     (then edit .env with your real keys)
 *
 *   CI (GitHub Actions): secrets are injected as env vars in the workflow.
 *     dotenv has no effect — process.env already has the values.
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
        firebaseApiKey: process.env.FIREBASE_API_KEY || '',
        razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
        tenorApiKey: process.env.TENOR_API_KEY || '',
      },
      owner: 'corneli1',
    },
    scheme: 'black94',
  };
};
