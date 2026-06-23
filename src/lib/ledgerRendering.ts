/**
 * Phase 5.5 — Ledger rendering model.
 *
 * Converts raw `transactions` + related `subscriptions` and
 * `payment_allocations` rows into a list of **business events** an operator
 * can read aloud to a subscriber during a dispute call without arithmetic
 * and without decoding ledger primitives.
 *
 * This is the SINGLE rendering model that powers both the on-screen passbook
 * (TransactionLedger.tsx) and the printable account statement (pdfStatement.ts).
 *
 * Vocabulary rules (per the Phase 5.5 brief):
 *   • Subscription charge → "[Service] [Pack] activated ([start]–[end])"
 *     OR "...renewed (...)" when `previous_subscription_id` is set.
 *   • Subscription refund  → "Refund issued — [pack] cancelled [date]"
 *   • Payment              → "Payment received — [Cash/UPI/Other]"
 *     with per-allocation expansion: "Applied ₹X to [pack] on [device]"
 *   • Adjustment           → "Service Credit — [reason]" / "Service Charge — [reason]"
 *   • Manual charge        → "Manual charge — [description]"
 *   • Void pair            → ONE collapsed entry, struck through, showing
 *     "Payment ₹X — Voided ([reason])". Expand reveals both the original
 *     and the reversal rows for audit trail.
 *
 * The function is pure: same inputs → same output. No I/O, no React. Use it
 * from the screen renderer, the PDF generator, and any future export.
 */

export type LedgerSubscription = {
  id: string;
  service_type: 'cable' | 'internet';
  pack_name_snapshot: string;
  start_date: string;
  end_date: string;
  device_serial_snapshot: string | null;
  previous_subscription_id: string | null;
  cancelled_at?: string | null;
  cancel_reason_note?: string | null;
  refund_amount?: number | null;
};

export type LedgerAllocation = {
  transaction_id: string;
  subscription_id: string;
  amount: number;
  allocated_by: string; // 'targeted_bill' | 'fifo' | 'manual' | ...
};

export type LedgerRawTransaction = {
  id: string;
  date: string;
  type: 'payment' | 'charge' | 'refund' | 'adjustment';
  amount: number;
  description: string | null;
  service_type: 'cable' | 'internet' | null;
  source: string; // transaction_source enum
  status: 'posted' | 'voided' | 'reversal';
  payment_method: string | null;
  subscription_id: string | null;
  reverses_transaction_id: string | null;
  void_reason: string | null;
  void_reason_code: string | null;
};

export type LedgerEntryKind =
  | 'subscription_activated'
  | 'subscription_renewed'
  | 'subscription_refund'
  | 'payment_received'
  | 'manual_charge'
  | 'service_credit'      // adjustment that REDUCES debt (credit to customer)
  | 'service_charge'      // adjustment that INCREASES debt (rare)
  | 'voided_pair'         // original + its reversal collapsed into one
  | 'unknown';

export type LedgerSign = 'debit' | 'credit'; // debit = customer owes more; credit = customer owes less

export type LedgerAllocationLine = {
  amount: number;
  packName: string;
  deviceSerial: string | null;
  targeted: boolean; // true when allocated_by = 'targeted_bill'
};

export type LedgerEntry = {
  id: string;
  date: string;
  kind: LedgerEntryKind;
  /** Short, human-readable business-event title (the line operators read aloud). */
  title: string;
  /** Optional second line of context (e.g. validity dates, device, reason). */
  subtitle?: string;
  /** Service icon hint. Null when not service-scoped (rare). */
  service: 'cable' | 'internet' | null;
  amount: number;
  sign: LedgerSign;
  /** Voided / reversal status — drives strike-through styling. */
  voided: boolean;
  voidReason?: string | null;
  /** Allocation breakdown for payment rows (empty if unallocated remainder). */
  allocations: LedgerAllocationLine[];
  /** Residual cash advance amount (payment − sum(allocations)). 0 when fully applied. */
  unallocatedRemainder: number;
  /** The underlying transaction IDs that compose this entry (1 normally, 2 for voided pairs). */
  sourceTransactionIds: string[];
  /** Free-form description fallback for entries we don't have business-language for yet. */
  rawDescription: string | null;
};

const fmtDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
};

const fmtDateShort = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  } catch { return iso; }
};

const serviceLabel = (s: 'cable' | 'internet' | null): string =>
  s === 'internet' ? 'Internet' : s === 'cable' ? 'Cable TV' : '';

const paymentMethodLabel = (m: string | null): string => {
  if (!m) return 'Cash';
  const norm = m.toLowerCase();
  if (norm === 'upi') return 'UPI';
  if (norm === 'cash') return 'Cash';
  if (norm === 'card') return 'Card';
  if (norm === 'bank' || norm === 'bank_transfer') return 'Bank Transfer';
  return m.charAt(0).toUpperCase() + m.slice(1);
};

/**
 * Build the ordered list of business-event ledger entries.
 * Output is sorted newest first.
 */
export function buildLedgerEntries(
  transactions: LedgerRawTransaction[],
  subscriptions: Record<string, LedgerSubscription>,
  allocationsByTx: Record<string, LedgerAllocation[]>,
): LedgerEntry[] {
  // 1. Pair voids with their reversals so they collapse into one entry.
  const reversalByOriginal: Record<string, LedgerRawTransaction> = {};
  const consumed = new Set<string>();
  for (const t of transactions) {
    if (t.status === 'reversal' && t.reverses_transaction_id) {
      reversalByOriginal[t.reverses_transaction_id] = t;
      consumed.add(t.id);
    }
  }

  const entries: LedgerEntry[] = [];

  for (const t of transactions) {
    if (consumed.has(t.id)) continue; // already represented by its original
    const sub = t.subscription_id ? subscriptions[t.subscription_id] : undefined;
    const svc: 'cable' | 'internet' | null =
      (t.service_type as any) || sub?.service_type || null;
    const isVoided = t.status === 'voided' || !!reversalByOriginal[t.id];
    const reversal = reversalByOriginal[t.id];
    const voidReason =
      t.void_reason || reversal?.description?.replace(/^Reversal:\s*/i, '') || null;
    const sourceIds = reversal ? [t.id, reversal.id] : [t.id];

    // Allocations attached to this transaction (payments only typically).
    const allocs = (allocationsByTx[t.id] || []).map<LedgerAllocationLine>((a) => {
      const s = subscriptions[a.subscription_id];
      return {
        amount: Number(a.amount) || 0,
        packName: s?.pack_name_snapshot || 'Unknown pack',
        deviceSerial: s?.device_serial_snapshot || null,
        targeted: a.allocated_by === 'targeted_bill',
      };
    });
    const allocatedTotal = allocs.reduce((sum, a) => sum + a.amount, 0);
    const unallocatedRemainder =
      t.type === 'payment' ? Math.max(0, Math.round((t.amount - allocatedTotal) * 100) / 100) : 0;

    // 2. Classify into a business event kind + craft title/subtitle.
    let kind: LedgerEntryKind = 'unknown';
    let sign: LedgerSign = t.type === 'payment' ? 'credit' : 'debit';
    let title = t.description || '';
    let subtitle: string | undefined;

    if (t.source === 'subscription_charge' && sub) {
      const renewed = !!sub.previous_subscription_id;
      kind = renewed ? 'subscription_renewed' : 'subscription_activated';
      const verb = renewed ? 'renewed' : 'activated';
      title = `${serviceLabel(svc)} ${sub.pack_name_snapshot} ${verb}`;
      subtitle = `Valid ${fmtDateShort(sub.start_date)} – ${fmtDateShort(sub.end_date)}` +
        (sub.device_serial_snapshot ? ` · ${sub.device_serial_snapshot}` : '');
      sign = 'debit';
    } else if (t.source === 'subscription_refund' && sub) {
      kind = 'subscription_refund';
      title = `Refund issued — ${sub.pack_name_snapshot} cancelled`;
      subtitle = sub.cancelled_at
        ? `Cancelled on ${fmtDate(sub.cancelled_at)}` +
          (sub.cancel_reason_note ? ` · ${sub.cancel_reason_note}` : '')
        : sub.cancel_reason_note || undefined;
      sign = 'credit';
    } else if (t.type === 'payment') {
      kind = 'payment_received';
      title = `Payment received — ${paymentMethodLabel(t.payment_method)}`;
      sign = 'credit';
    } else if (t.source === 'adjustment' || t.type === 'adjustment') {
      const reducesDebt = (t.type as string) === 'payment' || t.amount < 0;
      kind = reducesDebt ? 'service_credit' : 'service_charge';
      const reason = t.description || (kind === 'service_credit' ? 'goodwill adjustment' : 'adjustment');
      title = kind === 'service_credit'
        ? `Service Credit — ${reason}`
        : `Service Charge — ${reason}`;
      sign = reducesDebt ? 'credit' : 'debit';
    } else if (t.type === 'charge') {
      kind = 'manual_charge';
      title = t.description ? `Manual charge — ${t.description}` : 'Manual charge';
      sign = 'debit';
    } else {
      title = t.description || `${t.type} (${t.source})`;
    }

    if (isVoided) {
      kind = 'voided_pair';
      // Keep the original title so the operator still recognises what was reversed,
      // and surface the reason inline.
    }

    entries.push({
      id: t.id,
      date: t.date,
      kind,
      title,
      subtitle,
      service: svc,
      amount: Math.abs(t.amount),
      sign,
      voided: isVoided,
      voidReason: isVoided ? voidReason : null,
      allocations: allocs,
      unallocatedRemainder,
      sourceTransactionIds: sourceIds,
      rawDescription: t.description,
    });
  }

  entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return entries;
}

// -----------------------------------------------------------------------
// Gross-component summary — surfaces "₹200 outstanding | ₹102 advance"
// instead of just the net. Used by both the screen passbook header and
// the PDF statement summary block.
// -----------------------------------------------------------------------

export type GrossComponentLine = {
  label: string;       // "₹200 outstanding on STB-001 (Cable Basic)"
  amount: number;
  kind: 'outstanding' | 'available_credit' | 'service_credit' | 'refund_due';
};

export function buildGrossComponents(
  subscriber: { cable_balance?: number; internet_balance?: number; services?: string[] },
  outstandingBySub: Record<string, number>,
  subscriptions: Record<string, LedgerSubscription>,
): GrossComponentLine[] {
  const lines: GrossComponentLine[] = [];

  // Per-subscription outstanding (gross debt side).
  for (const [subId, owed] of Object.entries(outstandingBySub)) {
    if (owed <= 0) continue;
    const s = subscriptions[subId];
    const where = s?.device_serial_snapshot ? ` on ${s.device_serial_snapshot}` : '';
    const pack = s?.pack_name_snapshot ? ` (${s.pack_name_snapshot})` : '';
    lines.push({
      label: `₹${Math.round(owed).toLocaleString('en-IN')} outstanding${where}${pack}`,
      amount: owed,
      kind: 'outstanding',
    });
  }

  // Advance credit (gross credit side) — derived per service from signed balance.
  const cable = Number(subscriber.cable_balance) || 0;
  const internet = Number(subscriber.internet_balance) || 0;
  if (cable < 0) {
    lines.push({
      label: `₹${Math.round(-cable).toLocaleString('en-IN')} advance credit on Cable`,
      amount: -cable,
      kind: 'available_credit',
    });
  }
  if (internet < 0) {
    lines.push({
      label: `₹${Math.round(-internet).toLocaleString('en-IN')} advance credit on Internet`,
      amount: -internet,
      kind: 'available_credit',
    });
  }

  return lines;
}
