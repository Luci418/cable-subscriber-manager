import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { friendlyDbError } from '@/lib/dbErrors';
import { useAuth } from '@/hooks/useAuth';
import type { Transaction } from '@/lib/storage';

interface Note {
  id: string;
  note: string;
  author_id: string;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: Transaction | null;
}

/**
 * Append-only notes for a ledger row. The transaction itself is immutable;
 * notes let operators add context (corrections, clarifications, links to
 * paperwork) without ever rewriting history.
 */
export const TransactionNotesDialog = ({ open, onOpenChange, transaction }: Props) => {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !transaction) return;
    setDraft('');
    setLoading(true);
    (supabase as any)
      .from('transaction_notes')
      .select('id, note, author_id, created_at')
      .eq('transaction_id', transaction.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }: any) => {
        if (error) toast.error('Failed to load notes');
        else setNotes(data || []);
        setLoading(false);
      });
  }, [open, transaction]);

  if (!transaction) return null;

  const handleAdd = async () => {
    const trimmed = draft.trim();
    if (!trimmed) { toast.error('Note cannot be empty'); return; }
    if (!user) return;
    setSubmitting(true);
    const { data, error } = await (supabase as any)
      .from('transaction_notes')
      .insert({
        transaction_id: transaction.id,
        user_id: user.id,
        author_id: user.id,
        note: trimmed,
      })
      .select('id, note, author_id, created_at')
      .single();
    setSubmitting(false);
    if (error) { toast.error(friendlyDbError(error, 'Failed to add note')); return; }
    setNotes(n => [data, ...n]);
    setDraft('');
    toast.success('Note added');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transaction Notes</DialogTitle>
          <DialogDescription>
            Notes are append-only. Once saved, a note cannot be edited or deleted —
            add a new one to correct or extend it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add context for this transaction…"
            rows={3}
          />
          <div className="flex justify-end">
            <Button onClick={handleAdd} disabled={submitting || !draft.trim()} size="sm">
              {submitting ? 'Adding…' : 'Add Note'}
            </Button>
          </div>

          <div className="border-t pt-3 max-h-72 overflow-y-auto space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            ) : notes.map(n => (
              <div key={n.id} className="rounded border bg-muted/30 p-2 text-sm">
                <p className="whitespace-pre-wrap">{n.note}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
