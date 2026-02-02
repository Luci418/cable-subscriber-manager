# 📺 Cable TV Management System - Developer Guide

> A comprehensive, production-ready web application for managing cable TV subscribers, subscriptions, billing, and complaints. Built with modern React patterns and best practices.

---

## 📋 Table of Contents

1. [Project Overview](#-project-overview)
2. [Architecture & Design Decisions](#-architecture--design-decisions)
3. [Technology Stack](#-technology-stack)
4. [Entity Relationship Diagram](#-entity-relationship-diagram)
5. [Database Schema](#-database-schema)
6. [Application Structure](#-application-structure)
7. [Core Modules & Components](#-core-modules--components)
8. [Custom Hooks](#-custom-hooks)
9. [Utility Functions](#-utility-functions)
10. [State Management](#-state-management)
11. [Authentication Flow](#-authentication-flow)
12. [Business Logic](#-business-logic)
13. [Security Implementation](#-security-implementation)
14. [API Integration](#-api-integration)
15. [PDF Generation](#-pdf-generation)
16. [Best Practices](#-best-practices)
17. [Common Patterns](#-common-patterns)
18. [Troubleshooting](#-troubleshooting)

---

## 🎯 Project Overview

### What is this application?

This is a **Cable TV Subscriber Management System** designed for local cable operators (LCOs) to:

- **Manage Subscribers**: Add, edit, delete, and track customer information
- **Handle Subscriptions**: Assign packages, manage renewals, cancellations with refunds
- **Track Billing**: Monitor payments, charges, outstanding balances
- **Generate Documents**: Create thermal receipts and A4 invoices
- **Analyze Business**: View analytics, revenue reports, expiring subscriptions
- **Manage Inventory**: Track Set-Top Box (STB) assignments

### Key Features

| Feature | Description |
|---------|-------------|
| Multi-user Support | Each user has isolated data with Row Level Security |
| Real-time Balance | Automatic balance calculation on transactions |
| Subscription Lifecycle | Auto-cleanup of expired subscriptions |
| PDF Generation | Thermal receipts (58mm) and A4 invoices |
| Geolocation | Capture subscriber location for field service |
| Import/Export | CSV import with data validation |

---

## 🏗 Architecture & Design Decisions

### Why These Choices?

#### 1. **React with TypeScript**
```
Decision: Use TypeScript for type safety
Rationale: 
- Catches errors at compile-time, not runtime
- Better IDE support with autocomplete
- Self-documenting code through type definitions
- Essential for maintaining a large codebase
```

#### 2. **Supabase as Backend**
```
Decision: Use Supabase (PostgreSQL + Auth + Realtime)
Rationale:
- No need to build a custom backend
- Built-in authentication with RLS
- Real-time subscriptions available
- Auto-generated TypeScript types
- Scales automatically
```

#### 3. **Component-Based Architecture**
```
Decision: Small, focused components
Rationale:
- Single Responsibility Principle
- Easier testing and maintenance
- Reusability across the application
- Faster development with composition
```

#### 4. **Custom Hooks for Logic**
```
Decision: Extract business logic into hooks
Rationale:
- Separation of concerns (UI vs Logic)
- Reusable across components
- Easier unit testing
- Cleaner component code
```

#### 5. **Soft Delete for Packs/Regions**
```
Decision: Use is_active flag instead of hard delete
Rationale:
- Preserve historical data integrity
- Allow pack phase-out without breaking existing subscriptions
- Enable reactivation if needed
```

---

## 🛠 Technology Stack

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND LAYER                          │
├─────────────────────────────────────────────────────────────┤
│  React 18        │ UI Library with Concurrent Features     │
│  TypeScript      │ Static Type Checking                    │
│  Vite            │ Fast Build Tool & Dev Server            │
│  Tailwind CSS    │ Utility-First CSS Framework             │
│  shadcn/ui       │ Accessible Component Library            │
│  React Router    │ Client-Side Routing                     │
│  TanStack Query  │ Server State Management                 │
│  Sonner          │ Toast Notifications                     │
│  Recharts        │ Data Visualization                      │
│  jsPDF           │ PDF Document Generation                 │
├─────────────────────────────────────────────────────────────┤
│                     BACKEND LAYER                           │
├─────────────────────────────────────────────────────────────┤
│  Supabase        │ Backend-as-a-Service                    │
│  PostgreSQL      │ Relational Database                     │
│  Row Level Sec.  │ Data Access Control                     │
│  Edge Functions  │ Serverless Functions (Deno)             │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ENTITY RELATIONSHIP DIAGRAM                            │
└─────────────────────────────────────────────────────────────────────────────────┘

                                   ┌──────────────┐
                                   │   PROFILES   │
                                   │──────────────│
                                   │ id (PK)      │◄─────────────────────┐
                                   │ email        │                      │
                                   │ full_name    │                      │
                                   │ created_at   │                      │
                                   │ updated_at   │                      │
                                   └──────────────┘                      │
                                          │                              │
                                          │ 1:1                          │
                                          ▼                              │
                              ┌───────────────────────┐                  │
                              │     AUTH.USERS        │                  │
                              │   (Supabase Managed)  │                  │
                              └───────────────────────┘                  │
                                          │                              │
            ┌─────────────────────────────┼─────────────────────────────┐
            │                             │                             │
            │ user_id                     │ user_id                     │ user_id
            ▼                             ▼                             ▼
    ┌───────────────┐           ┌───────────────────┐          ┌──────────────┐
    │  SUBSCRIBERS  │           │      PACKS        │          │   REGIONS    │
    │───────────────│           │───────────────────│          │──────────────│
    │ id (PK)       │           │ id (PK)           │          │ id (PK)      │
    │ subscriber_id │           │ name              │          │ name         │
    │ name          │           │ price             │          │ user_id (FK) │
    │ mobile        │           │ channels          │          │ created_at   │
    │ stb_number    │◄──────────│ is_active         │          └──────────────┘
    │ current_pack  │    ref    │ user_id (FK)      │
    │ region        │◄──────────│ created_at        │
    │ balance       │    ref    └───────────────────┘
    │ latitude      │
    │ longitude     │
    │ current_sub*  │ (JSONB)
    │ sub_history*  │ (JSONB[])
    │ user_id (FK)  │
    │ join_date     │
    └───────┬───────┘
            │
            │ 1:N
            ▼
    ┌───────────────┐           ┌───────────────────┐
    │ TRANSACTIONS  │           │   STB_INVENTORY   │
    │───────────────│           │───────────────────│
    │ id (PK)       │           │ id (PK)           │
    │ subscriber_id │           │ serial_number     │
    │ type          │           │ status            │
    │ amount        │           │ subscriber_id     │◄── Assigned to
    │ description   │           │ notes             │
    │ date          │           │ user_id (FK)      │
    │ user_id (FK)  │           │ created_at        │
    │ created_at    │           │ updated_at        │
    └───────────────┘           └───────────────────┘

    ┌───────────────┐           ┌───────────────────┐
    │  COMPLAINTS   │           │  BILLING_HISTORY  │
    │───────────────│           │───────────────────│
    │ id (PK)       │           │ id (PK)           │
    │ subscriber_id │           │ month             │
    │ description   │           │ total_subscribers │
    │ status        │           │ total_revenue     │
    │ date          │           │ user_id (FK)      │
    │ resolved_date │           │ created_at        │
    │ user_id (FK)  │           └───────────────────┘
    │ created_at    │
    └───────────────┘

LEGEND:
─────────
PK = Primary Key
FK = Foreign Key (user_id references auth.users via RLS)
◄── = Relationship direction
1:N = One-to-Many relationship
1:1 = One-to-One relationship
*   = JSONB field (embedded document)

NOTE: Supabase RLS policies ensure users can only access
      their own data using auth.uid() = user_id
```

---

## 💾 Database Schema

### Table: `subscribers`

The core table storing customer information.

```sql
CREATE TABLE public.subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id TEXT NOT NULL,         -- Human-readable ID (e.g., "SUB-2024-001")
  name TEXT NOT NULL,                  -- Customer name
  mobile TEXT NOT NULL,                -- Phone number
  stb_number TEXT,                     -- Set-top box serial number
  current_pack TEXT,                   -- Current package name (denormalized)
  region TEXT,                         -- Geographic region/cluster
  balance NUMERIC DEFAULT 0,           -- Account balance (positive = owes, negative = credit)
  latitude NUMERIC,                    -- GPS latitude
  longitude NUMERIC,                   -- GPS longitude
  current_subscription JSONB,          -- Active subscription details
  subscription_history JSONB[],        -- Array of past subscriptions
  user_id UUID NOT NULL,               -- Owner (LCO user)
  join_date TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### Why JSONB for Subscriptions?

```
Decision: Store subscription data as JSONB instead of separate table
Rationale:
- Subscriptions are always accessed with the subscriber
- Reduces JOIN complexity
- Allows flexible schema evolution
- History is a time-series, perfect for array storage
- Trade-off: Harder to query across all subscriptions
```

### Table: `transactions`

Financial records for payments and charges.

```sql
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL,         -- References subscribers.id
  type TEXT NOT NULL,                  -- 'payment' | 'charge'
  amount NUMERIC NOT NULL,             -- Transaction amount
  description TEXT,                    -- Human-readable description
  date TIMESTAMPTZ DEFAULT now(),
  user_id UUID NOT NULL,               -- Owner (LCO user)
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### Balance Calculation Logic

```
Balance = Sum(charges) - Sum(payments)

Positive balance → Customer owes money
Negative balance → Customer has credit (overpaid)
Zero balance → Account is settled

Example:
  Charge: ₹500 (subscription)  → Balance: +500
  Payment: ₹300 (partial pay)  → Balance: +200
  Payment: ₹200 (settle)       → Balance: 0
  Payment: ₹100 (advance)      → Balance: -100 (credit)
```

### Table: `packs`

Package/plan definitions.

```sql
CREATE TABLE public.packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,           -- Package name (e.g., "Gold HD")
  price NUMERIC NOT NULL,       -- Monthly price
  channels TEXT NOT NULL,       -- Channel list/description
  is_active BOOLEAN DEFAULT true,  -- Soft delete flag
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Table: `stb_inventory`

Set-top box inventory management.

```sql
CREATE TABLE public.stb_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number TEXT NOT NULL,  -- Unique STB identifier
  status stb_status NOT NULL DEFAULT 'available',  -- ENUM type
  subscriber_id UUID,           -- NULL if not assigned
  notes TEXT,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ENUM definition
CREATE TYPE stb_status AS ENUM ('available', 'assigned', 'faulty', 'returned');
```

---

## 📁 Application Structure

```
src/
├── components/                 # React Components
│   ├── ui/                    # shadcn/ui base components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── select.tsx
│   │   └── ...
│   ├── AddSubscriberForm.tsx     # New subscriber form
│   ├── SubscriberList.tsx        # Subscriber table with filters
│   ├── SubscriberDetail.tsx      # Individual subscriber view
│   ├── AddPackageSubscriptionDialog.tsx  # Package assignment
│   ├── CancelSubscriptionDialog.tsx      # Cancellation with refund
│   ├── EditSubscriberDialog.tsx          # Edit subscriber info
│   ├── AddTransactionDialog.tsx          # Manual payment/charge
│   ├── EditTransactionDialog.tsx         # Modify transaction
│   ├── PackManagementDialog.tsx          # CRUD for packages
│   ├── RegionManagementDialog.tsx        # CRUD for regions
│   ├── StbInventoryDialog.tsx            # STB management
│   ├── ImportDialog.tsx                  # CSV import
│   └── NavLink.tsx                       # Navigation component
│
├── hooks/                      # Custom React Hooks
│   ├── useAuth.tsx            # Authentication state & methods
│   ├── useSubscribers.tsx     # Subscriber CRUD operations
│   ├── useTransactions.tsx    # Transaction management
│   ├── usePacks.tsx           # Package management
│   ├── useRegions.tsx         # Region management
│   ├── useStbInventory.tsx    # STB inventory management
│   ├── use-toast.ts           # Toast notifications
│   └── use-mobile.tsx         # Mobile detection
│
├── lib/                        # Utility Libraries
│   ├── storage.ts             # Legacy local storage (being phased out)
│   ├── subscriptionUtils.ts   # Subscription business logic
│   ├── pdf.ts                 # PDF generation (receipts, invoices)
│   ├── csv.ts                 # CSV parsing utilities
│   ├── timeSync.ts            # Time synchronization
│   └── utils.ts               # General utilities (cn, etc.)
│
├── pages/                      # Route Components
│   ├── Index.tsx              # Main dashboard (state container)
│   ├── Auth.tsx               # Login/Signup page
│   ├── Analytics.tsx          # Business analytics
│   ├── Billing.tsx            # Billing overview
│   ├── Complaints.tsx         # Complaint management
│   ├── Settings.tsx           # User settings
│   └── NotFound.tsx           # 404 page
│
├── integrations/
│   └── supabase/
│       ├── client.ts          # Supabase client instance (auto-generated)
│       └── types.ts           # Database types (auto-generated)
│
├── App.tsx                     # Root component with routing
├── main.tsx                    # Entry point
└── index.css                   # Global styles & Tailwind config
```

---

## 🧩 Core Modules & Components

### Component: `SubscriberDetail.tsx`

**Purpose**: Display comprehensive subscriber information with all actions.

```typescript
// Component Props
interface SubscriberDetailProps {
  subscriber: Subscriber;        // Current subscriber data
  transactions: Transaction[];   // All subscriber transactions
  onBack: () => void;           // Navigation callback
  onAddTransaction: (tx) => void;  // Add new transaction
  onEdit: (updates) => void;    // Edit subscriber
  onDelete: () => void;         // Delete subscriber
  onReload?: () => void;        // Refresh data
}
```

**Key Features**:
1. **Auto-cleanup expired subscriptions**: On mount, checks if subscription expired and moves to history
2. **Balance display with color coding**: Green (credit), Red (debt), Gray (zero)
3. **Subscription management**: Add, view, cancel with refund calculation
4. **Transaction table**: Sortable list with edit/delete actions
5. **PDF generation**: Thermal receipts and A4 invoices

**Code Pattern - Auto Cleanup**:
```typescript
useEffect(() => {
  const cleanupExpiredSubscription = async () => {
    // Process subscriber data to check expiration
    const { needsUpdate, updates } = processSubscriberData(subscriber);
    
    if (needsUpdate) {
      // Update database
      await supabase
        .from('subscribers')
        .update({
          current_subscription: updates.current_subscription,
          subscription_history: updates.subscription_history,
          current_pack: null  // Clear pack if expired
        })
        .eq('id', subscriber.id);
      
      // Refresh parent component
      onReload?.();
    }
  };
  
  cleanupExpiredSubscription();
}, [subscriber.id]);
```

### Component: `AddPackageSubscriptionDialog.tsx`

**Purpose**: Assign new package subscriptions to subscribers.

**Business Rules**:
1. Cannot add subscription if one is already active
2. Calculates total charge: `packPrice × duration`
3. Updates balance (adds debt)
4. Creates charge transaction automatically
5. Stores subscription in `current_subscription` JSONB

```typescript
const addNewSubscription = async () => {
  // 1. Find selected pack
  const packData = packs.find(p => p.id === selectedPackage);
  
  // 2. Calculate dates
  const startDate = new Date();
  const endDate = addMonths(startDate, duration);
  
  // 3. Create subscription object
  const newSubscription = {
    id: crypto.randomUUID(),
    packName: packData.name,
    packPrice: packData.price,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    duration: duration,
    status: 'active',
    subscribedAt: new Date().toISOString()
  };
  
  // 4. Calculate total charge
  const totalCharge = packData.price * duration;
  
  // 5. Update subscriber with new subscription + balance
  await supabase
    .from('subscribers')
    .update({
      current_subscription: newSubscription,
      subscription_history: [...history, newSubscription],
      balance: currentBalance + totalCharge,
      current_pack: packData.name
    })
    .eq('id', subscriberId);
  
  // 6. Create charge transaction
  await supabase
    .from('transactions')
    .insert({
      subscriber_id: subscriberId,
      type: 'charge',
      amount: totalCharge,
      description: `Subscription: ${packData.name} (${duration} months)`
    });
};
```

### Component: `CancelSubscriptionDialog.tsx`

**Purpose**: Handle subscription cancellation with optional refund.

**Refund Calculation**:
```typescript
// Calculate daily rate
const totalDays = duration * 30;  // 30 days per month
const totalCharged = packPrice * duration;
const pricePerDay = totalCharged / totalDays;

// Calculate refund based on remaining days
const daysRemaining = Math.floor(
  (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
);
const autoCalculatedRefund = Math.floor(daysRemaining * pricePerDay);

// User can adjust refund amount (0 to totalCharged)
```

---

## 🪝 Custom Hooks

### Hook: `useSubscribers`

**Purpose**: Manage subscriber data with CRUD operations.

```typescript
export const useSubscribers = (userId: string | undefined) => {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);

  // Load all subscribers for user
  const loadSubscribers = async () => {
    const { data } = await supabase
      .from('subscribers')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    setSubscribers(data || []);
  };

  // Add new subscriber
  const addSubscriber = async (subscriber: SubscriberInsert) => {
    const { data, error } = await supabase
      .from('subscribers')
      .insert({ ...subscriber, user_id: userId })
      .select()
      .single();
    
    if (data) setSubscribers(prev => [data, ...prev]);
    return !error;
  };

  // Update existing subscriber
  const updateSubscriber = async (id: string, updates: SubscriberUpdate) => {
    const { data, error } = await supabase
      .from('subscribers')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();
    
    if (data) {
      setSubscribers(prev => 
        prev.map(s => s.id === id ? { ...s, ...data } : s)
      );
    }
    return !error;
  };

  // Delete subscriber
  const deleteSubscriber = async (id: string) => {
    await supabase.from('subscribers').delete().eq('id', id);
    setSubscribers(prev => prev.filter(s => s.id !== id));
  };

  return {
    subscribers,
    loading,
    addSubscriber,
    updateSubscriber,
    deleteSubscriber,
    reloadSubscribers: loadSubscribers
  };
};
```

**Usage Pattern**:
```typescript
function MyComponent() {
  const { user } = useAuth();
  const { 
    subscribers, 
    loading, 
    addSubscriber,
    updateSubscriber,
    deleteSubscriber 
  } = useSubscribers(user?.id);

  if (loading) return <LoadingSkeleton />;

  return (
    <div>
      {subscribers.map(sub => (
        <SubscriberCard 
          key={sub.id}
          subscriber={sub}
          onEdit={(updates) => updateSubscriber(sub.id, updates)}
          onDelete={() => deleteSubscriber(sub.id)}
        />
      ))}
    </div>
  );
}
```

### Hook: `usePacks`

**Purpose**: Manage subscription packages with soft-delete support.

```typescript
export const usePacks = (userId: string | undefined) => {
  const [packs, setPacks] = useState<Pack[]>([]);
  
  // Get only active packs (for dropdowns)
  const getActivePacks = () => packs.filter(p => p.is_active !== false);
  
  // Check if pack is in use before deletion
  const checkPackInUse = async (packName: string) => {
    const { data } = await supabase.rpc('is_pack_in_use', {
      pack_name: packName,
      owner_id: userId
    });
    return data;
  };
  
  // Soft delete - mark as inactive
  const retirePack = async (id: string) => {
    return updatePack(id, { is_active: false });
  };
  
  // Reactivate retired pack
  const reactivatePack = async (id: string) => {
    return updatePack(id, { is_active: true });
  };
  
  return {
    packs,
    getActivePacks,
    addPack,
    updatePack,
    deletePack,
    retirePack,
    reactivatePack,
    checkPackInUse
  };
};
```

### Hook: `useAuth`

**Purpose**: Handle authentication state and methods.

```typescript
export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ 
      email, 
      password 
    });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ 
      email, 
      password 
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return { user, loading, signIn, signUp, signOut };
};
```

---

## 🔧 Utility Functions

### `src/lib/subscriptionUtils.ts`

**Purpose**: Centralized subscription business logic.

```typescript
/**
 * Check if subscription is currently active (not expired)
 * @param subscription - The subscription to check
 * @returns boolean - true if end date is in the future
 */
export const isSubscriptionActive = (
  subscription: SubscriptionEntry | null
): boolean => {
  if (!subscription) return false;
  const endDate = new Date(subscription.endDate);
  return endDate.getTime() > Date.now();
};

/**
 * Calculate remaining days until expiration
 * @param endDate - ISO date string of expiration
 * @returns number - positive = days left, negative = days since expired
 */
export const calculateRemainingDays = (endDate: string): number => {
  const end = new Date(endDate);
  const diffMs = end.getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
};

/**
 * Process subscriber data to auto-cleanup expired subscriptions
 * Moves expired current_subscription to subscription_history
 */
export const processSubscriberData = (subscriber: any) => {
  const currentSub = subscriber.current_subscription;
  const history = subscriber.subscription_history || [];
  
  if (!currentSub) {
    return { needsUpdate: false, updates: { current_subscription: null, subscription_history: history } };
  }
  
  if (!isSubscriptionActive(currentSub)) {
    // Move to history with 'expired' status
    const expiredSub = { ...currentSub, status: 'expired' };
    const existsInHistory = history.some(h => h.id === currentSub.id);
    
    return {
      needsUpdate: true,
      updates: {
        current_subscription: null,
        subscription_history: existsInHistory 
          ? history.map(h => h.id === currentSub.id ? expiredSub : h)
          : [...history, expiredSub]
      }
    };
  }
  
  return { needsUpdate: false, updates: { current_subscription: currentSub, subscription_history: history } };
};

/**
 * Get display status for subscription
 * Returns color-coded status for UI
 */
export const getSubscriptionStatus = (subscription: SubscriptionEntry | null) => {
  if (!subscription) {
    return { isActive: false, daysRemaining: 0, statusText: 'No subscription', statusColor: 'yellow' };
  }
  
  const daysRemaining = calculateRemainingDays(subscription.endDate);
  
  if (daysRemaining > 0) {
    return {
      isActive: true,
      daysRemaining,
      statusText: `${daysRemaining} days left`,
      statusColor: daysRemaining <= 7 ? 'yellow' : 'green'
    };
  }
  
  return {
    isActive: false,
    daysRemaining,
    statusText: `Expired ${Math.abs(daysRemaining)} days ago`,
    statusColor: 'red'
  };
};
```

### `src/lib/pdf.ts`

**Purpose**: Generate printable documents.

```typescript
/**
 * Generate thermal receipt (58mm width)
 * Optimized for small thermal printers
 */
export const generateThermalReceipt = (data: ReceiptData) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [58, 100]  // 58mm thermal paper
  });
  
  // Header
  doc.setFontSize(10);
  doc.text('CABLE TV RECEIPT', 29, 5, { align: 'center' });
  
  // Subscriber info
  doc.setFontSize(8);
  doc.text(`Name: ${data.subscriberName}`, 3, 15);
  doc.text(`ID: ${data.subscriberId}`, 3, 20);
  doc.text(`Mobile: ${data.mobile}`, 3, 25);
  
  // Subscription details
  doc.text(`Pack: ${data.packName}`, 3, 35);
  doc.text(`Duration: ${data.duration} month(s)`, 3, 40);
  doc.text(`Amount: ₹${data.totalAmount}`, 3, 45);
  
  // Validity
  doc.text(`Valid: ${formatDate(data.startDate)} - ${formatDate(data.endDate)}`, 3, 55);
  
  // Save/print
  doc.save(`receipt-${data.subscriberId}.pdf`);
};

/**
 * Generate A4 invoice
 * Professional format with company branding
 */
export const generateSubscriptionInvoice = (data: InvoiceData) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });
  
  // Company header
  doc.setFontSize(16);
  doc.text('INVOICE', 105, 20, { align: 'center' });
  
  // Invoice details table
  doc.autoTable({
    startY: 60,
    head: [['Description', 'Duration', 'Price', 'Total']],
    body: [[
      data.packName,
      `${data.duration} month(s)`,
      `₹${data.packPrice}`,
      `₹${data.totalAmount}`
    ]],
  });
  
  doc.save(`invoice-${data.subscriberId}.pdf`);
};
```

---

## 📦 State Management

### Pattern: Lifting State Up

```
┌─────────────────────────────────────────────────────────────┐
│                        Index.tsx                            │
│   (State Container - owns all data and handlers)           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌─────────────────────────────┐    │
│  │   Subscribers   │    │     Selected Subscriber     │    │
│  │   (from hook)   │    │         (local state)       │    │
│  └─────────────────┘    └─────────────────────────────┘    │
│                                                             │
│  ┌─────────────────┐    ┌─────────────────────────────┐    │
│  │   Transactions  │    │      Current View           │    │
│  │   (from hook)   │    │   (list | detail | add)     │    │
│  └─────────────────┘    └─────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
           ▼                  ▼                  ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
    │SubscriberList│  │SubscriberDetail│  │ AddSubscriberForm│
    │   (display)  │  │   (display)  │  │    (form)        │
    └──────────────┘  └──────────────┘  └──────────────────┘
```

### Why Not Redux/Zustand?

```
Decision: Use React hooks + prop drilling instead of global state
Rationale:
- Data is naturally scoped to user (RLS handles isolation)
- Component tree is relatively flat
- Hooks provide sufficient abstraction
- Avoids unnecessary complexity for this scale
- Easy to migrate if needed later
```

---

## 🔐 Authentication Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                        AUTHENTICATION FLOW                            │
└──────────────────────────────────────────────────────────────────────┘

User opens app
       │
       ▼
┌──────────────────┐
│ useAuth checks   │
│ session state    │
└────────┬─────────┘
         │
    ┌────┴────┐
    │ Session │
    │ exists? │
    └────┬────┘
         │
    ┌────┴────┐
   No        Yes
    │         │
    ▼         ▼
┌────────┐  ┌──────────────┐
│Auth.tsx│  │   Index.tsx  │
│ Login/ │  │  Dashboard   │
│ Signup │  │              │
└───┬────┘  └──────────────┘
    │
    │ Submit credentials
    ▼
┌────────────────────┐
│ supabase.auth.     │
│ signInWithPassword │
│        or          │
│     signUp         │
└────────┬───────────┘
         │
    ┌────┴────┐
    │ Success │
    │    ?    │
    └────┬────┘
         │
    ┌────┴────┐
   No        Yes
    │         │
    ▼         ▼
┌────────┐  ┌──────────────────────┐
│ Show   │  │ onAuthStateChange    │
│ Error  │  │ triggers, sets user  │
└────────┘  └──────────┬───────────┘
                       │
                       ▼
              ┌──────────────┐
              │ Redirect to  │
              │   Index.tsx  │
              └──────────────┘
```

### RLS (Row Level Security) Implementation

```sql
-- Every table with user data has this policy pattern:

-- SELECT: Users can only read their own data
CREATE POLICY "Users can view own data" ON subscribers
FOR SELECT USING (auth.uid() = user_id);

-- INSERT: Users can only insert with their user_id
CREATE POLICY "Users can insert own data" ON subscribers
FOR INSERT WITH CHECK (auth.uid() = user_id);

-- UPDATE: Users can only update their own data
CREATE POLICY "Users can update own data" ON subscribers
FOR UPDATE USING (auth.uid() = user_id);

-- DELETE: Users can only delete their own data
CREATE POLICY "Users can delete own data" ON subscribers
FOR DELETE USING (auth.uid() = user_id);
```

---

## 💼 Business Logic

### Subscription Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SUBSCRIPTION LIFECYCLE                            │
└─────────────────────────────────────────────────────────────────────┘

                    ┌─────────────┐
                    │   START     │
                    └──────┬──────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │ Add Subscription│
                  │ (set duration,  │
                  │  calculate end) │
                  └────────┬────────┘
                           │
                           ▼
         ┌─────────────────────────────────────┐
         │           ACTIVE STATE              │
         │  - Shows in subscriber profile      │
         │  - Days remaining calculated        │
         │  - Cancel button visible            │
         └──────────────────┬──────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
              ▼                           ▼
     ┌─────────────────┐        ┌─────────────────┐
     │ User Cancels    │        │ Time Expires    │
     │ (manual action) │        │ (auto-detect)   │
     └────────┬────────┘        └────────┬────────┘
              │                          │
              ▼                          ▼
     ┌─────────────────┐        ┌─────────────────┐
     │ Calculate Refund│        │ No Refund       │
     │ (days × daily)  │        │                 │
     └────────┬────────┘        └────────┬────────┘
              │                          │
              ▼                          ▼
     ┌─────────────────┐        ┌─────────────────┐
     │ Create Payment  │        │ processSubscriber│
     │ Transaction     │        │ Data() called   │
     │ (refund amount) │        │                 │
     └────────┬────────┘        └────────┬────────┘
              │                          │
              └──────────────┬───────────┘
                             │
                             ▼
              ┌──────────────────────────┐
              │    Move to History       │
              │  status: 'cancelled' or  │
              │          'expired'       │
              └──────────────┬───────────┘
                             │
                             ▼
              ┌──────────────────────────┐
              │ Set current_subscription │
              │        to NULL           │
              └──────────────┬───────────┘
                             │
                             ▼
                    ┌─────────────┐
                    │     END     │
                    └─────────────┘
```

### Balance Management

```typescript
// BALANCE MODEL:
// Positive balance = Customer owes money (debt)
// Negative balance = Customer has credit (overpaid)
// Zero = Settled

// When adding subscription (charge):
newBalance = currentBalance + totalCharge;  // Increases debt

// When receiving payment:
newBalance = currentBalance - paymentAmount;  // Reduces debt

// When issuing refund (treated as payment):
newBalance = currentBalance - refundAmount;  // Reduces debt

// Example scenario:
// 1. New subscriber, balance = 0
// 2. Add ₹500 subscription → balance = 500 (owes ₹500)
// 3. Customer pays ₹300 → balance = 200 (still owes ₹200)
// 4. Customer pays ₹200 → balance = 0 (settled)
// 5. Customer pays ₹100 advance → balance = -100 (has ₹100 credit)
// 6. Add ₹500 subscription → balance = 400 (credit applied, owes ₹400)
```

---

## 🛡 Security Implementation

### Row Level Security (RLS)

Every table uses RLS to ensure data isolation:

```sql
-- Example: subscribers table policies

-- 1. Enable RLS on the table
ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;

-- 2. Create restrictive policies (PERMISSIVE = false means MUST pass)
CREATE POLICY "Users can view their own subscribers"
ON public.subscribers
FOR SELECT
USING (auth.uid() = user_id);

-- 3. This ensures even if the frontend has a bug,
--    users cannot access other users' data
```

### Why RLS?

```
Traditional approach:
  Client → API → Check user_id → Database
  
  Problem: If API check is buggy or forgotten, data leaks

RLS approach:
  Client → API → Database (with RLS)
  
  Benefit: Database enforces access at lowest level
           Even raw SQL queries are filtered
           Defense in depth
```

### Input Validation

```typescript
// Client-side validation (UX)
const validateMobile = (mobile: string): boolean => {
  return /^[6-9]\d{9}$/.test(mobile);  // Indian mobile format
};

// Server-side is automatic via TypeScript + Supabase types
// Invalid data types will fail at the DB level
```

---

## 🌐 API Integration

### Supabase Client Pattern

```typescript
// src/integrations/supabase/client.ts (auto-generated)
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
);
```

### Query Patterns

```typescript
// 1. Simple select
const { data, error } = await supabase
  .from('subscribers')
  .select('*')
  .eq('user_id', userId);

// 2. Select with filter
const { data } = await supabase
  .from('subscribers')
  .select('*')
  .eq('user_id', userId)
  .ilike('name', `%${searchTerm}%`)
  .order('created_at', { ascending: false });

// 3. Insert with return
const { data, error } = await supabase
  .from('subscribers')
  .insert({ name, mobile, user_id: userId })
  .select()
  .single();

// 4. Update with conditions
const { error } = await supabase
  .from('subscribers')
  .update({ balance: newBalance })
  .eq('id', subscriberId);

// 5. Delete
const { error } = await supabase
  .from('subscribers')
  .delete()
  .eq('id', subscriberId);

// 6. Call database function
const { data } = await supabase.rpc('is_pack_in_use', {
  pack_name: packName,
  owner_id: userId
});
```

---

## 📄 PDF Generation

### Library: jsPDF

```typescript
import { jsPDF } from 'jspdf';

// Basic document creation
const doc = new jsPDF({
  orientation: 'portrait',  // or 'landscape'
  unit: 'mm',
  format: 'a4'  // or [width, height] for custom
});

// Text
doc.setFontSize(12);
doc.text('Hello World', 10, 10);

// Save
doc.save('document.pdf');
```

### Thermal Receipt (58mm)

```typescript
export const generateThermalReceipt = (data) => {
  const doc = new jsPDF({
    unit: 'mm',
    format: [58, 100]  // Width: 58mm, Height: 100mm
  });
  
  const centerX = 29;  // Center of 58mm
  
  // Use small font sizes
  doc.setFontSize(10);  // Header
  doc.setFontSize(8);   // Body
  doc.setFontSize(6);   // Fine print
  
  // Dashed separator line
  doc.setLineDashPattern([1, 1], 0);
  doc.line(3, 30, 55, 30);
  
  doc.save(`receipt-${data.id}.pdf`);
};
```

---

## ✅ Best Practices

### 1. TypeScript Usage

```typescript
// ❌ Avoid: any type
const handleData = (data: any) => { ... };

// ✅ Prefer: Explicit types
interface SubscriberData {
  id: string;
  name: string;
  balance: number;
}
const handleData = (data: SubscriberData) => { ... };

// ✅ Use database types
import type { Database } from '@/integrations/supabase/types';
type Subscriber = Database['public']['Tables']['subscribers']['Row'];
```

### 2. Error Handling

```typescript
// ❌ Avoid: Silent failures
const { data } = await supabase.from('subscribers').select('*');

// ✅ Prefer: Handle errors explicitly
const { data, error } = await supabase.from('subscribers').select('*');
if (error) {
  console.error('Failed to load subscribers:', error);
  toast.error('Failed to load subscribers');
  return;
}
```

### 3. Component Structure

```typescript
// ❌ Avoid: Giant components with everything
const MegaComponent = () => {
  // 500 lines of state, effects, handlers, JSX
};

// ✅ Prefer: Small, focused components
const SubscriberCard = ({ subscriber, onEdit }) => { ... };
const SubscriberList = ({ subscribers }) => { ... };
const SubscriberFilters = ({ onFilter }) => { ... };
```

### 4. State Updates

```typescript
// ❌ Avoid: Direct mutation
subscribers.push(newSubscriber);
setSubscribers(subscribers);

// ✅ Prefer: Immutable updates
setSubscribers(prev => [...prev, newSubscriber]);

// ✅ For updates
setSubscribers(prev => 
  prev.map(s => s.id === id ? { ...s, ...updates } : s)
);

// ✅ For deletions
setSubscribers(prev => prev.filter(s => s.id !== id));
```

### 5. Async/Await

```typescript
// ❌ Avoid: Unhandled promises
useEffect(() => {
  loadData();  // Warning: Promise returned from loadData is ignored
}, []);

// ✅ Prefer: Proper async handling
useEffect(() => {
  const load = async () => {
    await loadData();
  };
  load();
}, []);

// ✅ Or use IIFE
useEffect(() => {
  (async () => {
    await loadData();
  })();
}, []);
```

---

## 🔄 Common Patterns

### Pattern: Optimistic Updates

```typescript
// Update UI immediately, then sync with server
const handleToggle = async (id: string) => {
  // 1. Optimistic update
  setItems(prev => prev.map(item => 
    item.id === id ? { ...item, active: !item.active } : item
  ));
  
  // 2. Server update
  const { error } = await supabase
    .from('items')
    .update({ active: !currentValue })
    .eq('id', id);
  
  // 3. Rollback if failed
  if (error) {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, active: currentValue } : item
    ));
    toast.error('Failed to update');
  }
};
```

### Pattern: Form State Management

```typescript
const [formData, setFormData] = useState({
  name: '',
  mobile: '',
  region: ''
});

// Generic handler
const handleChange = (field: keyof typeof formData, value: string) => {
  setFormData(prev => ({ ...prev, [field]: value }));
};

// In JSX
<Input 
  value={formData.name}
  onChange={(e) => handleChange('name', e.target.value)}
/>
```

### Pattern: Loading States

```typescript
const [loading, setLoading] = useState(true);
const [data, setData] = useState<Data[]>([]);

useEffect(() => {
  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('table').select('*');
    setData(data || []);
    setLoading(false);
  };
  load();
}, []);

if (loading) {
  return <Skeleton className="h-32 w-full" />;
}

return <DataTable data={data} />;
```

---

## 🔧 Troubleshooting

### Issue: Data not loading

```typescript
// Check 1: Is user authenticated?
const { user, loading } = useAuth();
if (!user) {
  // RLS will block all queries
}

// Check 2: Is user_id being passed?
const { data } = await supabase
  .from('subscribers')
  .select('*')
  .eq('user_id', userId);  // Must match auth.uid()

// Check 3: Check browser console for errors
// Check 4: Check Network tab for 403 errors (RLS failure)
```

### Issue: Subscription not updating

```typescript
// Ensure you're updating the correct fields
await supabase
  .from('subscribers')
  .update({
    current_subscription: newSub,  // JSONB field
    subscription_history: [...history, newSub],  // Array
    current_pack: newSub.packName,  // Denormalized for filtering
    balance: newBalance  // Recalculated
  })
  .eq('id', subscriberId);
```

### Issue: PDF not generating

```typescript
// Check 1: jsPDF imported correctly
import { jsPDF } from 'jspdf';

// Check 2: All data is defined
const doc = new jsPDF();
doc.text(data.name ?? 'N/A', 10, 10);  // Handle null/undefined

// Check 3: Font size appropriate for paper
// Thermal: 6-10pt
// A4: 10-14pt
```

---

## 🆔 Subscriber ID Generation

### Pattern: REGION-NNN

Subscriber IDs follow a region-based pattern for easy identification and organization:

```
NORTH-001   → First subscriber in "North Zone"
NORTH-002   → Second subscriber in "North Zone"
DOWNTOWN-001 → First subscriber in "Downtown"
EAST-015     → 15th subscriber in "East Zone"
```

### Implementation

```typescript
// src/lib/subscriberIdGenerator.ts

/**
 * Generates a subscriber ID in the format: REGION-001
 * Each region maintains its own sequential counter.
 */
export async function generateSubscriberId(
  regionName: string, 
  userId: string
): Promise<string> {
  const prefix = createRegionPrefix(regionName);
  const nextNumber = await getNextSequenceNumber(prefix, userId);
  return `${prefix}-${nextNumber.toString().padStart(3, '0')}`;
}

/**
 * Creates prefix from region name:
 * - Takes first word
 * - Removes special characters
 * - Uppercase, max 10 chars
 * 
 * Examples:
 * "North Zone" → "NORTH"
 * "Downtown Area" → "DOWNTOWN"
 */
export function createRegionPrefix(regionName: string): string {
  const firstWord = regionName.split(/[\s-_]+/)[0];
  return firstWord.replace(/[^a-zA-Z0-9]/g, '')
                  .toUpperCase()
                  .slice(0, 10) || 'DEFAULT';
}
```

### Database Query for Next Sequence

```typescript
async function getNextSequenceNumber(prefix: string, userId: string): Promise<number> {
  const { data } = await supabase
    .from('subscribers')
    .select('subscriber_id')
    .eq('user_id', userId)
    .like('subscriber_id', `${prefix}-%`);
  
  // Find highest existing number
  let maxNumber = 0;
  for (const row of data || []) {
    const match = row.subscriber_id?.match(/^${prefix}-(\d+)$/);
    if (match) {
      maxNumber = Math.max(maxNumber, parseInt(match[1], 10));
    }
  }
  
  return maxNumber + 1;
}
```

### Benefits

| Benefit | Description |
|---------|-------------|
| **Visual Organization** | Quickly identify subscriber's region |
| **Collision-Free** | Scoped per region, per user |
| **Scalable** | Supports 999+ subscribers per region |
| **Searchable** | Filter by prefix in database queries |

---

## 🚀 Deployment Guide

### Option 1: Deploy to Vercel + Self-Hosted Supabase

This guide walks you through deploying the frontend to Vercel and using your own Supabase project.

#### Prerequisites

- GitHub account
- Vercel account (free tier works)
- Supabase account (free tier works)
- Node.js 18+ installed locally

#### Step 1: Export Your Code

1. Connect your Lovable project to GitHub (Settings → GitHub)
2. Push your code to the repository
3. Clone the repository locally:

```bash
git clone https://github.com/yourusername/your-repo.git
cd your-repo
```

#### Step 2: Create Your Own Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your project credentials:
   - **Project URL**: `https://xxxxxxxx.supabase.co`
   - **Anon Key**: Found in Settings → API
   - **Service Role Key**: For server-side operations

#### Step 3: Migrate Database Schema

Export the schema from your current database and run migrations:

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your new project
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Push migrations from supabase/migrations/ folder
supabase db push
```

Or manually run the SQL from each migration file in your Supabase SQL Editor.

#### Step 4: Configure Environment Variables

Create a `.env.local` file for local development:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key_here
VITE_SUPABASE_PROJECT_ID=your_project_id
```

#### Step 5: Update Supabase Client

The client is auto-generated, but if you need to modify it:

```typescript
// src/integrations/supabase/client.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
```

#### Step 6: Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and import your GitHub repository
2. Configure environment variables in Vercel dashboard:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_SUPABASE_PROJECT_ID`
3. Deploy!

```bash
# Or deploy via CLI
npm install -g vercel
vercel
```

#### Step 7: Configure Authentication URLs

In your Supabase dashboard (Authentication → URL Configuration):

```
Site URL: https://your-app.vercel.app
Redirect URLs: 
  - https://your-app.vercel.app/*
  - http://localhost:5173/* (for local dev)
```

### Deployment Checklist

| Step | Action | Status |
|------|--------|--------|
| 1 | Export code to GitHub | ⬜ |
| 2 | Create new Supabase project | ⬜ |
| 3 | Run database migrations | ⬜ |
| 4 | Configure RLS policies | ⬜ |
| 5 | Set environment variables | ⬜ |
| 6 | Deploy to Vercel | ⬜ |
| 7 | Update auth redirect URLs | ⬜ |
| 8 | Test authentication flow | ⬜ |
| 9 | Test CRUD operations | ⬜ |
| 10 | Configure custom domain (optional) | ⬜ |

### Data Migration

If you have existing data in Lovable Cloud:

```sql
-- Export data from Lovable Cloud (run in Cloud SQL editor)
-- Then import to your Supabase project

-- Option 1: Export as CSV from Cloud UI
-- Option 2: Use pg_dump for large datasets
-- Option 3: Write a migration script

-- Example: Copy subscribers
INSERT INTO subscribers (id, name, mobile, ...)
SELECT id, name, mobile, ...
FROM source_table;
```

### Edge Functions

If you have edge functions, deploy them to your Supabase:

```bash
# Deploy all functions
supabase functions deploy

# Deploy specific function
supabase functions deploy function-name
```

### Custom Domain (Optional)

**Vercel:**
1. Go to your Vercel project → Settings → Domains
2. Add your custom domain
3. Configure DNS records

**Supabase:**
1. Upgrade to Pro plan for custom domains
2. Or keep using the default `*.supabase.co` domain

---

## 📚 Further Reading

- [React Documentation](https://react.dev)
- [Supabase Documentation](https://supabase.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [shadcn/ui Components](https://ui.shadcn.com)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [jsPDF Documentation](https://rawgit.com/MrRio/jsPDF/master/docs/)
- [Vercel Documentation](https://vercel.com/docs)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

---

*Built with ❤️ using Lovable*
