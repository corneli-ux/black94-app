import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Switch, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/colors';

const STORAGE_KEY = '@black94/notification_settings';

interface NotifSettings {
  likes: boolean;
  comments: boolean;
  reposts: boolean;
  follows: boolean;
  mentions: boolean;
  dms: boolean;
  stories: boolean;
  liveEvents: boolean;
  emailDigest: boolean;
  quietHoursEnabled: boolean;
}

const defaultSettings: NotifSettings = {
  likes: true,
  comments: true,
  reposts: true,
  follows: true,
  mentions: true,
  dms: true,
  stories: false,
  liveEvents: false,
  emailDigest: false,
  quietHoursEnabled: false,
};

export default function NotificationSettingsScreen() {
  const navigation = useNavigation<any>();
  const [settings, setSettings] = useState<NotifSettings>(defaultSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(val => {
      if (val) setSettings({ ...defaultSettings, ...JSON.parse(val) });
    }).catch(() => {});
  }, []);

  const toggle = async (key: keyof NotifSettings) => {
    const updated = { ...settings, [key]: !settings[key] };
    setSettings(updated);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const Row = ({ label, sub, k }: { label: string; sub?: string; k: keyof NotifSettings }) => (
    <View style={styles.row}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
      <Switch
        value={settings[k]}
        onValueChange={() => toggle(k)}
        trackColor={{ false: colors.surface, true: 'rgba(212,175,55,0.4)' }}
        thumbColor={settings[k] ? colors.accent : colors.textMuted}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 22 }} />
      </View>

      {saved && (
        <View style={styles.savedBanner}>
          <Ionicons name="checkmark-circle" size={14} color={colors.accentGreen} />
          <Text style={styles.savedText}>Saved</Text>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Push Notifications</Text>
        <View style={styles.card}>
          <Row label="Likes" sub="When someone likes your post" k="likes" />
          <Row label="Comments" sub="Replies to your posts" k="comments" />
          <Row label="Reposts" sub="When your post is reposted" k="reposts" />
          <Row label="New Followers" sub="When someone follows you" k="follows" />
          <Row label="Mentions" sub="When you're @mentioned" k="mentions" />
          <Row label="Direct Messages" k="dms" />
          <Row label="Stories" sub="New stories from people you follow" k="stories" />
        </View>

        <Text style={styles.sectionTitle}>Do Not Disturb</Text>
        <View style={styles.card}>
          <Row label="Quiet Hours" sub="Silence notifications 10 PM - 8 AM" k="quietHoursEnabled" />
        </View>

        <Text style={styles.sectionTitle}>Email</Text>
        <View style={styles.card}>
          <Row label="Weekly Digest" sub="Summary of your activity" k="emailDigest" />
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
  savedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, justifyContent: 'center',
    backgroundColor: 'rgba(16,185,129,0.1)',
  },
  savedText: { color: colors.accentGreen, fontSize: 13, fontWeight: '600' },
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
  rowLabel: { fontSize: 15, color: colors.text, fontWeight: '500' },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
