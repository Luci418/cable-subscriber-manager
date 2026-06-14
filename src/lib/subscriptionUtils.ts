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

// NOTE: `processSubscriberData` (a legacy client-side expiry cleanup helper
// that mutated the JSONB `current_subscription` / `subscription_history`
// columns) was removed in Phase 4b. Expiry is now handled exclusively by
// the server-side `expire_lapsed_subscriptions` RPC and the normalised
// `subscriptions` table — the client no longer writes to the legacy JSONB
// columns. See docs/BUSINESS_MODEL.md "Phase 4b".



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
