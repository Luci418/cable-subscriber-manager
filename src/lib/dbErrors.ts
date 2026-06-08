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
    if (text.includes("packs_prepaid_validity")) return "Prepaid packs must have a validity period greater than 0 days.";
    if (text.includes("stb_inventory_device_service_match")) return "Device type and service type must match (STB ↔ cable, ONU/Router ↔ internet).";
    if (text.includes("complaints_description_nonblank")) return "Description cannot be blank.";
    if (text.includes("complaints_resolved_has_date")) return "A resolved complaint must have a resolution date.";
    if (text.includes("complaints_category_check")) return "Invalid complaint category.";
    if (text.includes("complaints_priority_check")) return "Invalid priority level.";
    // Immutable ledger guards raised by triggers
    if (text.includes("Transactions cannot be deleted"))
      return "This subscriber has financial transactions on the immutable ledger, which cannot be deleted. Historical financial records must be preserved.";
    if (text.includes("Transaction rows are immutable"))
      return "Transactions are final once posted. Use Void + a replacement entry, or add a note for additional context.";
    if (text.includes("Transaction notes are append-only"))
      return "Notes cannot be edited or deleted. Add a new note instead.";
    if (text.includes("Invalid transaction status transition"))
      return "Transactions can only be voided through the Void action.";
    if (text.includes("subscription_charge") || text.includes("subscription_refund"))
      return "This charge was created by a subscription action. Undo it by cancelling or refunding the subscription instead of voiding the ledger row.";
    return "Value failed a validation check.";
  }

  // Foreign key violation
  if (code === "23503") return "Cannot complete: related record is missing or in use.";

  // Not null
  if (code === "23502") return "A required field is missing.";

  return fallback;
};
