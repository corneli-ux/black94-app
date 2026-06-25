import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { AppIcon } from '../components/icons';

export default function AdsManagerScreen({ navigation }: any) {
  return (
    <SafeAreaView style={s.root}>
      <TouchableOpacity style={s.back} onPress={() => navigation.goBack()}>
        <AppIcon name="arrow-back" size="lg" color={colors.text} />
      </TouchableOpacity>
      <View style={s.center}>
        <AppIcon name="bar-chart" size="hero" color={colors.accent} />
        <Text style={s.title}>Ads Manager</Text>
        <Text style={s.sub}>Advertising tools coming soon.</Text>
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  back: { padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  sub: { color: colors.textSecondary, fontSize: 15 },
});
