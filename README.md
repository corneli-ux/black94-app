# Black94 — React Native App

## 📱 Overview
A native React Native (Expo) social media app for Black94.

---

## ⚙️ CI/CD — GitHub Actions (Free, No EAS, No Android Studio)

Every push to `main` automatically builds **Debug APK** and **Release AAB** and publishes them as a [GitHub Release](../../releases).

### How It Works

```
Push to main → GitHub Actions runner (ubuntu-latest)
  → Node.js 20 + Java 17 (Zulu) setup
  → npm ci
  → expo prebuild --platform android    ← generates android/ from app.json
  → Gradle assembleDebug                ← debug APK for testing
  → Gradle bundleRelease                ← release AAB for Play Store
  → Upload to GitHub Release
```

### Required GitHub Secrets

Go to your repo **Settings → Secrets and variables → Actions → New repository secret** and add these:

| Secret | Description | How to Get It |
|--------|-------------|---------------|
| `KEYSTORE_BASE64` | Your release keystore, base64-encoded | See [Encode Keystore](#encode-your-keystore-as-base64) below |
| `KEY_ALIAS` | The alias you chose when creating the keystore | The `-alias` value you used (e.g. `upload`) |
| `KEY_PASSWORD` | Password for the private key | The `-keypass` value you used |
| `STORE_PASSWORD` | Password for the keystore file itself | The `-storepass` value you used |
| `SLACK_WEBHOOK_URL` | *(Optional)* Slack webhook for build notifications | Create an Incoming Webhook in Slack |

### Encode Your Keystore as Base64

Use the provided helper script (run from the project root):

```bash
# If you already have a keystore file:
./scripts/encode-keystore.sh black94-release.keystore
# → Copy the printed base64 string → GitHub → Secrets → KEYSTORE_BASE64
```

Or encode it manually:

```bash
base64 -w 0 black94-release.keystore
```

### Generate a New Keystore (If You Don't Have One)

```bash
# Use the helper script:
./scripts/generate-keystore.sh

# Or generate manually with keytool:
keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore black94-release.keystore \
  -alias upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepassword YOUR_STORE_PASSWORD \
  -keypassword YOUR_KEY_PASSWORD
```

After generating, follow the [Encode](#encode-your-keystore-as-base64) step above, then add all 4 secrets (`KEYSTORE_BASE64`, `KEY_ALIAS`, `KEY_PASSWORD`, `STORE_PASSWORD`) to GitHub.

### Manual Build Trigger

You can also trigger a build manually from the **Actions** tab in GitHub:
1. Click **"Build Android (APK + AAB)"** workflow
2. Click **"Run workflow"**
3. Select `main` branch and click **Run**

### Caching

The pipeline caches two things to speed up subsequent builds:
- **npm packages** (`node_modules/`) — cached via `actions/setup-node`
- **Gradle dependencies** — cached via `actions/setup-java`

Both caches are keyed on `package-lock.json` and `build.gradle` hashes respectively.

---

## 🔧 Other Build Methods

### Option 1: EAS Build (Cloud)
```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

### Option 2: Local Build (Android Studio)
```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

### Option 3: Expo Go (Testing only)
```bash
npx expo start
# Scan QR code with Expo Go app
```

---

## 🔑 Google Sign-In Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select project `black94`
3. Go to **APIs & Services → Credentials**
4. Create an Android OAuth Client with package name `com.black94.app`
5. Get the web client ID and update it in `src/screens/LoginScreen.tsx` (line with `webClientId`)

---

## 📦 Project Structure
```
src/
├── lib/
│   ├── firebase.ts     # Firebase REST API (auth + firestore)
│   └── api.ts          # All API calls (auth, posts, chat, users)
├── navigation/
│   └── AppNavigator.tsx  # Tab + Stack navigation
├── screens/
│   ├── LoginScreen.tsx    # Google Sign In
│   ├── SignupScreen.tsx   # Google Sign Up
│   ├── FeedScreen.tsx     # Posts feed with compose
│   ├── SearchScreen.tsx   # User search
│   ├── NotificationsScreen.tsx
│   ├── ChatListScreen.tsx
│   ├── ChatRoomScreen.tsx
│   ├── ProfileScreen.tsx  # User profile + logout
│   └── SettingsScreen.tsx
├── stores/
│   └── app.ts            # Zustand global state
└── theme/
    └── colors.ts         # Dark theme colors
scripts/
├── encode-keystore.sh      # Encode keystore as base64 for CI
└── generate-keystore.sh    # Generate a new release keystore
.github/
└── workflows/
    └── build-android.yml   # CI/CD pipeline (auto-builds on push)
```

## 🔥 Firebase
- **Project ID:** `black94`
- **Auth:** Google Sign-In (native)
- **Firestore:** Users, posts, chats, messages, notifications, follows

## 🚀 Deployment
1. **Automated:** Push to `main` — APK + AAB appear in [GitHub Releases](../../releases)
2. **Manual:** Download artifacts from Actions tab or trigger a manual workflow run
3. Submit `.aab` to Google Play Store, or distribute `.apk` directly

## ⚠️ Important Notes
- The app uses the same Firebase project as the web version
- All data is shared between web and mobile apps
- Keystore files are gitignored — never commit them
- GitHub Secrets are encrypted and not visible after creation
