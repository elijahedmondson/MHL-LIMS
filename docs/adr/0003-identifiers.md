# ADR 0003: Identifiers and barcodes

**Status:** Proposed. The number format is an open question.

**Name (November 2026):** at the IHC department's request, screens, labels, reports and exports call it the **MHL number** (MHL#), after the lab's current name. PHL.exe and the legacy data call the same number the PHL number; the database column stays `PhlNumber` so the migration crosswalk keeps its meaning.

## Context
The accession numbers (8 digits + a suffix letter, called PHL numbers in PHL.exe) are known to staff and investigators and appear on years of reports. PHL.exe generated them from a `phl_key` table that had to be reset by hand each contract year, allowed the same PHL# on several requests, and printed Code 39 barcodes with fonts installed on every PC.

## Decision
- **Keep the number** (now shown as the MHL number) as the accession for subjects. New numbers are unique (`UX_Subject_PhlNumber_New`); migrated legacy rows may repeat (`IsLegacy = 1`).
- **Allocate numbers with `lims.usp_AllocateNumbers`**, a counter per name and period that creates the next period's row on first use, so no annual reset exists.
- **Two supported formats**, chosen in configuration: `Sequential` (one counter, 8 digits) or `YearPrefixed` (two-digit year + 6-digit counter per year). *Open question:* which matches what the lab wants, and does the year mean calendar or contract year?
- **Request numbers:** lab + two-digit year + counter (e.g. `HP270123`). *Open question:* keep the legacy request-ID format if staff or the Rpt080 extract depend on it.
- **Blocks and slides** get barcodes derived from the MHL#: `27000123A-B3`, `27000123A-B3-S02`; loose slides `27000123A-S01`.
- **Labels:** ZPL templates sent to thermal printers. Slides and cassettes use DataMatrix drawn by the printer (`^BX`); jar and request labels may stay 1D (Code 128) for existing scanners. No barcode fonts on PCs.

## Consequences
- Confirm scanner, stainer and slide-scanner compatibility with the chosen symbology and lengths before buying label stock.
