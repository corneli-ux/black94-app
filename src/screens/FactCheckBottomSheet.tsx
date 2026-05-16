/**
 * FactCheckBottomSheet.tsx — Fact-Checking UI for posts
 *
 * Displays fact-check claims, verdict badges, allows users to submit
 * new claims and view verification status.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { fetchPostFactChecks, submitFactCheck, FactCheckClaim } from '../lib/api';

const VERDICT_CONFIG: Record<string, { color: string; icon: any; label: string }> = {
  pending: { color: '#94a3b8', icon: 'time-outline', label: 'Pending Review' },
  verified: { color: '#22c55e', icon: 'checkmark-circle', label: 'Verified' },
  debunked: { color: '#ef4444', icon: 'close-circle', label: 'Debunked' },
  misleading: { color: '#f97316', icon: 'alert-triangle', label: 'Misleading' },
};

interface FactCheckBottomSheetProps {
  postId: string;
  visible: boolean;
  onClose: () => void;
}

export default function FactCheckBottomSheet({ postId, visible, onClose }: FactCheckBottomSheetProps) {
  const [claims, setClaims] = useState<FactCheckClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [claimText, setClaimText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [selectedClaim, setSelectedClaim] = useState<FactCheckClaim | null>(null);

  useEffect(() => {
    if (visible && postId) {
      loadClaims();
    }
  }, [visible, postId]);

  const loadClaims = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPostFactChecks(postId);
      setClaims(data);
    } catch (e) {
      console.error('[FactCheck] Load error:', e);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  const handleSubmit = useCallback(async () => {
    if (!claimText.trim()) {
      Alert.alert('Missing Info', 'Please describe the claim you want to fact-check.');
      return;
    }

    setSubmitting(true);
    try {
      await submitFactCheck(postId, claimText.trim(), sourceUrl.trim(), sourceTitle.trim());
      setClaimText('');
      setSourceUrl('');
      setSourceTitle('');
      await loadClaims();
      Alert.alert('Submitted', 'Your fact-check claim has been submitted for review.');
    } catch (e: any) {
      Alert.alert('Fact Check', 'Could not submit claim. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [postId, claimText, sourceUrl, sourceTitle]);

  const verifiedCount = claims.filter(c => c.verdict === 'verified').length;
  const debunkedCount = claims.filter(c => c.verdict === 'debunked' || c.verdict === 'misleading').length;

  if (!visible) return null;

  const renderClaim = ({ item }: { item: FactCheckClaim }) => {
    const config = VERDICT_CONFIG[item.verdict] || VERDICT_CONFIG.pending;
    const isSelected = selectedClaim?.id === item.id;

    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.claimCard, isSelected && styles.claimCardSelected]}
        onPress={() => setSelectedClaim(isSelected ? null : item)}
        activeOpacity={0.7}
      >
        <View style={styles.claimHeader}>
          <View style={[styles.verdictBadge, { backgroundColor: config.color + '20' }]}>
            <Ionicons name={config.icon} size={14} color={config.color} />
            <Text style={[styles.verdictText, { color: config.color }]}>{config.label}</Text>
          </View>
          {item.confidenceScore > 0 && (
            <Text style={styles.confidenceText}>
              {item.confidenceScore}% confidence
            </Text>
          )}
        </View>
        <Text style={styles.claimText}>{item.text}</Text>
        {item.sourceUrl ? (
          <Text style={styles.sourceText} numberOfLines={1}>
            Source: {item.sourceTitle || item.sourceUrl}
          </Text>
        ) : null}
        {item.sourceTitle && (
          <Text style={styles.sourceTitleText}>{item.sourceTitle}</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Ionicons name={'shield-checkmark' as any} size={20} color={colors.accent} />
              <Text style={styles.headerTitle}>Fact-Check</Text>
            </View>
            <View style={{ width: 24 }} />
          </View>

          {/* Summary */}
          <View style={styles.summaryRow}>
            <View style={[styles.summaryChip, { backgroundColor: '#22c55e20' }]}>
              <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
              <Text style={[styles.summaryText, { color: '#22c55e' }]}>{verifiedCount} Verified</Text>
            </View>
            <View style={[styles.summaryChip, { backgroundColor: '#ef444420' }]}>
              <Ionicons name="alert-circle" size={14} color="#ef4444" />
              <Text style={[styles.summaryText, { color: '#ef4444' }]}>{debunkedCount} Flagged</Text>
            </View>
            <Text style={styles.totalText}>{claims.length} total claims</Text>
          </View>

          {/* Claims list */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={styles.loadingText}>Loading fact-checks...</Text>
            </View>
          ) : claims.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="shield-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No Fact-Checks Yet</Text>
              <Text style={styles.emptySubtitle}>
                Be the first to fact-check claims in this post.
                Tap the button below to submit a claim.
              </Text>
            </View>
          ) : (
            <FlatList
              data={claims}
              keyExtractor={(item) => item.id}
              renderItem={renderClaim}
              contentContainerStyle={styles.claimsList}
              showsVerticalScrollIndicator={false}
            />
          )}

          {/* Submit form */}
          <View style={styles.formSection}>
            <Text style={styles.formLabel}>Submit a Fact-Check Claim</Text>
            <TextInput
              style={styles.claimInput}
              value={claimText}
              onChangeText={setClaimText}
              placeholder="Describe the claim to fact-check..."
              placeholderTextColor="#71767b"
              multiline
              maxLength={500}
              textAlignVertical="top"
            />
            <View style={styles.sourceRow}>
              <TextInput
                style={[styles.sourceInput, { flex: 1 }]}
                value={sourceUrl}
                onChangeText={setSourceUrl}
                placeholder="Source URL (optional)"
                placeholderTextColor="#71767b"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </View>
            <TextInput
              style={styles.sourceInput}
              value={sourceTitle}
              onChangeText={setSourceTitle}
              placeholder="Source title (optional)"
              placeholderTextColor="#71767b"
            />
            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
              activeOpacity={0.8}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Ionicons name="flag-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.submitBtnText}>Submit Claim</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={{ height: 20 }} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  summaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  summaryText: {
    fontSize: 13,
    fontWeight: '700',
  },
  totalText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: 'auto',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 16,
  },
  claimsList: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  claimCard: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  claimCardSelected: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(42,127,255,0.06)',
  },
  claimHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  verdictBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  verdictText: {
    fontSize: 12,
    fontWeight: '700',
  },
  confidenceText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  claimText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  sourceText: {
    color: colors.accent,
    fontSize: 12,
    marginTop: 8,
  },
  sourceTitleText: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  formSection: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    marginTop: 8,
    paddingTop: 16,
  },
  formLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  claimInput: {
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  sourceRow: {
    flexDirection: 'row',
    gap: 10,
  },
  sourceInput: {
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 12,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
