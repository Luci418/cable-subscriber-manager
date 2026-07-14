import { Download, Plus, Tv, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Subscriber, Transaction } from '@/lib/storage';
import { TransactionLedger } from '@/components/TransactionLedger';
import {
  buildGrossComponents,
  buildLedgerEntries,
  type LedgerAllocation,
  type LedgerRawTransaction,
  type LedgerSubscription,
} from '@/lib/ledgerRendering';
import { computeOverallPosition } from '@/lib/financialPosition';
import { generateAccountStatementPDF } from '@/lib/pdfStatement';

interface LedgerTabProps {
  subscriber: Subscriber;
  transactions: Transaction[];
  visibleTransactions: Transaction[];
  subsById: Record<string, LedgerSubscription>;
  allocByTx: Record<string, LedgerAllocation[]>;
  outstandingBySub: Record<string, number>;
  companyForPdf: { name: string; address: string; phone: string; email: string; receipt_footer: string };
  perms: { canVoidTransaction: boolean };
  showCableTab: boolean;
  showInternetTab: boolean;
  txFilter: 'all' | 'cable' | 'internet';
  setTxFilter: (f: 'all' | 'cable' | 'internet') => void;
  onAddTransaction: () => void;
  onOpenNotes: (tx: Transaction) => void;
  onVoid: (tx: Transaction) => void;
}

const toRaw = (t: any): LedgerRawTransaction => ({
  id: t.id,
  date: t.date,
  type: t.type,
  amount: Number(t.amount) || 0,
  description: t.description ?? null,
  service_type: (t.service_type as any) ?? null,
  source: t.source ?? 'manual_charge',
  status: t.status ?? 'posted',
  payment_method: t.payment_method ?? null,
  subscription_id: t.subscription_id ?? null,
  reverses_transaction_id: t.reverses_transaction_id ?? null,
  void_reason: t.void_reason ?? null,
  void_reason_code: t.void_reason_code ?? null,
});

/** LEDGER TAB — passbook view + download statement + add transaction. */
export function LedgerTab({
  subscriber,
  transactions,
  visibleTransactions,
  subsById,
  allocByTx,
  outstandingBySub,
  companyForPdf,
  perms,
  showCableTab,
  showInternetTab,
  txFilter,
  setTxFilter,
  onAddTransaction,
  onOpenNotes,
  onVoid,
}: LedgerTabProps) {
  const entries = buildLedgerEntries(visibleTransactions.map(toRaw), subsById, allocByTx);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap justify-between items-center gap-3">
          <CardTitle>Ledger</CardTitle>
          <div className="flex items-center gap-2">
            {(showCableTab || showInternetTab) && (
              <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
                <Button
                  type="button"
                  variant={txFilter === 'all' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 px-3"
                  onClick={() => setTxFilter('all')}
                >
                  All
                </Button>
                {showCableTab && (
                  <Button
                    type="button"
                    variant={txFilter === 'cable' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-3"
                    onClick={() => setTxFilter('cable')}
                  >
                    <Tv className="h-3.5 w-3.5 mr-1" />Cable
                  </Button>
                )}
                {showInternetTab && (
                  <Button
                    type="button"
                    variant={txFilter === 'internet' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-3"
                    onClick={() => setTxFilter('internet')}
                  >
                    <Wifi className="h-3.5 w-3.5 mr-1" />Internet
                  </Button>
                )}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const allEntries = buildLedgerEntries(transactions.map(toRaw), subsById, allocByTx);
                const position = computeOverallPosition(subscriber);
                const gross = buildGrossComponents(subscriber as any, outstandingBySub, subsById);
                generateAccountStatementPDF({
                  subscriber,
                  entries: allEntries,
                  positionLabel: position.label,
                  grossComponents: gross,
                  company: companyForPdf,
                });
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Download Statement
            </Button>
            <Button onClick={onAddTransaction} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Transaction
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <TransactionLedger
          entries={entries}
          onOpenNotes={(txId) => {
            const tx = transactions.find((t) => t.id === txId);
            if (tx) onOpenNotes(tx);
          }}
          onVoid={(txId) => {
            const tx = transactions.find((t) => t.id === txId);
            if (tx) onVoid(tx);
          }}
          canVoid={(e) =>
            perms.canVoidTransaction &&
            !e.voided &&
            e.kind !== 'subscription_activated' &&
            e.kind !== 'subscription_renewed' &&
            e.kind !== 'subscription_refund'
          }
        />
      </CardContent>
    </Card>
  );
}
