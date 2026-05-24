/**
 * app.config.js — Expo dynamic config
 *
 * Publishable keys (Razorpay Key ID, Firebase API Key, Tenor API Key) are
 * injected at build time via EAS secrets or environment variables.
 *
 * Secret keys (Razorpay Key Secret, Webhook Secret) are NEVER in this file.
 * They live only in GitHub Secrets → Cloud Functions runtime.
 *
 * To set keys: eas secret:create --scope project --name <KEY> --value <VALUE>
 * Or create a .env file (gitignored) with the key you want to set.
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
        permissions: ['CAMERA', 'POST_NOTIFICATIONS'],
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
        // Injected at build time via EAS secrets or env vars.
        // Set with: eas secret:create --scope project --name FIREBASE_API_KEY --value <key>
        firebaseApiKey: process.env.FIREBASE_API_KEY || '',
        // Set with: eas secret:create --scope project --name RAZORPAY_KEY_ID --value <key>
        razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
        // Set with: eas secret:create --scope project --name TENOR_API_KEY --value <key>
        tenorApiKey: process.env.TENOR_API_KEY || '',
      },
      owner: 'corneli1',
    },
    scheme: 'black94',
  };
};
