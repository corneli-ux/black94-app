/**
 * crm.ts — Customer Relationship Management Library
 *
 * Comprehensive CRM engine for business accounts. Handles lead management,
 * deal pipeline, data import/export, business analytics, customer identification,
 * and AI-powered follow-up automation.
 *
 * Uses the same Firestore REST compat layer as api.ts and shop.ts.
 */

import { firestore, auth } from './firebase';
import { tsToMillis } from '../utils/datetime';

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Lead Types ──────────────────────────────────────────────────────────────

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted' | 'lost';
export type LeadSource = 'chat' | 'comment' | 'post_engagement' | 'store_visit' | 'affiliate' | 'manual' | 'import' | 'referral';

export interface CrmLead {
  id: string;
  businessId: string;
  name: string;
  email: string;
  phone: string;
  companyName: string;
  jobTitle: string;
  source: LeadSource;
  status: LeadStatus;
  aiScore: number;
  assignedTo: string | null;
  notes: string;
  tags: string[];
  customFields: Record<string, any>;
  lastFollowUpAt: number;
  lastActivityAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface LeadSourceData {
  userId?: string;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  businessId: string;
  sourceContext?: string;
  engagementScore?: number;
  metadata?: Record<string, any>;
}

export interface CreateLeadData {
  businessId: string;
  name: string;
  email?: string;
  phone?: string;
  companyName?: string;
  jobTitle?: string;
  source?: LeadSource;
  status?: LeadStatus;
  aiScore?: number;
  assignedTo?: string;
  notes?: string;
  tags?: string[];
  customFields?: Record<string, any>;
}

export interface LeadFilters {
  status?: LeadStatus;
  source?: LeadSource;
  assignedTo?: string;
  tags?: string[];
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'aiScore' | 'lastActivityAt';
  sortOrder?: 'asc' | 'desc';
  minAiScore?: number;
  limit?: number;
}

export interface LeadStats {
  total: number;
  new: number;
  contacted: number;
  qualified: number;
  unqualified: number;
  converted: number;
  lost: number;
  avgAiScore: number;
  assignedCount: number;
  unassignedCount: number;
}

// ── Deal Types ──────────────────────────────────────────────────────────────

export type DealStage = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type ActivityType = 'call' | 'email' | 'meeting' | 'note' | 'task' | 'sms' | 'other';

export interface CrmDeal {
  id: string;
  businessId: string;
  leadId: string;
  title: string;
  description: string;
  stage: DealStage;
  value: number;
  currency: string;
  probability: number;
  assignedTo: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  companyName: string;
  expectedCloseDate: number;
  actualCloseDate: number;
  tags: string[];
  customFields: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface DealActivity {
  type: ActivityType;
  subject: string;
  notes: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface CreateDealData {
  businessId: string;
  leadId?: string;
  title: string;
  description?: string;
  stage?: DealStage;
  value?: number;
  currency?: string;
  probability?: number;
  assignedTo?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  companyName?: string;
  expectedCloseDate?: number;
  tags?: string[];
  customFields?: Record<string, any>;
}

export interface DealFilters {
  stage?: DealStage;
  assignedTo?: string;
  minValue?: number;
  maxValue?: number;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'value' | 'expectedCloseDate';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}

// ── Analytics Types ─────────────────────────────────────────────────────────

export interface BusinessAnalytics {
  period: string;
  totalRevenue: number;
  revenueChange: number;
  totalLeads: number;
  leadsChange: number;
  conversionRate: number;
  conversionChange: number;
  activeDeals: number;
  wonDeals: number;
  lostDeals: number;
  avgDealValue: number;
  topSource: LeadSource;
  revenueBySource: Record<LeadSource, number>;
  leadsByStatus: Record<LeadStatus, number>;
  dealsByStage: Record<DealStage, number>;
}

export interface ChartDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
  date: number;
}

export interface FunnelData {
  stages: {
    stage: string;
    count: number;
    value: number;
    conversionRate: number;
  }[];
  totalLeads: number;
  totalConverted: number;
  overallConversionRate: number;
}

export interface ProductStat {
  productId: string;
  productName: string;
  totalSold: number;
  totalRevenue: number;
  orderCount: number;
  avgRating: number;
  category: string;
}

export interface CustomerStats {
  totalCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  avgOrderValue: number;
  totalOrders: number;
  totalRevenue: number;
  topCustomers: {
    customerId: string;
    customerName: string;
    totalSpent: number;
    orderCount: number;
    lastOrderDate: number;
  }[];
  retentionRate: number;
}

// ── Customer Journey Types ──────────────────────────────────────────────────

export interface PotentialCustomer {
  userId: string;
  userName: string;
  userEmail: string;
  score: number;
  signals: string[];
  lastActivity: number;
  recommendation: string;
}

export interface JourneyEvent {
  id: string;
  customerId: string;
  businessId: string;
  action: string;
  metadata: Record<string, any>;
  createdAt: number;
}

// ── Follow-up Types ─────────────────────────────────────────────────────────

export interface ScheduledFollowUp {
  id: string;
  leadId: string;
  businessId: string;
  scheduledAt: number;
  message: string;
  status: 'pending' | 'sent' | 'completed' | 'failed';
  result: string;
  assignedTo: string;
  createdAt: number;
  completedAt: number;
}

// ── Import/Export Types ─────────────────────────────────────────────────────

export interface ImportResult {
  totalRows: number;
  imported: number;
  skipped: number;
  errors: string[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

// tsToMillis imported from shared utils/datetime.ts

const CHUNK_SIZE = 10; // Firestore IN operator max is 10

function currentUser(): any {
  return auth()?.currentUser;
}

function docToLead(id: string, d: any): CrmLead {
  return {
    id,
    businessId: d.businessId ?? '',
    name: d.name ?? '',
    email: d.email ?? '',
    phone: d.phone ?? '',
    companyName: d.companyName ?? '',
    jobTitle: d.jobTitle ?? '',
    source: d.source ?? 'manual',
    status: d.status ?? 'new',
    aiScore: d.aiScore ?? 0,
    assignedTo: d.assignedTo ?? null,
    notes: d.notes ?? '',
    tags: Array.isArray(d.tags) ? d.tags : [],
    customFields: d.customFields ?? {},
    lastFollowUpAt: tsToMillis(d.lastFollowUpAt),
    lastActivityAt: tsToMillis(d.lastActivityAt),
    createdAt: tsToMillis(d.createdAt),
    updatedAt: tsToMillis(d.updatedAt),
  };
}

function docToDeal(id: string, d: any): CrmDeal {
  return {
    id,
    businessId: d.businessId ?? '',
    leadId: d.leadId ?? '',
    title: d.title ?? '',
    description: d.description ?? '',
    stage: d.stage ?? 'lead',
    value: d.value ?? 0,
    currency: d.currency ?? 'USD',
    probability: d.probability ?? 0,
    assignedTo: d.assignedTo ?? null,
    contactName: d.contactName ?? '',
    contactEmail: d.contactEmail ?? '',
    contactPhone: d.contactPhone ?? '',
    companyName: d.companyName ?? '',
    expectedCloseDate: tsToMillis(d.expectedCloseDate),
    actualCloseDate: tsToMillis(d.actualCloseDate),
    tags: Array.isArray(d.tags) ? d.tags : [],
    customFields: d.customFields ?? {},
    createdAt: tsToMillis(d.createdAt),
    updatedAt: tsToMillis(d.updatedAt),
  };
}

function docToScheduledFollowUp(id: string, d: any): ScheduledFollowUp {
  return {
    id,
    leadId: d.leadId ?? '',
    businessId: d.businessId ?? '',
    scheduledAt: tsToMillis(d.scheduledAt),
    message: d.message ?? '',
    status: d.status ?? 'pending',
    result: d.result ?? '',
    assignedTo: d.assignedTo ?? '',
    createdAt: tsToMillis(d.createdAt),
    completedAt: tsToMillis(d.completedAt),
  };
}

function docToJourneyEvent(id: string, d: any): JourneyEvent {
  return {
    id,
    customerId: d.customerId ?? '',
    businessId: d.businessId ?? '',
    action: d.action ?? '',
    metadata: d.metadata ?? {},
    createdAt: tsToMillis(d.createdAt),
  };
}

/**
 * Computes a simple AI score (0–100) based on engagement signals.
 * Uses a weighted heuristic that considers source quality, contact
 * completeness, and engagement level.
 */
function computeAiScore(source: LeadSource, sourceData: LeadSourceData): number {
  let score = 10; // baseline

  // Source quality weight
  const sourceScores: Record<LeadSource, number> = {
    chat: 25,
    affiliate: 30,
    store_visit: 35,
    comment: 15,
    post_engagement: 12,
    manual: 20,
    import: 10,
    referral: 35,
  };
  score += sourceScores[source] || 15;

  // Has email (+20)
  if (sourceData.userEmail) score += 20;
  // Has phone (+15)
  if (sourceData.userPhone) score += 15;
  // Has name (+10)
  if (sourceData.userName) score += 10;
  // Has user ID (registered user) (+15)
  if (sourceData.userId) score += 15;

  // Engagement score from source context
  if (sourceData.engagementScore) {
    score += Math.min(sourceData.engagementScore * 0.3, 15);
  }

  return Math.min(Math.max(Math.round(score), 0), 100);
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. AI LEAD COLLECTION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Creates a lead from various interaction sources (chat, comment,
 * post engagement, store visit, affiliate).
 *
 * Auto-assigns an AI score based on engagement signals.
 * Checks for duplicate leads by email/phone before creating.
 */
export async function collectLeadFromSource(
  source: LeadSource,
  sourceData: LeadSourceData,
): Promise<CrmLead> {
  try {
    console.log(`[CRM] Collecting lead from source: ${source}`);

    // ── Duplicate check by email or phone ──
    const businessId = sourceData.businessId;
    let existingLead: CrmLead | null = null;

    if (sourceData.userEmail) {
      const emailSnap = await firestore()
        .collection('leads')
        .where('businessId', '==', businessId)
        .where('email', '==', sourceData.userEmail.toLowerCase().trim())
        .limit(1)
        .get();
      if (!emailSnap.empty) {
        const d = emailSnap.docs[0].data();
        existingLead = docToLead(emailSnap.docs[0].id, d);
        console.log(`[CRM] Found existing lead by email: ${emailSnap.docs[0].id}`);
      }
    }

    if (!existingLead && sourceData.userPhone) {
      const phoneSnap = await firestore()
        .collection('leads')
        .where('businessId', '==', businessId)
        .where('phone', '==', sourceData.userPhone.trim())
        .limit(1)
        .get();
      if (!phoneSnap.empty) {
        const d = phoneSnap.docs[0].data();
        existingLead = docToLead(phoneSnap.docs[0].id, d);
        console.log(`[CRM] Found existing lead by phone: ${phoneSnap.docs[0].id}`);
      }
    }

    // ── Compute AI score ──
    const aiScore = computeAiScore(source, sourceData);

    // ── Update existing lead or create new one ──
    if (existingLead) {
      // Bump score if new engagement signal is stronger
      const newScore = Math.max(existingLead.aiScore, aiScore);
      const updateData: Record<string, any> = {
        aiScore: newScore,
        lastActivityAt: firestore.FieldValue.serverTimestamp(),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      };

      // Fill in any missing fields from the new source data
      if (!existingLead.name && sourceData.userName) updateData.name = sourceData.userName;
      if (!existingLead.email && sourceData.userEmail) updateData.email = sourceData.userEmail.toLowerCase().trim();
      if (!existingLead.phone && sourceData.userPhone) updateData.phone = sourceData.userPhone.trim();

      await firestore()
        .collection('leads')
        .doc(existingLead.id)
        .update(updateData);

      console.log(`[CRM] Updated existing lead ${existingLead.id}, score: ${existingLead.aiScore} -> ${newScore}`);

      // Fetch and return the updated lead
      const updatedSnap = await firestore().collection('leads').doc(existingLead.id).get();
      return docToLead(existingLead.id, updatedSnap.data());
    }

    // ── Create new lead ──
    const leadName = sourceData.userName || sourceData.userEmail || sourceData.userPhone || 'Unknown Lead';
    const leadData = {
      businessId,
      name: leadName,
      email: sourceData.userEmail ? sourceData.userEmail.toLowerCase().trim() : '',
      phone: sourceData.userPhone ? sourceData.userPhone.trim() : '',
      companyName: '',
      jobTitle: '',
      source,
      status: 'new' as LeadStatus,
      aiScore,
      assignedTo: null,
      notes: sourceData.sourceContext || '',
      tags: [],
      customFields: sourceData.metadata || {},
      lastFollowUpAt: firestore.FieldValue.serverTimestamp(),
      lastActivityAt: firestore.FieldValue.serverTimestamp(),
      createdAt: firestore.FieldValue.serverTimestamp(),
      updatedAt: firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await firestore().collection('leads').add(leadData);
    const snap = await firestore().collection('leads').doc(docRef.id).get();
    console.log(`[CRM] Created new lead ${docRef.id} from ${source}, aiScore: ${aiScore}`);

    return docToLead(docRef.id, snap.data());
  } catch (error: any) {
    console.error('[CRM] collectLeadFromSource error:', error?.message);
    throw error;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. LEAD CRUD
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Creates a new lead manually or programmatically.
 */
export async function createLead(data: CreateLeadData): Promise<CrmLead> {
  try {
    const now = firestore.FieldValue.serverTimestamp();

    const leadDoc = {
      businessId: data.businessId,
      name: data.name.trim(),
      email: data.email?.toLowerCase().trim() || '',
      phone: data.phone?.trim() || '',
      companyName: data.companyName || '',
      jobTitle: data.jobTitle || '',
      source: data.source || 'manual',
      status: data.status || 'new',
      aiScore: data.aiScore ?? 0,
      assignedTo: data.assignedTo || null,
      notes: data.notes || '',
      tags: data.tags || [],
      customFields: data.customFields || {},
      lastFollowUpAt: now,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await firestore().collection('leads').add(leadDoc);
    const snap = await firestore().collection('leads').doc(docRef.id).get();

    console.log(`[CRM] Created lead ${docRef.id}`);
    return docToLead(docRef.id, snap.data());
  } catch (error: any) {
    console.error('[CRM] createLead error:', error?.message);
    throw error;
  }
}

/**
 * Updates an existing lead with partial data.
 */
export async function updateLead(leadId: string, data: Partial<CrmLead>): Promise<void> {
  try {
    const updateData: Record<string, any> = {
      ...data,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    };

    // Normalize email if updated
    if (updateData.email) {
      updateData.email = updateData.email.toLowerCase().trim();
    }
    if (updateData.phone) {
      updateData.phone = updateData.phone.trim();
    }

    await firestore().collection('leads').doc(leadId).update(updateData);
    console.log(`[CRM] Updated lead ${leadId}`);
  } catch (error: any) {
    console.error('[CRM] updateLead error:', error?.message);
    throw error;
  }
}

/**
 * Deletes a lead by ID.
 */
export async function deleteLead(leadId: string): Promise<void> {
  try {
    await firestore().collection('leads').doc(leadId).delete();
    console.log(`[CRM] Deleted lead ${leadId}`);
  } catch (error: any) {
    console.error('[CRM] deleteLead error:', error?.message);
    throw error;
  }
}

/**
 * Fetches leads for a business with optional filters.
 */
export async function fetchLeads(businessId: string, filters?: LeadFilters): Promise<CrmLead[]> {
  try {
    let query: any = firestore()
      .collection('leads')
      .where('businessId', '==', businessId);

    if (filters?.status) {
      query = query.where('status', '==', filters.status);
    }
    if (filters?.source) {
      query = query.where('source', '==', filters.source);
    }
    if (filters?.assignedTo !== undefined) {
      if (filters.assignedTo === null || filters.assignedTo === '') {
        // Firestore doesn't support querying for null with inequality; fetch all and filter client-side
      } else {
        query = query.where('assignedTo', '==', filters.assignedTo);
      }
    }
    if (filters?.minAiScore !== undefined) {
      query = query.where('aiScore', '>=', filters.minAiScore);
    }

    const sortBy = filters?.sortBy || 'createdAt';
    const sortOrder = filters?.sortOrder || 'desc';
    query = query.orderBy(sortBy, sortOrder);

    const limit = filters?.limit || 100;
    query = query.limit(limit);

    const snapshot = await query.get();
    let leads = snapshot.docs.map(docSnap => docToLead(docSnap.id, docSnap.data()));

    // ── Client-side filters ──
    if (filters?.assignedTo === null || filters?.assignedTo === '') {
      leads = leads.filter(l => !l.assignedTo);
    }

    if (filters?.tags && filters.tags.length > 0) {
      leads = leads.filter(l =>
        filters.tags!.some(tag => l.tags.includes(tag)),
      );
    }

    if (filters?.search) {
      const q = filters.search.toLowerCase();
      leads = leads.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        l.companyName.toLowerCase().includes(q) ||
        l.notes.toLowerCase().includes(q),
      );
    }

    console.log(`[CRM] Fetched ${leads.length} leads for business ${businessId}`);
    return leads;
  } catch (error: any) {
    console.error('[CRM] fetchLeads error:', error?.message);
    // Return empty on index errors so the UI doesn't crash
    if (error?.message?.includes('FAILED_PRECONDITION') || error?.message?.includes('index')) {
      console.warn('[CRM] Missing composite index, returning empty leads');
      return [];
    }
    return [];
  }
}

/**
 * Fetches a single lead by ID.
 */
export async function fetchLeadById(leadId: string): Promise<CrmLead | null> {
  try {
    const snap = await firestore().collection('leads').doc(leadId).get();
    if (!snap.exists) return null;
    return docToLead(leadId, snap.data());
  } catch (error: any) {
    console.error('[CRM] fetchLeadById error:', error?.message);
    return null;
  }
}

/**
 * Assigns a lead to a user.
 */
export async function assignLead(leadId: string, assignToUserId: string): Promise<void> {
  try {
    await firestore().collection('leads').doc(leadId).update({
      assignedTo: assignToUserId,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[CRM] Assigned lead ${leadId} to user ${assignToUserId}`);
  } catch (error: any) {
    console.error('[CRM] assignLead error:', error?.message);
    throw error;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. DEAL MANAGEMENT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Creates a new deal. Optionally linked to a lead.
 */
export async function createDeal(data: CreateDealData): Promise<CrmDeal> {
  try {
    const now = firestore.FieldValue.serverTimestamp();

    const dealDoc = {
      businessId: data.businessId,
      leadId: data.leadId || '',
      title: data.title.trim(),
      description: data.description || '',
      stage: data.stage || 'lead',
      value: data.value || 0,
      currency: data.currency || 'USD',
      probability: data.probability ?? 0,
      assignedTo: data.assignedTo || null,
      contactName: data.contactName || '',
      contactEmail: data.contactEmail || '',
      contactPhone: data.contactPhone || '',
      companyName: data.companyName || '',
      expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate).toISOString() : null,
      actualCloseDate: null,
      tags: data.tags || [],
      customFields: data.customFields || {},
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await firestore().collection('deals').add(dealDoc);

    // If linked to a lead, update the lead status
    if (data.leadId) {
      try {
        await firestore().collection('leads').doc(data.leadId).update({
          status: 'qualified',
          updatedAt: firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        console.warn('[CRM] Failed to update linked lead status:', e);
      }
    }

    const snap = await firestore().collection('deals').doc(docRef.id).get();
    console.log(`[CRM] Created deal ${docRef.id}`);
    return docToDeal(docRef.id, snap.data());
  } catch (error: any) {
    console.error('[CRM] createDeal error:', error?.message);
    throw error;
  }
}

/**
 * Updates a deal with partial data.
 */
export async function updateDeal(dealId: string, data: Partial<CrmDeal>): Promise<void> {
  try {
    const updateData: Record<string, any> = {
      ...data,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    };

    // Set actualCloseDate when stage changes to won/lost
    if (data.stage === 'won' || data.stage === 'lost') {
      updateData.actualCloseDate = firestore.FieldValue.serverTimestamp();
    }

    await firestore().collection('deals').doc(dealId).update(updateData);
    console.log(`[CRM] Updated deal ${dealId}`);
  } catch (error: any) {
    console.error('[CRM] updateDeal error:', error?.message);
    throw error;
  }
}

/**
 * Moves a deal to a new pipeline stage.
 */
export async function updateDealStage(dealId: string, stage: DealStage): Promise<void> {
  try {
    const updateData: Record<string, any> = {
      stage,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    };

    // Update probability based on stage
    const stageProbabilities: Record<DealStage, number> = {
      lead: 10,
      qualified: 25,
      proposal: 50,
      negotiation: 75,
      won: 100,
      lost: 0,
    };
    updateData.probability = stageProbabilities[stage];

    // Record actual close date
    if (stage === 'won' || stage === 'lost') {
      updateData.actualCloseDate = firestore.FieldValue.serverTimestamp();
    }

    await firestore().collection('deals').doc(dealId).update(updateData);

    // If deal is won, mark the linked lead as converted
    if (stage === 'won') {
      try {
        const dealSnap = await firestore().collection('deals').doc(dealId).get();
        const dealData = dealSnap.data();
        if (dealData?.leadId) {
          await firestore().collection('leads').doc(dealData.leadId).update({
            status: 'converted',
            updatedAt: firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (e) {
        console.warn(`[CRM] Failed to update lead status on deal win:`, e);
      }
    }

    console.log(`[CRM] Deal ${dealId} moved to stage: ${stage}`);
  } catch (error: any) {
    console.error('[CRM] updateDealStage error:', error?.message);
    throw error;
  }
}

/**
 * Fetches deals for a business with optional filters.
 */
export async function fetchDeals(businessId: string, filters?: DealFilters): Promise<CrmDeal[]> {
  try {
    let query: any = firestore()
      .collection('deals')
      .where('businessId', '==', businessId);

    if (filters?.stage) {
      query = query.where('stage', '==', filters.stage);
    }
    if (filters?.assignedTo !== undefined) {
      if (filters.assignedTo === null || filters.assignedTo === '') {
        // Filter client-side for null assignedTo
      } else {
        query = query.where('assignedTo', '==', filters.assignedTo);
      }
    }
    if (filters?.minValue !== undefined) {
      query = query.where('value', '>=', filters.minValue);
    }

    const sortBy = filters?.sortBy || 'updatedAt';
    const sortOrder = filters?.sortOrder || 'desc';
    query = query.orderBy(sortBy, sortOrder);

    const limit = filters?.limit || 100;
    query = query.limit(limit);

    const snapshot = await query.get();
    let deals = snapshot.docs.map(docSnap => docToDeal(docSnap.id, docSnap.data()));

    // ── Client-side filters ──
    if (filters?.assignedTo === null || filters?.assignedTo === '') {
      deals = deals.filter(d => !d.assignedTo);
    }

    if (filters?.maxValue !== undefined) {
      deals = deals.filter(d => d.value <= filters.maxValue!);
    }

    if (filters?.search) {
      const q = filters.search.toLowerCase();
      deals = deals.filter(d =>
        d.title.toLowerCase().includes(q) ||
        d.contactName.toLowerCase().includes(q) ||
        d.companyName.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q),
      );
    }

    console.log(`[CRM] Fetched ${deals.length} deals for business ${businessId}`);
    return deals;
  } catch (error: any) {
    console.error('[CRM] fetchDeals error:', error?.message);
    if (error?.message?.includes('FAILED_PRECONDITION') || error?.message?.includes('index')) {
      console.warn('[CRM] Missing composite index, returning empty deals');
      return [];
    }
    return [];
  }
}

/**
 * Deletes a deal by ID.
 */
export async function deleteDeal(dealId: string): Promise<void> {
  try {
    // Delete associated activities (subcollection)
    const activitiesSnap = await firestore()
      .collection('deals')
      .doc(dealId)
      .collection('activities')
      .limit(500)
      .get();

    const deletePromises = activitiesSnap.docs.map(docSnap =>
      firestore().collection('deals').doc(dealId).collection('activities').doc(docSnap.id).delete(),
    );
    await Promise.all(deletePromises);

    // Delete the deal itself
    await firestore().collection('deals').doc(dealId).delete();
    console.log(`[CRM] Deleted deal ${dealId} and ${activitiesSnap.docs.length} activities`);
  } catch (error: any) {
    console.error('[CRM] deleteDeal error:', error?.message);
    throw error;
  }
}

/**
 * Adds an activity log entry to a deal (call, email, meeting, note, etc.).
 */
export async function addDealActivity(dealId: string, activity: DealActivity): Promise<void> {
  try {
    const userId = currentUser()?.uid;

    await firestore()
      .collection('deals')
      .doc(dealId)
      .collection('activities')
      .add({
        type: activity.type,
        subject: activity.subject,
        notes: activity.notes,
        userId: activity.userId || userId || null,
        metadata: activity.metadata || {},
        createdAt: firestore.FieldValue.serverTimestamp(),
      });

    // Update the deal's updatedAt timestamp
    await firestore().collection('deals').doc(dealId).update({
      updatedAt: firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[CRM] Added ${activity.type} activity to deal ${dealId}`);
  } catch (error: any) {
    console.error('[CRM] addDealActivity error:', error?.message);
    throw error;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. DATA MANAGEMENT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Exports all leads for a business as a CSV string.
 */
export async function exportLeadsCSV(businessId: string): Promise<string> {
  try {
    const snapshot = await firestore()
      .collection('leads')
      .where('businessId', '==', businessId)
      .limit(1000)
      .get();

    const headers = [
      'ID', 'Name', 'Email', 'Phone', 'Company', 'Job Title',
      'Source', 'Status', 'AI Score', 'Assigned To', 'Tags',
      'Notes', 'Created At', 'Updated At', 'Last Activity',
    ];

    const escapeCSV = (val: string): string => {
      if (!val) return '""';
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const rows = snapshot.docs.map(docSnap => {
      const d = docSnap.data();
      const lead = docToLead(docSnap.id, d);
      const tags = (lead.tags || []).join('; ');
      return [
        lead.id,
        escapeCSV(lead.name),
        escapeCSV(lead.email),
        escapeCSV(lead.phone),
        escapeCSV(lead.companyName),
        escapeCSV(lead.jobTitle),
        lead.source,
        lead.status,
        String(lead.aiScore),
        lead.assignedTo || '',
        escapeCSV(tags),
        escapeCSV(lead.notes),
        new Date(lead.createdAt).toISOString(),
        new Date(lead.updatedAt).toISOString(),
        new Date(lead.lastActivityAt).toISOString(),
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    console.log(`[CRM] Exported ${snapshot.docs.length} leads to CSV`);
    return csv;
  } catch (error: any) {
    console.error('[CRM] exportLeadsCSV error:', error?.message);
    throw error;
  }
}

/**
 * Exports all deals for a business as a CSV string.
 */
export async function exportDealsCSV(businessId: string): Promise<string> {
  try {
    const snapshot = await firestore()
      .collection('deals')
      .where('businessId', '==', businessId)
      .limit(1000)
      .get();

    const headers = [
      'ID', 'Title', 'Lead ID', 'Stage', 'Value', 'Currency',
      'Probability', 'Assigned To', 'Contact Name', 'Contact Email',
      'Company', 'Expected Close', 'Actual Close', 'Tags',
      'Created At', 'Updated At',
    ];

    const escapeCSV = (val: string): string => {
      if (!val) return '""';
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const rows = snapshot.docs.map(docSnap => {
      const deal = docToDeal(docSnap.id, docSnap.data());
      const tags = (deal.tags || []).join('; ');
      return [
        deal.id,
        escapeCSV(deal.title),
        deal.leadId,
        deal.stage,
        String(deal.value),
        deal.currency,
        String(deal.probability),
        deal.assignedTo || '',
        escapeCSV(deal.contactName),
        escapeCSV(deal.contactEmail),
        escapeCSV(deal.companyName),
        deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toISOString() : '',
        deal.actualCloseDate ? new Date(deal.actualCloseDate).toISOString() : '',
        escapeCSV(tags),
        new Date(deal.createdAt).toISOString(),
        new Date(deal.updatedAt).toISOString(),
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    console.log(`[CRM] Exported ${snapshot.docs.length} deals to CSV`);
    return csv;
  } catch (error: any) {
    console.error('[CRM] exportDealsCSV error:', error?.message);
    throw error;
  }
}

/**
 * Imports leads from CSV data string into a business.
 * Expected columns: Name, Email, Phone, Company, Job Title, Source, Tags, Notes
 */
export async function importLeadsFromCSV(csvData: string, businessId: string): Promise<ImportResult> {
  const result: ImportResult = { totalRows: 0, imported: 0, skipped: 0, errors: [] };

  try {
    const lines = csvData.trim().split('\n');
    if (lines.length < 2) {
      result.errors.push('CSV must have a header row and at least one data row.');
      return result;
    }

    // Parse header row
    const headerLine = lines[0];
    const headers = parseCSVLine(headerLine).map(h => h.trim().toLowerCase());

    const nameIdx = headers.indexOf('name');
    const emailIdx = headers.indexOf('email');
    const phoneIdx = headers.indexOf('phone');
    const companyIdx = headers.indexOf('company');
    const jobTitleIdx = headers.indexOf('job title') !== -1 ? headers.indexOf('job title') : headers.indexOf('jobtitle');
    const sourceIdx = headers.indexOf('source');
    const tagsIdx = headers.indexOf('tags');
    const notesIdx = headers.indexOf('notes');

    if (nameIdx === -1) {
      result.errors.push('CSV must have a "Name" column.');
      return result;
    }

    result.totalRows = lines.length - 1;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const cols = parseCSVLine(line);
        const name = (cols[nameIdx] || '').trim();
        if (!name) {
          result.skipped++;
          result.errors.push(`Row ${i + 1}: Missing name, skipped.`);
          continue;
        }

        const email = emailIdx !== -1 ? (cols[emailIdx] || '').trim().toLowerCase() : '';
        const phone = phoneIdx !== -1 ? (cols[phoneIdx] || '').trim() : '';
        const companyName = companyIdx !== -1 ? (cols[companyIdx] || '').trim() : '';
        const jobTitle = jobTitleIdx !== -1 ? (cols[jobTitleIdx] || '').trim() : '';
        const source = sourceIdx !== -1 ? (cols[sourceIdx] || '').trim() : 'import';
        const tags = tagsIdx !== -1
          ? (cols[tagsIdx] || '').split(';').map(t => t.trim()).filter(Boolean)
          : [];
        const notes = notesIdx !== -1 ? (cols[notesIdx] || '').trim() : '';

        // Validate source
        const validSources: LeadSource[] = ['chat', 'comment', 'post_engagement', 'store_visit', 'affiliate', 'manual', 'import', 'referral'];
        const normalizedSource: LeadSource = validSources.includes(source as LeadSource) ? (source as LeadSource) : 'import';

        await createLead({
          businessId,
          name,
          email: email || undefined,
          phone: phone || undefined,
          companyName: companyName || undefined,
          jobTitle: jobTitle || undefined,
          source: normalizedSource,
          notes,
          tags,
        });

        result.imported++;
      } catch (rowErr: any) {
        result.skipped++;
        result.errors.push(`Row ${i + 1}: ${rowErr?.message || 'Unknown error'}`);
      }
    }

    console.log(`[CRM] Import complete: ${result.imported} imported, ${result.skipped} skipped`);
    return result;
  } catch (error: any) {
    console.error('[CRM] importLeadsFromCSV error:', error?.message);
    result.errors.push(`Import failed: ${error?.message}`);
    return result;
  }
}

/**
 * Simple CSV line parser that handles quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

/**
 * Bulk deletes multiple leads. Returns the count of successfully deleted leads.
 */
export async function bulkDeleteLeads(leadIds: string[]): Promise<number> {
  let deletedCount = 0;

  try {
    // Process in chunks of CHUNK_SIZE to avoid Firestore limits
    for (let i = 0; i < leadIds.length; i += CHUNK_SIZE) {
      const chunk = leadIds.slice(i, i + CHUNK_SIZE);

      const deletePromises = chunk.map(async leadId => {
        try {
          await firestore().collection('leads').doc(leadId).delete();
          return 1;
        } catch (e) {
          console.warn(`[CRM] Failed to delete lead ${leadId}:`, e);
          return 0;
        }
      });

      const results = await Promise.all(deletePromises);
      deletedCount += results.reduce((sum: number, r: number) => sum + r, 0);
    }

    console.log(`[CRM] Bulk deleted ${deletedCount}/${leadIds.length} leads`);
    return deletedCount;
  } catch (error: any) {
    console.error('[CRM] bulkDeleteLeads error:', error?.message);
    return deletedCount;
  }
}

/**
 * Bulk updates the status of multiple leads at once.
 */
export async function bulkUpdateLeadStatus(leadIds: string[], status: string): Promise<void> {
  try {
    for (let i = 0; i < leadIds.length; i += CHUNK_SIZE) {
      const chunk = leadIds.slice(i, i + CHUNK_SIZE);

      const updatePromises = chunk.map(async leadId => {
        try {
          await firestore().collection('leads').doc(leadId).update({
            status,
            updatedAt: firestore.FieldValue.serverTimestamp(),
          });
        } catch (e) {
          console.warn(`[CRM] Failed to update lead ${leadId} status:`, e);
        }
      });

      await Promise.all(updatePromises);
    }

    console.log(`[CRM] Bulk updated ${leadIds.length} leads to status: ${status}`);
  } catch (error: any) {
    console.error('[CRM] bulkUpdateLeadStatus error:', error?.message);
    throw error;
  }
}

/**
 * Gets aggregate lead statistics for a business.
 */
export async function getLeadStats(businessId: string): Promise<LeadStats> {
  try {
    const snapshot = await firestore()
      .collection('leads')
      .where('businessId', '==', businessId)
      .limit(10000)
      .get();

    const stats: LeadStats = {
      total: 0,
      new: 0,
      contacted: 0,
      qualified: 0,
      unqualified: 0,
      converted: 0,
      lost: 0,
      avgAiScore: 0,
      assignedCount: 0,
      unassignedCount: 0,
    };

    let totalScore = 0;

    snapshot.docs.forEach(docSnap => {
      const d = docSnap.data();
      stats.total++;

      const status = d.status as LeadStatus;
      if (status === 'new') stats.new++;
      else if (status === 'contacted') stats.contacted++;
      else if (status === 'qualified') stats.qualified++;
      else if (status === 'unqualified') stats.unqualified++;
      else if (status === 'converted') stats.converted++;
      else if (status === 'lost') stats.lost++;

      totalScore += d.aiScore || 0;

      if (d.assignedTo) stats.assignedCount++;
      else stats.unassignedCount++;
    });

    stats.avgAiScore = stats.total > 0 ? Math.round(totalScore / stats.total) : 0;

    console.log(`[CRM] Lead stats for ${businessId}: ${stats.total} total`);
    return stats;
  } catch (error: any) {
    console.error('[CRM] getLeadStats error:', error?.message);
    return {
      total: 0, new: 0, contacted: 0, qualified: 0,
      unqualified: 0, converted: 0, lost: 0, avgAiScore: 0,
      assignedCount: 0, unassignedCount: 0,
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. BUSINESS ANALYTICS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Fetches comprehensive analytics for a business over a time period.
 */
export async function fetchBusinessAnalytics(
  businessId: string,
  period: '7d' | '30d' | '90d' | 'all' = '30d',
): Promise<BusinessAnalytics> {
  try {
    const now = Date.now();
    const periodMs = period === '7d' ? 7 * 86400000
      : period === '30d' ? 30 * 86400000
      : period === '90d' ? 90 * 86400000
      : 0; // 'all' — no time filter
    const cutoff = periodMs > 0 ? new Date(now - periodMs).toISOString() : null;

    // Fetch leads for the period
    let leadsQuery: any = firestore()
      .collection('leads')
      .where('businessId', '==', businessId)
      .limit(10000);

    const leadsSnap = await leadsQuery.get();
    const allLeads = leadsSnap.docs.map(docSnap => docToLead(docSnap.id, docSnap.data()));

    // Filter by period client-side (timestamps are ISO strings or millis)
    const leads = cutoff
      ? allLeads.filter(l => new Date(l.createdAt).toISOString() >= cutoff)
      : allLeads;

    // Fetch deals
    let dealsQuery: any = firestore()
      .collection('deals')
      .where('businessId', '==', businessId)
      .limit(10000);

    const dealsSnap = await dealsQuery.get();
    const allDeals = dealsSnap.docs.map(docSnap => docToDeal(docSnap.id, docSnap.data()));

    const deals = cutoff
      ? allDeals.filter(d => new Date(d.createdAt).toISOString() >= cutoff)
      : allDeals;

    // Also fetch previous period for change calculations
    const prevCutoff = cutoff ? new Date(new Date(cutoff).getTime() - periodMs).toISOString() : null;
    const prevLeads = prevCutoff && cutoff
      ? allLeads.filter(l => {
          const iso = new Date(l.createdAt).toISOString();
          return iso >= prevCutoff && iso < cutoff;
        })
      : [];
    const prevDeals = prevCutoff && cutoff
      ? allDeals.filter(d => {
          const iso = new Date(d.createdAt).toISOString();
          return iso >= prevCutoff && iso < cutoff;
        })
      : [];

    // ── Calculate metrics ──
    const wonDeals = deals.filter(d => d.stage === 'won');
    const lostDeals = deals.filter(d => d.stage === 'lost');
    const activeDeals = deals.filter(d => d.stage !== 'won' && d.stage !== 'lost');
    const totalRevenue = wonDeals.reduce((sum, d) => sum + d.value, 0);
    const prevRevenue = prevDeals.filter(d => d.stage === 'won').reduce((sum, d) => sum + d.value, 0);
    const revenueChange = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0;
    const leadsChange = prevLeads.length > 0
      ? ((leads.length - prevLeads.length) / prevLeads.length) * 100
      : 0;

    const prevConverted = prevLeads.filter(l => l.status === 'converted').length;
    const converted = leads.filter(l => l.status === 'converted').length;
    const conversionRate = leads.length > 0 ? (converted / leads.length) * 100 : 0;
    const prevConversionRate = prevLeads.length > 0 ? (prevConverted / prevLeads.length) * 100 : 0;
    const conversionChange = prevConversionRate > 0
      ? ((conversionRate - prevConversionRate) / prevConversionRate) * 100
      : 0;

    const avgDealValue = wonDeals.length > 0 ? totalRevenue / wonDeals.length : 0;

    // Revenue by source
    const revenueBySource: Record<string, number> = {};
    for (const deal of wonDeals) {
      if (deal.leadId) {
        const lead = allLeads.find(l => l.id === deal.leadId);
        const source = lead?.source || 'manual';
        revenueBySource[source] = (revenueBySource[source] || 0) + deal.value;
      } else {
        revenueBySource['manual'] = (revenueBySource['manual'] || 0) + deal.value;
      }
    }

    // Leads by status
    const leadsByStatus: Record<string, number> = {};
    for (const lead of leads) {
      leadsByStatus[lead.status] = (leadsByStatus[lead.status] || 0) + 1;
    }

    // Deals by stage
    const dealsByStage: Record<string, number> = {};
    for (const deal of deals) {
      dealsByStage[deal.stage] = (dealsByStage[deal.stage] || 0) + 1;
    }

    // Top source by lead count
    const sourceCounts: Record<string, number> = {};
    for (const lead of leads) {
      sourceCounts[lead.source] = (sourceCounts[lead.source] || 0) + 1;
    }
    const topSource = (Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'manual') as LeadSource;

    const analytics: BusinessAnalytics = {
      period,
      totalRevenue,
      revenueChange: Math.round(revenueChange * 10) / 10,
      totalLeads: leads.length,
      leadsChange: Math.round(leadsChange * 10) / 10,
      conversionRate: Math.round(conversionRate * 10) / 10,
      conversionChange: Math.round(conversionChange * 10) / 10,
      activeDeals: activeDeals.length,
      wonDeals: wonDeals.length,
      lostDeals: lostDeals.length,
      avgDealValue: Math.round(avgDealValue * 100) / 100,
      topSource,
      revenueBySource: revenueBySource as Record<LeadSource, number>,
      leadsByStatus: leadsByStatus as Record<LeadStatus, number>,
      dealsByStage: dealsByStage as Record<DealStage, number>,
    };

    console.log(`[CRM] Analytics for ${businessId} (${period}): ${leads.length} leads, $${totalRevenue} revenue`);
    return analytics;
  } catch (error: any) {
    console.error('[CRM] fetchBusinessAnalytics error:', error?.message);
    return {
      period,
      totalRevenue: 0, revenueChange: 0,
      totalLeads: 0, leadsChange: 0,
      conversionRate: 0, conversionChange: 0,
      activeDeals: 0, wonDeals: 0, lostDeals: 0,
      avgDealValue: 0, topSource: 'manual',
      revenueBySource: {} as Record<LeadSource, number>,
      leadsByStatus: {} as Record<LeadStatus, number>,
      dealsByStage: {} as Record<DealStage, number>,
    };
  }
}

/**
 * Fetches revenue chart data points for a business.
 */
export async function fetchRevenueChart(businessId: string, period: string = '30d'): Promise<ChartDataPoint[]> {
  try {
    const periodMs = period === '7d' ? 7 * 86400000
      : period === '30d' ? 30 * 86400000
      : period === '90d' ? 90 * 86400000
      : 30 * 86400000;

    const now = Date.now();
    const cutoff = now - periodMs;

    const snapshot = await firestore()
      .collection('deals')
      .where('businessId', '==', businessId)
      .limit(10000)
      .get();

    const deals = snapshot.docs.map(docSnap => docToDeal(docSnap.id, docSnap.data()))
      .filter(d => d.stage === 'won' && d.actualCloseDate >= cutoff);

    // Group by day
    const dayMap: Record<string, number> = {};
    for (const deal of deals) {
      const day = new Date(deal.actualCloseDate).toISOString().split('T')[0];
      dayMap[day] = (dayMap[day] || 0) + deal.value;
    }

    // Generate all days in range
    const points: ChartDataPoint[] = [];
    const dayCount = Math.ceil(periodMs / 86400000);
    for (let i = dayCount - 1; i >= 0; i--) {
      const date = new Date(cutoff + i * 86400000);
      const dayKey = date.toISOString().split('T')[0];
      points.push({
        label: dayKey,
        value: dayMap[dayKey] || 0,
        date: date.getTime(),
      });
    }

    console.log(`[CRM] Revenue chart: ${points.length} data points`);
    return points;
  } catch (error: any) {
    console.error('[CRM] fetchRevenueChart error:', error?.message);
    return [];
  }
}

/**
 * Fetches the lead conversion funnel data.
 */
export async function fetchLeadConversionFunnel(businessId: string): Promise<FunnelData> {
  try {
    const snapshot = await firestore()
      .collection('leads')
      .where('businessId', '==', businessId)
      .limit(10000)
      .get();

    const leads = snapshot.docs.map(docSnap => docToLead(docSnap.id, docSnap.data()));

    const stages = [
      { stage: 'New', status: 'new' as LeadStatus },
      { stage: 'Contacted', status: 'contacted' as LeadStatus },
      { stage: 'Qualified', status: 'qualified' as LeadStatus },
      { stage: 'Converted', status: 'converted' as LeadStatus },
    ];

    const funnelStages = stages.map((s, idx) => {
      const count = leads.filter(l => l.status === s.status).length;
      const prevCount = idx > 0
        ? leads.filter(l => l.status === stages[idx - 1].status).length
        : leads.length;
      const conversionRate = prevCount > 0 ? Math.round((count / prevCount) * 100) : 0;

      return {
        stage: s.stage,
        count,
        value: 0, // Value is tracked at deal level, not lead level
        conversionRate,
      };
    });

    const totalConverted = leads.filter(l => l.status === 'converted').length;
    const totalLeads = leads.length;

    // Also get deal values for won deals to compute funnel value
    const dealsSnap = await firestore()
      .collection('deals')
      .where('businessId', '==', businessId)
      .where('stage', '==', 'won')
      .limit(10000)
      .get();

    const wonValue = dealsSnap.docs.reduce((sum, docSnap) => {
      return sum + (docSnap.data().value || 0);
    }, 0);

    // Assign cumulative value to each funnel stage
    const stageValueRatios = [0.1, 0.3, 0.6, 1.0];
    funnelStages.forEach((s, idx) => {
      s.value = Math.round(wonValue * stageValueRatios[idx] * 100) / 100;
    });

    const overallConversionRate = totalLeads > 0
      ? Math.round((totalConverted / totalLeads) * 100)
      : 0;

    console.log(`[CRM] Funnel: ${totalLeads} leads, ${totalConverted} converted (${overallConversionRate}%)`);

    return {
      stages: funnelStages,
      totalLeads,
      totalConverted,
      overallConversionRate,
    };
  } catch (error: any) {
    console.error('[CRM] fetchLeadConversionFunnel error:', error?.message);
    return {
      stages: [
        { stage: 'New', count: 0, value: 0, conversionRate: 0 },
        { stage: 'Contacted', count: 0, value: 0, conversionRate: 0 },
        { stage: 'Qualified', count: 0, value: 0, conversionRate: 0 },
        { stage: 'Converted', count: 0, value: 0, conversionRate: 0 },
      ],
      totalLeads: 0,
      totalConverted: 0,
      overallConversionRate: 0,
    };
  }
}

/**
 * Fetches top-selling products for a business.
 */
export async function fetchTopProducts(businessId: string, limit: number = 10): Promise<ProductStat[]> {
  try {
    const ordersSnap = await firestore()
      .collection('orders')
      .where('businessId', '==', businessId)
      .limit(10000)
      .get();

    // Aggregate product data from order items
    const productMap: Record<string, ProductStat> = {};

    for (const docSnap of ordersSnap.docs) {
      const orderData = docSnap.data();
      let items: any[] = [];

      if (typeof orderData.items === 'string') {
        try { items = JSON.parse(orderData.items); } catch { items = []; }
      } else if (Array.isArray(orderData.items)) {
        items = orderData.items;
      }

      for (const item of items) {
        const pid = item.productId || item.id || '';
        if (!pid) continue;

        if (!productMap[pid]) {
          productMap[pid] = {
            productId: pid,
            productName: item.productName || item.name || 'Unknown Product',
            totalSold: 0,
            totalRevenue: 0,
            orderCount: 0,
            avgRating: 0,
            category: item.category || '',
          };
        }

        const stat = productMap[pid];
        stat.totalSold += item.quantity || 1;
        stat.totalRevenue += (item.price || 0) * (item.quantity || 1);
        stat.orderCount++;
      }
    }

    // Fetch ratings for products
    const productIds = Object.keys(productMap);
    for (let i = 0; i < productIds.length; i += CHUNK_SIZE) {
      const chunk = productIds.slice(i, i + CHUNK_SIZE);
      try {
        const reviewsSnaps = await Promise.all(
          chunk.map(pid =>
            firestore()
              .collection('reviews')
              .where('productId', '==', pid)
              .limit(100)
              .get()
              .catch(() => ({ docs: [] })),
          ),
        );

        reviewsSnaps.forEach((snap, idx) => {
          const pid = chunk[idx];
          if (snap.docs && snap.docs.length > 0) {
            const totalRating = snap.docs.reduce((sum: number, d: any) => sum + (d.data()?.rating || 0), 0);
            productMap[pid].avgRating = Math.round((totalRating / snap.docs.length) * 10) / 10;
          }
        });
      } catch (e) {
        console.warn('[CRM] Failed to fetch reviews for product chunk:', e);
      }
    }

    // Sort by totalRevenue descending and take top N
    const sorted = Object.values(productMap)
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);

    console.log(`[CRM] Top ${limit} products for business ${businessId}`);
    return sorted;
  } catch (error: any) {
    console.error('[CRM] fetchTopProducts error:', error?.message);
    return [];
  }
}

/**
 * Fetches customer statistics for a business.
 */
export async function fetchCustomerStats(businessId: string): Promise<CustomerStats> {
  try {
    const ordersSnap = await firestore()
      .collection('orders')
      .where('businessId', '==', businessId)
      .limit(10000)
      .get();

    const customerMap: Record<string, {
      name: string;
      totalSpent: number;
      orderCount: number;
      lastOrderDate: number;
    }> = {};

    let totalRevenue = 0;
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 86400000;

    for (const docSnap of ordersSnap.docs) {
      const d = docSnap.data();
      const buyerId = d.buyerId || '';
      const total = d.total || 0;
      const createdAt = tsToMillis(d.createdAt);

      totalRevenue += total;

      if (!customerMap[buyerId]) {
        customerMap[buyerId] = {
          name: d.buyerName || 'Unknown',
          totalSpent: 0,
          orderCount: 0,
          lastOrderDate: 0,
        };
      }

      customerMap[buyerId].totalSpent += total;
      customerMap[buyerId].orderCount++;
      if (createdAt > customerMap[buyerId].lastOrderDate) {
        customerMap[buyerId].lastOrderDate = createdAt;
      }
    }

    const totalCustomers = Object.keys(customerMap).length;
    const newCustomers = Object.values(customerMap).filter(c => c.lastOrderDate >= thirtyDaysAgo).length;
    const returningCustomers = Object.values(customerMap).filter(c => c.orderCount > 1).length;
    const totalOrders = ordersSnap.docs.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const retentionRate = totalCustomers > 0
      ? Math.round((returningCustomers / totalCustomers) * 100)
      : 0;

    // Top customers
    const topCustomers = Object.entries(customerMap)
      .map(([id, c]) => ({
        customerId: id,
        customerName: c.name,
        totalSpent: Math.round(c.totalSpent * 100) / 100,
        orderCount: c.orderCount,
        lastOrderDate: c.lastOrderDate,
      }))
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10);

    console.log(`[CRM] Customer stats: ${totalCustomers} customers, $${Math.round(totalRevenue)} revenue`);

    return {
      totalCustomers,
      newCustomers,
      returningCustomers,
      avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      totalOrders,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      topCustomers,
      retentionRate,
    };
  } catch (error: any) {
    console.error('[CRM] fetchCustomerStats error:', error?.message);
    return {
      totalCustomers: 0, newCustomers: 0, returningCustomers: 0,
      avgOrderValue: 0, totalOrders: 0, totalRevenue: 0,
      topCustomers: [], retentionRate: 0,
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. POTENTIAL CUSTOMER IDENTIFICATION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Identifies potential customers based on engagement signals.
 * Looks at users who have interacted with the business (messages,
 * comments, likes, store visits) but are not yet leads.
 */
export async function identifyPotentialCustomers(businessId: string): Promise<PotentialCustomer[]> {
  try {
    console.log(`[CRM] Identifying potential customers for ${businessId}`);

    // Get existing lead emails/phones so we can exclude them
    const existingLeads = await firestore()
      .collection('leads')
      .where('businessId', '==', businessId)
      .limit(10000)
      .get();

    const existingEmails = new Set<string>();
    const existingPhones = new Set<string>();
    const existingUserIds = new Set<string>();

    existingLeads.docs.forEach(docSnap => {
      const d = docSnap.data();
      if (d.email) existingEmails.add(d.email.toLowerCase());
      if (d.phone) existingPhones.add(d.phone);
    });

    // ── Signal 1: Users who messaged the business chats ──
    const businessDoc = await firestore().collection('businesses').doc(businessId).get();
    const businessData = businessDoc.exists ? businessDoc.data() : null;
    const businessOwnerId = businessData?.ownerId || '';

    const candidateMap: Record<string, PotentialCustomer> = {};

    // Find chats involving the business owner
    const chats1 = await firestore()
      .collection('chats')
      .where('user1Id', '==', businessOwnerId)
      .limit(500)
      .get();
    const chats2 = await firestore()
      .collection('chats')
      .where('user2Id', '==', businessOwnerId)
      .limit(500)
      .get();

    const chatDocs = [...chats1.docs, ...chats2.docs];

    for (const chatDoc of chatDocs) {
      const cd = chatDoc.data();
      const otherId = cd.user1Id === businessOwnerId ? cd.user2Id : cd.user1Id;
      if (!otherId || otherId === businessOwnerId) continue;
      if (existingUserIds.has(otherId)) continue;

      try {
        const userSnap = await firestore().collection('users').doc(otherId).get();
        if (!userSnap.exists) continue;
        const ud = userSnap.data();

        if (existingEmails.has((ud?.email || '').toLowerCase())) continue;

        if (!candidateMap[otherId]) {
          candidateMap[otherId] = {
            userId: otherId,
            userName: ud?.displayName || ud?.username || '',
            userEmail: ud?.email || '',
            score: 0,
            signals: [],
            lastActivity: 0,
            recommendation: '',
          };
        }

        candidateMap[otherId].score += 20;
        candidateMap[otherId].signals.push('Sent messages');
        const chatTime = tsToMillis(cd.lastMessageTime);
        if (chatTime > candidateMap[otherId].lastActivity) {
          candidateMap[otherId].lastActivity = chatTime;
        }
      } catch {
        // Skip if user doc not found
      }
    }

    // ── Signal 2: Users who commented on business posts ──
    const postsSnap = await firestore()
      .collection('posts')
      .where('authorId', '==', businessOwnerId)
      .limit(100)
      .get();

    const postIds = postsSnap.docs.map(d => d.id);

    for (let i = 0; i < postIds.length; i += CHUNK_SIZE) {
      const chunk = postIds.slice(i, i + CHUNK_SIZE);
      try {
        const commentsSnap = await firestore()
          .collection('post_comments')
          .where('postId', 'in', chunk)
          .limit(500)
          .get();

        for (const commentDoc of commentsSnap.docs) {
          const cData = commentDoc.data();
          const commentUserId = cData.authorId;
          if (!commentUserId || commentUserId === businessOwnerId) continue;

          if (!candidateMap[commentUserId]) {
            candidateMap[commentUserId] = {
              userId: commentUserId,
              userName: cData.authorDisplayName || '',
              userEmail: '',
              score: 0,
              signals: [],
              lastActivity: 0,
              recommendation: '',
            };
          }

          candidateMap[commentUserId].score += 10;
          if (!candidateMap[commentUserId].signals.includes('Commented on posts')) {
            candidateMap[commentUserId].signals.push('Commented on posts');
          }
          const commentTime = tsToMillis(cData.createdAt);
          if (commentTime > candidateMap[commentUserId].lastActivity) {
            candidateMap[commentUserId].lastActivity = commentTime;
          }
        }
      } catch (e) {
        console.warn('[CRM] Failed to fetch comments for post chunk:', e);
      }
    }

    // ── Signal 3: Users who liked business posts ──
    for (let i = 0; i < postIds.length; i += CHUNK_SIZE) {
      const chunk = postIds.slice(i, i + CHUNK_SIZE);
      try {
        const likesSnap = await firestore()
          .collection('post_likes')
          .where('postId', 'in', chunk)
          .limit(500)
          .get();

        for (const likeDoc of likesSnap.docs) {
          const lData = likeDoc.data();
          const likerId = lData.userId;
          if (!likerId || likerId === businessOwnerId) continue;

          if (!candidateMap[likerId]) {
            candidateMap[likerId] = {
              userId: likerId,
              userName: '',
              userEmail: '',
              score: 0,
              signals: [],
              lastActivity: 0,
              recommendation: '',
            };
          }

          candidateMap[likerId].score += 5;
          if (!candidateMap[likerId].signals.includes('Liked posts')) {
            candidateMap[likerId].signals.push('Liked posts');
          }
        }
      } catch (e) {
        console.warn('[CRM] Failed to fetch likes for post chunk:', e);
      }
    }

    // ── Signal 4: Users who ordered from the business ──
    const ordersSnap = await firestore()
      .collection('orders')
      .where('businessId', '==', businessId)
      .limit(500)
      .get();

    for (const orderDoc of ordersSnap.docs) {
      const oData = orderDoc.data();
      const buyerId = oData.buyerId;
      if (!buyerId || buyerId === businessOwnerId) continue;

      if (!candidateMap[buyerId]) {
        candidateMap[buyerId] = {
          userId: buyerId,
          userName: oData.buyerName || '',
          userEmail: oData.buyerEmail || '',
          score: 0,
          signals: [],
          lastActivity: 0,
          recommendation: '',
        };
      }

      candidateMap[buyerId].score += 30;
      if (!candidateMap[buyerId].signals.includes('Previous customer')) {
        candidateMap[buyerId].signals.push('Previous customer');
      }
      const orderTime = tsToMillis(oData.createdAt);
      if (orderTime > candidateMap[buyerId].lastActivity) {
        candidateMap[buyerId].lastActivity = orderTime;
      }
    }

    // ── Build recommendations ──
    const results = Object.values(candidateMap)
      .filter(c => c.score >= 10)
      .map(customer => {
        if (customer.score >= 50) {
          customer.recommendation = 'High priority — strong engagement signals';
        } else if (customer.score >= 30) {
          customer.recommendation = 'Medium priority — some engagement detected';
        } else {
          customer.recommendation = 'Low priority — minimal engagement';
        }
        return customer;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    console.log(`[CRM] Found ${results.length} potential customers`);
    return results;
  } catch (error: any) {
    console.error('[CRM] identifyPotentialCustomers error:', error?.message);
    return [];
  }
}

/**
 * Tracks a customer's behavior/action for a business (page views,
 * product clicks, cart adds, purchases, etc.).
 */
export async function trackCustomerBehavior(
  businessId: string,
  customerId: string,
  action: string,
  metadata?: any,
): Promise<void> {
  try {
    await firestore()
      .collection('customer_behavior')
      .add({
        businessId,
        customerId,
        action,
        metadata: metadata || {},
        createdAt: firestore.FieldValue.serverTimestamp(),
      });

    // Also store in the journey subcollection under the customer
    await firestore()
      .collection('customer_journeys')
      .doc(`${customerId}_${businessId}`)
      .collection('events')
      .add({
        customerId,
        businessId,
        action,
        metadata: metadata || {},
        createdAt: firestore.FieldValue.serverTimestamp(),
      });

    console.log(`[CRM] Tracked behavior: ${action} for customer ${customerId}`);
  } catch (error: any) {
    console.error('[CRM] trackCustomerBehavior error:', error?.message);
    throw error;
  }
}

/**
 * Gets the full journey timeline for a customer within a business.
 */
export async function getCustomerJourney(
  customerId: string,
  businessId: string,
): Promise<JourneyEvent[]> {
  try {
    // Try journey subcollection first
    let events: JourneyEvent[] = [];

    try {
      const journeySnap = await firestore()
        .collection('customer_journeys')
        .doc(`${customerId}_${businessId}`)
        .collection('events')
        .orderBy('createdAt', 'desc')
        .limit(200)
        .get();

      events = journeySnap.docs.map(docSnap =>
        docToJourneyEvent(docSnap.id, docSnap.data()),
      );
    } catch (e) {
      console.warn('[CRM] Journey subcollection not found, trying flat collection');
    }

    // Also fetch from the flat behavior collection
    if (events.length === 0) {
      const behaviorSnap = await firestore()
        .collection('customer_behavior')
        .where('customerId', '==', customerId)
        .where('businessId', '==', businessId)
        .orderBy('createdAt', 'desc')
        .limit(200)
        .get();

      events = behaviorSnap.docs.map(docSnap =>
        docToJourneyEvent(docSnap.id, docSnap.data()),
      );
    }

    // Sort ascending (oldest first)
    events.sort((a, b) => a.createdAt - b.createdAt);

    console.log(`[CRM] Got ${events.length} journey events for customer ${customerId}`);
    return events;
  } catch (error: any) {
    console.error('[CRM] getCustomerJourney error:', error?.message);
    return [];
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. AI FOLLOW-UP AUTOMATION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Generates a context-aware follow-up message for a lead.
 * Uses a keyword-heuristic system (replaceable with a real AI API).
 */
export async function generateFollowUpMessage(leadId: string): Promise<string | null> {
  try {
    const leadSnap = await firestore().collection('leads').doc(leadId).get();
    if (!leadSnap.exists) return null;
    const lead = docToLead(leadId, leadSnap.data());

    // Check for recent deal activities
    let recentActivity = '';
    try {
      const dealsSnap = await firestore()
        .collection('deals')
        .where('leadId', '==', leadId)
        .limit(5)
        .get();

      if (!dealsSnap.empty) {
        const deal = docToDeal(dealsSnap.docs[0].id, dealsSnap.docs[0].data());
        recentActivity = deal.stage;
      }
    } catch {
      // No deals found, that's fine
    }

    // ── Contextual message generation ──
    const name = lead.name || 'there';
    const company = lead.companyName ? ` at ${lead.companyName}` : '';

    if (lead.aiScore >= 70) {
      return `Hi ${name}${company}, I wanted to follow up personally. Your interest means a lot to us, and I'd love to discuss how we can help. Would you have 15 minutes this week for a quick call?`;
    }

    if (lead.status === 'new' && !lead.lastFollowUpAt) {
      return `Hello ${name}, thank you for your interest in our business! I'd love to learn more about what you're looking for and see how we can assist you.`;
    }

    if (lead.status === 'contacted') {
      return `Hi ${name}${company}, just checking in to see if you had any questions after our last conversation. I'm happy to help with anything you need.`;
    }

    if (recentActivity === 'proposal') {
      return `Hi ${name}${company}, I wanted to follow up on the proposal we sent. Have you had a chance to review it? I'm happy to walk through any questions or discuss adjustments.`;
    }

    if (recentActivity === 'negotiation') {
      return `Hi ${name}${company}, I hope you're doing well. I wanted to touch base on our ongoing discussion. Is there anything I can do to help move things forward?`;
    }

    // General follow-up
    if (lead.source === 'chat') {
      return `Hi ${name}, thanks for reaching out to us! I wanted to personally follow up and see if there's anything else I can help you with.`;
    }
    if (lead.source === 'store_visit') {
      return `Hi ${name}, thanks for visiting our store! We'd love to hear your feedback and see if there's anything we can help you with.`;
    }
    if (lead.source === 'comment') {
      return `Hi ${name}, thanks for engaging with our content! I noticed you showed interest and wanted to reach out to see how we might be able to help.`;
    }

    return `Hi ${name}${company}, I wanted to follow up and see how things are going on your end. Please don't hesitate to reach out if there's anything we can assist with.`;
  } catch (error: any) {
    console.error('[CRM] generateFollowUpMessage error:', error?.message);
    return null;
  }
}

/**
 * Schedules a follow-up for a lead at a specific time.
 */
export async function scheduleFollowUp(
  leadId: string,
  scheduledAt: number,
  message: string,
): Promise<void> {
  try {
    // Get the lead's businessId
    const leadSnap = await firestore().collection('leads').doc(leadId).get();
    if (!leadSnap.exists) throw new Error(`Lead ${leadId} not found`);
    const leadData = leadSnap.data();
    const businessId = leadData.businessId;

    const userId = currentUser()?.uid;

    await firestore().collection('scheduled_followups').add({
      leadId,
      businessId,
      scheduledAt: new Date(scheduledAt).toISOString(),
      message,
      status: 'pending',
      result: '',
      assignedTo: userId || leadData.assignedTo || '',
      createdAt: firestore.FieldValue.serverTimestamp(),
      completedAt: null,
    });

    // Update lead's lastFollowUpAt
    await firestore().collection('leads').doc(leadId).update({
      lastFollowUpAt: firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[CRM] Scheduled follow-up for lead ${leadId} at ${new Date(scheduledAt).toISOString()}`);
  } catch (error: any) {
    console.error('[CRM] scheduleFollowUp error:', error?.message);
    throw error;
  }
}

/**
 * Gets all pending follow-ups for a business.
 */
export async function getPendingFollowUps(businessId: string): Promise<ScheduledFollowUp[]> {
  try {
    const snapshot = await firestore()
      .collection('scheduled_followups')
      .where('businessId', '==', businessId)
      .where('status', '==', 'pending')
      .orderBy('scheduledAt', 'asc')
      .limit(100)
      .get();

    const followUps = snapshot.docs.map(docSnap =>
      docToScheduledFollowUp(docSnap.id, docSnap.data()),
    );

    console.log(`[CRM] Found ${followUps.length} pending follow-ups for business ${businessId}`);
    return followUps;
  } catch (error: any) {
    console.error('[CRM] getPendingFollowUps error:', error?.message);
    if (error?.message?.includes('FAILED_PRECONDITION') || error?.message?.includes('index')) {
      // Missing index — fetch without orderBy and sort client-side
      try {
        const snapshot = await firestore()
          .collection('scheduled_followups')
          .where('businessId', '==', businessId)
          .where('status', '==', 'pending')
          .limit(100)
          .get();

        const followUps = snapshot.docs.map(docSnap =>
          docToScheduledFollowUp(docSnap.id, docSnap.data()),
        );
        followUps.sort((a, b) => a.scheduledAt - b.scheduledAt);
        return followUps;
      } catch (e) {
        console.warn('[CRM] Fallback getPendingFollowUps failed:', e);
        return [];
      }
    }
    return [];
  }
}

/**
 * Marks a scheduled follow-up as completed with a result.
 */
export async function markFollowUpCompleted(
  followUpId: string,
  result: string,
): Promise<void> {
  try {
    await firestore().collection('scheduled_followups').doc(followUpId).update({
      status: 'completed',
      result,
      completedAt: firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[CRM] Marked follow-up ${followUpId} as completed: ${result}`);
  } catch (error: any) {
    console.error('[CRM] markFollowUpCompleted error:', error?.message);
    throw error;
  }
}
