# Legacy-to-LIMS field mapping

Derived from the PHL.exe and Zaphod source code (DataWindow column definitions, VB SqlParameters, typed datasets and SSRS report queries) and from the target schema in `db/`. **Basis** says how sure the legacy side is: *Known* = decoded from the source code, *Assumed* = inferred and checked by `sql/010_check_stage.sql`, *Guess* = a business meaning that a person must confirm (the guess is stored in `legacy.MapValue` or the loader, so it is easy to change).

Legacy text columns in PHL are fixed-width `CHAR`; the clean views in `sql/005_stage_views.sql` trim them and turn empty text into NULL.

## PHL tracking and billing

### `phl_request` → `lims.Request` (+ `lims.RequestArea`, `legacy.RequestSource`)

| Legacy column | Target | Rule | Basis |
|---|---|---|---|
| `r_lab`, `r_req_id` | `LabCode`, `RequestNumber`, crosswalk key `lab|req` | Request number = legacy id; second lab with the same id gets `-<lab>` | Known (rule: open question 8) |
| `r_inves_no` | `InvestigatorId` | via `lims.Investigator.LegacySsgInvesNo`; none → placeholder investigator | Known |
| `r_inves_last/first_mi/title/institute` | `legacy.RequestSource.InvestigatorNameAsEntered`; creates the investigator when missing from the registry | | Known |
| `r_inves_disp` | `TissueDisposition` | code kept as is | Known |
| `r_center_no` | `ProjectId` (creates `lims.Project` rows, inactive) and `legacy.RequestSource.CenterNo` | Costpoint sync completes the project rows | Known |
| `r_apo_no` | `NasRequestId` when it equals a NAS display id; always kept in `RequestSource.ApoNo` | older CSAS/APO numbers stay text only | Known |
| `r_rec_date`, `r_due_date`, `r_comp_date` | `ReceivedDate`, `DueDate`, `CompletedDate` | missing received date filled from completed/update date, else 1990-01-01; completed < received is set to received (both logged) | Known |
| `r_charge_type` | `ChargeType` (C/N/L), and `Status` | L → CANCELLED; completed date → COMPLETE; else OPEN | Known |
| `r_req_type` | `RequestTypeCode` | missing codes are added to `ref.RequestType` with start area ENTRY; remap in `legacy.MapValue` `REQTYPE`; blank → `LEGACY-UNKNOWN` | Known; start areas **Guess** |
| `r_necro/trimm/embed/micro/stain/photo/out/other`, `r_other_area` | `lims.RequestArea` rows | anything other than N or 0 counts as ticked; photo → IMAGE; PA-lab requests also get PATHO | Assumed (Y/N values) |
| `r_desc` | `Description` | | Known |
| `r_fixative` | `FixativeCode` | missing codes added to `ref.Fixative` | Known |
| `r_species_abbrev`, `r_species_name` | `SpeciesCode` | `legacy.MapValue` `SPECIES`, else the abbreviation; missing codes added to `ref.Species` | Known |
| `r_assign_path`, `r_pa_name` | `AssignedPathologistUserId` | resolved through `legacy.UserResolve` | Known (are these names or codes? check) |
| `r_assign_team`, `r_web_id`, `r_est_turn`, `r_dev`, `r_project`, `r_part`, `r_app_budget`, `r_odrs_budget`, `r_deliverable`, `r_division`, `r_update_*` | `legacy.RequestSource` | no column in `lims.Request`; kept so nothing is lost | Known |

### `phl_phl_no` → `lims.Subject` (+ `legacy.SubjectSource`)

| Legacy column | Target | Rule | Basis |
|---|---|---|---|
| `p_phl_no`, `p_req_id`, `p_lab` | `PhlNumber`, `RequestId`, crosswalk key `lab|req|phl` | `IsLegacy = 1`, so repeated PHL numbers are allowed | Known |
| `p_priority` | `PriorityCode` | R/S/P, anything else → R | Known |
| `p_alt_id`, `p_an_no` | `AltId`, `AnimalNumber` | | Known |
| `p_cenrep_no` (ACUC#), `p_comment` (shown as ZAPNbr), `p_study_no`, `p_group` | `legacy.SubjectSource` | used to match Zaphod animals | Known |
| (species of the request) | `SubjectTypeCode` | MOUSE, RAT, HUMAN → HUMAN_DONOR, otherwise OTHER_ANIMAL; PDX and organoid lines cannot be told apart from the old data | **Guess** |

### `phl_tracking` → `trk.TrackingEvent`

| Legacy column | Target | Rule | Basis |
|---|---|---|---|
| `t_curr_area` → `t_next_area` | `FromAreaCode` → `ToAreaCode` | unknown codes are added to `ref.WorkArea` (inactive) and logged | Known |
| `t_inits` (else `t_update_user`) | `PerformedByUserId` | `legacy.UserResolve`; unmatched initials become inactive placeholder users | Known |
| `t_track_date`, `t_units`, `t_proc`, `t_comment` | `PerformedAt`, `Units`, `ProcedureCode`, `Comment` | | Known |
| `t_status` | text appended to `Comment` | meaning of X is unknown, so it is not turned into `IsRedo` | **Guess** (open) |

### `phl_charge` → `billing.ChargeLine` (+ `billing.BillingBatch`, `billing.ChargeCode`)

| Legacy column | Target | Rule | Basis |
|---|---|---|---|
| `c_charge_code` | `ChargeCode` | codes not in `billing.ChargeCode` are added inactive with the charge's own description | Known |
| `c_charge_units`, `c_charge_price` | `Units`, `UnitPrice` | **historical price kept; never repriced**; zero units, negative price, or no request → skipped and logged | Known |
| negative `c_charge_units` | `SourceType = ADJUSTMENT` | points at the earliest earlier line with the same request, PHL number and code; none → skipped (CREDIT_NO_ORIGINAL) | Known |
| `c_extract_date` | `Status = RELEASED` in a `RELEASED` batch per lab and date (`RPT080`); no extract date → `PENDING` | Pending lines must be reviewed before billing | Known |
| `c_charge_date` | `ChargeDate` | | Known |
| `c_update_user`, `c_update_date` | `EnteredByUserId`, `EnteredAt` | | Known |
| (code → section) | `SectionCode` | first section in `billing.ChargeCodeSection`, else `LEGACY` | Known |
| (price list) | `PriceListId` | one retired list `LEGACY-PHL` | Known |

### Reference sources

| Legacy | Target | Basis |
|---|---|---|
| `ssg_investigators` (system `PHL`) | `lims.Investigator` (`i_inves_no` → `LegacySsgInvesNo`; `i_act_inact` I or N → inactive) | Known; active flag **Guess** |
| `nas_information` | `lims.NasRequest` (one row per NAS id; histology/pathology/MHL service area preferred) | Known |
| `fas_sys_table` set `REQTY` | names of added request types (a leading `*` means inactive) | Known |
| `phl_zaphod`, `phl_sys_table` | staged only | — |

## Zaphod

| Legacy | Target | Rule | Basis |
|---|---|---|---|
| `tblOrgans` | `ref.Organ` | name is the code; `OrganID` → `LegacyZaphodOrganId`; paired-organ flag not loaded | Assumed columns |
| `tblDiagnosis` | `ref.Diagnosis`, `ref.DiagnosisOrgan` | one row per term; Code N → neoplasm | Assumed columns; N **Guess** (open questions 21, 28) |
| `tblSite/Morphology/Shape/Color/Consistency/Fate/Condition/Distribution/PairedOrgans` | `ref.DictionaryTerm` | terms added if missing | Assumed columns |
| `tblNecropsyProtocols`, `tblNecropsyProtocolSteps` | `path.NecropsyProtocol`, `path.NecropsyProtocolOrgan` | fixative, freeze, measure-organ, trim protocols stay in stage | Known |
| `tblStudies` (+ `vwStudies`, `tblACUC`) | `lims.Study` | `InvestigatorID` assumed = `ssg_investigators.i_inves_no`; latest ACUC row | Known; investigator link **Assumed** |
| `tblGroup` | `lims.StudyGroup` | `GroupID` → `GroupCode` | Known |
| `tblAnimals` | updates the matching `lims.Subject`; extras in `legacy.AnimalSource` | match by PHL# + request no., then PHL# + ZAPNbr, then unique PHL#; unmatched/ambiguous are not loaded | Known |
| `tblNecropsyHeaders` | `path.Necropsy` | approved only when approver, approval date and the animal's NecropsyApproved flag all agree (otherwise DRAFT, logged); necropsy date = date of death, else approval date, else request received date; fate "Unknown" if missing | Known |
| `tblNecropsyOrgans`, `tblOrganMeasurements` | `path.NecropsyOrgan` | weights assumed grams, placed on the first row of each organ | Known; unit **Guess** |
| `tblNecropsyFindings` | `path.NecropsyFinding` | free-text size goes to notes | Known |
| `tblPathologyHeaders` | `path.PathologyCase` | loaded as DRAFT with the study's pathologist; signed out by `235` only when Zaphod's PathologyComplete flag and `DateCompleted` are present and everything loaded; signer recorded as `LEGACY\MIGRATION`, time = `DateCompleted` | Known |
| `tblPathologyOrgans` | `path.PathologyTissue` | result via `TISSUE_RESULT` map | Known; map **Guess** |
| `tblPathologyDiagnoses` | `path.PathologyDiagnosis` | severity and neoplasm text via `SEVERITY` and `NEOPLASM` maps | Known + Assumed id column; maps **Guess** |
| `tblPathologyCorrelation` | `path.PathologyCorrelation` | through `tblPathologyFindings.NecropsyFindingID` | Assumed columns |
| `tblChemistry`, `tblHematology` (+ ranges) | **staged only** | the SQL schema has no clinical-pathology tables yet; the pilot has them | — |
| `tblApprovers` | **staged only** | Zaphod role flags; map to `sec.UserRole` by hand | — |

## Not migrated (by design, kept in the stage tables)

Trim protocols, necropsy protocol step fixative/freeze/measure columns, bloodwork results and reference ranges, Zaphod role flags, `phl_key`, FAS login tables, and everything in `fas_demographic` (it contains personal identifiers and is not needed).
