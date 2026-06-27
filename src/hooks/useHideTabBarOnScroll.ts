import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/app';

/**
 * Pro-level smooth hide/show for bottom tab bar + top elements.
 * Direction-aware + natural timing.
 * Works great with reanimated tab bar animation.
 */
export const useHideTabBarOnScroll = () => {
  const setTabBarVisible = useAppStore((s) => s.setTabBarVisible);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrollY = useRef(0);

  const onScroll = (event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    const scrollingDown = currentY > lastScrollY.current + 6;

    if (scrollingDown && currentY > 60) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setTabBarVisible(false);
    } else if (currentY < 20) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setTabBarVisible(true);
    }

    lastScrollY.current = currentY;
  };

  const onScrollEnd = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // Gentle delay so it feels natural when user stops scrolling
    timeoutRef.current = setTimeout(() => {
      setTabBarVisible(true);
    }, 600);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { onScroll, onScrollEnd, setTabBarVisible };
};