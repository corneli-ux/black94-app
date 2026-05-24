import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { colors } from '../theme/colors';
import { auth, firestore, getValidToken } from '../lib/firebase';
import { AppIcon } from '../components/icons';

const API_KEY = Constants.expoConfig?.extra?.firebaseApiKey as string || '';

export default function ChangePasswordScreen() {
  const navigation = useNavigation<any>();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const validate = (): string | null => {
    if (!currentPassword) return 'Current password is required.';
    if (!newPassword) return 'New password is required.';
    if (newPassword.length < 8) return 'Password must be at least 8 characters.';
    if (!confirmPassword) return 'Please confirm your new password.';
    if (newPassword !== confirmPassword) return 'Passwords do not match.';
    if (currentPassword === newPassword) return 'New password must be different from current password.';
    return null;
  };

  const handleSubmit = async () => {
    const error = validate();
    if (error) {
      Alert.alert('Validation Error', error);
      return;
    }

    setLoading(true);
    try {
      const idToken = await getValidToken();
      const resp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken,
            password: newPassword,
            returnSecureToken: true,
          }),
        },
      );

      const data = await resp.json();

      if (!resp.ok) {
        const errMsg = data.error?.message || 'Unknown error';
        if (errMsg.includes('WEAK_PASSWORD')) {
          Alert.alert('Weak Password', 'Your new password is too weak or commonly used. Choose a stronger one.');
        } else if (errMsg.includes('CREDENTIAL_TOO_OLD')) {
          Alert.alert('Re-login Required', 'Your session is too old. Please sign out and sign in again before changing your password.');
        } else if (errMsg.includes('INVALID_ID_TOKEN') || errMsg.includes('USER_NOT_FOUND')) {
          Alert.alert('Session Expired', 'Please sign out and sign in again.');
        } else {
          Alert.alert('Error', errMsg);
        }
      } else {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        Alert.alert('Password Changed', 'Your password has been updated successfully.');
        navigation.goBack();
      }
    } catch (e: any) {
      console.error('[ChangePassword] Failed:', e?.message);
      Alert.alert('Error', 'Could not update password. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const error = validate();
  const canSubmit = !error && !loading;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <AppIcon name="arrow-back" size="lg" color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Change Password</Text>
          <View style={{ width: 22 }} />
        </View>

        <View style={styles.body}>
          {/* Current Password */}
          <Text style={styles.inputLabel}>Current password</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Enter current password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showCurrent}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={() => setShowCurrent(p => !p)} hitSlop={8}>
              <AppIcon name={showCurrent ? 'visibility-off' : 'visibility'} size="md" color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* New Password */}
          <Text style={styles.inputLabel}>New password</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Min. 8 characters"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showNew}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={() => setShowNew(p => !p)} hitSlop={8}>
              <AppIcon name={showNew ? 'visibility-off' : 'visibility'} size="md" color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Confirm New Password */}
          <Text style={styles.inputLabel}>Confirm new password</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter new password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity onPress={() => setShowConfirm(p => !p)} hitSlop={8}>
              <AppIcon name={showConfirm ? 'visibility-off' : 'visibility'} size="md" color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Validation messages */}
          {newPassword.length > 0 && newPassword.length < 8 && (
            <Text style={styles.errorText}>Password must be at least 8 characters</Text>
          )}
          {confirmPassword.length > 0 && newPassword !== confirmPassword && (
            <Text style={styles.errorText}>Passwords do not match</Text>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, !canSubmit && { opacity: 0.4 }]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {loading
              ? <ActivityIndicator color={colors.bg} />
              : <Text style={styles.submitBtnText}>Change Password</Text>}
          </TouchableOpacity>

          <View style={styles.infoBox}>
            <AppIcon name="info-outline" size={16} color={colors.textMuted} />
            <Text style={styles.infoText}>
              Your password must be at least 8 characters long. For best security, use a mix of uppercase letters, lowercase letters, numbers, and symbols. You'll be signed out on all other devices after changing your password.
            </Text>
          </View>
        </View>
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
  body: { padding: 20 },
  inputLabel: {
    color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 4, marginBottom: 20,
  },
  input: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 10 },
  errorText: { color: colors.accentRed, fontSize: 13, marginTop: -12, marginBottom: 12 },
  submitBtn: {
    marginTop: 8, backgroundColor: colors.accent, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  submitBtnText: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  infoBox: {
    flexDirection: 'row', gap: 10, marginTop: 24,
    backgroundColor: colors.bgSubtle,
    borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border,
  },
  infoText: { flex: 1, color: colors.textMuted, fontSize: 13, lineHeight: 19 },
});
