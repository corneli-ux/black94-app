import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, StatusBar,
  Alert, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { auth } from '../lib/firebase';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, sendEmailVerification } from '@react-native-firebase/auth';

export default function SecurityScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAppStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);

  const isEmailProvider = auth().currentUser?.providerData?.some(p => p.providerId === 'password');
  const emailVerified = auth().currentUser?.emailVerified;

  const handleChangePassword = async () => {
    if (!current || !next || !confirm) { Alert.alert('All fields required'); return; }
    if (next !== confirm) { Alert.alert('Passwords do not match'); return; }
    if (next.length < 8) { Alert.alert('Password must be at least 8 characters'); return; }
    const cu = auth().currentUser;
    if (!cu?.email) return;
    setLoading(true);
    try {
      const cred = EmailAuthProvider.credential(cu.email, current);
      await reauthenticateWithCredential(cu, cred);
      await updatePassword(cu, next);
      setCurrent(''); setNext(''); setConfirm('');
      Alert.alert('Password Changed', 'Your password has been updated successfully.');
    } catch (e: any) {
      if (e.code === 'auth/wrong-password') Alert.alert('Incorrect Password', 'Current password is wrong.');
      else Alert.alert('Error', 'Could not update password. Try again.');
    } finally { setLoading(false); }
  };

  const handleSendVerification = async () => {
    const cu = auth().currentUser;
    if (!cu) return;
    setVerifyLoading(true);
    try {
      await sendEmailVerification(cu);
      Alert.alert('Verification Sent', `Check ${cu.email} for the verification link.`);
    } catch { Alert.alert('Error', 'Could not send verification email.'); }
    finally { setVerifyLoading(false); }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This permanently deletes your account, posts, and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => Alert.alert('Contact Support', 'To delete your account, contact support@black94.app') },
      ],
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Security</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>Email</Text>
          <View style={styles.card}>
            <View style={styles.emailRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{user?.email || auth().currentUser?.email}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Ionicons
                    name={emailVerified ? 'checkmark-circle' : 'alert-circle'}
                    size={14}
                    color={emailVerified ? colors.accentGreen : colors.accentOrange}
                  />
                  <Text style={[styles.rowSub, { color: emailVerified ? colors.accentGreen : colors.accentOrange }]}>
                    {emailVerified ? 'Verified' : 'Not verified'}
                  </Text>
                </View>
              </View>
              {!emailVerified && (
                <TouchableOpacity style={styles.verifyBtn} onPress={handleSendVerification} disabled={verifyLoading}>
                  {verifyLoading ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={styles.verifyText}>Verify</Text>}
                </TouchableOpacity>
              )}
            </View>
          </View>

          {isEmailProvider && (
            <>
              <Text style={styles.sectionTitle}>Change Password</Text>
              <View style={styles.card}>
                <View style={styles.inputWrapper}>
                  <TextInput style={styles.input} value={current} onChangeText={setCurrent} placeholder="Current password" placeholderTextColor={colors.textMuted} secureTextEntry={!showCurrent} />
                  <TouchableOpacity onPress={() => setShowCurrent(p => !p)} hitSlop={8}>
                    <Ionicons name={showCurrent ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
                <View style={[styles.inputWrapper, { borderTopWidth: 1, borderTopColor: colors.border }]}>
                  <TextInput style={styles.input} value={next} onChangeText={setNext} placeholder="New password (min 8 chars)" placeholderTextColor={colors.textMuted} secureTextEntry={!showNext} />
                  <TouchableOpacity onPress={() => setShowNext(p => !p)} hitSlop={8}>
                    <Ionicons name={showNext ? 'eye-off' : 'eye'} size={18} color={colors.textMuted} />
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
            </>
          )}

          <Text style={styles.sectionTitle}>Danger Zone</Text>
          <View style={styles.card}>
            <TouchableOpacity style={[styles.dangerRow, { borderBottomWidth: 0 }]} onPress={handleDeleteAccount}>
              <Ionicons name="trash-outline" size={18} color={colors.accentRed} />
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
  verifyBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: colors.accent },
  verifyText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 4 },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 12 },
  saveBtn: { margin: 12, backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  saveBtnText: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
  dangerText: { fontSize: 15, color: colors.accentRed, fontWeight: '600' },
});
