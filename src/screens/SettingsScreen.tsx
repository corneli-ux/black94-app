import React from 'react';
import { View, Text, TouchableOpacity, Image, ScrollView, StyleSheet, StatusBar, TextInput, Linking, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { signOutUser as signOut } from '../lib/api';
import { firestore, auth } from '../lib/firebase';
import { Avatar } from '../components/Avatar';

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
            await signOut();
            setUser(null);
            useAppStore.getState().setToken(null);
          } catch (err) {
            console.error('Logout failed:', err);
          }
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'android' ? 'height' : 'padding'}
    >
      <SafeAreaView style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { try { navigation.goBack(); } catch { navigation.navigate('Profile'); } }}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving}>
          <Text style={[styles.saveText, saving && { opacity: 0.5 }]}>
            {saving ? 'Saving...' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Image */}
        <View style={styles.profileSection}>
          <Avatar uri={user?.profileImage} size={80} borderWidth={3} borderColor={colors.bg} />
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
        </View>

        {/* Quick Links */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <SettingsLink icon="lock-closed" label="Privacy Settings" onPress={() => navigation.navigate('PrivacySettings' as never)} />
            <SettingsLink icon="share-social" label="Share Profile" onPress={() => navigation.navigate('ShareProfile' as never)} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Business</Text>
          <View style={styles.card}>
            <SettingsLink icon="storefront" label="My Store" onPress={() => navigation.navigate('MyStore' as never)} />
            <SettingsLink icon="newspaper" label="Write Article" onPress={() => navigation.navigate('WriteArticle' as never)} />
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
            <Ionicons name="log-out-outline" size={18} color={colors.error} />
            <Text style={styles.logoutText}>Log Out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => Linking.openURL('https://black94.web.app/privacy-policy.html')}>
            <Text style={styles.legalText}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={styles.legalDot}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://black94.web.app/terms-of-service.html')}>
            <Text style={styles.legalText}>Terms of Service</Text>
          </TouchableOpacity>
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
  saveText: { color: colors.accent, fontWeight: '600', fontSize: 15 },
  profileSection: { alignItems: 'center', paddingVertical: 20 },
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
    backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)',
    marginBottom: 40,
  },
  logoutText: { color: colors.error, fontSize: 15, fontWeight: '600' },
  legalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, gap: 12,
  },
  legalText: { color: colors.textMuted, fontSize: 12 },
  legalDot: { color: colors.textMuted, fontSize: 12 },
});
