import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';

type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeState {
  mode: ThemeMode;
  fontSize: number;
  resolvedDark: boolean;
  setMode: (mode: ThemeMode) => void;
  setFontSize: (size: number) => void;
  hydrate: () => Promise<void>;
}

const STORAGE_KEY = '@black94/theme';

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'dark',
  fontSize: 16,
  resolvedDark: true,

  setMode: async (mode) => {
    const resolved = mode === 'system'
      ? Appearance.getColorScheme() !== 'light'
      : mode === 'dark';
    set({ mode, resolvedDark: resolved });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, fontSize: get().fontSize })).catch(() => {});
  },

  setFontSize: async (fontSize) => {
    set({ fontSize });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: get().mode, fontSize })).catch(() => {});
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const mode: ThemeMode = saved.mode || 'dark';
        const resolved = mode === 'system'
          ? Appearance.getColorScheme() !== 'light'
          : mode === 'dark';
        set({ mode, fontSize: saved.fontSize || 16, resolvedDark: resolved });
      }
    } catch {}
  },
}));

export function hydrateTheme() {
  useThemeStore.getState().hydrate();
}
