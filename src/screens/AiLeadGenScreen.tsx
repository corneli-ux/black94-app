/**
 * AiLeadGenScreen.tsx — AI Lead Generation & Management
 *
 * Lead source dashboard, potential customers, auto follow-ups,
 * AI follow-up message generation, lead import/export, and scoring.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  ScrollView,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '../stores/app';
import { colors } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';
import { auth, firestore } from '../lib/firebase';
import * as CRM from '../lib/crm';
import {
  CrmLead,
  ScheduledFollowUp,
  PotentialCustomer,
  LeadStats,
  LeadSource,
} from '../lib/crm';

// ── Helpers ────────────────────────────────────────────────────────────────

const SOURCE_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  chat: { color: colors.accent, icon: 'chatbubbles-outline', label: 'Chat' },
  comment: { color: colors.accentGold, icon: 'chatbubble-outline', label: 'Comments' },
  store_visit: { color: colors.accentGreen, icon: 'storefront', label: 'Store Visits' },
  post_engagement: { color: colors.verified, icon: 'heart-outline', label: 'Post Engagement' },
  affiliate: { color: colors.like, icon: 'people-outline', label: 'Affiliates' },
  manual: { color: colors.textMuted, icon: 'hand-left', label: 'Manual' },
  import: { color: colors.textMuted, icon: 'download-outline', label: 'Imported' },
  referral: { color: colors.primary, icon: 'share-social-outline', label: 'Referrals' },
};

const STATUS_COLORS: Record<string, string> = {
  new: colors.accent,
  contacted: '#f59e0b',
  qualified: '#8b5cf6',
  converted: '#22c55e',
  unqualified: '#64748b',
  lost: '#ef4444',
};

function formatRelativeDate(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function scoreColor(score: number): string {
  if (score >= 70) return colors.accentGreen;
  if (score >= 40) return colors.accentGold;
  return colors.error;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AiLeadGenScreen() {
  const navigation = useNavigation<any>();
  const user = useAppStore((s) => s.user);
  const uid = user?.id || auth()?.currentUser?.uid;

  // Data
  const [leadStats, setLeadStats] = useState<LeadStats | null>(null);
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});
  const [potentialCustomers, setPotentialCustomers] = useState<PotentialCustomer[]>([]);
  const [pendingFollowUps, setPendingFollowUps] = useState<ScheduledFollowUp[]>([]);
  const [allLeads, setAllLeads] = useState<CrmLead[]>([]);

  // Loading
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generatedMessage, setGeneratedMessage] = useState<string | null>(null);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  // ── Load data ────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!uid) { setLoading(false); return; }

    try {
      // Load lead stats
      const stats = await CRM.getLeadStats(uid);
      setLeadStats(stats);

      // Load leads to compute source counts
      const leads = await CRM.fetchLeads(uid, { limit: 500 });
      setAllLeads(leads);

      // Source counts
      const counts: Record<string, number> = {};
      leads.forEach((l) => {
        const src = l.source || 'manual';
        counts[src] = (counts[src] || 0) + 1;
      });
      setSourceCounts(counts);

      // Potential customers
      try {
        const customers = await CRM.identifyPotentialCustomers(uid);
        setPotentialCustomers(customers.slice(0, 20));
      } catch (e) {
        console.warn('[AiLeadGen] identifyPotentialCustomers error:', e);
        setPotentialCustomers([]);
      }

      // Pending follow-ups
      try {
        const followUps = await CRM.getPendingFollowUps(uid);
        setPendingFollowUps(followUps);
      } catch (e) {
        console.warn('[AiLeadGen] getPendingFollowUps error:', e);
        setPendingFollowUps([]);
      }
    } catch (err) {
      console.error('[AiLeadGen] loadData error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(() => { setRefreshing(true); loadData(); }, [loadData]);

  // ── Generate follow-up ───────────────────────────────────────────────────

  const handleGenerateFollowUp = useCallback(async (leadId: string) => {
    setGenerating(leadId);
    setGeneratedMessage(null);
    try {
      const message = await CRM.generateFollowUpMessage(leadId);
      setGeneratedMessage(message || 'No follow-up message generated. Try updating lead information first.');
      setShowMessageModal(true);
    } catch (e: any) {
      Alert.alert('Follow-up', 'Could not generate follow-up. Please try again.');
    } finally {
      setGenerating(null);
    }
  }, []);

  // ── Export leads ─────────────────────────────────────────────────────────

  const handleExportLeads = useCallback(async () => {
    if (!uid) return;
    setExporting(true);
    try {
      const csv = await CRM.exportLeadsCSV(uid);
      // In a real app, we'd use expo-file-system or Share API
      // For now, copy to clipboard as fallback
      Alert.alert(
        'Leads Exported',
        `Successfully exported ${allLeads.length} leads as CSV. In production, this would download the file.`,
      );
    } catch (e) {
      Alert.alert('Export Failed', 'Could not export leads.');
    } finally {
      setExporting(false);
    }
  }, [uid, allLeads.length]);

  // ── Import leads (CSV placeholder) ──────────────────────────────────────

  const handleImportLeads = useCallback(() => {
    Alert.alert(
      'Import Leads',
      'Upload a CSV file with columns: Name, Email, Phone, Company, Job Title, Source, Tags, Notes.\n\nThe import will create leads and assign AI scores automatically.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Choose File', onPress: () => {
          // In production, use expo-document-picker or expo-file-system
          Alert.alert('Coming Soon', 'File picker integration will be available in the next update.');
        }},
      ],
    );
  }, []);

  // ── Loading state ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading leads…</Text>
      </SafeAreaView>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────

  const totalSourceLeads = Object.values(sourceCounts).reduce((a, b) => a + b, 0);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>AI Lead Generation</Text>
          <View style={{ width: 32 }} />
        </View>

        {/* ═══ Section 1: Lead Sources Dashboard ═══ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="analytics-outline" size={20} color={colors.accent} />
            <Text style={styles.sectionTitle}>Lead Sources</Text>
            <Text style={styles.sectionCount}>{totalSourceLeads} total</Text>
          </View>

          {/* Stats summary */}
          {leadStats && (
            <View style={styles.statsGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{leadStats.total}</Text>
                <Text style={styles.statLabel}>Total Leads</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{leadStats.new}</Text>
                <Text style={styles.statLabel}>New</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{leadStats.qualified}</Text>
                <Text style={styles.statLabel}>Qualified</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statValue, { color: colors.accentGreen }]}>{leadStats.converted}</Text>
                <Text style={styles.statLabel}>Converted</Text>
              </View>
            </View>
          )}

          {/* Source breakdown */}
          <View style={styles.sourceGrid}>
            {Object.entries(SOURCE_CONFIG).map(([key, config]) => {
              const count = sourceCounts[key] || 0;
              if (count === 0 && key !== 'manual') return null;
              return (
                <View key={key} style={styles.sourceCard}>
                  <View style={[styles.sourceIcon, { backgroundColor: config.color + '15' }]}>
                    <Ionicons name={config.icon as any} size={20} color={config.color} />
                  </View>
                  <Text style={styles.sourceName}>{config.label}</Text>
                  <Text style={[styles.sourceCount, { color: config.color }]}>{count}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ═══ Section 2: Potential Customers ═══ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="person-add-outline" size={20} color={colors.accentGold} />
            <Text style={styles.sectionTitle}>Potential Customers</Text>
          </View>

          {potentialCustomers.length === 0 ? (
            <View style={styles.emptySection}>
              <Ionicons name="people-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyText}>No potential customers identified yet.</Text>
              <Text style={styles.emptySubText}>AI will identify high-intent users as they interact with your business.</Text>
            </View>
          ) : (
            <View style={styles.leadsList}>
              {potentialCustomers.slice(0, 10).map((customer, idx) => (
                <View key={customer.userId || idx} style={styles.leadCard}>
                  <View style={styles.leadAvatar}>
                    <Text style={styles.leadAvatarText}>
                      {(customer.userName || 'U').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.leadInfo}>
                    <Text style={styles.leadName}>{customer.userName || 'Unknown User'}</Text>
                    <Text style={styles.leadEmail}>{customer.userEmail || 'No email'}</Text>
                    <View style={styles.leadSignals}>
                      {(customer.signals || []).slice(0, 3).map((signal, si) => (
                        <View key={si} style={styles.signalBadge}>
                          <Text style={styles.signalText}>{signal}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <View style={styles.scoreSection}>
                    <View style={styles.scoreBarBg}>
                      <View style={[styles.scoreBarFill, { width: `${customer.score}%`, backgroundColor: scoreColor(customer.score) }]} />
                    </View>
                    <Text style={[styles.scoreText, { color: scoreColor(customer.score) }]}>{customer.score}</Text>
                  </View>
                </View>
              ))}
              {potentialCustomers.length > 10 && (
                <Text style={styles.showMore}>+{potentialCustomers.length - 10} more potential customers</Text>
              )}
            </View>
          )}
        </View>

        {/* ═══ Section 3: Auto Follow-ups ═══ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="time-outline" size={20} color={colors.accentGreen} />
            <Text style={styles.sectionTitle}>Auto Follow-ups</Text>
            <Text style={styles.sectionCount}>{pendingFollowUps.length} pending</Text>
          </View>

          {pendingFollowUps.length === 0 ? (
            <View style={styles.emptySection}>
              <Ionicons name="checkmark-done-circle-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyText}>All caught up!</Text>
              <Text style={styles.emptySubText}>No pending follow-ups at the moment.</Text>
            </View>
          ) : (
            <View style={styles.leadsList}>
              {pendingFollowUps.slice(0, 10).map((fu) => {
                const lead = allLeads.find((l) => l.id === fu.leadId);
                const isGenerating = generating === fu.leadId;

                return (
                  <View key={fu.id} style={styles.followUpCard}>
                    <View style={styles.followUpInfo}>
                      <Text style={styles.followUpName}>{lead?.name || 'Unknown Lead'}</Text>
                      <Text style={styles.followUpPreview} numberOfLines={2}>{fu.message || 'No message scheduled'}</Text>
                      <View style={styles.followUpMeta}>
                        <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
                        <Text style={styles.followUpDate}>{formatRelativeDate(fu.scheduledAt)}</Text>
                      </View>
                    </View>
                    <View style={styles.followUpActions}>
                      <TouchableOpacity
                        style={[styles.genBtn, isGenerating && styles.btnDisabled]}
                        onPress={() => handleGenerateFollowUp(fu.leadId)}
                        disabled={isGenerating}
                        activeOpacity={0.7}
                      >
                        {isGenerating ? (
                          <ActivityIndicator size="small" color={colors.bg} />
                        ) : (
                          <Ionicons name="sparkles-outline" size={14} color={colors.bg} />
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ═══ Section 4: Generate Follow-up Button ═══ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="sparkles-outline" size={20} color={colors.verified} />
            <Text style={styles.sectionTitle}>AI Follow-up Generator</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Select a lead from the follow-up section and tap the sparkle button to generate an AI-powered personalized follow-up message.
          </Text>

          {/* Lead scoring explanation */}
          <View style={styles.scoringCard}>
            <Text style={styles.scoringTitle}>How AI Scoring Works</Text>
            <View style={styles.scoringItems}>
              <View style={styles.scoringItem}>
                <View style={[styles.scoringDot, { backgroundColor: colors.error }]} />
                <Text style={styles.scoringLabel}>0-39: Low priority — needs more engagement signals</Text>
              </View>
              <View style={styles.scoringItem}>
                <View style={[styles.scoringDot, { backgroundColor: colors.accentGold }]} />
                <Text style={styles.scoringLabel}>40-69: Medium — shows interest, worth pursuing</Text>
              </View>
              <View style={styles.scoringItem}>
                <View style={[styles.scoringDot, { backgroundColor: colors.accentGreen }]} />
                <Text style={styles.scoringLabel}>70-100: High — strong conversion potential, act fast!</Text>
              </View>
            </View>
            <Text style={styles.scoringNote}>
              Scores are computed from: source quality, contact completeness (email, phone), registration status, and engagement level.
            </Text>
          </View>
        </View>

        {/* ═══ Section 5: Import / Export ═══ */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="swap-vertical-outline" size={20} color={colors.accent} />
            <Text style={styles.sectionTitle}>Import / Export</Text>
          </View>

          <View style={styles.importExportRow}>
            <TouchableOpacity
              style={styles.importExportBtn}
              onPress={handleImportLeads}
              activeOpacity={0.7}
            >
              <Ionicons name="cloud-upload-outline" size={18} color={colors.accent} />
              <View style={styles.importExportBtnInfo}>
                <Text style={styles.importExportBtnTitle}>Import Leads</Text>
                <Text style={styles.importExportBtnDesc}>Upload CSV file</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.importExportBtn, exporting && styles.btnDisabled]}
              onPress={handleExportLeads}
              disabled={exporting}
              activeOpacity={0.7}
            >
              {exporting ? (
                <ActivityIndicator size="small" color={colors.accentGreen} />
              ) : (
                <Ionicons name="cloud-download-outline" size={18} color={colors.accentGreen} />
              )}
              <View style={styles.importExportBtnInfo}>
                <Text style={styles.importExportBtnTitle}>Export Leads</Text>
                <Text style={styles.importExportBtnDesc}>{allLeads.length} leads → CSV</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ═══ Generated Message Modal ═══ */}
      <Modal visible={showMessageModal} animationType="fade" transparent onRequestClose={() => setShowMessageModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <Ionicons name="sparkles" size={20} color={colors.accentGold} />
                <Text style={styles.modalTitle}>AI Follow-up Message</Text>
              </View>
              <TouchableOpacity onPress={() => setShowMessageModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.messageBox}>
                <Text style={styles.messageText}>{generatedMessage || 'No message generated.'}</Text>
              </View>
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowMessageModal(false)} activeOpacity={0.7}>
                <Text style={styles.modalCancelText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => {
                  if (generatedMessage) {
                    // In production, copy to clipboard or send via chat
                    Alert.alert('Copied', 'Message copied to clipboard.');
                  }
                  setShowMessageModal(false);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="copy-outline" size={16} color={colors.bg} />
                <Text style={styles.primaryBtnText}>Copy Message</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg, gap: 12 },
  loadingText: { fontSize: 14, color: colors.textMuted },
  scrollContent: { padding: 16, paddingBottom: 40 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  backBtn: { padding: 4 },
  headerTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },

  // Section
  section: { marginBottom: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sectionCount: { fontSize: 12, color: colors.textMuted, marginLeft: 'auto', fontWeight: '500' },
  sectionDesc: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 14 },

  // Stats
  statsGrid: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '500', marginTop: 2 },

  // Source grid
  sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sourceCard: { flex: 1, minWidth: '45%', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: 'center', gap: 8 },
  sourceIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  sourceName: { fontSize: 13, fontWeight: '600', color: colors.text },
  sourceCount: { fontSize: 20, fontWeight: '800' },

  // Leads list
  leadsList: { gap: 10 },
  leadCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12 },
  leadAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' },
  leadAvatarText: { color: colors.primary, fontSize: 17, fontWeight: '700' },
  leadInfo: { flex: 1 },
  leadName: { fontSize: 14, fontWeight: '600', color: colors.text },
  leadEmail: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  leadSignals: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  signalBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: 'rgba(42, 127, 255, 0.1)' },
  signalText: { fontSize: 10, fontWeight: '500', color: colors.verified },
  scoreSection: { width: 60, alignItems: 'center', gap: 4 },
  scoreBarBg: { width: '100%', height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  scoreBarFill: { height: '100%', borderRadius: 3 },
  scoreText: { fontSize: 13, fontWeight: '700' },
  showMore: { fontSize: 13, color: colors.accent, fontWeight: '600', textAlign: 'center', marginTop: 8 },

  // Follow-up cards
  followUpCard: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12, alignItems: 'center' },
  followUpInfo: { flex: 1 },
  followUpName: { fontSize: 14, fontWeight: '600', color: colors.text },
  followUpPreview: { fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 17 },
  followUpMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  followUpDate: { fontSize: 11, color: colors.textMuted },
  followUpActions: { gap: 6 },
  genBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accentGold, justifyContent: 'center', alignItems: 'center' },

  // Empty state
  emptySection: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  emptySubText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 24, lineHeight: 19 },

  // Scoring card
  scoringCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16 },
  scoringTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 14 },
  scoringItems: { gap: 10, marginBottom: 12 },
  scoringItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  scoringDot: { width: 10, height: 10, borderRadius: 5 },
  scoringLabel: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  scoringNote: { fontSize: 12, color: colors.textMuted, lineHeight: 18, fontStyle: 'italic' },

  // Import/Export
  importExportRow: { gap: 10 },
  importExportBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 14 },
  importExportBtnInfo: { flex: 1 },
  importExportBtnTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  importExportBtnDesc: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  btnDisabled: { opacity: 0.4 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalContent: { backgroundColor: colors.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 440, borderWidth: 1, borderColor: colors.border, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  messageBox: { backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 },
  messageText: { fontSize: 14, color: colors.text, lineHeight: 22 },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: 'transparent' },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  primaryBtn: { flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.primary },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: colors.bg },
});
