# Legacy data migration (PHL.exe and Zaphod → MHL LIMS)

This folder brings the old tracking/billing history (PHL requests, PHL numbers, tracking, charges) and the old Zaphod studies (animals, necropsy, pathology) into the LIMS database.

> **Status: written from the legacy source code, not yet run.** No legacy database or SQL Server was available while this was written, so none of these scripts has been executed. Expect a round of small fixes on the first real run, exactly as with the C# code. Everything is built to fail safely: legacy databases are only ever read, each loader runs in one transaction, and every correction or skipped row is logged.

## How it works

```
 legacy databases ──read-only──▶  stage.*  (raw copies)  ──clean views──▶  loaders  ──▶  lims / billing / path / trk
 (PHL, PHL archive, Zaphod)        Copy-LegacyToStage.ps1   005_stage_views.sql  100…230        + legacy.IdCrosswalk
                                                                                                 + legacy.LoadIssue
```

* Legacy data never goes straight into the LIMS tables. It is copied unchanged into a `stage` schema first, so loads can be repeated and reviewed.
* Every migrated row is recorded in `legacy.IdCrosswalk` (old key → new row), so an old PHL#, request id or ZAPNbr can still be found. Every migrated row is flagged `IsLegacy = 1` where the table has that column.
* Everything the loaders correct, skip or want a person to look at is written to `legacy.LoadIssue`. `legacy.MapValue` holds the editable translation tables (severity words, neoplasm words, species, request types, ...).

## What you need first

1. **Read access** to the legacy databases with Windows authentication: the PHL production database (FASDATA), the PHL archive database (FASRETIREPROD), and the Zaphod database. Check what you have with `scripts\Invoke-LegacySchemaSnapshot.ps1`.
2. A **development** LIMS database created with `db\deploy_all.sql`. Do not use a production database for the first runs.
3. Windows PowerShell 5.1 or PowerShell 7, and SQL Server 2019 or later (the loaders use `CONCAT_WS`, `DROP TABLE IF EXISTS`, `CREATE OR ALTER`).
4. Permission to copy production records into the LIMS (ask C&SS or your data steward). Real animal and investigator data must stay out of Git: `pilot/data`, `migration/out` and `migration/config/sources.psd1` are already git-ignored.

## Steps

| # | Step | Command | What to check |
|---|---|---|---|
| 1 | Copy `config\sources.example.psd1` to `config\sources.psd1` and fill in server and database names | — | no user names or passwords go in this file |
| 2 | Look at the legacy schemas (read-only) | `.\scripts\Invoke-LegacySchemaSnapshot.ps1 -ConfigPath .\config\sources.psd1` | "read-only access confirmed"; row counts and date ranges in `out\*.csv` |
| 3 | Create the support objects | `sqlcmd -S <server> -d <lims db> -E -I -f 65001 -i sql\000_support.sql` | no errors |
| 4 | Copy the legacy tables into `stage` | `.\scripts\Copy-LegacyToStage.ps1 -ConfigPath .\config\sources.psd1` (add `-WhatIf` first) | row counts match the snapshot |
| 5 | Check the stage tables have the columns the loaders need | run `sql\010_check_stage.sql`; **fix every BLOCKING item** | see below |
| 6 | Create the clean views | run `sql\005_stage_views.sql` | no errors |
| 7 | Review `legacy.MapValue` | `SELECT * FROM legacy.MapValue ORDER BY MapName` | have pathologists and the lab lead confirm the rows marked "guess" |
| 8 | Load | `sqlcmd ... -i sql\run_all.sql` (or run `100`, `110`, `120`, `130`, then `200`–`235` one at a time) | each prints a summary line; `legacy.LoadRun` shows SUCCEEDED |
| 9 | Reconcile | `sql\900_reconcile.sql` (PHL) and `sql\910_reconcile_zaphod.sql` (both are included at the end of `run_all.sql`) | see below |
| 10 | Resolve issues, fix maps, re-run | `SELECT * FROM legacy.LoadIssue WHERE Severity IN ('SKIPPED','REVIEW')` | loaders add only what is not loaded yet, so re-running is safe |

Run the PHL scripts (100–130) before the Zaphod scripts (200–235): Zaphod animals are matched to the PHL subjects. `235` signs out pathology cases and can be run again after problems are fixed.

### Reading the check in step 5

`010_check_stage.sql` lists every table and column the loaders read. **KNOWN** columns were decoded from the legacy source code. **ASSUMED** columns are inferred, mainly the ID column of each Zaphod dictionary (`OrganID`, `FateID`, ...) and `PathologyDiagnosisID` / `PathologyFindingID`. If one is named differently, open `out\ZAPHOD-columns.csv` from step 2, find the real name, and change it in the loader (a search for the assumed name is enough). Do not run a loader whose group shows blocking items.

### Reading the reconcile output (step 9)

* **A, counts:** `NotMigrated` should be explained by skipped rows in `legacy.LoadIssue`.
* **C, money:** per lab, the legacy total (units × price) and the migrated total should match for both Released and Pending. A difference means rows were skipped (zero units, no request, credits with no original). Compare the released batches with the old Rpt080 reports for the same dates.
* **Also in C:** the legacy amounts that were *not* loaded, grouped by reason, and a profile of the legacy extract dates (a date such as 1900-01-01 is a "never extracted" marker; dates before 1950 are treated as not extracted).
* **E and F:** a short list of requests whose subject count or charges differ, and 25 random ones, to check side by side in PHL.exe.
* **910, Zaphod:** how animals were matched (almost all should be `PHL+REQ`), animals with no PHL match (usually requests that live only in the PHL archive database: load the archive, then re-run `210`–`235`), and the cases blocked from signing.

## Decisions built in

These are choices made so loading could proceed; each is easy to change and should be confirmed.

1. **Request numbers keep the legacy id.** If the same id exists in both labs, the second gets `-<lab>` (open question 8).
2. **PHL numbers may repeat** across legacy requests (`IsLegacy = 1`); new numbers stay unique.
3. **Money is never repriced.** Legacy charges keep the price they were charged at. Extracted charges load as RELEASED (locked) in one batch per lab and extract date. **Charges with no extract date load as PENDING and must be reviewed before any billing batch is created** (except those on requests marked No charge or Cancelled, which load as VOID and are logged). An extract date before 1950 is read as a placeholder, not an export. Charges with zero units, a negative price or no request are skipped and logged, never loaded at a changed amount.
4. **Pathology cases load as DRAFT; `235` signs only the ones Zaphod had completed.** A case is signed only if Zaphod's PathologyComplete flag is set, Zaphod recorded a completion date, and everything in the case loaded (tissue and diagnosis counts match, nothing PENDING, no untranslated words). The signer is recorded as `LEGACY\MIGRATION` (Zaphod does not store who signed), the time is Zaphod's completion date, and the frozen version-1 snapshot (format `migrated-from-zaphod-v1`) says so. Blocked cases are listed as `SIGN_BLOCKED` with the reasons. Necropsies are APPROVED only if the approver, approval date *and* Zaphod's approved flag all agree.
5. **Neoplasm, severity and tissue-result words are translated through `legacy.MapValue`**, seeded with guesses. Unmapped words are logged, not guessed.
6. **Zaphod animals that cannot be matched to exactly one PHL subject are not loaded.** They are listed, never silently dropped or force-matched.
7. **Users:** initials and user names that match an active `sec.AppUser` are linked to it; everything else becomes an inactive `LEGACY\<name>` placeholder. Create the real users first and the history attaches to them.

## What is not migrated yet

Bloodwork results and ranges, trim protocols, Zaphod role flags, the IHC request history from phlrequest (needs a data export from its host), and any stored report files. They are staged where a table exists, so they can be added later without another extraction. The SQL schema has no clinical-pathology tables yet (the pilot has them).

## Known limits

* **One-way and one-shot per row.** A loader adds rows that are not in `legacy.IdCrosswalk`; it does not update rows already loaded. In particular, a charge loaded as PENDING in a rehearsal stays PENDING even if PHL extracts it later, and would then be billed twice. **For the real cutover, load into an empty LIMS database from a fresh copy** (rehearsal loads are for checking). Edits made to old legacy rows after a load never arrive.
* Subject updates by `210` create temporal-history rows in `history.Subject` (one per matched animal). That is expected.
* Copying a legacy table is one transaction per table (delete old copy, bulk copy, tag), so an interrupted copy cannot leave half a table behind.
* The loaders are set-based and should handle hundreds of thousands of rows, but they have not been timed.
* Windows authentication only; scripts never accept or store a password.
