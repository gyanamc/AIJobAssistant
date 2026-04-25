import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { C, T } from '../theme';

interface Props {
  visible: boolean;
  message?: string;
}

export default function LoadingOverlay({ visible, message }: Props) {
  if (!visible) return null;
  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <ActivityIndicator size="small" color={C.accent} />
        {message ? <Text style={styles.text}>{message}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6,10,14,0.85)',
    zIndex: 999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(20,28,36,0.95)',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  text: {
    color: C.textSub,
    fontSize: T.sm,
    fontWeight: T.medium,
  },
});
