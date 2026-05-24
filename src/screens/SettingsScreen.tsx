import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, StatusBar, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { signOutUser } from '../lib/api';
import { auth, updateAuthUser, firestore } from '../lib/firebase';
import { deleteAccountServer } from '../lib/cloudFunctions';
import { Avatar } from '../components/Avatar';
import { PLANS, formatAmount } from '../lib/payments';

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
        displayNameLower: displayName.trim().toLowerCase(),
        bio: bio.trim(),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      const updatedUser = { ...user, displayName: displayName.trim(), bio: bio.trim() };
      setUser(updatedUser);
      // BUG FIX: Sync Firebase auth user object with new displayName.
      // Without this, auth().currentUser.displayName stays stale after
      // editing in Settings (only EditProfile had this fix before).
      try {
        updateAuthUser({ displayName: displayName.trim() }).catch(() => {});
      } catch {}
      // BUG FIX: Persist updated profile to cache for self-heal recovery
      try {
        await AsyncStorage.setItem('@black94/user_cache', JSON.stringify(updatedUser));
      } catch {}
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

  const [deleting, setDeleting] = React.useState(false);

  const handleDeleteAccount = async () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account, all your posts, comments, messages, and profile data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              // Delete account server-side (Auth user + all Firestore data)
              await deleteAccountServer();

              // Sign out and clear local state
              await signOutUser().catch(() => {});
              useAppStore.getState().logout();
              await AsyncStorage.clear().catch(() => {});
            } catch (err) {
              console.error('[Settings] Delete account error:', err);
              Alert.alert('Error', 'Failed to delete account. Please try again.');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <SafeAreaView style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { try { navigation.goBack(); } catch { navigation.navigate('ProfileSelf'); } }} hitSlop={8}>
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
            <SettingsLink icon="lock-closed-outline" label="Privacy Settings" onPress={() => navigation.navigate('PrivacySettings' as never)} />
            <SettingsLink icon="notifications-outline" label="Notification Settings" onPress={() => navigation.navigate('NotificationSettings' as never)} />
            <SettingsLink icon="sunny-outline" label="Appearance" onPress={() => navigation.navigate('Appearance' as never)} />
            <SettingsLink icon="at-outline" label="Change Username" onPress={() => navigation.navigate('ChangeUsername' as never)} />
            <SettingsLink icon="shield-checkmark-outline" label="Security" onPress={() => navigation.navigate('Security' as never)} />
            <SettingsLink icon="mail-outline" label="Change Email" onPress={() => navigation.navigate('ChangeEmail' as never)} />
            <SettingsLink icon="key-outline" label="Change Password" onPress={() => navigation.navigate('ChangePassword' as never)} />
            <SettingsLink icon="share-social-outline" label="Share Profile" onPress={() => navigation.navigate('ShareProfile' as never)} />
          </View>
        </View>

        {/* Privacy & Moderation */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy & Moderation</Text>
          <View style={styles.card}>
            <SettingsLink icon="ban-outline" label="Blocked Accounts" onPress={() => navigation.navigate('BlockedUsers' as never)} />
            <SettingsLink icon="volume-mute-outline" label="Muted Accounts" onPress={() => navigation.navigate('MutedUsers' as never)} />
            <SettingsLink icon="eye-off-outline" label="Muted Words" onPress={() => navigation.navigate('MutedWords' as never)} />
          </View>
        </View>

        {/* Account Management */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Management</Text>
          <View style={styles.card}>
            <SettingsLink icon="link-outline" label="Linked Accounts" onPress={() => navigation.navigate('LinkedAccounts' as never)} />
            <SettingsLink icon="phone-portrait-outline" label="Active Sessions" onPress={() => navigation.navigate('Sessions' as never)} />
            <SettingsLink icon="download-outline" label="Export My Data" onPress={() => navigation.navigate('DataExport' as never)} />
            <SettingsLink icon="checkmark-done-outline" label="Request Verification" onPress={() => navigation.navigate('VerificationRequest' as never)} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Content</Text>
          <View style={styles.card}>
            <SettingsLink icon="newspaper-outline" label="Write Article" onPress={() => navigation.navigate('WriteArticle' as never)} />
            <SettingsLink icon="bookmark-outline" label="Bookmarks" onPress={() => navigation.navigate('Bookmarks' as never)} />
          </View>
        </View>

        {/* Legal — moved from drawer to settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Legal</Text>
          <View style={styles.card}>
            <SettingsLink icon="shield-checkmark-outline" label="Privacy Policy" onPress={() => navigation.navigate('PrivacyPolicy' as never)} />
            <SettingsLink icon="document-text-outline" label="Terms & Conditions" onPress={() => navigation.navigate('Terms' as never)} />
          </View>
        </View>



        {/* Logout */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={18} color={colors.accent} />
            <Text style={styles.logoutText}>Log Out</Text>
          </TouchableOpacity>
        </View>

        {/* Delete Account */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.deleteAccountBtn]}
            onPress={handleDeleteAccount}
            disabled={deleting}
          >
            {deleting ? (
              <Text style={styles.deleteAccountText}>Deleting...</Text>
            ) : (
              <>
                <Ionicons name="trash-outline" size={18} color={colors.like} />
                <Text style={styles.deleteAccountText}>Delete Account</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.deleteAccountHint}>
            Permanently removes your profile, posts, stories, and messages.
          </Text>
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
    backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.accentBorderStrong,
  },
  saveBtnText: { color: colors.accent, fontWeight: '600', fontSize: 15 },
  profileSection: { alignItems: 'center', paddingVertical: 20 },
  upgradeHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  upgradeCard: {
    backgroundColor: colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: colors.accentBorderHeavy, overflow: 'hidden',
  },
  upgradeCardTop: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  upgradeIconWrap: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: colors.accentBg,
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
  planPrice: { fontSize: 17, fontWeight: '700', color: colors.accent },
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
  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 },
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
    backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.accentBorderStrong,
    marginBottom: 40,
  },
  logoutText: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  legalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, gap: 12,
  },
  legalText: { color: colors.textMuted, fontSize: 12 },
  deleteAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.destructiveFaint,
    borderWidth: 1,
    borderColor: colors.destructiveBorder,
  },
  deleteAccountText: { color: colors.like, fontSize: 15, fontWeight: '600' },
  deleteAccountHint: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 6 },
});
