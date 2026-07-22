import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle }    from '@/components/ui/card';
import { Button }        from '@/components/ui/button';
import { Input }         from '@/components/ui/input';
import { Label }         from '@/components/ui/label';
import { Textarea }      from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge }         from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ArrowLeft, AlertCircle, Clock, CheckCircle2, Search, Plus, ExternalLink } from 'lucide-react';
import { useAuth }       from '@/hooks/useAuth';
import { useComplaints }  from '@/hooks/useComplaints';
import { toast }          from 'sonner';
import { EmptyState, SubscriberCombobox, type SubscriberComboboxValue } from '@/components/ui-ext';


interface ComplaintsProps {
  onBack: () => void;
}

export const Complaints = ({ onBack }: ComplaintsProps) => {
  const { user } = useAuth();
  const { complaints, loading, error, addComplaint, updateComplaint, deleteComplaint, reloadComplaints } = useComplaints(user?.id);

  // URL-persisted filters — pressing back from a detail view or sharing a
  // link keeps the operator in the same slice they were investigating.
  const [searchParams, setSearchParams] = useSearchParams();
  const searchTerm = searchParams.get('q') ?? '';
  const statusFilter = searchParams.get('status') ?? 'all';
  const patchParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === 'all') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true });
  };

  const [selectedComplaint, setSelectedComplaint] = useState<(typeof complaints)[0] | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [pickedSubscriber, setPickedSubscriber] = useState<SubscriberComboboxValue | null>(null);
  const [resolveTarget, setResolveTarget] = useState<(typeof complaints)[0] | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');
  const [resolveSubmitting, setResolveSubmitting] = useState(false);

  const filteredComplaints = useMemo(() => {
    let filtered = [...complaints];
    if (statusFilter !== 'all') {
      filtered = filtered.filter((c) => c.status === statusFilter);
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          (c.subscriber_name || '').toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q),
      );
    }
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return filtered;
  }, [complaints, searchTerm, statusFilter]);


  const handleAddComplaint = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    if (!pickedSubscriber) {
      toast.error('Please select a subscriber');
      return;
    }

    const category = formData.get('category') as string;
    const priority = formData.get('priority') as string;
    const description = formData.get('description') as string;

    if (!description.trim()) {
      toast.error('Description is required');
      return;
    }

    const created = await addComplaint({
      subscriber_id: pickedSubscriber.id,
      description,
      category,
      priority,
    });

    if (created) {
      toast.success('Complaint registered successfully');
      setShowAddDialog(false);
      setPickedSubscriber(null);
      e.currentTarget.reset();
    }
  };

  const handleUpdateStatus = async (
    id: string,
    status: 'pending' | 'in-progress' | 'resolved',
    resolutionNotes?: string
  ) => {
    const updates: Parameters<typeof updateComplaint>[1] = { status };
    if (status === 'resolved') {
      updates.resolved_date = new Date().toISOString();
      updates.resolution_notes = resolutionNotes || null;
    }

    const updated = await updateComplaint(id, updates);
    if (updated) {
      toast.success('Complaint updated successfully');
      if (selectedComplaint?.id === id) setSelectedComplaint(updated);
    }
  };

  const handleDelete = async (id: string) => {
    const { confirm } = await import('@/lib/confirm');
    if (await confirm({
      title: 'Delete complaint?',
      description: 'This will remove the complaint permanently. This cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    })) {
      const ok = await deleteComplaint(id);
      if (ok) {
        toast.success('Complaint deleted');
        setShowDetailDialog(false);
      }
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'destructive';
      case 'medium': return 'warning';
      case 'low': return 'secondary';
      default: return 'default';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'resolved': return 'success';
      case 'in-progress': return 'warning';
      case 'pending': return 'secondary';
      default: return 'default';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'resolved': return <CheckCircle2 className="h-4 w-4" />;
      case 'in-progress': return <Clock className="h-4 w-4" />;
      case 'pending': return <AlertCircle className="h-4 w-4" />;
      default: return null;
    }
  };

  const stats = {
    total: complaints.length,
    pending: complaints.filter((c) => c.status === 'pending').length,
    inProgress: complaints.filter((c) => c.status === 'in-progress').length,
    resolved: complaints.filter((c) => c.status === 'resolved').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading complaints…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" onClick={onBack} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Subscribers
          </Button>
          <h1 className="text-3xl font-bold text-foreground">Complaints & Feedback</h1>
          <p className="text-muted-foreground">Manage customer complaints and resolutions</p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Complaint
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Register New Complaint</DialogTitle>
              <DialogDescription>Submit a customer complaint or feedback</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddComplaint} className="space-y-4">
              <div>
                <Label>Subscriber</Label>
                <SubscriberCombobox
                  value={pickedSubscriber}
                  onChange={setPickedSubscriber}
                  placeholder="Search a subscriber…"
                />
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <Select name="category" required defaultValue="technical">
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="technical">Technical Issue</SelectItem>
                    <SelectItem value="billing">Billing Issue</SelectItem>
                    <SelectItem value="service">Service Quality</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="priority">Priority</Label>
                <Select name="priority" required defaultValue="medium">
                  <SelectTrigger>
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  name="description"
                  required
                  placeholder="Describe the issue…"
                  rows={4}
                />
              </div>
              <Button type="submit" className="w-full">Submit Complaint</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Complaints</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-secondary">{stats.pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{stats.inProgress}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Resolved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{stats.resolved}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filter Complaints</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <Label htmlFor="search">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Search by ID, name, or description…"
                  value={searchTerm}
                  onChange={(e) => patchParams({ q: e.target.value })}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="w-48">
              <Label htmlFor="status">Status</Label>
              <Select value={statusFilter} onValueChange={(v) => patchParams({ status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="in-progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>


      {/* Complaints List */}
      <div className="space-y-4">
        {error ? (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                variant="error"
                title="Couldn't load complaints"
                description={error}
                onRetry={reloadComplaints}
              />
            </CardContent>
          </Card>
        ) : filteredComplaints.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No complaints found</p>
            </CardContent>
          </Card>
        ) : (
          filteredComplaints.map((complaint) => (
            <Card
              key={complaint.id}
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => {
                setSelectedComplaint(complaint);
                setShowDetailDialog(true);
              }}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{complaint.subscriber_name || 'Unknown'}</h3>
                      {complaint.subscriber_id_text && (
                        <Link
                          to={`/customers/${complaint.subscriber_id_text}/overview`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          title="Open customer profile"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {complaint.subscriber_id_text}
                        </Link>
                      )}
                      <Badge variant={getPriorityColor(complaint.priority) as any}>
                        {complaint.priority}
                      </Badge>
                      <Badge variant={getStatusColor(complaint.status) as any} className="gap-1">
                        {getStatusIcon(complaint.status)}
                        {complaint.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      ID: {complaint.id}
                    </p>
                    <p className="text-sm">
                      <strong>Category:</strong> {complaint.category}
                    </p>
                    <p className="text-sm">{complaint.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Created: {new Date(complaint.created_at).toLocaleString('en-IN')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>


      {/* Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Complaint Details</DialogTitle>
          </DialogHeader>
          {selectedComplaint && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Complaint ID</Label>
                  <p className="font-medium">{selectedComplaint.id}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge variant={getStatusColor(selectedComplaint.status) as any} className="gap-1">
                      {getStatusIcon(selectedComplaint.status)}
                      {selectedComplaint.status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Subscriber</Label>
                  <p className="font-medium">{selectedComplaint.subscriber_name || 'Unknown'}</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedComplaint.subscriber_id_text || selectedComplaint.subscriber_id}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Priority</Label>
                  <div className="mt-1">
                    <Badge variant={getPriorityColor(selectedComplaint.priority) as any}>
                      {selectedComplaint.priority}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Category</Label>
                  <p className="font-medium capitalize">{selectedComplaint.category}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Created At</Label>
                  <p className="font-medium">
                    {new Date(selectedComplaint.created_at).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>

              <div>
                <Label className="text-muted-foreground">Description</Label>
                <p className="mt-1 text-sm">{selectedComplaint.description}</p>
              </div>

              {selectedComplaint.resolution_notes && (
                <div>
                  <Label className="text-muted-foreground">Resolution Notes</Label>
                  <p className="mt-1 text-sm">{selectedComplaint.resolution_notes}</p>
                </div>
              )}

              {selectedComplaint.resolved_date && (
                <div>
                  <Label className="text-muted-foreground">Resolved At</Label>
                  <p className="font-medium">
                    {new Date(selectedComplaint.resolved_date).toLocaleString('en-IN')}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Update Status</Label>
                <div className="flex gap-2 flex-wrap">
                  {selectedComplaint.status !== 'in-progress' && (
                    <Button
                      variant="outline"
                      onClick={() => handleUpdateStatus(selectedComplaint.id, 'in-progress')}
                    >
                      Mark In Progress
                    </Button>
                  )}
                  {selectedComplaint.status !== 'resolved' && (
                    <Button
                      variant="default"
                      onClick={() => {
                        setResolveNotes('');
                        setResolveTarget(selectedComplaint);
                      }}
                    >
                      Mark Resolved
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    onClick={() => handleDelete(selectedComplaint.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!resolveTarget}
        onOpenChange={(o) => { if (!o && !resolveSubmitting) setResolveTarget(null); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark complaint resolved</DialogTitle>
            <DialogDescription>
              Add optional notes describing how this complaint was resolved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Resolution notes (optional)</Label>
            <Textarea
              value={resolveNotes}
              onChange={(e) => setResolveNotes(e.target.value)}
              placeholder="e.g. signal restored after amplifier reset"
              rows={4}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveTarget(null)} disabled={resolveSubmitting}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!resolveTarget) return;
                setResolveSubmitting(true);
                try {
                  await handleUpdateStatus(resolveTarget.id, 'resolved', resolveNotes);
                  setResolveTarget(null);
                } finally {
                  setResolveSubmitting(false);
                }
              }}
              disabled={resolveSubmitting}
            >
              {resolveSubmitting ? 'Saving…' : 'Mark resolved'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
