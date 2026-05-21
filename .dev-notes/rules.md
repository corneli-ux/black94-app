# BLACK94 — Working Rules

> These rules are MANDATORY. Violating any rule is the #1 cause of bugs in this project.
> Read these rules BEFORE every code change. No exceptions.

---

## RULE 1: NEVER TOUCH WORKING CODE

**The 25-fake-fixes disaster happened because working code was modified.**

- If a feature is working correctly, DO NOT modify it — even for "cleanup", "refactoring", or "optimization"
- Only modify code when there is a VERIFIED, REPRODUCIBLE bug
- "Code looks messy" is NOT a valid reason to touch it
- Dead code removal is ONLY allowed after confirming the code is truly unused (grep for ALL references)

### How to verify something is actually broken:
1. Get EXACT error message or reproduction steps from the user
2. Read the relevant code path end-to-end
3. Identify the EXACT line causing the issue
4. Make the MINIMAL change to fix it
5. Verify the fix doesn't break anything else

---

## RULE 2: ONE CHANGE AT A TIME

- Each commit must fix exactly ONE bug or implement exactly ONE feature
- No "while I'm here" changes
- No bundle fixes (unless the bugs are genuinely interdependent)
- This makes rollback trivial and review possible

### Commit message format:
```
fix: <one-line description of what was wrong and how it was fixed>
```

---

## RULE 3: UNDERSTAND BEFORE CHANGING

**The #2 cause of bugs is not reading the full code context.**

Before modifying ANY file:
1. Read the ENTIRE file (not just the function you think is broken)
2. Read all files that import from this file
3. Understand the data flow from source to UI
4. Check `project-infra.md` for relevant Firebase/schema details
5. Check `do-not-touch.md` for files/functions that must not be changed

### Anti-patterns that caused bugs:
- ❌ "I'll fix the image upload" → only reads imageUpload.ts → misses that api.ts also handles URLs
- ❌ "I'll fix the profile crash" → only reads UserProfileScreen.tsx → misses that firebase.ts auth state matters
- ❌ "I'll clean up imports" → removes "unused" import → it was actually used via side effect

---

## RULE 4: VERIFY WITH REAL DATA

- Never assume what Firestore data looks like — read the actual documents
- Never assume what an API response looks like — test with real calls
- Never assume what a user's document contains — check the Firestore console
- Type-check everything: if a field might be null/undefined/wrong-type, guard it

### Example: Profile crash for @das
Before fixing, check:
1. What does the Firestore doc for @das actually contain?
2. Is `profileImage` a string, null, or an object?
3. Is `username` populated or empty?
4. Are there any unexpected fields or missing fields?

---

## RULE 5: PRESERVE FIRESTORE COMPATIBILITY

- Firestore REST API has specific requirements that differ from the SDK
- Path segments in Storage URLs MUST be `%2F`-encoded
- PATCH endpoint merges (safe), PUT replaces (destructive)
- Dot-notation fields need `updateMask.fieldPaths` + nested mapValue
- Transforms (serverTimestamp, increment) need separate commit endpoint
- `write.update` without `updateMask` can DELETE fields — NEVER use it

---

## RULE 6: GUARD ALL EXTERNAL DATA

Every piece of data from Firestore, AsyncStorage, or network must be treated as untrusted:

```typescript
// GOOD: Type-safe with fallbacks
const username = typeof data.username === 'string' ? data.username : '';
const profileImage = typeof data.profileImage === 'string' ? data.profileImage : null;

// BAD: Blind trust
const username = data.username; // Could be undefined, object, number...
```

---

## RULE 7: HOOKS ORDER IN REACT

ALL React hooks (useState, useEffect, useCallback, etc.) must be called:
1. Before ANY conditional return
2. In the SAME order on every render
3. At the top level of the component (not inside conditions, loops, or nested functions)

```typescript
// GOOD: All hooks first, then early returns
export default function Screen({ route }) {
  const [data, setData] = useState(null);  // Hook
  useEffect(() => { ... }, []);            // Hook
  if (!userId) return <NotFound />;        // Early return AFTER hooks
}

// BAD: Early return before hooks = CRASH
export default function Screen({ route }) {
  if (!userId) return <NotFound />;        // ← CRASH: "Rendered fewer hooks than expected"
  const [data, setData] = useState(null);  // Hook called conditionally!
}
```

---

## RULE 8: NO LIES OR PRETENDING

- If a fix fails, say so honestly — don't pretend it worked
- If you don't understand something, say so — don't guess
- If you can't reproduce a bug, say so — don't make random changes
- If a build fails, report the actual error — don't say "it should work"
- Log every action in `change-log.md` — the truth, not what you wish happened

---

## RULE 9: UPDATE DOCUMENTATION

After every change:
1. Update `change-log.md` with what was changed and why
2. Update `known-bugs.md` if fixing or discovering a bug
3. Update `project-infra.md` if infrastructure changes
4. Update `do-not-touch.md` if adding new critical code

---

## RULE 10: READ THE MEMORY FILES FIRST

Before starting ANY work session:
1. Read `project-infra.md` — understand the full stack
2. Read `known-bugs.md` — know what's broken
3. Read `rules.md` — this file
4. Read `do-not-touch.md` — know what not to touch
5. Read `change-log.md` — know recent changes

This takes 5 minutes and prevents hours of bug introduction.

---

*These rules were written in blood (of previous bugs). Follow them.*
*Last updated: 2026-05-20*
