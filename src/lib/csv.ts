import { Subscriber, Transaction, saveSubscribers, saveTransactions, getSubscribers } from './storage';

export const exportToCSV = (subscribers: Subscriber[], transactions: Transaction[]) => {
  // Export subscribers
  const subscriberHeaders = ['ID', 'Name', 'Mobile', 'STB Number', 'Latitude', 'Longitude', 'Pack', 'Region', 'Balance', 'Created At'];
  const subscriberRows = subscribers.map(s => [
    s.id,
    s.name,
    s.mobile,
    s.stbNumber,
    s.latitude || '',
    s.longitude || '',
    s.pack,
    s.region,
    s.balance,
    s.createdAt,
  ]);

  const subscriberCSV = [subscriberHeaders, ...subscriberRows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');

  // Export transactions
  const transactionHeaders = ['ID', 'Subscriber ID', 'Type', 'Amount', 'Description', 'Date'];
  const transactionRows = transactions.map(t => [
    t.id,
    t.subscriberId,
    t.type,
    t.amount,
    t.description,
    t.date,
  ]);

  const transactionCSV = [transactionHeaders, ...transactionRows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');

  // Download both files
  downloadCSV(subscriberCSV, 'subscribers.csv');
  downloadCSV(transactionCSV, 'transactions.csv');
};

const downloadCSV = (content: string, filename: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Robust CSV parser that handles Excel formatting
const parseCSVLine = (line: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add last field
  values.push(current.trim());
  
  return values;
};

export const importFromCSV = async (subscriberFile: File, transactionFile: File) => {
  const subscriberText = await subscriberFile.text();
  const transactionText = await transactionFile.text();

  // Parse subscribers
  const subscriberLines = subscriberText.split(/\r?\n/).slice(1); // Skip header, handle both line endings
  const subscribers: Subscriber[] = subscriberLines
    .filter(line => line.trim() && !line.trim().startsWith(',,,')) // Skip empty or invalid lines
    .map(line => {
      const values = parseCSVLine(line);
      // Clean all string values to remove invisible characters
      const clean = (str: string) => str?.replace(/[\r\n\t]/g, '').trim() || '';
      
      // Convert scientific notation to normal number string (e.g., 2.28887E+11 -> 228887000420)
      const parseNumber = (str: string): string => {
        const cleaned = clean(str);
        if (!cleaned) return '';
        // Check if it's in scientific notation
        if (cleaned.includes('E') || cleaned.includes('e')) {
          const num = parseFloat(cleaned);
          return Number.isNaN(num) ? cleaned : num.toFixed(0);
        }
        return cleaned;
      };
      
      return {
        id: clean(values[0]) || `SUB-${Date.now()}`,
        name: clean(values[1]) || 'Unknown',
        mobile: parseNumber(values[2]) || '',
        stbNumber: parseNumber(values[3]) || '',
        latitude: values[4] && values[4] !== '' ? parseFloat(values[4]) : undefined,
        longitude: values[5] && values[5] !== '' ? parseFloat(values[5]) : undefined,
        pack: clean(values[6]) || 'Basic SD',
        region: clean(values[7]) || 'North Zone',
        balance: values[8] && values[8] !== '' ? parseFloat(values[8]) : 0,
        createdAt: clean(values[9]) || new Date().toISOString(),
      };
    });

  // Parse transactions
  const transactionLines = transactionText.split(/\r?\n/).slice(1); // Skip header
  const transactions: Transaction[] = transactionLines
    .filter(line => line.trim() && !line.trim().startsWith(',,,'))
    .map(line => {
      const values = parseCSVLine(line);
      const clean = (str: string) => str?.replace(/[\r\n\t]/g, '').trim() || '';
      const allSubscribers = getSubscribers();
      const subscriberId = clean(values[1]) || '';
      const subscriber = allSubscribers.find(s => s.id === subscriberId);
      
      return {
        id: clean(values[0]) || crypto.randomUUID(),
        subscriberId,
        subscriberName: subscriber?.name || 'Unknown',
        type: (clean(values[2])?.toLowerCase() === 'payment' ? 'payment' : 'charge') as 'payment' | 'charge',
        amount: values[3] && values[3] !== '' ? parseFloat(values[3]) : 0,
        description: clean(values[4]) || '',
        date: clean(values[5]) || new Date().toISOString(),
      };
    });

  saveSubscribers(subscribers);
  saveTransactions(transactions);

  return { subscribers: subscribers.length, transactions: transactions.length };
};
