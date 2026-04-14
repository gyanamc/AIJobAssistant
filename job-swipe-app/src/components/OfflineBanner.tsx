import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  visible: boolean;
}

export default function OfflineBanner({ visible }: Props) {
  const [dismissed, setDismissed] = useState(false);
  if (!visible || dismissed) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>📡 You're offline — apply actions disabled</Text>
      <TouchableOpacity onPress={() => setDismissed(true)}>
        <Text style={styles.dismiss}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#b45309',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  text: { color: '#fff', fontSize: 13, flex: 1 },
  dismiss: { color: '#fff', fontSize: 16, paddingLeft: 12 },
});
