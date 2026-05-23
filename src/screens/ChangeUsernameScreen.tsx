import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, StatusBar,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { firestore } from '../lib/firebase';

const USERNAME_REGEX = /^[a-z0-9_]{3,30}$/;
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export default function ChangeUsernameScreen() {
  const navigation = useNavigation<any>();
  const { user, setUser } = useAppStore();
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const validate = (v: string) => {
    if (!v) return 'Username is required';
    if (!USERNAME_REGEX.test(v)) return '3-30 chars, lowercase letters, numbers, underscores only';
    if (v === user?.username) return 'That is already your username';
    return null;
  };

  const checkAvailability = useCallback(async (v: string) => {
    const err = validate(v);
    if (err) { setAvailable(null); return; }
    setChecking(true);
    try {
      const snap = await firestore().collection('users').where('username', '==', v).limit(1).get();
      setAvailable(snap.empty);
    } catch {
      setAvailable(null);
    } finally {
      setChecking(false);
    }
  }, [user?.username]);

  const handleChange = (v: string) => {
    const lower = v.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setValue(lower);
    if (lower.length >= 3) checkAvailability(lower);
    else setAvailable(null);
  };

  const handleSave = async () => {
    if (!available || !user?.id) return;
    const lastChanged = await AsyncStorage.getItem(`@black94/username_changed_${user.id}`).catch(() => null);
    if (lastChanged) {
      const diff = Date.now() - Number(lastChanged);
      if (diff < COOLDOWN_MS) {
        const daysLeft = Math.ceil((COOLDOWN_MS - diff) / 86400000);
        Alert.alert('Cooldown Active', `You can change your username again in ${daysLeft} day(s).`);
        return;
      }
    }
    Alert.alert(
      'Change Username',
      `Change your username to @${value}? Posts with your old @${user.username} will still exist.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Change', onPress: async () => {
            setSaving(true);
            try {
              // Update user document
              await firestore().collection('users').doc(user.id).update({
                username: value,
                usernameLower: value,
                updatedAt: firestore.FieldValue.serverTimestamp(),
              });
              // Swap username claim: delete old, create new
              try { await firestore().collection('usernames').doc(user.username).get(); } catch {}
              await firestore().collection('usernames').doc(user.username).delete().catch(() => {});
              await firestore().collection('usernames').doc(value).set({ uid: user.id });
              const updated = { ...user, username: value };
              setUser(updated);
              await AsyncStorage.setItem(`@black94/username_changed_${user.id}`, String(Date.now()));
              await AsyncStorage.setItem('@black94/user_cache', JSON.stringify(updated)).catch(() => {});
              Alert.alert('Done', `Your username is now @${value}`);
              navigation.goBack();
            } catch {
              Alert.alert('Error', 'Could not change username. Please try again.');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const error = validate(value);
  const canSave = !error && available === true && !saving && !checking;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Change Username</Text>
          <TouchableOpacity onPress={handleSave} disabled={!canSave} hitSlop={8}>
            {saving
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Text style={[styles.saveText, !canSave && { opacity: 0.35 }]}>Save</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.currentLabel}>Current username</Text>
          <Text style={styles.currentValue}>@{user?.username}</Text>
          <Text style={styles.inputLabel}>New username</Text>
          <View style={styles.inputRow}>
            <Text style={styles.atSign}>@</Text>
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={handleChange}
              placeholder="new_username"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={30}
            />
            {checking && <ActivityIndicator size="small" color={colors.textMuted} style={{ marginLeft: 8 }} />}
            {!checking && available === true && <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} />}
            {!checking && available === false && <Ionicons name="close-circle" size={20} color={colors.accentRed} />}
          </View>
          {value.length > 0 && error && <Text style={styles.errorText}>{error}</Text>}
          {!checking && available === false && <Text style={styles.errorText}>That username is already taken</Text>}
          {!checking && available === true && <Text style={styles.availableText}>Available</Text>}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
            <Text style={styles.infoText}>You can change your username once every 30 days. Your old @handle will be released.</Text>
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
  saveText: { fontSize: 15, fontWeight: '700', color: colors.accent },
  body: { padding: 20 },
  currentLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginBottom: 4 },
  currentValue: { color: colors.text, fontSize: 16, fontWeight: '500', marginBottom: 24 },
  inputLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  atSign: { color: colors.textMuted, fontSize: 16, marginRight: 4 },
  input: { flex: 1, color: colors.text, fontSize: 16 },
  errorText: { color: colors.accentRed, fontSize: 13, marginTop: 8 },
  availableText: { color: colors.accentGreen, fontSize: 13, marginTop: 8, fontWeight: '600' },
  infoBox: {
    flexDirection: 'row', gap: 8, marginTop: 24,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border,
  },
  infoText: { flex: 1, color: colors.textMuted, fontSize: 13, lineHeight: 19 },
});
