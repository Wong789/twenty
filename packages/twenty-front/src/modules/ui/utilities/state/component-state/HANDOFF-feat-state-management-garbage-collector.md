# Handoff: State Management Garbage Collector — Task 01

Branch: `feat/state-management-garbage-collector`
Target feature for first full rollout: **Dialog**

---

## Problem

Every atom family in Twenty's Jotai wrapper is backed by a module-level `Map`
cache that never shrinks. Two separate caches leak:

1. **Factory `atomCache`** — closed over inside each `createAtomComponentState`
   / `createAtomComponentFamilyState` call. Holds strong references to atom
   config objects. Never cleared.
2. **Jotai store** — holds atom values. Never trimmed. `resetJotaiStore()`
   (logout only) recreates the store but does NOT clear factory caches — atom
   objects become orphaned.

Scale estimate:

| Scenario | Atoms created | Retention |
|---|---|---|
| 10k-row record table | ~15,000+ | Entire session |
| 10 views browsed | ~150,000 | Never released |
| Long session (8h) | 500k–10M+ | Grows monotonically |
| Estimated memory | 100MB–1GB+ | — |

---

## The Hard Problem

The GC mechanism itself is the easier half. The harder half: **the entire
codebase assumes atoms are immortal.** Every consumer calls
`useAtomComponentStateValue(someState)` and trusts the value is there and
meaningful. Introducing cleanup creates a new state — "this atom existed, was
populated, and is now back to defaultValue" — that is felt across the whole app.

Concretely: a RecordTable populates ~15 atoms (columns, filters, sorts, row
selection, etc.). If those atoms are silently GC'd and the user comes back, the
component sees `defaultValue` for everything. The re-initialization path must
now be idempotent and always-correct, not a one-shot setup. SSE subscriptions
that push data into those atoms also need to re-establish.

---

## Solutions Explored

### Idea A — Observe first, GC later (instrumentation-first)

Build the observability layer as Phase 1 with zero cleanup. Instrument every
atom with metadata: creation time, last access, subscriber count, access
frequency. Ship a debug panel and send probable-leak warnings (atoms with 0
subscribers for >N minutes, atom caches growing past thresholds) to Sentry.

**Upside:** Zero risk. Produces real-world lifecycle data before any policy
decisions. Surfaces which atoms are ephemeral vs persistent. Also reveals
re-initialization gaps before they become bugs.

**Downside:** Doesn't fix the memory leak. Deferred value.

**Status:** Non-goal for Phase 1, but debug panel and Sentry warnings are
planned as step 4 of the implementation plan (after lifecycle infrastructure is
working).

---

### Idea B — Cold storage / two-tier cache

Instead of deleting atoms, demote them:

```
Active cache (Map<key, atom>)  ←→  Cold cache (LRU<key, serialized value>)
```

When all subscribers leave, the atom moves from active to cold. The cold cache
is an LRU with a configurable budget (e.g. 5000 entries / 50MB). The factory
`Map` entry is deleted (freeing the atom object); the value is serialized and
held in the cold cache. On re-mount, if a cold-cached value exists, the new
atom is initialized with it instead of `defaultValue`.

**Upside:** Consumers never see a silent reset — they get their previous state
back. Filters, scroll position, column widths survive eviction. The
re-initialization problem largely disappears for the common case. Memory
pressure is the trigger, not a timer.

**Downside:** Serialization complexity. Not all atom values are serializable
(functions, refs). Would need explicit opt-in or a type-level constraint.
Adds non-trivial infrastructure.

**Status:** Deferred. Recorded as a strong future direction, especially for
atoms with session semantics (RecordTable filters, column widths). Could be
introduced as a per-atom option on `createAtomComponentState`.

---

### Idea C — Automated GC with timer (TanStack Query model)

Track subscriber counts; start a grace-period timer when count reaches 0;
evict the atom when the timer fires.

**Upside:** Fully automatic, no developer burden. Proven pattern (TanStack
Query `gcTime`).

**Downside:** Creates a "navigate away for 5 minutes and lose state" problem.
Requires all consumers to handle the re-initialization case they currently
ignore. Also, the right `gcTime` value is different per atom type.

**Status:** Deferred as a fallback. Tracked in `decisions.md`. Could be used
as a safety net under budget pressure after the explicit lifecycle protocol is
established.

---

### Idea D — Automated scope-level GC under memory pressure

Manage atoms at the feature scope level (arena-style), not individually. A
RecordTable is a scope owning ~50 atoms. A Dropdown is a scope owning ~3.

Dormant scopes retain atoms. Under memory pressure (total atom count exceeds a
budget), dormant scopes are evicted oldest-first (generational: recently dormant
= young, long-dormant = old). If no pressure, scopes live forever — current
behavior is preserved.

**Upside:** No "navigate away and lose state" problem under normal conditions.
Batch-free is efficient. Generalizes across all features without per-feature
implementation.

**Downside:** Still requires re-initialization handling when a scope IS evicted
under pressure. Invisible trigger (memory pressure) is harder to reason about
than explicit lifecycle transitions.

**Status:** Deferred. Strong candidate for Phase 3 after explicit lifecycle is
proven. The feature-scope structure it requires is already emerging from the
chosen design.

---

## Chosen Design: Explicit Lifecycle Protocol

**Core principle:** not fully automated GC, but an explicit lifecycle protocol
that feature implementers hook into. The framework provides lifecycle machinery;
the developer implements handlers because only they know what "cleanup" and
"restoration" mean for their feature.

Analogy: Android's Activity lifecycle (`onCreate`/`onPause`/`onResume`/
`onDestroy`) or Rust's `Drop` trait.

### Lifecycle phases

```
mounted → active → dormant → evicted
                      ↑          │
                      └──────────┘  (re-mount after eviction = restored)
```

| Phase | Meaning |
|---|---|
| `mounted` | Provider first renders. Atoms created with `defaultValue`. |
| `active` | ≥1 subscriber mounted inside the scope. |
| `dormant` | All subscribers unmounted. Atoms still in memory. |
| `evicted` | Atoms cleared. Scope dead. May be re-mounted. |

Full phase tracking (not just booleans) chosen for granularity — lets
components in a scope observe whether they're in a restoration path vs a
fresh-mount path.

### Developer contract

Feature implementers using a `ComponentInstanceContext` that opts into lifecycle
management provide:

**1) Lifecycle callbacks (imperative, for side effects)**
- `onEvict(instanceId)` — scope about to be cleared. Cancel operations, save
  state.
- `onRestore(instanceId)` — scope was evicted and is re-mounting. Re-fetch,
  re-subscribe to SSE, restore from cold storage.

**2) Eviction policy (per feature — developer-declared, option C above)**

```ts
useComponentStateContextLifecycle({
  context: RecordTableComponentInstanceContext,
  instanceId,
  evictionPolicy: 'on-dormant',       // evict when all subscribers unmount
  // or: 'on-memory-pressure'         // evict only when budget exceeded
  // or: 'manual'                     // developer calls evict() explicitly
  // or: 'never'                      // opt out (current behavior preserved)
  onEvict: handleEvict,
  onRestore: handleRestore,
});
```

Rationale for C (developer-declared policy): Dropdown gets `on-dormant` (cheap,
immediate cleanup). RecordTable gets `on-memory-pressure` (keep state unless
tight). Auth state gets `never`. Each feature decides.

Other eviction trigger options (A: fully manual, B: framework-proposes) are
deferred but remain valid and are tracked in `decisions.md`.

**3) Lifecycle state atom (reactive, for conditional rendering)**

```ts
// Exposed per-scope so components inside can observe transitions
componentStateContextLifecyclePhaseComponentState
// Values: 'mounted' | 'active' | 'dormant' | 'evicted'
```

### Gradual rollout

Features without lifecycle handlers keep current behavior (atoms live forever).
The protocol is adopted feature by feature. No big-bang migration.

A lint rule or TypeScript constraint may eventually require lifecycle handlers
when creating a `ComponentInstanceContext`. Making the implicit contract
explicit.

---

## Implementation Plan

### Build order (everything for Dialog first)

1. **Lifecycle infrastructure** ← this PR (Task 01)
2. `useComponentStateContextLifecycle` hook — registers handler, declares
   policy, drives phase transitions
3. Debug panel component — atom count, memory estimate, phase visualization,
   leak warnings
4. Sentry leak warnings — production-mode leak detection
5. **Dialog adopts the full protocol** — `evictionPolicy: 'on-dormant'`,
   trivial `onEvict` (clear queue), trivial `onRestore` (noop)
6. Tests — unit, integration, manual blue-green checklist

### First target: Dialog

**Why Dialog:**
- 1 atom (`dialogInternalComponentState` — a queue)
- Has `store.set()` imperative access (exercises the CallbackState path)
- Clearly ephemeral — dialog queue should not survive navigation
- Mounted at app root (`AppRouterProviders`) — full lifecycle visible
- Isolated blast radius — breaking it is immediately visible in any flow
- Existing test coverage as baseline

**Expansion order after Dialog:**
1. TabList (2 atoms, session semantics — tests `onRestore` path)
2. ClickOutsideListener (3 atoms, pure utility)
3. Dropdown (5 atoms, widely used — higher risk, proves scale)
4. RecordTable (high impact, high atom count — ultimate target)

---

## What This PR Delivers (Task 01 — Foundation)

All files under `packages/twenty-front/src/modules/ui/utilities/state/`.

### New types

| File | Purpose |
|---|---|
| `component-state/types/ComponentStateLifecyclePhase.ts` | `'mounted' \| 'active' \| 'dormant' \| 'evicted'` |

### New utilities

| File | Purpose |
|---|---|
| `component-state/utils/componentStateSubscriberRegistry.ts` | Tracks subscriber counts per `stateKey × instanceId`. Exposes increment, decrement, get, getTotalForInstance, clear. |
| `component-state/utils/componentStateContextScopeRegistry.ts` | Maps `instanceId → Set<cleanupFn>`. Every atom factory registers its own cache-eviction callback here. `destroyComponentStateContextScope(instanceId)` calls all registered cleanups. |

### Modified types

`ComponentState<V>` and `ComponentFamilyState<V, K>` both gain:
```ts
cleanup: (instanceId: string) => void;
```

### Modified factories

`createAtomComponentState` and `createAtomComponentFamilyState` now:
1. Register a cleanup callback with `registerAtomCleanupForInstance` on every
   new `atomFamily()` call.
2. Expose a `cleanup(instanceId)` method that directly evicts matching cache
   entries.

### Modified hooks (8 total)

Every `useAtomComponent*` and `useSetAtomComponent*` hook now runs a
`useEffect` that increments the subscriber count on mount and decrements it on
unmount.

### Tests — 42 passing

| File | Tests | Coverage |
|---|---|---|
| `componentStateSubscriberRegistry.test.ts` | 18 | Increment, decrement, total, cross-instance isolation, clear |
| `componentStateContextScopeRegistry.test.ts` | 12 | Register, destroy, count, factory integration |
| `useAtomComponentStateSubscriberCounting.test.tsx` | 12 | Each hook in a real React tree: count 0→1 on mount, 1→0 on unmount; atom cache eviction after `destroyComponentStateContextScope` |

---

## Invariants to Preserve

- `componentStateSubscriberRegistry` and `componentStateContextScopeRegistry`
  are module-level singletons. Tests must call `clearSubscriberCountsForInstance`
  and `destroyComponentStateContextScope` in `afterEach` to avoid cross-test leaks.
- `cleanup()` on a state object evicts the factory cache only. It does NOT reset
  the Jotai atom value in any live store. That is a later task.
- `destroyComponentStateContextScope` is idempotent.

---

## Key Data Flow

```
[Hook mounts]
  useEffect fires
    → incrementComponentStateSubscriberCount(key, instanceId)

[atomFamily() called for first time]
  → creates Jotai atom
  → registerAtomCleanupForInstance(instanceId, () => atomCache.delete(cacheKey))

[Hook unmounts]
  useEffect cleanup fires
    → decrementComponentStateSubscriberCount(key, instanceId)
    → if count === 0: (Task 02 will observe this and call…)
        → destroyComponentStateContextScope(instanceId)
            → calls all registered cleanup fns
            → atomCache.delete(cacheKey) for every atom in that scope
```

---

## Out of Scope (Deferred)

- Timer-based GC (good fallback, tracked in decisions.md)
- Cold storage / two-tier cache (strong future direction, tracked above)
- `FamilyState` GC (non-component-scoped — Phase 2)
- Cascade across nested `ComponentInstanceContext`s
- Jotai store value reset after eviction (a later task — factory cache eviction
  is sufficient for now)
- Automatic GC without developer-registered lifecycle handlers
