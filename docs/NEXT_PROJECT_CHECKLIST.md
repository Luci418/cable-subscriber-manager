# Next Project Checklist

> A day-1 checklist for the next Lovable build (or a major new module in an
> existing one), distilled from what worked — and what cost us rewrites — on
> the Cable TV operator project.
>
> Use it as a pre-flight before typing the first prompt into Lovable, and as
> a running reference between phases. Not every item applies to every
> project; the point is to make the *choice* deliberate.

---

## 1. Before writing any code (design in Claude / ChatGPT first)

Do this **outside Lovable**. Cheap to iterate, expensive to retrofit later.

- [ ] `PROJECT_VISION.md` — target user, non-goals, scale assumptions,
      design philosophy. One page.
- [ ] `BUSINESS_RULES.md` — invariants in plain English. What must always
      be true? What must never happen?
- [ ] **Noun-model the domain.** Pick names that survive pivots. On this
      project `provider` + `service_type` + `subscriber_id` outlived three
      pivots; a `vendor_id` would not have.
- [ ] Draft 3–5 ADRs for the load-bearing decisions (schema shape, auth
      model, tenancy, money handling). Every ADR gets a **revisit
      condition** — the trigger that would make you change your mind.
- [ ] `FUTURE_EVOLUTION.md` — what you're deliberately *not* building, with
      revisit conditions. This is what keeps YAGNI honest without painting
      you into a corner.
- [ ] `MODULE_TOPOLOGY.md` — decide upfront which features are tabs vs.
      sub-routes vs. separate PWAs vs. separate Lovable projects. Revisit
      per phase, don't discover it mid-build.

## 2. Day-1 in Lovable (before the second screen ships)

The things this project paid to retrofit in phase 6. Do them in phase 1
next time.

- [ ] **React Router with real routes** — never `useState<View>` for
      navigation. Deep links, browser back, and per-entity URLs from day 1.
- [ ] **Design tokens in `index.css`** — semantic color / radius / shadow
      names. Zero hardcoded `text-white`, `bg-[#...]`, gradient literals in
      components.
- [ ] **Primitives layer before the second page** —
      `PageHeader`, `DataTable`, `StatCard`, `EmptyState`, `Money`,
      `SectionCard`, `Toolbar`. New pages inherit look-and-feel free.
- [ ] `AppShell` with **nav config as data** — new modules register by
      adding one entry, not by editing a switch statement.
- [ ] **Seeded demo data script** — updated every phase. Every new feature
      lands with the seed row that exercises it. Prevents "works on my
      empty account" regressions.

## 3. AI workflow — Claude ↔ ChatGPT ↔ Lovable

Use each tool for what it's good at. Don't ask Lovable to architect and
don't ask Claude to ship a diff.

- [ ] **Claude / ChatGPT for architecture, ADRs, prompt refinement** — not
      for writing app code. Their strength is long-context reasoning and
      tradeoff analysis.
- [ ] **Adversarial critique, not consensus.** Prompt the second model
      with: *"Here's a plan from another AI. List assumptions it's making,
      edge cases it missed, and where it's over-engineering."* Consensus
      prompts produce sycophancy.
- [ ] **Assign roles.** e.g. Claude = architect / reviewer. ChatGPT (or
      o-series) = adversarial critic + code sanity check. Or swap — pick
      per task, not per loyalty.
- [ ] **Watch shared LLM failure modes** — over-abstraction, invented
      library APIs, "enterprise" patterns for tiny apps, adding an event
      bus for a 3-user tool. If both models agree on something suspicious,
      both are wrong.
- [ ] **Ground every prompt** with the actual file / actual error / actual
      schema. Hallucinations drop sharply when the model isn't guessing.
- [ ] **Lovable is the builder.** Feed it scoped, reviewed prompts. Don't
      use it as a discussion partner for open-ended architecture.

## 4. Phase discipline in Lovable

The single biggest lever on credit burn and code quality.

- [ ] Every phase = a scope doc with **"in scope"** and **"out of scope"**
      sections. Written before the first prompt.
- [ ] **State a credit budget upfront** (5 / 10 / 30). Forces scope
      negotiation before implementation. "Batch 4 as written was ~30
      credits; scoping to Fixes 1–4 kept it to ~5" — this only worked
      because the budget was named.
- [ ] **Approval gate** before implementation for anything > ~5 credits.
- [ ] **One batch = one reviewable diff.** Ship, screenshot, verify in the
      preview, then move on. Don't chain batches in one turn.
- [ ] Update `CHANGELOG.md` and `PROJECT_STATUS.md` at the end of each
      batch. Cheap discipline, huge ramp-in payoff for later sessions.
- [ ] Archive completed phase docs to `docs/archive/` so the live docs
      folder stays a picture of the *current* system.

## 5. When to remix vs. new project vs. sub-module

- **Remix** — throwaway experiment. Expect to discard the branch or
  cherry-pick learnings back via docs. Loses history and memory *by
  design*.
- **New Lovable project** — distinct product surface: different users,
  different auth, different device class. e.g. a Collection Agent mobile
  PWA. Share the Supabase backend across projects; keep the codebases
  separate.
- **Sub-module in the current project** — extends existing domain
  entities. e.g. Warehouse extends the equipment/asset model already in
  place.
- **Do NOT branch by feature within one product.** Related features
  belong in one project as sequential phases. Splitting them prematurely
  fragments the domain model.

## 6. Chat / thread management

- Lovable is **one linear thread per project** — no branching primitive.
- **Long history does not increase credit burn** on its own. The agent
  loads a compact summary + recent turns into context, not the full
  transcript. Remixing to "shorten" history does not save credits.
- Use **scoped phase docs as "branch markers"** instead. A well-written
  `PHASE_N_SCOPE.md` is your branch.
- Remix only for genuine experiments, not for cost or hygiene reasons.

## 7. Applying this to the pipeline

Concrete guidance for the modules already discussed for this business.

**Collection Agent Interface**
- Separate Lovable project. Mobile PWA, different auth surface, different
  interaction model.
- Shared Supabase backend with the main operator app.
- Design in Claude *first*: offline queue model, conflict resolution
  policy, auth handoff from operator → agent, sync-on-reconnect
  semantics. These are ADRs before they are prompts.

**Warehouse Management**
- Sub-module `/warehouse/*` in the current project.
- ADR first: is "warehouse" a location *dimension* on `stb_inventory`
  (`current_location = 'warehouse-a' | 'field' | ...`), or its own
  entity with transfers, stock levels, and receipts? The answer changes
  the schema shape.
- Extend the existing device status audit log rather than inventing a
  parallel one.

**Network GIS**
- Sub-module `/network/*` in the current project.
- ADR for the spatial model: PostGIS vs. plain `lat` / `lng` columns;
  tile-serving strategy; whether polygons matter or only points.
- Prototype the map in a **throwaway remix** first — map libraries are
  where estimates go wrong. Commit only after the prototype clears.

## 8. Anti-patterns observed on this project

Things not to repeat.

- **1,412-line `SubscriberDetail.tsx`.** Extract sub-components while
  each is still small. Rule of thumb: if a file crosses ~400 lines, that
  file is *already* a design smell — split before it doubles.
- **View-state routing** that grew to 5 tabs before migrating to real
  routes. Start with React Router even for two screens.
- **Design system introduced in phase 6** instead of phase 1. Cost a
  full rewrite pass and one 1,412-line file.
- **Legacy dialogs left in place after their replacement pages existed**
  (e.g. `StbInventoryDialog` after `/equipment/:serial`). Retire on the
  same PR that ships the replacement — not "next phase."
- **Unbounded "review and improve the codebase" prompts.** These are the
  most expensive prompt shape in Lovable. Always constrain: "review
  files X, Y, Z for issue class W."

## 9. Quick reference — day-1 file list

For the next Lovable project, create these before writing feature code:

```
docs/
  PROJECT_VISION.md
  BUSINESS_RULES.md
  ARCHITECTURE_DECISIONS.md
  FUTURE_EVOLUTION.md
  MODULE_TOPOLOGY.md
  PROJECT_STATUS.md
CHANGELOG.md
src/
  index.css                    # design tokens, no hardcoded colors elsewhere
  App.tsx                      # React Router + AppShell wired up
  components/
    AppShell.tsx
    AppSidebar.tsx
    ui-ext/                    # PageHeader, DataTable, StatCard, ...
```

Everything else is a feature. If a feature can't be described in terms of
the docs above, the docs are wrong before the code is.
