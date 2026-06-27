import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../stores/app';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';

/**
 * Beautiful smooth animated tab bar.
 * Slides up/down with reanimated when tabBarVisible changes.
 */
export function AnimatedTabBar(props: BottomTabBarProps) {
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
      {/* Render the default tab bar content */}
      <View style={styles.inner}>
        {props.state.routes.map((route, index) => {
          const { options } = props.descriptors[route.key];
          const label =
            options.tabBarLabel !== undefined
              ? options.tabBarLabel
              : options.title !== undefined
              ? options.title
              : route.name;

          const isFocused = props.state.index === index;

          const onPress = () => {
            const event = props.navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              props.navigation.navigate(route.name);
            }
          };

          return (
            <View
              key={route.key}
              style={styles.tabItem}
              onTouchEnd={onPress}
            >
              {options.tabBarIcon &&
                options.tabBarIcon({
                  focused: isFocused,
                  color: isFocused ? '#D4AF37' : 'rgba(255,255,255,0.35)',
                  size: 22,
                })}
            </View>
          );
        })}
      </View>
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
  inner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});