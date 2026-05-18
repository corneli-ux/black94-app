/**
 * app.config.js — Expo dynamic config
 *
 * Sensitive values (Firebase API Key, Razorpay Key ID) are read from
 * environment variables at build time so they are NEVER committed to git.
 *
 * Setup:
 *   Local dev:  create a .env file (gitignored) with:
 *     RAZORPAY_KEY_ID=rzp_live_...
 *     FIREBASE_API_KEY=AIzaSy...
 *
 *   CI (GitHub Actions / EAS): set these as repository secrets,
 *     then expose them as env vars in the build step.
 *
 *   EAS Build: configure in eas.json → build.extraEnv or
 *     set as EAS secrets: eas secret:create --name RAZORPAY_KEY_ID --value "..."
 */

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
      },
      owner: 'corneli1',
    },
    scheme: 'black94',
  };
};
