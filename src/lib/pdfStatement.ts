/**
 * Phase 5.5 — Account Statement PDF.
 *
 * Derives directly from the same `LedgerEntry[]` rendering model that
 * powers the on-screen passbook. There is NO separate PDF rendering
 * path: same business-event language, same credit-type labels, same
 * gross-component breakdown.
 *
 * Purpose: printable, shareable record an operator can hand to a
 * subscriber for dispute resolution or audit support.
 */
import jsPDF from 'jspdf';
import { type Subscriber } from './storage';
import type { LedgerEntry, GrossComponentLine } from './ledgerRendering';
import type { CompanyForPdf } from '@/contexts/SettingsContext';

const fmtINR = (n: number) => `Rs.${Math.round(n).toLocaleString('en-IN')}`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

interface StatementInput {
  subscriber: Subscriber;
  entries: LedgerEntry[];
  positionLabel: string;     // e.g. "Outstanding ₹98" — from financialPosition
  grossComponents: GrossComponentLine[];
  company: CompanyForPdf;
}

export const generateAccountStatementPDF = ({
  subscriber,
  entries,
  positionLabel,
  grossComponents,
  company,
}: StatementInput) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 14;
  let y = margin;

  // -- Header --
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(company.name, pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(company.address, pageW / 2, y, { align: 'center' });
  y += 4;
  doc.text(`Phone: ${company.phone}  |  Email: ${company.email}`, pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setDrawColor(180);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('ACCOUNT STATEMENT', pageW / 2, y, { align: 'center' });
  y += 7;

  // -- Subscriber block --
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Subscriber: ${subscriber.name}`, margin, y);
  doc.text(`Generated: ${fmtDate(new Date().toISOString())}`, pageW - margin, y, { align: 'right' });
  y += 5;
  doc.text(`ID: ${(subscriber as any).subscriber_id || subscriber.id}`, margin, y);
  doc.text(`Mobile: ${subscriber.mobile}`, pageW - margin, y, { align: 'right' });
  y += 5;
  if (subscriber.region) {
    doc.text(`Region: ${subscriber.region}`, margin, y);
    y += 5;
  }
  y += 2;

  // -- Overall position + gross components --
  doc.setDrawColor(220);
  doc.setFillColor(245, 245, 245);
  const posBoxH = 12 + Math.max(0, grossComponents.length) * 5;
  doc.rect(margin, y, pageW - 2 * margin, posBoxH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Overall position:', margin + 3, y + 6);
  doc.text(positionLabel, pageW - margin - 3, y + 6, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let gy = y + 11;
  if (grossComponents.length === 0) {
    doc.setTextColor(110);
    doc.text('Account is settled.', margin + 3, gy);
    doc.setTextColor(0);
  } else {
    for (const g of grossComponents) {
      doc.text(`• ${g.label.replace(/₹/g, 'Rs.')}`, margin + 3, gy);
      gy += 5;
    }
  }
  y += posBoxH + 6;

  // -- Ledger table header --
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Account Activity (newest first)', margin, y);
  y += 3;
  doc.setDrawColor(180);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  doc.setFontSize(8.5);
  doc.text('Date', margin, y);
  doc.text('Event', margin + 22, y);
  doc.text('Amount', pageW - margin, y, { align: 'right' });
  y += 2;
  doc.setDrawColor(220);
  doc.line(margin, y, pageW - margin, y);
  y += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);

  const ensureRoom = (needed: number) => {
    if (y + needed > 285) {
      doc.addPage();
      y = margin;
    }
  };

  for (const e of entries) {
    // Estimate row height (title + subtitle + allocation lines).
    const titleLines = doc.splitTextToSize(e.title, pageW - margin - margin - 22 - 25);
    const subtitleLines = e.subtitle ? doc.splitTextToSize(e.subtitle, pageW - margin - margin - 22 - 25) : [];
    const allocLines = e.allocations.length;
    const remainderLine = e.unallocatedRemainder > 0 ? 1 : 0;
    const rowH = 4 + titleLines.length * 4 + subtitleLines.length * 3.5 + allocLines * 3.5 + remainderLine * 3.5 + 2;
    ensureRoom(rowH);

    const dateStr = fmtDate(e.date);
    const sign = e.voided ? '' : e.sign === 'credit' ? '-' : '+';
    const amountStr = `${sign}${fmtINR(e.amount)}`;

    if (e.voided) doc.setTextColor(130);
    doc.text(dateStr, margin, y);
    let ty = y;
    for (const line of titleLines) {
      doc.text(line, margin + 22, ty);
      ty += 4;
    }
    if (e.voided && e.voidReason) {
      doc.setFont('helvetica', 'italic');
      doc.text(`(Voided — ${e.voidReason})`, margin + 22, ty);
      doc.setFont('helvetica', 'normal');
      ty += 3.5;
    }
    for (const line of subtitleLines) {
      doc.setTextColor(120);
      doc.text(line, margin + 22, ty);
      doc.setTextColor(e.voided ? 130 : 0);
      ty += 3.5;
    }
    for (const a of e.allocations) {
      doc.setTextColor(90);
      const where = a.deviceSerial ? ` on ${a.deviceSerial}` : '';
      doc.text(`  → ${fmtINR(a.amount)} applied to ${a.packName}${where}${a.targeted ? ' (selected)' : ''}`, margin + 22, ty);
      doc.setTextColor(e.voided ? 130 : 0);
      ty += 3.5;
    }
    if (e.unallocatedRemainder > 0) {
      doc.setTextColor(50, 100, 180);
      doc.text(`  → ${fmtINR(e.unallocatedRemainder)} held as advance credit`, margin + 22, ty);
      doc.setTextColor(e.voided ? 130 : 0);
      ty += 3.5;
    }
    doc.text(amountStr, pageW - margin, y, { align: 'right' });
    doc.setTextColor(0);

    y = Math.max(ty, y + 4) + 1;
    doc.setDrawColor(235);
    doc.line(margin, y, pageW - margin, y);
    y += 3;
  }

  // -- Footer --
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      'Computer-generated statement. For dispute resolution & audit support.',
      pageW / 2,
      292,
      { align: 'center' },
    );
    doc.text(`Page ${p} of ${pageCount}`, pageW - margin, 292, { align: 'right' });
  }

  const fname = `statement-${(subscriber as any).subscriber_id || subscriber.id}-${Date.now()}.pdf`;
  doc.save(fname);
};
