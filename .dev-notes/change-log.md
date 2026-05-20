# BLACK94 — Change Log

> Every code change MUST be logged here before committing. Format matters for traceability.

---

## Session: 2026-05-20 (cont. 3) — Fix Chat List Empty: Compound Query + Missing Composite Index

### `7d1f53f` — fix: chat list empty — remove compound queries needing missing composite index

**Root Cause — Chat List Empty:**
- `createOrOpenChat` in `ChatListScreen` used COMPOUND Firestore queries:
  `where('user1Id', '==', myId).where('user2Id', '==', targetUser.id).limit(1)`
- This requires a composite index (`user1Id ASC, user2Id ASC`) that was NEVER created
- No `firestore.indexes.json` file existed in the project
- The REST wrapper `_firestoreFetch` silently caught the `FAILED_PRECONDITION` error and returned `[]`
- Result: A NEW duplicate chat document was created EVERY TIME the user opened/composed a chat
- `fetchChatList` uses single-where queries (no composite index needed), so it SHOULD have found the docs
- BUT corrupted docs from the old `update()` bug (missing `user1Id`/`user2Id`) were being filtered out

**Changes:**
1. `ChatListScreen.createOrOpenChat` — replaced compound query with single-where queries + client-side filter (matches UserProfileScreen pattern)
2. `api.ts blockUser` — same fix for chat cleanup during nuclear block
3. `firestore.indexes.json` — created with ALL required composite indexes:
   - `chats`: user1Id+user2Id (both directions), user1Id+lastMessageTime, user2Id+lastMessageTime
   - `calls`: callerId+status, receiverId+status
4. `firebase.json` — added `indexes` reference to `firestore.indexes.json`
5. `fetchChatList` — added critical diagnostic: when no valid docs found, queries ALL chats without filter to determine if docs exist, logs field names for comparison

**IMPORTANT:** The composite indexes need to be deployed to Firebase:
```bash
firebase deploy --only firestore:indexes --project black94
```
Or create them manually in the Firebase Console.

**Files changed**: `src/screens/ChatListScreen.tsx`, `src/lib/api.ts`, `firestore.indexes.json`, `firebase.json`

---

## Session: 2026-05-20 (cont. 2) — Deep Chat Investigation + Diagnostics + Rules Fix

### `17028c0` — fix: chat diagnostics + corrupted doc handling + calls rules

**Deep Investigation Findings:**
- Read ALL chat-related code (firebase.ts, api.ts, ChatListScreen, ChatRoomScreen, AudioCallScreen, UserProfileScreen, ProfileScreen, OrderTrackingScreen)
- Read ALL Firestore security rules (462 lines) — found MISSING `calls` collection rules
- Verified query pipeline: `_toFsValue`, `_mapOp`, `_parseFields`, `CompatCollectionRef.get()`, `_firestoreFetch`
- Checked composite index requirements — single-field `where` queries on chats don't need indexes
- `firestore.indexes.json` DOES NOT EXIST — 31 compound queries across the app need indexes but were created manually
- Firestore rules were missing `calls` collection — ALL call operations (create/read/update) were DENIED by default
- `_missingIndex` flag is set but NEVER checked by callers — silently swallows errors
- Error handling in `fetchChatList()` silently caught ALL errors and returned `[]`

**Changes:**
1. `fetchChatList()` — comprehensive diagnostic logging:
   - Logs each chat doc's fields for corruption detection
   - Catches query errors with full stack trace (was silent before)
   - Filters out corrupted docs (missing user1Id/user2Id from old updateMask bug)
   - Returns only valid documents

2. `ChatListScreen load()` — logs token refresh failures instead of silently swallowing

3. `firestore.rules` — added `calls` collection rules:
   ```
   match /calls/{callId} {
     allow read: if isAuthenticated();
     allow create: if isAuthenticated();
     allow update: if isAuthenticated();
     allow delete: if isAuthenticated();
   }
   ```

**NOTE:** Existing chat documents that were corrupted by the old `update()` bug cannot be auto-recovered. They need manual cleanup in the Firebase Console (delete docs with only `unreadUser1` or `unreadUser2` fields, no `user1Id`/`user2Id`). New chats created after the `updateMask` fix will work correctly.

**Files changed**: `src/lib/api.ts`, `src/screens/ChatListScreen.tsx`, `firestore.rules`

---

## Session: 2026-05-20 (cont.) — Chat List Fix + Call UI Redesign

### `ca713fa` — fix: CRITICAL — chat list disappearing + call UI redesign

**Root Cause — Chat List Disappearing:**
- `CompatDocRef.update()` in `firebase.ts` had two code paths:
  1. With transforms (increment/serverTimestamp) → used `_firestoreCommitUpdate` with `updateMask` ✅
  2. WITHOUT transforms → used raw `_firestoreFetch` PATCH **without** `updateMask` ❌
- When `ChatRoomScreen` opened, it called `resetUnread({ unreadUser1: 0 })` — no transforms
- Raw PATCH without `updateMask` replaces the ENTIRE Firestore document
- This wiped `user1Id`/`user2Id` from the chat doc → `fetchChatList()` queries (where user1Id/user2Id == userId) returned nothing
- **Fix**: ALL `update()` calls now include `updateMask` in the PATCH URL, preserving unspecified fields
- **Impact**: Every chat ever opened had its document silently destroyed. New chats created but then immediately wiped on first open.

**Call UI Redesign:**
- Replaced emoji icons (🔇/🎙️/🔊/🔈/📱) with proper `Ionicons` from `@expo/vector-icons`
- Added `Avatar` component showing the other user's actual profile image (not just a letter initial)
- Gold ring around avatar matching BLACK94 brand identity
- End/decline call icons rotated 135deg (standard phone UX convention)
- Proper safe area insets via `useSafeAreaInsets()`
- Staggered ripple animation (3 rings with 800ms delay between each)
- Added contextual top hint text ("BLACK94 Voice Call" / "Incoming Voice Call" etc.)
- **Files changed**: `src/lib/firebase.ts`, `src/screens/AudioCallScreen.tsx`

---

## Session: 2026-05-20 — Memory System Creation

### `04f320f` — fix: replace Blob-based upload with Uint8Array
- **Root Cause**: React Native's `Blob` constructor does NOT support `ArrayBuffer`/`ArrayBufferView` on many Android versions
- Error: "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported"
- **Fix**: Renamed `readFileAsBlob()` → `readFileAsBinary()` returning `Uint8Array`
- Upload pipeline: `base64 → Uint8Array → XHR.send(Uint8Array)` (works on ALL RN platforms)
- `fetch()` with Blob kept as fast-path on iOS where it works
- Also fixes slow uploads caused by double conversion (`Blob → arrayBuffer → XHR`)
- **Files changed**: `src/utils/imageUpload.ts`

### `d016ca4` — docs: complete project memory system
- Updated `.dev-notes/` with complete infrastructure documentation
- Files: `project-infra.md`, `change-log.md`, `known-bugs.md`, `rules.md`, `do-not-touch.md`

### `c899649` — docs: add persistent project memory
- Created `.dev-notes/` directory with full project infrastructure documentation
- Files: `project-infra.md`, `change-log.md`, `known-bugs.md`, `rules.md`, `do-not-touch.md`
- Purpose: Prevent context loss and infrastructure-related bugs

---

## Previous Sessions (from git log)

### `eae5ed1` — fix: ROOT CAUSE — image URLs return HTTP 400
- **Root Cause**: `encodeStoragePath()` in `utils/imageUpload.ts` joined path segments with `/` instead of `%2F`
- Firebase Storage download URLs use the object path in the URL path, so literal `/` creates invalid paths
- **Fix**: Changed `join('/')` to `join('%2F')` in `encodeStoragePath()`
- **Migration**: Added `fixMediaUrl()` in `api.ts` and `fixFirebaseUrl()` in `utils/imageUpload.ts` to auto-repair old broken URLs in Firestore
- **Files changed**: `src/utils/imageUpload.ts`, `src/lib/api.ts`
- **Status**: Deployed, build #26139716157

### `8e237e9` — fix: ROOT CAUSE — black images + upload failure + profile crash
- Multiple root causes fixed in single commit
- Black images: XHR silently corrupts binary data → switched to fetch() with Blob
- Upload failure: FileNotFoundException on cache cleanup → added `copyToSafeCache()`
- Profile crash: hooks called after early return → moved hooks before early return
- **Files changed**: `src/utils/imageUpload.ts`, `src/screens/UserProfileScreen.tsx`, `src/screens/CreatePostScreen.tsx`

### `bc93e1a` — refactor: extract shared base64 decoder
- Extracted `safeBase64Decode` to `src/utils/base64.ts`
- Removed dead exports from `imageUpload.ts`

### `0228b09` — fix: add image error handling with URL refresh
- Added error overlay for failed images with refresh fallback
- `refreshFirebaseUrl()` for expired token URLs

### `67c1786` — fix: prevent FileNotFoundException on image upload
- Added `copyToSafeCache()` to copy ImagePicker temp files to permanent cache
- Prevents OS cleanup of temp files before upload

### `c32e3a2` — fix: 10 more bugs
- Storefront crash, ProductDetail crash, vote inflation, dead code

### `0feee64` — refactor: remove ~122 dead imports across 47 files

### `2e7acb1` — fix: deep audit — 7 more bugs
- Fixed across 5 files

### `e6522e8` — fix: 3 critical bugs
- Profile crash, MIME mismatch, missing error overlays

### `3e5e83c` — fix: 8 critical bugs
- Profile crash, images loading, security, dead code removal

### `7c65610` — fix: black photos
- Added optimization validation + fallback to original

### `97c56c8` — fix: deep bug audit — 10 fixes
- Across 5 files, dead code removed

### `db8bdec` — fix: remove extra closing brace in FeedScreen.tsx

### `43942cc` — fix: deep audit round 2 — 14 bugs
- Fixed across 11 files

### `a4f010d` — fix: deep bug audit — 17 files, 14 bugs

### `37b9a10` — fix: black photos bug + image upload pipeline + feed display fixes

### `98a7357` — fix: 2 critical profile bugs
- Self-heal priority + feed enrichment corruption

### `69cbc6d` — fix(ci): install hermes-compiler after prebuild

### `ed94b78` — fix(ci): fail-forward prebuild + separate npm install

---

## Pattern of Previous Bad Changes (LESSONS LEARNED)

1. **25 fake fixes**: Previous session claimed to fix bugs but changes either didn't actually happen or broke working code
2. **Dead code removal went too far**: Removing imports that were actually used
3. **ANSI escape sequence trap**: Terminal `[m` sequences caused misreading of file contents, leading to false typo reports
4. **Touching working code**: Changes to files that were functioning correctly introduced new bugs
5. **No verification**: Changes were not verified against actual runtime behavior

---

*This log is append-only. Never edit past entries. Only add new entries at the top.*
