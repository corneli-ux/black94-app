import React from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, StyleSheet, StatusBar, TextInput, Linking, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { signOutUser } from '../lib/api';
import { firestore } from '../lib/firebase';
import { Avatar } from '../components/Avatar';
import { PLANS, formatAmount } from '../lib/payments';

const GOLD = '#D4AF37';

export default function SettingsScreen() {
  const navigation = useNavigation() as any;
  const { user, setUser } = useAppStore();
  const [displayName, setDisplayName] = React.useState(user?.displayName || '');
  const [bio, setBio] = React.useState(user?.bio || '');
  const [saving, setSaving] = React.useState(false);

  // Sync form fields when user store updates (handles async hydration)
  React.useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      setBio(user.bio || '');
    }
  }, [user]);

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      await firestore().collection('users').doc(user.id).update({
        displayName: displayName.trim(),
        bio: bio.trim(),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      setUser({ ...user, displayName: displayName.trim(), bio: bio.trim() });
      Alert.alert('Saved', 'Profile updated successfully');
    } catch (err) {
      Alert.alert('Error', 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOutUser();
          } catch (err) {
            console.warn('[Settings] signOutUser error:', err);
          }
          useAppStore.getState().logout();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <SafeAreaView style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { try { navigation.goBack(); } catch { navigation.navigate('ProfileSelf'); } }}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <TouchableOpacity onPress={() => navigation.navigate('PremiumDashboard' as never)} hitSlop={8}>
          <Ionicons name="diamond" size={22} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Profile Image */}
        <View style={styles.profileSection}>
          <Avatar uri={user?.profileImage} name={user?.displayName} size={80} borderWidth={3} borderColor={colors.bg} />
        </View>

        {/* Edit Fields */}
        <View style={styles.formSection}>
          <Text style={styles.label}>Display Name</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, styles.bioInput]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell us about yourself"
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={3}
          />

          <TouchableOpacity style={styles.infoRow} onPress={() => navigation.navigate('EditProfile' as never)}>
            <Text style={styles.infoLabel}>Username</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.infoValue}>@{user?.username}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
            </View>
          </TouchableOpacity>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{user?.email}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Account Type</Text>
            <Text style={styles.infoValue}>{user?.role || 'Personal'}</Text>
          </View>

          {/* Save button moved here from header */}
          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
            <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
            <Text style={[styles.saveBtnText, saving && { opacity: 0.5 }]}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Upgrade Section */}
        <View style={styles.section}>
          <View style={styles.upgradeHeader}>
            <Ionicons name="diamond" size={18} color={colors.accent} />
            <Text style={styles.sectionTitle}>Upgrade</Text>
          </View>
          <View style={styles.upgradeCard}>
            <View style={styles.upgradeCardTop}>
              <View style={styles.upgradeIconWrap}>
                <Ionicons name="diamond" size={28} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.upgradeTitle}>Go Premium</Text>
                <Text style={styles.upgradeSubtitle}>Unlock unlimited features</Text>
              </View>
            </View>
            {PLANS.map((plan, idx) => (
              <TouchableOpacity
                key={plan.id}
                style={[styles.planRow, idx === PLANS.length - 1 && { borderBottomWidth: 0 }]}
                onPress={() => navigation.navigate('PremiumDashboard' as never)}
              >
                <View style={styles.planInfo}>
                  <Text style={styles.planName}>{plan.name}</Text>
                  <Text style={styles.planFeatures}>
                    {plan.features.slice(0, 3).join(' · ')}
                  </Text>
                </View>
                <View style={styles.planPriceWrap}>
                  <Text style={styles.planPrice}>{formatAmount(plan.amount)}</Text>
                  <Text style={styles.planDuration}>/{plan.duration}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Quick Links */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <SettingsLink icon="lock-closed" label="Privacy Settings" onPress={() => navigation.navigate('PrivacySettings' as never)} />
            <SettingsLink icon="share-social" label="Share Profile" onPress={() => navigation.navigate('ShareProfile' as never)} />
          </View>
        </View>

        {user?.role === 'business' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Business</Text>
          <View style={styles.card}>
            <SettingsLink icon="storefront" label="My Store" onPress={() => navigation.navigate('MyStore' as never)} />
            <SettingsLink icon="newspaper" label="Write Article" onPress={() => navigation.navigate('WriteArticle' as never)} />
          </View>
        </View>
        )}

        {/* Legal — moved from drawer to settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Legal</Text>
          <View style={styles.card}>
            <SettingsLink icon="shield-checkmark" label="Privacy Policy" onPress={() => navigation.navigate('PrivacyPolicy' as never)} />
            <SettingsLink icon="document-text" label="Terms & Conditions" onPress={() => navigation.navigate('Terms' as never)} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tools</Text>
          <View style={styles.card}>
            <SettingsLink icon="bar-chart" label="Business Dashboard" onPress={() => navigation.navigate('BusinessDashboard' as never)} />
            <SettingsLink icon="megaphone" label="Ads Manager" onPress={() => navigation.navigate('AdsManager' as never)} />
          </View>
        </View>

        {/* Logout */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={18} color="#D4AF37" />
            <Text style={styles.logoutText}>Log Out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.legalRow}>
          <Text style={styles.legalText}>Black94 v1.8.3</Text>
        </View>
      </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function SettingsLink({ icon, label, onPress }: { icon: string; label: string; onPress?: () => void }) {
  return (
    <TouchableOpacity style={styles.linkItem} onPress={onPress} disabled={!onPress}>
      <Ionicons name={icon as any} size={18} color={colors.textSecondary} />
      <Text style={styles.linkText}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 20, paddingVertical: 12, borderRadius: 12,
    backgroundColor: 'rgba(212,175,55,0.1)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
  },
  saveBtnText: { color: '#D4AF37', fontWeight: '600', fontSize: 15 },
  profileSection: { alignItems: 'center', paddingVertical: 20 },
  upgradeHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  upgradeCard: {
    backgroundColor: colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(212,175,55,0.3)', overflow: 'hidden',
  },
  upgradeCardTop: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  upgradeIconWrap: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: 'rgba(212,175,55,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  upgradeTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  upgradeSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  planRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  planInfo: { flex: 1, marginRight: 12 },
  planName: { fontSize: 15, fontWeight: '600', color: colors.text },
  planFeatures: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  planPriceWrap: { flexDirection: 'row', alignItems: 'baseline' },
  planPrice: { fontSize: 17, fontWeight: '700', color: '#D4AF37' },
  planDuration: { fontSize: 12, color: colors.textMuted },
  formSection: { paddingHorizontal: 16, marginTop: 8 },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontSize: 15, borderWidth: 1, borderColor: colors.border,
  },
  bioInput: { minHeight: 80, textAlignVertical: 'top' },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  infoLabel: { color: colors.textSecondary, fontSize: 14 },
  infoValue: { color: colors.text, fontSize: 14 },
  section: { paddingHorizontal: 16, marginTop: 8 },
  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 8 },
  card: {
    backgroundColor: colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  linkItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  linkText: { flex: 1, color: colors.text, fontSize: 15 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 16,
    backgroundColor: 'rgba(212,175,55,0.1)', borderWidth: 1, borderColor: 'rgba(212,175,55,0.25)',
    marginBottom: 40,
  },
  logoutText: { color: '#D4AF37', fontSize: 15, fontWeight: '600' },
  legalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, gap: 12,
  },
  legalText: { color: colors.textMuted, fontSize: 12 },
  legalDot: { color: colors.textMuted, fontSize: 12 },
});
