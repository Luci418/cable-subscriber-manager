# Role Design

Companion to [PERMISSION_MATRIX.md](./PERMISSION_MATRIX.md) — that document
tells you *who can do what*; this one explains *why the roles exist* and
where the boundary lines are drawn.

## Design principles

1. **Roles model job function, not seniority.** A technician is not a
   junior admin — they have a fundamentally different job (touching hardware
   in the field, no financial responsibility).
2. **Least privilege by default.** New signups land with no role and see
   nothing they cannot act on. An owner explicitly grants access.
3. **Database is the boundary.** The React `usePermissions()` hook mirrors
   the SQL helpers for UX only. Every gated action re-checks the role
   server-side and returns SQLSTATE `42501` on denial.
4. **Roles are additive.** A single user may hold multiple roles (e.g. an
   owner who also acts as their own collection agent on Sundays). Any grant
   is sufficient — checks are `OR` across roles.

## The four roles

### Owner

**Who they are.** The business proprietor. Usually one person for a
regional cable/ISP operator, occasionally two (e.g. husband-and-wife team,
or founder + finance partner).

**Why the role exists.** Someone must be able to change the operating
configuration of the business (company name, receipt template, enabled
services, backdating window) and — critically — grant access to other
staff. Concentrating those two responsibilities in a single role makes it
obvious who is accountable when access drifts.

**Can do.** Everything Admin can do, plus:
- Modify business settings.
- Grant, change, and revoke user roles.

**Cannot do.** Revoke their own Owner role — the UI blocks it to prevent a
tenant from ending up with zero owners.

### Admin (Office)

**Who they are.** Trusted office staff who run day-to-day operations from
a desk: entering payments, cancelling subscriptions, issuing refunds,
archiving customers, voiding erroneous transactions, managing the device
inventory.

**Why the role exists.** These are the destructive/financial actions that
must be tightly scoped, but the owner cannot personally sit in the office
every day. Splitting Admin from Owner means routine financial work can be
delegated without also delegating role management and platform settings —
the two most dangerous levers.

**Can do.** Every operational action except role management and settings.

**Cannot do.** Modify settings. Manage user roles.

### Collection Agent

**Who they are.** Field or door-to-door collectors. They visit customers,
collect cash / UPI, and mark the payment against the correct subscription.

**Why the role exists.** Collection is high-volume and low-privilege. An
agent in the field with a phone should never be able to cancel a
subscription, issue a refund, void a transaction, or change a customer's
plan. Their entire job is "receive money and attribute it correctly."
Giving them anything else is a fraud/error vector, not a productivity gain.

**Can do.** Record payments (posts a `payment` row on the ledger; FIFO
allocation handles the rest).

**Cannot do.** Everything else. In particular: no cancel, no refund, no
void, no device work, no settings.

### Technician

**Who they are.** Field engineers doing installations, faulty-device
swaps, and disconnects. They physically touch cables, STBs, ONUs and
routers.

**Why the role exists.** Device work has to happen in the field but must
be recorded against the customer to keep inventory honest. Technicians
have zero financial responsibility — they never see money, cannot cancel
subscriptions, and cannot issue refunds. The technician role separates
"who moved this device" from "who took this cash," which is essential for
inventory reconciliation and dispute resolution.

**Can do.** Pair, unpair, and replace devices. Mark a device faulty,
repaired, or decommissioned. Add new units to inventory.

**Cannot do.** Anything financial. Cannot archive customers. Cannot
change settings.

## Roles intentionally deferred

The following roles were considered and left for a future phase. They are
listed here so nobody re-adds them ad-hoc.

| Role | Why deferred |
|---|---|
| **Read-only auditor / accountant** | The reports we would give them (ledger, statements) don't exist as standalone screens yet. Adding a role with no meaningful screens creates a false sense of access. Ship in Phase 7 when reports mature. |
| **Regional manager / area supervisor** | Requires a hierarchy layer (Manager owns Agents owns Customers) the schema does not yet model. Ship when the collection-agent map view lands and we know what "my area" means in code. |
| **Support / complaint handler** | The complaints module (planned) is CRUD-only today and is not sensitive enough to justify a dedicated role. Currently reachable by any authenticated user; revisit when workflow (assign, resolve, escalate) is built. |
| **Reseller / franchisee** | Requires multi-tenant isolation the current single-`user_id` model does not support. Explicitly out of scope. |

## Field-ops interfaces (Phase 7 preview)

The Collection Agent and Technician roles were designed with dedicated
mobile-first interfaces in mind:

- **Collection Agent app** — map-first, list of unpaid customers in the
  agent's area, one-tap "Collect Payment" flow, offline queue for cash
  visits. No customer profile, no analytics, no billing screen.
- **Technician app** — job list (install / repair / swap), device scanner,
  simple pair/unpair/replace forms, no financial data at all.

These are Phase 7 deliverables, not part of Phase 6. The role foundation
is deliberately built now so the backend contract does not shift when the
field apps arrive.

## Adding a new role

1. Add the value to the `app_role` enum in a migration
   (`ALTER TYPE public.app_role ADD VALUE '<name>'`).
2. Update the `can_*` helpers whose action set should include the new role.
3. Update `src/lib/permissions.ts` to derive the new booleans.
4. Add rows to [PERMISSION_MATRIX.md](./PERMISSION_MATRIX.md).
5. Add a section here explaining the role's purpose and boundaries.
