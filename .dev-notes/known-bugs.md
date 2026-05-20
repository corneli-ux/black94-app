# BLACK94 — Known Bugs

> Track all known bugs here. Update status when fixed. NEVER close a bug without
> verifying the fix actually works in the built app.

---

## CRITICAL (App crashes or core features broken)

| # | Bug | Status | Last Verified | Notes |
|---|---|---|---|---|
| C1 | `@das`/`@cornelius` profile page crash | OPEN | 2026-05-20 | Hooks moved before early return in UserProfileScreen.tsx, but crash may have different root cause. Need to check if these specific user docs have corrupt data fields that cause a crash during rendering (e.g., non-string profileImage passed to <Image>). |
| C2 | Image upload produces black/corrupted photos | PARTIALLY FIXED | 2026-05-20 | Root cause was XHR binary corruption → switched to fetch()+Blob. Also fixed URL encoding (/ → %2F). Need to verify in production build. |
| C3 | User doc corruption from old write.update bug | SELF-HEALED | 2026-05-20 | Self-heal system in signInWithGoogle detects and repairs. But some docs may still have silent corruption (Google defaults replacing custom values). |

---

## HIGH (Major feature broken or degraded)

| # | Bug | Status | Last Verified | Notes |
|---|---|---|---|---|
| H1 | Old broken image URLs in Firestore | MIGRATED | 2026-05-20 | `fixMediaUrl()` and `fixFirebaseUrl()` auto-repair old URLs with un-encoded slashes. Only fixes on read — old data still broken in DB. |
| H2 | Poll vote inflation (totalVotes exceeds actual voters) | FIXED | 2026-05-20 | `votePostPoll` now checks existing vote before incrementing. |
| H3 | Composite index missing for Firestore queries | HANDLED | 2026-05-20 | `_firestoreFetch` returns empty result with `_missingIndex` flag when index is missing. Callers fall back to individual reads. |

---

## MEDIUM (Feature partially broken)

| # | Bug | Status | Last Verified | Notes |
|---|---|---|---|---|
| M1 | Dead code / unused imports in some files | PARTIALLY CLEANED | 2026-05-20 | ~122 dead imports removed across 47 files in commit 0feee64. More may remain. |
| M2 | FeedScreen may have composite index issues | HANDLED | 2026-05-20 | Falls back to individual reads when index missing. |
| M3 | Profile enrichment may use stale data | OPEN | — | Feed author data comes from post snapshot, not live user doc. If user changes name, old posts show old name. |
| M4 | No rate limiting on post creation | OPEN | — | Users can spam posts. No client or server-side throttling. |
| M5 | Notification polling may miss events | OPEN | — | 15s polling interval means notifications can be delayed. Not real-time. |
| M6 | Chat message polling not scalable | OPEN | — | Every chat room polls every 2s. Multiple active chats = many parallel requests. |

---

## LOW (Minor UX or cosmetic issues)

| # | Bug | Status | Last Verified | Notes |
|---|---|---|---|---|
| L1 | No pull-to-refresh on some screens | OPEN | — | |
| L2 | Error states not consistently styled | PARTIALLY FIXED | 2026-05-20 | UserProfileScreen has error+retry UI. Other screens may not. |
| L3 | No offline indicator | OPEN | — | App doesn't show when network is unavailable. |
| L4 | Large images may cause memory pressure | OPEN | — | No image size limit on upload. |
| L5 | No pagination on feed | OPEN | — | Feed loads limited posts with no infinite scroll. |
| L6 | Avatar shows "?" for empty display names | FIXED | 2026-05-20 | safeUser() in stores/app.ts defaults displayName to 'User'. |

---

## FIXED IN PREVIOUS SESSIONS

| # | Bug | Fix Commit | Notes |
|---|---|---|---|
| F1 | Image URL encoding (/ not %2F) | eae5ed1 | encodeStoragePath fix |
| F2 | Black photos from XHR corruption | 8e237e9 | Switched to fetch()+Blob |
| F3 | Hooks after early return crash | 8e237e9 | Moved hooks before return |
| F4 | FileNotFoundException on upload | 67c1786 | copyToSafeCache |
| F5 | Vote double-increment | c32e3a2 | Check existing vote |
| F6 | MIME type mismatch on upload | e6522e8 | Magic byte validation |
| F7 | Missing image error overlays | e6522e8 | Added error UI |
| F8 | Missing query composite index | 3e5e83c | Fallback to individual reads |
| F9 | 122 dead imports | 0feee64 | Removed across 47 files |
| F10 | Storefront crash | c32e3a2 | Null safety fix |
| F11 | ProductDetail crash | c32e3a2 | Null safety fix |
| F12 | FeedScreen extra closing brace | db8bdec | Syntax fix |

---

## UNDER INVESTIGATION

| # | Issue | Status | Notes |
|---|---|---|---|
| U1 | Build #26139716157 status | NEEDS VERIFICATION | Pushed eae5ed1 but build success not confirmed |
| U2 | Exact accounts affected by profile crash | NEEDS DATA | @das and @cornelius reported — need to check their Firestore docs for corrupt fields |

---

*Bug count: 3 Critical, 3 High, 6 Medium, 6 Low, 12 Fixed, 2 Under Investigation*
*Last updated: 2026-05-20*
