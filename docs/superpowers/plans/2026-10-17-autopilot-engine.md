# Autopilot Engine Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**v2 changes (2026-10-17, Jan's review):** the server ceiling (`AUTOPILOT_MODE`) is gone. The house setting is the mode. The eval gate now tunes the assist bar instead of lowering a ceiling. Flow and UML diagrams added.

**Goal:** Let Bauhouse take the next in-app step for a house by itself (put the usual things on a list before the shop), with three house modes: `off`, `suggest` (today's suggestions, the default) and `assist` (reversible in-app actions, each with a reason and Undo). Full autopilot (buying, booking, messaging) is not a mode.

**Architecture:** A new pure package `internal/autopilot` holds the mode rules, the planner (`Plan(snapshot, policy) []Proposal`) and the policy (`Decide(mode, proposal, policy) Disposition`). It reads the world through a narrow `Signals` port that services implement: a temporary adapter over today's `analytics.Reader` now, and the anticipation API from `claude/analytics-anticipation` in Task 10. `services/autopilot_service.go` does the I/O. It gathers a snapshot, applies `Apply` proposals through `ListService` with an exact, durable action log (`autopilot_actions`, unique per house × kind × key × cycle), records outcomes from list hooks, and runs on a lease-based ticker. Suggest-mode proposals stay stateless, derived from events and aggregates as today. Analytics stays feature-agnostic: autopilot adds use a new generic `RoleAutomated` event role that never counts as a request.

**Tech Stack:** Go 1.26 + chi + MongoDB (memstore fakes for unit tests); React + Vite + TypeScript + React Query + Vitest + MSW.

**Spec:** this plan (Jan's brief, 2026-10-17). Sibling: `docs/superpowers/plans/2026-10-17-analytics-anticipation.md` on `claude/analytics-anticipation`.

## Global Constraints

- **The mode is a house setting.** `Room.AutopilotMode` is `off | suggest | assist`. Absent means `suggest`. A house with the legacy `Room.SuggestionsOff = true` reads as `off`. There is no data migration: the mapping happens at read time, and writing a mode clears `suggestions_off`. Any member may change it (like renaming the house); the change emits `house.settings_updated`. API responses keep `suggestions_off` for one release, derived from the mode. There is **no server ceiling**.
- `SUGGESTIONS_MODE` (the existing operator kill switch for computing suggestions) is untouched. It is not an autopilot mode and does not gate assist.
- **Never external:** `autopilot.Effect` has only in-app values (`EffectAddToList`), and the executor refuses anything else. External effects need a new mode and explicit consent (a comment at the type and at the executor says so).
- **Autopilot adds are never human requests.** `item.autopilot_added` is registered with `Skip: true`, `Role: RoleAutomated` and actor `system:autopilot`. `recomputeKey` forecasts a key from checks (`predict.SeriesChecked`) when an automated add falls in its recent cycles. Removing an autopilot item emits `item.autopilot_removed` (`RoleDismiss`, a real miss). Checking it off is a normal `item.checked`.
- **Stateless suggestions, durable actions:** suggest-mode proposals are derived from events and aggregates only. Only applied (assist) actions are stored, because the recorder may drop events and "did we already add this?" must be exact.
- **Bars by intrusiveness** (`autopilot.Policy`, tuned by Task 9's eval, not by feel): suggest = `Forecast.Confident` (MinScore 0.65, MaxCV 0.5). Assist = score ≥ 0.80 **and** need-before-the-run-after-next ≥ 0.70. Between the bars, assist falls back to a suggestion.
- `ForecastVersion` → **4** (the analytics branch takes 3).
- `internal/autopilot` imports only pure code (`analytics/predict`, `parse`). It never imports `store`, `services` or Mongo, and `internal/analytics` never imports `autopilot`.
- UI: tokens and primitives only (`Paper`, `Button`, `Sheet`, slips). A new mark goes into the system first (token block, `pnpm design:sync`, reference page, DESIGN.md). Voice: plain, warm, short ("Added 4 for Saturday").
- Run `make check` before each commit and `make test-integration` for the Mongo tasks (1 and 4). Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Autopilot adds never count as requests; a house on assist for 10 cycles keeps a stable rhythm. → `TestAutomatedAddsKeepRhythm` (analytics), `TestAssistTenCyclesStableRhythm` (services).
- `off` produces nothing, `suggest` never writes, `assist` writes only in-app and only above the assist bar; between the bars it falls back to a suggestion. → `TestDecideModesByBand`, `TestTickWritesOnlyInAssist`, `TestExecutorRefusesExternalEffects`.
- Two instances ticking at once add an item once. → `TestConcurrentTicksAddOnce` (service), `TestAutopilotActionUniqueKey` (Mongo).
- Undo and swipe-delete both mark the action removed and feed a dismiss; the item does not come back in the same cycle. → `TestUndoMarksUndoneAndDismisses`, `TestDeleteAutopilotItemMarksRemoved`, `TestRemovedNotReaddedSameCycle`.
- An item already on the list (or a look-alike, `parse.Similarity`) is never added again. → `TestPlanSkipsOnListAndLookAlikes`.
- A house that is away gets no assist adds for the away period. → `TestPlanAwayNoAdds` (fake away calendar until Task 10).
- Suggest mode behaves exactly like today's suggestions. → `TestForListParityAcrossModes`.

## Diagrams

### 1. Components and dependencies

Arrows point from the importer to what it imports. `autopilot` is pure; services do every read and write.

```mermaid
flowchart LR
    subgraph HTTP["http"]
        RH["RoomHandler<br/>PUT /rooms/settings"]
        AH["AutopilotHandler<br/>GET .../autopilot<br/>POST .../undo"]
        SH["SuggestionsHandler"]
    end
    subgraph SVC["services (I/O)"]
        RS["RoomService"]
        AS["AutopilotService<br/>ticker · executor · outcomes"]
        LS["ListService"]
        SS["SuggestionService"]
        SA["analyticsSignals<br/>(temporary adapter)"]
    end
    subgraph AP["autopilot (pure)"]
        MODE["Mode · HouseMode"]
        PLAN["Gather · Plan · Decide"]
        POL["Policy"]
        SIG["Signals port"]
    end
    subgraph AN["analytics (feature-agnostic)"]
        RD["Reader"]
        WK["Worker · recomputeKey"]
        PR["predict"]
    end
    subgraph ST["store"]
        RR["RoomRepository"]
        AR["AutopilotActionRepository"]
        IR["ListItemRepository"]
    end
    RH --> RS
    AH --> AS
    SH --> SS
    RS --> RR
    RS --> MODE
    AS --> PLAN
    AS --> AR
    AS --> LS
    AS --> SA
    SA -. implements .-> SIG
    SA --> RD
    SS --> MODE
    SS --> RD
    LS --> IR
    LS -. ItemHooks .-> AS
    PLAN --> PR
    WK --> PR
```

### 2. Package model (UML class diagram)

```mermaid
classDiagram
    direction LR
    class Mode {
        <<enumeration>>
        off
        suggest
        assist
    }
    class Kind {
        <<enumeration>>
        restock
        hold_back «declared»
        welcome_home «declared»
        overdue «declared»
    }
    class Effect {
        <<enumeration>>
        add_to_list
    }
    class Disposition {
        <<enumeration>>
        Drop
        Suggest
        Apply
    }
    class Reason {
        +string Code
        +map Params
    }
    class Proposal {
        +Kind Kind
        +string ListID
        +string Key
        +string Display
        +string Quantity
        +string Unit
        +float Confidence
        +float Need
        +Reason Reason
        +string Cycle
        +time RunAt
        +Effect Effect
    }
    class Policy {
        +float SuggestMinScore = 0.65
        +float SuggestMaxCV = 0.5
        +float AssistMinScore = 0.80
        +float AssistMinNeed = 0.70
        +float MinRunConfidence = 0.5
        +int MaxPerRun = 8
    }
    class RunPlan {
        +Window Next
        +Window After
        +float Confidence
    }
    class Need {
        +string Key
        +float Score
        +float CV
        +float NeedBy
        +float EveryDays
        +time LastAt
    }
    class Snapshot {
        +string ListID
        +time Now
        +RunPlan Run
        +Window[] Away
        +Need[] Needs
        +string[] OnList
        +map Usual
    }
    class Signals {
        <<interface>>
        +RunPlan(ctx, room, list, now) RunPlan
        +Away(ctx, room) Window[]
        +NeedsBefore(ctx, room, list, by, away, limit) Need[]
        +OnList(ctx, list) string[]
        +Usual(ctx, room, keys) map
    }
    class autopilot {
        <<package functions>>
        +HouseMode(stored, legacyOff) Mode
        +Gather(ctx, Signals, room, list, now, Policy) Snapshot
        +Plan(Snapshot, Policy) Proposal[]
        +Decide(Mode, Proposal, Policy) Disposition
    }
    class AutopilotService {
        +TickOnce(ctx) int
        +RunTicker(ctx, every, jitter)
        +Apply(ctx, room, Proposal) AutopilotAction
        +View(ctx, user, room, list) AutopilotView
        +Undo(ctx, user, room, list, actionID)
        +ItemChecked(ctx, item)
        +ItemDeleted(ctx, item)
    }
    class ItemHooks {
        <<interface>>
        +ItemChecked(ctx, item)
        +ItemDeleted(ctx, item)
    }
    class AutopilotActionRepository {
        <<interface>>
        +Insert(ctx, action)
        +SetItem(ctx, actionID, itemID)
        +Delete(ctx, actionID)
        +GetByID(ctx, actionID)
        +GetByItem(ctx, itemID)
        +ListByList(ctx, listID, since)
        +ListOpen(ctx, roomID)
        +Resolve(ctx, actionID, from, to, at) bool
        +DeleteByRoom(ctx, roomID)
        +AcquireLease(ctx, owner, ttl, now) bool
    }
    class analyticsSignals {
        «temporary until Task 10»
    }
    Proposal --> Kind
    Proposal --> Effect
    Proposal --> Reason
    Snapshot --> RunPlan
    Snapshot --> Need
    autopilot ..> Signals : reads
    autopilot ..> Snapshot
    autopilot ..> Proposal : produces
    autopilot ..> Disposition : returns
    autopilot ..> Policy
    autopilot ..> Mode
    analyticsSignals ..|> Signals
    AutopilotService ..|> ItemHooks
    AutopilotService --> AutopilotActionRepository
    AutopilotService --> analyticsSignals
```

### 3. Deciding one proposal (`Decide`)

```mermaid
flowchart TD
    P([Proposal]) --> M{House mode}
    M -- off --> DROP[Drop]
    M -- suggest --> B1{"score ≥ 0.65<br/>and CV ≤ 0.5?"}
    M -- assist --> B2{"score ≥ 0.65<br/>and CV ≤ 0.5?"}
    B1 -- no --> DROP
    B1 -- yes --> SUG[Suggest]
    B2 -- no --> DROP
    B2 -- yes --> E{"Effect is in-app?"}
    E -- no --> SUG
    E -- yes --> B3{"score ≥ 0.80<br/>and need ≥ 0.70?"}
    B3 -- no --> SUG
    B3 -- yes --> APPLY[Apply]
```

### 4. Planning one list (`Plan`, restock rule)

```mermaid
flowchart TD
    S([Snapshot]) --> R{"Run plan with<br/>confidence ≥ 0.5?"}
    R -- no --> NONE([No proposals])
    R -- yes --> A{"Next run starts<br/>while the house is away?"}
    A -- yes --> NONE
    A -- no --> L[["For each need, most confident first"]]
    L --> C1{"Clears the suggest bar?"}
    C1 -- no --> SKIP[Skip]
    C1 -- yes --> C2{"On the list,<br/>or a look-alike of it?"}
    C2 -- yes --> SKIP
    C2 -- no --> C3{"Look-alike of a key<br/>already proposed?"}
    C3 -- yes --> SKIP
    C3 -- no --> MK["Proposal: restock, add_to_list<br/>qty = usual quantity<br/>cycle = LastAt date<br/>reason = every_days"]
    MK --> CAP{"MaxPerRun reached?"}
    CAP -- no --> L
    CAP -- yes --> OUT([Proposals])
    SKIP --> L
```

### 5. One tick (UML sequence)

Every instance runs the ticker. The lease keeps the work on one instance, and the unique action key makes a second write a no-op even if two instances race.

```mermaid
sequenceDiagram
    autonumber
    participant T as Ticker (every 15 min)
    participant AS as AutopilotService
    participant AR as AutopilotActionRepository
    participant RR as RoomRepository
    participant SG as Signals
    participant AP as autopilot (pure)
    participant LS as ListService
    participant EV as Recorder
    T->>AS: TickOnce()
    AS->>AR: AcquireLease("tick")
    alt lease held elsewhere
        AR-->>AS: false
        AS-->>T: 0
    else lease ours
        AS->>RR: ListIDsByAutopilotMode("assist")
        loop each assist house, each live list
            AS->>AP: Gather(ctx, SG, room, list, now)
            AP->>SG: RunPlan · Away · NeedsBefore · OnList · Usual
            SG-->>AP: signals
            AP-->>AS: Snapshot
            alt next run opens within AUTOPILOT_LEAD (18 h)
                AS->>AP: Plan(snapshot, policy)
                AP-->>AS: proposals
                loop each proposal
                    AS->>AP: Decide(assist, proposal, policy)
                    opt Apply
                        AS->>AR: Insert(action: state applied)
                        alt duplicate (room, kind, key, cycle)
                            AR-->>AS: ErrConflict, skip
                        else inserted
                            AS->>LS: CreateSystemItem(system:autopilot, source autopilot)
                            alt create failed
                                AS->>AR: Delete(action)
                            else created
                                AS->>AR: SetItem(action, item)
                                LS->>EV: item.autopilot_added (Skip, RoleAutomated)
                            end
                        end
                    end
                end
            end
        end
        AS->>AR: ListOpen → expire actions whose run ended over a day ago
    end
```

### 6. Outcomes: check, swipe-delete, Undo (UML sequence)

```mermaid
sequenceDiagram
    autonumber
    actor U as Member
    participant LP as ListPage
    participant API as HTTP
    participant LS as ListService
    participant AS as AutopilotService (ItemHooks)
    participant AR as AutopilotActionRepository
    participant EV as Recorder
    alt checks the item off
        U->>LP: check
        LP->>API: PATCH item {completed: true}
        API->>LS: UpdateItem
        LS->>EV: item.checked (normal completion)
        LS->>AS: ItemChecked(item)
        AS->>AR: Resolve(applied → confirmed)
    else swipe-deletes (after the 5 s undo toast)
        U->>LP: swipe
        LP->>API: DELETE item
        API->>LS: DeleteItem
        LS->>EV: item.deleted
        LS->>AS: ItemDeleted(item)
        AS->>AR: Resolve(applied|confirmed → removed)
        AS->>EV: item.autopilot_removed (RoleDismiss)
    else taps Undo on the slip
        U->>LP: Undo / Undo all
        LP->>API: POST .../autopilot/{action_id}/undo
        API->>AS: Undo
        AS->>AR: Resolve(applied → undone)
        AS->>LS: delete the item (no hook re-entry)
        AS->>EV: item.autopilot_removed (RoleDismiss)
    end
    Note over AR: The row stays until 180 days after it resolved,<br/>so the unique key blocks a re-add in the same cycle.
```

### 7. Action lifecycle (UML state machine)

```mermaid
stateDiagram-v2
    [*] --> applied: Insert (unique per house, kind, key, cycle)
    applied --> confirmed: item checked
    applied --> removed: item deleted by a member
    applied --> undone: Undo
    applied --> expired: run ended over a day ago, still unchecked
    confirmed --> removed: deleted before Clear done
    confirmed --> [*]
    removed --> [*]
    undone --> [*]
    expired --> [*]
    note right of removed
        removed and undone emit item.autopilot_removed,
        a dismiss that counts against the forecast
    end note
    note left of applied
        every resolved row gets purge_at = resolved_at + 180 days (TTL)
    end note
```

### 8. Keeping the forecast honest (`recomputeKey`)

```mermaid
flowchart TD
    K([Key marked dirty by the fold]) --> EVS["Read the key's newest events<br/>(and its look-alikes')"]
    EVS --> CL["Classify by role:<br/>Request · Complete · Dismiss · Automated"]
    CL --> Q{"Any Automated event inside<br/>the key's recent cycles?"}
    Q -- yes --> CHK["PredictChecked:<br/>forecast from completions"]
    Q -- no --> DEF["Predict: adds when there are enough,<br/>else completions (today)"]
    CHK --> SAVE["SetKeyIntervals(v = 4)"]
    DEF --> SAVE
```

Why: on assist, nobody adds the thing by hand any more, so the add series would dry up and the forecast would decay (or, if autopilot adds counted, confirm itself). Completions keep coming either way.

### 9. Data model (`autopilot_actions`)

```mermaid
erDiagram
    ROOMS ||--o{ LISTS : has
    LISTS ||--o{ LIST_ITEMS : holds
    ROOMS ||--o{ AUTOPILOT_ACTIONS : logs
    LISTS ||--o{ AUTOPILOT_ACTIONS : targets
    LIST_ITEMS |o--o| AUTOPILOT_ACTIONS : "created by"
    ROOMS {
        string room_id PK
        string autopilot_mode "off|suggest|assist, sparse index"
        bool suggestions_off "legacy, cleared on write"
    }
    LIST_ITEMS {
        string item_id PK
        string source "autopilot when added by it"
    }
    AUTOPILOT_ACTIONS {
        string action_id PK
        string room_id "UNIQUE with kind, key, cycle"
        string list_id
        string kind
        string key
        string cycle "forecast LastAt date"
        string item_id
        string state "applied|confirmed|removed|undone|expired"
        float confidence
        object reason "code, params"
        date run_at
        date created_at
        date resolved_at
        date purge_at "TTL index"
    }
```

A separate `autopilot_state` collection holds the ticker lease (`_id: "tick"`, `owner`, `lease_until`).

### 10. List page (frontend flow)

```mermaid
flowchart TD
    O([List page opens]) --> R["GET /rooms/me<br/>→ autopilot_mode"]
    R --> M{Mode}
    M -- off --> PLAIN[Items only]
    M -- suggest --> SUGG["GET .../suggestions<br/>today's suggestion slip, unchanged"]
    M -- assist --> AP["GET .../autopilot<br/>{applied, suggestions}"]
    AP --> MARK["Rows with source autopilot<br/>show the autopilot mark"]
    MARK --> TAP{"Tap the mark?"}
    TAP -- yes --> WHY["'You buy it about every 9 days'"]
    AP --> SLIP{"Applied actions for the<br/>next run, not seen yet?"}
    SLIP -- yes --> S["Slip: 'Added 4 for Saturday'<br/>Undo all"]
    S --> UA["POST .../undo per action<br/>rows leave"]
    AP --> FB["Suggestions between the bars<br/>use today's slip"]
```

---

### Task 1: Modes

**Files:**
- Create: `backend/internal/autopilot/mode.go`, `mode_test.go`
- Modify: `backend/internal/models/room.go`, `backend/internal/store/repo.go` (`RoomRepository.SetAutopilotMode`, `ListIDsByAutopilotMode`; remove `SetSuggestionsOff`), `backend/internal/store/mongo/room_repo.go` (+ sparse index), `backend/internal/testutil/memstore/memstore.go`, `backend/internal/services/room_service.go` (`RoomSettings`), `backend/internal/http/handlers/room.go`
- Test: `autopilot/mode_test.go`, `handlers/autopilot_mode_test.go`, `store/mongo/mongo_integration_test.go`

**Interfaces:**
```go
type Mode string // ModeOff, ModeSuggest, ModeAssist
func ParseMode(s string) (Mode, bool)
func HouseMode(stored string, legacyOff bool) Mode
// models.Room: AutopilotMode string `bson:"autopilot_mode,omitempty" json:"-"`
// RoomRepository: SetAutopilotMode(ctx, roomID, userID, mode string, at time.Time) error  (clears suggestions_off)
//                 ListIDsByAutopilotMode(ctx, mode string, limit int) ([]string, error)
type RoomSettings struct{ DisplayName, Description *string; SuggestionsOff *bool; AutopilotMode *autopilot.Mode }
func (s *RoomService) UpdateRoomSettings(ctx, user, in RoomSettings) error
```
- [ ] Failing tests: `ParseMode` table (tolerates case and spaces; unknown → false); `HouseMode("", true)` = off, `("", false)` = suggest, `("assist", true)` = assist. Handler: `PUT /rooms/settings {autopilot_mode:"bogus"}` → 400; `{autopilot_mode:"assist"}` → 200, then `GET /rooms/me` → `autopilot_mode:"assist", suggestions_off:false`; `{suggestions_off:true}` reads back `off`; `{suggestions_off:false}` turns off → suggest and never downgrades assist. Mongo: setting a mode unsets `suggestions_off`; `ListIDsByAutopilotMode("assist")`; a non-member write → `ErrNotFound`.
- [ ] Implement; `house.settings_updated` lists `autopilot_mode`.
- [ ] `make check`, `make test-integration`. Commit `feat(rooms): autopilot mode as a house setting`.

### Task 2: Gate today's suggestions through the mode

**Files:** `services/suggestion_service.go`, `services/run_hint.go`; tests in `services/suggestion_service_test.go`.
- [ ] Failing tests: `TestForListParityAcrossModes` (the same fixture returns identical suggestions for no stored mode, `suggest` and `assist`; nothing for `off` or legacy `suggestions_off`); the run hint falls back to the default under `off`.
- [ ] Replace the `room.SuggestionsOff` checks with `autopilot.HouseMode(...) == ModeOff`.
- [ ] `make check`. Commit `feat(suggestions): gate suggestions and the run hint by autopilot mode`.

### Task 3: Planner core (pure)

**Files:** create `autopilot/proposal.go`, `policy.go`, `plan.go`, `signals.go`, `need.go` (+ tests), `autopilot/autopilottest/fake.go`.

**Interfaces:** as in diagram 2, plus
```go
var DefaultPolicy = Policy{SuggestMinScore: 0.65, SuggestMaxCV: 0.5, AssistMinScore: 0.80, AssistMinNeed: 0.70, MinRunConfidence: 0.5, MaxPerRun: 8}
func ApproxNeedBy(lastAt, dueAt time.Time, everyDays, cv float64, confident bool, by time.Time) float64 // until predict.NeedBy lands
```
The restock rule is diagram 4; `Decide` is diagram 3.
- [ ] Failing table tests: `TestDecideModesByBand` (off/suggest/assist × below suggest / between / above assist / high score but low need / non-in-app effect); `TestPlanSkipsOnListAndLookAlikes`; `TestPlanAwayNoAdds`; `TestPlanCycleIsLastAtDate`; `TestPlanNoRunNoProposals`; `TestApproxNeedBy` (≈0.5 at due, ≥0.95 far past, ~0 at last, a step at CV 0, ≤0.5 when not confident).
- [ ] `make check`. Commit `feat(autopilot): pure planner, policy and signals port`.

### Task 4: Action log store (Mongo)

**Files:** create `models/autopilot_action.go`, `store/mongo/autopilot_repo.go`, `testutil/memstore/autopilot.go`, `store/mongo/autopilot_integration_test.go`; modify `store/repo.go`, `services/room_service.go`, `services/user_service.go` (delete with the house).

**Interfaces:** `AutopilotActionRepository` as in diagram 2; data as in diagram 9. `Insert` returns `derr.ErrConflict` on the unique key; `Resolve` is conditional on the `from` states and sets `purge_at`.
- [ ] Failing integration tests: `TestAutopilotActionUniqueKey`; conditional resolve (applied→confirmed true; undone→removed false); TTL index on `purge_at`; `DeleteByRoom`; the lease is exclusive between two owners. The memstore mirrors every rule.
- [ ] `make check`, `make test-integration`. Commit `feat(autopilot): durable action log with a unique action key`.

### Task 5: Executor and outcomes

**Files:** create `services/autopilot_service.go` (+ test); modify `models/list_item.go` (`Source string json:"source,omitempty"`), `services/list_service.go` (`CreateSystemItem`, `UseItemHooks`), `services/analytics_events.go`, `analytics/registry.go` (`RoleAutomated`), `analytics/rollup.go`, `analytics/predict/forecast.go` (`PredictChecked`), `analytics/aggregate.go` (`ForecastVersion = 4`).

Flows: diagrams 5 (apply path), 6, 7 and 8.
- [ ] Failing tests: `TestExecutorRefusesExternalEffects`; `TestApplyInsertsThenCreatesItem` (source `autopilot`, actor `system:autopilot`, only `item.autopilot_added`, no `item.added`); `TestApplyDuplicateIsNoop`; check → confirmed; `TestDeleteAutopilotItemMarksRemoved` (+ `item.autopilot_removed`); `TestRemovedNotReaddedSameCycle`; `TestAutomatedAddsKeepRhythm` (rollup: weekly checks, adds replaced by automated ones → series checked, still confident); `TestAssistTenCyclesStableRhythm`.
- [ ] `make check`. Commits `feat(analytics): automated role, forecast from checks for automated keys` and `feat(autopilot): executor and outcome hooks`.

### Task 6: When it runs

**Files:** `services/autopilot_service.go` (ticker, view, undo), `http/handlers/autopilot.go` (+ test), `http/router/router.go`, `config/config.go` (`AUTOPILOT_TICK_EVERY` 15m, `AUTOPILOT_LEAD` 18h), `cmd/gracie-server/main.go`, `.env.example`.

```go
// GET  /rooms/{room_id}/lists/{list_id}/autopilot → {mode, applied: [...], suggestions: [...]}  (never applies)
// POST /rooms/{room_id}/lists/{list_id}/autopilot/{action_id}/undo → 204
```
The tick is diagram 5. It only visits houses that stored `assist`, and the house mode is re-read per house so a switch to off stops it at once.
- [ ] Failing tests: `TestTickWritesOnlyInAssist`; `TestTickOutsideLeadDoesNothing`; `TestConcurrentTicksAddOnce` (two services, one store, parallel ticks); `TestTickExpiresStaleActions`; `TestViewNeverApplies`; `TestUndoMarksUndoneAndDismisses`; handler auth (403 for another house, 404 for an unknown action).
- [ ] `make check`. Commit `feat(autopilot): lease-based ticker, read view and undo`.

### Task 7: Frontend settings

**Files:** `frontend/src/pages/RoomSettings.tsx` (+ test), `api/types.ts`, `api/endpoints.ts`; a `Segmented` primitive in `components/ui/` if none exists (reference page, DESIGN.md, `/dev/ui`).
- [ ] Failing test: the three options render as a radio group; picking Assist PUTs `{autopilot_mode:"assist"}` and shows "Adds things to your lists before you shop. You can always undo. It never buys or books anything."
- [ ] `make check`. Commit `feat(settings): three-way autopilot control`.

### Task 8: Frontend list

**Files:** `components/ItemRow.tsx`, `pages/ListPage.tsx`, a new `AutopilotSlip`, `styles.css` token(s) for the autopilot mark, `docs/design-system/index.html`, `DESIGN.md`, the MSW mock (autopilot items + endpoint). Flow: diagram 10.
- [ ] Failing tests: an item with `source:"autopilot"` shows the mark; tapping it shows the reason; the slip reads "Added 4 for Saturday" once per run; Undo all posts one undo per action and removes the rows; suggest mode keeps today's slip.
- [ ] Check it in `VITE_MOCK_TRIPS=1 pnpm dev`. `make check`. Commit `feat(lists): autopilot mark, reason and the added-for slip`.

### Task 9: Eval

**Files:** create `autopilot/replay.go` (+ test); modify `cmd/suggest-eval/main.go` (`autopilot` subcommand).

`func Replay(events []analytics.Event, p Policy, lead time.Duration) ReplayReport` with `Precision()`, `Recall()` and `RemovalsPerWeek()`. At each past run minus the lead, plan from the data before that time. An auto-added item counts as a hit when it was checked in that run, and as a removal otherwise.
- [ ] Failing tests on a synthetic weekly house (precision 1, recall 1, 0 removals) and a noisy one.
- [ ] Run on the dev dataset and sweep `AssistMinScore` / `AssistMinNeed`. **Gate:** pick the loosest bar with precision ≥ 0.85 and removals ≤ 1 per week. If no bar meets it, keep 0.80 / 0.70, say so in the PR, and Jan decides whether Assist ships in the settings control. The numbers go in the PR description.
- [ ] `make check`. Commit `feat(autopilot): suggest-eval autopilot replay`.

### Task 10: Wire the real analytics (follow-up PR, after `claude/analytics-anticipation` merges)

Rebase onto `main`. Implement `Signals` with `Reader.RunPlan`, `Reader.NeedsBefore`, `predict.NeedBy` and the `AwayCalendar`; delete the temporary adapter and `ApproxNeedBy`; keep the test fakes. Commit `feat(autopilot): read anticipation signals from analytics`.

### Task 11: Docs

`docs/features/autopilot.md` (modes table, invariants, eval gate, these diagrams) plus a row in `docs/features/README.md`. Update `suggestions.md`, `lists.md` and `backend/CLAUDE.md` (the stateless-suggestions invariant now names the action log). Commit `docs(autopilot): feature note and invariants`.

## Out of scope

Holding perishables back before a trip, the welcome-home shop and overdue chores (the kinds are declared only), push notifications, and any external effect.
