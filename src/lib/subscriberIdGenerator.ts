import { supabase } from "@/integrations/supabase/client";

/**
 * Generates a subscriber ID in the format: REGION-001, REGION-002, etc.
 * Each region maintains its own counter for sequential numbering.
 * 
 * @param regionName - The region/area name (e.g., "North Zone", "Downtown")
 * @param userId - The user ID to scope the counter
 * @returns Promise<string> - The generated subscriber ID (e.g., "NORTH-001")
 */
export async function generateSubscriberId(regionName: string, userId: string): Promise<string> {
  // Create a short prefix from region name (first word, uppercase, max 10 chars)
  const prefix = createRegionPrefix(regionName);
  
  // Get the next sequence number for this region
  const nextNumber = await getNextSequenceNumber(prefix, userId);
  
  // Format as PREFIX-001, PREFIX-002, etc.
  return `${prefix}-${nextNumber.toString().padStart(3, '0')}`;
}

/**
 * Creates a short prefix from a region name.
 * Examples:
 * - "North Zone" -> "NORTH"
 * - "Downtown Area" -> "DOWNTOWN"
 * - "East-Side" -> "EASTSIDE"
 * 
 * @param regionName - The full region name
 * @returns string - The prefix (uppercase, alphanumeric only, max 10 chars)
 */
export function createRegionPrefix(regionName: string): string {
  if (!regionName || regionName.trim() === '') {
    return 'DEFAULT';
  }
  
  // Take the first word, remove non-alphanumeric chars, uppercase, max 10 chars
  const firstWord = regionName.split(/[\s-_]+/)[0];
  const cleaned = firstWord.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return cleaned.slice(0, 10) || 'DEFAULT';
}

/**
 * Gets the next sequence number for a given region prefix.
 * Queries existing subscribers to find the highest number used.
 * 
 * @param prefix - The region prefix (e.g., "NORTH")
 * @param userId - The user ID to scope the query
 * @returns Promise<number> - The next available sequence number
 */
async function getNextSequenceNumber(prefix: string, userId: string): Promise<number> {
  // Query subscribers with IDs starting with this prefix
  const { data, error } = await supabase
    .from('subscribers')
    .select('subscriber_id')
    .eq('user_id', userId)
    .like('subscriber_id', `${prefix}-%`);
  
  if (error) {
    console.error('Error fetching subscriber IDs:', error);
    // Fallback to timestamp-based suffix
    return Date.now() % 10000;
  }
  
  if (!data || data.length === 0) {
    return 1;
  }
  
  // Find the highest existing number
  let maxNumber = 0;
  for (const row of data) {
    const match = row.subscriber_id?.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNumber) {
        maxNumber = num;
      }
    }
  }
  
  return maxNumber + 1;
}

/**
 * Validates if a subscriber ID follows the expected format.
 * 
 * @param subscriberId - The ID to validate
 * @returns boolean - True if valid format
 */
export function isValidSubscriberId(subscriberId: string): boolean {
  // Format: PREFIX-NNN where PREFIX is 1-10 uppercase letters/numbers
  // and NNN is 1 or more digits
  return /^[A-Z0-9]{1,10}-\d+$/.test(subscriberId);
}
