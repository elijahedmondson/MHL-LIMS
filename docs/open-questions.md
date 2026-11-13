# Open questions blocking design choices

Each has an owner to find and a phase by which it must be answered.

| # | Question | Why it matters | Needed by |
|---|---|---|---|
| 1 | When does contract year 2027 start? The CY2027 price list is loaded with a placeholder effective date of 1 January 2027. | Charges are priced by date | Before approving the price list |
| 2 | The worksheet's price columns are labeled "CY2026 Price" and "CY2024 Price". Are these the CY2027 prices? | Wrong prices for a whole year | Before approving the price list |
| 3 | What are the prices for HP002017, HP002018 and HP003007 (blank on the worksheet)? What is the unit for HP006005? | Unpriced codes cannot be charged | Before approving the price list |
| 4 | Are STAT surcharges still charged, and with which code (legacy HP009050)? | STAT rule is disabled until confirmed | Phase 2 |
| 5 | For WSI analysis labor: which code (HP009002 or PA001004), and how are partial groups of 6 images rounded? | Rule is disabled until confirmed | Phase 4 |
| 6 | How are 10x Xenium runs billed? No code mentions Xenium. | Missing service in billing | Phase 4 |
| 7 | Sequential or year-prefixed PHL numbers? If year-prefixed, calendar or contract year? | Number generator configuration | Phase 2 |
| 8 | Keep the legacy request ID format? | Rpt080 trans_id uses the last 5 characters | Phase 2 |
| 9 | Which system is the billing system of record: the Rpt080 extract, NAS, or both? | Billing export design | Phase 0 |
| 10 | A real Rpt080 file and a description of who consumes it. | Verify field order, delimiter, dates | Phase 2 |
| 11 | Should billing batches split by the request's lab (as PHL did) or by the charge code's lab? | Batch selection rule | Phase 2 |
| 12 | Which AD groups map to which LIMS roles? | Authorization policies | Phase 1 |
| 13 | Access to `nas_information` (read grant) and a NAS API, if any. | NAS intake and status | Phase 1 |
| 14 | The real code sets: request types (REQTY), fixatives, species, work areas in use. | Seed data marked PLACEHOLDER | Phase 1 |

## IHC request system (phlrequest.ncifcrf.gov)

Added November 2026, when the IHC assay database and request form were brought into the pilot. Questions about the catalog's content itself (the "DOUBLE STAIN" rows, the two lists, unrecognized species, missing incubation times) are in `docs/ihc-catalog-review.md`.

| # | Question | Why it matters | Needed by |
|---|---|---|---|
| 15 | Who hosts phlrequest.ncifcrf.gov and its database (C&SS?), and is it what fills PHL's `r_web_id` and `r_est_turn`? Can MHL get a schema export and a full data export, not just the assay list? | Migrating request history and the full assay table, not a CSV | Phase 0 |
| 16 | Must an IHC request have a NAS request before work starts? The old form asks for a project ID but no NAS#. The pilot lets staff accept it and link the NAS request later. | Intake rule and billing | Phase 2 |
| 17 | When an IHC request is for blocks MHL already holds, should the request reuse their PHL numbers (as PHL.exe allowed) or issue new ones linked to the originals? The pilot issues new ones and keeps the link. | PHL# uniqueness and specimen history | Phase 2 |
| 18 | How are these billed: a chromogenic duplex or multiplex (the pilot assumes n × HP006004 per slide), non-Opal immunofluorescence (assumed HP006004), optimizing a new antibody (assumed HP009002 × 8), and scanning Opal slides (assumed HP001009)? | Estimates and charges for IHC | Phase 4 |
| 19 | Should investigators see the whole assay catalog, including control-tissue notes, and an estimated cost when they submit? | Investigator portal design | Phase 4 |
| 20 | Which pathologists should the form offer, and does choosing one assign the case? | Form choices and pathology worklists | Phase 3 |

## Pathology (added to the pilot November 2026)

| # | Question | Why it matters | Needed by |
|---|---|---|---|
| 21 | Zaphod's diagnosis dictionary (tblDiagnosis), severity, distribution, neoplasm and "H/N" lists, and the per-study diagnosis lists. What does H/N mean? The pilot uses a starter list in INHAND style. | Controlled terms for reports and summaries | Phase 3 |
| 22 | How is pathology billed: PA001002 per glass slide read (the pilot's rule, with tissues on one block counted once), per tissue, or per animal? When is PA001004 (labor per quarter hour) used? | Pathology charges at sign-out | Phase 3 |
| 23 | Must every gross finding be correlated (or marked "no microscopic correlate") before sign-out, as the pilot requires? Is a severity grade required for every non-neoplastic diagnosis? | Sign-out rules | Phase 3 |
| 24 | Does any MHL work need GLP / 21 CFR Part 11 controls for pathology sign-out (signature meaning, peer review, locked versions)? The pilot keeps every signed version and requires a reason to amend. | Electronic signature design and validation | Phase 0 |
| 25 | Which Zaphod reports are still used (more than 30 SSRS reports), and what must the printed animal reports look like, including the lab name, logo and distribution to the PI? | Report templates | Phase 3 |
| 26 | Should pathology cover IHC interpretation (scoring, H-score, percent positive) for IHC requests, or stay with descriptive diagnoses? | Scope of the pathology module | Phase 4 |

## Protocols, terminology, bloodwork and IHC ordering (added to the pilot November 2026)

The Zaphod and PHL source code (November 2026) answered some earlier questions: PHL staff type the IHC web request ID into the request (`r_web_id`), which then sets the estimated turnaround (question 15, in part); Zaphod's protocols are `tblNecropsyProtocols` with `vwNecropsyProtocolStep`, and `tblTrimProtocols` with `vwTrimOrgans` (block and sex per organ); and the chemistry and hematology importers read fixed positions in the PuTTY log and the Hemavet sheet.

| # | Question | Why it matters | Needed by |
|---|---|---|---|
| 27 | Who can run `tools/zaphod-export/export_zaphod_reference.sql` against the production Zaphod database (C&SS?), and do the view and table names match production? | Real protocols, dictionaries and reference ranges in the pilot | Before area testing |
| 28 | What does Zaphod's diagnosis Code (H/N) mean? The import treats N as neoplasm (see question 21). | Neoplasm flag on imported diagnoses | Phase 3 |
| 29 | Were Piccolo results ever imported through Zaphod? Its reader assumes the VetScan Comprehensive Diagnostic Profile order, so a Piccolo panel would have been stored under the wrong analyte names. The pilot reads analytes by name. | Trusting historical chemistry data | Phase 1 (data profiling) |
| 30 | Serial settings for the VS2 and Piccolo (baud, data bits), and a real PuTTY log and Hemavet DMS export from each instrument now in use. Which Hemavet layout does the Genesis export today? | Testing the imports and the serial capture on real output | Before area testing |
| 31 | Are Zaphod's reference ranges current, and should ranges vary by strain, sex or age rather than species only? | Flags on results | Phase 3 |
| 32 | Is cytology billed? No code on the CY2027 list. Who releases bloodwork: the technician, or a pathologist? | Charges and permissions | Phase 3 |
| 33 | Which SEND controlled-terminology version should the library follow, and does any client need SEND datasets (GLP)? Will MHL use goRENI (free registration) as the reference for INHAND criteria? | Terminology maintenance and export scope | Phase 3 |
| 34 | For IHC ordered with a new request, should stains be chosen per PHL number or block rather than for all? Should the IHC team accept these orders, as for web requests, rather than them being accepted on creation? | Intake workflow for IHC | Phase 2 |

## Whole-slide imaging, dilutions and billing view (added to the pilot November 2026)

| # | Question | Why it matters | Needed by |
|---|---|---|---|
| 35 | How are Aperio FL scans and brightfield scans on the PhenoImager HT billed? The CY2027 list has Aperio 20x and 40x (HP001006, HP001007) and Akoya HT fluorescence at 20x (HP001009) only. The pilot charges the FL and PhenoImager brightfield as Aperio scans by magnification, and 40x multispectral as HP001009. | Scan charges | Phase 4 |
| 36 | A real image file from each scanner (or just its first few megabytes), and where each scanner saves: output share paths, file-naming rules, and whether the GT 450 and AT2 write the barcode into the .svs. Is eSlide Manager (Aperio database) or HALO Link the place images are catalogued today? | Registering images reliably; matching by barcode rather than file name | Before WSI testing |
| 37 | What barcode do slide labels carry today (PHL# only, or PHL# with block and slide), and can the scanners read 2D DataMatrix? | Matching images to slides; label design (roadmap 5.4) | Phase 2 |
| 38 | Should registering an image move the PHL number to Scan automatically, and should "scanning done" require a passed image for every expected slide rather than at least one? Who passes scan QC: the scanning technician or the pathologist? | Tracking and QC rules for WSI | Phase 4 |
| 39 | Dispense volume per slide and dead volume on each staining platform (BOND, other autostainers, manual), and the antibody diluent used. The calculator assumes 150 µL on the BOND and 100 µL by hand. | Correct antibody volumes and prep sheets | Before IHC testing |
| 40 | In Lookup, should "charged so far" be compared with the estimate sent to NAS (as now), with the NAS authorization, or both as separate columns? Should released charges be shown separately from pending ones? | What the billing column tells staff | Before area testing |

## Request numbers and the tracking sheet (added to the pilot November 2026)

The pilot's tracking sheet follows PHL.exe's print (`d_cmp001`, made of `d_req_prt` and `d_phl_prt_hp`). On the legacy form, "Contact" is the team member assigned to the request (`r_assign_team`) and "Tissue Disp" is `r_inves_disp` (code set IDISP).

| # | Question | Why it matters | Needed by |
|---|---|---|---|
| 41 | Who may type a request number instead of taking the next automatic one, and when? Only for work carried over from PHL.exe (IDs such as 270333 and 270333A), or for any reason? Should production keep the lab + year + counter format (HP260103), or continue the PHL.exe numbering? | Request number policy; the pilot lets anyone type one, checked for duplicates and for clashes on the Rpt080 trans ID (lab letter + last five characters) | Phase 1 |
| 42 | The full list of tissue disposition codes (IDISP) and what each means. Only RTRN is known; the pilot takes free text. | A pick list instead of free text; what happens to tissue after the work | Phase 1 |
| 43 | On the tracking sheet: is six PHL numbers per page right? Which columns does each lab want (the pilot adds Xenium when a request includes it, and shades areas the request does not include)? Who is "Contact": the staff member who entered the request (as in the pilot) or an assigned team member? | Printing a sheet staff will use | Phase 2 |
| 44 | The legacy sheet's barcode is Code 39; the pilot prints Code 128, which is shorter and which most handheld scanners also read. Do any bench scanners read only Code 39? Should each PHL number on the sheet carry its own barcode for scanning at each area? | Barcode choice for sheets and labels (roadmap 5.4) | Phase 2 |

## Estimates for possible new projects (added to the pilot November 2026)

| # | Question | Why it matters | Needed by |
|---|---|---|---|
| 45 | Who prepares and sends estimates, and does any estimate need approval first (the lab manager, or above a dollar amount)? Is 90 days the right validity? | Who can use the Estimates tab, and whether "Mark as sent" needs an approval step | Phase 1 |
| 46 | For projects running past the current price list (CY2027), should estimates add a yearly increase for later phases, or quote today's prices with the terms as printed? | The amount investigators budget for multi-year work | Phase 1 |
| 47 | How should work that is not on the price list be quoted and later charged: Xenium runs, optimizing new antibodies, other custom work? Should each map to a code (HP009002 labor, HP005007 custom stain) when the request is created? | Lines not on the price list are left out of the NAS scope today | Phase 1 |
| 48 | Does the NAS request have a field for an MHL estimate number, so an accepted estimate could be linked automatically? Should the NAS authorized amount be checked against the accepted estimate? | Linking estimates to NAS without retyping | Phase 2 |
| 49 | Do investigators outside NCI (or other rate classes) get different prices or added overhead on estimates? | Whether one price list fits every estimate | Phase 1 |
| 50 | Should investigators accept estimates online, in the Phase 4 investigator portal? Is an estimate template or wording required by the business office? The pilot's suggested email wording and terms are a first draft. | Recording the answer without email back and forth | Phase 4 |
| 51 | Which Outlook do staff use: classic Outlook, new Outlook or Outlook on the web? The pilot's "Open in Outlook" file opens as a ready-to-send message in classic Outlook; the others may show it as a received message (Copy the email works everywhere). In production, can the LIMS server send through the NIH mail relay or Microsoft Graph from a shared MHL mailbox, and how long must sent estimates be kept? | How estimates are emailed in production, and records retention | Phase 1 |

## Several requests per NAS request, Molecular work and study reports (added to the pilot November 2026)

| # | Question | Why it matters | Needed by |
|---|---|---|---|
| 52 | When one NAS request funds several requests, who closes it, and should a new request be refused (rather than warned) when its estimate is more than what is left of the authorization? Does NAS itself allow one approval to fund several MHL requests, or should each request have its own NAS request? | Funding control; how the LIMS reads NAS | Phase 1 |
| 53 | Who assigns IHC work and Xenium runs, and to whom (a staff list by role)? Are Not started, In progress and Done enough, or does the IHC team want steps (cut, stained, scanned, QC)? Should assignment notify the person by email? | Molecular work tracking | Phase 2 |
| 54 | Xenium: which panels MHL stocks, how many Xenium Analyzers, which steps and quality numbers to record, where output data is delivered, and how runs are billed (no code on CY2027). Can the run summary files be read automatically? | Xenium tracking and billing | Phase 2 |
| 55 | Study reports: which statistics the pathologists want (Fisher's exact test for incidence, as in the pilot; Dunnett's test or ANOVA for organ weights and clinical pathology), which group is the control (the pilot uses the first group), whether historical control data should appear, and whether study reports need sign-off and versioning like animal reports (and GLP controls, question 24). | Study report content and sign-off | Phase 3 |
| 56 | The pilot fixed the order of the request tabs and the top tabs as the lab asked. Should tabs that do not apply to a request (Necropsy for a slide-scanning request, say) be hidden instead of grayed? | Screen design | Phase 2 |

## Animal lists from investigators (added to the pilot November 2026)

| # | Question | Why it matters | Needed by |
|---|---|---|---|
| 57 | Are the template's columns the right ones (Animal ID, Group, Sex, Strain, Genotype, Date of birth, Age, Cage, Treatment, Priority, Notes)? Should it ask for more, such as the requested necropsy date, body weight at dosing, or the tissues wanted per animal? A few investigators' real spreadsheets would show what they already send. | What investigators fill in, and what the LIMS keeps per animal | Phase 1 |
| 58 | When the list arrives after the request has been created, should it update the existing PHL numbers (labels, sex, groups) rather than only filling in a new request? Who may change an animal's details once necropsy has started? | Lists rarely arrive before the request | Phase 2 |
| 59 | For human samples and organoid lines the pilot keeps no date of birth, keeps ages over 89 as "90 or older", and warns that notes must hold no identifiers. Is that what the NIH privacy office and the IRB expect, and should PDX models be treated the same? | Identifiable information in the LIMS | Phase 1 |

