---
name: database-migration
description: Plan, implement, or review database schema and data migrations with attention to existing data, deployment compatibility, locking, retries, and recovery. Use when changing stored data or its schema; ordinary queries and disposable database setup do not need a production migration process.
license: Apache-2.0
---

# Database Migration

Prepare the requested migration using the repository's tooling and deployment
policy. A planning or review request should produce a plan or findings. When
implementation is requested, write the migration and relevant tests within that
scope. Preparing a migration does not authorize applying it to a shared or
production database; use existing authorization and identify the target before
any database mutation.

## Establish constraints

Inspect the database engine and version, migration framework and history,
affected schema, readers and writers, and deployment order. Establish whether
the database is disposable, the approximate data volume, concurrent traffic,
and acceptable downtime. Use repository evidence first; make unknowns explicit
and resolve those that determine the migration approach before executing it.

For a disposable local database or an accepted maintenance window, use the
simplest appropriate project workflow. Do not impose multiple releases or
background infrastructure when the constraints do not require them. Preserve
applied migration history; use a new migration for an already-deployed change.

## Design the transition

- Check existing rows against new types, nullability, uniqueness, defaults, and
  relationships. Define how incompatible values are handled without silently
  dropping or coercing data. Include relevant indexes, constraints, triggers,
  and views when assessing dependencies.
- When old and new application versions coexist, keep both working throughout
  deployment. If needed, separate adding the new representation, compatible
  application changes, backfilling, switching readers and writers, and removing
  the old representation. Explain when each phase is safe to start and finish.
- For backfills, account for concurrent writes and partial progress. Choose
  bounded batches, stable progress tracking, and retry behavior when scale or
  interruption requires them. Re-execution must not corrupt or duplicate data.
- Check operation-specific locks, scans or table rewrites, transaction support,
  and failure behavior against the actual engine and version. An ORM migration
  or an operation described as online is not evidence of zero blocking. Define
  applicable runtime limits, monitoring signals, and stop conditions from the
  project's requirements; do not invent operational thresholds.
- Explain recovery for each phase: rollback, a corrective migration, or restore.
  State what data would be lost and how intervening writes are handled. A reverse
  schema operation does not necessarily restore deleted or transformed data.
  Keep destructive cleanup outside the required compatibility/recovery window.

## Validate and hand off

Use an isolated database with the relevant engine/version and representative
synthetic or approved sanitized existing data. Check the upgrade from the
previous state, resulting data invariants, and affected application behavior.
Where applicable, exercise old/new version compatibility, interrupted backfills,
resumption, and the proposed recovery path. Inspect partial state before retrying
a failed non-atomic operation.

Report migration and application deployment order, commands and results, recovery
limits, and outstanding checks. Small local fixtures cannot establish production
lock duration or backfill throughput; name those limits instead of claiming
deployment readiness. Do not introduce an unrelated database or migration tool.

## Engine references

Consult only the documentation relevant to the selected operation, using the
project's engine/version and migration framework. These entry points are not
pinned execution instructions; switch to the matching version as needed:

- [PostgreSQL ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html)
  for operation-specific locking and schema changes.
- [MySQL InnoDB online DDL](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)
  for supported algorithms and concurrent access restrictions.
- [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html)
  for supported alterations and table rebuild procedures.
