import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useThemeStore } from '../stores/theme';

const FONT_SIZES = [
  { label: 'Small', value: 14 },
  { label: 'Default', value: 16 },
  { label: 'Large', value: 18 },
  { label: 'Larger', value: 20 },
];

export default function AppearanceScreen() {
  const navigation = useNavigation<any>();
  const { mode, setMode, fontSize, setFontSize } = useThemeStore();

  const themes = [
    { key: 'system', label: 'System', icon: 'phone-portrait-outline' as const },
    { key: 'dark', label: 'Dark', icon: 'moon-outline' as const },
    { key: 'light', label: 'Light', icon: 'sunny-outline' as const },
  ] as const;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Appearance</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Theme</Text>
        <View style={styles.card}>
          {themes.map((t, i) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.row, i === themes.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => setMode(t.key)}
            >
              <Ionicons name={t.icon} size={20} color={colors.textSecondary} style={{ marginRight: 14 }} />
              <Text style={styles.rowLabel}>{t.label}</Text>
              {mode === t.key && (
                <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Text Size</Text>
        <View style={styles.card}>
          {FONT_SIZES.map((fs, i) => (
            <TouchableOpacity
              key={fs.value}
              style={[styles.row, i === FONT_SIZES.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => setFontSize(fs.value)}
            >
              <Text style={[styles.rowLabel, { fontSize: fs.value }]}>{fs.label}</Text>
              {fontSize === fs.value && (
                <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.previewCard}>
          <Text style={styles.previewLabel}>Preview</Text>
          <Text style={[styles.previewText, { fontSize: fontSize ?? 16 }]}>
            This is how your posts and feed text will appear.
          </Text>
          <Text style={[styles.previewSub, { fontSize: (fontSize ?? 16) - 2 }]}>
            @username · 2m ago
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  sectionTitle: {
    color: colors.textMuted, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginHorizontal: 16, marginTop: 20, marginBottom: 8,
  },
  card: {
    marginHorizontal: 16, backgroundColor: colors.surface,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 15,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '500' },
  previewCard: {
    marginHorizontal: 16, marginTop: 20,
    backgroundColor: colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border, padding: 16,
  },
  previewLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 10 },
  previewText: { color: colors.text, fontWeight: '500', lineHeight: 22 },
  previewSub: { color: colors.textMuted, marginTop: 6 },
});
