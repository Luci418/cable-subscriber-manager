/**
 * Authoritative financial reconciliation for a subscriber.
 *
 * Single source of truth for every "what is owed" surface in the UI:
 *   - device cards (per-subscription)
 *   - per-service summary
 *   - overall subscriber position
 *   - Billing worklist
 *
 * All numbers derive from the immutable transactions ledger. Voided and
 * reversal rows are excluded so a void + offsetting reversal correctly nets
 * to zero. The numbers ALWAYS satisfy:
 *
 *    service.netOutstanding === sum(perSub.remaining) - service.unallocatedCredit
 *    service.netOutstanding === subscribers.<service>_balance   (DB invariant)
 *
 * Subscription rows are net of voided/reversal allocations. "Unallocated
 * credit" is the portion of net payments that the FIFO trigger could not
 * place against any subscription (advance credit waiting to be applied).
 */

export interface ReconSubscription {
  id: string;
  service_type: 'cable' | 'internet';
  status: string;
  total_charged: number;
  refund_amount?: number | null;
}

export interface ReconAllocation {
  subscription_id: string;
  amount: number;
  transaction_id: string;
}

export interface ReconTransaction {
  id: string;
  type: string;            // charge | payment | adjustment | refund
  amount: number;
  service_type: 'cable' | 'internet' | null;
  status: string;          // posted | voided | reversal
}

export interface PerSubscriptionRecon {
  subscription_id: string;
  service_type: 'cable' | 'internet';
  status: string;
  total_charged: number;
  total_allocated: number; // sum of allocations from live (non-void) transactions
  remaining: number;       // max(0, total_charged - total_allocated)
}

export interface PerServiceRecon {
  service: 'cable' | 'internet';
  total_charged: number;        // live charges only
  total_payments: number;       // live payments only
  total_adjustments_credit: number; // live adjustment credits
  total_refunds: number;        // refund outflows (charge-type w/ refund source)
  allocated_to_subs: number;    // sum of live allocations
  unallocated_credit: number;   // advance credit not yet applied to any sub
  net_outstanding: number;      // == subscribers.<service>_balance
  perSub: PerSubscriptionRecon[];
}

export interface OverallRecon {
  services: PerServiceRecon[];
  net_outstanding: number;
}

const isLive = (status: string) => status !== 'voided' && status !== 'reversal';

export function computeReconciliation(
  subscriptions: ReconSubscription[],
  allocations: ReconAllocation[],
  transactions: ReconTransaction[],
): OverallRecon {
  // Index of allocations by subscription, scoped to live transactions only.
  const liveTxIds = new Set(transactions.filter(t => isLive(t.status)).map(t => t.id));
  const allocBySub: Record<string, number> = {};
  for (const a of allocations) {
    if (!liveTxIds.has(a.transaction_id)) continue;
    allocBySub[a.subscription_id] = (allocBySub[a.subscription_id] || 0) + Number(a.amount || 0);
  }

  const services: ('cable' | 'internet')[] = ['cable', 'internet'];
  const out: PerServiceRecon[] = services.map((svc) => {
    const subs = subscriptions.filter(s => s.service_type === svc);
    const perSub: PerSubscriptionRecon[] = subs.map((s) => {
      const allocated = allocBySub[s.id] || 0;
      return {
        subscription_id: s.id,
        service_type: svc,
        status: s.status,
        total_charged: Number(s.total_charged) || 0,
        total_allocated: allocated,
        remaining: Math.max(0, (Number(s.total_charged) || 0) - allocated),
      };
    });

    // Service-level totals from the immutable ledger.
    const liveSvcTx = transactions.filter(t => isLive(t.status) && t.service_type === svc);
    const total_charged   = liveSvcTx.filter(t => t.type === 'charge').reduce((s, t) => s + Number(t.amount || 0), 0);
    const total_payments  = liveSvcTx.filter(t => t.type === 'payment').reduce((s, t) => s + Number(t.amount || 0), 0);
    const total_adjustments_credit = liveSvcTx.filter(t => t.type === 'adjustment').reduce((s, t) => s + Number(t.amount || 0), 0);
    const total_refunds = liveSvcTx.filter(t => t.type === 'refund').reduce((s, t) => s + Number(t.amount || 0), 0);

    const allocated_to_subs = perSub.reduce((s, p) => s + p.total_allocated, 0);
    // Net outstanding mirrors the DB recalc: charges - payments - adjustments + refunds.
    const net_outstanding = total_charged - total_payments - total_adjustments_credit + total_refunds;
    const total_credits = total_payments + total_adjustments_credit;
    const unallocated_credit = Math.max(0, total_credits - allocated_to_subs - total_refunds);

    return {
      service: svc,
      total_charged,
      total_payments,
      total_adjustments_credit,
      total_refunds,
      allocated_to_subs,
      unallocated_credit,
      net_outstanding,
      perSub,
    };
  });

  return {
    services: out,
    net_outstanding: out.reduce((s, x) => s + x.net_outstanding, 0),
  };
}

/** Look up the outstanding balance for a specific subscription. Returns 0 when not found. */
export function remainingForSubscription(
  recon: OverallRecon,
  subscriptionId: string | null | undefined,
): number {
  if (!subscriptionId) return 0;
  for (const svc of recon.services) {
    const hit = svc.perSub.find(p => p.subscription_id === subscriptionId);
    if (hit) return hit.remaining;
  }
  return 0;
}

/**
 * Effective amount the customer must pay to settle a specific subscription
 * RIGHT NOW, after applying any unallocated advance credit on the same
 * service. Never goes below zero.
 */
export function payableForSubscription(
  recon: OverallRecon,
  subscriptionId: string | null | undefined,
  service: 'cable' | 'internet',
): number {
  const owed = remainingForSubscription(recon, subscriptionId);
  if (owed <= 0) return 0;
  const svc = recon.services.find(s => s.service === service);
  const credit = svc?.unallocated_credit || 0;
  return Math.max(0, owed - credit);
}
