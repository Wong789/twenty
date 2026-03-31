# Upgrade Experience V2 -- Design Document

## Problem Statement

The current upgrade system has several pain points:

- **No cross-version upgrade**: a workspace must be on exactly the previous minor version to upgrade. Skipping versions requires stepping through each intermediate release.
- **Opaque errors**: failures surface as raw stack traces with no structured reporting or actionable diagnostics.
- **Misleading abstractions**: the command runner inheritance chain (`MigrationCommandRunner` -> `WorkspacesMigrationCommandRunner` -> `ActiveOrSuspendedWorkspacesMigrationCommandRunner` -> `UpgradeCommandRunner`) conflates global operations with per-workspace operations under a single hierarchy.
- **No post-upgrade health check**: after upgrade, there is no validation that the workspace is in a consistent state.
- **No workspace status visibility**: end users (self-hosted admins) have no way to see their workspace version or whether it is out of date.

## Success Metrics

- **Cross-version upgrade** works across the ordered list of supported versions (a workspace on `1.18.0` targeting `1.20.0` runs `1.19.0` then `1.20.0` steps sequentially).
- **Patch-version upgrade support**: the upgrade triggers on patch version differences, not just major.minor. Currently `compareVersionMajorAndMinor` ignores patches entirely, meaning a workspace on `1.20.0` is considered "equal" to `1.20.1` and patch-level upgrade steps cannot run.
- **Post-upgrade health check** validates workspace consistency after migration.
- **Improved developer experience** for twenty-eng: clear command taxonomy, scoped responsibilities, easy to add new upgrade steps.
- **Report-a-problem template** that gathers workspace status including upgrade stack traces.
- **Settings page** (follow-up) shows current workspace version; if it differs from the installed server version, prompts the user to contact their administrator.

---

## Core Principles

- **Idempotency**: all upgrade commands -- both `GlobalCommand` and `PerWorkspaceCommand` -- must be idempotent. Running the same command twice on the same workspace (or the same global state) produces the same result as running it once. This is critical because global commands affect the shared database and may run before all workspaces are upgraded, and single-workspace upgrades re-run global commands that may have already been applied.
- **Forward compatibility of global changes**: global commands (especially `fast` ones like TypeORM migrations) must produce a schema that is compatible with workspaces still on older versions. A global schema change that breaks older workspaces violates the cross-version upgrade contract.
- **No downgrade support**: the upgrade path is forward-only.

---

## Command Taxonomy

Replace the current deep inheritance chain with two explicit base classes and an orchestrator.

### Base Command Types

- **GlobalCommand**: Runs once, globally, workspace-agnostic. Example: running pending TypeORM core migrations (`transaction: 'each'`), applying a breaking schema change.
- **PerWorkspaceCommand**: Iterates over all active/suspended workspaces and executes per-workspace logic. Example: backfilling data, migrating workspace schemas.

### Version Step Bundle: Fast and Slow

Each version defines its upgrade steps as two ordered arrays:

- **`fast`**: Commands that must execute quickly (e.g. breaking schema changes, TypeORM migrations). Contains **only `GlobalCommand` entries**. These run first.
- **`slow`**: Commands that may take longer (backfills, data migrations). Contains an **interleaved mix of `GlobalCommand` and `PerWorkspaceCommand` entries**. These run after `fast` completes.

```typescript
const steps_1200: VersionUpgradeSteps = {
  fast: [
    { type: 'global', command: this.typeOrmMigrationCommand },
  ],
  slow: [
    { type: 'per-workspace', command: this.backfillCommandMenuItemsCommand },
    { type: 'per-workspace', command: this.migrateRichTextToTextCommand },
    { type: 'global', command: this.someGlobalCleanupCommand },
    { type: 'per-workspace', command: this.backfillSelectFieldOptionIdsCommand },
  ],
};
```

### Orchestrator

`UpgradeCommandOrchestrator` (renamed from `UpgradeCommand`) is responsible for:

1. Resolving the current app version and the supported upgrade range.
2. Determining which version steps to run based on the workspace's current version.
3. **Phase 1**: run `fast` arrays (global-only) for all intermediate versions up to the target.
4. **Phase 2**: for each workspace (sorted by version desc), walk through missing version steps running each `slow` array as-is (global + per-workspace interleaved).

### Diagram

```mermaid
flowchart TD
  CLI["CLI: upgrade command"] --> Orchestrator["UpgradeCommandOrchestrator"]
  Orchestrator --> ResolveTarget["Resolve target version + supported range"]
  ResolveTarget --> FastLoop["Phase 1: for each version, run fast array (global only)"]
  FastLoop --> SortWs["Phase 2: sort workspaces by version desc"]
  SortWs --> WsLoop["For each workspace"]
  WsLoop --> DetectGap["Detect version gap"]
  DetectGap --> VersionStepLoop["For each missing version step"]
  VersionStepLoop --> SlowStep["For each step in slow array"]
  SlowStep --> IsGlobal{Step type?}
  IsGlobal -->|global| RunGlobal["Execute GlobalCommand (idempotent)"]
  IsGlobal -->|per-workspace| RunPerWs["Execute for this workspace"]
  RunGlobal --> SlowStep
  RunPerWs --> SlowStep
  SlowStep --> StampVersion["Stamp workspace version"]
  StampVersion --> VersionStepLoop
  VersionStepLoop --> WsLoop
  WsLoop --> HealthCheck["Post-upgrade health check"]
  HealthCheck --> Report["Generate upgrade report"]
```

---

## Cross-Version Upgrade

### How It Works

`UPGRADE_COMMAND_SUPPORTED_VERSIONS` remains an ordered list of versions (e.g. `['1.18.0', '1.19.0', '1.20.0']`). The orchestrator uses it as a timeline:

1. Read the workspace's current version.
2. Find that version in the ordered list.
3. Run all version steps from the next entry up to (and including) the current app version, sequentially.

No per-version allowlist is needed. The ordered list itself defines the upgrade path. The oldest entry in the list is the oldest supported source version -- anything below it is out of range.

### Key Principle: Rescue Stragglers Within the Supported Range

The cross-version upgrade attempts to bring **all** workspaces within the supported range up to the target version -- not just workspaces that were on the previously installed version. If a workspace was already behind before this deploy (e.g. it failed a previous upgrade), the orchestrator still attempts to walk it through all intermediate steps.

This means the `1.20.0` codebase must ship all upgrade steps back to the oldest supported version. If `UPGRADE_COMMAND_SUPPORTED_VERSIONS` is `['1.17.0', '1.18.0', '1.19.0', '1.20.0']`, then the `1.20.0` release includes `steps_1180`, `steps_1190`, and `steps_1200`.

Workspaces below the oldest supported version (e.g. `1.16.0` when the oldest is `1.17.0`) are out of range and handled by the guard/force logic.

### Execution Flow

The upgrade runs in two phases:

**Phase 1 -- Fast commands (global, all intermediate versions)**:

The orchestrator runs the `fast` array for **every version from the oldest needed up to the target**, in order. Since fast commands are global and affect the shared database, they must all run to bring the core schema to the target state. TypeORM migrations are naturally incremental (pending migrations run in timestamp order), but non-TypeORM global commands in `fast` also need to execute for each intermediate version.

**Phase 2 -- Slow commands (per-workspace, sorted by version desc)**:

Workspaces are sorted by version descending (most up-to-date first). This gets the majority upgraded quickly -- most workspaces are near the latest version and only need one version step. Stragglers on older versions are handled after.

For each workspace, the orchestrator walks through the missing version steps in order, running each version's `slow` array **as-is** -- both `global` and `per-workspace` entries, interleaved, preserving their defined order. Global commands in `slow` are idempotent and no-op after their first execution. The workspace version is stamped after each version step completes.

### Real-World Example

**Context**: the server was previously running `1.18.0`. We are now deploying `1.20.0`.

**Supported versions**: `['1.17.0', '1.18.0', '1.19.0', '1.20.0']`

**Workspaces**:

- Workspace A: version `1.18.0` (was current, one step behind target)
- Workspace B: version `1.17.0` (straggler -- failed or was skipped during the `1.18.0` upgrade)
- Workspace C: version `1.18.0` (was current, one step behind target)

**Version steps shipped with `1.20.0`**:

```typescript
this.allSteps = {
  '1.18.0': steps_1180,  // for workspaces on 1.17.0
  '1.19.0': steps_1190,  // for workspaces on 1.18.0
  '1.20.0': steps_1200,  // for workspaces on 1.19.0
};
```

**Phase 1 -- Fast (global, sequential by version)**:

The orchestrator determines the oldest workspace version (`1.17.0`) and runs fast commands from `1.18.0` through `1.20.0`:

```
> Running fast commands (global)...
  1.18.0.fast:
    [global] TypeORM migrations for 1.18.0    OK (already applied, no-op)
  1.19.0.fast:
    [global] TypeORM migrations for 1.19.0    OK
    [global] Schema change ABC                OK
  1.20.0.fast:
    [global] TypeORM migrations for 1.20.0    OK
    [global] Breaking schema change XYZ       OK
```

Note: `1.18.0.fast` was already applied when the server was on `1.18.0` -- it no-ops thanks to idempotency. The orchestrator runs it anyway because it doesn't track which fast commands were previously run; idempotency makes this safe.

**Phase 2 -- Slow (per-workspace, sorted by version desc)**:

Sorted: A (`1.18.0`), C (`1.18.0`), then B (`1.17.0`).

```
> Workspace A (1.18.0 -> 1.20.0)
  Needs: steps_1190.slow then steps_1200.slow
  Running steps_1190.slow:
    [per-workspace] backfill feature flags    OK
    [global] cleanup temp table               OK (idempotent, first execution)
  Version stamped to 1.19.0
  Running steps_1200.slow:
    [per-workspace] backfillCommandMenuItems  OK
    [per-workspace] migrateRichTextToText     OK
  Version stamped to 1.20.0

> Workspace C (1.18.0 -> 1.20.0)
  Needs: steps_1190.slow then steps_1200.slow
  Running steps_1190.slow:
    [per-workspace] backfill feature flags    OK
    [global] cleanup temp table               OK (no-op, idempotent)
  Version stamped to 1.19.0
  Running steps_1200.slow:
    [per-workspace] backfillCommandMenuItems  OK
    [per-workspace] migrateRichTextToText     OK
  Version stamped to 1.20.0

> Workspace B (1.17.0 -> 1.20.0)
  Needs: steps_1180.slow then steps_1190.slow then steps_1200.slow
  Running steps_1180.slow:
    [per-workspace] migrate legacy data       OK
    [per-workspace] backfill new column       OK
  Version stamped to 1.18.0
  Running steps_1190.slow:
    [per-workspace] backfill feature flags    OK
    [global] cleanup temp table               OK (no-op, idempotent)
  Version stamped to 1.19.0
  Running steps_1200.slow:
    [per-workspace] backfillCommandMenuItems  OK
    [per-workspace] migrateRichTextToText     OK
  Version stamped to 1.20.0
```

**Key observations**:

- Workspace version is stamped after each version step, not at the end. If B fails during `steps_1190.slow`, it stays on `1.18.0` and can be retried later.
- Global commands in `slow` (like "cleanup temp table") exist because their ordering relative to per-workspace steps matters (e.g. a global cleanup that must happen after a per-workspace backfill). They run once on the first workspace that reaches them, then no-op for subsequent workspaces thanks to idempotency.
- Phase 1 only runs `fast` arrays (global-only, must be quick). It does **not** extract globals from `slow` -- those stay in Phase 2 to preserve ordering.
- The `1.18.0` upgrade steps that previously failed for B are retried -- this is the "rescue straggler" behavior.

### Failure Isolation

If a workspace fails during any slow step, the orchestrator logs the failure and continues to the next workspace. The failed workspace keeps the version stamp of the last completed step. The final report includes per-workspace status (success / failure / skipped / refused).

### Diagram

```mermaid
flowchart TD
  Start["Orchestrator starts"] --> FindOldest["Find oldest workspace version in supported range"]
  FindOldest --> FastLoop["For each version from oldest+1 to target"]
  FastLoop --> RunFast["Run fast array (global commands)"]
  RunFast --> FastLoop
  FastLoop --> SortWs["Sort workspaces by version desc"]
  SortWs --> WsLoop["For each workspace"]
  WsLoop --> DetectGap["Detect version gap: workspace version -> target"]
  DetectGap --> VersionStepLoop["For each missing version step"]
  VersionStepLoop --> RunSlow["Run slow array for this version step"]
  RunSlow --> StampVersion["Stamp workspace to this version"]
  StampVersion --> VersionStepLoop
  VersionStepLoop -->|"failure: log and continue"| WsLoop
  WsLoop --> Report["Generate upgrade report"]
```

### Cloud Production Mode

On cloud prod, the orchestrator runs with `--force` semantics by default:

- **Fast commands always run unconditionally** for all intermediate versions up to the target. The shared database must be at the target schema regardless of individual workspace states.
- **Slow commands are guarded per workspace**: if a workspace is below the oldest supported version, its slow steps are skipped and it is reported as "refused" in the final report (rather than blocking the entire upgrade).
- Workspaces are processed most-up-to-date first to unblock the majority quickly.

### Self-Hosted Mode

- **Default**: if any workspace is below the oldest supported version, the upgrade refuses before running anything (including fast commands). A clear message lists the affected workspaces and the minimum supported source version.
- **--force**: overrides the guard -- fast commands run unconditionally, slow commands are attempted per workspace with failures isolated and reported.
- No downgrade support.

### Single-Workspace Upgrade (`-w`)

When targeting a single workspace, the orchestrator still runs all global commands (`fast` for all intermediate versions, and any `global` entries in `slow`) because they affect the shared database. This means global changes "leak" to all other workspaces. This is acceptable because:

- All commands are idempotent -- when other workspaces are upgraded later, global commands no-op.
- Global schema changes are forward-compatible by design -- older workspaces continue to work against the new schema.

The orchestrator logs a clear warning when running in single-workspace mode: global commands will be applied to the shared database and affect all workspaces.

### Breaking Changes and Stale Versions

Breaking changes in the upgrade history are avoided unless they would break the cross-version upgrade path. When a breaking change is unavoidable:

- The breaking change may make one or more commands in an older version's steps **stale** (e.g. a command that backfills a column that no longer exists after the breaking change).
- When any command in a version's steps becomes stale, the **entire version must be dropped** from `UPGRADE_COMMAND_SUPPORTED_VERSIONS` -- not just the individual stale command. A workspace on that version needs all of its steps to upgrade successfully; if even one step is broken, the full upgrade path from that version is invalid.
- All of that version's steps (`fast` and `slow`) are removed from the codebase as a unit.

Since the supported range is a contiguous upgrade path, invalidating a version also invalidates **every version below it** -- those workspaces would need to pass through the invalidated version's steps to reach the target.

Example: `steps_1190` has a command that backfills column `X`. In `1.21.0`, a breaking change drops column `X`. That single stale command invalidates the entire `1.19.0` upgrade path. But `1.18.0` and `1.17.0` are also invalidated because they depend on `steps_1190` to reach the target. All three versions and their steps are removed from `UPGRADE_COMMAND_SUPPORTED_VERSIONS`. The oldest supported source version becomes `1.20.0`.

### Workspace Recap Tooling

A dedicated recap/status command should provide visibility into this:

- List all workspaces with their current version.
- Flag workspaces that are **below the supported range** (stragglers that can no longer be upgraded by the current version).
- Flag workspaces that are **at risk** of falling out of range if the next version introduces a breaking change.
- Warn when a version is about to be or has been dropped from the supported list, and which workspaces are affected.

This recap is also the foundation for the "report-a-problem" template and the settings page workspace status (follow-up).

---

## Post-Upgrade Health Check

After all version steps complete, the orchestrator runs a health check per workspace:

- **Schema consistency**: verify expected tables/columns exist after migrations.
- **Version stamp**: confirm `workspace.version` was updated to the target version.
- **Metadata sync**: verify metadata is consistent with the new version's expectations.

Health check results are included in the upgrade report. Failures are warnings (the upgrade itself already succeeded), not rollback triggers.

---

## Error Reporting and Logging

### Structured Upgrade Report

Replace raw stack traces with a structured report:

- Per-workspace status: success / failure / skipped (already at target version) / refused (below range).
- For failures: the step that failed, a human-readable error message, and the full stack trace captured (not dumped to stdout).
- Summary: total workspaces, succeeded, failed, skipped.

### Report-a-Problem Template (follow-up)

A template that gathers:

- Current workspace version vs installed server version.
- Upgrade report (if available).
- Stack traces from the last failed upgrade attempt.
- Environment info (Postgres version, Redis status, etc.).

---

## Frontend (Follow-Up)

Out of scope for this doc but planned:

- **General Settings page**: display current workspace version. If it differs from the installed server version, show a banner prompting the user to contact their administrator.
- **Report-a-problem**: pre-filled template using the workspace status endpoint.

---

## Incremental Implementation Roadmap

The refactor is designed to be shipped incrementally, phase by phase, without requiring a big-bang rewrite.

### Phase 1: Command Taxonomy Refactor (start here)

**Goal**: Introduce `GlobalCommand` and `PerWorkspaceCommand` base classes and the `VersionUpgradeSteps` (`fast`/`slow`) format, applied to the current version's upgrade steps.

**What changes**:

- Create `GlobalCommand` and `PerWorkspaceCommand` abstract base classes.
- Refactor the current `commands_1200` array into a typed `steps_1200: VersionUpgradeSteps` with `fast` (global-only) and `slow` (interleaved global + per-workspace) arrays.
- TypeORM migration becomes a `GlobalCommand` entry in the `fast` array.
- The orchestrator (`UpgradeCommandOrchestrator`) replaces `UpgradeCommandRunner` and walks `fast` then `slow`, dispatching each entry based on its type.
- Individual upgrade commands (e.g. `backfillCommandMenuItems`) are migrated to extend `PerWorkspaceCommand`.
- The old inheritance chain (`MigrationCommandRunner` -> `WorkspacesMigrationCommandRunner` -> `ActiveOrSuspendedWorkspacesMigrationCommandRunner` -> `UpgradeCommandRunner`) is removed.

**What stays the same**:

- `UpgradeCommand` remains the nest-commander entry point, delegating to the orchestrator.
- Version comparison still uses major.minor (patch support comes in Phase 2).
- Only the current version's steps are refactored; older version entries (e.g. `1.19.0: []`) are left as-is or trivially wrapped.

**Validation**: the upgrade command produces the same outcome as before -- same TypeORM migrations run, same per-workspace steps execute in the same order.

### Phase 2: Cross-Version Upgrade

**Goal**: Allow a workspace to upgrade across multiple minor versions in a single run.

**What changes**:

- The orchestrator iterates through `UPGRADE_COMMAND_SUPPORTED_VERSIONS` from the workspace's current version to the target, running each version's `VersionUpgradeSteps` sequentially.
- Version comparison is updated to support patch-level diffs (not just major.minor).
- Guard logic updated: the minimum supported source version is the oldest entry in the supported versions list.
- `--force` behavior preserved for cloud prod.

### Phase 3: Health Check and Error Reporting

**Goal**: Structured post-upgrade validation and actionable error output.

**What changes**:

- Post-upgrade health check runs after all version steps complete (schema consistency, version stamp, metadata sync).
- Structured upgrade report replaces raw stack traces: per-workspace status, failure details with captured stack traces, summary counts.
- Report-a-problem template groundwork (workspace status endpoint).

### Phase 4: Frontend (Follow-Up)

- Settings page: workspace version display, version mismatch banner.
- Report-a-problem: pre-filled template from workspace status endpoint.

---

## Migration Path from Current Architecture

The current inheritance chain in `command-runners/` is replaced in Phase 1:

- `MigrationCommandRunner` -- Removed (options like `--dry-run` move to orchestrator)
- `WorkspacesMigrationCommandRunner` -- Becomes the `PerWorkspaceCommand` base class
- `ActiveOrSuspendedWorkspacesMigrationCommandRunner` -- Folded into `PerWorkspaceCommand` (active/suspended is the default filter)
- `UpgradeCommandRunner` -- Becomes `UpgradeCommandOrchestrator`
- `UpgradeCommand` -- Stays as the nest-commander entry point, delegates to orchestrator

Individual upgrade steps (e.g. `backfillCommandMenuItems`) keep their current granularity but extend either `GlobalCommand` or `PerWorkspaceCommand` explicitly.
