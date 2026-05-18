---
Task ID: 1
Agent: main
Task: Deep investigation and real fixes for post composer, image upload, stories upload, reply sheet

Work Log:
- Read ALL relevant source files: CreatePostScreen.tsx, StoriesScreen.tsx, CommentSheet.tsx, PostCommentsScreen.tsx, StoryViewerScreen.tsx, imageUpload.ts, firebase.ts, api.ts, payments.ts, datetime.ts
- Verified git state: 15 commits exist, no pending changes to investigated files
- Identified 8 REAL bugs with root causes (not symptoms):
  1. safeBase64Decode() stripping '=' padding — corrupted ALL uploaded images
  2. XHR send(bytes.buffer) including extra bytes from larger ArrayBuffer views
  3. readFileAsBase64() stripping file:// breaking content:// URIs on Android
  4. StoriesScreen using deprecated MediaTypeOptions.Images enum
  5. CommentSheet close animation invisible (Modal unmounts before animation)
  6-8. Reply chain broken: missing replyToId/replyToUsername in CommentData type, fetchPostComments return, and display

Stage Summary:
- Commit 1a14e89 pushed to GitHub with 8 real fixes
- Files modified: imageUpload.ts, StoriesScreen.tsx, CommentSheet.tsx, PostCommentsScreen.tsx, api.ts
- TypeScript compilation passes (0 new errors)
