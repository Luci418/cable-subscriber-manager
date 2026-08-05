/**
 * Phase 5 — DB reads that feed the pure Phase 3/4 engines.
 *
 * READ-ONLY by construction. Nothing in this module writes: the review screen
 * must be able to run a full dry-run and be cancelled with zero DB writes.
 */

import { supabase } from "@/integrations/supabase/client";
import { getSyncPolicy } from "./syncPolicy";
import { normKey, normMobile, normPackKey, type ResolutionContext } from "./resolution";
import type { ProviderReportRow, ProviderReportType } from "./hathway/types";

export interface PackInfo {
  id: string;
  name: string;
  price: number;
}

export interface ReviewContext extends ResolutionContext {
  /** `packs.id` → display info, for the editable charge amount prefill. */
  packById: Record<string, PackInfo>;
  /** Subscriber id → display label for the identity section. */
  subscriberLabelById: Record<string, string>;
  /**
   * Subscriber id → every normalised device key (vc_id and serial) currently
   * paired to them locally. Used by the review screen to flag a report row
   * that matched on account number but names hardware we have paired
   * elsewhere (or not at all). Display-only — never a blocker.
   */
  deviceKeysBySubscriber: Record<string, string[]>;
  /** The committed baseline snapshot, or null when there is none. */
  baseline: ProviderReportRow[] | null;
  baselineRunId: string | null;
  baselineImportedAt: string | null;
}


export async function loadReviewContext(
  providerId: string,
  reportType: ProviderReportType,
): Promise<ReviewContext> {
  const [providerRes, devicesRes, subsRes, mappingsRes, packsRes, baselineRes] =
    await Promise.all([
      supabase.from("providers").select("id, name, sync_policy").eq("id", providerId).maybeSingle(),
      supabase.from("stb_inventory").select("vc_id, serial_number, subscriber_id"),
      supabase.from("subscribers").select("id, name, subscriber_id, mobile, hathway_customer_nbr"),
      supabase
        .from("provider_pack_mappings")
        .select("provider_plan_key, pack_id")
        .eq("provider_id", providerId),
      supabase.from("packs").select("id, name, price"),
      supabase
        .from("provider_import_runs")
        .select("id, snapshot_data, imported_at")
        .eq("provider_id", providerId)
        .eq("report_type", reportType)
        .eq("status", "committed")
        .order("imported_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const firstError =
    providerRes.error ||
    devicesRes.error ||
    subsRes.error ||
    mappingsRes.error ||
    packsRes.error ||
    baselineRes.error;
  if (firstError) throw firstError;

  const subscriberByVcId: Record<string, string> = {};
  const subscriberBySerial: Record<string, string> = {};
  for (const d of devicesRes.data ?? []) {
    if (!d.subscriber_id) continue;
    const vc = normKey(d.vc_id);
    if (vc) subscriberByVcId[vc] = d.subscriber_id;
    const sn = normKey(d.serial_number);
    if (sn) subscriberBySerial[sn] = d.subscriber_id;
  }

  const subscriberByAccountNumber: Record<string, string> = {};
  const subscribersByMobile: Record<string, string[]> = {};
  const subscriberLabelById: Record<string, string> = {};
  for (const s of subsRes.data ?? []) {
    subscriberLabelById[s.id] = `${s.name} · ${s.subscriber_id}`;
    const acc = normKey(s.hathway_customer_nbr);
    if (acc) subscriberByAccountNumber[acc] = s.id;
    const mob = normMobile(s.mobile);
    if (mob) (subscribersByMobile[mob] ??= []).push(s.id);
  }

  const packIdByProviderKey: Record<string, string> = {};
  for (const m of mappingsRes.data ?? []) {
    const key = normPackKey(m.provider_plan_key);
    if (key && m.pack_id) packIdByProviderKey[key] = m.pack_id;
  }

  const packById: Record<string, PackInfo> = {};
  for (const p of packsRes.data ?? []) {
    packById[p.id] = { id: p.id, name: p.name, price: Number(p.price) };
  }

  const baselineRow = baselineRes.data as
    | { id: string; snapshot_data: unknown; imported_at: string }
    | null;

  return {
    subscriberByVcId,
    subscriberBySerial,
    subscriberByAccountNumber,
    subscribersByMobile,
    packIdByProviderKey,
    policy: getSyncPolicy(providerRes.data),
    packById,
    subscriberLabelById,
    baseline: Array.isArray(baselineRow?.snapshot_data)
      ? (baselineRow!.snapshot_data as ProviderReportRow[])
      : null,
    baselineRunId: baselineRow?.id ?? null,
    baselineImportedAt: baselineRow?.imported_at ?? null,
  };
}
