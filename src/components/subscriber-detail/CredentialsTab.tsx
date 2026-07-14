import { FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * CREDENTIALS TAB — placeholder. The technician credentials workstream
 * (encrypted BSNL PPPoE, ONU admin, telephone number, etc.) ships as an
 * independent phase. Isolating it in its own file (Batch 4 refactor) so
 * that workstream can build here without touching the orchestrator.
 */
export function CredentialsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" /> Technician Credentials
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-dashed p-8 text-center">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground/60 mb-3" />
          <p className="text-sm font-medium">
            Technician credentials will appear here once configured.
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            PPPoE username, ONU admin, telephone number and other subscriber-scoped
            credentials for field engineers ship in a later phase.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
