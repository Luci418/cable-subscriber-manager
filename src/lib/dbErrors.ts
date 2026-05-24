/**
 * Translate Postgres / PostgREST errors into messages a non-technical user can read.
 * Keep mappings in sync with constraint/index names in supabase/migrations.
 */
export const friendlyDbError = (error: any, fallback: string): string => {
  if (!error) return fallback;
  const code = error.code as string | undefined;
  const msg: string = error.message || "";
  const detail: string = error.details || "";
  const text = `${msg} ${detail}`;

  // Unique violation
  if (code === "23505") {
    if (text.includes("uq_subscribers_user_stb")) return "That STB is already assigned to another subscriber.";
    if (text.includes("uq_subscribers_user_mobile")) return "A subscriber with that mobile number already exists.";
    if (text.includes("uq_subscribers_user_subscriberid")) return "Duplicate subscriber ID.";
    if (text.includes("uq_stb_inventory_user_serial")) return "A device with that serial number already exists.";
    if (text.includes("uq_stb_inventory_sub_service")) return "That subscriber already has a device for this service.";
    if (text.includes("uq_packs_user_name_service")) return "A pack with that name already exists for this service.";
    if (text.includes("uq_regions_user_name")) return "A region with that name already exists.";
    return "Duplicate value — this record already exists.";
  }

  // Check constraint
  if (code === "23514") {
    if (text.includes("subscribers_mobile_format")) return "Mobile must be 7–15 digits, numbers only.";
    if (text.includes("subscribers_name_nonblank")) return "Name cannot be blank.";
    if (text.includes("transactions_amount_nonneg")) return "Amount cannot be negative.";
    if (text.includes("packs_price_nonneg")) return "Price cannot be negative.";
    return "Value failed a validation check.";
  }

  // Foreign key violation
  if (code === "23503") return "Cannot complete: related record is missing or in use.";

  // Not null
  if (code === "23502") return "A required field is missing.";

  return fallback;
};
