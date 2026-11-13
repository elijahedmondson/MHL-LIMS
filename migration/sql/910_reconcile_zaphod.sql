/* =============================================================================
   MHL LIMS migration  -  910_reconcile_zaphod.sql   (Zaphod half)
   Read-only checks to run after 200-235. Every section returns a result set; nothing is changed.
   ============================================================================= */
SET NOCOUNT ON;

/* ---- A. Counts: Zaphod stage -> migrated. Differences should be explained by legacy.LoadIssue. ---- */
SELECT Entity, ZaphodRows, Migrated, ZaphodRows - Migrated AS NotMigrated
FROM (
    SELECT N'Studies' AS Entity, (SELECT COUNT(*) FROM stage.ZAP_tblStudies) AS ZaphodRows, (SELECT COUNT(*) FROM lims.Study WHERE IsLegacy = 1) AS Migrated
    UNION ALL SELECT N'Animals', (SELECT COUNT(*) FROM stage.ZAP_tblAnimals), (SELECT COUNT(*) FROM legacy.AnimalSource)
    UNION ALL SELECT N'Necropsy headers', (SELECT COUNT(*) FROM stage.ZAP_tblNecropsyHeaders), (SELECT COUNT(*) FROM path.Necropsy)
    UNION ALL SELECT N'Necropsy organs', (SELECT COUNT(*) FROM stage.ZAP_tblNecropsyOrgans), (SELECT COUNT(*) FROM path.NecropsyOrgan)
    UNION ALL SELECT N'Necropsy findings', (SELECT COUNT(*) FROM stage.ZAP_tblNecropsyFindings), (SELECT COUNT(*) FROM path.NecropsyFinding)
    UNION ALL SELECT N'Pathology cases', (SELECT COUNT(*) FROM stage.ZAP_tblPathologyHeaders), (SELECT COUNT(*) FROM path.PathologyCase)
    UNION ALL SELECT N'Pathology tissues', (SELECT COUNT(*) FROM stage.ZAP_tblPathologyOrgans), (SELECT COUNT(*) FROM path.PathologyTissue)
    UNION ALL SELECT N'Pathology diagnoses', (SELECT COUNT(*) FROM stage.ZAP_tblPathologyDiagnoses), (SELECT COUNT(*) FROM path.PathologyDiagnosis)
    UNION ALL SELECT N'Pathology correlations', (SELECT COUNT(*) FROM stage.ZAP_tblPathologyCorrelation), (SELECT COUNT(*) FROM path.PathologyCorrelation)
) AS t
ORDER BY Entity;

/* ---- B. How animals were matched to PHL subjects, and which are missing.
         Almost every animal should be PHL+REQ. A lot of PHL_UNIQUE or PHL+ZAP means Zaphod's ReqNbr is stored in a
         different format than PHL's request id: look at both before trusting the matches. ---- */
SELECT MatchBasis, COUNT(*) AS Animals FROM legacy.AnimalSource GROUP BY MatchBasis ORDER BY MatchBasis;
SELECT N'Animals in Zaphod not loaded' AS Problem, COUNT(*) AS Animals
FROM stage.ZAP_tblAnimals AS a
WHERE NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblAnimals' AND x.SourceKey = UPPER(LTRIM(RTRIM(a.PHLNbr))));
/* ---- C. Pathology complete in Zaphod vs signed here (difference = cases blocked in 235, see SIGN_BLOCKED) ---- */
SELECT (SELECT COUNT(*) FROM legacy.AnimalSource WHERE PathologyComplete = 1) AS ZaphodComplete,
       (SELECT COUNT(*) FROM path.PathologyCase WHERE Status = N'SIGNED') AS SignedHere,
       (SELECT COUNT(*) FROM legacy.AnimalSource WHERE NecropsyApproved = 1) AS ZaphodNecropsyApproved,
       (SELECT COUNT(*) FROM path.Necropsy WHERE Status = N'APPROVED') AS ApprovedHere;


/* ---- D. Everything flagged on the Zaphod side ---- */
SELECT IssueCode, Severity, COUNT(*) AS Occurrences FROM legacy.LoadIssue WHERE SourceSystem = N'ZAPHOD' GROUP BY IssueCode, Severity
ORDER BY CASE Severity WHEN N'SKIPPED' THEN 1 WHEN N'REVIEW' THEN 2 WHEN N'CORRECTED' THEN 3 ELSE 4 END, IssueCode;

/* ---- E. Cases per status and fate/condition spread, for a quick look with a pathologist ---- */
SELECT Status, COUNT(*) AS Cases FROM path.PathologyCase GROUP BY Status;
SELECT Status, COUNT(*) AS Necropsies FROM path.Necropsy GROUP BY Status;
SELECT TOP (20) Fate, COUNT(*) AS Necropsies FROM path.Necropsy GROUP BY Fate ORDER BY COUNT(*) DESC;
GO
