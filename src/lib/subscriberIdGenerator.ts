import { supabase } from "@/integrations/supabase/client";

/**
 * Generates a subscriber ID in the format: REGION-001, REGION-002, etc.
 *
 * Delegates to the SECURITY DEFINER RPC `generate_subscriber_id`, which holds
 * a per-(user, prefix) advisory lock so concurrent inserts by multiple staff
 * members can never collide on the same number.
 *
 * @param regionName - The region/area name (e.g., "North Zone").
 * @param _userId - Kept for backward compatibility; auth.uid() is used server-side.
 */
export async function generateSubscriberId(regionName: string, _userId?: string): Promise<string> {
  const { data, error } = await supabase.rpc('generate_subscriber_id', {
    p_region_name: regionName ?? '',
  });

  if (error || !data) {
    console.error('generate_subscriber_id RPC failed; falling back to timestamp', error);
    const prefix = createRegionPrefix(regionName);
    return `${prefix}-${(Date.now() % 10000).toString().padStart(3, '0')}`;
  }

  return data as string;
}

/**
 * Creates a short prefix from a region name. Kept in sync with the server-side
 * logic in `generate_subscriber_id`.
 */
export function createRegionPrefix(regionName: string): string {
  if (!regionName || regionName.trim() === '') {
    return 'DEFAULT';
  }
  const firstWord = regionName.split(/[\s\-_]+/)[0];
  const cleaned = firstWord.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return cleaned.slice(0, 10) || 'DEFAULT';
}

/**
 * Validates if a subscriber ID follows the expected format.
 */
export function isValidSubscriberId(subscriberId: string): boolean {
  return /^[A-Z0-9]{1,10}-\d+$/.test(subscriberId);
}
