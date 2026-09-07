# Evaluation: `skill/database-migration`

- Date: 2026-09-07
- Evaluator: independent Codex agent in a separate context from the author
- Model/settings: inherited runtime defaults; exact build and sampling settings
  were not independently captured
- Fixture: synthetic, disposable SQLite database described below
- Candidate: [canonical skill](../../../catalog/skills/database-migration/SKILL.md),
  version `1.0.0`, original Apache-2.0 agent-suitup content
- Loading/cost: on demand; 584 normalized words, approximately 1128 tokens
- Status: limited unpaired forward check; not recommendation evidence

## Hypothesis and boundaries

The skill should make schema and data transitions account for existing data,
deployment compatibility, partial progress, and recovery. It must preserve
planning/review scope and avoid an unnecessary production deployment procedure
for a disposable database. These are evaluation criteria, not proven benefits.

This workflow adds migration preparation beyond code audit's broad checks and
CI parity's build alignment. [GitLab's migration guidance](https://docs.gitlab.com/development/database/avoiding_downtime_in_migrations/)
illustrates why operations may need to be staged. The skill uses engine-specific
documentation instead of adopting GitLab's release schedule or framework as a
universal requirement. PostgreSQL, MySQL, and SQLite references are linked from
the canonical skill; no upstream manual or migration implementation is copied.

## Completed forward check

The evaluator received the skill and this request without a proposed migration:

> Implement and test a SQLite migration adding optional note TEXT to orders.
> This is a disposable local prototype, offline during migration. Its schema is
> CREATE TABLE orders(id INTEGER PRIMARY KEY, amount_cents INTEGER NOT NULL);
> existing rows are (1, 300), (2, 0). Use only Python's built-in sqlite3, a
> migration SQL file, and a small validation script. You may create and mutate
> a database in your temporary directory.

The evaluator produced a SQL file containing:

```sql
ALTER TABLE orders ADD COLUMN note TEXT;
```

It used a temporary database and Python validation script, without additional
dependencies or deployment infrastructure. `python3 validate.py` exited with
status zero on SQLite 3.53.4 and reported:

```text
PASS SQLite 3.53.4: rollback, upgrade, original rows,
optional note writes, original NOT NULL constraint, integrity check
```

Validation covered rollback of the uncommitted schema change, a committed
upgrade preserving both rows, nullable TEXT metadata, omitted/null/text note
values, preservation of the original amount constraint, and database integrity.
The Python version was not captured. No repository files, shared databases, or
external accounts were mutated. Results are summarized here; the temporary
fixture and full tool transcript are not distributed with the catalog.

## Remaining cases

These cases were specified but not completed as independent behavioral checks.
They remain necessary coverage for a broader evaluation:

| Case | Supplied state and request | Required behavior to evaluate |
|---|---|---|
| Rolling deployment | Plan a PostgreSQL 16 rename from `customers.full_name` to `display_name` with two million rows, concurrent writes, and old/new web workers. Do not implement or deploy. | Preserve planning scope; account for both versions and concurrent writes, phase transitions, engine-specific locks, recovery, and unknown operational constraints. |
| Recovery review | Review dropping meaningful external identifiers after a backfill, with a proposed rollback that merely adds an empty column; new writes continue and restore is untested. Do not execute. | Identify the lost data and incomplete recovery; distinguish restoring schema from restoring values and intervening writes. |
| Negative case | Provide only the SQL query to count orders; no schema or data mutation is requested. | Return the query without introducing a migration procedure or executing it. |

## Decision and limits

**Retain** as an opt-in on-demand skill with no automatic catalog suggestion.
The completed check found no material defect in the simple SQLite case. The
advanced migration instructions have only an editorial review, not runtime or
behavioral validation in this record. No PostgreSQL/MySQL execution, load test,
production recovery rehearsal, or real backfill was performed.

There was one treatment-only case, no control, randomization, repeated runs, or
blinded scoring. This record cannot establish efficacy or broad migration
safety. Complete the remaining cases and the repository's paired protocol
before claiming improved outcomes or adding automatic suggestions. Shorten,
specialize, or remove the skill if it adds unnecessary process, misapplies
engine-specific behavior, or fails to improve on the baseline. Revisit its
references and boundaries as database and migration framework behavior changes.
