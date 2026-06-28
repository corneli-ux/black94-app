import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../stores/app';
import { BottomTabBar } from '@react-navigation/bottom-tabs';
import { spring, DURATIONS } from '../constants/animations';

/**
 * Clean animated tab bar wrapper.
 * Coordinated spring slide + opacity so it feels connected to the header.
 * Renders the default tab bar content inside.
 */
export function AnimatedTabBar(props: any) {
  const tabBarVisible = useAppStore((s) => s.tabBarVisible);
  const insets = useSafeAreaInsets();

  const tabBarHeight = 58 + (insets.bottom || 0);

  const animatedStyle = useAnimatedStyle(() => {
    // Coordinated spring — same physics as header so they move as one.
    const translateY = withSpring(
      tabBarVisible ? 0 : tabBarHeight,
      spring.gentle,
    );
    // Slight scale + opacity dip while hidden for extra polish.
    const scale = withSpring(tabBarVisible ? 1 : 0.96, spring.gentle);
    const opacity = withTiming(tabBarVisible ? 1 : 0, {
      duration: DURATIONS.fast,
    });

    return {
      transform: [
        { translateY },
        // Scale around the bottom so the bar slides down instead of growing.
        { scale: interpolate(scale, [0.96, 1], [0.96, 1], Extrapolation.CLAMP) },
      ],
      opacity,
    };
  });

  return (
    <Animated.View
      style={[
        styles.container,
        {
          height: tabBarHeight,
          paddingBottom: insets.bottom || 0,
        },
        animatedStyle,
      ]}
    >
      <BottomTabBar {...props} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#000000',
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(212,175,55,0.15)',
    overflow: 'hidden',
  },
});
