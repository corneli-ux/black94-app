/**
 * shiprocket.ts — ShipRocket API Integration Framework
 *
 * Complete ShipRocket (Indian e-commerce shipping API) client for the Black94 app.
 * Stores credentials in Firestore, auto-refreshes tokens, and syncs shipment
 * tracking status updates back to Firestore.
 *
 * USAGE:
 *   const client = await getShipRocketClient(businessId);
 *   const result = await client.trackShipment('awb_number');
 *
 * CONFIGURATION:
 *   Credentials are stored in Firestore at `shiprocket_config/{businessId}`
 *   with fields: email, password, token, tokenExpiry.
 */

import { firestore } from './firebase';

// ═══════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';
const TOKEN_BUFFER_MS = 60_000; // refresh token 60s before expiry
const TOKEN_DURATION_MS = 10 * 24 * 60 * 60 * 1000; // ShipRocket tokens last ~10 days

// ═══════════════════════════════════════════════════════════════════════════
//  TYPES — ShipRocket API Request / Response
// ═══════════════════════════════════════════════════════════════════════════

// ── Authentication ────────────────────────────────────────────────────────

export interface ShipRocketAuthRequest {
  email: string;
  password: string;
}

export interface ShipRocketAuthResponse {
  token: string;
  company_id: number;
  user_id: number;
  creator_id: number;
  owner_id: number;
  first_name: string;
  last_name: string;
  email: string;
  is_active: boolean;
  is_verified: boolean;
  company_name: string;
  company_logo: string;
  primary_color: string;
  secondary_color: string;
  currency: string;
  timezone: string;
  city: string;
  phone: string;
  postcode: string;
  state: string;
  country: string;
}

// ── Firestore Config ──────────────────────────────────────────────────────

export interface ShipRocketConfig {
  email: string;
  password: string;
  token: string;
  tokenExpiry: number; // epoch ms
  companyId?: number;
  companyName?: string;
}

// ── Create Order / Shipment ───────────────────────────────────────────────

export interface ShipRocketAddress {
  name: string;
  phone: string;
  email?: string;
  address: string;
  address_2?: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  landmark?: string;
}

export interface ShipRocketOrderItem {
  name: string;
  sku: string;
  units: number;
  selling_price: number;
  discount?: number;
  tax?: number;
  hsn?: string;
}

export interface ShipRocketOrderDimensions {
  length: number;
  breadth: number;
  height: number;
  weight: number;
}

export interface ShipRocketCreateShipmentRequest {
  order_id: string;
  order_date: string; // YYYY-MM-DD HH:mm
  pickup_location: string;
  channel_id?: string;
  comment?: string;
  billing_customer_name: string;
  billing_last_name?: string;
  billing_address: string;
  billing_address_2?: string;
  billing_city: string;
  billing_state: string;
  billing_country: string;
  billing_pincode: string;
  billing_email?: string;
  billing_phone: string;
  shipping_customer_name: string;
  shipping_last_name?: string;
  shipping_address: string;
  shipping_address_2?: string;
  shipping_city: string;
  shipping_state: string;
  shipping_country: string;
  shipping_pincode: string;
  shipping_email?: string;
  shipping_phone: string;
  order_items: ShipRocketOrderItem[];
  payment_method: string; // 'cod' | 'prepaid'
  shipping_charges: number;
  giftwrap_charges: number;
  transaction_charges: number;
  total_discount: number;
  sub_total: number;
  length: number;
  breadth: number;
  height: number;
  weight: number;
  ewaybill_no?: string;
  vendor_details?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    address_2?: string;
    city?: string;
    state?: string;
    pincode?: string;
  };
}

export interface ShipRocketCreateShipmentResponse {
  order_id: string;
  shipment_id: number;
  status: string;
  awb_code: string;
  courier_id: number;
  courier_name: string;
  tracking_url: string;
  current_status: string;
  current_timestamp: string;
  origin: string;
  destination: string;
  channel: string;
  tracking_id: string;
  error?: string;
  message?: string;
}

// ── Create Order (Quick) ──────────────────────────────────────────────────

export interface ShipRocketCreateOrderRequest {
  order_id: string;
  order_date: string;
  pickup_location: string;
  channel_id?: string;
  comment?: string;
  reseller_name?: string;
  company_name?: string;
  billing_customer_name: string;
  billing_last_name?: string;
  billing_address: string;
  billing_address_2?: string;
  billing_isd_code?: string;
  billing_city: string;
  billing_state: string;
  billing_country: string;
  billing_pincode: string;
  billing_email?: string;
  billing_phone: string;
  billing_tax_number?: string;
  billing_gstin?: string;
  shipping_is_billing: boolean;
  shipping_customer_name?: string;
  shipping_last_name?: string;
  shipping_address?: string;
  shipping_address_2?: string;
  shipping_isd_code?: string;
  shipping_city?: string;
  shipping_state?: string;
  shipping_country?: string;
  shipping_pincode?: string;
  shipping_email?: string;
  shipping_phone?: string;
  order_items: ShipRocketOrderItem[];
  payment_method: string;
  shipping_charges: number;
  giftwrap_charges: number;
  transaction_charges: number;
  total_discount: number;
  sub_total: number;
  length: number;
  breadth: number;
  height: number;
  weight: number;
  ewaybill_no?: string;
}

// ── Track Shipment ────────────────────────────────────────────────────────

export interface ShipRocketTrackingActivity {
  date: string;
  status: string;
  location: string;
  comments: string;
}

export interface ShipRocketTrackingResponse {
  tracking_id: string;
  shipment_id: number;
  awb_code: string;
  courier_company_id: number;
  courier_name: string;
  origin: string;
  destination: string;
  current_status: string;
  current_status_code: string;
  current_timestamp: string;
  shipment_status: number;
  shipment_status_created_at: string;
  delivered_at?: string;
  etd?: string;
  delivered_to?: string;
  delivery_location?: string;
  rto_awb?: string;
  tracking_url: string;
  tracking_activities: ShipRocketTrackingActivity[];
  tracking_history: ShipRocketTrackingActivity[];
}

// ── Check Serviceability ──────────────────────────────────────────────────

export interface ShipRocketServiceabilityParams {
  pickup_postcode: string;
  delivery_postcode: string;
  cod?: string; // '0' or '1'
  declared_value?: number;
  order_type?: string;
  weight?: number;
  length?: number;
  breadth?: number;
  height?: number;
}

export interface ShipRocketCourierServiceability {
  name: string;
  code: string;
  estimated_delivery_days: string;
  freight: number;
  insurance: number;
  cod_charges: number;
  shipping_charges: number;
  total_charges: number;
  cod?: string;
  supports_rto?: boolean;
  supports_cod?: boolean;
}

export interface ShipRocketServiceabilityResponse {
  status: boolean;
  message: string;
  data: {
    available_courier_companies: ShipRocketCourierServiceability[];
    backend_serviceability: boolean;
    error?: string;
  };
}

// ── Cancel Shipment ───────────────────────────────────────────────────────

export interface ShipRocketCancelShipmentRequest {
  awb: string[];
  cancellation_reason_id?: number;
  order_id?: string[];
}

export interface ShipRocketCancelShipmentResponse {
  status: boolean;
  message: string;
  cancellation_id?: string;
  status_code?: number;
}

// ── Generate Labels ───────────────────────────────────────────────────────

export interface ShipRocketLabelResponse {
  label_url: string;
  status: string;
  shipment_id: string;
  awb_code: string;
}

// ── Generate Manifest ─────────────────────────────────────────────────────

export interface ShipRocketManifestResponse {
  manifest_url: string;
  status: string;
  manifest_id: string;
  shipment_id: string;
  awb_code: string;
}

// ── Courier Partners ──────────────────────────────────────────────────────

export interface ShipRocketCourierPartner {
  id: number;
  name: string;
  logo: string;
  email: string;
  phone: string;
  address: string;
  cred_type: string;
  awb_count?: number;
  is_rvc: boolean;
  is_onboarded: boolean;
  disabled_by_sr?: boolean;
  active: boolean;
  has_surface: boolean;
  has_air: boolean;
  has_cod: boolean;
  has_prepaid: boolean;
  has_pickup: boolean;
  has_ewb: boolean;
  rto_tat: number;
  cod_percent: number;
  weight_limit: number;
  volumetric_weight_factor: number;
  description: string;
  account_type: string;
  zone: string;
  status: string;
  test_credential?: boolean;
  bank_details?: any;
  zone_details?: any;
}

export interface ShipRocketCourierListResponse {
  status: boolean;
  message: string;
  data: {
    shipping_couriers: ShipRocketCourierPartner[];
    logistics_couriers: ShipRocketCourierPartner[];
    dsp_couriers: ShipRocketCourierPartner[];
    custom_couriers: ShipRocketCourierPartner[];
    available_courier_companies: ShipRocketCourierPartner[];
  };
}

// ── Pickup Locations ──────────────────────────────────────────────────────

export interface ShipRocketPickupLocation {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  address_2: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  is_default: boolean;
  verified: boolean;
  pickup_location: string;
  pickup_time: string;
  shipping_address: string;
}

export interface ShipRocketPickupListResponse {
  data: {
    shipping_address: ShipRocketPickupLocation[];
  };
}

export interface ShipRocketCreatePickupRequest {
  pickup_location: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  address_2?: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  pickup_time?: string;
}

export interface ShipRocketCreatePickupResponse {
  shipping_address: ShipRocketPickupLocation;
}

// ── Warehouse ─────────────────────────────────────────────────────────────

export interface ShipRocketWarehouse {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  address_2: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  warehouse_company: string;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
}

export interface ShipRocketWarehouseListResponse {
  data: {
    warehouses: ShipRocketWarehouse[];
  };
}

export interface ShipRocketCreateWarehouseRequest {
  name: string;
  email: string;
  phone: string;
  address: string;
  address_2?: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
}

export interface ShipRocketCreateWarehouseResponse {
  warehouse: ShipRocketWarehouse;
}

// ── Order List ────────────────────────────────────────────────────────────

export interface ShipRocketOrderFilters {
  filter_by?: 'all' | 'intransit' | 'delivered' | 'rto' | 'cancelled';
  sort_by?: 'created_at' | 'dispatched_at';
  sort_order?: 'asc' | 'desc';
  search?: string;
  search_type?: 'order_id' | 'awb' | 'channel_order_id';
  page?: number;
  per_page?: number;
  from_date?: string;
  to_date?: string;
  pickup_start_date?: string;
  pickup_end_date?: string;
  order_type?: string;
  channel_id?: number;
  courier_id?: number;
  vendor_id?: number;
}

export interface ShipRocketOrder {
  id: number;
  order_id: string;
  channel_order_id: string;
  channel_name: string;
  pickup_location_name: string;
  shipping_zone: string;
  state: string;
  type: string;
  weight: string;
  length: string;
  breadth: string;
  height: string;
  status: string;
  courier_name: string;
  awb: string;
  shipment_id: number;
  shipped_by: string;
  dispatched_at?: string;
  delivered_at?: string;
  rto_delivered_at?: string;
  cancelled_at?: string;
  created_at: string;
  label_created_at?: string;
  invoice_created_at?: string;
  manifest_created_at?: string;
  sub_total: string;
  cod_amount: string;
  shipping_charges: string;
  discount: string;
  payment_method: string;
  destination_pincode: string;
  destination_city: string;
  destination_state: string;
  origin_pincode: string;
  origin_city: string;
  origin_state: string;
  seller_name: string;
  seller_add: string;
  buyer_name: string;
  buyer_add: string;
  buyer_city: string;
  buyer_state: string;
  buyer_phone: string;
  buyer_email: string;
  order_items: Array<{
    id: number;
    name: string;
    sku: string;
    units: number;
    selling_price: string;
    discount: string;
    tax: string;
    hsn: string;
  }>;
}

export interface ShipRocketOrderListResponse {
  status: boolean;
  message: string;
  counts: {
    total_orders: number;
    intransit_orders: number;
    delivered_orders: number;
    rto_orders: number;
    cancelled_orders: number;
  };
  data: ShipRocketOrder[];
}

// ── Returns ───────────────────────────────────────────────────────────────

export interface ShipRocketReturnItem {
  order_id: string;
  shipment_id: number;
  order_item_id: number;
  reason_id: number;
  reason: string;
  quantity: number;
  name: string;
  sku: string;
  selling_price: number;
}

export interface ShipRocketCreateReturnRequest {
  order_id: string;
  channel_order_id?: string;
  pickup_customer_name: string;
  pickup_last_name?: string;
  pickup_address: string;
  pickup_address_2?: string;
  pickup_city: string;
  pickup_state: string;
  pickup_country: string;
  pickup_pincode: string;
  pickup_email?: string;
  pickup_phone: string;
  return_customer_name: string;
  return_last_name?: string;
  return_address: string;
  return_address_2?: string;
  return_city: string;
  return_state: string;
  return_country: string;
  return_pincode: string;
  return_email?: string;
  return_phone: string;
  return_items: ShipRocketReturnItem[];
  return_method?: string;
  return_payment_mode?: string;
  return_dimensions?: {
    length: number;
    breadth: number;
    height: number;
    weight: number;
  };
}

export interface ShipRocketCreateReturnResponse {
  return_id: string;
  return_shipment_id: number;
  awb_code: string;
  courier_id: number;
  courier_name: string;
  status: string;
  tracking_url: string;
  return_label_url?: string;
  error?: string;
  message?: string;
}

// ── Webhook Events ────────────────────────────────────────────────────────

export type ShipRocketWebhookEventType =
  | 'shipment_created'
  | 'shipment_picked_up'
  | 'shipment_in_transit'
  | 'shipment_out_for_delivery'
  | 'shipment_delivered'
  | 'shipment_rto_initiated'
  | 'shipment_rto_delivered'
  | 'shipment_cancelled'
  | 'order_created'
  | 'order_returned';

export interface ShipRocketWebhookEvent {
  event_type: ShipRocketWebhookEventType;
  timestamp: string;
  data: {
    shipment_id: number;
    order_id: string;
    awb: string;
    courier_id: number;
    courier_name: string;
    status: string;
    status_code: string;
    current_timestamp: string;
    origin: string;
    destination: string;
    tracking_url?: string;
    location?: string;
    comments?: string;
    [key: string]: any;
  };
}

// ── Firestore Shipment Document ───────────────────────────────────────────

export interface FirestoreShipmentRecord {
  businessId: string;
  orderId: string;
  shipmentId: number;
  awb: string;
  courierName: string;
  courierId: number;
  status: string;
  statusCode: string;
  trackingUrl: string;
  origin: string;
  destination: string;
  lastUpdated: string;
  activities: Array<{
    date: string;
    status: string;
    location: string;
    comments: string;
  }>;
  createdAt: string;
  deliveredAt?: string;
  cancelledAt?: string;
}

// ── Generic API Error ─────────────────────────────────────────────────────

export class ShipRocketError extends Error {
  constructor(
    message: string,
    public statusCode: number = 0,
    public responseBody?: any,
  ) {
    super(message);
    this.name = 'ShipRocketError';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SHIPROCKET CLIENT CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class ShipRocketClient {
  private _businessId: string;
  private _token: string;
  private _tokenExpiry: number;
  private _email: string;
  private _password: string;

  constructor(config: ShipRocketConfig, businessId: string) {
    this._businessId = businessId;
    this._email = config.email;
    this._password = config.password;
    this._token = config.token;
    this._tokenExpiry = config.tokenExpiry;
  }

  // ── Token Management ────────────────────────────────────────────────────

  private get isTokenValid(): boolean {
    if (!this._token) return false;
    return Date.now() < this._tokenExpiry - TOKEN_BUFFER_MS;
  }

  private async ensureValidToken(): Promise<string> {
    if (this.isTokenValid) return this._token;

    console.log('[ShipRocket] Token expired, refreshing...');
    try {
      const newToken = await this.authenticate(this._email, this._password);
      console.log('[ShipRocket] Token refreshed successfully');
      return newToken;
    } catch (error) {
      console.error('[ShipRocket] Token refresh failed:', error);
      throw new ShipRocketError(
        'Failed to refresh ShipRocket token. Please check credentials.',
        401,
      );
    }
  }

  // ── HTTP Helper ─────────────────────────────────────────────────────────

  private async apiRequest<T>(
    path: string,
    method: 'GET' | 'POST' = 'GET',
    body?: any,
  ): Promise<T> {
    const token = await this.ensureValidToken();
    const url = `${SHIPROCKET_BASE_URL}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    console.log(`[ShipRocket] ${method} ${path}`);

    const opts: RequestInit = { method, headers };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
      console.log(`[ShipRocket] Body: ${JSON.stringify(body).slice(0, 500)}`);
    }

    let resp: Response;
    try {
      resp = await fetch(url, opts);
    } catch (networkError: any) {
      console.error('[ShipRocket] Network error:', networkError?.message);
      throw new ShipRocketError(
        `Network error calling ShipRocket: ${networkError?.message || 'Unknown'}`,
        0,
      );
    }

    console.log(`[ShipRocket] Response: ${resp.status} ${resp.statusText}`);

    // Safely parse response body
    let data: any;
    const respText = await resp.text();
    try {
      data = JSON.parse(respText);
    } catch {
      console.error(
        `[ShipRocket] Non-JSON response (${resp.status}): ${respText.slice(0, 300)}`,
      );
      throw new ShipRocketError(
        `ShipRocket returned non-JSON response: HTTP ${resp.status}`,
        resp.status,
        respText,
      );
    }

    if (!resp.ok) {
      const message =
        data.message ||
        data.error ||
        JSON.stringify(data).slice(0, 200) ||
        `ShipRocket HTTP ${resp.status}`;

      console.error(`[ShipRocket] API Error: ${resp.status} — ${message}`);

      // If 401, the token might be genuinely invalid — clear it
      if (resp.status === 401) {
        this._token = '';
        this._tokenExpiry = 0;
      }

      throw new ShipRocketError(message, resp.status, data);
    }

    return data as T;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════════

  // ── 1. Authentication ───────────────────────────────────────────────────

  /**
   * Authenticates with ShipRocket and persists the token to Firestore.
   * Call this to manually refresh or set up credentials for the first time.
   */
  async authenticate(
    email: string,
    password: string,
  ): Promise<string> {
    console.log('[ShipRocket] Authenticating...');

    const resp = await fetch(`${SHIPROCKET_BASE_URL}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    let data: any;
    const respText = await resp.text();
    try {
      data = JSON.parse(respText);
    } catch {
      throw new ShipRocketError(
        `Auth returned non-JSON: HTTP ${resp.status}`,
        resp.status,
        respText,
      );
    }

    if (!resp.ok || !data.token) {
      const msg = data.message || `Authentication failed (HTTP ${resp.status})`;
      console.error(`[ShipRocket] Auth failed: ${msg}`);
      throw new ShipRocketError(msg, resp.status, data);
    }

    // Update in-memory state
    this._token = data.token;
    this._tokenExpiry = Date.now() + TOKEN_DURATION_MS;
    this._email = email;
    this._password = password;

    // Persist to Firestore
    try {
      await firestore()
        .collection('shiprocket_config')
        .doc(this._businessId)
        .set({
          email,
          password,
          token: data.token,
          tokenExpiry: this._tokenExpiry,
          companyId: data.company_id || null,
          companyName: data.company_name || null,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

      console.log('[ShipRocket] Auth credentials saved to Firestore');
    } catch (firestoreError) {
      console.warn(
        '[ShipRocket] Failed to save credentials to Firestore:',
        firestoreError,
      );
      // Don't throw — the token is still valid in-memory
    }

    console.log(
      `[ShipRocket] Authenticated as "${data.company_name}" (ID: ${data.company_id})`,
    );

    return data.token;
  }

  // ── 2. Create Order (Quick) ────────────────────────────────────────────

  /**
   * Creates an order in ShipRocket. Note: This only registers the order —
   * use createShipment() to generate an AWB and dispatch it.
   */
  async createOrder(
    order: ShipRocketCreateOrderRequest,
  ): Promise<ShipRocketCreateShipmentResponse> {
    return this.apiRequest<ShipRocketCreateShipmentResponse>(
      '/orders/create/adhoc',
      'POST',
      order,
    );
  }

  // ── 3. Create Shipment ─────────────────────────────────────────────────

  /**
   * Creates a shipment (generates AWB, assigns courier) for an order.
   * If you already created an order, you can skip createOrder and go
   * straight to this endpoint.
   */
  async createShipment(
    shipment: ShipRocketCreateShipmentRequest,
  ): Promise<ShipRocketCreateShipmentResponse> {
    return this.apiRequest<ShipRocketCreateShipmentResponse>(
      '/shipments/create',
      'POST',
      shipment,
    );
  }

  // ── 4. Track Shipment ──────────────────────────────────────────────────

  /**
   * Tracks a shipment by AWB code. Returns full tracking history.
   */
  async trackShipment(
    awb: string,
  ): Promise<ShipRocketTrackingResponse> {
    return this.apiRequest<ShipRocketTrackingResponse>(
      `/courier/track/shipment/${encodeURIComponent(awb)}`,
    );
  }

  // ── 5. Check Serviceability ────────────────────────────────────────────

  /**
   * Checks if a pincode is serviceable and returns available couriers
   * with estimated delivery times and charges.
   */
  async checkServiceability(
    params: ShipRocketServiceabilityParams,
  ): Promise<ShipRocketServiceabilityResponse> {
    const query = new URLSearchParams();
    if (params.pickup_postcode) query.set('pickup_postcode', params.pickup_postcode);
    if (params.delivery_postcode) query.set('delivery_postcode', params.delivery_postcode);
    if (params.cod !== undefined) query.set('cod', params.cod);
    if (params.declared_value !== undefined) query.set('declared_value', String(params.declared_value));
    if (params.order_type) query.set('order_type', params.order_type);
    if (params.weight !== undefined) query.set('weight', String(params.weight));
    if (params.length !== undefined) query.set('length', String(params.length));
    if (params.breadth !== undefined) query.set('breadth', String(params.breadth));
    if (params.height !== undefined) query.set('height', String(params.height));

    return this.apiRequest<ShipRocketServiceabilityResponse>(
      `/courier/serviceability?${query.toString()}`,
    );
  }

  // ── 6. Cancel Shipment ─────────────────────────────────────────────────

  /**
   * Cancels shipments by AWB codes.
   * Optional cancellation_reason_id can be provided.
   */
  async cancelShipment(
    awbs: string[],
    cancellationReasonId?: number,
    orderIds?: string[],
  ): Promise<ShipRocketCancelShipmentResponse> {
    const body: ShipRocketCancelShipmentRequest = { awb: awbs };
    if (cancellationReasonId !== undefined) {
      body.cancellation_reason_id = cancellationReasonId;
    }
    if (orderIds && orderIds.length > 0) {
      body.order_id = orderIds;
    }

    return this.apiRequest<ShipRocketCancelShipmentResponse>(
      '/courier/track/awb/cancel',
      'POST',
      body,
    );
  }

  // ── 7. Generate Labels ─────────────────────────────────────────────────

  /**
   * Generates shipping labels for given shipment IDs.
   * Returns a URL to download the label PDF.
   */
  async generateLabels(
    shipmentIds: string[],
  ): Promise<ShipRocketLabelResponse[]> {
    const ids = shipmentIds.join(',');
    return this.apiRequest<ShipRocketLabelResponse[]>(
      `/shipments/label/${encodeURIComponent(ids)}`,
    );
  }

  // ── 8. Generate Manifest ───────────────────────────────────────────────

  /**
   * Generates a shipping manifest for given shipment IDs.
   * Returns a URL to download the manifest PDF.
   */
  async generateManifest(
    shipmentIds: string[],
  ): Promise<ShipRocketManifestResponse[]> {
    const ids = shipmentIds.join(',');
    return this.apiRequest<ShipRocketManifestResponse[]>(
      `/shipments/manifest/${encodeURIComponent(ids)}`,
    );
  }

  // ── 9. Get Courier Partners ────────────────────────────────────────────

  /**
   * Fetches all courier partners available for the account.
   */
  async getCourierPartners(): Promise<ShipRocketCourierListResponse> {
    return this.apiRequest<ShipRocketCourierListResponse>('/courier');
  }

  // ── 10. Get Pickup Locations ───────────────────────────────────────────

  /**
   * Fetches all registered pickup locations.
   */
  async getPickupLocations(): Promise<ShipRocketPickupLocation[]> {
    const resp = await this.apiRequest<ShipRocketPickupListResponse>(
      '/settings/pickup',
    );
    return resp?.data?.shipping_address || [];
  }

  // ── 11. Create Pickup Location ─────────────────────────────────────────

  /**
   * Creates a new pickup location for the account.
   */
  async createPickupLocation(
    location: ShipRocketCreatePickupRequest,
  ): Promise<ShipRocketPickupLocation> {
    const resp = await this.apiRequest<ShipRocketCreatePickupResponse>(
      '/settings/pickup/create',
      'POST',
      location,
    );
    return resp.shipping_address;
  }

  // ── 12. Get Warehouse List ─────────────────────────────────────────────

  /**
   * Fetches all warehouses registered for the account.
   */
  async getWarehouses(): Promise<ShipRocketWarehouse[]> {
    const resp = await this.apiRequest<ShipRocketWarehouseListResponse>(
      '/warehouses',
    );
    return resp?.data?.warehouses || [];
  }

  // ── 13. Create Warehouse ───────────────────────────────────────────────

  /**
   * Creates a new warehouse for the account.
   */
  async createWarehouse(
    warehouse: ShipRocketCreateWarehouseRequest,
  ): Promise<ShipRocketWarehouse> {
    const resp = await this.apiRequest<ShipRocketCreateWarehouseResponse>(
      '/warehouses/create',
      'POST',
      warehouse,
    );
    return resp.warehouse;
  }

  // ── 14. Get Order List ─────────────────────────────────────────────────

  /**
   * Fetches orders with optional filtering and pagination.
   */
  async getOrders(
    filters?: ShipRocketOrderFilters,
  ): Promise<ShipRocketOrderListResponse> {
    const query = new URLSearchParams();
    if (filters) {
      if (filters.filter_by) query.set('filter_by', filters.filter_by);
      if (filters.sort_by) query.set('sort_by', filters.sort_by);
      if (filters.sort_order) query.set('sort_order', filters.sort_order);
      if (filters.search) query.set('search', filters.search);
      if (filters.search_type) query.set('search_type', filters.search_type);
      if (filters.page) query.set('page', String(filters.page));
      if (filters.per_page) query.set('per_page', String(filters.per_page));
      if (filters.from_date) query.set('from_date', filters.from_date);
      if (filters.to_date) query.set('to_date', filters.to_date);
      if (filters.pickup_start_date) query.set('pickup_start_date', filters.pickup_start_date);
      if (filters.pickup_end_date) query.set('pickup_end_date', filters.pickup_end_date);
      if (filters.order_type) query.set('order_type', filters.order_type);
      if (filters.channel_id) query.set('channel_id', String(filters.channel_id));
      if (filters.courier_id) query.set('courier_id', String(filters.courier_id));
      if (filters.vendor_id) query.set('vendor_id', String(filters.vendor_id));
    }

    const qs = query.toString();
    const path = qs ? `/orders?${qs}` : '/orders';

    return this.apiRequest<ShipRocketOrderListResponse>(path);
  }

  // ── 15. Create Return ──────────────────────────────────────────────────

  /**
   * Creates a return shipment for an order.
   */
  async createReturn(
    returnData: ShipRocketCreateReturnRequest,
  ): Promise<ShipRocketCreateReturnResponse> {
    return this.apiRequest<ShipRocketCreateReturnResponse>(
      '/returns/create',
      'POST',
      returnData,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  HIGH-LEVEL HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Tracks a shipment and syncs the tracking status to Firestore.
   * Creates or updates a `shipments/{shipmentId}` document.
   */
  async trackAndSync(awb: string): Promise<{
    tracking: ShipRocketTrackingResponse;
    firestoreRecord: FirestoreShipmentRecord;
  }> {
    const tracking = await this.trackShipment(awb);

    // Build the Firestore record
    const activities = (tracking.tracking_history || []).map((a) => ({
      date: a.date,
      status: a.status,
      location: a.location,
      comments: a.comments,
    }));

    const record: FirestoreShipmentRecord = {
      businessId: this._businessId,
      orderId: tracking.tracking_id || '',
      shipmentId: tracking.shipment_id,
      awb: tracking.awb_code || awb,
      courierName: tracking.courier_name || '',
      courierId: tracking.courier_company_id,
      status: tracking.current_status || '',
      statusCode: tracking.current_status_code || '',
      trackingUrl: tracking.tracking_url || '',
      origin: tracking.origin || '',
      destination: tracking.destination || '',
      lastUpdated: tracking.current_timestamp || new Date().toISOString(),
      activities,
      createdAt: new Date().toISOString(),
    };

    if (tracking.delivered_at) record.deliveredAt = tracking.delivered_at;
    if (
      tracking.current_status?.toLowerCase() === 'cancelled' &&
      tracking.current_timestamp
    ) {
      record.cancelledAt = tracking.current_timestamp;
    }

    // Persist to Firestore
    try {
      const docId = String(tracking.shipment_id) || awb;
      await firestore()
        .collection('shipments')
        .doc(docId)
        .set({
          ...record,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

      console.log(`[ShipRocket] Tracking synced to Firestore: shipment=${docId}`);
    } catch (firestoreError) {
      console.warn(
        '[ShipRocket] Failed to sync tracking to Firestore:',
        firestoreError,
      );
      // Don't throw — tracking data is still valid
    }

    return { tracking, firestoreRecord: record };
  }

  /**
   * Creates a shipment and stores the result in Firestore.
   * Returns the shipment data including AWB and tracking URL.
   */
  async createAndSyncShipment(
    shipment: ShipRocketCreateShipmentRequest,
  ): Promise<{
    result: ShipRocketCreateShipmentResponse;
    firestoreRecord: FirestoreShipmentRecord;
  }> {
    const result = await this.createShipment(shipment);

    // Build Firestore record
    const record: FirestoreShipmentRecord = {
      businessId: this._businessId,
      orderId: shipment.order_id || result.order_id || '',
      shipmentId: result.shipment_id,
      awb: result.awb_code || '',
      courierName: result.courier_name || '',
      courierId: result.courier_id,
      status: result.current_status || 'AWB Assigned',
      statusCode: '',
      trackingUrl: result.tracking_url || '',
      origin: result.origin || '',
      destination: result.destination || '',
      lastUpdated: result.current_timestamp || new Date().toISOString(),
      activities: [],
      createdAt: new Date().toISOString(),
    };

    // Persist to Firestore
    try {
      const docId = String(result.shipment_id) || shipment.order_id;
      await firestore()
        .collection('shipments')
        .doc(docId)
        .set({
          ...record,
          updatedAt: firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

      console.log(`[ShipRocket] Shipment synced to Firestore: ${docId}`);
    } catch (firestoreError) {
      console.warn(
        '[ShipRocket] Failed to sync shipment to Firestore:',
        firestoreError,
      );
    }

    return { result, firestoreRecord: record };
  }

  /**
   * Fetches stored tracking info from Firestore for a given shipment ID.
   */
  async getLocalShipmentRecord(
    shipmentId: string,
  ): Promise<FirestoreShipmentRecord | null> {
    try {
      const docSnap = await firestore()
        .collection('shipments')
        .doc(shipmentId)
        .get();

      if (!docSnap.exists) return null;
      return docSnap.data() as FirestoreShipmentRecord;
    } catch (error) {
      console.warn('[ShipRocket] Failed to fetch local shipment:', error);
      return null;
    }
  }

  /**
   * Fetches all shipment records for this business from Firestore.
   */
  async getLocalShipments(): Promise<FirestoreShipmentRecord[]> {
    try {
      const snap = await firestore()
        .collection('shipments')
        .where('businessId', '==', this._businessId)
        .get();

      return snap.docs.map((doc: any) => doc.data());
    } catch (error) {
      console.warn('[ShipRocket] Failed to fetch local shipments:', error);
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  WEBHOOK HANDLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Processes an incoming ShipRocket webhook event and syncs to Firestore.
 *
 * Call this from your server-side webhook endpoint:
 *
 *   import { handleShipRocketWebhook } from './shiprocket';
 *   const result = await handleShipRocketWebhook(eventBody, businessId);
 *
 * @param payload — The parsed JSON body from ShipRocket's webhook POST
 * @param businessId — The Black94 business ID that owns this shipment
 */
export async function handleShipRocketWebhook(
  payload: ShipRocketWebhookEvent,
  businessId: string,
): Promise<{ success: boolean; message: string; shipmentId?: string }> {
  console.log(
    `[ShipRocket] Webhook received: ${payload.event_type} for order ${payload.data?.order_id}`,
  );

  try {
    const data = payload.data;
    if (!data) {
      return { success: false, message: 'No data in webhook payload' };
    }

    const shipmentId = String(data.shipment_id || data.order_id || '');

    // Update the shipment record in Firestore
    const updateData: Record<string, any> = {
      businessId,
      orderId: data.order_id || '',
      shipmentId: data.shipment_id,
      awb: data.awb || '',
      courierName: data.courier_name || '',
      courierId: data.courier_id,
      status: data.status || '',
      statusCode: data.status_code || '',
      trackingUrl: data.tracking_url || '',
      origin: data.origin || '',
      destination: data.destination || '',
      lastUpdated: data.current_timestamp || new Date().toISOString(),
      updatedAt: firestore.FieldValue.serverTimestamp(),
    };

    // Add new tracking activity
    if (data.comments || data.location) {
      const newActivity = {
        date: data.current_timestamp || new Date().toISOString(),
        status: data.status || payload.event_type,
        location: data.location || '',
        comments: data.comments || '',
      };

      // Use a sub-array push via fetching, appending, and writing back
      // (Firestore REST doesn't support arrayUnion)
      const existingDoc = await firestore()
        .collection('shipments')
        .doc(shipmentId)
        .get();

      let activities: any[] = [];
      if (existingDoc.exists) {
        activities = existingDoc.data()?.activities || [];
      }

      // Only add if this isn't a duplicate (same timestamp + status)
      const isDuplicate = activities.some(
        (a: any) =>
          a.date === newActivity.date && a.status === newActivity.status,
      );
      if (!isDuplicate) {
        activities.push(newActivity);
      }
      // Keep only last 50 activities to prevent unbounded growth
      if (activities.length > 50) {
        activities = activities.slice(-50);
      }
      updateData.activities = activities;
    }

    // Set delivered/cancelled timestamps
    if (data.status?.toLowerCase() === 'delivered') {
      updateData.deliveredAt = data.current_timestamp || new Date().toISOString();
    }
    if (data.status?.toLowerCase() === 'cancelled') {
      updateData.cancelledAt = data.current_timestamp || new Date().toISOString();
    }

    await firestore()
      .collection('shipments')
      .doc(shipmentId)
      .set(updateData, { merge: true });

    // Also update the order status in the orders collection if it exists
    if (data.order_id) {
      try {
        await firestore()
          .collection('orders')
          .doc(data.order_id)
          .update({
            trackingNumber: data.awb || '',
            trackingPartner: data.courier_name || '',
            status: mapShipRocketStatusToOrderStatus(data.status),
            updatedAt: firestore.FieldValue.serverTimestamp(),
          });
      } catch (orderUpdateError) {
        // Order may not exist in our system — that's OK
        console.warn(
          `[ShipRocket] Could not update order ${data.order_id}:`,
          orderUpdateError,
        );
      }
    }

    console.log(
      `[ShipRocket] Webhook processed: shipment=${shipmentId}, status=${data.status}`,
    );

    return {
      success: true,
      message: `Webhook processed: ${payload.event_type}`,
      shipmentId,
    };
  } catch (error: any) {
    console.error('[ShipRocket] Webhook processing error:', error?.message);
    return {
      success: false,
      message: error?.message || 'Internal webhook processing error',
    };
  }
}

/**
 * Maps ShipRocket tracking status to the Black94 order status enum.
 */
function mapShipRocketStatusToOrderStatus(
  shipRocketStatus: string,
): string {
  if (!shipRocketStatus) return 'processing';

  const lower = shipRocketStatus.toLowerCase();

  if (lower.includes('delivered')) return 'delivered';
  if (lower.includes('rto delivered') || lower.includes('rto_initiated'))
    return 'returned';
  if (lower.includes('cancelled')) return 'cancelled';
  if (lower.includes('out for delivery')) return 'shipped';
  if (lower.includes('in transit') || lower.includes('picked'))
    return 'shipped';
  if (lower.includes('manifest'))
    return 'processing';
  if (lower.includes('awb'))
    return 'confirmed';

  return 'processing';
}

// ═══════════════════════════════════════════════════════════════════════════
//  HELPER — Get Authenticated Client
// ═══════════════════════════════════════════════════════════════════════════

// Cache clients to avoid re-reading Firestore config on every call
const _clientCache = new Map<string, { client: ShipRocketClient; createdAt: number }>();
const CLIENT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Loads ShipRocket credentials from Firestore and returns an authenticated
 * ShipRocketClient instance ready to use.
 *
 * @param businessId — The Firestore doc ID in `shiprocket_config/{businessId}`
 * @throws ShipRocketError if no credentials are configured or auth fails
 *
 * USAGE:
 *   try {
 *     const client = await getShipRocketClient('business_123');
 *     const orders = await client.getOrders({ filter_by: 'intransit' });
 *   } catch (e) {
 *     // Handle missing credentials or API errors
 *   }
 */
export async function getShipRocketClient(
  businessId: string,
): Promise<ShipRocketClient> {
  // Check cache first
  const cached = _clientCache.get(businessId);
  if (cached && Date.now() - cached.createdAt < CLIENT_CACHE_TTL) {
    return cached.client;
  }

  console.log(`[ShipRocket] Loading config for business: ${businessId}`);

  try {
    const docSnap = await firestore()
      .collection('shiprocket_config')
      .doc(businessId)
      .get();

    if (!docSnap.exists) {
      throw new ShipRocketError(
        `ShipRocket not configured for business "${businessId}". ` +
        'Please add credentials to shiprocket_config in Firestore.',
        404,
      );
    }

    const config = docSnap.data() as ShipRocketConfig;

    if (!config.email || !config.password) {
      throw new ShipRocketError(
        `ShipRocket credentials incomplete for business "${businessId}". ` +
        'Both email and password are required.',
        400,
      );
    }

    // Create the client with stored config
    const client = new ShipRocketClient(config, businessId);

    // If the stored token is expired, the client will auto-refresh on first API call.
    // But let's proactively refresh here so the caller gets a ready-to-use client.
    if (!(client as any)['_isTokenValid']()) {
      console.log('[ShipRocket] Stored token expired, refreshing...');
      await client.authenticate(config.email, config.password);
    }

    // Cache the client
    _clientCache.set(businessId, { client, createdAt: Date.now() });

    return client;
  } catch (error: any) {
    if (error instanceof ShipRocketError) throw error;
    console.error('[ShipRocket] Failed to load config:', error?.message);
    throw new ShipRocketError(
      `Failed to load ShipRocket config: ${error?.message || 'Unknown error'}`,
      0,
    );
  }
}

/**
 * Clears the cached client for a given business (useful after credential updates).
 */
export function clearShipRocketClientCache(businessId?: string): void {
  if (businessId) {
    _clientCache.delete(businessId);
  } else {
    _clientCache.clear();
  }
}

/**
 * Saves ShipRocket credentials to Firestore. Call this when the user
 * first sets up their ShipRocket integration.
 *
 * After saving, use getShipRocketClient(businessId) to get an authenticated client.
 *
 * @param businessId — The Firestore doc ID
 * @param email — ShipRocket account email
 * @param password — ShipRocket account password
 * @returns true if credentials were saved and verified successfully
 */
export async function saveShipRocketCredentials(
  businessId: string,
  email: string,
  password: string,
): Promise<boolean> {
  console.log(`[ShipRocket] Saving credentials for business: ${businessId}`);

  try {
    // First, verify the credentials by authenticating
    const resp = await fetch(`${SHIPROCKET_BASE_URL}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    let data: any;
    const respText = await resp.text();
    try {
      data = JSON.parse(respText);
    } catch {
      throw new ShipRocketError(
        `Auth returned non-JSON: HTTP ${resp.status}`,
        resp.status,
      );
    }

    if (!resp.ok || !data.token) {
      const msg = data.message || `Authentication failed (HTTP ${resp.status})`;
      throw new ShipRocketError(msg, resp.status);
    }

    // Save to Firestore
    const tokenExpiry = Date.now() + TOKEN_DURATION_MS;

    await firestore()
      .collection('shiprocket_config')
      .doc(businessId)
      .set({
        email,
        password,
        token: data.token,
        tokenExpiry,
        companyId: data.company_id || null,
        companyName: data.company_name || null,
        isActive: true,
        createdAt: firestore.FieldValue.serverTimestamp(),
        updatedAt: firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

    // Clear any cached client so the next getShipRocketClient() call
    // picks up the fresh credentials
    clearShipRocketClientCache(businessId);

    console.log(
      `[ShipRocket] Credentials saved and verified for "${data.company_name}"`,
    );

    return true;
  } catch (error: any) {
    console.error('[ShipRocket] Failed to save credentials:', error?.message);
    if (error instanceof ShipRocketError) throw error;
    throw new ShipRocketError(
      `Failed to save ShipRocket credentials: ${error?.message || 'Unknown error'}`,
      0,
    );
  }
}

/**
 * Deletes ShipRocket credentials from Firestore and clears the client cache.
 */
export async function removeShipRocketCredentials(
  businessId: string,
): Promise<void> {
  try {
    await firestore()
      .collection('shiprocket_config')
      .doc(businessId)
      .update({
        token: '',
        tokenExpiry: 0,
        isActive: false,
        updatedAt: firestore.FieldValue.serverTimestamp(),
      });

    clearShipRocketClientCache(businessId);
    console.log(`[ShipRocket] Credentials cleared for business: ${businessId}`);
  } catch (error) {
    console.warn('[ShipRocket] Failed to clear credentials:', error);
  }
}

/**
 * Checks if ShipRocket is configured and active for a given business.
 */
export async function isShipRocketConfigured(
  businessId: string,
): Promise<boolean> {
  try {
    const docSnap = await firestore()
      .collection('shiprocket_config')
      .doc(businessId)
      .get();

    if (!docSnap.exists) return false;

    const data = docSnap.data();
    return !!(data?.email && data?.password && data?.isActive !== false);
  } catch {
    return false;
  }
}
