import { colors } from '../theme/colors';
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
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { auth, firestore } from '../lib/firebase';
import { deliverPendingFollowUps } from '../lib/crm';

/* ── Theme compat (mirrors source theme tokens) ─────────────────────────────── */

const C = {
  black: colors.bg,
  white: colors.white,
  surface: colors.surface,
  surfaceBorder: colors.border,
  primary: colors.white,
  textPrimary: colors.text,
  textSecondary: colors.textSecondary,
  textTertiary: colors.textMuted,
  success: colors.accentGreen,
  warning: colors.accentGold,
  danger: colors.error,
  white20: 'rgba(255,255,255,0.2)',
};

const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
const F = { xs: 10, sm: 12, md: 14, lg: 15, xl: 18, xxl: 22, xxxl: 28 };
const BR = { sm: 6, md: 10, lg: 16, xl: 24 };

/* ── Types ──────────────────────────────────────────────────────────────────── */

interface CrmDeal {
  id: string;
  title: string;
  value: number;
  stage: 'initial' | 'negotiation' | 'proposal' | 'closing' | 'won' | 'lost';
  leadId: string;
  leadName: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

const STAGES: Array<{ key: CrmDeal['stage']; label: string; color: string }> = [
  { key: 'initial', label: 'Initial', color: colors.textSecondary },
  { key: 'negotiation', label: 'Negotiation', color: colors.accentGold },
  { key: 'proposal', label: 'Proposal', color: '#8b5cf6' },
  { key: 'closing', label: 'Closing', color: '#06b6d4' },
  { key: 'won', label: 'Won', color: colors.accentGreen },
  { key: 'lost', label: 'Lost', color: colors.error },
];

const CrmDealsScreen: React.FC = () => {
  const uid = auth().currentUser?.uid ?? '';
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [filteredDeals, setFilteredDeals] = useState<CrmDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeStage, setActiveStage] = useState('all');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [selectedDeal, setSelectedDeal] = useState<CrmDeal | null>(null);

  const loadDeals = useCallback(async () => {
    try {
      const snap = await firestore()
        .collection('deals')
        .where('businessId', '==', uid)
        .orderBy('createdAt', 'desc')
        .get();

      const dealsData = snap.docs.map((doc) => {
        const d = doc.data();
        const ts = (v: any) => {
          if (v && typeof v === 'object' && 'seconds' in v) {
            return new Date(v.seconds * 1000).toISOString();
          }
          return typeof v === 'string' ? v : new Date().toISOString();
        };
        return {
          id: doc.id,
          title: d.title ?? '',
          value: d.value ?? 0,
          stage: d.stage ?? 'initial',
          leadId: d.leadId ?? '',
          leadName: d.leadName ?? '',
          notes: d.notes ?? '',
          createdAt: ts(d.createdAt),
          updatedAt: ts(d.updatedAt),
        };
      });
      setDeals(dealsData);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useEffect(() => {
    loadDeals();
    // Deliver any pending follow-up reminders
    deliverPendingFollowUps(uid).catch(() => {});
  }, [loadDeals]);

  useEffect(() => {
    if (activeStage === 'all') {
      setFilteredDeals(deals);
    } else {
      setFilteredDeals(deals.filter((d) => d.stage === activeStage));
    }
  }, [deals, activeStage]);

  const stageColor = (stage: CrmDeal['stage']) => {
    const s = STAGES.find((s) => s.key === stage);
    return s?.color ?? C.textTertiary;
  };

  const pipelineTotal = deals
    .filter((d) => d.stage !== 'lost')
    .reduce((sum, d) => sum + d.value, 0);

  const renderDealCard = (deal: CrmDeal) => (
    <TouchableOpacity
      key={deal.id}
      style={styles.dealCard}
      onPress={() => setSelectedDeal(deal)}>
      <View style={styles.dealHeader}>
        <Text style={styles.dealTitle}>{deal.title}</Text>
        <Text style={styles.dealValue}>₹{deal.value.toLocaleString('en-IN')}</Text>
      </View>
      <View style={styles.dealMeta}>
        {deal.leadName ? (
          <View style={styles.dealLeadRow}>
            <Ionicons name="person-outline" size={12} color={C.textSecondary} />
            <Text style={styles.dealLead}>{deal.leadName}</Text>
          </View>
        ) : null}
        <View style={[styles.stageBadge, { backgroundColor: stageColor(deal.stage) + '20' }]}>
          <Text style={[styles.stageText, { color: stageColor(deal.stage) }]}>
            {deal.stage.charAt(0).toUpperCase() + deal.stage.slice(1)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderKanbanColumn = (stage: typeof STAGES[number]) => {
    const stageDeals = deals.filter((d) => d.stage === stage.key);
    return (
      <View key={stage.key} style={styles.kanbanColumn}>
        <View style={styles.kanbanColumnHeader}>
          <View style={[styles.kanbanDot, { backgroundColor: stage.color }]} />
          <Text style={styles.kanbanColumnTitle}>{stage.label}</Text>
          <View style={styles.kanbanCount}>
            <Text style={styles.kanbanCountText}>{stageDeals.length}</Text>
          </View>
        </View>
        {stageDeals.map((deal) => (
          <TouchableOpacity
            key={deal.id}
            style={styles.kanbanCard}
            onPress={() => setSelectedDeal(deal)}>
            <Text style={styles.kanbanCardTitle}>{deal.title}</Text>
            <Text style={styles.kanbanCardValue}>
              ₹{deal.value.toLocaleString('en-IN')}
            </Text>
            {deal.leadName && (
              <Text style={styles.kanbanCardLead}>{deal.leadName}</Text>
            )}
          </TouchableOpacity>
        ))}
        {stageDeals.length === 0 && (
          <Text style={styles.kanbanEmpty}>No deals</Text>
        )}
      </View>
    );
  };

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
        <Text style={styles.headerTitle}>Deals</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.viewToggle, viewMode === 'list' && styles.viewToggleActive]}
            onPress={() => setViewMode('list')}>
            <Ionicons name="list" size={18} color={viewMode === 'list' ? C.primary : C.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.viewToggle, viewMode === 'kanban' && styles.viewToggleActive]}
            onPress={() => setViewMode('kanban')}>
            <Ionicons name="grid-outline" size={18} color={viewMode === 'kanban' ? C.primary : C.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Pipeline Total */}
      <View style={styles.pipelineBar}>
        <Text style={styles.pipelineLabel}>Pipeline Value</Text>
        <Text style={styles.pipelineValue}>
          ₹{pipelineTotal.toLocaleString('en-IN')}
        </Text>
      </View>

      {viewMode === 'list' ? (
        <>
          {/* Stage Filter */}
          <View style={styles.filterBar}>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={[{ key: 'all', label: 'All', color: C.textSecondary }, ...STAGES]}
              keyExtractor={(item) => item.key}
              contentContainerStyle={styles.filterList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.filterPill,
                    activeStage === item.key && {
                      backgroundColor: item.color + '20',
                      borderColor: item.color,
                    },
                  ]}
                  onPress={() => setActiveStage(item.key)}>
                  <Text
                    style={[
                      styles.filterPillText,
                      activeStage === item.key && { color: item.color },
                    ]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>

          <FlatList
            data={filteredDeals}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => renderDealCard(item)}
            contentContainerStyle={styles.dealsList}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="briefcase-outline" size={48} color={C.white20} />
                <Text style={styles.emptyTitle}>No deals</Text>
                <Text style={styles.emptySubtitle}>
                  {activeStage === 'all'
                    ? 'Create deals to track your sales pipeline'
                    : `No ${activeStage} deals`}
                </Text>
              </View>
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); loadDeals(); }}
                tintColor={C.primary}
              />
            }
          />
        </>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.kanbanContainer}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadDeals(); }}
              tintColor={C.primary}
            />
          }>
          {STAGES.map(renderKanbanColumn)}
        </ScrollView>
      )}

      {/* Deal Detail Modal */}
      <Modal
        visible={!!selectedDeal}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedDeal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedDeal && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Deal Details</Text>
                  <TouchableOpacity onPress={() => setSelectedDeal(null)}>
                    <Ionicons name="close" size={24} color={C.white} />
                  </TouchableOpacity>
                </View>
                <ScrollView style={styles.modalBody}>
                  <Text style={styles.modalDealTitle}>{selectedDeal.title}</Text>
                  <Text style={styles.modalDealValue}>
                    ₹{selectedDeal.value.toLocaleString('en-IN')}
                  </Text>

                  <View style={styles.modalField}>
                    <Text style={styles.modalFieldLabel}>Stage</Text>
                    <View style={[styles.stageBadge, { backgroundColor: stageColor(selectedDeal.stage) + '20' }]}>
                      <Text style={[styles.stageText, { color: stageColor(selectedDeal.stage) }]}>
                        {selectedDeal.stage.charAt(0).toUpperCase() + selectedDeal.stage.slice(1)}
                      </Text>
                    </View>
                  </View>

                  {selectedDeal.leadName && (
                    <View style={styles.modalField}>
                      <Text style={styles.modalFieldLabel}>Lead</Text>
                      <Text style={styles.modalFieldValue}>{selectedDeal.leadName}</Text>
                    </View>
                  )}

                  {selectedDeal.notes && (
                    <View style={styles.modalField}>
                      <Text style={styles.modalFieldLabel}>Notes</Text>
                      <Text style={styles.modalFieldValue}>{selectedDeal.notes}</Text>
                    </View>
                  )}

                  <Text style={[styles.modalFieldLabel, { marginTop: S.xl }]}>
                    Move to Stage
                  </Text>
                  <View style={styles.statusActions}>
                    {STAGES.map((s) => (
                      <TouchableOpacity
                        key={s.key}
                        style={[
                          styles.statusActionBtn,
                          selectedDeal.stage === s.key && {
                            backgroundColor: s.color + '20',
                            borderColor: s.color,
                          },
                        ]}
                        onPress={async () => {
                          try {
                            await firestore().collection('deals').doc(selectedDeal.id).update({
                              stage: s.key,
                              updatedAt: firestore.FieldValue.serverTimestamp(),
                            });
                            setDeals((prev) =>
                              prev.map((d) =>
                                d.id === selectedDeal.id ? { ...d, stage: s.key } : d,
                              ),
                            );
                            setSelectedDeal((prev) => prev ? { ...prev, stage: s.key } : null);
                          } catch {
                            // silent
                          }
                        }}>
                        <Text
                          style={[
                            styles.statusActionText,
                            selectedDeal.stage === s.key && { color: s.color },
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
  headerRight: {
    flexDirection: 'row',
    gap: 4,
  },
  viewToggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.surfaceBorder,
  },
  viewToggleActive: {
    borderColor: C.primary,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  pipelineBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    backgroundColor: colors.bgInput,
    borderBottomWidth: 1,
    borderBottomColor: C.surfaceBorder,
  },
  pipelineLabel: {
    color: C.textSecondary,
    fontSize: F.sm,
  },
  pipelineValue: {
    color: C.white,
    fontSize: F.lg,
    fontWeight: '700',
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
  dealsList: {
    padding: S.lg,
  },
  separator: {
    height: 8,
  },
  dealCard: {
    backgroundColor: C.surface,
    borderRadius: BR.md,
    borderWidth: 1,
    borderColor: C.surfaceBorder,
    padding: S.md,
  },
  dealHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  dealTitle: {
    color: C.textPrimary,
    fontSize: F.md,
    fontWeight: '600',
    flex: 1,
  },
  dealValue: {
    color: C.white,
    fontSize: F.md,
    fontWeight: '700',
    marginLeft: S.sm,
  },
  dealMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: S.sm,
  },
  dealLeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dealLead: {
    color: C.textSecondary,
    fontSize: F.xs,
  },
  stageBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BR.sm,
  },
  stageText: {
    fontSize: F.xs,
    fontWeight: '600',
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
  kanbanContainer: {
    padding: S.lg,
    gap: S.md,
    paddingBottom: 100,
  },
  kanbanColumn: {
    width: 240,
    backgroundColor: C.surface,
    borderRadius: BR.md,
    borderWidth: 1,
    borderColor: C.surfaceBorder,
    padding: S.sm,
    gap: S.sm,
  },
  kanbanColumnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: S.sm,
    paddingVertical: S.xs,
  },
  kanbanDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  kanbanColumnTitle: {
    color: C.textPrimary,
    fontSize: F.sm,
    fontWeight: '600',
    flex: 1,
  },
  kanbanCount: {
    backgroundColor: C.surfaceBorder,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  kanbanCountText: {
    color: C.textSecondary,
    fontSize: F.xs,
    fontWeight: '600',
  },
  kanbanCard: {
    backgroundColor: C.black,
    borderRadius: BR.sm,
    padding: S.md,
    borderWidth: 1,
    borderColor: C.surfaceBorder,
  },
  kanbanCardTitle: {
    color: C.textPrimary,
    fontSize: F.sm,
    fontWeight: '600',
  },
  kanbanCardValue: {
    color: C.white,
    fontSize: F.md,
    fontWeight: '700',
    marginTop: 4,
  },
  kanbanCardLead: {
    color: C.textTertiary,
    fontSize: F.xs,
    marginTop: 4,
  },
  kanbanEmpty: {
    color: C.textTertiary,
    fontSize: F.xs,
    textAlign: 'center',
    paddingVertical: S.lg,
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
    maxHeight: '80%',
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
  modalDealTitle: {
    color: C.textPrimary,
    fontSize: F.xxl,
    fontWeight: '700',
  },
  modalDealValue: {
    color: C.success,
    fontSize: F.xxl,
    fontWeight: '800',
    marginTop: S.xs,
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

export default CrmDealsScreen;
