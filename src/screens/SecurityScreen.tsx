import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, StatusBar,
  Alert, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { auth, getValidToken } from '../lib/firebase';
import { AppIcon } from '../components/icons';

export default function SecurityScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAppStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [loading, setLoading] = useState(false);

  const currentUser = auth().currentUser;

  const handleChangePassword = async () => {
    if (!current || !next || !confirm) { Alert.alert('All fields required'); return; }
    if (next !== confirm) { Alert.alert('Passwords do not match'); return; }
    if (next.length < 8) { Alert.alert('Password must be at least 8 characters'); return; }

    const email = currentUser?.email;
    if (!email) {
      Alert.alert('Error', 'No email associated with this account.');
      return;
    }

    setLoading(true);
    try {
      // Step 1: Reauthenticate via Identity Toolkit signInWithPassword
      const apiKey = Constants.expoConfig?.extra?.firebaseApiKey as string || '';
      const signInResp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: current, returnSecureToken: true }),
        },
      );
      const signInData = await signInResp.json();
      if (!signInResp.ok) {
        const errMsg = signInData.error?.message || 'Authentication failed';
        if (errMsg.includes('INVALID_PASSWORD') || errMsg.includes('wrong password')) {
          Alert.alert('Incorrect Password', 'Current password is wrong.');
        } else {
          Alert.alert('Error', errMsg);
        }
        return;
      }

      // Step 2: Update password via Identity Toolkit accounts:update
      const idToken = signInData.idToken;
      const updateResp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken, password: next, returnSecureToken: true }),
        },
      );
      const updateData = await updateResp.json();
      if (!updateResp.ok) {
        Alert.alert('Error', updateData.error?.message || 'Could not update password.');
        return;
      }

      setCurrent(''); setNext(''); setConfirm('');
      Alert.alert('Password Changed', 'Your password has been updated successfully.');
    } catch {
      Alert.alert('Error', 'Could not update password. Try again.');
    } finally { setLoading(false); }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This permanently deletes your account, posts, and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => navigation.navigate('Settings' as any) },
      ],
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <AppIcon name="arrow-back" size="lg" color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Security</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <View style={styles.emailRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{user?.email || currentUser?.email}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <AppIcon name="check-circle" size="sm" color={colors.accentGreen} />
                  <Text style={[styles.rowSub, { color: colors.accentGreen }]}>
                    Google Sign-In
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Change Password</Text>
          <View style={styles.card}>
            <View style={styles.inputWrapper}>
              <TextInput style={styles.input} value={current} onChangeText={setCurrent} placeholder="Current password" placeholderTextColor={colors.textMuted} secureTextEntry={!showCurrent} />
              <TouchableOpacity onPress={() => setShowCurrent(p => !p)} hitSlop={8}>
                <AppIcon name={showCurrent ? 'visibility-off' : 'visibility'} size="md" color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={[styles.inputWrapper, { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <TextInput style={styles.input} value={next} onChangeText={setNext} placeholder="New password (min 8 chars)" placeholderTextColor={colors.textMuted} secureTextEntry={!showNext} />
              <TouchableOpacity onPress={() => setShowNext(p => !p)} hitSlop={8}>
                <AppIcon name={showNext ? 'visibility-off' : 'visibility'} size="md" color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={[styles.inputWrapper, { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <TextInput style={styles.input} value={confirm} onChangeText={setConfirm} placeholder="Confirm new password" placeholderTextColor={colors.textMuted} secureTextEntry />
            </View>
            <TouchableOpacity
              style={[styles.saveBtn, (!current || !next || !confirm) && { opacity: 0.4 }]}
              onPress={handleChangePassword}
              disabled={loading || !current || !next || !confirm}
            >
              {loading ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Update Password</Text>}
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionTitle}>Danger Zone</Text>
          <View style={styles.card}>
            <TouchableOpacity style={[styles.dangerRow, { borderBottomWidth: 0 }]} onPress={handleDeleteAccount}>
              <AppIcon name="delete-outline" size="md" color={colors.accentRed} />
              <Text style={styles.dangerText}>Delete Account</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
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
    color: colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, marginHorizontal: 16, marginTop: 20, marginBottom: 8,
  },
  card: { marginHorizontal: 16, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  emailRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  rowLabel: { fontSize: 15, color: colors.text, fontWeight: '500' },
  rowSub: { fontSize: 12, color: colors.textMuted },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 4 },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 12 },
  saveBtn: { margin: 12, backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  saveBtnText: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
  dangerText: { fontSize: 15, color: colors.accentRed, fontWeight: '600' },
});
