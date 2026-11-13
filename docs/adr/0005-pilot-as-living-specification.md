# ADR 0005: The pilot is the living specification for its rules

**Status:** Proposed

## Context
The working pilot (`pilot/`) is where lab staff try the workflows and where most rule questions are settled: IHC catalog repair and classification, IHC estimates and warnings, necropsy approval, pathology sign-out checks, sign-out charges after amendments, and study summaries. The same rules have to exist in the production C# code. Two hand-maintained copies of a rule drift apart, and the C# could not be compiled or run where it was first written.

## Decision
- Until a production module replaces a pilot screen, the pilot is the reference for that module's rules. A rule is decided in the pilot first, with the lab, and covered by a pilot test.
- `tools/rules-reference/make_golden.mjs` records the pilot's inputs and outputs for each rule (about 1,500 cases today) in `tools/rules-reference/golden/ihc-pathology-golden.json`. The xUnit tests in `tests/MhlLims.Domain.Tests/Golden` replay every case against `MhlLims.Domain`. A difference fails the build.
- Dictionaries and the assay catalog reach SQL Server through `tools/seed-sql/generate_seed_sql.mjs`, which writes `db/120_…` and `db/130_…` from the same sources the pilot loads. Nobody edits those two scripts by hand.
- Once a production module ships and staff use it, the C# becomes the reference. Delete the matching golden cases and stop changing that part of the pilot.

## Consequences
- A rule change touches three places in order: the pilot and its test, the golden file (re-recorded), then the C#. CI should run the pilot tests and `dotnet test` together.
- Behavior that is hard to express as input and output (screens, permissions, persistence) is not covered and needs ordinary tests.
- The golden file fixes the seeding date (`TODAY` in `make_golden.mjs`), so cases that depend on today's date stay stable.
- The pilot must keep its "fictional data only" status; it is a specification, not a system of record.
