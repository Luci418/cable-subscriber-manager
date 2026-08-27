import type { Subscriber } from '@/hooks/useSubscribers';

export type ServiceFilter = 'all' | 'cable' | 'internet';
export type StatusFilter = 'all' | 'overdue' | 'expiring' | 'active' | 'inactive';

/** One billable line = one subscriber × one service (cable / internet). */
export type ServiceLine = {
  subscriber: Subscriber;
  service: 'cable' | 'internet';
  sub: any | null;
  pack: string | null;
  balance: number;
  daysUntil: number | null;
  isActive: boolean;
  isOverdue: boolean;
  isExpiring: boolean;
  key: string;
};
