/* =============================================================================
   MHL LIMS  -  deploy_all.sql
   Creates a fresh development database. Run in SQLCMD mode, from this folder:

     sqlcmd -S <server> -d <database> -E -I -f 65001 -i deploy_all.sql

   (-f 65001 reads the scripts as UTF-8; 120 and 130 contain names such as "β-gal".)

   (-I turns on QUOTED_IDENTIFIER, which filtered indexes need.)
   In SSMS: Query > SQLCMD Mode, and set DbPath below to the full path of this folder. The scripts are written for
   SQL Server 2019 or later and an empty database. They are not migrations;
   see README.md for how schema changes are handled.
   ============================================================================= */
:on error exit
:setvar DbPath "."
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
:r $(DbPath)\001_schemas.sql
:r $(DbPath)\010_reference_and_security.sql
:r $(DbPath)\020_core.sql
:r $(DbPath)\030_tracking.sql
:r $(DbPath)\040_billing.sql
:r $(DbPath)\050_audit_and_legacy.sql
:r $(DbPath)\060_ihc.sql
:r $(DbPath)\070_necropsy_and_pathology.sql
:r $(DbPath)\100_seed_reference_data.sql
:r $(DbPath)\110_seed_price_list_CY2027.sql
:r $(DbPath)\120_seed_pathology_dictionary.sql
:r $(DbPath)\130_seed_ihc_catalog.sql
PRINT N'MHL LIMS database deployed.';
