# Upgrade Experience V2 -- Design Document

## Problem Statement

The current upgrade system has several pain points:

- **No cross-version upgrade**: a workspace must be on exactly the previous minor version to upgrade. Skipping versions requires stepping through each intermediate release.
- **Opaque errors**: failures surface as raw stack traces with no structured reporting or actionable diagnostics.
- **Misleading abstractions**: the command runner inheritance chain (`MigrationCommandRunner` -> `WorkspacesMigrationCommandRunner` -> `ActiveOrSuspendedWorkspacesMigrationCommandRunner` -> `UpgradeCommandRunner`) conflates global operations with per-workspace operations under a single hierarchy.
- **No post-upgrade health check**: after upgrade, there is no validation that the workspace is in a consistent state.
- **No workspace status visibility**: end users (self-hosted admins) have no way to see their workspace version or whether it is out of date.

## Success Metrics

- **Cross-version upgrade** works across the ordered list of supported versions (a workspace on `1.18.0` targeting `1.20.0` runs `1.19.0` then `1.20.0` bundles sequentially).
- **Patch-version upgrade support**: the upgrade triggers on patch version differences, not just major.minor. Currently `compareVersionMajorAndMinor` ignores patches entirely, meaning a workspace on `1.20.0` is considered "equal" to `1.20.1` and patch-level upgrade commands cannot run.
- **Post-upgrade health check** validates workspace consistency after migration.
- **Improved developer experience** for twenty-eng: clear command taxonomy, scoped responsibilities, easy to add new version bundles and commands.
- **Report-a-problem template** that gathers workspace status including upgrade stack traces.
- **Settings page** (follow-up) shows current workspace version; if it differs from the installed server version, prompts the user to contact their administrator.

---

## Core Principles

- **Sequentiality**: the upgrade processes one version bundle at a time, fully completing it (`instanceCommands`, stamp `instanceVersion`, then `perWorkspaceCommands` for all workspaces) before moving to the next. There is no cross-version interleaving -- the instance must finish upgrading all workspaces to version N before any version N+1 commands run.
- **Idempotency**: all upgrade commands -- both `GlobalCommand` (in `instanceCommands`) and `PerWorkspaceCommand` (in `perWorkspaceCommands`) -- must be idempotent. Running the same command twice on the same workspace (or the same global state) produces the same result as running it once. This is critical because re-runs after partial failures must be safe, and single-workspace upgrades re-run global commands that may have already been applied.
- **Forward compatibility of global changes**: global commands (especially `instanceCommands` like TypeORM migrations) must produce a schema that is compatible with workspaces still at `instanceVersion - 1`. Since `instanceVersion` is stamped after `instanceCommands`, workspaces are still at the previous version when the global schema changes land. A global schema change that breaks those workspaces violates the upgrade contract.
- **No downgrade support**: the upgrade path is forward-only.

---

## Instance Version

The upgrade system introduces a new concept: **`instanceVersion`** -- the version the instance's global state (schema, core data) has been upgraded to. This is distinct from:

- **`APP_VERSION`**: the version of the deployed Twenty codebase (set at build time, read from env/package).
- **Workspace version**: the version each individual workspace has been upgraded to.

`instanceVersion` tracks how far the shared database has progressed through the upgrade timeline. It is the gate that controls which workspaces are eligible for upgrade.

### Storage

Stored in the existing `KeyValuePair` table (`core` schema) as a `CONFIG_VARIABLE` entry with `userId = null` and `workspaceId = null`, key = `INSTANCE_VERSION`. This leverages the existing `ConfigStorageService` / `ConfigVariables` infrastructure -- no new table or schema change required.

### Lifecycle

1. Before any upgrade, `instanceVersion` reflects the last version whose `instanceCommands` completed (e.g. `1.18.0`).
2. The orchestrator picks the next version bundle in `UPGRADE_COMMAND_SUPPORTED_VERSIONS` (e.g. `bundle_1190`).
3. The `instanceCommands` run (global schema changes).
4. `instanceVersion` is stamped to `1.19.0`. The shared database is now at this version's global state.
5. The `perWorkspaceCommands` run for all workspaces at `1.18.0` (i.e. `instanceVersion - 1`).
6. Once all workspaces succeed, the orchestrator moves to the next version bundle.

`instanceVersion` advances after `instanceCommands` complete -- it reflects the global schema state. Workspace versions catch up via `perWorkspaceCommands`. During cloud development, `instanceVersion` is bumped on each deploy that runs `instanceCommands`, while workspace versions stay at the previous stable version until the release owner runs the full orchestrator (see "Deploying a Partial Next Version to Cloud Production").

### Workspace Eligibility

A workspace can only be upgraded by a version bundle if it is at exactly `instanceVersion - 1` -- the version immediately before the current instance version in `UPGRADE_COMMAND_SUPPORTED_VERSIONS`. Workspaces that are further behind are not eligible and must be addressed before the instance can proceed to the next version.

### Initial Value

On a fresh install, `instanceVersion` is set to `APP_VERSION` (no upgrade needed). On an existing instance that predates this feature, the migration that introduces `instanceVersion` seeds it from the current `APP_VERSION` at the time of deployment.

---

## Command Taxonomy

Replace the current deep inheritance chain with explicit base classes and an orchestrator.

### Terminology

- **UpgradeCommandOrchestrator**: the top-level orchestrator that resolves versions, processes version bundles sequentially, and manages the upgrade flow.
- **UpgradeVersionBundle**: the per-version `{ instanceCommands, perWorkspaceCommands }` object (e.g. `bundle_1200`). Groups all commands needed to upgrade workspaces *to* that version.
- **UpgradeCommand**: an individual command within a bundle's `instanceCommands` or `perWorkspaceCommands` array. Base class for all upgrade commands. Subtypes:
  - **GlobalCommand**: runs once, globally, workspace-agnostic. Used **only in `instanceCommands`**. Example: TypeORM core migrations, breaking schema changes.
  - **PerWorkspaceCommand**: iterates over all active/suspended workspaces and executes per-workspace logic. Used **only in `perWorkspaceCommands`**. Example: backfilling data, migrating workspace schemas.

### Command Contract

Every `UpgradeCommand` (both `GlobalCommand` and `PerWorkspaceCommand`) must follow a strict contract:

**Return type -- discriminated union**:

```typescript
type UpgradeCommandResult =
  | { status: 'success' }
  | { status: 'failure'; error: string };
```

- Commands must **never throw**. They return `{ status: 'failure', error }` instead.
- The orchestrator wraps each command execution in a try/catch to handle unexpected exceptions -- these are converted into a `failure` result with the caught error message and stack.

**Log capture via correlation ID**:

Commands use the standard NestJS `Logger` (`this.logger`) -- no custom callback or API change. The orchestrator captures all logs emitted during a command's execution using a correlation ID:

- Before executing a command, the orchestrator sets a correlation ID (e.g. `commandName + workspaceId`) in async local storage.
- The global `LoggerService` includes this correlation ID in every log line, regardless of which Logger instance or service emits it (command code, TypeORM, repositories, framework internals).
- A per-command buffer captures all correlated log lines during execution. This gives true per-command log isolation -- ORM queries, SQL errors, service calls, and the command's own narrative all appear in one unified stream.
- Tail-truncated to last 5,000 lines if exceeded. A `[TRUNCATED]` header is prepended when truncation occurs.
- On **failure**: the buffer is stored in the `logs` column of the relevant history table (`instance_upgrade_history` or `workspace_upgrade_history`).
- On **success**: the buffer is discarded (already written to stdout).

This approach avoids the fragility of wrapping individual Logger instances and naturally supports future parallelized workspace upgrades (each command execution has its own correlation ID).

**Orchestrator error handling**:

```typescript
let result: UpgradeCommandResult;

try {
  result = await command.execute(context);
} catch (unexpectedError) {
  result = {
    status: 'failure',
    error: `${unexpectedError.message}\n${unexpectedError.stack}`,
  };
}
```

### Version Bundles

Each version defines its upgrade bundle as two ordered arrays:

- **`instanceCommands`**: Global commands that must execute quickly (e.g. breaking schema changes, TypeORM migrations). Contains **only `GlobalCommand` entries**. These run first, before any workspace is touched.
- **`perWorkspaceCommands`**: Per-workspace commands that may take longer (backfills, data migrations). Contains **only `PerWorkspaceCommand` entries**. These run after `instanceCommands` completes, iterating over all eligible workspaces.

```typescript
const bundle_1200: UpgradeVersionBundle = {
  instanceCommands: [
    { type: 'global', command: this.typeOrmMigrationCommand },
  ],
  perWorkspaceCommands: [
    { type: 'per-workspace', command: this.backfillCommandMenuItemsCommand },
    { type: 'per-workspace', command: this.migrateRichTextToTextCommand },
    { type: 'per-workspace', command: this.backfillSelectFieldOptionIdsCommand },
  ],
};
```

### Orchestrator

`UpgradeCommandOrchestrator` (renamed from `UpgradeCommand`) is responsible for:

1. Resolving the current `APP_VERSION`, `instanceVersion`, and the supported upgrade range.
2. For each version bundle from `instanceVersion + 1` to `APP_VERSION` (sequentially):
   a. Run the `instanceCommands` array (global commands). Skip commands already recorded as `completed` in `instance_upgrade_history`.
   b. Stamp `instanceVersion` to this version.
   c. Run the `perWorkspaceCommands` array for all workspaces at `instanceVersion - 1`. Skip commands already recorded as `completed` in `workspace_upgrade_history` for each workspace. Stamp each workspace's version after its commands complete.
   d. Verify all workspaces succeeded before moving to the next version bundle.

---

## Cross-Version Upgrade

### How It Works

`UPGRADE_COMMAND_SUPPORTED_VERSIONS` remains an ordered list of versions (e.g. `['1.18.0', '1.19.0', '1.20.0']`). The orchestrator uses it as a timeline, combined with `instanceVersion` to determine where to start:

1. Read `instanceVersion` from the database.
2. Find the next version after `instanceVersion` in the ordered list.
3. Process each version bundle sequentially up to `APP_VERSION`, fully completing one before starting the next.

No per-version allowlist is needed. The ordered list itself defines the upgrade path. The oldest entry in the list is the oldest supported source version -- anything below it is out of range.

The `1.20.0` codebase must ship all version bundles back to the oldest supported version. If `UPGRADE_COMMAND_SUPPORTED_VERSIONS` is `['1.17.0', '1.18.0', '1.19.0', '1.20.0']`, then the `1.20.0` release includes `bundle_1180`, `bundle_1190`, and `bundle_1200`.

### Execution Flow

The upgrade processes **one version bundle at a time**, fully completing it before moving to the next:

**For each version bundle** (from `instanceVersion + 1` to `APP_VERSION`):

1. **Run `instanceCommands` array** (global commands). Commands already recorded as `completed` in `instance_upgrade_history` are skipped. If any command fails, the upgrade aborts immediately. There is no rollback of previously completed commands; each runs in its own transaction. The operator must fix the issue and re-run.

2. **Stamp `instanceVersion`** to this version. The shared database is now at this version's global state.

3. **Run `perWorkspaceCommands` array** for all workspaces at `instanceVersion - 1`. The orchestrator queries for workspaces at exactly the previous version and runs each `PerWorkspaceCommand` in order. Commands already recorded as `completed` in `workspace_upgrade_history` for a given workspace are skipped. Each workspace's version is stamped after all its per-workspace commands complete.

4. **All workspaces must succeed** before the orchestrator moves to the next version bundle. If any workspace fails during a per-workspace command, the upgrade **stops entirely**. The failed workspace keeps its current version stamp. The operator must fix the issue and re-run.

### No Straggler Rescue

Unlike a model where the orchestrator walks behind-workspaces through multiple intermediate bundles, the sequential model requires workspaces to be at exactly `instanceVersion - 1` to be eligible for upgrade. Workspaces that are further behind (e.g. they failed a previous upgrade cycle) are **not eligible** -- they block the instance from proceeding to the next version.

This is intentional: the hard-block forces operators to resolve failures before moving forward, preventing a growing tail of broken workspaces across versions.

### Real-World Example

**Context**: the server was previously running `1.18.0` (`instanceVersion = 1.18.0`). We are now deploying `1.20.0`.

**Supported versions**: `['1.17.0', '1.18.0', '1.19.0', '1.20.0']`

**Workspaces**: all at `1.18.0` (A, B, C).

**Version bundles shipped with `1.20.0`**:

```typescript
this.allBundles = {
  '1.18.0': bundle_1180,  // for workspaces on 1.17.0
  '1.19.0': bundle_1190,  // for workspaces on 1.18.0
  '1.20.0': bundle_1200,  // for workspaces on 1.19.0
};
```

**Version bundle 1.19.0**:

```
> instanceVersion = 1.18.0, target = 1.20.0
> Processing bundle_1190...

  instanceCommands:
    [global] TypeORM migrations for 1.19.0    OK
    [global] Schema change ABC                OK
  instanceVersion stamped to 1.19.0

  perWorkspaceCommands (workspaces at 1.18.0: A, B, C):
    > Workspace A:
      [per-workspace] backfill feature flags    OK
      Workspace A stamped to 1.19.0
    > Workspace B:
      [per-workspace] backfill feature flags    FAILED
      *** Upgrade stops. Workspace B stays at 1.18.0. ***
```

**The upgrade halts.** `instanceVersion` is `1.19.0` (stamped after `instanceCommands`), but workspace B is still at `1.18.0`. Workspace A is at `1.19.0`, workspace C is at `1.18.0` (not yet attempted).

The operator investigates workspace B's failure (using the `workspace_upgrade_history` table and its captured logs), fixes the underlying issue, and re-runs the upgrade command.

**Re-run**:

```
> instanceVersion = 1.19.0, target = 1.20.0
> Processing bundle_1190...

  instanceCommands:
    [global] TypeORM migrations for 1.19.0    SKIP (completed in history)
    [global] Schema change ABC                SKIP (completed in history)
  instanceVersion already at 1.19.0 (no-op)

  perWorkspaceCommands (workspaces at 1.18.0: B, C):
    > Workspace A: already at 1.19.0, not eligible (skipped)
    > Workspace B:
      [per-workspace] backfill feature flags    OK (fixed)
      Workspace B stamped to 1.19.0
    > Workspace C:
      [per-workspace] backfill feature flags    OK
      Workspace C stamped to 1.19.0

> Processing bundle_1200...

  instanceCommands:
    [global] TypeORM migrations for 1.20.0    OK
    [global] Breaking schema change XYZ       OK
  instanceVersion stamped to 1.20.0

  perWorkspaceCommands (workspaces at 1.19.0: A, B, C):
    > Workspace A:
      [per-workspace] backfillCommandMenuItems  OK
      [per-workspace] migrateRichTextToText     OK
      Workspace A stamped to 1.20.0
    > Workspace B:
      [per-workspace] backfillCommandMenuItems  OK
      [per-workspace] migrateRichTextToText     OK
      Workspace B stamped to 1.20.0
    > Workspace C:
      [per-workspace] backfillCommandMenuItems  OK
      [per-workspace] migrateRichTextToText     OK
      Workspace C stamped to 1.20.0
```

**Key observations**:

- The upgrade is strictly sequential: `bundle_1190` must fully complete (`instanceCommands` + all workspaces `perWorkspaceCommands`) before `bundle_1200` starts.
- `instanceVersion` is stamped after `instanceCommands` complete -- it advanced to `1.19.0` even though workspace B failed. On re-run, the orchestrator sees `instanceVersion = 1.19.0` and skips `instanceCommands` for `bundle_1190`.
- On re-run, instance commands are skipped (recorded as `completed` in `instance_upgrade_history`). Workspace A is already at `1.19.0` so it's not eligible for `bundle_1190.perWorkspaceCommands`.
- `perWorkspaceCommands` contains only `PerWorkspaceCommand` entries. Any global work belongs in `instanceCommands`.
- The failure of workspace B blocked the entire upgrade, forcing the operator to fix it before proceeding.

### Failure Behavior

- **Instance command failure**: the upgrade aborts immediately. `instanceVersion` is not stamped (the failing command's transaction is rolled back, previously completed commands remain applied). No per-workspace commands run.
- **Per-workspace command failure (any workspace)**: the upgrade stops entirely. `instanceVersion` was already stamped (after `instanceCommands`). The failed workspace keeps its current version. Workspaces already upgraded in this bundle's per-workspace pass keep their new version stamp. The operator must fix the issue and re-run -- already-completed commands are skipped via the history tables.

The final report includes per-workspace status (success / failure / not-attempted).

### Guard Logic

Before starting the upgrade, the orchestrator checks for workspaces below `instanceVersion - 1` (relative to the first version bundle to process). These workspaces are too far behind to be eligible:

- **Self-hosted (default)**: the upgrade refuses to start. A clear message lists the affected workspaces and the minimum required version.
- **Self-hosted (`--force`)**: the upgrade proceeds, but ineligible workspaces are skipped and reported as "refused". The hard-block on workspace failure still applies to eligible workspaces.

### Single-Workspace Upgrade (`-w`)

When targeting a single workspace, the orchestrator still runs all `instanceCommands` (global) for the relevant version bundle because they affect the shared database, and stamps `instanceVersion`. Then only the targeted workspace's `perWorkspaceCommands` run. Other workspaces remain at their current version. This means global changes "leak" to all other workspaces. This is acceptable because:

- All commands are idempotent -- when other workspaces are upgraded later, global commands no-op.
- Global schema changes are forward-compatible by design -- workspaces at `instanceVersion - 1` continue to work against the new schema.

The orchestrator logs a clear warning when running in single-workspace mode: global commands will be applied to the shared database and affect all workspaces.

### Breaking Changes and Stale Versions

Breaking changes in the upgrade history are avoided unless they would break the cross-version upgrade path. When a breaking change is unavoidable:

- The breaking change may make one or more commands in an older version bundle **stale** (e.g. a command that backfills a column that no longer exists after the breaking change).
- When any command in a version bundle becomes stale, the **entire version must be dropped** from `UPGRADE_COMMAND_SUPPORTED_VERSIONS` -- not just the individual stale command. A workspace on that version needs all of its bundle's commands to upgrade successfully; if even one command is broken, the full upgrade path from that version is invalid.
- The entire version bundle (`instanceCommands` and `perWorkspaceCommands`) is removed from the codebase as a unit.

Since the supported range is a contiguous upgrade path, invalidating a version also invalidates **every version below it** -- those workspaces would need to pass through the invalidated version bundle to reach the target.

Example: `bundle_1190` has a command that backfills column `X`. In `1.21.0`, a breaking change drops column `X`. That single stale command invalidates the entire `1.19.0` version bundle. But `1.18.0` and `1.17.0` are also invalidated because they depend on the `1.19.0` bundle to reach the target. All three versions and their bundles are removed from `UPGRADE_COMMAND_SUPPORTED_VERSIONS`. The oldest supported source version becomes `1.20.0`.

### Workspace Recap Tooling

A dedicated recap/status command should provide visibility into this:

- List all workspaces with their current version.
- Flag workspaces that are **below the supported range** (too far behind to be upgraded by the current version).
- Flag workspaces that are **at risk** of falling out of range if the next version introduces a breaking change.
- Warn when a version is about to be or has been dropped from the supported list, and which workspaces are affected.

This recap is also the foundation for the "report-a-problem" template and the settings page workspace status (follow-up).

---

## Upgrade History

Two tables in the **core schema** (shared, not per-workspace) that record command executions. Splitting mirrors the taxonomy: `instanceCommands` -> `instance_upgrade_history`, `perWorkspaceCommands` -> `workspace_upgrade_history`. This avoids nullable foreign keys and makes each table's schema tight and query-friendly.

### `instance_upgrade_history` Table

Tracks execution of `GlobalCommand` entries from `instanceCommands` arrays.

**Columns**:

- `id` (uuid, PK)
- `version` (varchar -- the version bundle this command belongs to, e.g. `1.20.0`)
- `commandName` (varchar -- unique identifier for the command, e.g. `typeOrmMigration`)
- `status` (varchar -- `started` / `completed` / `failed`)
- `runByVersion` (varchar -- the `APP_VERSION` of the Twenty instance that executed this command, e.g. `1.20.1`. Useful for debugging: if a command was completed by a buggy version, this tells you which build ran it.)
- `startedAt` (timestamp)
- `completedAt` (timestamp, nullable)
- `error` (text, nullable -- full error string from `UpgradeCommandResult.error` on failure, including stack trace)
- `logs` (text, nullable -- all log output correlated to this command execution via correlation ID. Tail-truncated to last 5,000 lines if exceeded; when truncated, a `[TRUNCATED - showing last 5000 of N total lines]` header is prepended. Stored on failure only.)
- `createdAt` / `updatedAt` (timestamps)

**Unique key**: `(commandName, version)`.

### `workspace_upgrade_history` Table

Tracks execution of `PerWorkspaceCommand` entries from `perWorkspaceCommands` arrays.

**Columns**:

- `id` (uuid, PK)
- `workspaceId` (uuid, NOT NULL)
- `version` (varchar -- the version bundle this command belongs to, e.g. `1.20.0`)
- `commandName` (varchar -- unique identifier for the command, e.g. `backfillCommandMenuItems`)
- `status` (varchar -- `started` / `completed` / `failed`)
- `runByVersion` (varchar -- the `APP_VERSION` of the Twenty instance that executed this command, e.g. `1.20.1`.)
- `startedAt` (timestamp)
- `completedAt` (timestamp, nullable)
- `error` (text, nullable -- full error string from `UpgradeCommandResult.error` on failure, including stack trace)
- `logs` (text, nullable -- all log output correlated to this command execution via correlation ID. Tail-truncated to last 5,000 lines if exceeded; when truncated, a `[TRUNCATED - showing last 5000 of N total lines]` header is prepended. Stored on failure only.)
- `createdAt` / `updatedAt` (timestamps)

**Unique key**: `(commandName, version, workspaceId)`.

### Shared Lifecycle

Both tables follow the same upsert model -- one row per unique key, updated across re-runs:

- First execution: insert with `status: started`.
- On completion: update to `completed`, clear `error` and `logs`.
- On failure: update to `failed`, store `error` and `logs`.
- On re-run: update the same row back to `started` (clearing previous `error`/`logs`), then to `completed` or `failed`.

A crash mid-command leaves a `started` row with no `completedAt` -- the orchestrator treats this as "not completed" on re-run.

Previous failure logs are overwritten when a command is re-run. This is intentional -- the tables reflect the **current state** of each command, not a full execution history. Failure logs serve their purpose in real-time (the operator reads them, fixes the issue, re-runs). Once the command succeeds, old failure context is no longer relevant.

### Re-Run Behavior and Skip-If-Completed

The orchestrator uses the history tables as a **control mechanism**: before running a command, it checks whether the command is already recorded as `completed` in the relevant history table and skips it if so. This is essential for two reasons:

1. **Partial failure recovery**: on re-run after a failure, already-completed commands are skipped rather than re-executed. This avoids redundant work on expensive commands (e.g. full table scans that would no-op row by row).
2. **Cloud development workflow**: during incremental cloud deploys, commands may be run individually before the stable release. When the release owner runs the full orchestrator, the history tables tell it exactly which commands have already been applied. See "Deploying a Partial Next Version to Cloud Production" for the full workflow.

A `--force-rerun` flag overrides this and re-executes all commands regardless of history. This is useful for debugging or when a command was recorded as `completed` but produced incorrect results (e.g. a buggy version ran it). All commands must still be idempotent -- `--force-rerun` relies on this guarantee.

---

## Deploying a Partial Next Version to Cloud Production

During the development cycle for a new version (e.g. `1.21.0`), the cloud production environment receives incremental deploys before the stable release. Each deploy ships `APP_VERSION = 1.21.0` (not pre-release tags like `1.21.0-alpha.3`). This means new commands may be added to `bundle_1210` between deploys.

### How It Works

- **`instanceCommands` run automatically on each deploy** via a dedicated CLI mode (similar to `database:reset --force`). Each deploy runs the full `instanceCommands` array for the current version bundle. Commands already recorded as `completed` in `instance_upgrade_history` are skipped. New commands added since the last deploy are executed. `instanceVersion` is stamped to `1.21.0` after the first deploy that runs `instanceCommands`.
- **`perWorkspaceCommands` are run manually** by developers via CLI as needed. This gives developers control over when workspace-level migrations run during the development cycle.
- **New workspaces** created during the development cycle get the last **sealed** workspace version (e.g. `1.20.0`). They will be upgraded when the release owner runs the full orchestrator.
- **At stable release**, the release owner runs the full upgrade orchestrator. The orchestrator processes `bundle_1210`: `instanceCommands` are all skipped (already `completed` in history), `instanceVersion` is already `1.21.0` (no-op), and `perWorkspaceCommands` run for all workspaces still at `1.20.0`. Commands already applied manually during the dev cycle are skipped via `workspace_upgrade_history`.

### Real-World Example

**Context**: `1.20.0` is the current stable release. `instanceVersion = 1.20.0`. All workspaces at `1.20.0`. The team is developing `1.21.0`.

**Deploy 1** (ships `APP_VERSION = 1.21.0`, `bundle_1210` has 2 instance commands and 3 per-workspace commands):

```
> APP_VERSION = 1.21.0, instanceVersion = 1.20.0
> Running instanceCommands for bundle_1210 (auto-deploy mode)...

  instanceCommands:
    [global] TypeORM migrations for 1.21.0    OK
    [global] Add new core index              OK
  instanceVersion stamped to 1.21.0

  perWorkspaceCommands: not run (auto-deploy mode only runs instanceCommands)
```

**Deploy 2** (a developer adds a new instance command to `bundle_1210`):

```
> APP_VERSION = 1.21.0, instanceVersion = 1.21.0
> Running instanceCommands for bundle_1210 (auto-deploy mode)...

  instanceCommands:
    [global] TypeORM migrations for 1.21.0    SKIP (completed in history)
    [global] Add new core index              SKIP (completed in history)
    [global] Seed new config variable        OK  (new command)
  instanceVersion already at 1.21.0 (no-op)
```

**Developer manually runs perWorkspaceCommands** for a specific workspace during testing:

```
> Running perWorkspaceCommands for bundle_1210 on workspace D (manual CLI)...

  perWorkspaceCommands:
    > Workspace D:
      [per-workspace] backfillNewField        OK
      [per-workspace] migrateCalendarEvents   OK
      [per-workspace] updateSearchIndex       OK
      Workspace D stamped to 1.21.0
```

**New workspace E is created** during the dev cycle. It gets workspace version `1.20.0`.

**Stable release** -- the release owner runs the full upgrade orchestrator:

```
> APP_VERSION = 1.21.0, instanceVersion = 1.21.0
> Processing bundle_1210...

  instanceCommands:
    [global] TypeORM migrations for 1.21.0    SKIP (completed in history)
    [global] Add new core index              SKIP (completed in history)
    [global] Seed new config variable        SKIP (completed in history)
  instanceVersion already at 1.21.0 (no-op)

  perWorkspaceCommands (workspaces at 1.20.0: A, B, C, E):
    > Workspace A:
      [per-workspace] backfillNewField        OK
      [per-workspace] migrateCalendarEvents   OK
      [per-workspace] updateSearchIndex       OK
      Workspace A stamped to 1.21.0
    > Workspace B:
      [per-workspace] backfillNewField        OK
      [per-workspace] migrateCalendarEvents   OK
      [per-workspace] updateSearchIndex       OK
      Workspace B stamped to 1.21.0
    > Workspace C:
      [per-workspace] backfillNewField        OK
      [per-workspace] migrateCalendarEvents   OK
      [per-workspace] updateSearchIndex       OK
      Workspace C stamped to 1.21.0
    > Workspace D: already at 1.21.0, not eligible (skipped)
    > Workspace E:
      [per-workspace] backfillNewField        OK
      [per-workspace] migrateCalendarEvents   OK
      [per-workspace] updateSearchIndex       OK
      Workspace E stamped to 1.21.0
```

**Key observations**:

- All `instanceCommands` were skipped -- they were already applied across the two deploys during development.
- Workspace D was manually upgraded during development and is skipped (already at `1.21.0`).
- Workspace E was created during the dev cycle with version `1.20.0` and is upgraded now.
- The `skipIfCompleted` mechanism is what makes this workflow possible -- without it, the release orchestrator would redundantly re-execute all commands.

---

## Post-Upgrade Health Check

After all version bundles complete, the orchestrator runs a health check:

- **Instance version**: confirm `instanceVersion` matches `APP_VERSION`.
- **Workspace versions**: confirm all workspace versions match `APP_VERSION`.
- **Command completion**: verify all commands in both `instance_upgrade_history` and `workspace_upgrade_history` are `completed` (no `started` rows without `completedAt`, which would indicate a crash mid-command).

Health check results are included in the upgrade report. Failures are warnings (the upgrade itself already succeeded), not rollback triggers.

Note: broader workspace health (metadata consistency, runtime checks, etc.) is a separate concern from upgrade validation and is out of scope here.

---

## Error Reporting and Logging

### Structured Upgrade Report

Replace raw stack traces with a structured report, built from the `instance_upgrade_history` and `workspace_upgrade_history` tables:

- Per-workspace status: success / failure / not-attempted / refused (below supported range, with `--force`).
- For failures: the command that failed, a human-readable error message, and the full stack trace captured (not dumped to stdout).
- Summary: total workspaces, succeeded, failed, not-attempted.
- Instance version before and after the upgrade.

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

**Goal**: Introduce `GlobalCommand` and `PerWorkspaceCommand` base classes and the `UpgradeVersionBundle` (`instanceCommands`/`perWorkspaceCommands`) format, applied to the current version's upgrade bundle.

**What changes**:

- Create `GlobalCommand` and `PerWorkspaceCommand` abstract base classes.
- Refactor the current `commands_1200` array into a typed `bundle_1200: UpgradeVersionBundle` with `instanceCommands` (global-only) and `perWorkspaceCommands` (per-workspace-only) arrays.
- TypeORM migration becomes a `GlobalCommand` entry in the `instanceCommands` array.
- The orchestrator (`UpgradeCommandOrchestrator`) replaces `UpgradeCommandRunner` and walks `instanceCommands` then `perWorkspaceCommands`, dispatching each entry based on its type.
- Individual upgrade commands (e.g. `backfillCommandMenuItems`) are migrated to extend `PerWorkspaceCommand`.
- The old inheritance chain (`MigrationCommandRunner` -> `WorkspacesMigrationCommandRunner` -> `ActiveOrSuspendedWorkspacesMigrationCommandRunner` -> `UpgradeCommandRunner`) is removed.

**What stays the same**:

- `UpgradeCommand` remains the nest-commander entry point, delegating to the orchestrator.
- Version comparison still uses major.minor (patch support comes in Phase 2).
- Only the current version bundle is refactored; older version entries (e.g. `1.19.0: []`) are left as-is or trivially wrapped.

**Going forward**: the next version's upgrade commands (e.g. `1.21.0`) should be written directly against the new pattern -- extending `GlobalCommand` or `PerWorkspaceCommand` and registered in an `UpgradeVersionBundle`. This validates the new taxonomy on a real upgrade cycle.

**Validation**: the upgrade command produces the same outcome as before -- same TypeORM migrations run, same per-workspace commands execute in the same order.

### Phase 2: Cross-Version Upgrade and Instance Version

**Goal**: Allow an instance to upgrade across multiple minor versions in a single run, with strict sequential version-by-version processing.

**What changes**:

- Introduce `instanceVersion` stored in the `KeyValuePair` table (`CONFIG_VARIABLE`, `userId = null`, `workspaceId = null`, key = `INSTANCE_VERSION`). Seed it from `APP_VERSION` on first deployment.
- The orchestrator iterates through `UPGRADE_COMMAND_SUPPORTED_VERSIONS` from `instanceVersion + 1` to `APP_VERSION`, processing one version bundle at a time: `instanceCommands`, stamp `instanceVersion`, `perWorkspaceCommands` for all workspaces at `instanceVersion - 1`, verify all succeeded.
- Workspace eligibility: only workspaces at exactly `instanceVersion - 1` are upgraded. No straggler rescue.
- Hard-block on failure: if any workspace fails during per-workspace commands, the upgrade stops entirely.
- Version comparison is updated to support patch-level diffs (not just major.minor).
- Guard logic: workspaces below `instanceVersion - 1` block the upgrade (self-hosted default) or are skipped with `--force`.

### Phase 3: Health Check and Error Reporting

**Goal**: Structured post-upgrade validation and actionable error output.

**What changes**:

- Post-upgrade health check runs after all version bundles complete (instance version, workspace versions, command completion).
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

Individual commands (e.g. `backfillCommandMenuItems`) keep their current granularity but extend either `GlobalCommand` or `PerWorkspaceCommand` explicitly.
