import { useState } from 'react';
import { Subscriber, Transaction } from '@/lib/storage';
import { generateInvoicePDF } from '@/lib/pdf';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Plus, Trash2, Edit, Download, Calendar, Clock, History, Pencil } from 'lucide-react';
import { AddTransactionDialog } from './AddTransactionDialog';
import { EditSubscriberDialog } from './EditSubscriberDialog';
import { AddPackageSubscriptionDialog } from './AddPackageSubscriptionDialog';
import { EditTransactionDialog } from './EditTransactionDialog';
import { updateTransaction } from '@/lib/storage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CancelSubscriptionDialog } from './CancelSubscriptionDialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SubscriberDetailProps {
  subscriber: Subscriber;
  transactions: Transaction[];
  onBack: () => void;
  onAddTransaction: (transaction: { type: 'payment' | 'charge'; amount: number; description: string }) => void;
  onEdit: (updates: Partial<Subscriber>) => void;
  onDelete: () => void;
  onReload?: () => void;
}

export const SubscriberDetail = ({
  subscriber,
  transactions,
  onBack,
  onAddTransaction,
  onEdit,
  onDelete,
  onReload,
}: SubscriberDetailProps) => {
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showAddPackage, setShowAddPackage] = useState(false);
  const [showEditTransaction, setShowEditTransaction] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const sortedTransactions = [...transactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const getBalanceColor = (balance: number) => {
    if (balance > 0) return 'text-success';
    if (balance < 0) return 'text-destructive';
    return 'text-muted-foreground';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  const calculateRemainingDays = (endDate: string) => {
    const end = new Date(endDate);
    const now = new Date();
    const diffTime = end.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const handleEditTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setShowEditTransaction(true);
  };

  const handleUpdateTransaction = (transactionId: string, updates: any) => {
    updateTransaction(transactionId, updates);
    setShowEditTransaction(false);
    setEditingTransaction(null);
    // Trigger parent component to reload data
    onBack();
  };

  const handleCancelSubscription = async (refundAmount: number) => {
    const currentSub = (subscriber as any).current_subscription;
    if (!currentSub) return;

    // Mark current subscription as cancelled in history
    const history = ((subscriber as any).subscription_history || []).map((sub: any) =>
      sub.id === currentSub.id ? { ...sub, status: 'cancelled' } : sub
    );

    // Only update balance if refund amount is greater than 0
    const newBalance = refundAmount > 0 ? subscriber.balance + refundAmount : subscriber.balance;

    const { error } = await supabase
      .from('subscribers')
      .update({
        current_subscription: null,
        subscription_history: history,
        balance: newBalance,
      })
      .eq('id', subscriber.id);

    if (error) {
      toast.error('Failed to cancel subscription');
      console.error(error);
      return;
    }

    // Create refund transaction only if amount > 0
    if (refundAmount > 0) {
      await supabase.from('transactions').insert({
        subscriber_id: subscriber.id,
        user_id: (subscriber as any).user_id,
        type: 'payment',
        amount: refundAmount,
        description: `Refund for cancelled subscription: ${currentSub.packName}`,
        date: new Date().toISOString(),
      });
    }

    toast.success(refundAmount > 0 
      ? `Subscription cancelled. Refund: ₹${refundAmount.toFixed(2)}` 
      : 'Subscription cancelled.');
    setShowCancelDialog(false);
    onReload?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to List
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowEditDialog(true)}>
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl">{subscriber.name}</CardTitle>
              <p className="text-muted-foreground mt-2">{subscriber.mobile}</p>
            </div>
            <Badge variant="secondary" className="text-base px-4 py-2">{subscriber.pack}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">STB Number</p>
              <p className="font-medium">{subscriber.stbNumber}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Region/Cluster</p>
              <p className="font-medium">{subscriber.region}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Current Balance</p>
              <p className={`text-2xl font-bold ${getBalanceColor(subscriber.balance)}`}>
                ₹{subscriber.balance.toFixed(2)}
              </p>
            </div>
            {subscriber.latitude && subscriber.longitude && (
              <div className="md:col-span-2">
                <p className="text-sm text-muted-foreground">Location Coordinates</p>
                <p className="font-medium">
                  📍 Lat: {subscriber.latitude.toFixed(6)}, Long: {subscriber.longitude.toFixed(6)}
                </p>
              </div>
            )}
            <div className="md:col-span-2">
              <p className="text-sm text-muted-foreground">Joined</p>
              <p className="font-medium">
                {(subscriber as any).join_date 
                  ? formatDate((subscriber as any).join_date) 
                  : (subscriber.createdAt ? formatDate(subscriber.createdAt) : 'N/A')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Package Subscriptions</CardTitle>
            <Button onClick={() => setShowAddPackage(true)} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Package
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {(subscriber as any).current_subscription ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-primary/5 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-muted-foreground">Current Active Package</span>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const currentSub = (subscriber as any).current_subscription;
                      const daysLeft = calculateRemainingDays(currentSub.endDate);
                      return daysLeft > 0 ? (
                        <>
                          <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-700 dark:text-green-400">
                            Active
                          </span>
                          <span className="text-xs px-2 py-1 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400">
                            {daysLeft} days left
                          </span>
                        </>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded-full bg-red-500/10 text-red-700 dark:text-red-400">
                          Expired {Math.abs(daysLeft)} days ago
                        </span>
                      );
                    })()}
                  </div>
                </div>
                <h4 className="text-xl font-bold mb-3">{(subscriber as any).current_subscription.packName}</h4>
                <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                  <div>
                    <p className="text-muted-foreground">Start Date</p>
                    <p className="font-medium">
                      {new Date((subscriber as any).current_subscription.startDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Expiry Date</p>
                    <p className="font-medium">
                      {new Date((subscriber as any).current_subscription.endDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Duration</p>
                    <p className="font-medium">{(subscriber as any).current_subscription.duration} months</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Monthly Price</p>
                    <p className="font-medium">₹{(subscriber as any).current_subscription.packPrice.toFixed(2)}</p>
                  </div>
                </div>
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={() => {
                    setEditingTransaction(null);
                    setShowCancelDialog(true);
                  }}
                  className="w-full"
                >
                  Cancel Subscription
                </Button>
              </div>

              {(subscriber as any).subscription_history && (subscriber as any).subscription_history.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <History className="h-4 w-4" />
                      <h4 className="font-semibold">Subscription History</h4>
                    </div>
                    <div className="space-y-2">
                      {(subscriber as any).subscription_history
                        .filter((s: any) => s.id !== (subscriber as any).current_subscription?.id)
                        .sort((a: any, b: any) => new Date(b.subscribedAt).getTime() - new Date(a.subscribedAt).getTime())
                        .map((sub: any) => (
                          <div key={sub.id} className="rounded-lg border p-3 text-sm">
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-medium">{sub.packName}</span>
                              <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                                {sub.status === 'expired' ? 'Expired' : 'Cancelled'}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                              <div>
                                <span className="block">Duration</span>
                                <span className="font-medium text-foreground">{sub.duration}m</span>
                              </div>
                              <div>
                                <span className="block">Started</span>
                                <span className="font-medium text-foreground">
                                  {new Date(sub.startDate).toLocaleDateString()}
                                </span>
                              </div>
                              <div>
                                <span className="block">Ended</span>
                                <span className="font-medium text-foreground">
                                  {new Date(sub.endDate).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p>No active package subscription</p>
              <p className="text-sm mt-1">Click "Add Package" to subscribe</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Transaction History</CardTitle>
            <Button onClick={() => setShowAddTransaction(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Transaction
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {sortedTransactions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No transactions yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTransactions.map(transaction => (
                  <TableRow key={transaction.id}>
                    <TableCell className="text-sm">{formatDate(transaction.date)}</TableCell>
                    <TableCell>
                      <Badge variant={transaction.type === 'payment' ? 'default' : 'destructive'}>
                        {transaction.type}
                      </Badge>
                    </TableCell>
                    <TableCell>{transaction.description}</TableCell>
                    <TableCell className={`text-right font-semibold ${
                      transaction.type === 'payment' ? 'text-success' : 'text-destructive'
                    }`}>
                      {transaction.type === 'payment' ? '+' : '-'}₹{transaction.amount.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditTransaction(transaction)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => generateInvoicePDF(transaction, subscriber)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddTransactionDialog
        open={showAddTransaction}
        onOpenChange={setShowAddTransaction}
        onSubmit={onAddTransaction}
        subscriber={subscriber}
      />

      <EditSubscriberDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        subscriber={subscriber}
        onSubmit={onEdit}
      />

      <AddPackageSubscriptionDialog
        open={showAddPackage}
        onOpenChange={setShowAddPackage}
        subscriberId={subscriber.id}
        subscriberName={subscriber.name}
        onSuccess={() => {
          setShowAddPackage(false);
          onReload?.();
        }}
      />

      <EditTransactionDialog
        open={showEditTransaction}
        onOpenChange={setShowEditTransaction}
        transaction={editingTransaction}
        onSubmit={handleUpdateTransaction}
      />

      {(subscriber as any).current_subscription && (
        <CancelSubscriptionDialog
          open={showCancelDialog}
          onOpenChange={setShowCancelDialog}
          subscription={(subscriber as any).current_subscription}
          onConfirm={handleCancelSubscription}
        />
      )}

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Subscriber</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {subscriber.name}? This will also delete all associated transactions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
