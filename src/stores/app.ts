import { create } from 'zustand';
import { User } from '../lib/api';

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
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
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
}));
