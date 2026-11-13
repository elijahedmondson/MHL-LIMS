/* =============================================================================
   MHL LIMS  -  001_schemas.sql
   Creates the database schemas. Safe to re-run.

   ref      reference data (labs, work areas, request types, species ...)
   sec      users and roles (identities come from NIH single sign-on / AD)
   lims     core records: investigators, projects, NAS requests, requests,
            studies, subjects, specimens, blocks, slides
   trk      tracking events (who moved what, where, when)
   billing  charge codes, price lists, estimates, charge lines, billing batches
   ihc      IHC assay catalog and IHC requests from the investigator form (replaces phlrequest)
   path     necropsy and pathology (replaces Zaphod)
   audit    application event log (complements temporal history tables)
   legacy   crosswalk to PHL.exe and Zaphod keys, migration run log
   history  system-versioned (temporal) history tables
   ============================================================================= */
SET NOCOUNT ON;
IF SCHEMA_ID(N'ref')     IS NULL EXEC (N'CREATE SCHEMA ref');
IF SCHEMA_ID(N'sec')     IS NULL EXEC (N'CREATE SCHEMA sec');
IF SCHEMA_ID(N'lims')    IS NULL EXEC (N'CREATE SCHEMA lims');
IF SCHEMA_ID(N'trk')     IS NULL EXEC (N'CREATE SCHEMA trk');
IF SCHEMA_ID(N'billing') IS NULL EXEC (N'CREATE SCHEMA billing');
IF SCHEMA_ID(N'ihc')     IS NULL EXEC (N'CREATE SCHEMA ihc');
IF SCHEMA_ID(N'path')    IS NULL EXEC (N'CREATE SCHEMA path');
IF SCHEMA_ID(N'audit')   IS NULL EXEC (N'CREATE SCHEMA audit');
IF SCHEMA_ID(N'legacy')  IS NULL EXEC (N'CREATE SCHEMA legacy');
IF SCHEMA_ID(N'history') IS NULL EXEC (N'CREATE SCHEMA history');
GO
