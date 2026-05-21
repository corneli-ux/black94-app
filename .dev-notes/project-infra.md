# BLACK94 — Complete Project Infrastructure Reference

> **CRITICAL**: Read this file BEFORE making ANY code change. Every fix must account for
> all details below. Ignorance of the full stack is the #1 cause of introduced bugs.

---

## 1. PROJECT IDENTITY

| Field | Value |
|---|---|
| App Name | Black94 |
| Package | `com.black94.app` |
| Bundle ID (iOS) | `com.black94.app` |
| Expo Slug | `black94` |
| Expo Owner | `corneli1` |
| Version | `1.8.3` |
| Version Code | `13` |
| GitHub Repo | `dasucosmos-eng/black94-app` |
| GitHub Token | Stored in GitHub Secrets (NOT in code) |
| Local Path | `/home/z/black94-app/` |

---

## 2. TECH STACK

| Component | Technology | Version |
|---|---|---|
| Framework | React Native (Expo) | SDK 54 |
| React | react | 19.1.0 |
| React Native | react-native | 0.81.5 |
| New Architecture | `newArchEnabled: true` | Yes |
| Language | TypeScript | ^5.9.3 |
| Navigation | @react-navigation/native | ^7.2.2 |
| State Management | zustand | ^5.0.12 |
| Auth Provider | Google Sign-In | @react-native-google-signin/google-signin ^16.1.2 |
| Firestore | CUSTOM REST (NO SDK) | Pure fetch() |
| Firebase Auth | CUSTOM REST (NO SDK) | Pure fetch() |
| Firebase Storage | CUSTOM REST (NO SDK) | Pure fetch() + XHR |
| E2EE | tweetnacl (NaCl) | ^1.0.3 |
| Crypto Storage | expo-secure-store | ~55.0.14 |
| CI/CD | GitHub Actions | `.github/workflows/build-android.yml` |
| Build | Gradle (Android) | Java 17, Node 22 |
| Distribution | Firebase App Distribution | APK |
| Payment | Razorpay | In-app |
| Shipping | ShipRocket | Integration |
| UI Style | Dark theme, black background | `#000000` |

---

## 3. FIREBASE CONFIGURATION

### 3.1 Project Details

| Field | Value |
|---|---|
| Firebase Project ID | `black94` |
| Firebase Project Name | `black94-app` |
| Web App ID | `1:210565807767:web:...` |
| Android App ID | `1:210565807767:android:4ad1db09a41334792373d2` |
| API Key | `AIzaSyDXehLMhW7N9Pj_0MPLHEVSEwLRnHkhFLE` |
| API Key Source | `app.json` extra.firebaseApiKey (injected at build time) |
| Google OAuth Client ID (iOS) | `210565807767-jtedotfd6hqn8cn31meuk2cfp2dkm88o` |
| google-services.json | Decoded from GitHub Secret `GOOGLE_SERVICES_JSON` at build time |
| Service Account | GitHub Secret `FIREBASE_SERVICE_ACCOUNT` |
| RAZORPAY_KEY_ID | GitHub Secret `RAZORPAY_KEY_ID` |
| FIREBASE_API_KEY | GitHub Secret `FIREBASE_API_KEY` |

### 3.2 Firebase REST Endpoints

```
Auth:         https://identitytoolkit.googleapis.com/v1/
Token:        https://securetoken.googleapis.com/v1/
Firestore:    https://firestore.googleapis.com/v1/projects/black94/databases/(default)/documents
Storage:      https://firebasestorage.googleapis.com/v0/b/black94.firebasestorage.app/o
Storage(new): https://storage.googleapis.com (fallback)
```

### 3.3 Storage Bucket

| Field | Value |
|---|---|
| Bucket Name | `black94.firebasestorage.app` |
| Upload Path Pattern | `{collection}/{uid}/{type}/{filename}.{ext}` |
| Example | `users/{uid}/posts/photo123.jpg` |
| URL Encoding | Slashes in path MUST be `%2F` (not `/`) |
| Auth | Bearer token in Authorization header |

### 3.4 Auth Flow

1. Google Sign-In → get `idToken`
2. POST to `identitytoolkit.googleapis.com/v1/accounts:signInWithIdp`
3. Receive: `localId` (uid), `idToken`, `refreshToken`, `photoUrl`
4. Persist to AsyncStorage key `@black94/auth`
5. Token refresh via `securetoken.googleapis.com/v1/token` with `refresh_token`
6. Token dedup: concurrent refreshes share same Promise (`_tokenRefreshPromise`)

### 3.5 Firestore REST Patterns

- **GET document**: `GET /documents/{collection}/{docId}?key=API_KEY`
- **PATCH document** (merge): `PATCH /documents/{path}?key=API_KEY`
- **PUT document** (replace): `PUT /documents/{path}?key=API_KEY`
- **DELETE document**: `DELETE /documents/{path}?key=API_KEY`
- **Query collection**: `POST /documents:runQuery` with `structuredQuery` body
- **Subcollection query**: `POST /documents/{parent}:runQuery`
- **Commit (transforms)**: `POST /documents:commit` with `fieldTransforms`
- **Dot-notation updates**: PATCH with `updateMask.fieldPaths` + nested mapValue

---

## 4. FIRESTORE DATA MODEL (SCHEMA)

### 4.1 Collections

| Collection | Doc ID Pattern | Key Fields |
|---|---|---|
| `users` | `{uid}` | See User Schema below |
| `usernames` | `{usernameLower}` | `uid: string` |
| `posts` | `{auto}` | See Post Schema |
| `post_likes` | `{postId}_{userId}` | `postId, userId, createdAt` |
| `post_bookmarks` | `{postId}_{userId}` | `postId, userId, createdAt` |
| `post_reposts` | `{postId}_{userId}` | `postId, userId, createdAt` |
| `post_comments` | `{auto}` | `postId, authorId, content, createdAt, ...` |
| `chats` | `{auto}` | See Chat Schema |
| `chats/{chatId}/messages` | `{auto}` | `chatId, senderId, receiverId, content, messageType, status, encrypted, createdAt` |
| `chats/{chatId}/poll_votes` | `{userId}` | `optionId, userId, votedAt` |
| `follows` | `{followerId}_{followingId}` | `followerId, followingId, createdAt` |
| `blocks` | `{blockerId}_{blockedId}` | `blockerId, blockedId, createdAt` |
| `blockedBy` | `{blockedId}_{blockerId}` | `blockerId, blockedId, createdAt` |
| `notifications` | `{type}_{actorId}_{postId}` or `{type}_{actorId}` | See Notification Schema |
| `products` | `{auto}` | Product listing for stores |
| `orders` | `{auto}` | Order tracking |
| `ad_campaigns` | `{auto}` | Ad campaign data |

### 4.2 User Document Schema (`users/{uid}`)

```typescript
{
  uid: string;              // Firebase Auth UID
  email: string;
  username: string;         // display username (e.g., "das")
  usernameLower: string;    // lowercase for search
  displayName: string;
  displayNameLower: string; // for display name search
  bio: string;
  profileImage: string | null;
  coverImage: string | null;
  role: 'personal' | 'business';
  badge: '' | 'gold' | 'silver' | 'bronze';
  subscription: 'free' | 'premium';
  isVerified: boolean;
  e2eePublicKey: string;    // Base64URL X25519 public key
  privacy: {
    dmPermission: 'everyone' | 'followers' | 'paid' | 'no one' | 'nobody' | 'disabled';
    nameVisibility: 'public' | 'private';
    paidChatPrice: number;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 4.3 Post Document Schema (`posts/{postId}`)

```typescript
{
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  authorProfileImage: string | null;
  authorBadge: string;
  authorIsVerified: boolean;
  caption: string;
  mediaUrls: string[];       // Firebase Storage download URLs
  pollData?: {
    question: string;
    options: Array<{ id: string; text: string; votes: number }>;
    duration: number;
    totalVotes: number;
    createdAt: Timestamp;
  };
  likeCount: number;
  commentCount: number;
  repostCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // Computed/optional:
  factCheckVerified?: number;
  factCheckDebunked?: number;
}
```

### 4.4 Chat Document Schema (`chats/{chatId}`)

```typescript
{
  user1Id: string;
  user2Id: string;
  lastMessage: string;      // "🔒 Encrypted message" (privacy-safe)
  lastMessageTime: Timestamp;
  unreadUser1: number;
  unreadUser2: number;
  createdAt: Timestamp;
}
```

### 4.5 Notification Document Schema (`notifications/{docId}`)

```typescript
{
  recipientId: string;
  type: 'follow' | 'like' | 'comment' | 'repost' | 'mention' | 'chat'
      | 'story_view' | 'milestone' | 'suggestion' | 'follow_up_reminder';
  actorId: string;
  actorDisplayName: string;
  actorUsername: string;
  actorProfileImage: string | null;
  actorIsVerified: boolean;
  actorBadge: string;
  postId: string;
  postCaption: string;
  commentContent: string;
  read: boolean;
  createdAt: Timestamp;
}
```

---

## 5. CODE ARCHITECTURE

### 5.1 Directory Structure

```
src/
  lib/
    firebase.ts        — Firebase Auth + Firestore REST API (CORE, NO SDK)
    api.ts             — App-level API: auth, posts, chat, likes, follows, blocks
    e2ee.ts            — End-to-end encryption (NaCl/X25519)
    realtime.ts        — Firestore polling listeners (simulates onSnapshot)
    imageUpload.ts     — MOVED to utils/imageUpload.ts
    shop.ts            — Store/product operations
    payments.ts        — Razorpay payment integration
    razorpay.ts        — Razorpay SDK wrapper
    ads.ts             — Ad campaign management
    crm.ts             — CRM (leads, deals, orders)
    shiprocket.ts      — Shipping integration
    websearch.ts       — Web search functionality
  utils/
    imageUpload.ts     — Firebase Storage upload (fetch + XHR)
    imageOptimizer.ts  — Image compression/manipulation
    timeAgo.ts         — Relative time formatting
    datetime.ts        — Timestamp conversion (tsToMillis)
    base64.ts          — Safe base64 decoder
    crypto.ts          — Crypto utilities
  screens/             — 53 screen components (see full list below)
  stores/
    app.ts             — Zustand global state (user, loading, notifications)
    business.ts        — Business-specific state
  services/
    notificationEngine.ts — Notification polling + creation
  components/
    Avatar.tsx          — User avatar with initials fallback
    CommentSheet.tsx    — Comment bottom sheet
    GoogleSignInWebView.tsx — Google auth webview
  navigation/
    AppNavigator.tsx    — Root navigation (Drawer + Tabs + Stack)
  theme/
    colors.ts           — Design tokens
    responsive.ts       — Responsive helpers
```

### 5.2 Navigation Architecture

```
AppNavigator
  ├── AuthStack (unauthenticated)
  │   ├── Login (AuthScreen)
  │   └── Signup
  └── AppStack (authenticated)
      └── DrawerNavigator
          ├── MainTabs
          │   ├── Home (FeedScreen)
          │   ├── Search (SearchScreen)
          │   ├── Messages (ChatListScreen)
          │   ├── Notifications (NotificationsScreen)
          │   ├── Stories (StoriesScreen)
          │   └── AnonymousChat
          ├── Explore
          ├── ProfileSelf
          ├── Bookmarks
          ├── Cart
          ├── Settings
          ├── MyStoreStack
          └── PremiumDashboard
      └── Stack Screens (40+ lazy-loaded)
```

### 5.3 All Screens (53 files)

FeedScreen, SearchScreen, ChatListScreen, NotificationsScreen, StoriesScreen,
AnonymousChatScreen, ChatRoomScreen, DualPaneChatScreen, AudioCallScreen,
ProfileScreen, UserProfileScreen, EditProfileScreen, FollowersScreen,
SettingsScreen, PrivacySettingsScreen, CreatePostScreen, GifPickerScreen,
StoryViewerScreen, StoryCreatorScreen, PostCommentsScreen,
ExploreScreen, BookmarksScreen, WriteArticleScreen, ArticleViewScreen,
ShareProfileScreen, StorefrontScreen, ProductDetailScreen, CartScreen,
CheckoutScreen, MyStoreScreen, AddProductScreen, OrderTrackingScreen,
StoreDashboardScreen, BusinessDashboardScreen, BusinessOrdersScreen,
OrderManagementScreen, AdsManagerScreen, CreateAdScreen, AdsPricingScreen,
SalaryScreen, AffiliatesScreen, PerformanceScreen, PremiumDashboardScreen,
AssignBadgeScreen, CrmLeadsScreen, CrmDealsScreen, CrmOrdersScreen,
CrmAnalyticsScreen, AiLeadGenScreen, PaidChatScreen, AuthScreen, LoginScreen,
SignupScreen, PrivacyPolicyScreen, TermsScreen, FactCheckBottomSheet

---

## 6. CI/CD PIPELINE

### 6.1 GitHub Actions Workflow

- **File**: `.github/workflows/build-android.yml`
- **Trigger**: Push to `main` branch, or manual `workflow_dispatch`
- **Runner**: `ubuntu-latest`
- **Steps**:
  1. Checkout code
  2. Setup Node.js 22 + Java 17 + Gradle
  3. `npm install` (with env vars RAZORPAY_KEY_ID, FIREBASE_API_KEY)
  4. Decode `google-services.json` from base64 secret
  5. `npx expo prebuild --platform android --clean` (allow fail)
  6. `npm install && npm install hermes-compiler`
  7. Copy icon to drawable splash
  8. Configure release signing from `keystore/release.keystore`
  9. `./gradlew assembleRelease --no-daemon`
  10. Upload APK artifact (30-day retention)
  11. Distribute to Firebase App Distribution

### 6.2 Signing

- **Keystore**: `keystore/release.keystore` (committed to repo)
- **Script**: `scripts/setup-release-signing.py` patches `build.gradle`
- **SHA-1**: Must match `google-services.json`

---

## 7. KEY IMPLEMENTATION DETAILS

### 7.1 NO Firebase SDK

This project deliberately uses **NO Firebase SDK**. All Firebase operations go through
raw REST API calls using `fetch()`. This means:
- No `@react-native-firebase/*` packages
- No Firebase polyfills or shims
- Auth: `identitytoolkit.googleapis.com`
- Firestore: `firestore.googleapis.com/v1/`
- Storage: `firebasestorage.googleapis.com/v0/`
- Token management is manual (refresh token rotation, dedup, persistence)

### 7.2 Firestore Write Strategy

The `_firestoreCommitUpdate` function uses a two-step approach:
1. **Step 1a**: PATCH for regular fields (merge semantics, works for new + existing docs)
2. **Step 1b**: PATCH with `updateMask.fieldPaths` for dot-notation nested fields
3. **Step 2**: POST to `documents:commit` with `write.transform` for serverTimestamp/increment

This avoids the old `write.update` bug that could delete fields.

### 7.3 URL Encoding (CRITICAL)

Firebase Storage download URLs require path segments joined with `%2F`, NOT `/`:
```
BROKEN:  .../o/posts/uid/file.jpg?alt=media         → HTTP 400
CORRECT: .../o/posts%2Fuid%2Ffile.jpg?alt=media     → HTTP 200
```

The `encodeStoragePath()` function in `utils/imageUpload.ts` handles this.
The `fixMediaUrl()` function in `api.ts` and `fixFirebaseUrl()` in `utils/imageUpload.ts`
repair old URLs that were stored with un-encoded slashes.

### 7.4 E2EE (End-to-End Encryption)

- Algorithm: NaCl box (X25519 + XSalsa20-Poly1305)
- Key storage: `expo-secure-store` (OS keystore)
- Public key: Published to `users/{uid}/e2eePublicKey`
- Message format: `E2EE:{base64url_nonce}:{base64url_ciphertext}`
- Backward compatible: non-E2EE messages shown as plaintext
- Last message in chat list: Always "🔒 Encrypted message" (never plaintext)

### 7.5 Real-time Simulation

Since there's no Firebase SDK `onSnapshot`, real-time is simulated via polling:
- `realtime.ts` provides `onDocumentSnapshot`, `onCollectionSnapshot`, `onMessageListener`
- Polling intervals: docs=3s, collections=5s, messages=2s, notifications=10s
- Auto-pause on background, auto-resume on foreground via AppState

### 7.6 Self-Heal System

The `signInWithGoogle` function in `api.ts` detects and repairs corrupted user docs:
- Detects missing username/displayName (from old write.update bug)
- Detects silent corruption (Google defaults replacing custom values)
- Repair priority: AsyncStorage cache > Google auth data > defaults
- Re-reads doc after repair to ensure correct data is returned

---

## 8. ASYNC STORAGE KEYS

| Key | Purpose |
|---|---|
| `@black94/auth` | Firebase auth state (user, tokens) |
| `@black94/user_cache` | User profile cache for self-heal recovery |

---

## 9. ENVIRONMENT VARIABLES / SECRETS

These are GitHub Secrets used in CI/CD:

| Secret | Purpose |
|---|---|
| `GOOGLE_SERVICES_JSON` | Base64-encoded google-services.json |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK service account JSON |
| `FIREBASE_API_KEY` | Firebase Web API key |
| `RAZORPAY_KEY_ID` | Razorpay merchant key ID |

---

## 10. INTENT FILTERS (Deep Links)

```json
{
  "scheme": "black94",
  "host": "auth"
}
```

Firebase Auth callback:
```json
{
  "scheme": "https",
  "host": "black94.firebaseapp.com",
  "pathPrefix": "/__/auth/handler"
}
```

---

*Last updated: 2026-05-20*
*This file is the SINGLE SOURCE OF TRUTH for project infrastructure.*
