/* =============================================================================
   MHL LIMS migration  -  900_reconcile.sql   (PHL half: requests, subjects, tracking, charges)
   Read-only checks to run after each load. Every section returns a result set; nothing is changed.
   The Zaphod checks are in 910_reconcile_zaphod.sql, so this file runs with only the PHL tables present.
   What "good" looks like is written above each section. Keep the output with the migration record.
   ============================================================================= */
SET NOCOUNT ON;

/* ---- A. Counts: raw stage -> clean view -> migrated. Differences should be explained by legacy.LoadIssue. ---- */
SELECT Entity, StageRaw, StageClean, Migrated, StageClean - Migrated AS NotMigrated
FROM (
    SELECT N'Requests' AS Entity,
           (SELECT COUNT(*) FROM stage.PHL_phl_request) AS StageRaw,
           (SELECT COUNT(*) FROM stage.vRequest) AS StageClean,
           (SELECT COUNT(*) FROM lims.Request WHERE IsLegacy = 1) AS Migrated
    UNION ALL SELECT N'PHL numbers (subjects)', (SELECT COUNT(*) FROM stage.PHL_phl_phl_no), (SELECT COUNT(*) FROM stage.vPhlNo), (SELECT COUNT(*) FROM lims.Subject WHERE IsLegacy = 1)
    UNION ALL SELECT N'Tracking events', (SELECT COUNT(*) FROM stage.PHL_phl_tracking), (SELECT COUNT(*) FROM stage.vTracking),
                     (SELECT COUNT(*) FROM legacy.IdCrosswalk WHERE SourceTable = N'phl_tracking')
    UNION ALL SELECT N'Charge lines', (SELECT COUNT(*) FROM stage.PHL_phl_charge), (SELECT COUNT(*) FROM stage.vCharge),
                     (SELECT COUNT(*) FROM billing.ChargeLine WHERE SourceType IN (N'MIGRATED', N'ADJUSTMENT'))
) AS t
ORDER BY Entity;

/* ---- B. Orphans: child rows whose request is missing (these never load). Should be 0, or explained. ---- */
SELECT N'PHL numbers without a request' AS Problem,
       (SELECT COUNT(*) FROM stage.PHL_phl_phl_no p WHERE NOT EXISTS (SELECT 1 FROM stage.PHL_phl_request r WHERE UPPER(LTRIM(RTRIM(r.r_lab))) = UPPER(LTRIM(RTRIM(p.p_lab))) AND LTRIM(RTRIM(r.r_req_id)) = LTRIM(RTRIM(p.p_req_id)))) AS Rows_
UNION ALL SELECT N'Tracking rows without a request',
       (SELECT COUNT(*) FROM stage.PHL_phl_tracking t WHERE NOT EXISTS (SELECT 1 FROM stage.PHL_phl_request r WHERE UPPER(LTRIM(RTRIM(r.r_lab))) = UPPER(LTRIM(RTRIM(t.t_lab))) AND LTRIM(RTRIM(r.r_req_id)) = LTRIM(RTRIM(t.t_req_id))))
UNION ALL SELECT N'Charges without a request',
       (SELECT COUNT(*) FROM stage.PHL_phl_charge c WHERE NOT EXISTS (SELECT 1 FROM stage.PHL_phl_request r WHERE UPPER(LTRIM(RTRIM(r.r_lab))) = UPPER(LTRIM(RTRIM(c.c_lab))) AND LTRIM(RTRIM(r.r_req_id)) = LTRIM(RTRIM(c.c_req_id))))
UNION ALL SELECT N'Requests present in both PROD and RETIRE copies',
       (SELECT COUNT(*) FROM (SELECT UPPER(LTRIM(RTRIM(r_lab))) AS l, LTRIM(RTRIM(r_req_id)) AS i FROM stage.PHL_phl_request GROUP BY UPPER(LTRIM(RTRIM(r_lab))), LTRIM(RTRIM(r_req_id)) HAVING COUNT(DISTINCT _SourceDb) > 1) AS d);

/* ---- C. MONEY. For each lab and status: the legacy total (units x price) against the migrated total.
         Released and Pending should each match exactly except for rows listed as SKIPPED in D. ---- */
SELECT l.LabCode,
       CASE WHEN l.ExtractDate IS NULL THEN N'not extracted (PENDING)' ELSE N'extracted (RELEASED)' END AS LegacyStatus,
       COUNT(*) AS LegacyLines, CAST(SUM(ROUND(l.Units * COALESCE(l.UnitPrice, 0), 2)) AS decimal(16,2)) AS LegacyAmount
INTO #legacyMoney
FROM stage.vCharge AS l GROUP BY l.LabCode, CASE WHEN l.ExtractDate IS NULL THEN N'not extracted (PENDING)' ELSE N'extracted (RELEASED)' END;

SELECT m.LabCode, m.LegacyStatus, m.LegacyLines, m.LegacyAmount,
       COALESCE(n.Lines, 0) AS MigratedLines, COALESCE(n.Amount, 0) AS MigratedAmount,
       m.LegacyAmount - COALESCE(n.Amount, 0) AS Difference
FROM #legacyMoney AS m
LEFT JOIN (SELECT r.LabCode,
                   CASE WHEN cl.Status = N'RELEASED' THEN N'extracted (RELEASED)' ELSE N'not extracted (PENDING)' END AS LegacyStatus,
                   COUNT(*) AS Lines, CAST(SUM(cl.Amount) AS decimal(16,2)) AS Amount
            FROM billing.ChargeLine AS cl JOIN lims.Request AS r ON r.RequestId = cl.RequestId
            WHERE cl.SourceType IN (N'MIGRATED', N'ADJUSTMENT') GROUP BY r.LabCode, CASE WHEN cl.Status = N'RELEASED' THEN N'extracted (RELEASED)' ELSE N'not extracted (PENDING)' END) AS n
       ON n.LabCode = m.LabCode AND n.LegacyStatus = m.LegacyStatus
ORDER BY m.LabCode, m.LegacyStatus;
DROP TABLE #legacyMoney;

-- Raw legacy total straight from the copied table, before any view: the view and the migrated total must both agree with it
-- (a difference from the view line means the cleaning/de-duplication step changed money; stop and look).
SELECT UPPER(LTRIM(RTRIM(c_lab))) AS LabCode, COUNT(*) AS RawLines,
       CAST(SUM(ROUND(CAST(c_charge_units AS decimal(18,4)) * CAST(COALESCE(c_charge_price, 0) AS decimal(18,4)), 2)) AS decimal(18,2)) AS RawAmount_AllRows
INTO #raw FROM stage.PHL_phl_charge GROUP BY UPPER(LTRIM(RTRIM(c_lab)));
SELECT r.LabCode, r.RawLines, r.RawAmount_AllRows, v.ViewLines, v.ViewAmount, r.RawAmount_AllRows - COALESCE(v.ViewAmount, 0) AS RawMinusView
FROM #raw AS r
LEFT JOIN (SELECT LabCode, COUNT(*) AS ViewLines, CAST(SUM(ROUND(Units * COALESCE(UnitPrice, 0), 2)) AS decimal(18,2)) AS ViewAmount FROM stage.vCharge GROUP BY LabCode) AS v ON v.LabCode = r.LabCode
ORDER BY r.LabCode;
-- A difference here is normal ONLY for charges whose request is missing from the request table (listed in section B) and for rows
-- present in both the production and archive copies (the view keeps one of each pair).
DROP TABLE #raw;

-- Legacy charge lines that cannot load, grouped by reason (their amounts explain differences in the table above)
SELECT CASE WHEN l.Units IS NULL THEN N'units missing' WHEN l.Units = 0 THEN N'zero units' WHEN l.UnitPrice < 0 THEN N'negative price'
            WHEN l.ChargeCode IS NULL THEN N'no charge code' END AS Reason,
       COUNT(*) AS LegacyLines, CAST(SUM(ROUND(COALESCE(l.Units, 0) * COALESCE(l.UnitPrice, 0), 2)) AS decimal(16,2)) AS LegacyAmount
FROM stage.vCharge AS l
WHERE l.Units IS NULL OR l.Units = 0 OR l.UnitPrice < 0 OR l.ChargeCode IS NULL
GROUP BY CASE WHEN l.Units IS NULL THEN N'units missing' WHEN l.Units = 0 THEN N'zero units' WHEN l.UnitPrice < 0 THEN N'negative price' WHEN l.ChargeCode IS NULL THEN N'no charge code' END;

-- Rows that were loadable but are not in the crosswalk (credits with no original, unusable charge codes, ...): count by lab
SELECT v.LabCode, v.Total AS ViewRows, COALESCE(x.Loaded, 0) AS LoadedRows, v.Total - COALESCE(x.Loaded, 0) AS NotLoaded
FROM (SELECT LabCode, COUNT(*) AS Total FROM stage.vCharge GROUP BY LabCode) AS v
LEFT JOIN (SELECT LEFT(SourceKey, CHARINDEX(N'|', SourceKey) - 1) AS LabCode, COUNT(*) AS Loaded FROM legacy.IdCrosswalk WHERE SourceTable = N'phl_charge' GROUP BY LEFT(SourceKey, CHARINDEX(N'|', SourceKey) - 1)) AS x
       ON x.LabCode = v.LabCode
ORDER BY v.LabCode;

-- Profile of the legacy extract dates: dates like 1900-01-01 would be a "never extracted" marker, not a real export
SELECT YEAR(ExtractDate) AS ExtractYear, COUNT(*) AS LegacyLines FROM stage.vCharge WHERE ExtractDate IS NOT NULL GROUP BY YEAR(ExtractDate) ORDER BY ExtractYear;

-- Released amounts per extract date: compare each line with the legacy Rpt080 totals for that run
SELECT b.LabCode, b.PeriodStart AS ExtractDate, b.LineCount, b.TotalAmount
FROM billing.BillingBatch AS b WHERE b.ExportFormat = N'RPT080' AND b.CreatedByUserId = (SELECT UserId FROM sec.AppUser WHERE AdAccount = N'LEGACY\MIGRATION')
ORDER BY b.LabCode, b.PeriodStart;

-- Charges waiting for review: not extracted by PHL, loaded as PENDING. By year entered.
SELECT YEAR(ChargeDate) AS ChargeYear, COUNT(*) AS PendingLines, CAST(SUM(Amount) AS decimal(16,2)) AS PendingAmount
FROM billing.ChargeLine WHERE Status = N'PENDING' AND SourceType IN (N'MIGRATED', N'ADJUSTMENT')
GROUP BY YEAR(ChargeDate) ORDER BY ChargeYear;

/* ---- D. Everything the loaders corrected, skipped or flagged ---- */
SELECT SourceSystem, SourceTable, IssueCode, Severity, COUNT(*) AS Occurrences
FROM legacy.LoadIssue GROUP BY SourceSystem, SourceTable, IssueCode, Severity
ORDER BY CASE Severity WHEN N'SKIPPED' THEN 1 WHEN N'REVIEW' THEN 2 WHEN N'CORRECTED' THEN 3 ELSE 4 END, SourceTable, IssueCode;

/* ---- E. Request-level differences (first 50). Subject counts should match; charge totals should match for
         requests whose charges all loaded. Use these for the side-by-side spot check with the old applications. ---- */
SELECT TOP (50) r.RequestNumber, rs.LegacyLab, rs.LegacyReqId,
       (SELECT COUNT(*) FROM stage.vPhlNo p WHERE p.LabCode = rs.LegacyLab AND p.ReqId = rs.LegacyReqId) AS LegacySubjects,
       (SELECT COUNT(*) FROM lims.Subject s WHERE s.RequestId = r.RequestId) AS MigratedSubjects,
       (SELECT CAST(SUM(ROUND(c.Units * COALESCE(c.UnitPrice, 0), 2)) AS decimal(14,2)) FROM stage.vCharge c WHERE c.LabCode = rs.LegacyLab AND c.ReqId = rs.LegacyReqId) AS LegacyCharges,
       (SELECT CAST(SUM(cl.Amount) AS decimal(14,2)) FROM billing.ChargeLine cl WHERE cl.RequestId = r.RequestId AND cl.SourceType IN (N'MIGRATED', N'ADJUSTMENT')) AS MigratedCharges
FROM lims.Request AS r JOIN legacy.RequestSource AS rs ON rs.RequestId = r.RequestId
WHERE (SELECT COUNT(*) FROM stage.vPhlNo p WHERE p.LabCode = rs.LegacyLab AND p.ReqId = rs.LegacyReqId) <> (SELECT COUNT(*) FROM lims.Subject s WHERE s.RequestId = r.RequestId)
   OR COALESCE((SELECT SUM(ROUND(c.Units * COALESCE(c.UnitPrice, 0), 2)) FROM stage.vCharge c WHERE c.LabCode = rs.LegacyLab AND c.ReqId = rs.LegacyReqId), 0)
      <> COALESCE((SELECT SUM(cl.Amount) FROM billing.ChargeLine cl WHERE cl.RequestId = r.RequestId AND cl.SourceType IN (N'MIGRATED', N'ADJUSTMENT')), 0)
ORDER BY r.RequestNumber;

/* ---- F. Random sample of 25 migrated requests for a hand check against PHL.exe ---- */
SELECT TOP (25) r.RequestNumber, rs.LegacyLab, i.LastName AS Investigator, r.ReceivedDate, r.CompletedDate, r.Status,
       (SELECT COUNT(*) FROM lims.Subject s WHERE s.RequestId = r.RequestId) AS Subjects,
       (SELECT CAST(SUM(Amount) AS decimal(14,2)) FROM billing.ChargeLine cl WHERE cl.RequestId = r.RequestId) AS Charges
FROM lims.Request AS r
JOIN legacy.RequestSource AS rs ON rs.RequestId = r.RequestId
JOIN lims.Investigator AS i ON i.InvestigatorId = r.InvestigatorId
ORDER BY NEWID();

/* ---- G. For information: PHL numbers used on more than one request (PHL allowed this; new numbers may not) ---- */
SELECT COUNT(*) AS PhlNumbersOnSeveralRequests
FROM (SELECT PhlNumber FROM lims.Subject WHERE IsLegacy = 1 GROUP BY PhlNumber HAVING COUNT(*) > 1) AS d;
GO
