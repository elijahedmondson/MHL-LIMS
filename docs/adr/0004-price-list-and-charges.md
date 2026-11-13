# ADR 0004: Price lists and charges

**Status:** Proposed

## Context
Today prices sit in characters 41–47 of a description field in PHL's shared code table, billing staff keep a per-request Excel worksheet (planned units, actual units, charge date, initials, billing QC sign-off), and charges leave PHL as the Rpt080 extract file. The CY2027 worksheet has 65 lines that reduce to 55 charge codes in 7 sections.

## Decision
- **Price lists are rows, effective-dated, and frozen once approved** (`billing.PriceList`, `billing.PriceListItem`, trigger `TR_PriceListItem_Frozen`). Approved lists may not overlap. A new year is a new list; the old one gets an end date.
- **An unpriced code (NULL price) cannot be charged.** The CY2027 list has three; the approver sees them before approving.
- **Charge codes belong to one or more sections** (labor HP009002 is in six), and a charge line records the section it was charged in, so effort by area stays reportable.
- **"(DEFINE)" codes need a description** (labor, reagents, custom stain).
- **The worksheet maps to the model:** planned units → `billing.EstimateLine` (total = initial cost estimate for NAS); actual units with charge date and initials → `billing.ChargeLine` (EnteredBy); billing QC → `ChargeLine.Approve()` plus a `billing.BillingReview` row.
- **Life cycle:** Pending → Approved → Released (in a billing batch). Pending or approved lines can be voided; released lines are locked (`TR_ChargeLine_Protect`) and corrected by adjustment lines priced like the original.
- **Amounts** are units × price rounded half away from zero, identical in C# and in the SQL persisted columns.
- **Automatic rules are configuration and ship disabled:** the legacy STAT surcharge (no surcharge code in CY2027) and WSI analysis labor (4 units per 6 images; labor code and rounding unconfirmed).
- **Billing export reproduces Rpt080** until the billing owner agrees on something better. Field order, delimiter, trans_date and requestor format must be verified against a real file.
- **Batches are per lab of the charge code** (HP or PA). *Open question:* PHL batched by the request's lab; confirm with the billing owner.

## Consequences
- Price changes become an approval step with a full history instead of an edit to a code table.
- Parallel billing runs compare Rpt080 output line by line, so the extract formulas are unit-tested.
