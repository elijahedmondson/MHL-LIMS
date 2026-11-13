/* =============================================================================
   MHL LIMS migration  -  run_all.sql
   Runs every loader in order against the LIMS development database, after Copy-LegacyToStage.ps1 and
   010_check_stage.sql. Run in SQLCMD mode from this folder:

     sqlcmd -S <server> -d <lims database> -E -I -f 65001 -i run_all.sql

   Each loader is re-runnable and stops the whole run if it fails (see legacy.LoadRun / legacy.LoadIssue).
   Order for a real run: 000_support.sql, Copy-LegacyToStage.ps1, 010_check_stage.sql, then this file.
   The Zaphod loaders match animals to the PHL subjects, so the PHL half must have been loaded first.
   ============================================================================= */
:on error exit
:setvar Path "."
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
:r $(Path)\000_support.sql
:r $(Path)\005_stage_views.sql
:r $(Path)\100_load_reference.sql
:r $(Path)\110_load_requests.sql
:r $(Path)\120_load_tracking.sql
:r $(Path)\130_load_charges.sql
:r $(Path)\200_load_zaphod_dictionaries.sql
:r $(Path)\210_load_zaphod_studies.sql
:r $(Path)\220_load_zaphod_necropsy.sql
:r $(Path)\230_load_zaphod_pathology.sql
:r $(Path)\235_sign_pathology_cases.sql
:r $(Path)\900_reconcile.sql
:r $(Path)\910_reconcile_zaphod.sql
PRINT N'Migration run finished. Review the reconcile output and legacy.LoadIssue.';
