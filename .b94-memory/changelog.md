# BLACK94 — Change Log
# Every change to this project must be recorded here BEFORE committing.
# Format: DATE | COMMIT | WHAT CHANGED | WHY | VERIFIED?

================================================================================
2026-05-20 | eae5ed1 | encodeStoragePath join '/' → '%2F', added fixMediaUrl/fixFirebaseUrl | ROOT CAUSE: image URLs returned HTTP 400 because Firebase Storage path had un-encoded slashes | YES — tested 5 real URLs from Firestore, all went from 400→200
================================================================================

2026-05-20 | 8e237e9 | copyToSafeCache, fetch+Blob upload, magic byte validation, hooks ordering fix, MIME auto-correction | Previous session: 25+ changes for image black frames, upload failure, profile crash | NO — build succeeded but user reported NO changes visible (URL encoding bug was the real cause)
================================================================================

2026-05-19 | bc93e1a | Extract shared base64 decoder, remove dead exports | Refactor/cleanup | NO
================================================================================

2026-05-19 | 0228b09 | Image error handling with URL refresh for black frames | Attempted fix for black image frames | NO
================================================================================

2026-05-19 | 67c1786 | Prevent FileNotFoundException by copying to permanent cache | Attempted fix for upload failure | NO — real cause was URL encoding
================================================================================

2026-05-19 | c32e3a2 | 10 more bugs — Storefront crash, ProductDetail crash, vote inflation, dead code | Multiple fixes | UNKNOWN
================================================================================

2026-05-19 | 0feee64 | Remove ~122 dead imports across 47 files | Cleanup | UNKNOWN
================================================================================

2026-05-19 | 2e7acb1 | Deep audit — 7 more bugs across 5 files | Multiple fixes | UNKNOWN
================================================================================

2026-05-19 | e6522e8 | 3 critical bugs — profile crash, MIME mismatch, missing error overlays | Profile crash, images, security | UNKNOWN
================================================================================

2026-05-19 | 3e5e83c | 8 critical bugs — profile crash, images loading, security, dead code | Multiple fixes | UNKNOWN
================================================================================

2026-05-19 | 7c65610 | Black photos — add optimization validation + fallback to original | Image optimization validation | UNKNOWN

================================================================================
WARNING: All commits before eae5ed1 were NOT verified against real Firebase data.
The user confirmed NONE of them fixed the visible issues.
DO NOT make changes without verifying against the real database first.
================================================================================
