/**
 * salary.ts — Employee & Salary Management System
 *
 * Handles employee records, payroll generation, salary structures,
 * performance-based bonuses, payment tracking, and salary reports.
 * All data stored in Firestore via the REST-based firebase.ts client.
 */

import { firestore, auth } from './firebase';

// ═══════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Employee status within a business. */
export type EmployeeStatus = 'active' | 'inactive' | 'on_leave' | 'terminated';

/** Full employee document stored in Firestore. */
export interface Employee {
  id: string;
  businessId: string;
  userId?: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  department: string;
  profileImage: string | null;
  /** Date the employee joined (ISO string). */
  joinDate: string;
  status: EmployeeStatus;
  /** Bank account details for salary disbursement. */
  bankAccount: BankAccount;
  /** Current salary structure (in paise). */
  salaryStructure: SalaryStructure;
  createdAt: string;
  updatedAt: string;
}

/** Bank account details for salary transfer. */
export interface BankAccount {
  accountName: string;
  accountNumber: string;
  bankName: string;
  ifscCode: string;
  upiId?: string;
}

/** Salary structure with all components (amounts in paise). */
export interface SalaryStructure {
  /** Fixed monthly base salary. */
  baseSalary: number;
  /** House Rent Allowance. */
  hra: number;
  /** Dearness Allowance. */
  da: number;
  /** Special Allowance. */
  specialAllowance: number;
  /** Conveyance Allowance. */
  conveyance: number;
  /** Medical Allowance. */
  medicalAllowance: number;
  /** Monthly commission (performance-based). */
  commission: number;
  /** Monthly bonus amount. */
  bonus: number;
  /** Provident Fund employee contribution. */
  pf: number;
  /** Professional Tax deduction. */
  professionalTax: number;
  /** Tax Deducted at Source. */
  tds: number;
  /** Any other deductions. */
  otherDeductions: number;
}

/** Data required to add a new employee. */
export interface AddEmployeeData {
  businessId: string;
  userId?: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  department?: string;
  profileImage?: string | null;
  joinDate?: string;
  bankAccount?: Partial<BankAccount>;
  salaryStructure?: Partial<SalaryStructure>;
}

/** A single payroll period document (one month for a business). */
export interface Payroll {
  id: string;
  businessId: string;
  /** Payroll period in 'YYYY-MM' format. */
  month: string;
  /** Individual entries for each employee. */
  entries: PayrollEntry[];
  /** Total gross salary for the month (paise). */
  totalGross: number;
  /** Total deductions for the month (paise). */
  totalDeductions: number;
  /** Net payable (paise). */
  totalNet: number;
  /** Total number of employees in this payroll. */
  employeeCount: number;
  /** Number of employees already paid. */
  paidCount: number;
  /** Overall payroll status. */
  status: 'draft' | 'generated' | 'partially_paid' | 'paid' | 'cancelled';
  generatedBy: string;
  generatedAt: string;
  updatedAt: string;
}

/** Individual salary entry for one employee within a payroll period. */
export interface PayrollEntry {
  employeeId: string;
  employeeName: string;
  role: string;
  profileImage: string | null;
  /** Gross salary for this month (paise). */
  grossSalary: number;
  /** Total deductions for this month (paise). */
  deductions: number;
  /** Net salary payable (paise). */
  netSalary: number;
  /** Breakdown of salary components (paise). */
  breakdown: SalaryStructure;
  /** Performance bonus for this period (paise). */
  performanceBonus: number;
  /** Whether salary has been disbursed. */
  paymentStatus: 'paid' | 'pending' | 'failed';
  /** Payment transaction details (when paid). */
  paymentData?: PaymentData;
  /** Notes for this entry. */
  notes: string;
}

/** Payment data recorded when salary is disbursed. */
export interface PaymentData {
  /** Payment method used. */
  method: 'bank_transfer' | 'upi' | 'cash' | 'cheque';
  /** Transaction reference ID. */
  transactionId: string;
  /** Amount paid in paise. */
  amount: number;
  /** ISO timestamp of payment. */
  paidAt: string;
  /** Who processed the payment. */
  processedBy: string;
  /** Optional notes. */
  notes?: string;
}

/** Performance metrics for an employee in a given period. */
export interface PerformanceMetrics {
  employeeId: string;
  period: string;
  /** 'YYYY-MM' format. */
  month: string;
  /** Sales targets achieved (0-1 ratio). */
  targetAchievement: number;
  /** Number of leads generated. */
  leadsGenerated: number;
  /** Number of deals closed. */
  dealsClosed: number;
  /** Revenue generated in paise. */
  revenueGenerated: number;
  /** Customer satisfaction score (1-5). */
  customerSatisfaction: number;
  /** Attendance percentage (0-1). */
  attendanceRate: number;
  /** Tasks completed vs assigned (0-1). */
  taskCompletionRate: number;
  /** Overall performance score (0-100). */
  overallScore: number;
  /** Timestamp when metrics were recorded. */
  recordedAt: string;
}

/** Salary report for a business for a given period. */
export interface SalaryReport {
  businessId: string;
  period: string;
  /** Number of active employees during this period. */
  totalEmployees: number;
  /** Total gross salary disbursed (paise). */
  totalGrossSalary: number;
  /** Total deductions (paise). */
  totalDeductions: number;
  /** Total net salary paid (paise). */
  totalNetSalary: number;
  /** Total performance bonuses paid (paise). */
  totalBonuses: number;
  /** Average salary per employee (paise). */
  averageSalary: number;
  /** Highest salary (paise). */
  highestSalary: number;
  /** Lowest salary (paise). */
  lowestSalary: number;
  /** Salary distribution by department. */
  departmentBreakdown: DepartmentSalaryBreakdown[];
  /** Year-over-year growth percentage (if applicable). */
  yoyGrowth: number | null;
  /** Month-over-month growth percentage. */
  momGrowth: number | null;
  generatedAt: string;
}

/** Salary breakdown per department. */
export interface DepartmentSalaryBreakdown {
  department: string;
  employeeCount: number;
  totalSalary: number;
  averageSalary: number;
  highestSalary: number;
  lowestSalary: number;
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

/** Creates a default SalaryStructure with zeroes. */
function defaultSalaryStructure(): SalaryStructure {
  return {
    baseSalary: 0,
    hra: 0,
    da: 0,
    specialAllowance: 0,
    conveyance: 0,
    medicalAllowance: 0,
    commission: 0,
    bonus: 0,
    pf: 0,
    professionalTax: 0,
    tds: 0,
    otherDeductions: 0,
  };
}

/** Creates a default BankAccount. */
function defaultBankAccount(): BankAccount {
  return {
    accountName: '',
    accountNumber: '',
    bankName: '',
    ifscCode: '',
    upiId: '',
  };
}

/** Computes gross salary from a salary structure (in paise). */
function computeGross(s: SalaryStructure): number {
  return (
    s.baseSalary +
    s.hra +
    s.da +
    s.specialAllowance +
    s.conveyance +
    s.medicalAllowance +
    s.commission +
    s.bonus
  );
}

/** Computes total deductions from a salary structure (in paise). */
function computeDeductions(s: SalaryStructure): number {
  return (
    s.pf +
    s.professionalTax +
    s.tds +
    s.otherDeductions
  );
}

function docToEmployee(id: string, d: any): Employee {
  return {
    id,
    businessId: d.businessId ?? '',
    userId: d.userId,
    name: d.name ?? '',
    email: d.email ?? '',
    phone: d.phone ?? '',
    role: d.role ?? 'Team Member',
    department: d.department ?? 'General',
    profileImage: d.profileImage ?? null,
    joinDate: tsToISO(d.joinDate),
    status: d.status ?? 'active',
    bankAccount: d.bankAccount ?? defaultBankAccount(),
    salaryStructure: d.salaryStructure ?? defaultSalaryStructure(),
    createdAt: tsToISO(d.createdAt),
    updatedAt: tsToISO(d.updatedAt),
  };
}

function docToPayroll(id: string, d: any): Payroll {
  const entries: PayrollEntry[] = Array.isArray(d.entries)
    ? d.entries
    : typeof d.entries === 'string'
      ? JSON.parse(d.entries)
      : [];

  return {
    id,
    businessId: d.businessId ?? '',
    month: d.month ?? '',
    entries,
    totalGross: d.totalGross ?? 0,
    totalDeductions: d.totalDeductions ?? 0,
    totalNet: d.totalNet ?? 0,
    employeeCount: d.employeeCount ?? entries.length,
    paidCount: d.paidCount ?? entries.filter(e => e.paymentStatus === 'paid').length,
    status: d.status ?? 'draft',
    generatedBy: d.generatedBy ?? '',
    generatedAt: tsToISO(d.generatedAt),
    updatedAt: tsToISO(d.updatedAt),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  EMPLOYEE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Adds a new employee to the business.
 * Creates a document in the `teamMembers` collection.
 */
export async function addEmployee(
  data: AddEmployeeData,
): Promise<Employee> {
  const currentUid = auth()?.currentUser?.uid;
  if (!currentUid) throw new Error('Not authenticated');

  const salaryStructure: SalaryStructure = {
    ...defaultSalaryStructure(),
    ...data.salaryStructure,
  };

  const bankAccount: BankAccount = {
    ...defaultBankAccount(),
    ...data.bankAccount,
  };

  const employeeData: Record<string, any> = {
    businessId: data.businessId || currentUid,
    userId: data.userId || null,
    name: data.name.trim(),
    email: (data.email ?? '').trim(),
    phone: (data.phone ?? '').trim(),
    role: data.role.trim(),
    department: (data.department ?? 'General').trim(),
    profileImage: data.profileImage ?? null,
    joinDate: data.joinDate
      ? new Date(data.joinDate).toISOString()
      : new Date().toISOString(),
    status: 'active',
    bankAccount,
    salaryStructure,
    createdAt: firestore.FieldValue.serverTimestamp(),
    updatedAt: firestore.FieldValue.serverTimestamp(),
  };

  const ref = await firestore().collection('teamMembers').add(employeeData);
  const snap = await firestore().collection('teamMembers').doc(ref.id).get();
  return docToEmployee(snap.id, snap.data());
}

/**
 * Updates an existing employee's information.
 * Accepts partial data — only provided fields are updated.
 */
export async function updateEmployee(
  employeeId: string,
  data: Partial<Employee>,
): Promise<void> {
  const updateData: Record<string, any> = { ...data };
  updateData.updatedAt = firestore.FieldValue.serverTimestamp();

  await firestore().collection('teamMembers').doc(employeeId).update(updateData);
}

/**
 * Fetches all employees for a given business, ordered alphabetically by name.
 */
export async function fetchEmployees(businessId: string): Promise<Employee[]> {
  const snap = await firestore()
    .collection('teamMembers')
    .where('businessId', '==', businessId)
    .orderBy('name', 'asc')
    .limit(200)
    .get();

  return snap.docs.map((doc: any) => docToEmployee(doc.id, doc.data()));
}

/**
 * Soft-removes an employee by setting status to 'inactive'.
 * The record is preserved for payroll history.
 */
export async function removeEmployee(employeeId: string): Promise<void> {
  await firestore().collection('teamMembers').doc(employeeId).update({
    status: 'inactive',
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  SALARY STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gets the salary structure for a specific employee.
 * Returns a default (all zeroes) structure if the employee doesn't have one.
 */
export async function getSalaryStructure(
  employeeId: string,
): Promise<SalaryStructure> {
  const snap = await firestore().collection('teamMembers').doc(employeeId).get();
  if (!snap.exists) throw new Error('Employee not found');

  const d = snap.data();
  return d.salaryStructure ?? defaultSalaryStructure();
}

/**
 * Updates the salary structure for a specific employee.
 * Merges the provided partial structure with the existing one.
 */
export async function updateSalaryStructure(
  employeeId: string,
  structure: Partial<SalaryStructure>,
): Promise<void> {
  // Fetch existing structure
  const snap = await firestore().collection('teamMembers').doc(employeeId).get();
  if (!snap.exists) throw new Error('Employee not found');

  const d = snap.data();
  const existing: SalaryStructure = d.salaryStructure ?? defaultSalaryStructure();
  const merged: SalaryStructure = { ...existing, ...structure };

  await firestore().collection('teamMembers').doc(employeeId).update({
    salaryStructure: merged,
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  PAYROLL MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generates payroll for all active employees of a business for a given month.
 *
 * The `month` parameter should be in 'YYYY-MM' format (e.g., '2024-07').
 *
 * For each active employee, creates a PayrollEntry with their salary structure,
 * computes gross salary, deductions, and net pay. Includes performance bonuses
 * if available.
 *
 * If a payroll already exists for the month, returns the existing one.
 */
export async function generatePayroll(
  businessId: string,
  month: string,
): Promise<Payroll> {
  const currentUid = auth()?.currentUser?.uid;
  if (!currentUid) throw new Error('Not authenticated');

  // Check if payroll already exists for this month
  const existingSnap = await firestore()
    .collection('payroll')
    .where('businessId', '==', businessId)
    .where('month', '==', month)
    .limit(1)
    .get();

  if (existingSnap.docs.length > 0) {
    return docToPayroll(existingSnap.docs[0].id, existingSnap.docs[0].data());
  }

  // Fetch all active employees
  const employees = await fetchEmployees(businessId);
  const activeEmployees = employees.filter(e => e.status === 'active');

  // Fetch performance bonuses for each employee in this period
  const entries: PayrollEntry[] = [];

  for (const emp of activeEmployees) {
    const structure: SalaryStructure = emp.salaryStructure ?? defaultSalaryStructure();

    let performanceBonus = 0;
    try {
      performanceBonus = await calculatePerformanceBonus(emp.id, month);
    } catch {
      // No performance data — bonus stays 0
    }

    const gross = computeGross(structure) + performanceBonus;
    const deductions = computeDeductions(structure);
    const net = gross - deductions;

    entries.push({
      employeeId: emp.id,
      employeeName: emp.name,
      role: emp.role,
      profileImage: emp.profileImage,
      grossSalary: gross,
      deductions,
      netSalary: Math.max(0, net),
      breakdown: { ...structure },
      performanceBonus,
      paymentStatus: 'pending',
      notes: '',
    });
  }

  // Compute totals
  const totalGross = entries.reduce((s, e) => s + e.grossSalary, 0);
  const totalDeductions = entries.reduce((s, e) => s + e.deductions, 0);
  const totalNet = entries.reduce((s, e) => s + e.netSalary, 0);

  const payrollData: Record<string, any> = {
    businessId,
    month,
    entries,
    totalGross,
    totalDeductions,
    totalNet,
    employeeCount: entries.length,
    paidCount: 0,
    status: 'generated',
    generatedBy: currentUid,
    generatedAt: firestore.FieldValue.serverTimestamp(),
    updatedAt: firestore.FieldValue.serverTimestamp(),
  };

  const ref = await firestore().collection('payroll').add(payrollData);
  const snap = await firestore().collection('payroll').doc(ref.id).get();
  return docToPayroll(snap.id, snap.data());
}

/**
 * Fetches all payroll records for a business, ordered by month descending.
 */
export async function fetchPayrollHistory(
  businessId: string,
): Promise<Payroll[]> {
  const snap = await firestore()
    .collection('payroll')
    .where('businessId', '==', businessId)
    .orderBy('month', 'desc')
    .limit(24)
    .get();

  return snap.docs.map((doc: any) => docToPayroll(doc.id, doc.data()));
}

/**
 * Marks a specific employee's salary as paid within a payroll period.
 *
 * Updates the individual PayrollEntry's paymentStatus and paymentData,
 * increments the payroll's paidCount, and updates the overall payroll status
 * (generated → partially_paid → paid).
 */
export async function markSalaryPaid(
  payrollId: string,
  employeeId: string,
  paymentData: PaymentData,
): Promise<void> {
  const snap = await firestore().collection('payroll').doc(payrollId).get();
  if (!snap.exists) throw new Error('Payroll not found');

  const payroll = docToPayroll(snap.id, snap.data());

  // Find and update the employee entry
  const entryIndex = payroll.entries.findIndex(e => e.employeeId === employeeId);
  if (entryIndex === -1) throw new Error('Employee not found in this payroll');

  const updatedEntries = [...payroll.entries];
  updatedEntries[entryIndex] = {
    ...updatedEntries[entryIndex],
    paymentStatus: 'paid',
    paymentData,
  };

  const newPaidCount = updatedEntries.filter(e => e.paymentStatus === 'paid').length;

  let newStatus: Payroll['status'];
  if (newPaidCount === 0) {
    newStatus = 'generated';
  } else if (newPaidCount >= payroll.employeeCount) {
    newStatus = 'paid';
  } else {
    newStatus = 'partially_paid';
  }

  await firestore().collection('payroll').doc(payrollId).update({
    entries: updatedEntries,
    paidCount: newPaidCount,
    status: newStatus,
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });

  // Also update the employee's paymentStatus in teamMembers
  await firestore().collection('teamMembers').doc(employeeId).update({
    paymentStatus: 'Paid',
    lastPaidAt: paymentData.paidAt,
    updatedAt: firestore.FieldValue.serverTimestamp(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  PERFORMANCE-BASED SALARY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculates the performance bonus for an employee in a given period.
 *
 * The `period` should be in 'YYYY-MM' format. Looks up the employee's
 * performance metrics from the `employeePerformance` subcollection and
 * computes a bonus based on a configurable formula.
 *
 * Bonus formula:
 *   baseSalary × (overallScore / 100) × targetAchievement × bonusMultiplier
 *
 * The bonusMultiplier is capped at 0.5 (50% of base salary as maximum bonus).
 *
 * Returns the bonus amount in paise.
 */
export async function calculatePerformanceBonus(
  employeeId: string,
  period: string,
): Promise<number> {
  // Fetch performance metrics for the period
  let metrics: PerformanceMetrics | null = null;
  try {
    const perfSnap = await firestore()
      .collection(`teamMembers/${employeeId}/performance`)
      .where('month', '==', period)
      .limit(1)
      .get();

    if (perfSnap.docs.length > 0) {
      const d = perfSnap.docs[0].data();
      metrics = {
        employeeId,
        period,
        month: d.month ?? period,
        targetAchievement: d.targetAchievement ?? 0,
        leadsGenerated: d.leadsGenerated ?? 0,
        dealsClosed: d.dealsClosed ?? 0,
        revenueGenerated: d.revenueGenerated ?? 0,
        customerSatisfaction: d.customerSatisfaction ?? 0,
        attendanceRate: d.attendanceRate ?? 0,
        taskCompletionRate: d.taskCompletionRate ?? 0,
        overallScore: d.overallScore ?? 0,
        recordedAt: tsToISO(d.recordedAt),
      };
    }
  } catch (e) {
    console.warn('[Salary] Failed to fetch performance metrics:', e);
  }

  if (!metrics || metrics.overallScore === 0) {
    return 0;
  }

  // Fetch employee's base salary
  const empSnap = await firestore().collection('teamMembers').doc(employeeId).get();
  if (!empSnap.exists) return 0;

  const empData = empSnap.data();
  const baseSalary = empData?.salaryStructure?.baseSalary ?? 0;

  if (baseSalary === 0) return 0;

  // Bonus calculation
  const BONUS_MULTIPLIER_CAP = 0.5; // Max 50% of base salary
  const scoreFactor = metrics.overallScore / 100;
  const targetFactor = metrics.targetAchievement;
  const bonusRatio = scoreFactor * targetFactor;

  // Cap the bonus at BONUS_MULTIPLIER_CAP of base salary
  const finalBonus = Math.min(bonusRatio, BONUS_MULTIPLIER_CAP) * baseSalary;

  return Math.round(finalBonus);
}

/**
 * Records performance metrics for an employee.
 *
 * Stores metrics in a `employeePerformance` subcollection under the employee's
 * teamMembers document. Also computes and stores an overall score based on
 * weighted performance factors.
 *
 * Overall score formula:
 *   targetAchievement (30%) +
 *   taskCompletionRate (20%) +
 *   attendanceRate (15%) +
 *   customerSatisfaction / 5 (20%) +
 *   revenueNormalized (15%)
 *
 * Where revenueNormalized = min(revenueGenerated / revenueTarget, 1).
 * Revenue target defaults to ₹100,000 (10,000,000 paise).
 */
export async function recordEmployeePerformance(
  employeeId: string,
  metrics: Omit<PerformanceMetrics, 'employeeId' | 'overallScore' | 'recordedAt'>,
): Promise<void> {
  // Compute overall score from weighted components
  const REVENUE_TARGET = 10000000; // ₹100,000 in paise
  const revenueNormalized = Math.min(
    (metrics.revenueGenerated ?? 0) / REVENUE_TARGET,
    1,
  );
  const csatNormalized = (metrics.customerSatisfaction ?? 0) / 5;

  const overallScore = Math.round(
    ((metrics.targetAchievement ?? 0) * 0.30 +
     (metrics.taskCompletionRate ?? 0) * 0.20 +
     (metrics.attendanceRate ?? 0) * 0.15 +
     csatNormalized * 0.20 +
     revenueNormalized * 0.15) * 100,
  );

  const performanceData: Record<string, any> = {
    employeeId,
    period: metrics.period,
    month: metrics.month,
    targetAchievement: metrics.targetAchievement ?? 0,
    leadsGenerated: metrics.leadsGenerated ?? 0,
    dealsClosed: metrics.dealsClosed ?? 0,
    revenueGenerated: metrics.revenueGenerated ?? 0,
    customerSatisfaction: metrics.customerSatisfaction ?? 0,
    attendanceRate: metrics.attendanceRate ?? 0,
    taskCompletionRate: metrics.taskCompletionRate ?? 0,
    overallScore,
    recordedAt: firestore.FieldValue.serverTimestamp(),
  };

  // Use the month as document ID for easy lookup / upsert behavior
  await firestore()
    .collection(`teamMembers/${employeeId}/performance`)
    .doc(metrics.month)
    .set(performanceData, { merge: true });
}

// ═══════════════════════════════════════════════════════════════════════════
//  SALARY REPORTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generates a comprehensive salary report for a business for a given period.
 *
 * The `period` should be in 'YYYY-MM' format. If no payroll exists for the
 * period, a new one is generated first.
 *
 * The report includes totals, averages, department breakdowns, and
 * month-over-month / year-over-year growth calculations.
 */
export async function getSalaryReport(
  businessId: string,
  period: string,
): Promise<SalaryReport> {
  // Get or generate payroll for this period
  const payroll = await generatePayroll(businessId, period);

  const entries = payroll.entries;
  const netSalaries = entries.map(e => e.netSalary);

  const totalGrossSalary = entries.reduce((s, e) => s + e.grossSalary, 0);
  const totalDeductions = entries.reduce((s, e) => s + e.deductions, 0);
  const totalNetSalary = entries.reduce((s, e) => s + e.netSalary, 0);
  const totalBonuses = entries.reduce((s, e) => s + e.performanceBonus, 0);
  const averageSalary = entries.length > 0
    ? Math.round(totalNetSalary / entries.length)
    : 0;
  const highestSalary = netSalaries.length > 0 ? Math.max(...netSalaries) : 0;
  const lowestSalary = netSalaries.length > 0 ? Math.min(...netSalaries) : 0;

  // Department breakdown
  const deptMap = new Map<string, { salaries: number[]; count: number }>();
  for (const entry of entries) {
    // Fetch department from employee record
    let department = 'General';
    try {
      const empSnap = await firestore()
        .collection('teamMembers')
        .doc(entry.employeeId)
        .get();
      if (empSnap.exists) {
        department = empSnap.data()?.department ?? 'General';
      }
    } catch {
      // Keep default
    }

    const existing = deptMap.get(department) ?? { salaries: [], count: 0 };
    existing.salaries.push(entry.netSalary);
    existing.count += 1;
    deptMap.set(department, existing);
  }

  const departmentBreakdown: DepartmentSalaryBreakdown[] = Array.from(
    deptMap.entries(),
  ).map(([department, data]) => {
    const deptTotal = data.salaries.reduce((s, v) => s + v, 0);
    return {
      department,
      employeeCount: data.count,
      totalSalary: deptTotal,
      averageSalary: data.count > 0 ? Math.round(deptTotal / data.count) : 0,
      highestSalary: Math.max(...data.salaries),
      lowestSalary: Math.min(...data.salaries),
    };
  });

  // Month-over-month growth
  let momGrowth: number | null = null;
  const [year, month] = period.split('-').map(Number);
  const prevMonthStr = `${year}-${String(month - 1 || 12).padStart(2, '0')}`;
  if (month === 1) {
    // Previous December of previous year
    prevMonthStr.replace(`${year}-01`, `${year - 1}-12`);
  }
  try {
    const prevPayrollSnap = await firestore()
      .collection('payroll')
      .where('businessId', '==', businessId)
      .where('month', '==', prevMonthStr)
      .limit(1)
      .get();

    if (prevPayrollSnap.docs.length > 0) {
      const prevTotalNet = prevPayrollSnap.docs[0].data()?.totalNet ?? 0;
      if (prevTotalNet > 0) {
        momGrowth = Math.round(
          ((totalNetSalary - prevTotalNet) / prevTotalNet) * 10000,
        ) / 100;
      }
    }
  } catch {
    // Cannot compute MoM — keep null
  }

  // Year-over-year growth
  let yoyGrowth: number | null = null;
  const prevYearPeriod = `${year - 1}-${String(month).padStart(2, '0')}`;
  try {
    const yoyPayrollSnap = await firestore()
      .collection('payroll')
      .where('businessId', '==', businessId)
      .where('month', '==', prevYearPeriod)
      .limit(1)
      .get();

    if (yoyPayrollSnap.docs.length > 0) {
      const yoyTotalNet = yoyPayrollSnap.docs[0].data()?.totalNet ?? 0;
      if (yoyTotalNet > 0) {
        yoyGrowth = Math.round(
          ((totalNetSalary - yoyTotalNet) / yoyTotalNet) * 10000,
        ) / 100;
      }
    }
  } catch {
    // Cannot compute YoY — keep null
  }

  return {
    businessId,
    period,
    totalEmployees: entries.length,
    totalGrossSalary,
    totalDeductions,
    totalNetSalary,
    totalBonuses,
    averageSalary,
    highestSalary,
    lowestSalary,
    departmentBreakdown,
    yoyGrowth,
    momGrowth,
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  UTILITY FORMATTERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Formats paise to INR string.
 * Example: 2500000 → "₹25,000"
 */
export function formatSalary(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

/**
 * Formats a month string ('YYYY-MM') to a readable label.
 * Example: '2024-07' → 'July 2024'
 */
export function formatPayrollMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${monthNames[(m ?? 1) - 1]} ${year}`;
}

/**
 * Computes net salary from a SalaryStructure.
 * Returns value in paise.
 */
export function computeNetSalary(s: SalaryStructure): number {
  return Math.max(0, computeGross(s) - computeDeductions(s));
}
