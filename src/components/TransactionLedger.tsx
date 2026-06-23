/**
 * Phase 5.5 — On-screen passbook.
 *
 * Renders the business-event ledger produced by `buildLedgerEntries`. The
 * goal is "operator can read this aloud to a subscriber during a dispute
 * call without explanation". See ledgerRendering.ts for the vocabulary
 * rules. This component contains only presentation logic — every label
 * comes from the rendering model.
 */
import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Tv,
  Wifi,
  ArrowDownCircle,
  ArrowUpCircle,
  RefreshCw,
  Gift,
  Undo2,
  XCircle,
  FileText,
  Trash2,
  Receipt,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { LedgerEntry, LedgerEntryKind } from '@/lib/ledgerRendering';

interface Props {
  entries: LedgerEntry[];
  onOpenNotes?: (txId: string) => void;
  onVoid?: (txId: string) => void;
  /** Returns true if the entry's underlying transaction is operator-voidable today. */
  canVoid?: (entry: LedgerEntry) => boolean;
}

const kindIcon: Record<LedgerEntryKind, JSX.Element> = {
  subscription_activated: <ArrowUpCircle className="h-4 w-4 text-red-600" />,
  subscription_renewed:   <RefreshCw    className="h-4 w-4 text-red-600" />,
  subscription_refund:    <Undo2        className="h-4 w-4 text-green-600" />,
  payment_received:       <ArrowDownCircle className="h-4 w-4 text-green-600" />,
  manual_charge:          <ArrowUpCircle className="h-4 w-4 text-red-600" />,
  service_credit:         <Gift         className="h-4 w-4 text-blue-600" />,
  service_charge:         <ArrowUpCircle className="h-4 w-4 text-amber-600" />,
  voided_pair:            <XCircle      className="h-4 w-4 text-muted-foreground" />,
  unknown:                <Receipt      className="h-4 w-4 text-muted-foreground" />,
};

const fmtINR = (n: number) =>
  `₹${Math.round(n).toLocaleString('en-IN')}`;

const fmtDateTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
};

export const TransactionLedger = ({ entries, onOpenNotes, onVoid, canVoid }: Props) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (entries.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">
        No activity to show yet.
      </p>
    );
  }

  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <ul className="divide-y divide-border" role="list">
      {entries.map((e) => {
        const isExpandable =
          e.allocations.length > 0 ||
          e.unallocatedRemainder > 0 ||
          e.voided ||
          e.sourceTransactionIds.length > 1;
        const open = !!expanded[e.id];
        const muted = e.voided ? 'opacity-60' : '';
        const amountClass =
          e.voided
            ? 'text-muted-foreground line-through'
            : e.sign === 'credit'
              ? 'text-green-700 dark:text-green-400'
              : 'text-red-700 dark:text-red-400';
        const amountPrefix = e.voided ? '' : e.sign === 'credit' ? '−' : '+';
        // Sign convention shown to operator: + adds debt to customer, − reduces debt.

        return (
          <li key={e.id} className={`py-3 ${muted}`}>
            <div className="flex items-start gap-3">
              <button
                type="button"
                aria-label={isExpandable ? (open ? 'Collapse' : 'Expand') : ''}
                onClick={() => isExpandable && toggle(e.id)}
                className={`mt-0.5 shrink-0 ${isExpandable ? 'cursor-pointer' : 'cursor-default'} ${!isExpandable ? 'opacity-0' : ''}`}
                tabIndex={isExpandable ? 0 : -1}
              >
                {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </button>

              <div className="shrink-0 mt-0.5">{kindIcon[e.kind]}</div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className={`text-sm font-medium leading-snug ${e.voided ? 'line-through' : ''}`}>
                    {e.title}
                    {e.voided && e.voidReason && (
                      <span className="ml-2 not-italic no-underline">
                        <Badge variant="outline" className="text-[10px]">Voided — {e.voidReason}</Badge>
                      </span>
                    )}
                  </p>
                  <span className={`text-sm font-semibold tabular-nums ${amountClass}`}>
                    {amountPrefix}{fmtINR(e.amount)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                  <span>{fmtDateTime(e.date)}</span>
                  {e.service && (
                    <span className="inline-flex items-center gap-1">
                      {e.service === 'internet' ? <Wifi className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                      {e.service === 'internet' ? 'Internet' : 'Cable'}
                    </span>
                  )}
                  {e.subtitle && <span>· {e.subtitle}</span>}
                </div>

                {open && (
                  <div className="mt-2 ml-1 pl-3 border-l-2 border-muted space-y-1.5">
                    {e.allocations.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Applied to</p>
                        <ul className="space-y-0.5">
                          {e.allocations.map((a, i) => (
                            <li key={i} className="text-xs flex items-baseline justify-between gap-2">
                              <span>
                                {fmtINR(a.amount)} → {a.packName}
                                {a.deviceSerial && <span className="text-muted-foreground"> on {a.deviceSerial}</span>}
                                {a.targeted && <Badge variant="outline" className="ml-1.5 text-[10px]">selected by operator</Badge>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {e.unallocatedRemainder > 0 && (
                      <p className="text-xs text-blue-700 dark:text-blue-400">
                        {fmtINR(e.unallocatedRemainder)} held as advance credit — will apply to next {e.service === 'internet' ? 'Internet' : 'Cable'} recharge.
                      </p>
                    )}
                    {e.voided && (
                      <p className="text-xs text-muted-foreground">
                        Original transaction ID: <span className="font-mono">{e.sourceTransactionIds[0]}</span>
                        {e.sourceTransactionIds[1] && (
                          <> · Reversal ID: <span className="font-mono">{e.sourceTransactionIds[1]}</span></>
                        )}
                      </p>
                    )}
                    <div className="flex gap-1 pt-1">
                      {onOpenNotes && (
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onOpenNotes(e.sourceTransactionIds[0])}>
                          <FileText className="h-3.5 w-3.5 mr-1" /> Notes
                        </Button>
                      )}
                      {onVoid && canVoid?.(e) && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => onVoid(e.sourceTransactionIds[0])}>
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Void
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
