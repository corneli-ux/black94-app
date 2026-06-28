import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../stores/app';
import { BottomTabBar } from '@react-navigation/bottom-tabs';

/**
 * Clean animated tab bar wrapper.
 * Only handles smooth slide up/down animation based on tabBarVisible store.
 * Renders the default tab bar content inside.
 */
export function AnimatedTabBar(props: any) {
  const tabBarVisible = useAppStore((s) => s.tabBarVisible);
  const insets = useSafeAreaInsets();

  const tabBarHeight = 58 + (insets.bottom || 0);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        {
          translateY: withTiming(tabBarVisible ? 0 : tabBarHeight, {
            duration: 220,
          }),
        },
      ],
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