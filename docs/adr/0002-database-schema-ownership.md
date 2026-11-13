# ADR 0002: The SQL scripts own the schema

**Status:** Proposed

## Context
The schema needs review by a DBA and by C&SS, carries constraints and triggers that protect billing data (frozen price lists, locked released charges, append-only tracking), and uses system-versioned temporal tables. EF Core migrations express some of this poorly, and two sources of truth drift.

## Decision
- The numbered scripts in `db/` are the source of truth. `deploy_all.sql` builds a fresh database.
- EF Core maps to the schema and is never used to create or migrate it. Tables with triggers are declared with `HasTrigger` so EF does not use `OUTPUT` without `INTO`.
- Changes are new numbered scripts (`060_...sql`), reviewed like code.
- When the team is ready, move the scripts into an SDK-style SQL project (`Microsoft.Build.Sql`) and deploy with DACPACs, which adds build-time validation and drift detection.

## Consequences
- Developers must update the EF configuration when they change a table.
- Integration tests against a real SQL Server (or a container) are needed to catch mapping mistakes; unit tests cannot.
