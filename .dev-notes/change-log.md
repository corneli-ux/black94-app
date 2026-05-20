# BLACK94 — Change Log

> Every code change MUST be logged here before committing. Format matters for traceability.

---

## Session: 2026-05-20 — Memory System Creation

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
