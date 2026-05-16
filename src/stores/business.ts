/**
 * business.ts — Zustand Store for Business Accounts
 *
 * Central store for all business account state: store settings,
 * CRM data, orders, analytics, ShipRocket config, salary, and ads.
 * Reads from Firestore and keeps state in sync.
 */

import { create } from 'zustand';
import { auth, firestore } from '../lib/firebase';
import { tsToMillis } from '../utils/datetime';

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface BusinessStoreProfile {
  storeName: string;
  storeDescription: string;
  storeLogo: string | null;
  storeCover: string | null;
  storeCategory: string;
  storeWebsite: string | null;
  storePhone: string | null;
  storeEmail: string | null;
  storeAddress: string | null;
  storePincode: string | null;
  storeGst: string | null;
  storePan: string | null;
  isStoreActive: boolean;
  currency: string;
}

export interface BusinessAnalytics {
  totalRevenue: number;
  totalOrders: number;
  totalProducts: number;
  totalCustomers: number;
  avgOrderValue: number;
  monthlyRevenue: { month: string; revenue: number }[];
  topProducts: { productId: string; name: string; sold: number; revenue: number }[];
  orderStatusBreakdown: { status: string; count: number }[];
}

export interface CrmLeadSummary {
  totalLeads: number;
  newLeads: number;
  contactedLeads: number;
  qualifiedLeads: number;
  convertedLeads: number;
}

export interface ShipRocketConfig {
  isConnected: boolean;
  email: string | null;
  warehouseId: string | null;
  pickupLocation: string | null;
  defaultCourier: string | null;
}

export interface AdSummary {
  activeCampaigns: number;
  totalSpent: number;
  totalImpressions: number;
  totalClicks: number;
  avgCtr: number;
}

export interface SalarySummary {
  totalEmployees: number;
  monthlyPayroll: number;
  pendingSalaries: number;
}

export interface BusinessState {
  /* Store profile */
  storeProfile: BusinessStoreProfile | null;
  setStoreProfile: (profile: BusinessStoreProfile | null) => void;

  /* Analytics */
  analytics: BusinessAnalytics | null;
  setAnalytics: (analytics: BusinessAnalytics | null) => void;

  /* CRM summary */
  crmSummary: CrmLeadSummary | null;
  setCrmSummary: (summary: CrmLeadSummary | null) => void;

  /* ShipRocket */
  shipRocketConfig: ShipRocketConfig | null;
  setShipRocketConfig: (config: ShipRocketConfig | null) => void;

  /* Ads */
  adSummary: AdSummary | null;
  setAdSummary: (summary: AdSummary | null) => void;

  /* Salary */
  salarySummary: SalarySummary | null;
  setSalarySummary: (summary: SalarySummary | null) => void;

  /* Loading states */
  loading: boolean;
  setLoading: (loading: boolean) => void;

  /* Orders count badge */
  pendingOrderCount: number;
  setPendingOrderCount: (count: number) => void;

  /* Unread lead count */
  unreadLeadCount: number;
  setUnreadLeadCount: (count: number) => void;

  /* Refresh key for forcing re-renders */
  refreshKey: number;
  triggerRefresh: () => void;

  /* Data loading actions */
  fetchStoreProfile: () => Promise<void>;
  fetchAnalytics: () => Promise<void>;
  fetchCrmSummary: () => Promise<void>;
  fetchShipRocketConfig: () => Promise<void>;
  fetchAdSummary: () => Promise<void>;
  fetchSalarySummary: () => Promise<void>;
  fetchAll: () => Promise<void>;
  reset: () => void;
}

const DEFAULT_STORE_PROFILE: BusinessStoreProfile = {
  storeName: '',
  storeDescription: '',
  storeLogo: null,
  storeCover: null,
  storeCategory: '',
  storeWebsite: null,
  storePhone: null,
  storeEmail: null,
  storeAddress: null,
  storePincode: null,
  storeGst: null,
  storePan: null,
  isStoreActive: false,
  currency: 'INR',
};

const DEFAULT_SHIPROCKET: ShipRocketConfig = {
  isConnected: false,
  email: null,
  warehouseId: null,
  pickupLocation: null,
  defaultCourier: null,
};

/* ── Store ─────────────────────────────────────────────────────────────────── */

export const useBusinessStore = create<BusinessState>((set, get) => ({
  storeProfile: null,
  setStoreProfile: (profile) => set({ storeProfile: profile }),

  analytics: null,
  setAnalytics: (analytics) => set({ analytics }),

  crmSummary: null,
  setCrmSummary: (summary) => set({ crmSummary: summary }),

  shipRocketConfig: null,
  setShipRocketConfig: (config) => set({ shipRocketConfig: config }),

  adSummary: null,
  setAdSummary: (summary) => set({ adSummary: summary }),

  salarySummary: null,
  setSalarySummary: (summary) => set({ salarySummary: summary }),

  loading: false,
  setLoading: (loading) => set({ loading }),

  pendingOrderCount: 0,
  setPendingOrderCount: (count) => set({ pendingOrderCount: count }),

  unreadLeadCount: 0,
  setUnreadLeadCount: (count) => set({ unreadLeadCount: count }),

  refreshKey: 0,
  triggerRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),

  /* ── Fetchers ──────────────────────────────────────────────────────────── */

  fetchStoreProfile: async () => {
    const userId = auth()?.currentUser?.uid;
    if (!userId) return;
    try {
      const doc = await firestore().collection('business_profiles').doc(userId).get();
      if (doc.exists) {
        const d = doc.data();
        set({
          storeProfile: {
            storeName: d?.storeName || '',
            storeDescription: d?.storeDescription || '',
            storeLogo: d?.storeLogo || null,
            storeCover: d?.storeCover || null,
            storeCategory: d?.storeCategory || '',
            storeWebsite: d?.storeWebsite || null,
            storePhone: d?.storePhone || null,
            storeEmail: d?.storeEmail || null,
            storeAddress: d?.storeAddress || null,
            storePincode: d?.storePincode || null,
            storeGst: d?.storeGst || null,
            storePan: d?.storePan || null,
            isStoreActive: d?.isStoreActive ?? false,
            currency: d?.currency || 'INR',
          },
        });
      } else {
        set({ storeProfile: { ...DEFAULT_STORE_PROFILE } });
      }
    } catch (e) {
      console.warn('[BusinessStore] Failed to fetch store profile:', e);
    }
  },

  fetchAnalytics: async () => {
    const userId = auth()?.currentUser?.uid;
    if (!userId) return;
    try {
      // Fetch orders count and revenue
      const ordersSnap = await firestore()
        .collection('orders')
        .where('sellerId', '==', userId)
        .get();

      let totalRevenue = 0;
      const statusBreakdown: Record<string, number> = {};
      const monthlyRevenueMap: Record<string, number> = {};

      for (const doc of ordersSnap.docs) {
        const d = doc.data();
        const amount = d.totalAmount || d.amount || 0;
        totalRevenue += amount;
        const status = d.status || 'unknown';
        statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;

        const createdAt = tsToMillis(d.createdAt);
        const monthKey = new Date(createdAt).toISOString().slice(0, 7);
        monthlyRevenueMap[monthKey] = (monthlyRevenueMap[monthKey] || 0) + amount;
      }

      const totalOrders = ordersSnap.docs.length;
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      // Fetch product count
      const productsSnap = await firestore()
        .collection('products')
        .where('sellerId', '==', userId)
        .get();
      const totalProducts = productsSnap.docs.length;

      // Build monthly revenue array
      const monthlyRevenue = Object.entries(monthlyRevenueMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-6)
        .map(([month, revenue]) => ({ month, revenue }));

      // Build order status breakdown
      const orderStatusBreakdown = Object.entries(statusBreakdown).map(
        ([status, count]) => ({ status, count })
      );

      set({
        analytics: {
          totalRevenue,
          totalOrders,
          totalProducts,
          totalCustomers: 0, // Would need aggregation
          avgOrderValue,
          monthlyRevenue,
          topProducts: [],
          orderStatusBreakdown,
        },
      });
    } catch (e) {
      console.warn('[BusinessStore] Failed to fetch analytics:', e);
    }
  },

  fetchCrmSummary: async () => {
    const userId = auth()?.currentUser?.uid;
    if (!userId) return;
    try {
      const leadsSnap = await firestore()
        .collection('leads')
        .where('assignedTo', '==', userId)
        .get();

      let totalLeads = leadsSnap.docs.length;
      let newLeads = 0;
      let contactedLeads = 0;
      let qualifiedLeads = 0;
      let convertedLeads = 0;

      for (const doc of leadsSnap.docs) {
        const status = doc.data().status || 'new';
        if (status === 'new') newLeads++;
        else if (status === 'contacted') contactedLeads++;
        else if (status === 'qualified') qualifiedLeads++;
        else if (status === 'converted') convertedLeads++;
      }

      set({
        crmSummary: {
          totalLeads,
          newLeads,
          contactedLeads,
          qualifiedLeads,
          convertedLeads,
        },
        unreadLeadCount: newLeads,
      });
    } catch (e) {
      console.warn('[BusinessStore] Failed to fetch CRM summary:', e);
    }
  },

  fetchShipRocketConfig: async () => {
    const userId = auth()?.currentUser?.uid;
    if (!userId) return;
    try {
      const doc = await firestore()
        .collection('integrations')
        .doc('shiprocket')
        .collection('configs')
        .doc(userId)
        .get();

      if (doc.exists) {
        const d = doc.data();
        set({
          shipRocketConfig: {
            isConnected: d?.isActive ?? false,
            email: d?.email || null,
            warehouseId: d?.warehouseId || null,
            pickupLocation: d?.pickupLocation || null,
            defaultCourier: d?.defaultCourier || null,
          },
        });
      } else {
        set({ shipRocketConfig: { ...DEFAULT_SHIPROCKET } });
      }
    } catch (e) {
      console.warn('[BusinessStore] Failed to fetch ShipRocket config:', e);
    }
  },

  fetchAdSummary: async () => {
    const userId = auth()?.currentUser?.uid;
    if (!userId) return;
    try {
      const campaignsSnap = await firestore()
        .collection('adCampaigns')
        .where('createdBy', '==', userId)
        .get();

      let activeCampaigns = 0;
      let totalSpent = 0;
      let totalImpressions = 0;
      let totalClicks = 0;

      for (const doc of campaignsSnap.docs) {
        const d = doc.data();
        if (d.status === 'active') activeCampaigns++;
        totalSpent += d.budgetSpent || d.spent || 0;
        totalImpressions += d.impressions || 0;
        totalClicks += d.clicks || 0;
      }

      const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

      set({
        adSummary: {
          activeCampaigns,
          totalSpent,
          totalImpressions,
          totalClicks,
          avgCtr,
        },
      });
    } catch (e) {
      console.warn('[BusinessStore] Failed to fetch ad summary:', e);
    }
  },

  fetchSalarySummary: async () => {
    const userId = auth()?.currentUser?.uid;
    if (!userId) return;
    try {
      const employeesSnap = await firestore()
        .collection('employees')
        .where('businessId', '==', userId)
        .get();

      const totalEmployees = employeesSnap.docs.length;
      let monthlyPayroll = 0;
      let pendingSalaries = 0;

      for (const doc of employeesSnap.docs) {
        const d = doc.data();
        monthlyPayroll += d.monthlySalary || d.salary || 0;
        if (d.paymentStatus === 'pending') pendingSalaries++;
      }

      set({
        salarySummary: {
          totalEmployees,
          monthlyPayroll,
          pendingSalaries,
        },
      });
    } catch (e) {
      console.warn('[BusinessStore] Failed to fetch salary summary:', e);
    }
  },

  fetchAll: async () => {
    set({ loading: true });
    try {
      await Promise.all([
        get().fetchStoreProfile(),
        get().fetchAnalytics(),
        get().fetchCrmSummary(),
        get().fetchShipRocketConfig(),
        get().fetchAdSummary(),
        get().fetchSalarySummary(),
      ]);
    } catch (e) {
      console.warn('[BusinessStore] fetchAll error:', e);
    } finally {
      set({ loading: false });
    }
  },

  reset: () =>
    set({
      storeProfile: null,
      analytics: null,
      crmSummary: null,
      shipRocketConfig: null,
      adSummary: null,
      salarySummary: null,
      loading: false,
      pendingOrderCount: 0,
      unreadLeadCount: 0,
    }),
}));
