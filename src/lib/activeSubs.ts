/**
 * Helpers for the multi-active-subscription model.
 *
 * Background
 * ----------
 * Up to Phase 4a, a subscriber had at most one "current" subscription per
 * service, stored as a JSONB blob (`current_subscription` for cable,
 * `internet_subscription` for internet). Phase 4b normalised subscriptions
 * into the relational `subscriptions` table and exposed them through two
 * read-only views:
 *
 *   - `v_subscriber_active_subscription`     — one row per ACTIVE subscription
 *   - `v_subscriber_subscription_timeline`   — one row per subscription (any status)
 *
 * Because the `create_subscription` RPC enforces uniqueness at the DEVICE
 * level (not the subscriber level), a single subscriber can have multiple
 * active subscriptions on the same service when they have multiple devices
 * (e.g. two STBs → two active cable subs). The UI therefore models active
 * subscriptions as ARRAYS, even when length is typically 0 or 1 today.
 *
 * The hook `useSubscribers` augments each subscriber row with:
 *   - _activeCable:      ActiveBlob[]   (one element per active cable sub)
 *   - _activeInternet:   ActiveBlob[]
 *   - _timelineCable:    TimelineBlob[] (all cable subs, active + history)
 *   - _timelineInternet: TimelineBlob[]
 *
 * Components consume these via the small helpers below so we never reach
 * into the legacy JSONB columns again.
 */

export type ServiceType = 'cable' | 'internet';

/** Blob shape returned by both views. Mirrors the legacy `current_subscription` JSON. */
export interface SubscriptionBlob {
  subscriptionId: string;
  packId: string | null;
  packName: string;
  packPrice: number;
  billingType?: 'prepaid' | 'postpaid';
  validityDays?: number | null;
  duration: number;
  totalDays?: number | null;
  totalCharged?: number | null;
  startDate: string;
  endDate: string;
  status: 'active' | 'expired' | 'cancelled';
  providerId?: string | null;
  providerName?: string | null;
  deviceId?: string | null;
  stbNumber?: string | null;
  subscribedAt: string;
  previousSubscriptionId?: string | null;
  cancelledAt?: string | null;
  refundAmount?: number | null;
  cancelReasonCode?: string | null;
  cancelReasonNote?: string | null;
}

/** Subscriber row enriched with normalised subscription arrays. */
export interface EnrichedSubscriber {
  _activeCable: SubscriptionBlob[];
  _activeInternet: SubscriptionBlob[];
  _timelineCable: SubscriptionBlob[];
  _timelineInternet: SubscriptionBlob[];
  [k: string]: any;
}

const safeArr = <T,>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);

export const getActives = (s: any, service: ServiceType): SubscriptionBlob[] =>
  service === 'cable' ? safeArr(s?._activeCable) : safeArr(s?._activeInternet);

export const getTimeline = (s: any, service: ServiceType): SubscriptionBlob[] =>
  service === 'cable' ? safeArr(s?._timelineCable) : safeArr(s?._timelineInternet);

/** Subscriptions that are NOT in the active set — i.e. the legacy "history" list. */
export const getHistory = (s: any, service: ServiceType): SubscriptionBlob[] => {
  const actives = new Set(getActives(s, service).map((a) => a.subscriptionId));
  return getTimeline(s, service).filter((t) => !actives.has(t.subscriptionId));
};

/** Most recent active subscription (by start date) — primary card display. */
export const primaryActive = (arr: SubscriptionBlob[]): SubscriptionBlob | null =>
  arr.length > 0 ? arr[0] : null;

export const hasAnyActive = (s: any, service: ServiceType): boolean =>
  getActives(s, service).length > 0;

/** Convenience: any active across both services? */
export const hasAnyServiceActive = (s: any): boolean =>
  hasAnyActive(s, 'cable') || hasAnyActive(s, 'internet');

/** Days until expiry. Positive = days remaining, Negative = days since expiry. */
export const daysUntil = (endDate: string): number => {
  const end = new Date(endDate).getTime();
  const now = Date.now();
  return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
};

/** True when end date is in the future. */
export const isActiveBlob = (b: SubscriptionBlob | null | undefined): boolean =>
  !!b && new Date(b.endDate).getTime() > Date.now();
