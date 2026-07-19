import { useCallback, useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, FileText, Loader2, Router, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

/**
 * CREDENTIALS TAB
 *
 * Three cards, each saves independently:
 *   1. ISP Identity           → subscribers table
 *   2. WiFi Credentials       → open device_assignment_log row (internet device)
 *   3. Router / ONU Details   → stb_inventory (MAC) + open assignment log (internet)
 *
 * All credentials on this tab relate to the internet installation. WiFi is
 * provided by the router/ONU, not by cable equipment — the tab reflects that.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIAL OWNERSHIP TABLE (authoritative — mirrored in BUSINESS_MODEL.md)
 * ---------------------------------------------------------------------------
 *  Field                    | Owner table              | Reason
 *  ------------------------ | ------------------------ | --------------------------------
 *  Assigned Telephone       | subscribers              | ISP identity, persists regardless of device
 *  PPPoE Username           | subscribers              | Account credential, not device-specific
 *  PPPoE Password           | subscribers              | Account credential, not device-specific
 *  WiFi SSID                | device_assignment_log    | Installation-specific, reconfigured on device replacement
 *  WiFi Password            | device_assignment_log    | Installation-specific, reconfigured on device replacement
 *  ONU Username             | device_assignment_log    | Deployment-specific
 *  ONU Password             | device_assignment_log    | Deployment-specific
 *  VLAN ID                  | device_assignment_log    | Network config per installation
 *  MAC Address              | stb_inventory            | Hardware identity, fixed to the physical device
 * ---------------------------------------------------------------------------
 *
 * All sensitive password values are encrypted server-side via pgp_sym_encrypt.
 * The RPC returns already-decrypted values so the client never sees ciphertext.
 * Access is gated by usePermissions().canViewCredentials — this tab is not
 * rendered at all for users without that permission.
 */

interface Props {
  subscriberId: string;
}

interface CredentialPayload {
  identity: {
    assigned_telephone: string | null;
    pppoe_username: string | null;
    pppoe_password: string | null;
  };
  internet: {
    device_id: string;
    serial_number: string;
    mac_address: string | null;
    assignment_id: string | null;
    wifi_ssid: string | null;
    wifi_password: string | null;
    onu_username: string | null;
    onu_password: string | null;
    vlan_id: string | null;
  } | null;
}

const copy = async (value: string | null | undefined, label: string) => {
  if (!value) {
    toast.info(`${label} is empty`);
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error('Copy failed');
  }
};

const CopyBtn = ({ value, label }: { value: string | null | undefined; label: string }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    className="h-9 w-9 shrink-0"
    onClick={() => copy(value, label)}
    aria-label={`Copy ${label}`}
  >
    <Copy className="h-4 w-4" />
  </Button>
);

const TextField = ({
  label, value, onChange, disabled, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string;
}) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-medium">{label}</Label>
    <div className="flex items-center gap-1.5">
      <Input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} />
      <CopyBtn value={value} label={label} />
    </div>
  </div>
);

const PasswordField = ({
  label, value, onChange, disabled, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string;
}) => {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide' : 'Show'}
          disabled={disabled}
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
        <CopyBtn value={value} label={label} />
      </div>
    </div>
  );
};

const MacField = ({
  value, onChange, locked, disabled,
}: {
  value: string; onChange: (v: string) => void; locked: boolean; disabled: boolean;
}) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-medium">MAC Address</Label>
    <div className="flex items-center gap-1.5">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || locked}
        placeholder="AA:BB:CC:DD:EE:FF"
        className="font-mono"
      />
      <CopyBtn value={value} label="MAC Address" />
    </div>
    {locked && (
      <p className="text-[11px] text-muted-foreground">
        MAC is fixed once recorded. Replace the device to change it.
      </p>
    )}
  </div>
);

const NoDeviceNote = () => (
  <div className="rounded-md border border-dashed p-4 text-center">
    <p className="text-sm font-medium">No internet device paired</p>
    <p className="text-xs text-muted-foreground mt-1">
      Pair a router/ONU to configure these credentials.
    </p>
  </div>
);

export function CredentialsTab({ subscriberId }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CredentialPayload | null>(null);

  // Card 1 — ISP Identity
  const [tel, setTel] = useState('');
  const [pppoeUser, setPppoeUser] = useState('');
  const [pppoePass, setPppoePass] = useState('');
  const [savingId, setSavingId] = useState(false);

  // Card 2 — WiFi
  const [ssid, setSsid] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [savingWifi, setSavingWifi] = useState(false);

  // Card 3 — ONU
  const [mac, setMac] = useState('');
  const [onuUser, setOnuUser] = useState('');
  const [onuPass, setOnuPass] = useState('');
  const [vlan, setVlan] = useState('');
  const [savingOnu, setSavingOnu] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: payload, error } = await (supabase as any).rpc(
      'get_subscriber_credentials',
      { p_subscriber_id: subscriberId },
    );
    setLoading(false);
    if (error) {
      toast.error(error.message || 'Failed to load credentials');
      return;
    }
    const p = payload as CredentialPayload;
    setData(p);
    setTel(p.identity.assigned_telephone ?? '');
    setPppoeUser(p.identity.pppoe_username ?? '');
    setPppoePass(p.identity.pppoe_password ?? '');
    setSsid(p.internet?.wifi_ssid ?? '');
    setWifiPass(p.internet?.wifi_password ?? '');
    setMac(p.internet?.mac_address ?? '');
    setOnuUser(p.internet?.onu_username ?? '');
    setOnuPass(p.internet?.onu_password ?? '');
    setVlan(p.internet?.vlan_id ?? '');
  }, [subscriberId]);

  useEffect(() => { load(); }, [load]);

  const saveIdentity = async () => {
    setSavingId(true);
    const { error } = await (supabase as any).rpc('save_isp_identity_credentials', {
      p_subscriber_id: subscriberId,
      p_assigned_telephone: tel,
      p_pppoe_username: pppoeUser,
      p_pppoe_password: pppoePass,
      p_clear_password: !!data?.identity.pppoe_password && pppoePass === '',
    });
    setSavingId(false);
    if (error) { toast.error(error.message || 'Failed to save'); return; }
    toast.success('ISP identity saved');
    load();
  };

  const saveWifi = async () => {
    setSavingWifi(true);
    const { error } = await (supabase as any).rpc('save_wifi_credentials', {
      p_subscriber_id: subscriberId,
      p_wifi_ssid: ssid,
      p_wifi_password: wifiPass,
      p_clear_password: !!data?.internet?.wifi_password && wifiPass === '',
    });
    setSavingWifi(false);
    if (error) { toast.error(error.message || 'Failed to save'); return; }
    toast.success('WiFi credentials saved');
    load();
  };

  const saveOnu = async () => {
    setSavingOnu(true);
    const { error } = await (supabase as any).rpc('save_onu_credentials', {
      p_subscriber_id: subscriberId,
      p_mac_address: mac,
      p_onu_username: onuUser,
      p_onu_password: onuPass,
      p_vlan_id: vlan,
      p_clear_password: !!data?.internet?.onu_password && onuPass === '',
    });
    setSavingOnu(false);
    if (error) { toast.error(error.message || 'Failed to save'); return; }
    toast.success('ONU credentials saved');
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const internetPaired = !!data?.internet;
  const macLocked = internetPaired && !!(data?.internet?.mac_address ?? '').trim();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Card 1 — ISP Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" /> ISP Identity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TextField label="Assigned Telephone" value={tel} onChange={setTel} placeholder="e.g. 080-XXXX-XXXX" />
          <TextField label="PPPoE Username" value={pppoeUser} onChange={setPppoeUser} placeholder="user@isp" />
          <PasswordField label="PPPoE Password" value={pppoePass} onChange={setPppoePass} placeholder="••••••••" />
          <div className="flex justify-end">
            <Button size="sm" onClick={saveIdentity} disabled={savingId}>
              {savingId ? 'Saving…' : 'Save ISP Identity'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Card 2 — WiFi Credentials (internet device) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wifi className="h-4 w-4" /> WiFi Credentials
            {internetPaired && (
              <Badge variant="outline" className="ml-auto font-mono text-[10px]">
                {data!.internet!.serial_number}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!internetPaired ? (
            <NoDeviceNote />
          ) : (
            <>
              <TextField label="Network Name (SSID)" value={ssid} onChange={setSsid} placeholder="e.g. MyHome-5G" />
              <PasswordField label="WiFi Password" value={wifiPass} onChange={setWifiPass} placeholder="••••••••" />
              <div className="flex justify-end">
                <Button size="sm" onClick={saveWifi} disabled={savingWifi}>
                  {savingWifi ? 'Saving…' : 'Save WiFi'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Card 3 — Router / ONU (internet device) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Router className="h-4 w-4" /> Router / ONU Details
            {internetPaired && (
              <Badge variant="outline" className="ml-auto font-mono text-[10px]">
                {data!.internet!.serial_number}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!internetPaired ? (
            <NoDeviceNote />
          ) : (
            <>
              <MacField value={mac} onChange={setMac} locked={macLocked} disabled={false} />
              <TextField label="ONU Username" value={onuUser} onChange={setOnuUser} />
              <PasswordField label="ONU Password" value={onuPass} onChange={setOnuPass} placeholder="••••••••" />
              <TextField label="VLAN ID" value={vlan} onChange={setVlan} placeholder="e.g. 100" />
              <div className="flex justify-end">
                <Button size="sm" onClick={saveOnu} disabled={savingOnu}>
                  {savingOnu ? 'Saving…' : 'Save Router / ONU'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
