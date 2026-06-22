/**
 * Financial position + next-action chip helpers.
 *
 * Implements BUSINESS_MODEL §G1 (overall position terminology) and §G5
 * (next-action chip decision table).
 *
 * Terminology — strictly per §G1, never display raw numbers without a label:
 *   Outstanding       — customer owes money
 *   Available Credit  — cash advance, can be refunded or applied
 *   Service Credit    — non-cash adjustment credit (goodwill etc.)  [v2 — not yet differentiated from Available Credit until we tag adjustments]
 *   Refund Due        — cash owed back after cancellation refund [v2 — surfaces once we tag refund credit lines]
 *   Settled           — balance is exactly zero
 *
 * Current data model (post-Phase 4b / 5.3): subscribers.cable_balance and
 * subscribers.internet_balance are signed (positive = owed by customer,
 * negative = advance credit). We can't yet distinguish Service Credit from
 * Available Credit from Refund Due in the balance field alone — that
 * refinement is tracked for Phase 5.5 when the ledger surfaces gross
 * components (per Test 3 rendering note from the allocation verification).
 * Until then, any net-negative balance is labelled Available Credit.
 */

import { getActives, daysUntil, type SubscriptionBlob } from './activeSubs';

export type PositionKind =
  | 'outstanding'
  | 'available_credit'
  | 'service_credit'
  | 'refund_due'
  | 'settled';

export interface ServiceBreakdown {
  service: 'cable' | 'internet';
  balance: number; // signed, positive = owed
  actives: SubscriptionBlob[];
}

export interface OverallPosition {
  kind: PositionKind;
  label: string;          // "Outstanding ₹1,800" / "Settled" / etc.
  amount: number;         // absolute value, 0 when settled
  breakdown: ServiceBreakdown[];
}

const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export const labelForKind = (kind: PositionKind, amount: number): string => {
  switch (kind) {
    case 'outstanding':       return `Outstanding ${fmt(amount)}`;
    case 'available_credit':  return `Available Credit ${fmt(amount)}`;
    case 'service_credit':    return `Service Credit ${fmt(amount)}`;
    case 'refund_due':        return `Refund Due ${fmt(amount)}`;
    case 'settled':           return 'Settled';
  }
};

export const computeOverallPosition = (subscriber: any): OverallPosition => {
  const services = (subscriber.services && subscriber.services.length > 0
    ? subscriber.services
    : ['cable']) as ('cable' | 'internet')[];

  const breakdown: ServiceBreakdown[] = services.map((svc) => ({
    service: svc,
    balance: Number(svc === 'cable' ? subscriber.cable_balance : subscriber.internet_balance) || 0,
    actives: getActives(subscriber, svc),
  }));

  const net = breakdown.reduce((sum, b) => sum + b.balance, 0);

  if (net > 0) return { kind: 'outstanding',      label: labelForKind('outstanding',      net),  amount: net,            breakdown };
  if (net < 0) return { kind: 'available_credit', label: labelForKind('available_credit', -net), amount: -net,           breakdown };
  return        { kind: 'settled',          label: labelForKind('settled', 0),          amount: 0,              breakdown };
};

// -----------------------------------------------------------------------
// Next-action chip — §G5 decision table.
// Priority: most urgent first. Returns ONE chip per subscriber.
// -----------------------------------------------------------------------

export type ChipTone = 'success' | 'warning' | 'danger' | 'info' | 'muted';

export interface NextActionChip {
  label: string;
  tone: ChipTone;
  icon: string; // single emoji per §G5
}

const SERVICE_NAME = (s: 'cable' | 'internet') => (s === 'cable' ? 'Cable' : 'Internet');

export const computeNextActionChip = (subscriber: any): NextActionChip => {
  const pos = computeOverallPosition(subscriber);

  // Archived (best-effort — not currently a column, future-proofing)
  if (subscriber.archived || subscriber.archived_at) {
    return { label: 'Archived', tone: 'muted', icon: '🗄️' };
  }

  // Gather actives & detect expired/expiring across all services.
  const expiredServices: { service: 'cable' | 'internet'; balance: number }[] = [];
  const expiringSoon: { service: 'cable' | 'internet'; days: number }[] = [];
  let anyActive = false;

  for (const b of pos.breakdown) {
    if (b.actives.length === 0) {
      // Service declared but no active subscription
      if (b.balance > 0) {
        // covered by "Collect & renew" path below — treat as expired
        expiredServices.push({ service: b.service, balance: b.balance });
      } else {
        expiredServices.push({ service: b.service, balance: b.balance });
      }
      continue;
    }
    for (const a of b.actives) {
      anyActive = true;
      const d = daysUntil(a.endDate);
      if (d < 0) expiredServices.push({ service: b.service, balance: b.balance });
      else if (d <= 7) expiringSoon.push({ service: b.service, days: d });
    }
  }

  // 1. Expired + balance owed → Collect & renew (highest priority)
  const expiredWithDebt = expiredServices.find((e) => e.balance > 0);
  if (expiredWithDebt) {
    return {
      label: `Collect ${fmt(expiredWithDebt.balance)} and renew ${SERVICE_NAME(expiredWithDebt.service)}`,
      tone: 'danger',
      icon: '💰',
    };
  }

  // 2. Expired, zero or negative balance → Renew
  if (expiredServices.length > 0 && pos.kind !== 'outstanding') {
    const e = expiredServices[0];
    return {
      label: `Renew ${SERVICE_NAME(e.service)}`,
      tone: 'danger',
      icon: '🔄',
    };
  }

  // 3. Active + outstanding (no expiry urgency) → Collect
  if (pos.kind === 'outstanding') {
    return {
      label: `Collect ${fmt(pos.amount)}`,
      tone: 'warning',
      icon: '💰',
    };
  }

  // 4. Expiring within 7 days, settled → Renewal reminder
  if (expiringSoon.length > 0) {
    const soonest = expiringSoon.sort((a, b) => a.days - b.days)[0];
    const dayWord = soonest.days === 1 ? 'day' : 'days';
    return {
      label: `${SERVICE_NAME(soonest.service)} renewal due in ${soonest.days} ${dayWord}`,
      tone: 'warning',
      icon: '⏰',
    };
  }

  // 5. Available credit (cash advance)
  if (pos.kind === 'available_credit') {
    return {
      label: `${fmt(pos.amount)} credit — apply at next recharge`,
      tone: 'info',
      icon: '💳',
    };
  }

  // 6. Service credit (non-cash) — placeholder until adjustments are tagged
  if (pos.kind === 'service_credit') {
    return {
      label: `${fmt(pos.amount)} service credit available`,
      tone: 'info',
      icon: '🎁',
    };
  }

  // 7. Refund due
  if (pos.kind === 'refund_due') {
    return {
      label: `Return ${fmt(pos.amount)} to customer`,
      tone: 'warning',
      icon: '↩️',
    };
  }

  // 8. No active subscription at all, services declared, no debt
  if (!anyActive && pos.breakdown.length > 0) {
    const svc = pos.breakdown[0].service;
    return {
      label: `Renew ${SERVICE_NAME(svc)}`,
      tone: 'danger',
      icon: '🔄',
    };
  }

  // 9. All settled, >7 days remaining
  return { label: 'No action required', tone: 'success', icon: '✅' };
};

export const chipToneClasses = (tone: ChipTone): string => {
  switch (tone) {
    case 'success': return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30';
    case 'warning': return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30';
    case 'danger':  return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30';
    case 'info':    return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30';
    case 'muted':   return 'bg-muted text-muted-foreground border-border';
  }
};

export const positionToneClasses = (kind: PositionKind): string => {
  switch (kind) {
    case 'outstanding':      return 'text-red-700 dark:text-red-400';
    case 'available_credit': return 'text-green-700 dark:text-green-400';
    case 'service_credit':   return 'text-blue-700 dark:text-blue-400';
    case 'refund_due':       return 'text-yellow-700 dark:text-yellow-400';
    case 'settled':          return 'text-muted-foreground';
  }
};
