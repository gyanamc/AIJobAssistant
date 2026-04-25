import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { C, T, R, S, SHADOW } from '../theme';

interface ToastProps {
  message: string;
  type?: 'success' | 'error';
  visible: boolean;
  onDismiss: () => void;
}

export default function Toast({ message, type = 'success', visible, onDismiss }: ToastProps) {
  const opacity = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(-8)).current;

  React.useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.parallel([
          Animated.timing(opacity,     { toValue: 1, duration: 220, useNativeDriver: true }),
          Animated.timing(translateY,  { toValue: 0, duration: 220, useNativeDriver: true }),
        ]),
        Animated.delay(2800),
        Animated.parallel([
          Animated.timing(opacity,     { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.timing(translateY,  { toValue: -8, duration: 200, useNativeDriver: true }),
        ]),
      ]).start(() => onDismiss());
    }
  }, [visible]);

  if (!visible) return null;

  const borderColor = type === 'error' ? C.red : C.accent;

  return (
    <Animated.View style={[styles.container, { opacity, transform: [{ translateY }] }]}>
      <View style={[styles.toast, { borderColor }]}>
        <View style={[styles.dot, { backgroundColor: borderColor }]} />
        <Text style={styles.message} numberOfLines={1}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 56,
    left: S.xl,
    right: S.xl,
    zIndex: 9999,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderRadius: R.pill,
    paddingHorizontal: S.lg,
    paddingVertical: S.sm + 2,
    ...SHADOW.elevated,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  message: {
    color: C.text,
    fontSize: T.sm,
    fontWeight: T.semibold,
    flexShrink: 1,
  },
});
