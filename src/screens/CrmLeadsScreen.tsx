import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { auth, firestore } from '../lib/firebase';
import { colors } from '../theme/colors';

/* ── Theme compat (mirrors source theme tokens) ─────────────────────────────── */

const C = {
  black: '#000000',
  white: '#ffffff',
  surface: '#16181c',
  surfaceBorder: '#374151',
  primary: '#FFFFFF',
  textPrimary: '#e7e9ea',
  textSecondary: '#a1a1aa',
  textTertiary: '#71767b',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  white20: 'rgba(255,255,255,0.2)',
  badgeNew: colors.accent,
  badgeContacted: '#f59e0b',
  badgeQualified: '#8b5cf6',
  badgeConverted: '#22c55e',
  badgeLost: '#ef4444',
};

const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
const F = { xs: 10, sm: 12, md: 14, lg: 15, xl: 18, xxl: 22, xxxl: 28 };
const BR = { sm: 6, md: 10, lg: 16, xl: 24 };

/* ── Types ──────────────────────────────────────────────────────────────────── */

interface CrmLead {
  id: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  aiScore: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

const STATUSES: Array<{ key: string; label: string; color: string }> = [
  { key: 'all', label: 'All', color: C.textSecondary },
  { key: 'new', label: 'New', color: C.badgeNew },
  { key: 'contacted', label: 'Contacted', color: C.badgeContacted },
  { key: 'qualified', label: 'Qualified', color: C.badgeQualified },
  { key: 'converted', label: 'Converted', color: C.badgeConverted },
  { key: 'lost', label: 'Lost', color: C.badgeLost },
];

const CrmLeadsScreen: React.FC = () => {
  const uid = auth().currentUser?.uid ?? '';
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [filteredLeads, setFilteredLeads] = useState<CrmLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeStatus, setActiveStatus] = useState('all');
  const [selectedLead, setSelectedLead] = useState<CrmLead | null>(null);
  const [leadNote, setLeadNote] = useState('');

  const loadLeads = useCallback(async () => {
    try {
      const snap = await firestore()
        .collection('leads')
        .where('businessId', '==', uid)
        .orderBy('createdAt', 'desc')
        .get();

      const leadsData = snap.docs.map((doc) => {
        const d = doc.data();
        const ts = (v: any) => {
          if (v && typeof v === 'object' && 'seconds' in v) {
            return new Date(v.seconds * 1000).toISOString();
          }
          return typeof v === 'string' ? v : new Date().toISOString();
        };
        return {
          id: doc.id,
          name: d.name ?? '',
          email: d.email ?? '',
          phone: d.phone ?? '',
          source: d.source ?? '',
          status: d.status ?? 'new',
          aiScore: d.aiScore ?? 0,
          notes: d.notes ?? '',
          createdAt: ts(d.createdAt),
          updatedAt: ts(d.updatedAt),
        };
      });
      setLeads(leadsData);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    if (activeStatus === 'all') {
      setFilteredLeads(leads);
    } else {
      setFilteredLeads(leads.filter((l) => l.status === activeStatus));
    }
  }, [leads, activeStatus]);

  const handleUpdateStatus = async (leadId: string, newStatus: CrmLead['status']) => {
    try {
      await firestore().collection('leads').doc(leadId).update({
        status: newStatus,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l)),
      );
      if (selectedLead?.id === leadId) {
        setSelectedLead((prev) => prev ? { ...prev, status: newStatus } : null);
      }
    } catch {
      // silent
    }
  };

  const handleSaveNote = async () => {
    if (!selectedLead || !leadNote.trim()) return;
    try {
      await firestore().collection('leads').doc(selectedLead.id).update({
        notes: leadNote.trim(),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });
      setLeads((prev) =>
        prev.map((l) =>
          l.id === selectedLead.id ? { ...l, notes: leadNote.trim() } : l,
        ),
      );
      setSelectedLead((prev) => prev ? { ...prev, notes: leadNote.trim() } : null);
      setLeadNote('');
    } catch {
      // silent
    }
  };

  const statusColor = (status: CrmLead['status']) => {
    const s = STATUSES.find((s) => s.key === status);
    return s?.color ?? C.textTertiary;
  };

  const renderLead = ({ item }: { item: CrmLead }) => (
    <TouchableOpacity
      style={styles.leadCard}
      onPress={() => {
        setSelectedLead(item);
        setLeadNote(item.notes);
      }}>
      <View style={styles.leadHeader}>
        <View style={styles.leadAvatar}>
          <Text style={styles.leadAvatarText}>
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.leadInfo}>
          <Text style={styles.leadName}>{item.name}</Text>
          <Text style={styles.leadEmail}>{item.email}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) + '20' }]}>
          <Text style={[styles.statusText, { color: statusColor(item.status) }]}>
            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
          </Text>
        </View>
      </View>

      <View style={styles.leadMeta}>
        <View style={styles.leadSourceRow}>
          <Ionicons name="link-outline" size={12} color={C.textSecondary} />
          <Text style={styles.leadSource}>{item.source || 'Direct'}</Text>
        </View>
        {item.phone ? (
          <View style={styles.leadPhoneRow}>
            <Ionicons name="call-outline" size={12} color={C.textSecondary} />
            <Text style={styles.leadPhone}>{item.phone}</Text>
          </View>
        ) : null}
      </View>

      {/* Lead Score Bar */}
      <View style={styles.scoreRow}>
        <Text style={styles.scoreLabel}>Lead Score</Text>
        <View style={styles.scoreBarBg}>
          <View
            style={[
              styles.scoreBarFill,
              {
                width: `${item.aiScore}%`,
                backgroundColor:
                  item.aiScore >= 70
                    ? C.success
                    : item.aiScore >= 40
                      ? C.warning
                      : C.danger,
              },
            ]}
          />
        </View>
        <Text style={styles.scoreValue}>{item.aiScore}%</Text>
      </View>

      {item.notes ? (
        <Text style={styles.leadNotesPreview} numberOfLines={1}>
          {item.notes}
        </Text>
      ) : null}
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centerLoader}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>CRM Leads</Text>
        <Text style={styles.headerCount}>{leads.length} leads</Text>
      </View>

      {/* Status Filter */}
      <View style={styles.filterBar}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={STATUSES}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.filterList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.filterPill,
                activeStatus === item.key && {
                  backgroundColor: item.color + '20',
                  borderColor: item.color,
                },
              ]}
              onPress={() => setActiveStatus(item.key)}>
              <Text
                style={[
                  styles.filterPillText,
                  activeStatus === item.key && { color: item.color },
                ]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Leads List */}
      <FlatList
        data={filteredLeads}
        keyExtractor={(item) => item.id}
        renderItem={renderLead}
        contentContainerStyle={styles.leadsList}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={48} color={C.white20} />
            <Text style={styles.emptyTitle}>No leads</Text>
            <Text style={styles.emptySubtitle}>
              {activeStatus === 'all'
                ? 'Leads will appear when customers show interest'
                : `No ${activeStatus} leads found`}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadLeads();
            }}
            tintColor={C.primary}
          />
        }
      />

      {/* Lead Detail Modal */}
      <Modal
        visible={!!selectedLead}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedLead(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedLead && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Lead Details</Text>
                  <TouchableOpacity onPress={() => setSelectedLead(null)}>
                    <Ionicons name="close" size={24} color={C.white} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.modalBody}>
                  <View style={styles.modalAvatar}>
                    <Text style={styles.modalAvatarText}>
                      {selectedLead.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.modalName}>{selectedLead.name}</Text>
                  <Text style={styles.modalEmail}>{selectedLead.email}</Text>
                  {selectedLead.phone && (
                    <Text style={styles.modalPhone}>{selectedLead.phone}</Text>
                  )}

                  <View style={styles.modalField}>
                    <Text style={styles.modalFieldLabel}>Source</Text>
                    <Text style={styles.modalFieldValue}>
                      {selectedLead.source || 'Direct'}
                    </Text>
                  </View>

                  <View style={styles.modalField}>
                    <Text style={styles.modalFieldLabel}>Status</Text>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor(selectedLead.status) + '20' }]}>
                      <Text style={[styles.statusText, { color: statusColor(selectedLead.status) }]}>
                        {selectedLead.status.charAt(0).toUpperCase() + selectedLead.status.slice(1)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.modalField}>
                    <Text style={styles.modalFieldLabel}>Lead Score</Text>
                    <View style={styles.scoreRow}>
                      <View style={[styles.scoreBarBg, { flex: 1 }]}>
                        <View
                          style={[
                            styles.scoreBarFill,
                            {
                              width: `${selectedLead.aiScore}%`,
                              backgroundColor:
                                selectedLead.aiScore >= 70
                                  ? C.success
                                  : selectedLead.aiScore >= 40
                                    ? C.warning
                                    : C.danger,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.scoreValue}>{selectedLead.aiScore}%</Text>
                    </View>
                  </View>

                  {/* Notes */}
                  <Text style={styles.modalFieldLabel}>Notes</Text>
                  <TextInput
                    style={styles.noteInput}
                    value={leadNote}
                    onChangeText={setLeadNote}
                    placeholder="Add a note..."
                    placeholderTextColor={C.textTertiary}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                  />
                  <TouchableOpacity style={styles.saveNoteBtn} onPress={handleSaveNote}>
                    <Text style={styles.saveNoteBtnText}>Save Note</Text>
                  </TouchableOpacity>

                  {/* Status Actions */}
                  <Text style={[styles.modalFieldLabel, { marginTop: S.xl }]}>
                    Update Status
                  </Text>
                  <View style={styles.statusActions}>
                    {STATUSES.filter((s) => s.key !== 'all').map((s) => (
                      <TouchableOpacity
                        key={s.key}
                        style={[
                          styles.statusActionBtn,
                          selectedLead.status === s.key && {
                            backgroundColor: s.color + '20',
                            borderColor: s.color,
                          },
                        ]}
                        onPress={() => handleUpdateStatus(selectedLead.id, s.key as CrmLead['status'])}>
                        <Text
                          style={[
                            styles.statusActionText,
                            selectedLead.status === s.key && { color: s.color },
                          ]}>
                          {s.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.black,
  },
  centerLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: C.black,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceBorder,
  },
  headerTitle: {
    color: C.textPrimary,
    fontSize: F.xl,
    fontWeight: '700',
  },
  headerCount: {
    color: C.textSecondary,
    fontSize: F.sm,
  },
  filterBar: {
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceBorder,
  },
  filterList: {
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    gap: S.sm,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: BR.lg,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.surfaceBorder,
  },
  filterPillText: {
    color: C.textSecondary,
    fontSize: F.sm,
    fontWeight: '500',
  },
  leadsList: {
    padding: S.lg,
  },
  separator: {
    height: 8,
  },
  leadCard: {
    backgroundColor: C.surface,
    borderRadius: BR.md,
    borderWidth: 1,
    borderColor: C.surfaceBorder,
    padding: S.md,
    gap: S.sm,
  },
  leadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
  },
  leadAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leadAvatarText: {
    color: C.primary,
    fontSize: F.lg,
    fontWeight: '700',
  },
  leadInfo: {
    flex: 1,
  },
  leadName: {
    color: C.textPrimary,
    fontSize: F.md,
    fontWeight: '600',
  },
  leadEmail: {
    color: C.textTertiary,
    fontSize: F.xs,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BR.sm,
  },
  statusText: {
    fontSize: F.xs,
    fontWeight: '600',
  },
  leadMeta: {
    flexDirection: 'row',
    gap: S.lg,
    marginLeft: 52,
  },
  leadSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  leadSource: {
    color: C.textSecondary,
    fontSize: F.xs,
  },
  leadPhoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  leadPhone: {
    color: C.textSecondary,
    fontSize: F.xs,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    marginLeft: 52,
  },
  scoreLabel: {
    color: C.textTertiary,
    fontSize: F.xs,
    width: 55,
  },
  scoreBarBg: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.surfaceBorder,
    overflow: 'hidden',
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  scoreValue: {
    color: C.textSecondary,
    fontSize: F.xs,
    fontWeight: '600',
    width: 30,
    textAlign: 'right',
  },
  leadNotesPreview: {
    color: C.textTertiary,
    fontSize: F.xs,
    marginLeft: 52,
    fontStyle: 'italic',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: S.xl,
  },
  emptyTitle: {
    color: C.textPrimary,
    fontSize: F.lg,
    fontWeight: '600',
    marginTop: S.lg,
  },
  emptySubtitle: {
    color: C.textSecondary,
    fontSize: F.sm,
    marginTop: S.xs,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: C.surface,
    borderTopLeftRadius: BR.xl,
    borderTopRightRadius: BR.xl,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: S.lg,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceBorder,
  },
  modalTitle: {
    color: C.textPrimary,
    fontSize: F.lg,
    fontWeight: '600',
  },
  modalBody: {
    padding: S.lg,
  },
  modalAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: S.md,
  },
  modalAvatarText: {
    color: C.primary,
    fontSize: F.xxxl,
    fontWeight: '700',
  },
  modalName: {
    color: C.textPrimary,
    fontSize: F.xxl,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: S.md,
  },
  modalEmail: {
    color: C.textSecondary,
    fontSize: F.sm,
    textAlign: 'center',
    marginTop: 4,
  },
  modalPhone: {
    color: C.textSecondary,
    fontSize: F.sm,
    textAlign: 'center',
    marginTop: 2,
  },
  modalField: {
    marginTop: S.lg,
  },
  modalFieldLabel: {
    color: C.textSecondary,
    fontSize: F.sm,
    fontWeight: '500',
    marginBottom: S.xs,
  },
  modalFieldValue: {
    color: C.textPrimary,
    fontSize: F.md,
  },
  noteInput: {
    backgroundColor: C.black,
    borderRadius: BR.md,
    borderWidth: 1,
    borderColor: C.surfaceBorder,
    paddingHorizontal: S.md,
    paddingVertical: S.md,
    color: C.textPrimary,
    fontSize: F.sm,
    minHeight: 60,
    marginTop: S.xs,
  },
  saveNoteBtn: {
    alignSelf: 'flex-end',
    backgroundColor: C.primary,
    borderRadius: BR.sm,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: S.sm,
  },
  saveNoteBtnText: {
    color: C.black,
    fontSize: F.sm,
    fontWeight: '600',
  },
  statusActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
  },
  statusActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BR.md,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.surfaceBorder,
  },
  statusActionText: {
    color: C.textSecondary,
    fontSize: F.sm,
    fontWeight: '500',
  },
});

export default CrmLeadsScreen;
