# UI Polish: Calmer tables, less red, tidy badges

Your instinct is right — three spots are over-decorated. Every row in Customers gets a colored pill, the Overview tab paints amounts red, and Catalog gives each provider a random rainbow badge. This plan tones all three down to a quiet, consistent visual language.

## 1. Customers list — tame the "Next action" column

**Problem:** every row renders a colored, bordered bubble with an emoji. With many customers owing money, the column is a wall of red pills.

**Fix — replace bubbles with a quiet status line:**
- Drop the pill/border/background entirely. Render as: small colored **dot** (6px) + plain text, e.g. `● Collect ₹250 and renew Cable`.
- Drop emojis; the dot carries the tone. Keep tone semantics but soften: red only for *expired + debt* (true urgency), amber for expiring-soon and plain collect, neutral gray for "No action required" (or show `—`).
- Long labels truncate with ellipsis at a fixed max-width so rows stay even.

Files: `src/components/SubscriberList.tsx` (action column cell), `src/lib/financialPosition.ts` (`chipToneClasses` → new `chipDotClasses` returning just a dot color; labels/icons unchanged so all 120 existing tests keep passing).

## 2. Customer Overview — stop painting everything red

**Problem:** balance amounts and per-service lines all use red/green colored text; a customer with dues looks alarming everywhere.

**Fix — color the headline only:**
- "Overall position" card: keep the colored headline (`Outstanding ₹250` in red), but render the amount in neutral `text-foreground` when Settled.
- Per-service breakdown rows: amounts in plain `text-foreground` with a small colored dot before the status word — same dot language as the customers list. No full red text lines.
- Keep `positionToneClasses` for the headline; add a muted variant for secondary spots.

Files: `src/components/subscriber-detail/OverviewTab.tsx`, `src/lib/financialPosition.ts`.

## 3. Catalog — provider badges that behave

**Problem:** `hueFor()` assigns each provider a random rainbow outline color; badges wrap on mobile and long names overflow.

**Fix:**
- One consistent style for all providers: neutral `outline` badge with a colored **initial avatar dot** (letter + deterministic hue) — hue becomes a small accent, not the whole chip.
- `whitespace-nowrap`, `max-w-[140px] truncate`, title tooltip for long names, so nothing wraps in mobile view.
- Same treatment in both places it's used (pack rows line 230, provider tab line 308).

File: `src/pages/Catalog.tsx`.

## 4. Other quick wins (included, small)

- Customers list: reduce row vertical padding slightly (`py-3` → `py-2.5`) and let the Services badges sit inline — less crowded feel.
- Balance column: keep red only for positive dues; credit in plain foreground with a `-` sign and muted style (currently green bold, adds noise).
- Empty "—" states already good; no change.

## Out of scope (say the word if you want these)

- Full redesign of the customers table (card layout, avatars).
- Analytics/Complaints visual pass.
- Dark-mode specific tuning beyond what the tokens already handle.

## Verification

- `bunx vitest run` — financialPosition tests must stay green (labels/decision table untouched).
- Visual check via Playwright on Customers, one customer Overview with dues, and Catalog (mobile viewport for the wrap fix).
