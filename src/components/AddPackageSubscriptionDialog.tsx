import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getPacks, addSubscriptionToSubscriber, Pack } from '@/lib/storage';
import { toast } from 'sonner';
import { Calendar, Clock } from 'lucide-react';

interface AddPackageSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriberId: string;
  subscriberName: string;
  onSuccess: () => void;
}

export const AddPackageSubscriptionDialog = ({
  open,
  onOpenChange,
  subscriberId,
  subscriberName,
  onSuccess
}: AddPackageSubscriptionDialogProps) => {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [selectedPack, setSelectedPack] = useState<string>('');
  const [duration, setDuration] = useState<number>(1);
  
  const startDate = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + duration);

  useEffect(() => {
    if (open) {
      setPacks(getPacks());
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedPack) {
      toast.error('Please select a package');
      return;
    }

    addSubscriptionToSubscriber(subscriberId, selectedPack, duration);
    toast.success('Package subscription added successfully');
    setSelectedPack('');
    setDuration(1);
    onOpenChange(false);
    onSuccess();
  };

  const selectedPackData = packs.find(p => p.name === selectedPack);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Package Subscription</DialogTitle>
          <p className="text-sm text-muted-foreground">for {subscriberName}</p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="package">Select Package</Label>
            <Select value={selectedPack} onValueChange={setSelectedPack}>
              <SelectTrigger id="package">
                <SelectValue placeholder="Choose a package" />
              </SelectTrigger>
              <SelectContent>
                {packs.map((pack) => (
                  <SelectItem key={pack.id} value={pack.name}>
                    {pack.name} - ₹{pack.price.toFixed(2)}/month
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="duration">Duration (months)</Label>
            <Select value={duration.toString()} onValueChange={(val) => setDuration(parseInt(val))}>
              <SelectTrigger id="duration">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 Month</SelectItem>
                <SelectItem value="3">3 Months</SelectItem>
                <SelectItem value="6">6 Months</SelectItem>
                <SelectItem value="12">12 Months</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectedPackData && (
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4" />
                <span className="font-medium">Start Date:</span>
                <span>{startDate.toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4" />
                <span className="font-medium">Expiry Date:</span>
                <span>{endDate.toLocaleDateString()}</span>
              </div>
              <div className="pt-2 border-t">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Total Amount:</span>
                  <span className="text-lg font-bold">
                    ₹{(selectedPackData.price * duration).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              Add Subscription
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
