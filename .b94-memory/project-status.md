# BLACK94 — Project Status & Memory
# Last updated: 2026-05-20 03:45 UTC
# MAINTAINER: Update this file after EVERY change. Read it FIRST before any work.

================================================================================
CRITICAL: LESSONS LEARNED (DO NOT FORGET)
================================================================================

1. NEVER change working code. If user didn't report it as broken, leave it alone.
2. ALWAYS query the real Firebase database before diagnosing image issues.
3. ALWAYS test actual URLs with HTTP requests before declaring something "fixed."
4. ONE fix per commit. Test it. Verify it. Then move to the next.
5. Images were WORKING FINE before session started. A "fix" broke encodeStoragePath.
6. The user's business depends on this app. Treat every change as production-critical.

================================================================================
PROJECT OVERVIEW
================================================================================

- App: BLACK94 — React Native (Expo) social e-commerce app
- Path: /home/z/black94-app/
- GitHub: dasucosmos-eng/black94-app
- Branch: main
- GitHub Token: stored in git remote URL (check with git remote -v)
- Firebase Project: black94
- Firebase API Key: in app.config.js (extra.firebaseApiKey)
- Storage Bucket: black94.firebasestorage.app
- Google Client ID: in app.config.js (extra.googleSignIn)
- Razorpay Key: in app.config.js (extra.razorpayKeyId)
- Firebase App ID: 1:210565807767:android:4ad1db09a41334792373d2

================================================================================
BUILD & DEPLOYMENT
================================================================================

- CI: GitHub Actions (.github/workflows/build-android.yml)
  - Trigger: push to main branch
  - NOTE: The branch trigger shows as "branches: [main]" — this is correct.
    Terminal may display "[m" as ANSI escape — raw bytes confirm it's [main].
  - Builds APK, distributes via Firebase App Distribution
- Keystore: keystore/release.keystore (pass: black94release, alias: black94)
- Signing script: scripts/setup-release-signing.py

================================================================================
ARCHITECTURE
================================================================================

- Auth: Custom Firebase REST (no official SDK) — src/lib/firebase.ts
- Database: Firestore REST via firebase.ts wrapper
- Storage: Firebase Storage REST via src/utils/imageUpload.ts
- State: Zustand (src/stores/)
- Navigation: React Navigation (src/navigation/AppNavigator.tsx)
- UI: React Native + expo-vector-icons (no component library)

================================================================================
CURRENT BUG STATUS (verified against real Firebase data)
================================================================================

BUG 1: IMAGE LOADING FAILURE
- Status: FIX DEPLOYED — build #26139716157 (commit eae5ed1) — in progress
- Root cause: encodeStoragePath() joined path segments with '/' instead of '%2F'
  This produced URLs like: .../o/posts/uid/file.jpg → HTTP 400
  Firebase Storage requires: .../o/posts%2Fuid%2Ffile.jpg → HTTP 200
- Verified: Tested 5 real posts from Firestore — all returned HTTP 400 before fix,
  all returned HTTP 200 with valid JPEG after fix.
- Fix details:
  - imageUpload.ts: encodeStoragePath now uses .join('%2F')
  - api.ts: parseMediaUrls now calls fixMediaUrl() to repair old broken URLs
  - imageUpload.ts: added fixFirebaseUrl() for URL refresh path
- Impact: ALL existing posts with broken URLs will be auto-fixed at load time.
  New uploads will get correct URLs.

BUG 2: @das/@cornelius PROFILE ISSUE
- Status: NEEDS INVESTIGATION
- What we know from Firestore:
  - Username "cornelius" doc exists → maps to UID prtW8h9aqCMvtypLkUmFlEtZfk52
  - Username "das" doc → 404 Not Found in usernames collection
  - User doc prtW8h9aqCMvtypLkUmFlEtZfk52 has username: "das", displayName: "Das"
  - No user with username "cornelius" exists in users collection
  - The "cornelius" username doc points to the SAME uid as "das"
  - Profile data for @das looks valid (profileImage is a valid Google URL string)
- Possible issue: Username "das" doesn't have a usernames/das doc (deleted? race condition?)
- The profile page crash was already fixed (hooks ordering), but the username
  resolution may still have issues.

================================================================================
CODE THAT MUST NOT BE TOUCHED (working correctly)
================================================================================

Unless user specifically reports a bug in these areas, DO NOT MODIFY:

- src/lib/firebase.ts — Auth token refresh, Firestore CRUD wrapper
- src/lib/api.ts — EXCEPT parseMediaUrls (already fixed)
- src/stores/ — Zustand state management
- src/navigation/AppNavigator.tsx — Navigation structure
- src/components/Avatar.tsx — Avatar component
- src/utils/timeAgo.ts, datetime.ts — Time formatting
- src/theme/ — Color constants, responsive helpers
- All screen layouts and styling — Unless user reports visual bugs

================================================================================
FILES CHANGED IN THIS SESSION (2026-05-20)
================================================================================

1. src/utils/imageUpload.ts
   - encodeStoragePath: .join('/') → .join('%2F') (THE image URL fix)
   - Added fixFirebaseUrl() function to repair old broken URLs

2. src/lib/api.ts
   - parseMediaUrls: now calls fixMediaUrl() on every URL
   - Added fixMediaUrl() function (same logic as fixFirebaseUrl, no imports needed)

Commit: eae5ed1 — "fix: ROOT CAUSE — image URLs return HTTP 400..."
Build: #26139716157 — Status: building

================================================================================
DATABASE STATE (queried from real Firebase)
================================================================================

Users:
- UID prtW8h9aqCMvtypLkUmFlEtZfk52: username=das, email=dasucosmos@gmail.com,
  profileImage=https://lh3.googleusercontent.com/a/ACg8ocLZVxjTP-_SazJkLMKlMtuZyLyLuCXN5zANeMRJ4c1qkYT41w=s96-c
- Username "das" doc: MISSING from usernames collection (404)
- Username "cornelius" doc: exists, maps to prtW8h9aqCMvtypLkUmFlEtZfk52 (same as das)

Latest posts (all by @das, all have broken URLs that fixMediaUrl will repair):
- QHFpXM6NXA3Yb7KxiJj9 — 1779221361846_0.jpg (56KB JPEG, valid)
- iIGodyCYwPgq64Qn3y2j — 1779199809033_0.png
- kBp9zd2FAHmMTzVX5skK — 1779199790713_0.png
- X8sVkkStAOJLWZViTjnS — 1779196456810_0.jpg

================================================================================
