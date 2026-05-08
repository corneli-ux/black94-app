# Black94 — Build & Publish Guide

## 📱 Build Profiles

| Profile | Type | Use Case | Command |
|---|---|---|---|
| `preview` | `.apk` | Testing, sharing directly | `eas build --profile preview` |
| `production` | `.aab` | Play Store submission | `eas build --profile production` |
| `store` | `.aab` | Any app store (Indus, etc.) | `eas build --profile store` |

## 🔑 Signing Keys for App Store

EAS **automatically manages** your signing keystore. It was created when you ran your first build.

To verify your keystore:
```bash
export EXPO_TOKEN="your_token_here"
eas credentials
```

## 🚀 How to Submit to App Store

### Step 1: Build a store-ready AAB
```bash
export EXPO_TOKEN="your_expo_token_here"
eas build --platform android --profile store
```

### Step 2: Download the `.aab` file
From the EAS dashboard: https://expo.dev/accounts/tabiblia/projects/black94/builds

### Step 3: Submit to App Store
- **Google Play**: https://play.google.com/console
- **Indus App Store**: https://partner.indus.app

Upload the `.aab` file and fill in the store listing.

## 📅 Daily Workflow (Adding Features)

```
1. Come back and say "add [feature]"
2. I make code changes
3. Code is pushed to GitHub automatically
4. Run: eas build --platform android --profile preview
5. Wait ~20 min, download new APK
6. Test it
7. When ready for store: eas build --platform android --profile store
```

## 🔑 If App Store Asks for Your Own Keystore

If you want to use YOUR OWN signing key instead of EAS-managed:

### Generate a keystore:
```bash
keytool -genkey -v -keystore black94.keystore -alias black94 \
  -keyalg RSA -keysize 2048 -validity 10000
```

### Upload to EAS:
```bash
eas credentials -p android
# Select "Set up new keystore"
# Upload your .keystore file
```

**⚠️ Keep your keystore file and passwords safe forever!** If you lose them, you cannot update your app on the store.

## 📁 Where Everything Is Saved

| Item | Location |
|---|---|
| Source code | https://github.com/tabibliaai-cpu/black94-app |
| EAS dashboard | https://expo.dev/accounts/tabiblia/projects/black94 |
| Build history | https://expo.dev/accounts/tabiblia/projects/black94/builds |
| Signing credentials | Managed by EAS (or upload your own) |

## 2026-05-05: Complete UI Overhaul to Match Webapp

All screens rewritten to match black94real Next.js webapp exactly:

### Files Changed (8 files, 1848 insertions, 510 deletions)
- FeedScreen.tsx: Discover/Network tabs, logo header, functional buttons, skeleton loader, infinite scroll
- ChatListScreen.tsx: Chat/ChatAds tabs, styled search bar, white unread badges
- ChatRoomScreen.tsx: Header actions, dropdown menu, improved bubbles, input bar actions
- ProfileScreen.tsx: Replies/Likes tabs, cover/avatar styling, Follow/Message/Edit pills
- ExploreScreen.tsx: Category pills, trending topics, who to follow section
- SearchScreen.tsx: People/Posts tabs, debounced search, web-matching styling
- api.ts: toggleRepost function added

### Push Details
- Commit: 835be9d "feat: exact UI match to webapp - all screens overhauled"
- Branch: main
- Remote: tabibliaai-cpu/black94-app
