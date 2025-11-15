export interface SubscriptionEntry {
  id: string;
  packName: string;
  packPrice: number;
  startDate: string;
  endDate: string;
  duration: number; // in months
  status: 'active' | 'expired';
  subscribedAt: string;
}

export interface Subscriber {
  id: string;
  name: string;
  mobile: string;
  stbNumber: string;
  latitude?: number;
  longitude?: number;
  pack: string;
  region: string;
  balance: number;
  createdAt: string;
  billingCycle?: 'monthly' | 'quarterly' | 'semi-annually' | 'yearly';
  nextBillingDate?: string;
  autoChargeEnabled?: boolean;
  lastBillingDate?: string;
  subscriptions?: SubscriptionEntry[];
  currentSubscription?: SubscriptionEntry;
  housePicture?: string;
}

export interface Transaction {
  id: string;
  subscriberId: string;
  subscriberName: string;
  type: 'payment' | 'charge';
  amount: number;
  description: string;
  date: string;
}

export interface Pack {
  id: string;
  name: string;
  price: number;
}

export interface Region {
  id: string;
  name: string;
}

export interface Complaint {
  id: string;
  subscriberId: string;
  subscriberName: string;
  category: 'technical' | 'billing' | 'service' | 'other';
  priority: 'low' | 'medium' | 'high';
  description: string;
  status: 'pending' | 'in-progress' | 'resolved';
  resolutionNotes?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface CompanySettings {
  name: string;
  address: string;
  phone: string;
  email: string;
  logo?: string;
}

export interface BillingHistory {
  id: string;
  subscriberId: string;
  subscriberName: string;
  billingCycle: string;
  amount: number;
  dueDate: string;
  generatedAt: string;
  transactionId?: string;
  status: 'scheduled' | 'charged' | 'failed';
}

const SUBSCRIBERS_KEY = 'cable_subscribers';
const TRANSACTIONS_KEY = 'cable_transactions';
const PACKS_KEY = 'cable_packs';
const REGIONS_KEY = 'cable_regions';
const COUNTER_KEY = 'cable_subscriber_counter';
const COMPLAINTS_KEY = 'cable_complaints';
const COMPANY_SETTINGS_KEY = 'cable_company_settings';
const BILLING_HISTORY_KEY = 'cable_billing_history';

// Initialize default packs if none exist
const initializeDefaultPacks = () => {
  const existing = getPacks();
  if (existing.length === 0) {
    const defaultPacks: Pack[] = [
      { id: 'pack-1', name: 'Basic SD', price: 150 },
      { id: 'pack-2', name: 'Premium SD', price: 250 },
      { id: 'pack-3', name: 'HD Basic', price: 350 },
      { id: 'pack-4', name: 'HD Premium', price: 500 },
      { id: 'pack-5', name: 'Sports Pack', price: 300 },
      { id: 'pack-6', name: 'Entertainment Pack', price: 200 },
      { id: 'pack-7', name: 'Family Pack', price: 400 },
    ];
    savePacks(defaultPacks);
  }
};

// Initialize default regions if none exist
const initializeDefaultRegions = () => {
  const existing = getRegions();
  if (existing.length === 0) {
    const defaultRegions: Region[] = [
      { id: 'region-1', name: 'North Zone' },
      { id: 'region-2', name: 'South Zone' },
      { id: 'region-3', name: 'East Zone' },
      { id: 'region-4', name: 'West Zone' },
    ];
    saveRegions(defaultRegions);
  }
};

// Generate shorter subscriber ID
const generateSubscriberId = (): string => {
  const counter = parseInt(localStorage.getItem(COUNTER_KEY) || '0') + 1;
  localStorage.setItem(COUNTER_KEY, counter.toString());
  return `SUB-${counter.toString().padStart(6, '0')}`;
};

// Format date in IST
const formatISTDate = (date: Date = new Date()): string => {
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
};

// Subscribers
export const getSubscribers = (): Subscriber[] => {
  const data = localStorage.getItem(SUBSCRIBERS_KEY);
  return data ? JSON.parse(data) : [];
};

export const saveSubscribers = (subscribers: Subscriber[]) => {
  localStorage.setItem(SUBSCRIBERS_KEY, JSON.stringify(subscribers));
};

export const addSubscriber = (subscriber: Omit<Subscriber, 'id' | 'createdAt'>) => {
  initializeDefaultPacks();
  initializeDefaultRegions();
  const subscribers = getSubscribers();
  const newSubscriber: Subscriber = {
    ...subscriber,
    id: generateSubscriberId(),
    createdAt: formatISTDate(),
  };
  subscribers.push(newSubscriber);
  saveSubscribers(subscribers);
  return newSubscriber;
};

export const updateSubscriber = (id: string, updates: Partial<Subscriber>) => {
  const subscribers = getSubscribers();
  const index = subscribers.findIndex(s => s.id === id);
  if (index !== -1) {
    subscribers[index] = { ...subscribers[index], ...updates };
    saveSubscribers(subscribers);
    return subscribers[index];
  }
  return null;
};

export const deleteSubscriber = (id: string) => {
  const subscribers = getSubscribers().filter(s => s.id !== id);
  saveSubscribers(subscribers);
  // Also delete related transactions
  const transactions = getTransactions().filter(t => t.subscriberId !== id);
  saveTransactions(transactions);
};

// Transactions
export const getTransactions = (): Transaction[] => {
  const data = localStorage.getItem(TRANSACTIONS_KEY);
  return data ? JSON.parse(data) : [];
};

export const saveTransactions = (transactions: Transaction[]) => {
  localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(transactions));
};

export const addTransaction = (transaction: Omit<Transaction, 'id' | 'date'>) => {
  const transactions = getTransactions();
  const newTransaction: Transaction = {
    ...transaction,
    id: crypto.randomUUID(),
    date: formatISTDate(),
  };
  transactions.push(newTransaction);
  saveTransactions(transactions);

  // Update subscriber balance
  const subscribers = getSubscribers();
  const subscriber = subscribers.find(s => s.id === transaction.subscriberId);
  if (subscriber) {
    const amount = transaction.type === 'payment' ? transaction.amount : -transaction.amount;
    updateSubscriber(subscriber.id, { balance: subscriber.balance + amount });
  }

  return newTransaction;
};

export const getSubscriberTransactions = (subscriberId: string): Transaction[] => {
  return getTransactions().filter(t => t.subscriberId === subscriberId);
};

export const updateTransaction = (transactionId: string, updates: Partial<Transaction>) => {
  const transactions = getTransactions();
  const index = transactions.findIndex(t => t.id === transactionId);
  if (index !== -1) {
    const oldTransaction = transactions[index];
    const newTransaction = { ...oldTransaction, ...updates };
    
    // Reverse old transaction's effect on balance
    const subscribers = getSubscribers();
    const subscriber = subscribers.find(s => s.id === oldTransaction.subscriberId);
    if (subscriber) {
      const oldAmount = oldTransaction.type === 'payment' ? -oldTransaction.amount : oldTransaction.amount;
      const newAmount = newTransaction.type === 'payment' ? newTransaction.amount : -newTransaction.amount;
      updateSubscriber(subscriber.id, { balance: subscriber.balance + oldAmount + newAmount });
    }
    
    transactions[index] = newTransaction;
    saveTransactions(transactions);
    return newTransaction;
  }
  return null;
};

// Packs
export const getPacks = (): Pack[] => {
  const data = localStorage.getItem(PACKS_KEY);
  return data ? JSON.parse(data) : [];
};

export const savePacks = (packs: Pack[]) => {
  localStorage.setItem(PACKS_KEY, JSON.stringify(packs));
};

export const addPack = (pack: Omit<Pack, 'id'>) => {
  const packs = getPacks();
  const newPack: Pack = {
    ...pack,
    id: `pack-${Date.now()}`,
  };
  packs.push(newPack);
  savePacks(packs);
  return newPack;
};

export const updatePack = (id: string, updates: Partial<Pack>) => {
  const packs = getPacks();
  const index = packs.findIndex(p => p.id === id);
  if (index !== -1) {
    packs[index] = { ...packs[index], ...updates };
    savePacks(packs);
    return packs[index];
  }
  return null;
};

export const deletePack = (id: string) => {
  const packs = getPacks().filter(p => p.id !== id);
  savePacks(packs);
};

// Regions
export const getRegions = (): Region[] => {
  const data = localStorage.getItem(REGIONS_KEY);
  return data ? JSON.parse(data) : [];
};

export const saveRegions = (regions: Region[]) => {
  localStorage.setItem(REGIONS_KEY, JSON.stringify(regions));
};

export const addRegion = (region: Omit<Region, 'id'>) => {
  const regions = getRegions();
  const newRegion: Region = {
    ...region,
    id: `region-${Date.now()}`,
  };
  regions.push(newRegion);
  saveRegions(regions);
  return newRegion;
};

export const deleteRegion = (id: string) => {
  const regions = getRegions().filter(r => r.id !== id);
  saveRegions(regions);
};

// Complaints
export const getComplaints = (): Complaint[] => {
  const data = localStorage.getItem(COMPLAINTS_KEY);
  return data ? JSON.parse(data) : [];
};

export const saveComplaints = (complaints: Complaint[]) => {
  localStorage.setItem(COMPLAINTS_KEY, JSON.stringify(complaints));
};

export const addComplaint = (complaint: Omit<Complaint, 'id' | 'createdAt'>) => {
  const complaints = getComplaints();
  const newComplaint: Complaint = {
    ...complaint,
    id: `complaint-${Date.now()}`,
    createdAt: formatISTDate(),
  };
  complaints.push(newComplaint);
  saveComplaints(complaints);
  return newComplaint;
};

export const updateComplaint = (id: string, updates: Partial<Complaint>) => {
  const complaints = getComplaints();
  const index = complaints.findIndex(c => c.id === id);
  if (index !== -1) {
    complaints[index] = { ...complaints[index], ...updates };
    if (updates.status === 'resolved' && !complaints[index].resolvedAt) {
      complaints[index].resolvedAt = formatISTDate();
    }
    saveComplaints(complaints);
    return complaints[index];
  }
  return null;
};

export const deleteComplaint = (id: string) => {
  const complaints = getComplaints().filter(c => c.id !== id);
  saveComplaints(complaints);
};

// Company Settings
export const getCompanySettings = (): CompanySettings => {
  const data = localStorage.getItem(COMPANY_SETTINGS_KEY);
  return data ? JSON.parse(data) : {
    name: 'Cable TV Company',
    address: 'Your Address Here',
    phone: '+91 XXXXXXXXXX',
    email: 'info@cabletv.com',
  };
};

export const saveCompanySettings = (settings: CompanySettings) => {
  localStorage.setItem(COMPANY_SETTINGS_KEY, JSON.stringify(settings));
};

// Backup & Restore
export const createBackup = () => {
  const backup = {
    version: '1.2',
    timestamp: formatISTDate(),
    data: {
      subscribers: getSubscribers(),
      transactions: getTransactions(),
      packs: getPacks(),
      regions: getRegions(),
      complaints: getComplaints(),
      companySettings: getCompanySettings(),
      billingHistory: getBillingHistory(),
      counter: localStorage.getItem(COUNTER_KEY),
    },
  };
  
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cable-backup-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const restoreBackup = (file: File): Promise<void> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const backup = JSON.parse(e.target?.result as string);
        
        // Validate backup format
        if (!backup.data || !backup.version) {
          throw new Error('Invalid backup file format');
        }
        
        // Create automatic backup before restore
        createBackup();
        
        // Restore data
        if (backup.data.subscribers) saveSubscribers(backup.data.subscribers);
        if (backup.data.transactions) saveTransactions(backup.data.transactions);
        if (backup.data.packs) savePacks(backup.data.packs);
        if (backup.data.regions) saveRegions(backup.data.regions);
        if (backup.data.complaints) saveComplaints(backup.data.complaints);
        if (backup.data.companySettings) saveCompanySettings(backup.data.companySettings);
        if (backup.data.billingHistory) saveBillingHistory(backup.data.billingHistory);
        if (backup.data.counter) localStorage.setItem(COUNTER_KEY, backup.data.counter);
        
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read backup file'));
    reader.readAsText(file);
  });
};

// Billing History
export const getBillingHistory = (): BillingHistory[] => {
  const data = localStorage.getItem(BILLING_HISTORY_KEY);
  return data ? JSON.parse(data) : [];
};

export const saveBillingHistory = (history: BillingHistory[]) => {
  localStorage.setItem(BILLING_HISTORY_KEY, JSON.stringify(history));
};

export const addBillingHistory = (entry: Omit<BillingHistory, 'id' | 'generatedAt'>) => {
  const history = getBillingHistory();
  const newEntry: BillingHistory = {
    ...entry,
    id: `billing-${Date.now()}`,
    generatedAt: formatISTDate(),
  };
  history.push(newEntry);
  saveBillingHistory(history);
  return newEntry;
};

// Calculate next billing date based on cycle
export const calculateNextBillingDate = (
  currentDate: string,
  cycle: 'monthly' | 'quarterly' | 'semi-annually' | 'yearly'
): string => {
  const date = new Date(currentDate);
  
  switch (cycle) {
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'quarterly':
      date.setMonth(date.getMonth() + 3);
      break;
    case 'semi-annually':
      date.setMonth(date.getMonth() + 6);
      break;
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1);
      break;
  }
  
  return date.toISOString().split('T')[0];
};

// Get pack price by name
export const getPackPrice = (packName: string): number => {
  const pack = getPacks().find(p => p.name === packName);
  return pack?.price || 0;
};

// Subscription management
export const addSubscriptionToSubscriber = (
  subscriberId: string,
  packName: string,
  duration: number
): void => {
  const subscribers = getSubscribers();
  const subscriber = subscribers.find(s => s.id === subscriberId);
  
  if (!subscriber) return;
  
  const packPrice = getPackPrice(packName);
  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + duration);
  
  const newSubscription: SubscriptionEntry = {
    id: crypto.randomUUID(),
    packName,
    packPrice,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    duration,
    status: 'active',
    subscribedAt: startDate.toISOString()
  };
  
  // Mark previous subscriptions as expired
  if (subscriber.subscriptions) {
    subscriber.subscriptions = subscriber.subscriptions.map(sub => ({
      ...sub,
      status: 'expired' as const
    }));
  } else {
    subscriber.subscriptions = [];
  }
  
  subscriber.subscriptions.push(newSubscription);
  subscriber.currentSubscription = newSubscription;
  subscriber.pack = packName;
  
  saveSubscribers(subscribers);
};
