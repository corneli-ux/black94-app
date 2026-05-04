import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { auth, firestore } from '../lib/firebase';
import { useAppStore } from '../stores/app';

/* ── Types ──────────────────────────────────────────────────────────────── */
interface PrivacySettings {
  nameVisibility: 'public' | 'private';
  dmPermission: 'all' | 'followers' | 'paid';
  searchVisible: boolean;
  accountLocked: boolean;
}

const DEFAULT_PRIVACY: PrivacySettings = {
  nameVisibility: 'public',
  dmPermission: 'all',
  searchVisible: true,
  accountLocked: false,
};

const DM_OPTIONS: { value: PrivacySettings['dmPermission']; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'followers', label: 'Followers Only' },
  { value: 'paid', label: 'Paid Subscribers Only' },
];

export default function PrivacySettingsScreen() {
  const navigation = useNavigation();
  const { user } = useAppStore();
  const [privacy, setPrivacy] = useState<PrivacySettings>(DEFAULT_PRIVACY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPrivacy();
  }, []);

  const loadPrivacy = async () => {
    const userId = user?.id || auth()?.currentUser?.uid;
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      const docSnap = await firestore()
        .collection('users')
        .doc(userId)
        .get();

      if (docSnap.exists) {
        const data = docSnap.data();
        const stored = data?.privacy;
        if (stored) {
          setPrivacy({
            nameVisibility: stored.nameVisibility || 'public',
            dmPermission: stored.dmPermission || 'all',
            searchVisible: stored.searchVisible !== false,
            accountLocked: stored.accountLocked || false,
          });
        }
      }
    } catch (e) {
      console.error('[PrivacySettings] Failed to load:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const userId = user?.id || auth()?.currentUser?.uid;
    if (!userId) return;

    setSaving(true);
    try {
      await firestore()
        .collection('users')
        .doc(userId)
        .update({
          privacy: {
            nameVisibility: privacy.nameVisibility,
            dmPermission: privacy.dmPermission,
            searchVisible: privacy.searchVisible,
            accountLocked: privacy.accountLocked,
          },
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });
      Alert.alert('Saved', 'Privacy settings updated successfully.');
    } catch (e) {
      Alert.alert('Error', 'Failed to save privacy settings.');
      console.error('[PrivacySettings] Save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const toggleSwitch = (field: keyof PrivacySettings) => {
    if (field === 'nameVisibility') {
      setPrivacy(prev => ({
        ...prev,
        nameVisibility: prev.nameVisibility === 'public' ? 'private' : 'public',
      }));
    } else {
      setPrivacy(prev => ({
        ...prev,
        [field]: !prev[field],
      }));
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy Settings</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving}>
          <Text style={[styles.saveText, saving && { opacity: 0.5 }]}>
            {saving ? 'Saving...' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* ── Name Visibility ──────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Name Visibility</Text>
          <Text style={styles.sectionDesc}>
            Control who can see your display name on your public profile.
          </Text>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Public</Text>
            <TouchableOpacity
              style={[
                styles.toggleTrack,
                privacy.nameVisibility === 'public' && styles.toggleTrackOn,
              ]}
              onPress={() => toggleSwitch('nameVisibility')}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.toggleThumb,
                  privacy.nameVisibility === 'public' && styles.toggleThumbOn,
                ]}
              />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.separator} />

        {/* ── DM Permissions ───────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Direct Message Permissions</Text>
          <Text style={styles.sectionDesc}>
            Choose who can send you direct messages.
          </Text>
          <View style={styles.dmOptions}>
            {DM_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.dmOptionCard,
                  privacy.dmPermission === opt.value && styles.dmOptionCardActive,
                ]}
                onPress={() =>
                  setPrivacy(prev => ({ ...prev, dmPermission: opt.value }))
                }
              >
                <View style={styles.dmRadioOuter}>
                  <View
                    style={[
                      styles.dmRadioInner,
                      privacy.dmPermission === opt.value && styles.dmRadioInnerActive,
                    ]}
                  />
                </View>
                <Text
                  style={[
                    styles.dmOptionText,
                    privacy.dmPermission === opt.value && styles.dmOptionTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.separator} />

        {/* ── Search Visibility ────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Search Visibility</Text>
          <Text style={styles.sectionDesc}>
            Allow your profile to appear in search results and suggestions.
          </Text>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Visible in search</Text>
            <TouchableOpacity
              style={[
                styles.toggleTrack,
                privacy.searchVisible && styles.toggleTrackOn,
              ]}
              onPress={() => toggleSwitch('searchVisible')}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.toggleThumb,
                  privacy.searchVisible && styles.toggleThumbOn,
                ]}
              />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.separator} />

        {/* ── Account Lock ─────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account Lock</Text>
          <View style={styles.warningBox}>
            <Ionicons name="warning" size={16} color={colors.accentGold} />
            <Text style={styles.warningText}>
              Locking your account will hide your posts from people who don't
              follow you. Only approved followers will see your content.
            </Text>
          </View>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Lock account</Text>
            <TouchableOpacity
              style={[
                styles.toggleTrack,
                privacy.accountLocked && styles.toggleTrackOn,
              ]}
              onPress={() => toggleSwitch('accountLocked')}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.toggleThumb,
                  privacy.accountLocked && styles.toggleThumbOn,
                ]}
              />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Styles ────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  saveText: { color: colors.accent, fontWeight: '600', fontSize: 15 },
  section: { paddingHorizontal: 16, paddingVertical: 18 },
  sectionLabel: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  sectionDesc: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  toggleLabel: { color: colors.text, fontSize: 15 },
  toggleTrack: {
    width: 50,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.border,
    padding: 2,
  },
  toggleTrackOn: {
    backgroundColor: colors.accent,
  },
  toggleThumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#fff',
  },
  toggleThumbOn: {
    transform: [{ translateX: 20 }],
  },
  separator: { height: 0.5, backgroundColor: colors.border },
  dmOptions: { gap: 10, marginTop: 4 },
  dmOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  dmOptionCardActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(29,155,240,0.08)',
  },
  dmRadioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dmRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'transparent',
  },
  dmRadioInnerActive: {
    backgroundColor: colors.accent,
  },
  dmOptionText: { color: colors.text, fontSize: 15 },
  dmOptionTextActive: { color: colors.accent, fontWeight: '600' },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(255,215,0,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  warningText: {
    flex: 1,
    color: colors.accentGold,
    fontSize: 13,
    lineHeight: 19,
  },
});
