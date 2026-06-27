import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/app';

/**
 * Smooth hide/show for bottom tab bar + top elements on scroll.
 * Uses your existing tabBarVisible store.
 * Call onScroll / onScrollEnd on your FlatList or ScrollView.
 */
export const useHideTabBarOnScroll = () => {
  const setTabBarVisible = useAppStore((s) => s.setTabBarVisible);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrollY = useRef(0);

  const onScroll = (event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    const scrollingDown = currentY > lastScrollY.current + 8;

    if (scrollingDown && currentY > 80) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setTabBarVisible(false);
    } else if (currentY < 30) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setTabBarVisible(true);
    }

    lastScrollY.current = currentY;
  };

  const onScrollEnd = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setTabBarVisible(true);
    }, 650);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { onScroll, onScrollEnd, setTabBarVisible };
};