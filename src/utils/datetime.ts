/**
 * datetime.ts — Shared timestamp conversion utilities.
 *
 * Firestore timestamps come in multiple forms depending on the source:
 *  - number (millis directly)
 *  - ISO string
 *  - Firestore Timestamp object ({ seconds, nanoseconds })
 *  - Timestamp-like objects with toMillis() or toDate() methods
 *
 * This utility normalizes all forms to a plain millisecond number.
 */

export function tsToMillis(ts: any): number {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return new Date(ts).getTime() || Date.now();
  if (ts?.toMillis) return ts.toMillis();
  if (ts?.toDate) return ts.toDate().getTime();
  if (ts?.seconds) return ts.seconds * 1000;
  return Date.now();
}
