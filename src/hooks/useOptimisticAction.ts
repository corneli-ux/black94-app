/**
 * useOptimisticAction - shared in-flight guard for optimistic UI actions.
 *
 * Prevents double-tap race conditions by tracking pending operations per key.
 * Any action called while a previous call with the same key is still in-flight
 * is silently dropped.
 *
 * Usage:
 *   const guard = useOptimisticAction().guard;
 *   const handleLike = async (postId, liked) =\u003e {
 *     if (!guard(postId)) return; // skip if already in-flight
 *     // optimistic update ...
 *     try { await toggleLike(postId, liked); } catch { rollback() }
 *   };
 */

import { useRef, useCallback } from 'react';

export function useOptimisticAction() {
  const inflightRef = useRef(new Set<string>());

  /**
   * Returns `true` if the action should proceed, `false` if a previous
   * call with the same key is still in-flight.
   * Automatically clears the key when the async work finishes.
   */
  const guard = useCallback((key: string): boolean => {
    if (inflightRef.current.has(key)) return false;
    inflightRef.current.add(key);
    return true;
  }, []);

  /** Manually clear a key (call in `finally` if you manage your own try/catch) */
  const release = useCallback((key: string) => {
    inflightRef.current.delete(key);
  }, []);

  /** Wrap an async action with in-flight guarding + rollback */
  const run = useCallback(async (
    key: string,
    action: () => Promise<void>,
    rollback?: () => void,
  ) => {
    if (!guard(key)) return;
    try {
      await action();
    } catch (e) {
      rollback?.();
      throw e;
    } finally {
      release(key);
    }
  }, [guard, release]);

  /** Clear all in-flight keys (useful on logout / screen unmount) */
  const clearAll = useCallback(() => {
    inflightRef.current.clear();
  }, []);

  return { guard, release, run, clearAll };
}
