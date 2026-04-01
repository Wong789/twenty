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
- **Major.minor bundle identity**: the orchestrator groups upgrade commands by `major.minor`. Patch releases do not create new bundles, but they may patch an existing version line by adding new corrective commands inside the existing `major.minor` bundle.
- **Post-upgrade health check** validates workspace consistency after migration.
- **Improved developer experience** for twenty-eng: clear command taxonomy, scoped responsibilities, easy to add new version bundles and commands.
- **Report-a-problem template** that gathers workspace status including upgrade stack traces.
- **Settings page** (follow-up) shows current workspace version; if it differs from the installed server version, prompts the user to contact their administrator.

---

## Core Principles

- **Sequentiality**: the upgrade processes one version bundle at a time, fully completing it (`instanceCommands`, stamp `instanceVersion`, then `perWorkspaceCommands` for all workspaces) before moving to the next. There is no cross-version interleaving -- the instance must finish upgrading all workspaces to version N before any version N+1 commands run.
- **Idempotency**: all upgrade commands -- both `GlobalCommand` (in `instanceCommands`) and `PerWorkspaceCommand` (in `perWorkspaceCommands`) -- must be idempotent. Running the same command twice on the same workspace (or the same global state) produces the same result as running it once. This is critical because re-runs after partial failures must be safe, and single-workspace upgrades re-run global commands that may have already been applied.
- **`instanceVersion` advancement guard**: `instanceVersion` can only advance to N+1 if **all workspace versions equal `instanceVersion`** (i.e. all workspaces are at N). If any workspace is behind -- because it failed a previous `perWorkspaceCommands` pass -- the orchestrator refuses to run the next bundle's `instanceCommands`. The operator must fix the failing workspace and re-run before the instance can move forward.
- **Forward compatibility of global changes**: global commands (especially `instanceCommands` like TypeORM migrations) must produce a schema that is compatible with workspaces still at `instanceVersion - 1`. Since `instanceVersion` is stamped after `instanceCommands`, workspaces are still at the previous version when the global schema changes land. A global schema change that breaks those workspaces violates the upgrade contract.
- **Breaking change backward compatibility**: a breaking change introduced in version N's `instanceCommands` must not invalidate any upgrade command in a version bundle still present in `UPGRADE_COMMAND_SUPPORTED_VERSIONS`. During a cross-version upgrade, older bundles' `perWorkspaceCommands` run against the global schema that all preceding `instanceCommands` (including N's) have already modified. If a breaking change in N makes a command in bundle M (where M < N) fail -- e.g. dropping a column that M's command reads -- then M and every version below it must be removed from `UPGRADE_COMMAND_SUPPORTED_VERSIONS`. This narrows the supported upgrade range, so breaking changes should be avoided or deferred whenever possible.
- **No downgrade support**: the upgrade path is forward-only.

---

## Upgrade Command Golden Rules

These rules define how upgrade commands evolve over time. They exist to avoid
history collisions, make patching safe, and keep command intent readable months
after a release shipped.

1. **A command name is a contract**: once a command has shipped, its name
   becomes part of the upgrade history contract. A successful history row for
   `commandName = foo` means "the logical operation `foo` already ran".
2. **Do not silently change the meaning of a released command**: if a command
   already shipped and later turns out to be incomplete, buggy, or wrongly
   ordered, do not keep the same name and change the implementation in place.
3. **New intent requires new identity**: if behavior materially changes, create
   a new command name (`foo-fix-missing-bar`, `foo-v2`,
   `rebuild-foo-after-order-fix`, etc.). This lets the new command run once
   without colliding with prior successful history rows.
4. **Ordering fixes are modeled as new commands**: if a command was released in
   the wrong order, fix the workflow by adding a new compensating command in the
   correct position, not by trying to reinterpret the old history row.
5. **Prefer additive repair over replaying history**: if production data needs
   correction after release, prefer adding a new corrective command rather than
   renaming or deleting history rows.
6. **Idempotency still applies**: even when introducing corrective commands, the
   new command must still be safe to re-run after partial failure.

These rules are especially important for patching an existing version line. If
`1.20.1` needs to fix work already attempted by `1.20.0`, the fix should
generally be represented as a **new command in the `1.20` bundle**, not as a
silent rewrite of the old command's meaning.

---

## Instance Version

The upgrade system introduces a new concept: **`instanceVersion`** -- the version the instance's global state (schema, core data) has been upgraded to. This is distinct from:

- **`APP_VERSION`**: the version of the deployed Twenty codebase (set at build time, read from env/package).
- **Workspace version**: the version each individual workspace has been upgraded to.

`instanceVersion` tracks how far the shared database has progressed through the upgrade timeline. It is the gate that controls which workspaces are eligible for upgrade.

### Storage

Stored in the existing `KeyValuePair` table (`core` schema) as a `CONFIG_VARIABLE` entry with `userId = null` and `workspaceId = null`, key = `INSTANCE_VERSION`. This leverages the existing `ConfigStorageService` / `ConfigVariables` infrastructure -- no new table or schema change required.

### Lifecycle

1. Before any upgrade, `instanceVersion` reflects the last fully-completed version bundle (e.g. `1.18.0`).
2. The orchestrator verifies all workspace versions equal `instanceVersion` (advancement guard).
3. The orchestrator picks the next version bundle in `UPGRADE_COMMAND_SUPPORTED_VERSIONS` (e.g. `bundle_1190`).
4. The `instanceCommands` run (global schema changes).
5. `instanceVersion` is stamped to `1.19.0`. The shared database is now at this version's global state.
6. The `perWorkspaceCommands` run for all workspaces at `1.18.0` (i.e. `instanceVersion - 1`).
7. Once all workspaces succeed, the orchestrator moves to the next version bundle.

`instanceVersion` advances after `instanceCommands` complete -- it reflects the global schema state. Workspace versions catch up via `perWorkspaceCommands`. During cloud development, `instanceVersion` is **not** bumped on deploys -- only `instanceCommands` are executed (with skip-if-completed via `instance_upgrade_history`). `instanceVersion` stays at the previous stable version until the release owner runs the full orchestrator (see "Deploying a Partial Next Version to Cloud Production").

### Workspace Eligibility

A workspace can only be upgraded by a version bundle if it is at exactly `instanceVersion - 1` -- the version immediately before the current instance version in `UPGRADE_COMMAND_SUPPORTED_VERSIONS`. Workspaces that are further behind are not eligible and must be addressed before the instance can proceed to the next version.

### Initial Value

On a fresh install, `instanceVersion` is set to `APP_VERSION` (no upgrade needed). On an existing instance that predates this feature, the migration that introduces `instanceVersion` seeds it from the current `APP_VERSION` at the time of deployment.

### New Workspace Version

When a new workspace is created, it receives `instanceVersion` as its workspace version -- not `APP_VERSION`. This ensures the workspace is aligned with the last fully-completed upgrade state. During cloud development, `APP_VERSION` may be ahead of `instanceVersion` (e.g. `APP_VERSION = 1.21.0` while `instanceVersion = 1.20.0`), so using `instanceVersion` prevents creating workspaces at a version that hasn't been fully upgraded to yet.

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
    { type: 'global', command: this.typeOrmMigrationCommandA },
    { type: 'global', command: this.typeOrmMigrationCommandB },
    { type: 'global', command: this.typeOrmMigrationCommandC },
  ],
  perWorkspaceCommands: [
    { type: 'per-workspace', command: this.backfillCommandMenuItemsCommand },
    { type: 'per-workspace', command: this.migrateRichTextToTextCommand },
    { type: 'per-workspace', command: this.backfillSelectFieldOptionIdsCommand },
  ],
};
```

### TypeORM Migration Generation

TypeORM migrations are no longer generated directly through the raw TypeORM
CLI. They now go through a dedicated NestJS command that associates each newly
generated migration with the **latest known version line**.

**Why**:

- TypeORM migrations are part of `instanceCommands`, so they must belong to a
  specific upgrade bundle.
- We want one canonical place to decide which version line a new migration
  belongs to.
- This avoids developers generating a migration and then manually forgetting to
  associate it with the latest bundle.

**How it works**:

1. A developer runs a NestJS command to generate the migration.
2. That command resolves the latest known version from
   `UPGRADE_COMMAND_SUPPORTED_VERSIONS`.
3. The generated migration is associated with that latest known version line.
4. The matching `TypeOrmMigrationCommand` for that bundle will execute it as
   part of the bundle's `instanceCommands`.

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

3. **Run `perWorkspaceCommands` array** for all workspaces at `instanceVersion - 1`. The orchestrator queries for workspaces at exactly the previous version and runs each `PerWorkspaceCommand` in order. Commands already recorded as `completed` in `workspace_upgrade_history` for a given workspace are skipped. Each workspace's version is stamped after all its per-workspace commands complete. If a workspace fails, the orchestrator records the failure and **continues to the next workspace** -- it does not stop at the first failure.

4. **All workspaces must succeed** before the orchestrator moves to the next version bundle. After attempting all workspaces, if any failed, the upgrade halts. The `instanceVersion` advancement guard enforces this: the next bundle cannot start because not all workspace versions equal `instanceVersion`. The operator must fix the failing workspaces and re-run.

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
      Workspace B stays at 1.18.0
    > Workspace C:
      [per-workspace] backfill feature flags    OK
      Workspace C stamped to 1.19.0
  *** 1 workspace failed. Upgrade halts after this bundle. ***
```

**The upgrade halts.** `instanceVersion` is `1.19.0` (stamped after `instanceCommands`). Workspaces A and C are at `1.19.0`, but workspace B is still at `1.18.0`. All three workspaces were attempted -- the orchestrator did not stop at B's failure.

The operator investigates workspace B's failure (using the `workspace_upgrade_history` table and its captured logs), fixes the underlying issue, and re-runs the upgrade command.

**Re-run**:

```
> instanceVersion = 1.19.0, target = 1.20.0
> Advancement guard: all workspace versions must equal instanceVersion (1.19.0)
>   Workspace B is at 1.18.0 -- NOT OK
> Processing bundle_1190 (perWorkspaceCommands only, instanceCommands already completed)...

  instanceCommands:
    [global] TypeORM migrations for 1.19.0    SKIP (completed in history)
    [global] Schema change ABC                SKIP (completed in history)
  instanceVersion already at 1.19.0 (no-op)

  perWorkspaceCommands (workspaces at 1.18.0: B):
    > Workspace A: already at 1.19.0 (skipped)
    > Workspace B:
      [per-workspace] backfill feature flags    OK (fixed)
      Workspace B stamped to 1.19.0
    > Workspace C: already at 1.19.0 (skipped)

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
- All workspaces are attempted even when one fails. Workspace C was upgraded successfully despite workspace B's failure. This maximizes progress per run.
- On re-run, instance commands are skipped (recorded as `completed` in `instance_upgrade_history`). Workspaces A and C are already at `1.19.0` so they're skipped. Only workspace B is re-attempted.
- The `instanceVersion` advancement guard blocked `bundle_1200` from starting because workspace B was still at `1.18.0` (not equal to `instanceVersion = 1.19.0`). Once B succeeds on re-run, all workspaces are at `1.19.0` and the guard passes.
- `perWorkspaceCommands` contains only `PerWorkspaceCommand` entries. Any global work belongs in `instanceCommands`.

### Failure Behavior

- **Instance command failure**: the upgrade aborts immediately. `instanceVersion` is not stamped (the failing command's transaction is rolled back, previously completed commands remain applied). No per-workspace commands run.
- **Per-workspace command failure (any workspace)**: the orchestrator **continues attempting all remaining workspaces** -- it does not stop at the first failure. `instanceVersion` was already stamped (after `instanceCommands`). Failed workspaces keep their current version. Successfully upgraded workspaces keep their new version stamp. After all workspaces have been attempted, the upgrade halts. The `instanceVersion` advancement guard prevents the next bundle from starting: since the failed workspace's version is still at `instanceVersion - 1` (not equal to `instanceVersion`), the orchestrator will refuse to advance further until all workspaces catch up. The operator must fix the failing workspaces and re-run -- already-completed commands (including successful workspaces) are skipped via the history tables.

The final report includes per-workspace status (success / failure).

### Guard Logic

Before running `instanceCommands` for a version bundle, the orchestrator verifies that **all workspace versions equal `instanceVersion`**. If any workspace is behind (e.g. it failed during the previous bundle's `perWorkspaceCommands`), the orchestrator refuses to advance. This is the primary guard -- `instanceVersion` never moves forward while any workspace is lagging.

On the very first bundle (or after a fresh deploy), the orchestrator also checks for workspaces below `instanceVersion`. These workspaces are too far behind to be eligible:

- **Self-hosted (default)**: the upgrade refuses to start. A clear message lists the affected workspaces and the minimum required version.
- **Self-hosted (`--force`)**: the upgrade proceeds, but ineligible workspaces are skipped and reported as "refused". The hard-block on workspace failure still applies to eligible workspaces.

### Single-Workspace Upgrade (`-w`)

When targeting a single workspace, the orchestrator still runs all `instanceCommands` (global) for the relevant version bundle because they affect the shared database, and stamps `instanceVersion`. Then only the targeted workspace's `perWorkspaceCommands` run. Other workspaces remain at their current version. This means global changes "leak" to all other workspaces. This is acceptable because:

- All commands are idempotent -- when other workspaces are upgraded later, global commands no-op.
- Global schema changes are forward-compatible by design -- workspaces at `instanceVersion - 1` continue to work against the new schema.

The orchestrator logs a clear warning when running in single-workspace mode: global commands will be applied to the shared database and affect all workspaces.

Note: after a single-workspace upgrade, the non-targeted workspaces are still at the previous version. The `instanceVersion` advancement guard will block the next bundle until all workspaces are upgraded to `instanceVersion`. The operator must run the full orchestrator (or target each remaining workspace individually) before the instance can advance further.

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
- `status` (varchar -- `completed` / `failed`)
- `retry` (integer, NOT NULL, default `0` -- zero-indexed retry counter. The first execution is `0`, the first re-run is `1`, etc.)
- `runByVersion` (varchar -- the `APP_VERSION` of the Twenty instance that executed this command, e.g. `1.20.1`. Useful for debugging: if a command was completed by a buggy version, this tells you which build ran it.)
- `error` (text, nullable -- full error string from `UpgradeCommandResult.error` on failure, including stack trace)
- `logs` (text, nullable -- all log output correlated to this command execution via correlation ID. Tail-truncated to last 5,000 lines if exceeded; when truncated, a `[TRUNCATED - showing last 5000 of N total lines]` header is prepended. Stored on failure only.)
- `createdAt` / `updatedAt` (timestamps)

**Index**: `(commandName, version)` -- not unique, since multiple rows can exist for the same command across retries.

### `workspace_upgrade_history` Table

Tracks execution of `PerWorkspaceCommand` entries from `perWorkspaceCommands` arrays.

**Columns**:

- `id` (uuid, PK)
- `workspaceId` (uuid, NOT NULL)
- `version` (varchar -- the version bundle this command belongs to, e.g. `1.20.0`)
- `commandName` (varchar -- unique identifier for the command, e.g. `backfillCommandMenuItems`)
- `status` (varchar -- `completed` / `failed`)
- `retry` (integer, NOT NULL, default `0` -- zero-indexed retry counter. The first execution is `0`, the first re-run is `1`, etc.)
- `runByVersion` (varchar -- the `APP_VERSION` of the Twenty instance that executed this command, e.g. `1.20.1`.)
- `error` (text, nullable -- full error string from `UpgradeCommandResult.error` on failure, including stack trace)
- `logs` (text, nullable -- all log output correlated to this command execution via correlation ID. Tail-truncated to last 5,000 lines if exceeded; when truncated, a `[TRUNCATED - showing last 5000 of N total lines]` header is prepended. Stored on failure only.)
- `createdAt` / `updatedAt` (timestamps)

**Index**: `(commandName, version, workspaceId)` -- not unique, since multiple rows can exist for the same command across retries.

### Shared Lifecycle

Both tables are **append-only and immutable** -- rows are inserted once and never updated:

- On completion: insert a row with `status: completed`, `retry: 0`.
- On failure: insert a row with `status: failed`, `error`, and `logs`, `retry: 0`.
- On re-run: insert a **new row** with `retry` incremented. The new row gets its own final `status` (`completed` or `failed`). Previous rows are never touched.

There is no `started` status. A row is only written once the command finishes (successfully or not). A crash mid-command leaves no row at all -- the orchestrator treats the absence of a `completed` row as "not completed" on re-run.

Previous failure rows are preserved across retries. This gives operators a full execution history for debugging: they can see every attempt, what error occurred, and which `runByVersion` executed it. The orchestrator determines the current state of a command by looking at the row with the **highest `retry` value** for a given `(commandName, version)` or `(commandName, version, workspaceId)` tuple.

### Re-Run Behavior and Skip-If-Completed

The orchestrator uses the history tables as a **control mechanism**: before running a command, it checks whether the **latest row** (highest `retry`) for that command is `completed` in the relevant history table and skips it if so. This is essential for two reasons:

1. **Partial failure recovery**: on re-run after a failure, already-completed commands are skipped rather than re-executed. This avoids redundant work on expensive commands (e.g. full table scans that would no-op row by row).
2. **Cloud development workflow**: during incremental cloud deploys, commands may be run individually before the stable release. When the release owner runs the full orchestrator, the history tables tell it exactly which commands have already been applied. See "Deploying a Partial Next Version to Cloud Production" for the full workflow.

A `--force-rerun` flag overrides this and re-executes all commands regardless of history. This is useful for debugging or when a command was recorded as `completed` but produced incorrect results (e.g. a buggy version ran it). All commands must still be idempotent -- `--force-rerun` relies on this guarantee.

### Row Eviction

Because the tables are append-only, rows accumulate over time. In practice the volume is modest -- a version bundle has ~5-10 commands, retries are rare, and even cloud environments with thousands of workspaces produce manageable row counts. Still, stale rows serve no operational purpose once their version is no longer part of the upgrade path.

**Policy**: when a version is dropped from `UPGRADE_COMMAND_SUPPORTED_VERSIONS` (see "Breaking Changes and Stale Versions"), all history rows for that version are deleted from both `instance_upgrade_history` and `workspace_upgrade_history`. The commands those rows reference no longer exist in the codebase and can never be re-run -- the history is purely archival at that point.

**Timing**: eviction runs at the start of the upgrade orchestrator, before processing any version bundle. The orchestrator compares the versions present in the history tables against `UPGRADE_COMMAND_SUPPORTED_VERSIONS` and deletes rows whose `version` is not in the list. This keeps the tables tight without requiring a separate cleanup job or manual intervention.

**No time-based eviction**: rows are not evicted by age. A version may stay in `UPGRADE_COMMAND_SUPPORTED_VERSIONS` for a long time (e.g. the oldest supported source version), and its history rows must remain queryable for the skip-if-completed mechanism to work. Version-based eviction is the only safe trigger.

---

## Deploying a Partial Next Version to Cloud Production

During the development cycle for a new version (e.g. `1.21.0`), the cloud production environment receives incremental deploys before the stable release. Each deploy ships `APP_VERSION = 1.21.0` (not pre-release tags like `1.21.0-alpha.3`). This means new commands may be added to `bundle_1210` between deploys.

### How It Works

- **`instanceCommands` run automatically on each deploy** via a dedicated CLI mode (similar to `database:reset --force`). Each deploy runs the full `instanceCommands` array for the current version bundle. Commands already recorded as `completed` in `instance_upgrade_history` are skipped. New commands added since the last deploy are executed. **`instanceVersion` is not stamped** -- it stays at the previous stable version (e.g. `1.20.0`) throughout the development cycle. The skip-if-completed mechanism (via `instance_upgrade_history`) is what prevents re-running already-applied commands on subsequent deploys, not the version stamp.
- **`perWorkspaceCommands` are run manually** by developers via CLI as needed. This gives developers control over when workspace-level migrations run during the development cycle.
- **New workspaces** created during the development cycle get `instanceVersion` as their workspace version (e.g. `1.20.0`). Since `instanceVersion` is not stamped during deploys, this is always the last fully-completed version -- not `APP_VERSION`. These workspaces will be upgraded when the release owner runs the full orchestrator.
- **At stable release**, the release owner runs the full upgrade orchestrator. The orchestrator processes `bundle_1210`: `instanceCommands` are all skipped (already `completed` in history), `instanceVersion` is then stamped to `1.21.0`, and `perWorkspaceCommands` run for all workspaces still at `1.20.0` (commands already applied manually during the dev cycle are skipped via `workspace_upgrade_history`). This is the first and only time `instanceVersion` advances.

### Real-World Example

**Context**: `1.20.0` is the current stable release. `instanceVersion = 1.20.0`. All workspaces at `1.20.0`. The team is developing `1.21.0`.

**Deploy 1** (ships `APP_VERSION = 1.21.0`, `bundle_1210` has 2 instance commands and 3 per-workspace commands):

```
> APP_VERSION = 1.21.0, instanceVersion = 1.20.0
> Running instanceCommands for bundle_1210 (auto-deploy mode)...

  instanceCommands:
    [global] TypeORM migrations for 1.21.0    OK
    [global] Add new core index              OK
  instanceVersion not stamped (auto-deploy mode)

  perWorkspaceCommands: not run (auto-deploy mode only runs instanceCommands)
```

**Deploy 2** (a developer adds a new instance command to `bundle_1210`):

```
> APP_VERSION = 1.21.0, instanceVersion = 1.20.0
> Running instanceCommands for bundle_1210 (auto-deploy mode)...

  instanceCommands:
    [global] TypeORM migrations for 1.21.0    SKIP (completed in history)
    [global] Add new core index              SKIP (completed in history)
    [global] Seed new config variable        OK  (new command)
  instanceVersion not stamped (auto-deploy mode)
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
> APP_VERSION = 1.21.0, instanceVersion = 1.20.0
> Processing bundle_1210...

  instanceCommands:
    [global] TypeORM migrations for 1.21.0    SKIP (completed in history)
    [global] Add new core index              SKIP (completed in history)
    [global] Seed new config variable        SKIP (completed in history)
  instanceVersion stamped to 1.21.0

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

- All `instanceCommands` were skipped -- they were already applied across the two deploys during development. The `skipIfCompleted` mechanism (via `instance_upgrade_history`) is what makes this possible, not the version stamp.
- `instanceVersion` stayed at `1.20.0` throughout the entire development cycle. It is only stamped to `1.21.0` now, during the full orchestrator run.
- Workspace D was manually upgraded during development and is skipped (already at `1.21.0`).
- Workspace E was created during the dev cycle with version `1.20.0` and is upgraded now.

---

## Post-Upgrade Health Check

After all version bundles complete, the orchestrator runs a health check:

- **Instance version**: confirm `instanceVersion` matches `APP_VERSION`.
- **Workspace versions**: confirm all workspace versions match `APP_VERSION`.
- **Command completion**: verify all expected commands have a `completed` row (highest `retry`) in both `instance_upgrade_history` and `workspace_upgrade_history`. A missing row for an expected command indicates a crash mid-execution.

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

## Testing Strategy

### Orchestrator Unit Tests

The orchestrator motor is covered by unit tests that exercise the full state machine in isolation -- no real database, no real commands. Commands are stubbed to return `completed` or `failed` as needed, and the tests verify the orchestrator's decisions and side effects.

**Edge cases covered**:

- **Happy path**: single-version upgrade, multi-version cross-version upgrade, all workspaces succeed.
- **Instance command failure**: verify `instanceVersion` is not stamped, no `perWorkspaceCommands` run.
- **Per-workspace command failure (single workspace)**: verify the orchestrator continues to all remaining workspaces, records the failure, and halts after the full pass.
- **Per-workspace command failure (multiple workspaces)**: verify all failures are collected and reported.
- **`instanceVersion` advancement guard**: verify the orchestrator refuses to start the next bundle when any workspace version != `instanceVersion`.
- **Skip-if-completed**: verify already-completed commands (both instance and per-workspace) are skipped on re-run.
- **Retry counter**: verify re-run inserts a new row with incremented `retry`, previous rows untouched.
- **`--force-rerun`**: verify all commands re-execute regardless of history.
- **`--force` with straggler workspaces**: verify ineligible workspaces are skipped and reported as "refused".
- **Single-workspace mode (`-w`)**: verify `instanceCommands` run, only the targeted workspace's `perWorkspaceCommands` run, other workspaces untouched.
- **No-op upgrade**: `instanceVersion` == `APP_VERSION`, nothing to do.
- **Log capture**: verify failure logs are stored in the history row, success logs are discarded.
- **Row eviction**: verify rows for versions not in `UPGRADE_COMMAND_SUPPORTED_VERSIONS` are deleted at the start of the run.

### Pre-Release CI: Full Cross-Version Upgrade

A CI pipeline runs before every release to validate the entire cross-version upgrade path end-to-end. This catches breaking changes that would silently narrow the supported upgrade range.

**What it does**:

1. Starts a Twenty instance at the **oldest version in `UPGRADE_COMMAND_SUPPORTED_VERSIONS`** (e.g. `1.17.0`) with a seeded database containing representative workspace data.
2. Deploys the **latest release candidate** (`APP_VERSION` = target version).
3. Runs the full upgrade orchestrator.
4. Verifies: `instanceVersion` matches `APP_VERSION`, all workspace versions match `APP_VERSION`, all commands recorded as `completed` in both history tables, post-upgrade health check passes.

**Why this matters**: the orchestrator unit tests validate the motor's logic, but they don't catch stale commands -- e.g. a `perWorkspaceCommand` in `bundle_1190` that reads a column dropped by `bundle_1210`'s `instanceCommands`. Only a real end-to-end run against actual version bundles surfaces these. This CI is the safety net for the breaking change backward compatibility principle.

**Trigger**: runs as a pre-release gate. A failure blocks the release until the breaking change is resolved (either by fixing the command or by dropping the affected versions from `UPGRADE_COMMAND_SUPPORTED_VERSIONS`).

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
- Version comparison still uses major.minor.
- Only the current version bundle is refactored; older version entries (e.g. `1.19.0: []`) are left as-is or trivially wrapped.

**Going forward**: the next version's upgrade commands (e.g. `1.21.0`) should be written directly against the new pattern -- extending `GlobalCommand` or `PerWorkspaceCommand` and registered in an `UpgradeVersionBundle`. This validates the new taxonomy on a real upgrade cycle.

**Validation**: the upgrade command produces the same outcome as before -- same TypeORM migrations run, same per-workspace commands execute in the same order.

### Phase 2: Cross-Version Upgrade and Instance Version

**Goal**: Allow an instance to upgrade across multiple minor versions in a single run, with strict sequential version-by-version processing.

**What changes**:

- Introduce `instanceVersion` stored in the `KeyValuePair` table (`CONFIG_VARIABLE`, `userId = null`, `workspaceId = null`, key = `INSTANCE_VERSION`). Seed it from `APP_VERSION` on first deployment.
- The orchestrator iterates through `UPGRADE_COMMAND_SUPPORTED_VERSIONS` from `instanceVersion + 1` to `APP_VERSION`, processing one version bundle at a time: `instanceCommands`, stamp `instanceVersion`, `perWorkspaceCommands` for all workspaces at `instanceVersion - 1`, verify all succeeded.
- `instanceVersion` advancement guard: before running `instanceCommands` for a bundle, verify all workspace versions equal `instanceVersion`. If any workspace is behind, the orchestrator refuses to advance.
- Workspace eligibility: only workspaces at exactly `instanceVersion - 1` are upgraded. No straggler rescue.
- Hard-block on failure: if any workspace fails during per-workspace commands, the upgrade stops entirely.
- Version comparison remains major.minor at the bundle identity level. Patch releases can patch an existing version line, but corrective work should generally be introduced as **new command identities inside the same major.minor bundle** rather than by mutating previously shipped commands in place.
- Guard logic: workspaces below `instanceVersion` block the upgrade (self-hosted default) or are skipped with `--force`.

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

---

## Real-World Scenarios

### 1. Happy Path

`APP_VERSION = 1.21.0`, `instanceVersion = 1.20.0`, all workspaces at
`1.20.0`.

- The orchestrator runs `bundle_1210.instanceCommands`.
- `instanceVersion` is stamped to `1.21.0`.
- The orchestrator runs `bundle_1210.perWorkspaceCommands` for every workspace.
- All workspaces succeed and are stamped to `1.21.0`.
- Final state: `instanceVersion = 1.21.0`, all workspace versions = `1.21.0`.

### 2. One Command Failed

`APP_VERSION = 1.21.0`, `instanceVersion = 1.20.0`, workspaces A/B/C at
`1.20.0`.

- `bundle_1210.instanceCommands` succeed and `instanceVersion` is stamped to
  `1.21.0`.
- Workspace A succeeds and is stamped to `1.21.0`.
- Workspace B fails on `backfill-new-field` and stays at `1.20.0`.
- Workspace C is still attempted and succeeds, ending at `1.21.0`.
- The upgrade halts after the full workspace pass.
- On re-run, instance commands are skipped by history; only workspace B is
  retried.
- The next bundle cannot start until B also reaches `1.21.0`.

### 3. `1.20.0` to `1.20.1`: Add a New Command

`1.20.0` shipped with:

- `foo`
- `bar`

After release, we realize some data still needs a missing backfill. In
`1.20.1`, we keep the existing `1.20` bundle identity and add:

- `foo`
- `bar`
- `backfill-missing-baz`

Expected behavior:

- History already contains successful rows for `foo` and `bar`.
- Those commands are skipped.
- `backfill-missing-baz` has never run, so it executes once.
- History remains readable: the patch added a new corrective operation instead
  of reinterpreting an old one.

### 4. `1.20.0` to `1.20.1`: Rename a Previously Released Command

`1.20.0` shipped with a command named `foo`.

Later we discover `foo` was semantically wrong: maybe it updated the right data
set but missed a required transformation, or maybe it should have run after
another command. In `1.20.1`, we **do not** keep the name `foo` and change its
meaning silently. Instead we introduce a new command such as:

- `foo`
- `foo-fix-missing-transformation`

or:

- `foo`
- `rebuild-foo-after-order-fix`

Expected behavior:

- The successful `foo` history rows remain valid and untouched.
- The new corrective command runs once because it has a new identity.
- Operators can clearly see what happened in history: first `foo`, then the
  later repair command.
- This avoids history collisions and makes the patch behavior explicit.
