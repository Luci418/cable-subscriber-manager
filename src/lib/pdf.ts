import jsPDF from 'jspdf';
import { Transaction, Subscriber, getCompanySettings } from './storage';

// Types for subscription invoice
interface SubscriptionInvoiceData {
  subscriberName: string;
  subscriberId: string;
  mobile: string;
  stbNumber?: string;
  region?: string;
  packName: string;
  packPrice: number;
  duration: number;
  startDate: string;
  endDate: string;
  totalAmount: number;
  balance: number;
}

export const generateInvoicePDF = (
  transaction: Transaction,
  subscriber: Subscriber
) => {
  const doc = new jsPDF();
  const companySettings = getCompanySettings();
  
  // Set font
  doc.setFont('helvetica');
  
  // Header - Company Info
  doc.setFontSize(20);
  doc.setTextColor(0, 0, 0);
  doc.text(companySettings.name, 105, 20, { align: 'center' });
  
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(companySettings.address, 105, 28, { align: 'center' });
  doc.text(`Phone: ${companySettings.phone} | Email: ${companySettings.email}`, 105, 34, { align: 'center' });
  
  // Line separator
  doc.setDrawColor(200, 200, 200);
  doc.line(20, 40, 190, 40);
  
  // Invoice Title
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text(transaction.type === 'payment' ? 'PAYMENT RECEIPT' : 'CHARGE INVOICE', 105, 50, { align: 'center' });
  
  // Transaction Details Box
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  
  // Left column
  doc.text('Transaction ID:', 20, 65);
  doc.text('Date:', 20, 72);
  doc.text('Type:', 20, 79);
  
  doc.setFont('helvetica', 'bold');
  doc.text(transaction.id, 60, 65);
  doc.text(new Date(transaction.date).toLocaleDateString('en-IN'), 60, 72);
  doc.text(transaction.type.toUpperCase(), 60, 79);
  
  // Subscriber Details
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text('SUBSCRIBER DETAILS', 20, 95);
  doc.setDrawColor(0, 0, 0);
  doc.line(20, 97, 80, 97);
  
  doc.setFontSize(10);
  doc.text('Subscriber ID:', 20, 107);
  doc.text('Name:', 20, 114);
  doc.text('Mobile:', 20, 121);
  doc.text('STB Number:', 20, 128);
  doc.text('Package:', 20, 135);
  doc.text('Region:', 20, 142);
  
  doc.setFont('helvetica', 'bold');
  doc.text(subscriber.id, 60, 107);
  doc.text(subscriber.name, 60, 114);
  doc.text(subscriber.mobile, 60, 121);
  doc.text(subscriber.stbNumber, 60, 128);
  doc.text(subscriber.pack, 60, 135);
  doc.text(subscriber.region, 60, 142);
  
  // Transaction Amount Box
  doc.setFillColor(240, 240, 240);
  doc.rect(20, 155, 170, 30, 'F');
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Description:', 25, 165);
  doc.setFont('helvetica', 'bold');
  doc.text(transaction.description, 25, 172);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text('Amount:', 25, 180);
  
  doc.setFontSize(18);
  doc.setTextColor(transaction.type === 'payment' ? 0 : 220, transaction.type === 'payment' ? 150 : 0, 0);
  doc.text(`₹ ${transaction.amount.toLocaleString('en-IN')}`, 155, 180, { align: 'right' });
  
  // Current Balance
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(11);
  doc.text('Current Balance:', 25, 200);
  doc.setFont('helvetica', 'bold');
  const balanceColor = subscriber.balance >= 0 ? [0, 150, 0] : [220, 0, 0];
  doc.setTextColor(balanceColor[0], balanceColor[1], balanceColor[2]);
  doc.text(`₹ ${subscriber.balance.toLocaleString('en-IN')}`, 155, 200, { align: 'right' });
  
  // Footer
  doc.setTextColor(100, 100, 100);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.text('This is a computer-generated invoice and does not require a signature.', 105, 270, { align: 'center' });
  doc.text('Thank you for your business!', 105, 277, { align: 'center' });
  
  // Save PDF
  const fileName = `${transaction.type}-${subscriber.id}-${transaction.id}.pdf`;
  doc.save(fileName);
};

// Thermal Receipt - 58mm width (approx 48mm printable = 136 points)
export const generateThermalReceipt = (data: SubscriptionInvoiceData) => {
  const companySettings = getCompanySettings();
  // 58mm thermal paper width
  const doc = new jsPDF({
    unit: 'mm',
    format: [58, 120], // 58mm width, variable height
  });
  
  const pageWidth = 58;
  const margin = 2;
  const contentWidth = pageWidth - (margin * 2);
  let y = 5;
  
  // Company Name - centered
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(companySettings.name, pageWidth / 2, y, { align: 'center' });
  y += 4;
  
  // Phone
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text(companySettings.phone, pageWidth / 2, y, { align: 'center' });
  y += 5;
  
  // Dashed line
  doc.setLineDashPattern([1, 1], 0);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;
  
  // SUBSCRIPTION RECEIPT
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('SUBSCRIPTION RECEIPT', pageWidth / 2, y, { align: 'center' });
  y += 5;
  
  // Date
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, margin, y);
  y += 4;
  
  // Dashed line
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;
  
  // Customer Details
  doc.setFont('helvetica', 'bold');
  doc.text('Customer:', margin, y);
  y += 3;
  doc.setFont('helvetica', 'normal');
  doc.text(data.subscriberName, margin, y);
  y += 3;
  doc.text(`ID: ${data.subscriberId}`, margin, y);
  y += 3;
  doc.text(`Ph: ${data.mobile}`, margin, y);
  y += 3;
  if (data.stbNumber) {
    doc.text(`STB: ${data.stbNumber}`, margin, y);
    y += 3;
  }
  y += 2;
  
  // Dashed line
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;
  
  // Package Details
  doc.setFont('helvetica', 'bold');
  doc.text('Package:', margin, y);
  y += 3;
  doc.setFont('helvetica', 'normal');
  doc.text(data.packName, margin, y);
  y += 3;
  doc.text(`Duration: ${data.duration} month(s)`, margin, y);
  y += 3;
  doc.text(`From: ${new Date(data.startDate).toLocaleDateString('en-IN')}`, margin, y);
  y += 3;
  doc.text(`To: ${new Date(data.endDate).toLocaleDateString('en-IN')}`, margin, y);
  y += 4;
  
  // Dashed line
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;
  
  // Amount
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL:', margin, y);
  doc.text(`Rs.${data.totalAmount.toFixed(0)}`, pageWidth - margin, y, { align: 'right' });
  y += 4;
  
  // Balance
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  const balanceText = data.balance >= 0 ? `Credit: Rs.${data.balance.toFixed(0)}` : `Due: Rs.${Math.abs(data.balance).toFixed(0)}`;
  doc.text(balanceText, margin, y);
  y += 5;
  
  // Dashed line
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;
  
  // Thank you
  doc.setFontSize(7);
  doc.text('Thank you!', pageWidth / 2, y, { align: 'center' });
  y += 3;
  doc.text('Keep this receipt safe', pageWidth / 2, y, { align: 'center' });
  
  // Save
  const fileName = `receipt-${data.subscriberId}-${Date.now()}.pdf`;
  doc.save(fileName);
};

// Full A4 Subscription Invoice
export const generateSubscriptionInvoice = (data: SubscriptionInvoiceData) => {
  const doc = new jsPDF();
  const companySettings = getCompanySettings();
  
  doc.setFont('helvetica');
  
  // Header
  doc.setFontSize(22);
  doc.setTextColor(0, 0, 0);
  doc.text(companySettings.name, 105, 20, { align: 'center' });
  
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(companySettings.address, 105, 28, { align: 'center' });
  doc.text(`Phone: ${companySettings.phone} | Email: ${companySettings.email}`, 105, 34, { align: 'center' });
  
  // Line
  doc.setDrawColor(200, 200, 200);
  doc.line(20, 40, 190, 40);
  
  // Title
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 0);
  doc.text('SUBSCRIPTION INVOICE', 105, 52, { align: 'center' });
  
  // Invoice details
  doc.setFontSize(10);
  doc.text(`Invoice Date: ${new Date().toLocaleDateString('en-IN')}`, 20, 65);
  doc.text(`Invoice #: SUB-${Date.now().toString().slice(-8)}`, 150, 65);
  
  // Customer Box
  doc.setFillColor(245, 245, 245);
  doc.rect(20, 75, 170, 40, 'F');
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('BILL TO:', 25, 85);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(data.subscriberName, 25, 93);
  doc.text(`ID: ${data.subscriberId}`, 25, 100);
  doc.text(`Mobile: ${data.mobile}`, 25, 107);
  
  if (data.stbNumber) {
    doc.text(`STB: ${data.stbNumber}`, 120, 93);
  }
  if (data.region) {
    doc.text(`Region: ${data.region}`, 120, 100);
  }
  
  // Subscription Details Table
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('SUBSCRIPTION DETAILS', 20, 130);
  doc.line(20, 133, 190, 133);
  
  // Table Header
  doc.setFillColor(230, 230, 230);
  doc.rect(20, 137, 170, 10, 'F');
  doc.setFontSize(10);
  doc.text('Description', 25, 143);
  doc.text('Duration', 100, 143);
  doc.text('Amount', 165, 143, { align: 'right' });
  
  // Table Row
  doc.setFont('helvetica', 'normal');
  doc.text(data.packName, 25, 155);
  doc.text(`${data.duration} month(s)`, 100, 155);
  doc.text(`Rs.${data.packPrice.toFixed(2)}/mo`, 165, 155, { align: 'right' });
  
  // Validity
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`Valid: ${new Date(data.startDate).toLocaleDateString('en-IN')} - ${new Date(data.endDate).toLocaleDateString('en-IN')}`, 25, 162);
  
  // Total Box
  doc.setTextColor(0, 0, 0);
  doc.line(20, 175, 190, 175);
  
  doc.setFillColor(240, 240, 240);
  doc.rect(120, 180, 70, 25, 'F');
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Subtotal:', 125, 188);
  doc.text(`Rs.${data.totalAmount.toFixed(2)}`, 185, 188, { align: 'right' });
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('TOTAL:', 125, 200);
  doc.text(`Rs.${data.totalAmount.toFixed(2)}`, 185, 200, { align: 'right' });
  
  // Balance
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const balanceLabel = data.balance >= 0 ? 'Credit Balance:' : 'Amount Due:';
  const balanceColor = data.balance >= 0 ? [0, 128, 0] : [200, 0, 0];
  doc.setTextColor(balanceColor[0], balanceColor[1], balanceColor[2]);
  doc.text(balanceLabel, 20, 220);
  doc.text(`Rs.${Math.abs(data.balance).toFixed(2)}`, 80, 220);
  
  // Footer
  doc.setTextColor(100, 100, 100);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.text('This is a computer-generated invoice.', 105, 260, { align: 'center' });
  doc.text('Thank you for your subscription!', 105, 267, { align: 'center' });
  
  // Save
  const fileName = `subscription-invoice-${data.subscriberId}-${Date.now()}.pdf`;
  doc.save(fileName);
};
