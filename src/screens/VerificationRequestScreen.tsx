import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, StatusBar,
  Alert, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAppStore } from '../stores/app';
import { firestore } from '../lib/firebase';
import { AppIcon } from '../components/icons';

type VerificationStatus = 'none' | 'pending' | 'approved' | 'rejected';
type Category = 'Creator' | 'Business' | 'Public Figure' | 'Organization';

const CATEGORIES: Category[] = ['Creator', 'Business', 'Public Figure', 'Organization'];

const CATEGORY_ICONS: Record<Category, string> = {
  Creator: 'videocam-outline',
  Business: 'briefcase-outline',
  'Public Figure': 'star-outline',
  Organization: 'people-outline',
};

const STATUS_DISPLAY: Record<VerificationStatus, { label: string; icon: string; color: string; message: string }> = {
  none:      { label: '',          icon: '',                   color: '',                   message: '' },
  pending:   { label: 'Pending',   icon: 'time-outline',       color: colors.accentGold,     message: 'Your verification request is under review. We\'ll notify you once a decision has been made.' },
  approved:  { label: 'Approved',  icon: 'checkmark-circle',   color: colors.accentGreen,    message: 'Your account has been verified. You\'ll see the verified badge on your profile.' },
  rejected:  { label: 'Rejected',  icon: 'close-circle',       color: colors.accentRed,      message: 'Your verification request was not approved. You may submit a new request after reviewing the guidelines.' },
};

export default function VerificationRequestScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [existingRequest, setExistingRequest] = useState<any>(null);
  const [status, setStatus] = useState<VerificationStatus>('none');

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState<Category>('Creator');

  // Populate display name from user profile
  useEffect(() => {
    if (user?.displayName) {
      setDisplayName(user.displayName);
    }
  }, [user?.displayName]);

  // Listen for existing verification request
  useEffect(() => {
    if (!user?.id) return;

    const unsub = firestore()
      .collection('verification_requests')
      .where('userId', '==', user.id)
      .orderBy('requestedAt', 'desc')
      .limit(1)
      .onSnapshot((snap) => {
        if (snap.empty) {
          setStatus('none');
          setExistingRequest(null);
        } else {
          const doc = snap.docs[0];
          const data = doc.data();
          setExistingRequest({ id: doc.id, ...data });
          setStatus(data.status || 'pending');
        }
        setLoading(false);
      }, () => setLoading(false));

    return () => unsub();
  }, [user?.id]);

  const handleSubmit = async () => {
    if (!user?.id) return;
    const trimmedName = displayName.trim();
    const trimmedReason = reason.trim();

    if (!trimmedName) { Alert.alert('Display name is required'); return; }
    if (!trimmedReason) { Alert.alert('Please provide a reason for verification'); return; }
    if (trimmedReason.length < 20) {
      Alert.alert('Reason Too Short', 'Please provide at least 20 characters explaining why you should be verified.');
      return;
    }

    Alert.alert(
      'Submit Verification Request',
      `Category: ${category}\nDisplay name: ${trimmedName}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: async () => {
            setSubmitting(true);
            try {
              await firestore().collection('verification_requests').add({
                userId: user.id,
                displayName: trimmedName,
                reason: trimmedReason,
                category,
                status: 'pending',
                requestedAt: firestore.FieldValue.serverTimestamp(),
              });
            } catch {
              Alert.alert('Error', 'Could not submit verification request. Please try again.');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  // Already verified user
  if (user?.isVerified) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <AppIcon name="arrow-back" size="lg" color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Verification</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.verifiedContainer}>
          <View style={styles.verifiedBadge}>
            <AppIcon name="check-circle" size="hero" color={colors.verified} />
          </View>
          <Text style={styles.verifiedTitle}>You Are Verified</Text>
          <Text style={styles.verifiedSub}>
            Your account already has the verified badge. It will appear next to your display name across Black94.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <AppIcon name="arrow-back" size="lg" color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Verification</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  // Show status card for existing requests (pending, approved, rejected)
  const hasActiveRequest = status === 'pending' || status === 'approved';

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <AppIcon name="arrow-back" size="lg" color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Request Verification</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Info section */}
          <Text style={styles.sectionTitle}>About Verification</Text>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <AppIcon name="ribbon-outline" size={20} color={colors.verified} />
              <Text style={styles.cardTitle}>Get Verified on Black94</Text>
            </View>
            <Text style={styles.cardDescription}>
              The verified badge confirms that an account is the authentic presence of a notable
              public figure, celebrity, brand, or organization. Verified accounts help people find
              the accounts they want to follow.
            </Text>
          </View>

          {/* Existing request status */}
          {status !== 'none' && (
            <>
              <Text style={styles.sectionTitle}>Request Status</Text>
              <View style={styles.card}>
                <View style={styles.statusRow}>
                  <AppIcon name={STATUS_DISPLAY[status].icon} size="lg" color={STATUS_DISPLAY[status].color} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.statusLabel, { color: STATUS_DISPLAY[status].color }]}>
                      {STATUS_DISPLAY[status].label}
                    </Text>
                    <Text style={styles.statusSub}>{STATUS_DISPLAY[status].message}</Text>
                    {existingRequest?.category && (
                      <Text style={styles.statusMeta}>Category: {existingRequest.category}</Text>
                    )}
                  </View>
                </View>

                {status === 'pending' && (
                  <ActivityIndicator size="small" color={colors.accentGold} style={{ marginTop: 8, marginLeft: 34 }} />
                )}
              </View>
            </>
          )}

          {/* Form — shown when no active request or after rejection */}
          {!hasActiveRequest && (
            <>
              <Text style={styles.sectionTitle}>Application</Text>
              <View style={styles.card}>
                {/* Display Name */}
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Display Name</Text>
                  <TextInput
                    style={styles.input}
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="Your display name"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="words"
                  />
                </View>

                {/* Category */}
                <View style={[styles.fieldGroup, { borderTopWidth: 1, borderTopColor: colors.border }]}>
                  <Text style={styles.fieldLabel}>Category</Text>
                  <View style={styles.categoryGrid}>
                    {CATEGORIES.map((cat) => {
                      const isSelected = category === cat;
                      return (
                        <TouchableOpacity
                          key={cat}
                          style={[styles.categoryChip, isSelected && styles.categoryChipSelected]}
                          onPress={() => setCategory(cat)}
                        >
                          <AppIcon
                            name={CATEGORY_ICONS[cat]}
                            size={16}
                            color={isSelected ? colors.bg : colors.textSecondary}
                          />
                          <Text style={[styles.categoryText, isSelected && styles.categoryTextSelected]}>
                            {cat}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* Reason */}
                <View style={[styles.fieldGroup, { borderTopWidth: 1, borderTopColor: colors.border, borderBottomWidth: 0 }]}>
                  <Text style={styles.fieldLabel}>Why should you be verified?</Text>
                  <Text style={styles.fieldHint}>
                    Explain why you qualify for verification. Include links to articles, profiles,
                    or other proof of notability. Minimum 20 characters.
                  </Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={reason}
                    onChangeText={setReason}
                    placeholder="I am a notable public figure because..."
                    placeholderTextColor={colors.textMuted}
                    multiline
                    numberOfLines={5}
                    textAlignVertical="top"
                    maxLength={1000}
                  />
                  <Text style={styles.charCount}>{reason.length}/1000</Text>
                </View>
              </View>

              {/* Submit button */}
              <TouchableOpacity
                style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                onPress={handleSubmit}
                disabled={submitting || !displayName.trim() || !reason.trim()}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.bg} />
                ) : (
                  <Text style={styles.submitBtnText}>Submit Request</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  card: {
    marginHorizontal: 16, backgroundColor: colors.surface,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  cardDescription: {
    fontSize: 13, color: colors.textSecondary, lineHeight: 20,
    paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16,
  },
  // Status
  statusRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  statusLabel: { fontSize: 15, fontWeight: '700' },
  statusSub: { fontSize: 13, color: colors.textSecondary, marginTop: 3, lineHeight: 18 },
  statusMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  // Verified state
  verifiedContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 32,
  },
  verifiedBadge: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(212,175,55,0.1)', borderWidth: 2,
    borderColor: colors.verified,
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  verifiedTitle: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 8 },
  verifiedSub: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  // Form fields
  fieldGroup: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
  fieldHint: { fontSize: 12, color: colors.textMuted, marginBottom: 8, lineHeight: 18 },
  input: {
    backgroundColor: colors.bgInput, color: colors.text, fontSize: 15,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  textArea: {
    minHeight: 120,
  },
  charCount: { fontSize: 11, color: colors.textMuted, textAlign: 'right', marginTop: 4 },
  // Category chips
  categoryGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bgInput,
  },
  categoryChipSelected: {
    backgroundColor: colors.accent, borderColor: colors.accent,
  },
  categoryText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  categoryTextSelected: { fontSize: 13, color: colors.bg, fontWeight: '600' },
  // Submit button
  submitBtn: {
    marginHorizontal: 16, marginTop: 20,
    backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center',
  },
  submitBtnText: { color: colors.bg, fontSize: 15, fontWeight: '700' },
});
