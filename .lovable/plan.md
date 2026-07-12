# Plan — `docs/NEXT_PROJECT_CHECKLIST.md`

Create a single new documentation file. No code changes, no schema changes, no dependencies. Purely a persistent artifact distilling what worked (and what didn't) in this project into a day-1 checklist for the next Lovable build.

## File to create

`docs/NEXT_PROJECT_CHECKLIST.md`

## Structure

1. **Purpose** — one paragraph. This is a lessons-learned checklist derived from the Cable TV operator project. Use it when starting a new Lovable build (e.g. Collection Agent PWA) or a major new module in an existing one.

2. **Before writing any code** (design in Claude/ChatGPT first)
   - Write `PROJECT_VISION.md` — target user, non-goals, scale assumptions
   - Write `BUSINESS_RULES.md` — invariants in plain English
   - Noun-model the domain — pick names that survive pivots (`provider`, `service_type`, not `vendor_id`)
   - Draft 3–5 ADRs for the load-bearing decisions
   - Write `FUTURE_EVOLUTION.md` — what you're deliberately *not* building, with revisit conditions
   - Draft `MODULE_TOPOLOGY.md` — which features are tabs / sub-routes / separate PWAs / separate Lovable projects

3. **Day-1 in Lovable** (before the second screen ships)
   - React Router with real routes — never `useState<View>`
   - Design tokens in `index.css` — no hardcoded colors in components
   - Primitives layer (`PageHeader`, `DataTable`, `StatCard`, `EmptyState`, `Money`) before the second page
   - `AppShell` + nav config as data
   - Seeded demo data script — updated every phase

4. **AI workflow (Claude ↔ ChatGPT ↔ Lovable)**
   - Claude/ChatGPT for architecture, ADRs, prompt refinement — not for writing app code
   - Adversarial critique, not consensus: "list assumptions and missed edge cases"
   - Watch shared LLM failure modes: over-abstraction, invented APIs, enterprise patterns for small tools
   - Ground every prompt with the actual file/error/schema
   - Lovable is the builder — feed it scoped, reviewed prompts

5. **Phase discipline in Lovable**
   - Every phase = a scope doc with "in scope" and "out of scope"
   - State a credit budget upfront (5 / 10 / 30) — forces scope negotiation
   - Approval gate before implementation for anything >5 credits
   - One batch = one reviewable diff — ship, screenshot, then move on
   - Update `CHANGELOG.md` and `PROJECT_STATUS.md` at end of each batch
   - Archive completed phase docs to `docs/archive/`

6. **When to remix vs. new project vs. sub-module**
   - **Remix**: throwaway experiment; expect to discard or cherry-pick back via docs
   - **New Lovable project**: distinct product surface (different users, auth, device class) — e.g. Collection Agent PWA. Share Supabase across projects.
   - **Sub-module in current project**: extends existing domain entities — e.g. Warehouse extends equipment
   - Do NOT branch by feature within one product — related features belong in one project, sequential phases

7. **Chat / thread management**
   - Lovable is one linear thread per project — no branching
   - Long history does not increase credit burn (only current context does)
   - Use scoped phase docs as "branch markers" instead
   - Remix only for genuine experiments, not to shorten history

8. **Applying this to the pipeline** (concrete guidance)
   - **Collection Agent Interface** → separate Lovable project, mobile PWA, shared Supabase. Design offline queue + conflict resolution in Claude first.
   - **Warehouse Management** → sub-module `/warehouse/*` in current project. ADR first: is warehouse a location dimension on `stb_inventory` or its own entity?
   - **Network GIS** → sub-module `/network/*`. ADR for spatial model (PostGIS vs. lat/lng columns, tile serving). Prototype the map in a throwaway remix before committing.

9. **Anti-patterns observed in this project** (things to avoid repeating)
   - 1,412-line `SubscriberDetail.tsx` — extract sub-components early
   - View-state routing that grew to 5 tabs before migrating — start with routes
   - Design system introduced in phase 6 instead of phase 1 — cost a full rewrite pass
   - Legacy dialogs (`StbInventoryDialog`) left in place after their pages existed — retire on the same PR

10. **Quick reference — day-1 file list for the next project**
    - `docs/PROJECT_VISION.md`
    - `docs/BUSINESS_RULES.md`
    - `docs/ARCHITECTURE_DECISIONS.md`
    - `docs/FUTURE_EVOLUTION.md`
    - `docs/MODULE_TOPOLOGY.md`
    - `docs/PROJECT_STATUS.md`
    - `docs/CHANGELOG.md`
    - `src/index.css` with design tokens
    - `src/components/ui-ext/` primitives folder
    - `src/App.tsx` with React Router + `AppShell`

## Out of scope

- No changes to existing docs, code, or schema
- No new features
- No changes to the current Cable TV project's architecture — this doc is forward-looking only
