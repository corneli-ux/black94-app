import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { firestore } from '../lib/firebase';

export default function ChangeEmailScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAppStore();
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async () => {
    if (!newEmail.trim()) {
      Alert.alert('Missing Field', 'Please enter your new email address.');
      return;
    }
    if (!isValidEmail(newEmail.trim())) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    if (newEmail.trim().toLowerCase() === user?.email?.toLowerCase()) {
      Alert.alert('Same Email', 'Your new email must be different from your current one.');
      return;
    }
    if (newEmail.trim() !== confirmEmail.trim()) {
      Alert.alert('Email Mismatch', 'The email addresses do not match.');
      return;
    }

    setLoading(true);
    try {
      await firestore().collection('email_changes').add({
        userId: user?.id,
        newEmail: newEmail.trim().toLowerCase(),
        status: 'pending',
        requestedAt: firestore.FieldValue.serverTimestamp(),
      });
      Alert.alert(
        'Verification Sent',
        'A verification link has been sent to your new email address. Please check your inbox and click the link to confirm the change.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (e: any) {
      console.error('[ChangeEmail] Failed:', e?.message);
      Alert.alert('Error', 'Could not request email change. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = newEmail.trim() && confirmEmail.trim() &&
    newEmail.trim() === confirmEmail.trim() && isValidEmail(newEmail.trim()) && !loading;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Change Email</Text>
          <View style={{ width: 22 }} />
        </View>

        <View style={styles.body}>
          <Text style={styles.sectionLabel}>Current email</Text>
          <View style={styles.currentEmailBox}>
            <Ionicons name="mail-outline" size={18} color={colors.textMuted} />
            <Text style={styles.currentEmailText}>{user?.email || 'No email on file'}</Text>
          </View>

          <Text style={styles.inputLabel}>New email address</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              value={newEmail}
              onChangeText={setNewEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <Text style={styles.inputLabel}>Confirm new email</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              value={confirmEmail}
              onChangeText={setConfirmEmail}
              placeholder="Re-enter new email"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {confirmEmail.length > 0 && newEmail === confirmEmail && (
              <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} />
            )}
            {confirmEmail.length > 0 && newEmail !== confirmEmail && (
              <Ionicons name="close-circle" size={20} color={colors.accentRed} />
            )}
          </View>

          {newEmail.length > 0 && !isValidEmail(newEmail) && (
            <Text style={styles.errorText}>Please enter a valid email address</Text>
          )}
          {confirmEmail.length > 0 && newEmail !== confirmEmail && (
            <Text style={styles.errorText}>Email addresses do not match</Text>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, !canSubmit && { opacity: 0.4 }]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {loading
              ? <ActivityIndicator color={colors.bg} />
              : <Text style={styles.submitBtnText}>Change Email</Text>}
          </TouchableOpacity>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
            <Text style={styles.infoText}>
              A verification link will be sent to your new email address. You must click the link to confirm the change. Your current email will remain active until verification is complete.
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
  sectionLabel: {
    color: colors.textMuted, fontSize: 12, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
  },
  currentEmailBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 28,
  },
  currentEmailText: { color: colors.textSecondary, fontSize: 15 },
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
