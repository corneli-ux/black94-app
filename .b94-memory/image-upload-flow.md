# BLACK94 — Image Upload Flow (verified against real Firebase)
# Last verified: 2026-05-20

================================================================================
COMPLETE UPLOAD FLOW (step by step)
================================================================================

1. User picks image → ImagePicker returns URI in /cache/ImagePicker/
2. copyToSafeCache() copies to /cache/B94_picked/ (prevents OS cleanup)
3. optimizeImage() resizes/re-encodes (max 2048px, JPEG quality 0.88)
4. readFileAsBlob() reads file via fetch(uri) → ArrayBuffer → Blob
5. Magic byte validation checks first 4 bytes (JPEG: FF D8 FF, PNG: 89 50 4E 47)
6. MIME auto-correction if bytes don't match declared type
7. doUploadFetch() POSTs Blob to Firebase Storage (fetch, not XHR)
8. Response contains downloadTokens — extract first token
9. Construct download URL:
   STORAGE_BASE/encodedPath?alt=media&token=TOKEN
   where encodedPath uses %2F for slashes (THE CRITICAL FIX)
10. Store URL in Firestore posts collection as mediaUrls array
11. When displaying: parseMediaUrls() calls fixMediaUrl() to repair old URLs

================================================================================
URL FORMAT (THIS IS CRITICAL — GET IT WRONG AND ALL IMAGES BREAK)
================================================================================

CORRECT:
  https://firebasestorage.googleapis.com/v0/b/black94.firebasestorage.app/o/posts%2Fuid%2Ffile.jpg?alt=media&token=abc

WRONG (causes HTTP 400):
  https://firebasestorage.googleapis.com/v0/b/black94.firebasestorage.app/o/posts/uid/file.jpg?alt=media&token=abc

The difference: %2F vs / between path segments after /o/

================================================================================
KEY FILES
================================================================================

src/utils/imageUpload.ts  — Upload logic, URL construction, fixFirebaseUrl()
src/lib/api.ts            — parseMediaUrls(), fixMediaUrl(), createPost()
src/utils/imageOptimizer.ts — Image resizing, format detection
src/utils/base64.ts       — Base64 decoder (used as fallback)
src/screens/CreatePostScreen.tsx — Image picker, upload orchestration
src/screens/StoriesScreen.tsx — Story upload (same flow)
