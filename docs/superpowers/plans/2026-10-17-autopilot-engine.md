# Autopilot Engine Implementation Plan (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Changes**
- **v3 (2026-10-17):** one service and one candidate pipeline. `SuggestionService` is folded into `AutopilotService`, with no wrapper left behind. The handlers call `AutopilotService` directly. The existing routes (`…/suggestions`, `…/suggestions/ignore`, `…/run-hint`) keep their paths and are marked deprecated in favour of `…/autopilot`. The candidate filters move into the pure `autopilot` package, so the slip, run mode and Assist all judge the same items. The run hint moves into the same service.
- **v2:** no server ceiling (the house setting is the mode); the eval gate tunes the assist bar; diagrams added.

**Goal:** Let Bauhouse take the next in-app step for a house by itself (put the usual things on a list before the shop), with three house modes: `off`, `suggest` (today's suggestions, the default) and `assist` (reversible in-app actions, each with a reason and Undo). Full autopilot (buying, booking, messaging) is not a mode.

**Architecture:** One feature, one service, one pipeline. The pure package `internal/autopilot` holds the mode rules, the candidate filters, the planner (`Plan(snapshot, policy) []Proposal`) and the policy (`Decide(mode, proposal, policy) Disposition`). It reads the world through a narrow `Signals` port. `services/autopilot_service.go` is the only service. It gathers a snapshot through `Signals` (a temporary adapter over today's `analytics.Reader` and event repository now; the anticipation API from `claude/analytics-anticipation` in Task 10), runs `Plan` and `Decide`, and then shows a suggestion or applies an action. Three callers share the pipeline and differ only in **horizon**: the suggestion slip asks for what is due now, run mode for what comes due before the next run, and the Assist ticker for what is needed before the run after next. Only applied actions are stored, in a durable action log (`autopilot_actions`, unique per house × kind × key × cycle), so suggestions stay stateless. Analytics stays feature-agnostic: autopilot adds use a new generic `RoleAutomated` event role that never counts as a request.

**Tech Stack:** Go 1.26 + chi + MongoDB (memstore fakes for unit tests); React + Vite + TypeScript + React Query + Vitest + MSW.

**Spec:** this plan (Jan's brief and review, 2026-10-17). Sibling: `docs/superpowers/plans/2026-10-17-analytics-anticipation.md` on `claude/analytics-anticipation`.

## Global Constraints

- **The mode is a house setting.** `Room.AutopilotMode` is `off | suggest | assist`. Absent means `suggest`. A house with the legacy `Room.SuggestionsOff = true` reads as `off`. There is no data migration: the mapping happens at read time, and writing a mode clears `suggestions_off`. Any member may change it (like renaming the house); the change emits `house.settings_updated`. API responses keep `suggestions_off` for one release, derived from the mode. There is no server ceiling.
- `SUGGESTIONS_MODE` (the existing operator kill switch) is untouched: `off` still stops the service from computing anything for any house. It is not an autopilot mode.
- **One service.** `SuggestionService` is removed. `AutopilotService` serves suggestions, ignores, the run hint, the read view, Undo, the executor, the outcome hooks and the ticker.
- **Deprecated routes, same paths.** `GET …/lists/{id}/suggestions`, `POST …/suggestions/ignore` and `GET …/lists/{id}/run-hint` keep their paths and responses. Their handlers call `AutopilotService` directly and set `Deprecation: true` plus `Link: <…/autopilot>; rel="successor-version"`. A comment on each route and a line in `docs/features/autopilot.md` say they go once the List page reads `GET …/autopilot` for everything.
- **One candidate pipeline.** The filters that decide what may be proposed (home list, not on the list or a look-alike of it, one name per look-alike cluster, cycle still open, list not paused by two ignores in a row, ordering) live once, in `autopilot`. Suggest mode must behave exactly like today: every existing suggestion test passes unchanged in meaning.
- **Never external:** `autopilot.Effect` has only in-app values (`EffectAddToList`), and the executor refuses anything else. External effects need a new mode and explicit consent (a comment at the type and at the executor says so).
- **Autopilot adds are never human requests.** `item.autopilot_added` is registered with `Skip: true`, `Role: RoleAutomated` and actor `system:autopilot`. `recomputeKey` forecasts a key from checks (`predict.SeriesChecked`) when an automated add falls in its recent cycles. Removing an autopilot item emits `item.autopilot_removed` (`RoleDismiss`, a real miss). Checking it off is a normal `item.checked`.
- **Stateless suggestions, durable actions:** suggestions are derived from events and aggregates only (the `item.suggestion_predicted` measurement records stay as they are). Only applied (assist) actions are stored, because the recorder may drop events and "did we already add this?" must be exact.
- **Bars by intrusiveness** (`autopilot.Policy`, tuned by Task 9's eval, not by feel): suggest = `Forecast.Confident` (MinScore 0.65, MaxCV 0.5). Assist = score ≥ 0.80 **and** need-before-the-run-after-next ≥ 0.70. Between the bars, assist falls back to a suggestion of the same item.
- `ForecastVersion` → **4** (the analytics branch takes 3).
- `internal/autopilot` imports only pure code (`analytics/predict`, `parse`). It never imports `store`, `services` or Mongo, and `internal/analytics` never imports `autopilot`.
- UI: tokens and primitives only (`Paper`, `Button`, `Sheet`, slips). A new mark goes into the system first (token block, `pnpm design:sync`, reference page, DESIGN.md). Voice: plain, warm, short ("Added 4 for Saturday").
- Run `make check` before each commit and `make test-integration` for the Mongo tasks (1 and 4). Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Autopilot adds never count as requests; a house on assist for 10 cycles keeps a stable rhythm. → `TestAutomatedAddsKeepRhythm` (analytics), `TestAssistTenCyclesStableRhythm` (services).
- `off` produces nothing, `suggest` never writes, `assist` writes only in-app and only above the assist bar; between the bars it falls back to a suggestion of the same item. → `TestDecideModesByBand`, `TestTickWritesOnlyInAssist`, `TestExecutorRefusesExternalEffects`, `TestAssistFallbackIsSameItem`.
- Two instances ticking at once add an item once. → `TestConcurrentTicksAddOnce` (service), `TestAutopilotActionUniqueKey` (Mongo).
- Undo and swipe-delete both mark the action removed and feed a dismiss; the item does not come back in the same cycle. → `TestUndoMarksUndoneAndDismisses`, `TestDeleteAutopilotItemMarksRemoved`, `TestRemovedNotReaddedSameCycle`.
- An item already on the list (or a look-alike, `parse.Similarity`) is never added again. → `TestPlanSkipsOnListAndLookAlikes`.
- A house that is away gets no assist adds for the away period. → `TestPlanAwayNoAdds` (fake away calendar until Task 10).
- Suggest mode behaves exactly like today's suggestions. → the existing suggestion suite, ported to `AutopilotService` with only names changed, plus `TestSuggestionsParityAcrossModes`.
- The deprecated routes answer exactly as before. → the existing handler tests stay green, plus `TestDeprecatedRoutesCarryHeader`.

## Diagrams

### 1. Components and dependencies

Arrows point from the importer to what it imports. `autopilot` is pure; `AutopilotService` does every read and write.

```mermaid
flowchart LR
    subgraph HTTP["http"]
        RH["RoomHandler<br/>PUT /rooms/settings"]
        AH["AutopilotHandler<br/>GET .../autopilot<br/>POST .../undo"]
        DH["Deprecated routes<br/>.../suggestions<br/>.../suggestions/ignore<br/>.../run-hint"]
    end
    subgraph SVC["services (I/O)"]
        RS["RoomService"]
        AS["AutopilotService<br/>suggestions · run hint · ticker<br/>executor · outcomes · undo"]
        LS["ListService"]
        SA["analyticsSignals<br/>(temporary adapter)"]
    end
    subgraph AP["autopilot (pure)"]
        MODE["Mode · HouseMode"]
        PLAN["Gather · Plan · Decide<br/>candidate filters"]
        SIG["Signals port"]
    end
    subgraph AN["analytics (feature-agnostic)"]
        RD["Reader · EventRepository"]
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
    DH --> AS
    RS --> RR
    RS --> MODE
    AS --> MODE
    AS --> PLAN
    AS --> AR
    AS --> LS
    AS --> SA
    SA -. implements .-> SIG
    SA --> RD
    LS --> IR
    LS -. ItemHooks .-> AS
    PLAN --> PR
    WK --> PR
```

### 2. One pipeline, three callers

Every caller goes through the same filters and the same `Decide`; only the horizon differs.

```mermaid
flowchart LR
    SLIP["Suggestion slip<br/>GET .../suggestions"] -- "horizon: now" --> G
    RUN["Run mode<br/>GET .../suggestions?during=run"] -- "horizon: before next run" --> G
    TICK["Assist ticker<br/>every 15 min"] -- "horizon: before the run after next" --> G
    G["Gather<br/>(Signals → Snapshot)"] --> P["Plan<br/>shared candidate filters"]
    P --> D{"Decide<br/>(house mode, policy)"}
    D -- Drop --> X([nothing])
    D -- Suggest --> S(["Slip on the list<br/>stateless, measured by item.suggestion_predicted"])
    D -- Apply --> A(["Executor<br/>action log, then list item"])
```

### 3. Package model (UML class diagram)

```mermaid
classDiagram
    direction LR
    class Mode {
        <<enumeration>>
        off
        suggest
        assist
    }
    class Horizon {
        <<enumeration>>
        now
        next_run
        run_after_next
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
    class Proposal {
        +Kind Kind
        +string ListID
        +string Key
        +string Display
        +string Quantity
        +string Unit
        +float Confidence
        +float Need
        +int DueInDays
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
    class Candidate {
        +string Key
        +map Containers
        +float Score
        +float CV
        +float NeedBy
        +float EveryDays
        +time LastAt
        +int DueInDays
        +bool CycleOpen
    }
    class Snapshot {
        +string ListID
        +Horizon Horizon
        +time Now
        +time Until
        +RunPlan Run
        +Window[] Away
        +bool Paused
        +Candidate[] Candidates
        +string[] OnList
        +map Usual
    }
    class Signals {
        <<interface>>
        +RunPlan(ctx, room, list, now) RunPlan
        +Away(ctx, room) Window[]
        +Candidates(ctx, room, list, until, away, limit) Candidate[]
        +Paused(ctx, room, list, now) bool
        +OnList(ctx, list) string[]
        +Usual(ctx, room, keys) map
    }
    class autopilot {
        <<package functions>>
        +HouseMode(stored, legacyOff) Mode
        +Gather(ctx, Signals, room, list, Horizon, now, Policy) Snapshot
        +Plan(Snapshot, Policy) Proposal[]
        +Decide(Mode, Proposal, Policy) Disposition
    }
    class AutopilotService {
        +Suggestions(ctx, user, room, list, limit, during) Suggestion[]
        +Ignore(ctx, user, room, list, key, during)
        +RunHint(ctx, user, room, list) RunHint
        +View(ctx, user, room, list) AutopilotView
        +Undo(ctx, user, room, list, actionID)
        +TickOnce(ctx) int
        +Apply(ctx, room, Proposal) AutopilotAction
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
    Snapshot --> Horizon
    Snapshot --> Candidate
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

### 4. Deciding one proposal (`Decide`)

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

### 5. Planning one list (`Plan`: the shared candidate filters)

The run and away checks apply only to the run-based horizons. The slip's "now" horizon skips them, as today.

```mermaid
flowchart TD
    S([Snapshot]) --> PA{"List paused by two<br/>ignores in a row?"}
    PA -- yes --> NONE([No proposals])
    PA -- no --> H{"Horizon is run-based?"}
    H -- no --> L
    H -- yes --> R{"Run plan with<br/>confidence ≥ 0.5?"}
    R -- no --> NONE
    R -- yes --> A{"That run starts<br/>while the house is away?"}
    A -- yes --> NONE
    A -- no --> L[["For each candidate, most confident first"]]
    L --> C0{"Lives on this list<br/>(home list ≥ 60%)?"}
    C0 -- no --> SKIP[Skip]
    C0 -- yes --> C1{"Look-alike of a key<br/>already taken?"}
    C1 -- yes --> SKIP
    C1 -- no --> C2{"On the list,<br/>or a look-alike of it?"}
    C2 -- yes --> SKIP
    C2 -- no --> C3{"Cycle still open?<br/>(not ignored, added or bought since)"}
    C3 -- no --> SKIP
    C3 -- yes --> MK["Proposal: restock, add_to_list<br/>qty = usual quantity<br/>cycle = LastAt date<br/>reason = every_days"]
    MK --> L
    SKIP --> L
    L -- done --> SORT["Open now first, then soonest,<br/>then most confident; cap"]
    SORT --> OUT([Proposals])
```

### 6. One tick (UML sequence)

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
            AS->>AP: Gather(ctx, SG, room, list, run_after_next, now)
            AP->>SG: RunPlan · Away · Paused · Candidates · OnList · Usual
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

### 7. Outcomes: check, swipe-delete, Undo (UML sequence)

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

### 8. Action lifecycle (UML state machine)

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

### 9. Keeping the forecast honest (`recomputeKey`)

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

### 10. Data model (`autopilot_actions`)

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

### 11. List page (frontend flow)

```mermaid
flowchart TD
    O([List page opens]) --> R["GET /rooms/me<br/>→ autopilot_mode"]
    R --> M{Mode}
    M -- off --> PLAIN[Items only]
    M -- suggest --> SUGG["GET .../suggestions (deprecated path,<br/>served by AutopilotService)<br/>today's slip, unchanged"]
    M -- assist --> AP["GET .../autopilot<br/>{applied, suggestions}"]
    AP --> MARK["Rows with source autopilot<br/>show the autopilot mark"]
    MARK --> TAP{"Tap the mark?"}
    TAP -- yes --> WHY["'You buy it about every 9 days'"]
    AP --> SLIP{"Applied actions for the<br/>next run, not seen yet?"}
    SLIP -- yes --> S["Slip: 'Added 4 for Saturday'<br/>Undo all"]
    S --> UA["POST .../undo per action<br/>rows leave"]
    AP --> FB["Suggestions between the bars<br/>(same items) use today's slip"]
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
- [ ] Implement; `house.settings_updated` lists `autopilot_mode`. Suggestions read `HouseMode(...) == ModeOff` in place of `room.SuggestionsOff` so behaviour is unchanged.
- [ ] `make check`, `make test-integration`. Commit `feat(rooms): autopilot mode as a house setting`.

### Task 2: One service

A move with no behaviour change: `SuggestionService` becomes `AutopilotService`.

**Files:** rename `services/suggestion_service.go` → `services/autopilot_service.go` (and its test), move `services/run_hint.go` methods onto it; modify `http/handlers/suggestions.go` (handlers take `*services.AutopilotService`, set the deprecation headers), `http/router/router.go` (route comments), `cmd/gracie-server/main.go`.

**Interfaces:**
```go
func NewAutopilotService(rooms, lists, items, reader, events, killSwitch SuggestionMode) *AutopilotService
func (s *AutopilotService) Suggestions(ctx, user, roomID, listID string, limit int, during string) ([]Suggestion, error) // was ForList
func (s *AutopilotService) Ignore(ctx, user, roomID, listID, key, during string) error
func (s *AutopilotService) RunHint(ctx, user, roomID, listID string) (RunHint, error) // was RunHintFor
```
- [ ] Port the suggestion and run-hint tests with only names changed; add `TestDeprecatedRoutesCarryHeader` (both headers on all three routes, bodies unchanged).
- [ ] Move the code; delete `SuggestionService`.
- [ ] `make check`. Commit `refactor(autopilot): fold suggestions into one autopilot service`.

### Task 3: Planner core and the shared pipeline (pure)

**Files:** create `autopilot/proposal.go`, `policy.go`, `filters.go`, `plan.go`, `signals.go`, `need.go` (+ tests), `autopilot/autopilottest/fake.go`, `services/autopilot_signals.go` (the temporary adapter); modify `services/autopilot_service.go` (`Suggestions` becomes Gather → Plan → Decide).

**Interfaces:** as in diagram 3, plus
```go
var DefaultPolicy = Policy{SuggestMinScore: 0.65, SuggestMaxCV: 0.5, AssistMinScore: 0.80, AssistMinNeed: 0.70, MinRunConfidence: 0.5, MaxPerRun: 8}
func ApproxNeedBy(lastAt, dueAt time.Time, everyDays, cv float64, confident bool, by time.Time) float64 // until predict.NeedBy lands
```
The filters move out of the service into `autopilot` unchanged in meaning: home list (`homeListShare` 0.6), one name per look-alike cluster, on the list or a look-alike of it, cycle still open (no ignore, add or check since `LastAt`; run-mode ignores only hide the key from run mode), paused after two ignores in a row within 14 days, ordering (open now, then soonest, then score). The adapter supplies `CycleOpen` and `Paused` from the event repository, as the service does today. `Plan` is diagram 5; `Decide` is diagram 4. Horizons: `now` (window open now), `next_run` (today's run-mode lookahead, capped at 14 days), `run_after_next` (Assist).
- [ ] Failing table tests: `TestDecideModesByBand` (off/suggest/assist × below suggest / between / above assist / high score but low need / non-in-app effect); `TestPlanSkipsOnListAndLookAlikes`; `TestPlanAwayNoAdds`; `TestPlanCycleIsLastAtDate`; `TestPlanNoRunNoProposals` (run horizons only); `TestPlanPausedNoProposals`; `TestApproxNeedBy` (≈0.5 at due, ≥0.95 far past, ~0 at last, a step at CV 0, ≤0.5 when not confident); `TestSuggestionsParityAcrossModes`.
- [ ] Move the filters; rewire `Suggestions`. The ported suggestion suite from Task 2 must still pass untouched.
- [ ] `make check`. Commit `feat(autopilot): pure planner and one candidate pipeline`.

### Task 4: Action log store (Mongo)

**Files:** create `models/autopilot_action.go`, `store/mongo/autopilot_repo.go`, `testutil/memstore/autopilot.go`, `store/mongo/autopilot_integration_test.go`; modify `store/repo.go`, `services/room_service.go`, `services/user_service.go` (delete with the house).

**Interfaces:** `AutopilotActionRepository` as in diagram 3; data as in diagram 10. `Insert` returns `derr.ErrConflict` on the unique key; `Resolve` is conditional on the `from` states and sets `purge_at`.
- [ ] Failing integration tests: `TestAutopilotActionUniqueKey`; conditional resolve (applied→confirmed true; undone→removed false); TTL index on `purge_at`; `DeleteByRoom`; the lease is exclusive between two owners. The memstore mirrors every rule.
- [ ] `make check`, `make test-integration`. Commit `feat(autopilot): durable action log with a unique action key`.

### Task 5: Executor and outcomes

**Files:** modify `services/autopilot_service.go` (+ test), `models/list_item.go` (`Source string json:"source,omitempty"`), `services/list_service.go` (`CreateSystemItem`, `UseItemHooks`), `services/analytics_events.go`, `analytics/registry.go` (`RoleAutomated`), `analytics/rollup.go`, `analytics/predict/forecast.go` (`PredictChecked`), `analytics/aggregate.go` (`ForecastVersion = 4`).

Flows: diagrams 6 (apply path), 7, 8 and 9.
- [ ] Failing tests: `TestExecutorRefusesExternalEffects`; `TestApplyInsertsThenCreatesItem` (source `autopilot`, actor `system:autopilot`, only `item.autopilot_added`, no `item.added`); `TestApplyDuplicateIsNoop`; check → confirmed; `TestDeleteAutopilotItemMarksRemoved` (+ `item.autopilot_removed`); `TestRemovedNotReaddedSameCycle`; `TestAutomatedAddsKeepRhythm` (rollup: weekly checks, adds replaced by automated ones → series checked, still confident); `TestAssistTenCyclesStableRhythm`.
- [ ] `make check`. Commits `feat(analytics): automated role, forecast from checks for automated keys` and `feat(autopilot): executor and outcome hooks`.

### Task 6: When it runs

**Files:** `services/autopilot_service.go` (ticker, view, undo), `http/handlers/autopilot.go` (+ test), `http/router/router.go`, `config/config.go` (`AUTOPILOT_TICK_EVERY` 15m, `AUTOPILOT_LEAD` 18h), `cmd/gracie-server/main.go`, `.env.example`.

```go
// GET  /rooms/{room_id}/lists/{list_id}/autopilot → {mode, applied: [...], suggestions: [...]}  (never applies)
// POST /rooms/{room_id}/lists/{list_id}/autopilot/{action_id}/undo → 204
```
The tick is diagram 6. It only visits houses that stored `assist`, and re-reads the house mode per house so a switch to off stops it at once. The view's `suggestions` come from the same pipeline (Decide → Suggest).
- [ ] Failing tests: `TestTickWritesOnlyInAssist`; `TestTickOutsideLeadDoesNothing`; `TestConcurrentTicksAddOnce` (two services, one store, parallel ticks); `TestTickExpiresStaleActions`; `TestViewNeverApplies`; `TestAssistFallbackIsSameItem`; `TestUndoMarksUndoneAndDismisses`; handler auth (403 for another house, 404 for an unknown action).
- [ ] `make check`. Commit `feat(autopilot): lease-based ticker, read view and undo`.

### Task 7: Frontend settings

**Files:** `frontend/src/pages/RoomSettings.tsx` (+ test), `api/types.ts`, `api/endpoints.ts`; a `Segmented` primitive in `components/ui/` if none exists (reference page, DESIGN.md, `/dev/ui`).
- [ ] Failing test: the three options render as a radio group; picking Assist PUTs `{autopilot_mode:"assist"}` and shows "Adds things to your lists before you shop. You can always undo. It never buys or books anything."
- [ ] `make check`. Commit `feat(settings): three-way autopilot control`.

### Task 8: Frontend list

**Files:** `components/ItemRow.tsx`, `pages/ListPage.tsx`, a new `AutopilotSlip`, `styles.css` token(s) for the autopilot mark, `docs/design-system/index.html`, `DESIGN.md`, the MSW mock (autopilot items + endpoint). Flow: diagram 11. The List page keeps calling the deprecated suggestion routes in this PR; moving it fully onto `GET …/autopilot` (and then removing those routes) is a follow-up.
- [ ] Failing tests: an item with `source:"autopilot"` shows the mark; tapping it shows the reason; the slip reads "Added 4 for Saturday" once per run; Undo all posts one undo per action and removes the rows; suggest mode keeps today's slip.
- [ ] Check it in `VITE_MOCK_TRIPS=1 pnpm dev`. `make check`. Commit `feat(lists): autopilot mark, reason and the added-for slip`.

### Task 9: Eval

**Files:** create `autopilot/replay.go` (+ test); modify `cmd/suggest-eval/main.go` (`autopilot` subcommand).

`func Replay(events []analytics.Event, p Policy, lead time.Duration) ReplayReport` with `Precision()`, `Recall()` and `RemovalsPerWeek()`. At each past run minus the lead, plan from the data before that time through the same filters. An auto-added item counts as a hit when it was checked in that run, and as a removal otherwise.
- [ ] Failing tests on a synthetic weekly house (precision 1, recall 1, 0 removals) and a noisy one.
- [ ] Run on the dev dataset and sweep `AssistMinScore` / `AssistMinNeed`. **Gate:** pick the loosest bar with precision ≥ 0.85 and removals ≤ 1 per week. If no bar meets it, keep 0.80 / 0.70, say so in the PR, and Jan decides whether Assist ships in the settings control. The numbers go in the PR description.
- [ ] `make check`. Commit `feat(autopilot): suggest-eval autopilot replay`.

### Task 10: Wire the real analytics (follow-up PR, after `claude/analytics-anticipation` merges)

Rebase onto `main`. Implement `Signals` with `Reader.RunPlan`, `Reader.NeedsBefore`, `predict.NeedBy` and the `AwayCalendar`; delete the temporary adapter's stand-ins and `ApproxNeedBy`; keep the test fakes. Commit `feat(autopilot): read anticipation signals from analytics`.

### Task 11: Docs

`docs/features/autopilot.md` (modes table, invariants, the deprecated routes and their successor, eval gate, these diagrams) plus a row in `docs/features/README.md`. Update `suggestions.md` (now served by `AutopilotService`), `lists.md` and `backend/CLAUDE.md` (the stateless-suggestions invariant now names the action log; the service list). Commit `docs(autopilot): feature note and invariants`.

## Follow-ups (not in this PR)

- Move the List page onto `GET …/autopilot` for suggestions and the run hint, then delete the three deprecated routes.

## Out of scope

Holding perishables back before a trip, the welcome-home shop and overdue chores (the kinds are declared only), push notifications, and any external effect.
