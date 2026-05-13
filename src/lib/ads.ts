/**
 * ads.ts — Ad Campaign Management & Pricing System
 *
 * Handles ad campaign CRUD, pricing tiers, cost estimation, analytics,
 * targeting, and performance metrics. All data stored in Firestore via
 * the REST-based firebase.ts client.
 */

import { firestore, auth } from './firebase';

// ═══════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** A single creative asset within an ad campaign (image, video, carousel). */
export interface AdCreative {
  id: string;
  type: 'image' | 'video' | 'carousel';
  url: string;
  headline: string;
  description: string;
  ctaText: string;
  /** JSON-encoded array of carousel image URLs when type is 'carousel'. */
  carouselUrls?: string[];
  /** Order index within the campaign. */
  order: number;
}

/** Audience targeting configuration for an ad campaign. */
export interface AdTargeting {
  ageMin: number;
  ageMax: number;
  gender?: 'all' | 'male' | 'female' | 'other';
  location: string;
  locations?: string[];
  interests: string[];
  languages?: string[];
  /** IDs of specific users for direct targeting. */
  userIds?: string[];
  /** Whether to target followers of the business. */
  targetFollowers?: boolean;
}

/** The billing model used for an ad. */
export type AdBillingModel = 'cpc' | 'cpm';

/** Full ad campaign document stored in Firestore. */
export interface AdCampaign {
  id: string;
  businessId: string;
  /** Display name of the campaign. */
  name: string;
  headline: string;
  description: string;
  ctaText: string;
  /** JSON-serialized array of AdCreative objects. */
  creatives: string;
  /** Where the ad appears. */
  placement: AdPlacement;
  /** Billing model — cost-per-click or cost-per-1000-impressions. */
  billingModel: AdBillingModel;
  /** Daily spend cap in paise. */
  dailyBudget: number;
  /** Total campaign budget in paise. */
  budget: number;
  /** Planned duration in days. */
  duration: number;
  /** Amount spent so far in paise. */
  spent: number;
  /** Current lifecycle status. */
  status: 'active' | 'paused' | 'completed' | 'draft' | 'archived';
  targeting: AdTargeting;
  impressions: number;
  clicks: number;
  conversions: number;
  /** Effective cost-per-click in paise (calculated). */
  effectiveCpc: number;
  /** Effective cost-per-1000-impressions in paise (calculated). */
  effectiveCpm: number;
  /** Click-through rate (0-1). */
  ctr: number;
  /** Conversion rate (0-1). */
  conversionRate: number;
  /** ISO 8601 timestamp strings. */
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

/** Where an ad can be placed within the app. */
export type AdPlacement = 'feed' | 'story' | 'profile' | 'search' | 'comment';

/** Pricing tier for a specific ad placement. */
export interface AdPricingTier {
  placement: AdPlacement;
  /** Cost per click minimum (in paise). */
  cpcMin: number;
  /** Cost per click maximum (in paise). */
  cpcMax: number;
  /** Cost per 1000 impressions minimum (in paise). */
  cpmMin: number;
  /** Cost per 1000 impressions maximum (in paise). */
  cpmMax: number;
  /** Minimum daily budget (in paise). */
  dailyBudgetMin: number;
  /** Maximum daily budget (in paise). */
  dailyBudgetMax: number;
}

/** Estimated ad cost returned by the pricing calculator. */
export interface AdCostEstimate {
  placement: AdPlacement;
  billingModel: AdBillingModel;
  /** Daily budget in paise. */
  dailyBudget: number;
  /** Estimated clicks per day. */
  estimatedClicksPerDay: number;
  /** Estimated impressions per day. */
  estimatedImpressionsPerDay: number;
  /** Estimated cost per click in paise (average of range). */
  avgCpc: number;
  /** Estimated cost per 1000 impressions in paise (average of range). */
  avgCpm: number;
  /** Estimated total cost for the budget in paise. */
  estimatedTotalCost: number;
  /** Estimated reach (unique users). */
  estimatedReach: number;
}

/** Per-campaign analytics snapshot. */
export interface AdAnalytics {
  adId: string;
  campaignName: string;
  placement: AdPlacement;
  billingModel: AdBillingModel;
  impressions: number;
  clicks: number;
  conversions: number;
  spent: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversionRate: number;
  /** Daily analytics data points. */
  dailyData: AdDailyData[];
  /** Top-performing demographics breakdown. */
  topDemographics: AdDemographicBreakdown;
  /** Top-performing geographies. */
  topLocations: AdLocationBreakdown[];
  /** Device breakdown. */
  deviceBreakdown: Record<string, number>;
  /** ISO timestamp when analytics were last updated. */
  lastUpdated: string;
}

/** Single-day analytics data point. */
export interface AdDailyData {
  date: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spent: number;
}

/** Demographic breakdown by age group or gender. */
export interface AdDemographicBreakdown {
  byAge: Record<string, number>;
  byGender: Record<string, number>;
}

/** Geographic breakdown for analytics. */
export interface AdLocationBreakdown {
  location: string;
  impressions: number;
  clicks: number;
  conversions: number;
}

/** Aggregated analytics across all campaigns for a business. */
export interface AdAnalyticsSummary {
  businessId: string;
  totalCampaigns: number;
  activeCampaigns: number;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  totalSpent: number;
  averageCtr: number;
  averageCpc: number;
  averageCpm: number;
  averageConversionRate: number;
  /** Top campaigns by clicks. */
  topCampaigns: AdCampaign[];
  /** Summary across the last N days. */
  period: string;
  generatedAt: string;
}

/** Performance metrics for a specific ad. */
export interface PerformanceMetrics {
  adId: string;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversionRate: number;
  roi: number;
  qualityScore: number;
  /** How the ad compares to others (0-100 percentile). */
  relevanceScore: number;
  /** Engagement rate (clicks / impressions). */
  engagementRate: number;
  /** Cost per conversion in paise. */
  costPerConversion: number;
}

/** Data required to create a new ad campaign. */
export interface CreateAdCampaignData {
  businessId: string;
  name: string;
  headline: string;
  description?: string;
  ctaText?: string;
  creatives?: AdCreative[];
  placement: AdPlacement;
  billingModel: AdBillingModel;
  dailyBudget: number;
  duration: number;
  targeting: AdTargeting;
  startDate?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function tsToISO(value: unknown): string {
  if (value && typeof value === 'object' && 'seconds' in value) {
    const ts = value as { seconds: number };
    return new Date(ts.seconds * 1000).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function docToCampaign(id: string, d: any): AdCampaign {
  const impressions = d.impressions ?? 0;
  const clicks = d.clicks ?? 0;
  const conversions = d.conversions ?? 0;
  const spent = d.spent ?? 0;

  return {
    id,
    businessId: d.businessId ?? '',
    name: d.name ?? '',
    headline: d.headline ?? '',
    description: d.description ?? '',
    ctaText: d.ctaText ?? '',
    creatives: typeof d.creatives === 'string' ? d.creatives : JSON.stringify(d.creatives ?? []),
    placement: d.placement ?? 'feed',
    billingModel: d.billingModel ?? 'cpc',
    dailyBudget: d.dailyBudget ?? 0,
    budget: d.budget ?? 0,
    duration: d.duration ?? 7,
    spent,
    status: d.status ?? 'draft',
    targeting: d.targeting ?? {
      ageMin: 18,
      ageMax: 65,
      location: '',
      interests: [],
    },
    impressions,
    clicks,
    conversions,
    effectiveCpc: clicks > 0 ? spent / clicks : 0,
    effectiveCpm: impressions > 0 ? (spent / impressions) * 1000 : 0,
    ctr: impressions > 0 ? clicks / impressions : 0,
    conversionRate: clicks > 0 ? conversions / clicks : 0,
    startDate: tsToISO(d.startDate),
    endDate: tsToISO(d.endDate),
    createdAt: tsToISO(d.createdAt),
    updatedAt: tsToISO(d.updatedAt),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PRICING TIERS (static configuration)
// ═══════════════════════════════════════════════════════════════════════════

/** Default pricing tiers per placement (in paise). */
const DEFAULT_PRICING_TIERS: AdPricingTier[] = [
  {
    placement: 'feed',
    cpcMin: 100,   // ₹1.00
    cpcMax: 1500,  // ₹15.00
    cpmMin: 500,   // ₹5.00
    cpmMax: 5000,  // ₹50.00
    dailyBudgetMin: 10000,   // ₹100
    dailyBudgetMax: 500000,  // ₹5,000
  },
  {
    placement: 'story',
    cpcMin: 80,    // ₹0.80
    cpcMax: 1200,  // ₹12.00
    cpmMin: 400,   // ₹4.00
    cpmMax: 4000,  // ₹40.00
    dailyBudgetMin: 5000,    // ₹50
    dailyBudgetMax: 300000,  // ₹3,000
  },
  {
    placement: 'profile',
    cpcMin: 60,    // ₹0.60
    cpcMax: 800,   // ₹8.00
    cpmMin: 300,   // ₹3.00
    cpmMax: 3000,  // ₹30.00
    dailyBudgetMin: 5000,    // ₹50
    dailyBudgetMax: 200000,  // ₹2,000
  },
  {
    placement: 'search',
    cpcMin: 200,   // ₹2.00
    cpcMax: 2000,  // ₹20.00
    cpmMin: 800,   // ₹8.00
    cpmMax: 8000,  // ₹80.00
    dailyBudgetMin: 10000,   // ₹100
    dailyBudgetMax: 500000,  // ₹5,000
  },
  {
    placement: 'comment',
    cpcMin: 50,    // ₹0.50
    cpcMax: 600,   // ₹6.00
    cpmMin: 200,   // ₹2.00
    cpmMax: 2500,  // ₹25.00
    dailyBudgetMin: 5000,    // ₹50
    dailyBudgetMax: 200000,  // ₹2,000
  },
];

// ═══════════════════════════════════════════════════════════════════════════
//  AD CAMPAIGN CRUD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a new ad campaign in Firestore.
 *
 * Validates required fields, sets computed defaults (budget = dailyBudget × duration),
 * and writes the document to the `adCampaigns` collection.
 */
export async function createAdCampaign(
  data: CreateAdCampaignData,
): Promise<AdCampaign> {
  const currentUid = auth()?.currentUser?.uid;
  if (!currentUid) throw new Error('Not authenticated');

  const now = new Date();
  const startDate = data.startDate
    ? new Date(data.startDate)
    : now;
  const endDate = new Date(startDate.getTime() + data.duration * 86400000);

  const campaignData: Record<string, any> = {
    businessId: data.businessId || currentUid,
    name: data.name.trim(),
    headline: data.headline.trim(),
    description: (data.description ?? '').trim(),
    ctaText: (data.ctaText ?? 'Learn More').trim(),
    creatives: JSON.stringify(data.creatives ?? []),
    placement: data.placement,
    billingModel: data.billingModel,
    dailyBudget: data.dailyBudget,
    budget: data.dailyBudget * data.duration,
    duration: data.duration,
    spent: 0,
    status: 'active',
    targeting: data.targeting ?? {
      ageMin: 18,
      ageMax: 65,
      location: '',
      interests: [],
    },
    impressions: 0,
    clicks: 0,
    conversions: 0,
    effectiveCpc: 0,
    effectiveCpm: 0,
    ctr: 0,
    conversionRate: 0,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    createdAt: firestore.FieldValue.serverTimestamp(),
    updatedAt: firestore.FieldValue.serverTimestamp(),
  };

  const ref = await firestore().collection('adCampaigns').add(campaignData);
  const snap = await firestore().collection('adCampaigns').doc(ref.id).get();
  return docToCampaign(snap.id, snap.data());
}

/**
 * Updates an existing ad campaign with partial data.
 * Recomputes derived metrics (CTR, CPC, CPM) after the update.
 */
export async function updateAdCampaign(
  adId: string,
  data: Partial<AdCampaign>,
): Promise<void> {
  const updateData: Record<string, any> = { ...data };

  // If duration or dailyBudget changed, recalculate total budget
  if (updateData.duration !== undefined || updateData.dailyBudget !== undefined) {
    const existingSnap = await firestore().collection('adCampaigns').doc(adId).get();
    if (existingSnap.exists) {
      const existing = existingSnap.data();
      const daily = updateData.dailyBudget ?? existing.dailyBudget ?? 0;
      const dur = updateData.duration ?? existing.duration ?? 7;
      updateData.budget = daily * dur;
    }
  }

  // Recompute derived metrics
  const impressions = updateData.impressions;
  const clicks = updateData.clicks;
  const spent = updateData.spent;
  if (impressions !== undefined || clicks !== undefined || spent !== undefined) {
    const existingSnap = await firestore().collection('adCampaigns').doc(adId).get();
    if (existingSnap.exists) {
      const existing = existingSnap.data();
      const imp = impressions ?? existing.impressions ?? 0;
      const clk = clicks ?? existing.clicks ?? 0;
      const sp = spent ?? existing.spent ?? 0;
      updateData.effectiveCpc = clk > 0 ? sp / clk : 0;
      updateData.effectiveCpm = imp > 0 ? (sp / imp) * 1000 : 0;
      updateData.ctr = imp > 0 ? clk / imp : 0;
    }
  }

  updateData.updatedAt = firestore.FieldValue.serverTimestamp();

  await firestore().collection('adCampaigns').doc(adId).update(updateData);
}

/**
 * Fetches all ad campaigns for a given business, ordered by creation date.
 */
export async function fetchAdCampaigns(businessId: string): Promise<AdCampaign[]> {
  const snap = await firestore()
    .collection('adCampaigns')
    .where('businessId', '==', businessId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  return snap.docs.map((doc: any) => docToCampaign(doc.id, doc.data()));
}

/**
 * Fetches a single ad campaign by ID.
 * Returns null if the campaign does not exist.
 */
export async function fetchAdCampaignById(
  adId: string,
): Promise<AdCampaign | null> {
  const snap = await firestore().collection('adCampaigns').doc(adId).get();
  if (!snap.exists) return null;
  return docToCampaign(snap.id, snap.data());
}

/**
 * Soft-deletes an ad campaign by archiving it.
 * Active or paused campaigns are set to 'archived' status.
 */
export async function deleteAdCampaign(adId: string): Promise<void> {
  await firestore().collection('adCampaigns').doc(adId).update({
    status: 'archived',
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Pauses an active ad campaign.
 * Throws if the campaign is not currently active.
 */
export async function pauseAdCampaign(adId: string): Promise<void> {
  const snap = await firestore().collection('adCampaigns').doc(adId).get();
  if (!snap.exists) throw new Error('Campaign not found');

  const data = snap.data();
  if (data.status !== 'active') {
    throw new Error(`Cannot pause campaign with status: ${data.status}`);
  }

  await firestore().collection('adCampaigns').doc(adId).update({
    status: 'paused',
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Resumes a paused ad campaign.
 * Throws if the campaign is not currently paused.
 */
export async function resumeAdCampaign(adId: string): Promise<void> {
  const snap = await firestore().collection('adCampaigns').doc(adId).get();
  if (!snap.exists) throw new Error('Campaign not found');

  const data = snap.data();
  if (data.status !== 'paused') {
    throw new Error(`Cannot resume campaign with status: ${data.status}`);
  }

  await firestore().collection('adCampaigns').doc(adId).update({
    status: 'active',
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  AD PRICING STRATEGY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns pricing tiers for all ad placements.
 * First attempts to load custom tiers from Firestore; falls back to defaults.
 */
export async function getAdPricingTiers(): Promise<AdPricingTier[]> {
  try {
    const snap = await firestore().collection('config').doc('adPricing').get();
    if (snap.exists && snap.data()?.tiers) {
      const raw = snap.data().tiers;
      if (Array.isArray(raw) && raw.length > 0) {
        return raw as AdPricingTier[];
      }
    }
  } catch (e) {
    console.warn('[Ads] Failed to fetch custom pricing tiers, using defaults:', e);
  }
  return DEFAULT_PRICING_TIERS;
}

/**
 * Calculates an estimated ad cost for the given placement, billing model, and budget.
 *
 * Returns detailed estimates including projected clicks, impressions, reach, and
 * average CPC/CPM values for the selected placement.
 */
export async function calculateAdCost(
  placement: string,
  model: 'cpc' | 'cpm',
  budget: number,
): Promise<AdCostEstimate> {
  const tiers = await getAdPricingTiers();
  const tier = tiers.find(t => t.placement === placement);

  if (!tier) {
    // Fallback to feed pricing if placement not found
    const fallback = tiers[0];
    return _computeEstimate(fallback, placement as AdPlacement, model, budget);
  }

  return _computeEstimate(tier, placement as AdPlacement, model, budget);
}

/** Internal: computes cost estimate from a tier. */
function _computeEstimate(
  tier: AdPricingTier,
  placement: AdPlacement,
  model: 'cpc' | 'cpm',
  budget: number,
): AdCostEstimate {
  // Clamp budget to tier limits
  const dailyBudget = Math.max(tier.dailyBudgetMin, Math.min(tier.dailyBudgetMax, budget));

  let estimatedClicksPerDay: number;
  let estimatedImpressionsPerDay: number;

  if (model === 'cpc') {
    const avgCpc = (tier.cpcMin + tier.cpcMax) / 2;
    estimatedClicksPerDay = Math.floor(dailyBudget / avgCpc);
    // Assume ~3% CTR for impression estimation
    estimatedImpressionsPerDay = Math.floor(estimatedClicksPerDay / 0.03);
    return {
      placement,
      billingModel: 'cpc',
      dailyBudget,
      estimatedClicksPerDay,
      estimatedImpressionsPerDay,
      avgCpc: Math.round(avgCpc),
      avgCpm: estimatedImpressionsPerDay > 0
        ? Math.round((dailyBudget / estimatedImpressionsPerDay) * 1000)
        : 0,
      estimatedTotalCost: dailyBudget,
      estimatedReach: Math.floor(estimatedImpressionsPerDay * 0.7), // ~70% unique reach
    };
  } else {
    const avgCpm = (tier.cpmMin + tier.cpmMax) / 2;
    estimatedImpressionsPerDay = Math.floor((dailyBudget / avgCpm) * 1000);
    // Assume ~3% CTR for click estimation
    estimatedClicksPerDay = Math.floor(estimatedImpressionsPerDay * 0.03);
    return {
      placement,
      billingModel: 'cpm',
      dailyBudget,
      estimatedClicksPerDay,
      estimatedImpressionsPerDay,
      avgCpc: estimatedClicksPerDay > 0
        ? Math.round(dailyBudget / estimatedClicksPerDay)
        : 0,
      avgCpm: Math.round(avgCpm),
      estimatedTotalCost: dailyBudget,
      estimatedReach: Math.floor(estimatedImpressionsPerDay * 0.7),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  AD ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetches analytics for a single ad campaign.
 *
 * Looks up both the campaign document and its daily analytics subcollection
 * (`adCampaigns/{adId}/dailyAnalytics`) to build a comprehensive view.
 */
export async function fetchAdAnalytics(adId: string): Promise<AdAnalytics> {
  const snap = await firestore().collection('adCampaigns').doc(adId).get();
  if (!snap.exists) throw new Error('Campaign not found');

  const d = snap.data();
  const campaign = docToCampaign(snap.id, d);

  // Fetch daily analytics
  let dailyData: AdDailyData[] = [];
  try {
    const dailySnap = await firestore()
      .collection(`adCampaigns/${adId}/dailyAnalytics`)
      .orderBy('date', 'desc')
      .limit(30)
      .get();

    dailyData = dailySnap.docs.map((doc: any) => {
      const dd = doc.data();
      return {
        date: dd.date ?? '',
        impressions: dd.impressions ?? 0,
        clicks: dd.clicks ?? 0,
        conversions: dd.conversions ?? 0,
        spent: dd.spent ?? 0,
      };
    });
  } catch (e) {
    console.warn('[Ads] Failed to fetch daily analytics:', e);
  }

  // Fetch demographics breakdown
  let topDemographics: AdDemographicBreakdown = { byAge: {}, byGender: {} };
  let topLocations: AdLocationBreakdown[] = [];
  let deviceBreakdown: Record<string, number> = {};

  try {
    const analyticsSnap = await firestore()
      .collection(`adCampaigns/${adId}/analytics`)
      .doc('summary')
      .get();

    if (analyticsSnap.exists) {
      const ad = analyticsSnap.data();
      topDemographics = ad.topDemographics ?? { byAge: {}, byGender: {} };
      topLocations = ad.topLocations ?? [];
      deviceBreakdown = ad.deviceBreakdown ?? {};
    }
  } catch (e) {
    console.warn('[Ads] Failed to fetch analytics breakdowns:', e);
  }

  return {
    adId: campaign.id,
    campaignName: campaign.name,
    placement: campaign.placement,
    billingModel: campaign.billingModel,
    impressions: campaign.impressions,
    clicks: campaign.clicks,
    conversions: campaign.conversions,
    spent: campaign.spent,
    ctr: campaign.ctr,
    cpc: campaign.effectiveCpc,
    cpm: campaign.effectiveCpm,
    conversionRate: campaign.conversionRate,
    dailyData,
    topDemographics,
    topLocations,
    deviceBreakdown,
    lastUpdated: campaign.updatedAt,
  };
}

/**
 * Fetches aggregated analytics across all campaigns for a business.
 *
 * Returns totals, averages, top campaigns, and a summary period.
 */
export async function fetchAllAdAnalytics(
  businessId: string,
): Promise<AdAnalyticsSummary> {
  const snap = await firestore()
    .collection('adCampaigns')
    .where('businessId', '==', businessId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  const campaigns = snap.docs.map((doc: any) => docToCampaign(doc.id, doc.data()));

  const activeCampaigns = campaigns.filter(c => c.status === 'active');
  const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
  const totalConversions = campaigns.reduce((s, c) => s + c.conversions, 0);
  const totalSpent = campaigns.reduce((s, c) => s + c.spent, 0);

  const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  const avgCpc = totalClicks > 0 ? totalSpent / totalClicks : 0;
  const avgCpm = totalImpressions > 0 ? (totalSpent / totalImpressions) * 1000 : 0;
  const avgConversionRate = totalClicks > 0 ? totalConversions / totalClicks : 0;

  // Top 5 campaigns by clicks
  const topCampaigns = [...campaigns]
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5);

  return {
    businessId,
    totalCampaigns: campaigns.length,
    activeCampaigns: activeCampaigns.length,
    totalImpressions,
    totalClicks,
    totalConversions,
    totalSpent,
    averageCtr: avgCtr,
    averageCpc: avgCpc,
    averageCpm: avgCpm,
    averageConversionRate: avgConversionRate,
    topCampaigns,
    period: 'last_30_days',
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  AD TARGETING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Updates the targeting configuration for an ad campaign.
 * Merges the new targeting with the existing data.
 */
export async function updateAdTargeting(
  adId: string,
  targeting: AdTargeting,
): Promise<void> {
  const snap = await firestore().collection('adCampaigns').doc(adId).get();
  if (!snap.exists) throw new Error('Campaign not found');

  // Merge with existing targeting to allow partial updates
  const existing = snap.data();
  const mergedTargeting = {
    ...(existing.targeting ?? {}),
    ...targeting,
  };

  await firestore().collection('adCampaigns').doc(adId).update({
    targeting: mergedTargeting,
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  AD PERFORMANCE METRICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Computes and returns performance metrics for a specific ad campaign.
 *
 * Calculates CTR, CPC, CPM, conversion rate, ROI, quality score,
 * relevance score, engagement rate, and cost per conversion.
 */
export async function getAdPerformanceMetrics(
  adId: string,
): Promise<PerformanceMetrics> {
  const snap = await firestore().collection('adCampaigns').doc(adId).get();
  if (!snap.exists) throw new Error('Campaign not found');

  const d = snap.data();
  const impressions = d.impressions ?? 0;
  const clicks = d.clicks ?? 0;
  const conversions = d.conversions ?? 0;
  const spent = d.spent ?? 0;

  const ctr = impressions > 0 ? clicks / impressions : 0;
  const cpc = clicks > 0 ? spent / clicks : 0;
  const cpm = impressions > 0 ? (spent / impressions) * 1000 : 0;
  const conversionRate = clicks > 0 ? conversions / clicks : 0;
  const costPerConversion = conversions > 0 ? spent / conversions : 0;
  const engagementRate = impressions > 0 ? clicks / impressions : 0;

  // Quality score heuristic: based on CTR and conversion rate
  // Range 1-10, higher is better
  const ctrScore = Math.min(ctr * 100, 10); // 10% CTR = max score
  const convScore = Math.min(conversionRate * 50, 10); // 20% conv = max score
  const qualityScore = Math.round(((ctrScore + convScore) / 2) * 10) / 10;

  // Relevance score: 0-100 based on quality score and engagement
  const relevanceScore = Math.min(
    Math.round((qualityScore / 10) * 80 + engagementRate * 100),
    100,
  );

  // ROI: if we assume average conversion value of ₹500 (50000 paise)
  const avgConversionValue = 50000;
  const revenue = conversions * avgConversionValue;
  const roi = spent > 0 ? ((revenue - spent) / spent) * 100 : 0;

  return {
    adId: snap.id,
    impressions,
    clicks,
    conversions,
    ctr: Math.round(ctr * 10000) / 10000, // 4 decimal places
    cpc: Math.round(cpc * 100) / 100,
    cpm: Math.round(cpm * 100) / 100,
    conversionRate: Math.round(conversionRate * 10000) / 10000,
    roi: Math.round(roi * 100) / 100,
    qualityScore,
    relevanceScore,
    engagementRate: Math.round(engagementRate * 10000) / 10000,
    costPerConversion: Math.round(costPerConversion * 100) / 100,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  UTILITY FORMATTERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Formats paise to INR string.
 * Example: 1500 → "₹15"
 */
export function formatAdCurrency(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

/**
 * Formats a rate (0-1) to a percentage string.
 * Example: 0.0345 → "3.45%"
 */
export function formatAdRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

/**
 * Formats a number with Indian locale grouping.
 */
export function formatAdNumber(n: number): string {
  return n.toLocaleString('en-IN');
}
