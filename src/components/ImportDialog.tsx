import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { importFromCSV } from '@/lib/csv';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export const ImportDialog = ({ open, onOpenChange, onSuccess }: ImportDialogProps) => {
  const [subscriberFile, setSubscriberFile] = useState<File | null>(null);
  const [transactionFile, setTransactionFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    if (!subscriberFile || !transactionFile) {
      toast.error('Please select both CSV files');
      return;
    }

    setLoading(true);
    try {
      const result = await importFromCSV(subscriberFile, transactionFile);
      toast.success(`Imported ${result.subscribers} subscribers and ${result.transactions} transactions`);
      onSuccess();
      onOpenChange(false);
      setSubscriberFile(null);
      setTransactionFile(null);
    } catch (error) {
      toast.error('Failed to import data. Please check your CSV files.');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Data from CSV</DialogTitle>
          <DialogDescription>
            Select both subscribers.csv and transactions.csv files to import your data.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subscribers">Subscribers CSV</Label>
            <Input
              id="subscribers"
              type="file"
              accept=".csv"
              onChange={(e) => setSubscriberFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="transactions">Transactions CSV</Label>
            <Input
              id="transactions"
              type="file"
              accept=".csv"
              onChange={(e) => setTransactionFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={loading || !subscriberFile || !transactionFile}
              className="flex-1"
            >
              <Upload className="h-4 w-4 mr-2" />
              {loading ? 'Importing...' : 'Import Data'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
