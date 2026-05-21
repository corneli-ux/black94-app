# BLACK94 — Do Not Touch List

> Files and functions listed here are CRITICAL and WORKING. Do NOT modify them
> unless you have a VERIFIED bug with a clear root cause and a minimal fix.
> Breaking anything on this list will cause cascading failures.

---

## ABSOLUTELY DO NOT MODIFY (unless fixing a verified bug)

### Core Firebase Layer
| File | Reason |
|---|---|
| `src/lib/firebase.ts` — `_toFsValue()` | Converts JS values to Firestore types. One wrong case = data corruption. |
| `src/lib/firebase.ts` — `_fromFsValue()` | Converts Firestore types to JS. Changing this breaks ALL data reads. |
| `src/lib/firebase.ts` — `_fromFsDoc()` | Document deserialization. Same risk as above. |
| `src/lib/firebase.ts` — `_parseFields()` | Handles serverTimestamp/increment sentinels. Breaking this breaks all writes. |
| `src/lib/firebase.ts` — `_mapOp()` | Maps query operators to Firestore REST format. One wrong map = broken queries. |
| `src/lib/firebase.ts` — `_firestoreCommitUpdate()` | Two-step write (PATCH + commit transform). The replacement for the old write.update. |
| `src/lib/firebase.ts` — `_dotNotationToNestedMap()` | Builds nested mapValue for dot-notation updates. |
| `src/lib/firebase.ts` — `_doTokenRefresh()` | Token refresh with dedup. Breaking this = auth loops. |
| `src/lib/firebase.ts` — `CompatCollectionRef.get()` | Builds structuredQuery for Firestore. Complex, well-tested. |

### Auth & User Self-Heal
| File | Reason |
|---|---|
| `src/lib/api.ts` — `signInWithGoogle()` | Complex self-heal logic for corrupted user docs. Has many edge cases. |
| `src/lib/api.ts` — `fixMediaUrl()` | Repairs old broken Firebase Storage URLs. Tested, working. |
| `src/lib/firebase.ts` — `signInWithGoogleIdToken()` | Auth REST call. Working correctly. |

### Image Upload Pipeline
| File | Reason |
|---|---|
| `src/utils/imageUpload.ts` — `encodeStoragePath()` | The ROOT CAUSE fix for image URLs. Join with `%2F`, NOT `/`. |
| `src/utils/imageUpload.ts` — `fixFirebaseUrl()` | Repairs old broken URLs. Working. |
| `src/utils/imageUpload.ts` — `doUploadFetch()` | Primary upload method (fetch + Blob). Working. |
| `src/utils/imageUpload.ts` — `readFileAsBlob()` | File reading with fetch() + fallback. Working. |
| `src/utils/imageUpload.ts` — `copyToSafeCache()` | Prevents FileNotFoundException. Working. |

### E2EE (End-to-End Encryption)
| File | Reason |
|---|---|
| `src/lib/e2ee.ts` — `encryptMessage()` | NaCl box encryption. DO NOT touch. |
| `src/lib/e2ee.ts` — `decryptMessage()` | NaCl box decryption. DO NOT touch. |
| `src/lib/e2ee.ts` — `getMyKeyPair()` | Key management with dedup. DO NOT touch. |
| `src/lib/e2ee.ts` — `_createOrLoadKeyPair()` | Key persistence order (persist BEFORE cache). DO NOT touch. |

### Navigation
| File | Reason |
|---|---|
| `src/navigation/AppNavigator.tsx` — screen registrations | Adding/removing screens here breaks navigation. |
| `src/navigation/AppNavigator.tsx` — `MainTabs` | Tab bar configuration. Working. |

### CI/CD
| File | Reason |
|---|---|
| `.github/workflows/build-android.yml` | Build pipeline. Changes here affect all deployments. |
| `scripts/setup-release-signing.py` | Release signing configuration. |

---

## MODIFY ONLY WITH EXTREME CAUTION

These files are large and complex. Changes should be surgical, never broad.

| File | Risk Level | Notes |
|---|---|---|
| `src/lib/api.ts` | HIGH | 1000+ lines, handles auth/posts/chat/likes/follows/blocks |
| `src/screens/UserProfileScreen.tsx` | HIGH | Profile view + post cards + replies + likes tabs |
| `src/screens/FeedScreen.tsx` | HIGH | Main feed with post cards, likes, bookmarks, reposts |
| `src/screens/ChatRoomScreen.tsx` | HIGH | Real-time chat with E2EE + polling |
| `src/stores/app.ts` | MEDIUM | Zustand store, safeUser normalization |

---

## SAFE TO MODIFY

These are lower-risk areas where changes are generally safe:

| Area | Notes |
|---|---|
| New screen files | Can be created freely |
| `src/theme/colors.ts` | Design tokens, safe to change |
| `src/utils/timeAgo.ts` | Formatting utility, isolated |
| `src/components/Avatar.tsx` | Display component, well-contained |
| `.dev-notes/` | Documentation, no runtime impact |

---

## BEFORE MODIFYING ANY FILE ON THE DO-NOT-TOUCH LIST:

1. Identify the EXACT bug (error message, reproduction steps)
2. Read the ENTIRE function (not just the line you think is wrong)
3. Understand ALL callers of this function
4. Understand ALL data flows that pass through this function
5. Plan the MINIMAL change that fixes only the bug
6. Test the change doesn't break the callers
7. Document the change in `change-log.md`

---

*If you're not 100% sure a change is safe, DON'T MAKE IT.*
*Last updated: 2026-05-20*
