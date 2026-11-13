/* =============================================================================
   MHL LIMS migration  -  130_load_charges.sql   (PHL side)
   phl_charge -> billing.ChargeLine (SourceType = MIGRATED), plus billing.BillingBatch for charges already
   exported to accounting, plus billing.ChargeCode rows for legacy codes that are not on the current list.

   MONEY RULES (read before running):
     * Each line keeps the unit price it was charged at (c_charge_price). Nothing is repriced.
     * Charges with an extract date (c_extract_date) were sent to accounting through Rpt080. They load as
       RELEASED, inside one RELEASED batch per lab and extract date. They are locked and cannot be billed again.
     * Charges WITHOUT an extract date load as PENDING, except those on requests marked No charge (N) or Cancelled (L),
       which load as VOID (and are logged). Review them (see 900_reconcile.sql, section C) before any
       billing batch is created in the new system, or old uncharged work could be billed by mistake.
     * Lines with zero units, a negative price, or a missing request are skipped and logged.
     * Lines with negative units (credits) load as ADJUSTMENT lines pointing at the earliest earlier line with the
       same request, PHL number and code; if there is none they are skipped and logged for review.
     * Rows sharing the same key (lab, request, PHL number, charge date, charge code) are all kept; the later
       ones get "#2", "#3" ... on their crosswalk key.
   Needs: 110_load_requests.sql (and 100 for users).
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

DECLARE @run int, @cCode int = 0, @cBatch int = 0, @cPos int = 0, @cAdj int = 0, @cSkip int = 0;
INSERT INTO legacy.LoadRun (SourceSystem, Notes) VALUES (N'PHL', N'130_load_charges.sql');
SET @run = SCOPE_IDENTITY();

BEGIN TRY
    DROP TABLE IF EXISTS #C, #Map;
    BEGIN TRANSACTION;

    DECLARE @mig int     = (SELECT UserId FROM sec.AppUser WHERE AdAccount = N'LEGACY\MIGRATION');
    DECLARE @unknown int = (SELECT UserId FROM sec.AppUser WHERE AdAccount = N'LEGACY\UNKNOWN');
    DECLARE @list int    = (SELECT PriceListId FROM billing.PriceList WHERE Name = N'LEGACY-PHL');
    -- An extract date earlier than this is treated as 'never extracted' (a placeholder date), not as an export.
    DECLARE @minExtract date = '1950-01-01';
    IF @mig IS NULL OR @list IS NULL THROW 50901, N'Run 000_support.sql first (migration user or LEGACY-PHL price list missing).', 1;

    /* ---- the charge rows, with everything resolved ---- */
    SELECT q.*,
           CASE WHEN q.n = 1 THEN q.BaseKey ELSE q.BaseKey + N'#' + CAST(q.n AS nvarchar(10)) END AS SourceKey,
           CAST(NULL AS nvarchar(30)) AS Skip
    INTO #C
    FROM (
        SELECT c.LabCode, c.ReqId, c.SourceDb, c.PhlNo, c.ChargeCode, c.BaseChargeCode, c.Units, c.UnitPrice, c.[Description],
               CASE WHEN c.ExtractDate < @minExtract THEN NULL ELSE c.ExtractDate END AS ExtractDate, c.ExtractDate AS ExtractDateRaw,
               c.LabCode + N'|' + c.ReqId + N'|' + COALESCE(c.PhlNo, N'') + N'|' + CONVERT(nvarchar(10), CAST(COALESCE(c.ChargeDate, '1990-01-01') AS date), 23) + N'|' + COALESCE(c.ChargeCode, N'') AS BaseKey,
               ROW_NUMBER() OVER (PARTITION BY c.LabCode, c.ReqId, COALESCE(c.PhlNo, N''), COALESCE(CAST(c.ChargeDate AS date), '1990-01-01'), c.ChargeCode ORDER BY c.UpdateDate, c.Units, c.UnitPrice) AS n,
               rq.TargetId AS RequestId, sb.TargetId AS SubjectId, lr.ChargeType AS RequestChargeType,
               CAST(COALESCE(c.ChargeDate, c.UpdateDate, '1990-01-01') AS date) AS ChargeDate,
               COALESCE(uu.UserId, @unknown) AS UserId,
               CAST(COALESCE(c.UpdateDate, c.ChargeDate, '1990-01-01') AS datetime2(0)) AS EnteredAt
        FROM stage.vCharge AS c
        LEFT JOIN legacy.IdCrosswalk AS rq ON rq.SourceSystem IN (N'PHL', N'PHLRETIRE') AND rq.SourceTable = N'phl_request' AND rq.SourceKey = c.LabCode + N'|' + c.ReqId
        LEFT JOIN legacy.IdCrosswalk AS sb ON sb.SourceSystem IN (N'PHL', N'PHLRETIRE') AND sb.SourceTable = N'phl_phl_no' AND sb.SourceKey = c.LabCode + N'|' + c.ReqId + N'|' + c.PhlNo
        LEFT JOIN lims.Request AS lr ON lr.RequestId = rq.TargetId
        LEFT JOIN legacy.UserResolve AS uu ON uu.Token = LEFT(c.UpdateUser, 100)
    ) AS q;

    -- already loaded?
    DELETE c FROM #C AS c
    WHERE EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem IN (N'PHL', N'PHLRETIRE') AND x.SourceTable = N'phl_charge' AND x.SourceKey = c.SourceKey);

    UPDATE #C SET Skip = CASE
        WHEN RequestId IS NULL THEN N'CHARGE_NO_REQUEST'
        WHEN ChargeCode IS NULL THEN N'CHARGE_NO_CODE'
        WHEN Units IS NULL OR Units = 0 THEN N'CHARGE_ZERO_UNITS'
        WHEN UnitPrice IS NOT NULL AND UnitPrice < 0 THEN N'CHARGE_NEGATIVE_PRICE'
        WHEN LEN(ChargeCode) > 10 THEN N'CHARGE_CODE_TOO_LONG' END;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_charge', SourceKey, N'SKIPPED', Skip, CONCAT(N'Charge code ', ChargeCode, N', units ', Units, N', price ', UnitPrice, N'.')
    FROM #C WHERE Skip IS NOT NULL;
    SET @cSkip = @@ROWCOUNT;
    DELETE FROM #C WHERE Skip IS NOT NULL;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_charge', SourceKey, N'CORRECTED', N'EXTRACT_DATE_IMPLAUSIBLE', CONCAT(N'Extract date ', CONVERT(nvarchar(10), CAST(ExtractDateRaw AS date), 23), N' is before 1950; treated as not extracted (PENDING).')
    FROM #C WHERE ExtractDateRaw IS NOT NULL AND ExtractDate IS NULL;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_charge', SourceKey, N'CORRECTED', N'CHARGE_PRICE_MISSING', N'No price on the legacy row; loaded at 0.00.' FROM #C WHERE UnitPrice IS NULL;
    UPDATE #C SET UnitPrice = 0 WHERE UnitPrice IS NULL;

    /* ---- legacy charge codes that are not in billing.ChargeCode ---- */
    INSERT INTO billing.ChargeCode (ChargeCode, LabCode, Description, UnitOfMeasure, RequiresDescription, IsActive)
    SELECT x.ChargeCode,
           CASE WHEN LEFT(x.ChargeCode, 2) IN (SELECT LabCode FROM ref.Lab) THEN LEFT(x.ChargeCode, 2) ELSE x.LabCode END,
           COALESCE(NULLIF(x.[Description], N''), x.ChargeCode), N'unit', 0, 0
    FROM (SELECT ChargeCode, MIN(LabCode) AS LabCode, MAX([Description]) AS [Description] FROM #C GROUP BY ChargeCode) AS x
    WHERE NOT EXISTS (SELECT 1 FROM billing.ChargeCode AS bc WHERE bc.ChargeCode = x.ChargeCode)
      AND x.LabCode IN (SELECT LabCode FROM ref.Lab);
    SET @cCode = @@ROWCOUNT;
    IF @cCode > 0
        INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, Severity, IssueCode, Detail)
        VALUES (@run, N'PHL', N'phl_charge', N'INFO', N'LEGACY_CHARGE_CODES_ADDED',
                CONCAT(@cCode, N' legacy charge codes that are not on the current price list were added to billing.ChargeCode as inactive, with the description printed on the charge.'));
    -- a code that still has no billing.ChargeCode row (lab not in ref.Lab) cannot be loaded
    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_charge', SourceKey, N'SKIPPED', N'CHARGE_CODE_UNUSABLE', CONCAT(N'Charge code ', ChargeCode, N' could not be created.')
    FROM #C AS c WHERE NOT EXISTS (SELECT 1 FROM billing.ChargeCode AS bc WHERE bc.ChargeCode = c.ChargeCode);
    SET @cSkip += @@ROWCOUNT;
    DELETE c FROM #C AS c WHERE NOT EXISTS (SELECT 1 FROM billing.ChargeCode AS bc WHERE bc.ChargeCode = c.ChargeCode);

    /* ---- one released batch per lab and extract date ---- */
    INSERT INTO billing.BillingBatch (LabCode, PeriodStart, PeriodEnd, Status, CreatedByUserId, CreatedAt, ReleasedByUserId, ReleasedAt, ExportFormat)
    SELECT d.LabCode, d.ExtractDate, d.ExtractDate, N'RELEASED', @mig, CAST(d.ExtractDate AS datetime2(0)), @mig, CAST(d.ExtractDate AS datetime2(0)), N'RPT080'
    FROM (SELECT DISTINCT LabCode, CAST(ExtractDate AS date) AS ExtractDate FROM #C WHERE ExtractDate IS NOT NULL) AS d
    WHERE d.LabCode IN (SELECT LabCode FROM ref.Lab)
      AND NOT EXISTS (SELECT 1 FROM billing.BillingBatch AS b
                      WHERE b.LabCode = d.LabCode AND b.PeriodStart = d.ExtractDate AND b.PeriodEnd = d.ExtractDate
                        AND b.CreatedByUserId = @mig AND b.ExportFormat = N'RPT080');
    SET @cBatch = @@ROWCOUNT;

    -- a charge that was exported must end up inside a released batch; never fall back to PENDING
    IF EXISTS (SELECT 1 FROM #C AS c WHERE c.ExtractDate IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM billing.BillingBatch AS b WHERE b.LabCode = c.LabCode AND b.PeriodStart = CAST(c.ExtractDate AS date)
                 AND b.PeriodEnd = CAST(c.ExtractDate AS date) AND b.CreatedByUserId = @mig AND b.ExportFormat = N'RPT080'))
        THROW 50903, N'An exported charge has no billing batch (lab not in ref.Lab?). Nothing was committed.', 1;

    /* ---- positive lines (and zero-priced ones) first ---- */
    CREATE TABLE #Map (SourceKey nvarchar(200) NOT NULL, SourceDb nvarchar(20) NOT NULL, ChargeLineId int NOT NULL);
    MERGE billing.ChargeLine AS tgt
    USING (SELECT c.*, 
                  COALESCE((SELECT TOP (1) cs.SectionCode FROM billing.ChargeCodeSection AS cs WHERE cs.ChargeCode = c.ChargeCode ORDER BY cs.SortOrder), N'LEGACY') AS SectionCode,
                  b.BillingBatchId
           FROM #C AS c
           LEFT JOIN billing.BillingBatch AS b ON c.ExtractDate IS NOT NULL AND b.LabCode = c.LabCode AND b.PeriodStart = CAST(c.ExtractDate AS date)
                AND b.PeriodEnd = CAST(c.ExtractDate AS date) AND b.CreatedByUserId = @mig AND b.ExportFormat = N'RPT080'
           WHERE c.Units > 0) AS s ON 1 = 0
    WHEN NOT MATCHED THEN
        INSERT (RequestId, SubjectId, SectionCode, ChargeCode, PriceListId, ChargeDate, Units, UnitPrice, Description, SourceType, Status,
                BillingBatchId, EnteredByUserId, EnteredAt)
        VALUES (s.RequestId, s.SubjectId, s.SectionCode, s.ChargeCode, @list, s.ChargeDate, s.Units, s.UnitPrice, LEFT(s.[Description], 500), N'MIGRATED',
                CASE WHEN s.ExtractDate IS NOT NULL AND s.BillingBatchId IS NOT NULL THEN N'RELEASED' WHEN s.RequestChargeType IN (N'N', N'L') THEN N'VOID' ELSE N'PENDING' END,
                CASE WHEN s.ExtractDate IS NOT NULL THEN s.BillingBatchId END, s.UserId, s.EnteredAt)
    OUTPUT s.SourceKey, s.SourceDb, inserted.ChargeLineId INTO #Map (SourceKey, SourceDb, ChargeLineId);
    SET @cPos = @@ROWCOUNT;

    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT CASE m.SourceDb WHEN N'RETIRE' THEN N'PHLRETIRE' ELSE N'PHL' END, N'phl_charge', m.SourceKey, N'billing.ChargeLine', m.ChargeLineId, @run FROM #Map AS m;

    /* ---- credits (negative units) as adjustments of an earlier line ---- */
    DECLARE @neg TABLE (SourceKey nvarchar(200), SourceDb nvarchar(20), OrigId int NULL);
    INSERT INTO @neg (SourceKey, SourceDb, OrigId)
    SELECT c.SourceKey, c.SourceDb,
           (SELECT TOP (1) l.ChargeLineId FROM billing.ChargeLine AS l
            WHERE l.RequestId = c.RequestId AND l.ChargeCode = c.ChargeCode AND l.Units > 0
              AND ISNULL(l.SubjectId, 0) = ISNULL(c.SubjectId, 0) AND l.ChargeDate <= c.ChargeDate
            ORDER BY l.ChargeDate, l.ChargeLineId)
    FROM #C AS c WHERE c.Units < 0;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_charge', SourceKey, N'SKIPPED', N'CREDIT_NO_ORIGINAL', N'Negative-unit charge with no earlier charge of the same code on the same request and PHL number. Needs a manual decision.'
    FROM @neg WHERE OrigId IS NULL;
    SET @cSkip += @@ROWCOUNT;

    DELETE FROM #Map;
    MERGE billing.ChargeLine AS tgt
    USING (SELECT c.*, n2.OrigId,
                  COALESCE((SELECT TOP (1) cs.SectionCode FROM billing.ChargeCodeSection AS cs WHERE cs.ChargeCode = c.ChargeCode ORDER BY cs.SortOrder), N'LEGACY') AS SectionCode,
                  b.BillingBatchId
           FROM #C AS c
           JOIN @neg AS n2 ON n2.SourceKey = c.SourceKey AND n2.OrigId IS NOT NULL
           LEFT JOIN billing.BillingBatch AS b ON c.ExtractDate IS NOT NULL AND b.LabCode = c.LabCode AND b.PeriodStart = CAST(c.ExtractDate AS date)
                AND b.PeriodEnd = CAST(c.ExtractDate AS date) AND b.CreatedByUserId = @mig AND b.ExportFormat = N'RPT080'
           WHERE c.Units < 0) AS s ON 1 = 0
    WHEN NOT MATCHED THEN
        INSERT (RequestId, SubjectId, SectionCode, ChargeCode, PriceListId, ChargeDate, Units, UnitPrice, Description, SourceType, Status,
                AdjustsChargeLineId, BillingBatchId, EnteredByUserId, EnteredAt)
        VALUES (s.RequestId, s.SubjectId, s.SectionCode, s.ChargeCode, @list, s.ChargeDate, s.Units, s.UnitPrice, LEFT(s.[Description], 500), N'ADJUSTMENT',
                CASE WHEN s.ExtractDate IS NOT NULL AND s.BillingBatchId IS NOT NULL THEN N'RELEASED' WHEN s.RequestChargeType IN (N'N', N'L') THEN N'VOID' ELSE N'PENDING' END,
                s.OrigId, CASE WHEN s.ExtractDate IS NOT NULL THEN s.BillingBatchId END, s.UserId, s.EnteredAt)
    OUTPUT s.SourceKey, s.SourceDb, inserted.ChargeLineId INTO #Map (SourceKey, SourceDb, ChargeLineId);
    SET @cAdj = @@ROWCOUNT;

    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT CASE m.SourceDb WHEN N'RETIRE' THEN N'PHLRETIRE' ELSE N'PHL' END, N'phl_charge', m.SourceKey, N'billing.ChargeLine', m.ChargeLineId, @run FROM #Map AS m;

    -- totals on the migrated batches
    UPDATE b SET LineCount = t.Lines, TotalAmount = t.Total
    FROM billing.BillingBatch AS b
    JOIN (SELECT BillingBatchId, COUNT(*) AS Lines, SUM(Amount) AS Total FROM billing.ChargeLine WHERE BillingBatchId IS NOT NULL GROUP BY BillingBatchId) AS t
      ON t.BillingBatchId = b.BillingBatchId
    WHERE b.CreatedByUserId = @mig AND b.ExportFormat = N'RPT080';

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_charge', N'REVIEW', N'CHARGE_ON_NO_CHARGE_REQUEST',
           CONCAT(COUNT(*), N' charge lines that were never extracted belong to requests marked No charge (N) or Cancelled (L); they were loaded as VOID so they are not billed. Check that this is right.')
    FROM billing.ChargeLine AS cl JOIN lims.Request AS r ON r.RequestId = cl.RequestId
    WHERE cl.SourceType IN (N'MIGRATED', N'ADJUSTMENT') AND cl.Status = N'VOID' AND cl.PriceListId = @list AND r.ChargeType IN (N'N', N'L')
    HAVING COUNT(*) > 0;

    -- reminder for the billing administrator
    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_charge', N'REVIEW', N'UNEXTRACTED_CHARGES_PENDING',
           CONCAT(COUNT(*), N' migrated charge lines have no extract date and are PENDING. Review them before any billing batch is created.')
    FROM billing.ChargeLine WHERE SourceType IN (N'MIGRATED', N'ADJUSTMENT') AND Status = N'PENDING' AND PriceListId = @list
    HAVING COUNT(*) > 0;

    COMMIT TRANSACTION;
    DROP TABLE IF EXISTS #C, #Map;

    UPDATE legacy.LoadRun SET Status = N'SUCCEEDED', FinishedAt = sysutcdatetime(),
           RowCountsJson = CONCAT(N'{"chargeLines":', @cPos, N',"adjustments":', @cAdj, N',"chargeCodesAdded":', @cCode, N',"batchesCreated":', @cBatch, N',"skipped":', @cSkip, N'}')
     WHERE LoadRunId = @run;
    PRINT CONCAT(N'130_load_charges done. Lines ', @cPos, N', credits ', @cAdj, N', codes added ', @cCode, N', batches ', @cBatch, N', skipped ', @cSkip);
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    UPDATE legacy.LoadRun SET Status = N'FAILED', FinishedAt = sysutcdatetime(), Notes = LEFT(CONCAT(Notes, N': ', ERROR_MESSAGE()), 4000) WHERE LoadRunId = @run;
    THROW;
END CATCH
GO
