import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, T, S } from '../theme';

interface Props {
  visible: boolean;
}

export default function OfflineBanner({ visible }: Props) {
  if (!visible) return null;
  return (
    <View style={styles.banner}>
      <View style={styles.dot} />
      <Text style={styles.text}>No connection — showing cached jobs</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.xs + 2,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245,166,35,0.2)',
    paddingVertical: S.xs + 2,
    paddingHorizontal: S.lg,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.yellow,
  },
  text: {
    color: C.yellow,
    fontSize: T.xs,
    fontWeight: T.semibold,
    letterSpacing: 0.2,
  },
});
