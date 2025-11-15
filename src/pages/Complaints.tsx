import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, AlertCircle, Clock, CheckCircle2, Search, Plus } from 'lucide-react';
import { getComplaints, addComplaint, updateComplaint, deleteComplaint, getSubscribers, Complaint } from '@/lib/storage';
import { toast } from 'sonner';

interface ComplaintsProps {
  onBack: () => void;
}

export const Complaints = ({ onBack }: ComplaintsProps) => {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [filteredComplaints, setFilteredComplaints] = useState<Complaint[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);

  useEffect(() => {
    loadComplaints();
  }, []);

  useEffect(() => {
    filterComplaints();
  }, [complaints, searchTerm, statusFilter]);

  const loadComplaints = () => {
    setComplaints(getComplaints());
  };

  const filterComplaints = () => {
    let filtered = complaints;

    if (statusFilter !== 'all') {
      filtered = filtered.filter(c => c.status === statusFilter);
    }

    if (searchTerm) {
      filtered = filtered.filter(c =>
        c.subscriberName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.id.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setFilteredComplaints(filtered);
  };

  const handleAddComplaint = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const subscriberId = formData.get('subscriberId') as string;
    const subscriber = getSubscribers().find(s => s.id === subscriberId);
    
    if (!subscriber) {
      toast.error('Subscriber not found');
      return;
    }

    addComplaint({
      subscriberId,
      subscriberName: subscriber.name,
      category: formData.get('category') as any,
      priority: formData.get('priority') as any,
      description: formData.get('description') as string,
      status: 'pending',
    });

    toast.success('Complaint registered successfully');
    setShowAddDialog(false);
    loadComplaints();
    e.currentTarget.reset();
  };

  const handleUpdateStatus = (id: string, status: Complaint['status'], resolutionNotes?: string) => {
    updateComplaint(id, { status, resolutionNotes });
    toast.success('Complaint updated successfully');
    loadComplaints();
    if (selectedComplaint?.id === id) {
      setSelectedComplaint(getComplaints().find(c => c.id === id) || null);
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
    pending: complaints.filter(c => c.status === 'pending').length,
    inProgress: complaints.filter(c => c.status === 'in-progress').length,
    resolved: complaints.filter(c => c.status === 'resolved').length,
  };

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
                <Label htmlFor="subscriberId">Subscriber ID</Label>
                <Input id="subscriberId" name="subscriberId" required placeholder="SUB-000001" />
              </div>
              <div>
                <Label htmlFor="category">Category</Label>
                <Select name="category" required>
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
                <Select name="priority" required>
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
                <Textarea id="description" name="description" required placeholder="Describe the issue..." rows={4} />
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
                  placeholder="Search by ID, name, or description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="w-48">
              <Label htmlFor="status">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
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
        {filteredComplaints.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No complaints found</p>
            </CardContent>
          </Card>
        ) : (
          filteredComplaints.map((complaint) => (
            <Card key={complaint.id} className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => {
                setSelectedComplaint(complaint);
                setShowDetailDialog(true);
              }}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{complaint.subscriberName}</h3>
                      <Badge variant={getPriorityColor(complaint.priority) as any}>
                        {complaint.priority}
                      </Badge>
                      <Badge variant={getStatusColor(complaint.status) as any} className="gap-1">
                        {getStatusIcon(complaint.status)}
                        {complaint.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">ID: {complaint.id} • Subscriber: {complaint.subscriberId}</p>
                    <p className="text-sm"><strong>Category:</strong> {complaint.category}</p>
                    <p className="text-sm">{complaint.description}</p>
                    <p className="text-xs text-muted-foreground">Created: {new Date(complaint.createdAt).toLocaleString('en-IN')}</p>
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
                  <p className="font-medium">{selectedComplaint.subscriberName}</p>
                  <p className="text-sm text-muted-foreground">{selectedComplaint.subscriberId}</p>
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
                  <p className="font-medium">{new Date(selectedComplaint.createdAt).toLocaleString('en-IN')}</p>
                </div>
              </div>
              
              <div>
                <Label className="text-muted-foreground">Description</Label>
                <p className="mt-1 text-sm">{selectedComplaint.description}</p>
              </div>

              {selectedComplaint.resolutionNotes && (
                <div>
                  <Label className="text-muted-foreground">Resolution Notes</Label>
                  <p className="mt-1 text-sm">{selectedComplaint.resolutionNotes}</p>
                </div>
              )}

              {selectedComplaint.resolvedAt && (
                <div>
                  <Label className="text-muted-foreground">Resolved At</Label>
                  <p className="font-medium">{new Date(selectedComplaint.resolvedAt).toLocaleString('en-IN')}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Update Status</Label>
                <div className="flex gap-2">
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
                        const notes = prompt('Enter resolution notes:');
                        if (notes) {
                          handleUpdateStatus(selectedComplaint.id, 'resolved', notes);
                        }
                      }}
                    >
                      Mark Resolved
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this complaint?')) {
                        deleteComplaint(selectedComplaint.id);
                        toast.success('Complaint deleted');
                        setShowDetailDialog(false);
                        loadComplaints();
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
