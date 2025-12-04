/**
 * Subscription utility functions for consistent business logic
 */

export interface SubscriptionEntry {
  id: string;
  packName: string;
  packPrice: number;
  startDate: string;
  endDate: string;
  duration: number;
  status: 'active' | 'expired' | 'cancelled';
  subscribedAt: string;
}

/**
 * Check if a subscription is currently active (not expired)
 */
export const isSubscriptionActive = (subscription: SubscriptionEntry | null | undefined): boolean => {
  if (!subscription) return false;
  
  const endDate = new Date(subscription.endDate);
  const now = new Date();
  return endDate.getTime() > now.getTime();
};

/**
 * Calculate remaining days for a subscription
 * Positive = days remaining, Negative = days since expiry
 */
export const calculateRemainingDays = (endDate: string): number => {
  const end = new Date(endDate);
  const now = new Date();
  const diffTime = end.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

/**
 * Validate subscription data has all required fields
 */
export const validateSubscription = (sub: any): sub is SubscriptionEntry => {
  return (
    sub &&
    typeof sub.id === 'string' &&
    typeof sub.packName === 'string' &&
    typeof sub.endDate === 'string' &&
    typeof sub.startDate === 'string'
  );
};

/**
 * Process subscriber data to auto-cleanup expired subscriptions
 * Returns updated subscriber data with expired subscriptions moved to history
 */
export const processSubscriberData = (subscriber: any): {
  needsUpdate: boolean;
  updates: {
    current_subscription: SubscriptionEntry | null;
    subscription_history: SubscriptionEntry[];
  };
} => {
  const currentSub = subscriber.current_subscription as SubscriptionEntry | null;
  const history = (subscriber.subscription_history || []) as SubscriptionEntry[];
  
  // If no current subscription, nothing to process
  if (!currentSub) {
    return {
      needsUpdate: false,
      updates: {
        current_subscription: null,
        subscription_history: history
      }
    };
  }
  
  // Check if current subscription is expired
  if (!isSubscriptionActive(currentSub)) {
    // Move expired subscription to history with 'expired' status
    const expiredSub = {
      ...currentSub,
      status: 'expired' as const
    };
    
    // Check if already in history
    const existsInHistory = history.some(h => h.id === currentSub.id);
    const updatedHistory = existsInHistory 
      ? history.map(h => h.id === currentSub.id ? expiredSub : h)
      : [...history, expiredSub];
    
    return {
      needsUpdate: true,
      updates: {
        current_subscription: null,
        subscription_history: updatedHistory
      }
    };
  }
  
  return {
    needsUpdate: false,
    updates: {
      current_subscription: currentSub,
      subscription_history: history
    }
  };
};

/**
 * Get subscription status info for display
 */
export const getSubscriptionStatus = (subscription: SubscriptionEntry | null | undefined): {
  isActive: boolean;
  daysRemaining: number;
  statusText: string;
  statusColor: 'green' | 'red' | 'yellow';
} => {
  if (!subscription) {
    return {
      isActive: false,
      daysRemaining: 0,
      statusText: 'No subscription',
      statusColor: 'yellow'
    };
  }
  
  const daysRemaining = calculateRemainingDays(subscription.endDate);
  const isActive = daysRemaining > 0;
  
  if (isActive) {
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
