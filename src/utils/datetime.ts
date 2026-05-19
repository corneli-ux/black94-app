/**
 * datetime.ts — Shared timestamp conversion utilities.
 *
 * Firestore timestamps come in multiple forms depending on the source:
 *  - number (millis directly)
 *  - ISO string
 *  - Custom Firebase REST wrapper object ({ __fs_type: 'timestamp', value: ISO_STRING })
 *  - Firestore Timestamp object ({ seconds, nanoseconds })
 *  - Timestamp-like objects with toMillis() or toDate() methods
 *
 * This utility normalizes all forms to a plain millisecond number.
 */

export function tsToMillis(ts: any): number {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;

  // Handle custom Firebase REST wrapper timestamps:
  // firebase.ts wraps timestamps as { __fs_type: 'timestamp', value: ISO_STRING }
  // when reading docs through _fromFsDoc → _fromFsValue.
  if (ts?.__fs_type === 'timestamp' && typeof ts.value === 'string') {
    const ms = new Date(ts.value).getTime();
    return Number.isNaN(ms) ? Date.now() : ms;
  }

  // Handle ISO date strings — use NaN check instead of || to avoid
  // replacing a valid epoch-zero (0) with Date.now()
  if (typeof ts === 'string') {
    const ms = new Date(ts).getTime();
    return Number.isNaN(ms) ? Date.now() : ms;
  }

  if (ts?.toMillis) return ts.toMillis();
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts?.seconds) return ts.seconds * 1000;
  return Date.now();
}
