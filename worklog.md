---
Task ID: 1
Agent: Main
Task: Deep bug audit of entire BLACK94 repo — find bugs, fix them, remove dead code

Work Log:
- Read all 60+ source files across src/lib, src/screens, src/components, src/utils, src/stores, src/services, src/navigation, src/theme, config files, and GitHub workflows
- Identified 35+ bugs across 25+ files using systematic code analysis
- Fixed 14 confirmed bugs across 17 files
- Removed dead code (unused imports, variables, styles, types) from 10 files
- Pushed all fixes to GitHub (commit a4f010d)

Stage Summary:
- **CRITICAL fixes**: crm.ts runtime crash (undeclared `limit`), StoryCreatorScreen crash (setPosting outside component), AppNavigator crash (unregistered drawer screens), salary.ts MoM growth bug (String.replace not reassigned)
- **HIGH fixes**: crm.ts field name mismatch (leadScore vs aiScore in both getLeadStats and updateLead), razorpay.ts XSS vulnerability (HTML injection via planName), shop.ts broken pagination
- **DEAD CODE removed**: Unused imports/variables/styles/types from BookmarksScreen, PostCommentsScreen, CommentSheet, FollowersScreen, StoriesScreen, ExploreScreen, SettingsScreen, EditProfileScreen, payments
- **Other fixes**: timeAgo.ts epoch handling, Avatar.tsx setState-during-render anti-pattern

Known remaining issues (not fixed — require architecture changes):
- payments.ts: Client-side subscription activation with no server verification (needs Cloud Function)
- shiprocket.ts: Plaintext credentials in Firestore (needs Cloud Function proxy)
- business.ts: Unbounded Firestore queries (needs pagination + caching)
- Massive code duplication between ProfileScreen and UserProfileScreen (needs shared component extraction)
- StoryCreatorScreen: `toggleLike` not dead — it IS used at line 1031
