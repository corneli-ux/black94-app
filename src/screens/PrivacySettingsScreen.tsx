import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, StatusBar, Switch, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { firestore } from '../lib/firebase';

interface PrivacyConfig {
  isPrivate: boolean;
  showActivityStatus: boolean;
  allowDMsFrom: 'everyone' | 'following' | 'none';
  showLikedPosts: boolean;
  indexable: boolean;
}

const defaults: PrivacyConfig = {
  isPrivate: false,
  showActivityStatus: true,
  allowDMsFrom: 'everyone',
  showLikedPosts: true,
  indexable: true,
};

export default function PrivacySettingsScreen() {
  const navigation = useNavigation<any>();
  const { user, setUser } = useAppStore();
  const [config, setConfig] = useState<PrivacyConfig>(defaults);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setConfig({
        isPrivate: user.isPrivate || false,
        showActivityStatus: user.showActivityStatus !== false,
        allowDMsFrom: user.allowDMsFrom || 'everyone',
        showLikedPosts: user.showLikedPosts !== false,
        indexable: user.indexable !== false,
      });
    }
  }, [user?.id]);

  const update = async (partial: Partial<PrivacyConfig>) => {
    const updated = { ...config, ...partial };
    setConfig(updated);
    setSaving(true);
    try {
      await firestore().collection('users').doc(user!.id).update({
        ...partial,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      setUser({ ...user!, ...partial });
    } catch {} finally { setSaving(false); }
  };

  const Row = ({ label, sub, value, onToggle }: { label: string; sub?: string; value: boolean; onToggle: () => void }) => (
    <View style={styles.row}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.surface, true: 'rgba(212,175,55,0.4)' }}
        thumbColor={value ? colors.accent : colors.textMuted}
      />
    </View>
  );

  const DMRow = () => {
    const opts: Array<{ label: string; val: PrivacyConfig['allowDMsFrom'] }> = [
      { label: 'Everyone', val: 'everyone' },
      { label: 'People I follow', val: 'following' },
      { label: 'No one', val: 'none' },
    ];
    return (
      <>
        {opts.map((o, i) => (
          <TouchableOpacity
            key={o.val}
            style={[styles.row, i === opts.length - 1 && { borderBottomWidth: 0 }]}
            onPress={() => update({ allowDMsFrom: o.val })}
          >
            <Text style={[styles.rowLabel, { flex: 1 }]}>{o.label}</Text>
            {config.allowDMsFrom === o.val && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
          </TouchableOpacity>
        ))}
      </>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy & Safety</Text>
        {saving
          ? <ActivityIndicator size="small" color={colors.accent} />
          : <View style={{ width: 22 }} />}
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Account Privacy</Text>
        <View style={styles.card}>
          <Row label="Private Account" sub="Only approved followers can see your posts" value={config.isPrivate} onToggle={() => update({ isPrivate: !config.isPrivate })} />
          <Row label="Show Activity Status" sub="Let people see when you were last active" value={config.showActivityStatus} onToggle={() => update({ showActivityStatus: !config.showActivityStatus })} />
          <View style={[styles.row, { borderBottomWidth: 0 }]}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.rowLabel}>Show Liked Posts</Text>
              <Text style={styles.rowSub}>Others can see posts you've liked</Text>
            </View>
            <Switch
              value={config.showLikedPosts}
              onValueChange={() => update({ showLikedPosts: !config.showLikedPosts })}
              trackColor={{ false: colors.surface, true: 'rgba(212,175,55,0.4)' }}
              thumbColor={config.showLikedPosts ? colors.accent : colors.textMuted}
            />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Direct Messages</Text>
        <View style={styles.card}><DMRow /></View>

        <Text style={styles.sectionTitle}>Discoverability</Text>
        <View style={styles.card}>
          <Row label="Allow Profile Indexing" sub="Your profile can appear in search results" value={config.indexable} onToggle={() => update({ indexable: !config.indexable })} />
        </View>

        <Text style={styles.sectionTitle}>Content Controls</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.navRow} onPress={() => navigation.navigate('MutedUsers')}>
            <Text style={styles.rowLabel}>Muted Accounts</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navRow, { borderBottomWidth: 0 }]} onPress={() => navigation.navigate('MutedWords')}>
            <Text style={styles.rowLabel}>Muted Words</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
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
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  navRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 15,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowLabel: { fontSize: 15, color: colors.text, fontWeight: '500' },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
