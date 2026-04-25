import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

interface ToastProps {
  message: string;
  type?: 'success' | 'error';
  visible: boolean;
  onDismiss: () => void;
}

export default function Toast({ message, type = 'success', visible, onDismiss }: ToastProps) {
  const opacity = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(3000),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => onDismiss());
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <View style={[styles.toast, type === 'error' && styles.toastError]}>
        <Text style={styles.message}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 60, left: 20, right: 20, zIndex: 9999, alignItems: 'center' },
  toast: { backgroundColor: '#0e1212', borderLeftWidth: 4, borderLeftColor: '#7dd3a8', borderRadius: 12, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  toastError: { borderLeftColor: '#ef4444' },
  message: { color: '#f9fafb', fontSize: 15, fontWeight: '600' },
});
