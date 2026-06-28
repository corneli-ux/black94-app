/**
 * AnimatedPressableScale — a TouchableOpacity replacement that scales
 * down slightly on press using spring physics.
 *
 * Uses Animated.createAnimatedComponent(TouchableOpacity) which is the
 * official Reanimated pattern for animating a pressable. Safe in
 * Reanimated 4 + New Architecture.
 *
 * Props:
 *   - scale (default 0.94): how much to shrink on press. Pass 1 to disable.
 *   - springConfig (default spring.snappy): physics to use
 *   - ...all TouchableOpacity props
 */

import React from 'react';
import { TouchableOpacity, TouchableOpacityProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { spring, DURATIONS } from '../constants/animations';
import type { WithSpringConfig } from 'react-native-reanimated';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export interface AnimatedPressableScaleProps extends TouchableOpacityProps {
  /** 0.94 = shrink to 94% on press. Pass 1 to disable the scale effect. */
  scale?: number;
  springConfig?: WithSpringConfig;
  /** If true, animate a slight opacity dip on press as well. */
  dimOnPress?: boolean;
  children?: React.ReactNode;
}

export function AnimatedPressableScale({
  scale = 0.94,
  springConfig = spring.snappy,
  dimOnPress = false,
  onPressIn,
  onPressOut,
  style,
  children,
  ...rest
}: AnimatedPressableScaleProps) {
  // 0 = idle, 1 = pressed. Driven to a spring target inside useAnimatedStyle.
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => {
    // When scale === 1 we skip the transform entirely so we don't render
    // an identity transform that could conflict with caller-provided styles.
    if (scale >= 1 && !dimOnPress) {
      return {};
    }
    const target = pressed.value ? scale : 1;
    const s = withSpring(target, springConfig);
    const opacity = dimOnPress
      ? withTiming(pressed.value ? 0.7 : 1, { duration: DURATIONS.quick })
      : 1;
    return {
      transform: [{ scale: s }],
      opacity,
    };
  });

  return (
    <AnimatedTouchable
      onPressIn={(e) => {
        pressed.value = 1;
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = 0;
        onPressOut?.(e);
      }}
      style={[style, animatedStyle]}
      {...rest}
    >
      {children}
    </AnimatedTouchable>
  );
}

export default AnimatedPressableScale;
