import { create } from 'zustand';
import { User } from '../lib/api';
import { startNotificationPolling, stopNotificationPolling } from '../services/notificationEngine';

interface AppState {
  user: User | null;
  setUser: (user: User | null) => void;
  token: string | null;
  setToken: (token: string | null) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  isReady: boolean;
  setIsReady: (ready: boolean) => void;
  unreadNotificationCount: number;
  setUnreadNotificationCount: (count: number) => void;
  feedRefreshKey: number;
  triggerFeedRefresh: () => void;
  logout: () => void;
}

/**
 * Normalize user data — ensures every field has a safe default so the Avatar
 * component never shows "?" (empty string is falsy → shows "?").
 *
 * This is the single source of truth for user field defaults.  Callers can
 * pass partial data and this function fills in the gaps.
 */
function safeUser(data: any): User | null {
  if (!data) return null;

  return {
    id: data.uid || data.id || '',
    email: data.email || '',
    username: data.username || '',
    // displayName: prefer explicit value, then fallback chain to 'User'.
    // Empty string is falsy in JS — Avatar treats it as no name → "?".
    displayName: data.displayName || data.name || 'User',
    bio: data.bio || '',
    // profileImage: keep null/empty as-is (triggers initials in Avatar),
    // but DO use photoURL from Firebase auth if no stored image exists.
    profileImage: data.profileImage || data.photoURL || null,
    coverImage: data.coverImage || null,
    role: data.role || 'personal',
    badge: data.badge || '',
    subscription: data.subscription || 'free',
    isVerified: data.isVerified || false,
    createdAt: data.createdAt || Date.now(),
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  setUser: (user) => {
    const normalized = safeUser(user);
    set({ user: normalized });
    // Start notification polling when user logs in, stop on logout
    if (normalized?.id) {
      startNotificationPolling(normalized.id, (count) => {
        set({ unreadNotificationCount: count });
      });
    } else {
      stopNotificationPolling();
    }
  },
  token: null,
  setToken: (token) => set({ token }),
  loading: false, // Start as false — App.js handles readiness via isReady
  setLoading: (loading) => set({ loading }),
  isReady: false,
  setIsReady: (isReady) => set({ isReady }),
  unreadNotificationCount: 0,
  setUnreadNotificationCount: (count) => set({ unreadNotificationCount: count }),
  feedRefreshKey: 0,
  triggerFeedRefresh: () => set((s) => ({ feedRefreshKey: s.feedRefreshKey + 1 })),
  logout: () => {
    stopNotificationPolling();
    set({ user: null, token: null, unreadNotificationCount: 0, loading: false });
  },
}));

// Re-export for convenience — screens can import from here
export { startNotificationPolling, stopNotificationPolling } from '../services/notificationEngine';
