import jsPDF from 'jspdf';
import { Transaction, Subscriber, getCompanySettings } from './storage';

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
