/* =============================================================================
   MHL LIMS migration  -  110_load_requests.sql   (PHL side)
   Requests (phl_request) -> lims.Request, lims.RequestArea; PHL numbers (phl_phl_no) -> lims.Subject.
   Every migrated row is flagged IsLegacy = 1 and recorded in legacy.IdCrosswalk, so the script can be re-run
   to pick up rows that arrive later. It does not update rows already loaded.
   Decisions built in (change them here if the lab decides otherwise):
     * RequestNumber = the legacy request id. If the same id exists in both labs (HP and PA), the second lab
       gets "<id>-<lab>", because lims.Request.RequestNumber is unique across labs. (Open question 8.)
     * Status: charge type L -> CANCELLED; a completed date -> COMPLETE; otherwise OPEN.
     * A missing received date is taken from the completed or last-update date, else 1990-01-01 (logged).
     * Requests in a lab that is not in ref.Lab are skipped and logged.
     * Legacy fields with no column in lims.Request are kept in legacy.RequestSource.
   Needs: 100_load_reference.sql.
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

DECLARE @run int;
DECLARE @cReq int = 0, @cArea int = 0, @cSrc int = 0, @cSkip int = 0, @cSubj int = 0, @cSubjSkip int = 0;
INSERT INTO legacy.LoadRun (SourceSystem, Notes) VALUES (N'PHL', N'110_load_requests.sql');
SET @run = SCOPE_IDENTITY();

BEGIN TRY
    DROP TABLE IF EXISTS #Req, #Phl;
    BEGIN TRANSACTION;

    IF NOT EXISTS (SELECT 1 FROM ref.RequestType WHERE RequestTypeCode = N'LEGACY-UNKNOWN')
        INSERT INTO ref.RequestType (RequestTypeCode, Name, LabCode, StartAreaCode, SortOrder, IsActive)
        VALUES (N'LEGACY-UNKNOWN', N'Legacy request with no request type', N'HP', N'ENTRY', 999, 0);

    DECLARE @unknownInv int = (SELECT TOP (1) InvestigatorId FROM lims.Investigator WHERE LastName = N'(no investigator on legacy request)');

    /* ---------- requests ---------- */
    SELECT v.LabCode, v.ReqId, v.SourceDb,
           CASE WHEN rk.rn = 1 THEN v.ReqId ELSE v.ReqId + N'-' + v.LabCode END AS RequestNumber,
           CAST(CASE WHEN rk.rn > 1 THEN 1 ELSE 0 END AS bit)                 AS NumberSuffixed,
           COALESCE(rt.RequestTypeCode, N'LEGACY-UNKNOWN')                    AS RequestTypeCode,
           COALESCE(inv.InvestigatorId, @unknownInv)                          AS InvestigatorId,
           pr.ProjectId, nas.NasRequestId,
           CASE WHEN v.ChargeTypeCode = N'L' THEN N'CANCELLED' WHEN v.CompDate IS NOT NULL THEN N'COMPLETE' ELSE N'OPEN' END AS Status,
           v.ChargeTypeCode, rd.ReceivedDate,
           CASE WHEN v.CompDate IS NULL THEN NULL WHEN CAST(v.CompDate AS date) < rd.ReceivedDate THEN rd.ReceivedDate ELSE CAST(v.CompDate AS date) END AS CompletedDate,
           CAST(CASE WHEN v.CompDate IS NOT NULL AND CAST(v.CompDate AS date) < rd.ReceivedDate THEN 1 ELSE 0 END AS bit) AS CompBeforeReceived,
           CAST(CASE WHEN v.RecDate IS NULL THEN 1 ELSE 0 END AS bit)         AS ReceivedFilledIn,
           CAST(v.DueDate AS date) AS DueDate, v.[Description],
           sp.SpeciesCode, fx.FixativeCode, v.TissueDisp, ur.UserId AS PathologistUserId,
           CAST(CASE WHEN lb.LabCode IS NULL THEN 1 ELSE 0 END AS bit)        AS LabUnknown,
           CAST(CASE WHEN v.InvesNo IS NOT NULL AND v.InvesNo <> 0 AND inv.InvestigatorId IS NULL THEN 1 ELSE 0 END AS bit) AS InvestigatorMissing,
           v.FlagNecro, v.FlagTrimm, v.FlagEmbed, v.FlagMicro, v.FlagStain, v.FlagPhoto, v.FlagOut, v.FlagOther, v.OtherArea, COALESCE(wo.AreaCode, N'OTHER') AS OtherAreaCode,
           v.ChargeType AS RawChargeType,
           v.CenterNo, v.ApoNo, v.Division, v.InvesNo, v.InvesLast, v.InvesFirst, v.PaName, v.AssignPath, v.AssignTeam, v.WebId, v.EstTurn,
           v.FlagDev, v.FlagProject, v.Part, v.AppBudget, v.OdrsBudget, v.Deliverable, v.SpeciesName, v.UpdateDate, v.UpdateUser
    INTO #Req
    FROM stage.vRequestEff AS v
    JOIN (SELECT LabCode, ReqId, ROW_NUMBER() OVER (PARTITION BY ReqId ORDER BY LabCode) AS rn
          FROM (SELECT LabCode, ReqId FROM stage.vRequest UNION SELECT LegacyLab, LegacyReqId FROM legacy.RequestSource) AS allReq) AS rk
         ON rk.LabCode = v.LabCode AND rk.ReqId = v.ReqId
    LEFT JOIN ref.Lab         AS lb  ON lb.LabCode = v.LabCode
    LEFT JOIN ref.WorkArea    AS wo  ON wo.AreaCode = UPPER(v.OtherArea)
    LEFT JOIN ref.RequestType AS rt  ON rt.RequestTypeCode = v.ReqTypeCode
    LEFT JOIN lims.Investigator AS inv ON inv.LegacySsgInvesNo = v.InvesNo
    LEFT JOIN lims.Project    AS pr  ON pr.CostpointProjectId = LEFT(v.CenterNo, 30)
    LEFT JOIN lims.NasRequest AS nas ON nas.RequestDisplayId = v.ApoNo
    LEFT JOIN ref.Species     AS sp  ON sp.SpeciesCode = v.SpeciesCode
    LEFT JOIN ref.Fixative    AS fx  ON fx.FixativeCode = LEFT(v.Fixative, 20)
    LEFT JOIN legacy.UserResolve AS ur ON ur.Token = LEFT(COALESCE(v.AssignPath, v.PaName), 100)
    CROSS APPLY (SELECT CAST(COALESCE(v.RecDate, v.CompDate, v.UpdateDate, '1990-01-01') AS date) AS ReceivedDate) AS rd
    WHERE NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x
                      WHERE x.SourceSystem IN (N'PHL', N'PHLRETIRE') AND x.SourceTable = N'phl_request' AND x.SourceKey = v.LabCode + N'|' + v.ReqId);

    -- requests that cannot be loaded
    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_request', LabCode + N'|' + ReqId, N'SKIPPED',
           CASE WHEN LabUnknown = 1 THEN N'LAB_NOT_IN_REF_LAB' ELSE N'REQUEST_NUMBER_IN_USE' END,
           CASE WHEN LabUnknown = 1 THEN N'Lab code is not in ref.Lab.' ELSE N'Another request already uses this request number.' END
    FROM #Req AS r
    WHERE LabUnknown = 1 OR EXISTS (SELECT 1 FROM lims.Request AS q WHERE q.RequestNumber = r.RequestNumber);
    SET @cSkip = @@ROWCOUNT;
    DELETE r FROM #Req AS r WHERE LabUnknown = 1 OR EXISTS (SELECT 1 FROM lims.Request AS q WHERE q.RequestNumber = r.RequestNumber);

    -- things we corrected, for the record
    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_request', LabCode + N'|' + ReqId, N'CORRECTED', N'RECEIVED_DATE_FILLED_IN', N'No received date; used completed/update date, else 1990-01-01.' FROM #Req WHERE ReceivedFilledIn = 1
    UNION ALL
    SELECT @run, N'PHL', N'phl_request', LabCode + N'|' + ReqId, N'CORRECTED', N'COMPLETED_BEFORE_RECEIVED', N'Completed date was before the received date; set equal to the received date.' FROM #Req WHERE CompBeforeReceived = 1
    UNION ALL
    SELECT @run, N'PHL', N'phl_request', LabCode + N'|' + ReqId, N'CORRECTED', N'REQUEST_NUMBER_SUFFIXED', N'Same request id exists in both labs; lab code appended to keep request numbers unique.' FROM #Req WHERE NumberSuffixed = 1
    UNION ALL
    SELECT @run, N'PHL', N'phl_request', LabCode + N'|' + ReqId, N'REVIEW', N'CHARGE_TYPE_UNRECOGNIZED', CONCAT(N'r_charge_type was ''', COALESCE(RawChargeType, N'(blank)'), N'''; loaded as C (charge).') FROM #Req WHERE RawChargeType IS NULL OR UPPER(RawChargeType) NOT IN (N'C', N'N', N'L')
    UNION ALL
    SELECT @run, N'PHL', N'phl_request', LabCode + N'|' + ReqId, N'REVIEW', N'INVESTIGATOR_UNRESOLVED', N'Investigator number did not match; linked to the "(no investigator on legacy request)" placeholder.' FROM #Req WHERE InvestigatorMissing = 1;

    INSERT INTO lims.Request (RequestNumber, LabCode, RequestTypeCode, InvestigatorId, ProjectId, NasRequestId, Status, ChargeType,
                              DefaultPriorityCode, ReceivedDate, DueDate, CompletedDate, Description, SpeciesCode, FixativeCode,
                              AssignedPathologistUserId, TissueDisposition, IsLegacy)
    SELECT RequestNumber, LabCode, RequestTypeCode, InvestigatorId, ProjectId, NasRequestId, Status, ChargeTypeCode,
           N'R', ReceivedDate, DueDate, CompletedDate, [Description], SpeciesCode, FixativeCode, PathologistUserId, LEFT(TissueDisp, 200), 1
    FROM #Req
    ORDER BY LabCode, ReqId;
    SET @cReq = @@ROWCOUNT;

    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT CASE r.SourceDb WHEN N'RETIRE' THEN N'PHLRETIRE' ELSE N'PHL' END, N'phl_request', r.LabCode + N'|' + r.ReqId, N'lims.Request', q.RequestId, @run
    FROM #Req AS r JOIN lims.Request AS q ON q.RequestNumber = r.RequestNumber AND q.IsLegacy = 1;

    -- requested work areas (the old check boxes); anything that is not N or 0 counts as ticked
    INSERT INTO lims.RequestArea (RequestId, AreaCode)
    SELECT DISTINCT q.RequestId, a.AreaCode
    FROM #Req AS r
    JOIN lims.Request AS q ON q.RequestNumber = r.RequestNumber AND q.IsLegacy = 1
    CROSS APPLY (VALUES (N'NECRO', r.FlagNecro), (N'TRIMM', r.FlagTrimm), (N'EMBED', r.FlagEmbed), (N'MICRO', r.FlagMicro),
                        (N'STAIN', r.FlagStain), (N'IMAGE', r.FlagPhoto), (N'OUT', r.FlagOut),
                        (r.OtherAreaCode, r.FlagOther),
                        (N'PATHO', CASE WHEN r.LabCode = N'PA' THEN N'Y' END)) AS a (AreaCode, Flag)
    WHERE a.Flag IS NOT NULL AND UPPER(a.Flag) NOT IN (N'N', N'0')
      AND EXISTS (SELECT 1 FROM ref.WorkArea AS w WHERE w.AreaCode = a.AreaCode)
      AND NOT EXISTS (SELECT 1 FROM lims.RequestArea AS ra WHERE ra.RequestId = q.RequestId AND ra.AreaCode = a.AreaCode);
    SET @cArea = @@ROWCOUNT;

    INSERT INTO legacy.RequestSource (RequestId, LegacyLab, LegacyReqId, SourceDb, CenterNo, ApoNo, Division, InvestigatorNo, InvestigatorNameAsEntered,
                                      PathologistName, AssignPathologist, AssignTeam, WebId, EstTurnaround, IsDevelopmental, IsProject, Part,
                                      AppBudget, OdrsBudget, Deliverable, SpeciesNameAsEntered, LastUpdatedAt, LastUpdatedBy)
    SELECT q.RequestId, r.LabCode, LEFT(r.ReqId, 20), r.SourceDb, LEFT(r.CenterNo, 60), LEFT(r.ApoNo, 40), LEFT(r.Division, 100), r.InvesNo,
           LEFT(CONCAT(r.InvesLast, CASE WHEN r.InvesFirst IS NOT NULL THEN N', ' + r.InvesFirst END), 120),
           LEFT(r.PaName, 100), LEFT(r.AssignPath, 100), LEFT(r.AssignTeam, 50), r.WebId, r.EstTurn,
           CASE WHEN r.FlagDev IS NULL THEN NULL WHEN UPPER(r.FlagDev) IN (N'Y', N'1') THEN 1 ELSE 0 END,
           CASE WHEN r.FlagProject IS NULL THEN NULL WHEN UPPER(r.FlagProject) IN (N'Y', N'1') THEN 1 ELSE 0 END,
           LEFT(r.Part, 50), r.AppBudget, r.OdrsBudget, LEFT(r.Deliverable, 500), LEFT(r.SpeciesName, 200), r.UpdateDate, LEFT(r.UpdateUser, 20)
    FROM #Req AS r
    JOIN lims.Request AS q ON q.RequestNumber = r.RequestNumber AND q.IsLegacy = 1
    WHERE NOT EXISTS (SELECT 1 FROM legacy.RequestSource AS s WHERE s.RequestId = q.RequestId);
    SET @cSrc = @@ROWCOUNT;

    /* ---------- PHL numbers -> subjects ---------- */
    SELECT p.LabCode, p.ReqId, p.PhlNo, p.SourceDb, x.TargetId AS RequestId, q.Status AS RequestStatus, q.SpeciesCode AS RequestSpecies,
           CASE WHEN UPPER(p.Priority) IN (N'R', N'S', N'P') THEN UPPER(p.Priority) ELSE N'R' END AS PriorityCode,
           p.AltId, p.AcucNo, p.ZapNbr, p.StudyNo, p.GroupNo, p.AnimalNo, p.UpdateDate, p.UpdateUser,
           ROW_NUMBER() OVER (PARTITION BY p.LabCode, p.ReqId, p.PhlNo ORDER BY p.UpdateDate DESC) AS dup
    INTO #Phl
    FROM stage.vPhlNo AS p
    JOIN legacy.IdCrosswalk AS x ON x.SourceSystem IN (N'PHL', N'PHLRETIRE') AND x.SourceTable = N'phl_request' AND x.SourceKey = p.LabCode + N'|' + p.ReqId
    JOIN lims.Request AS q ON q.RequestId = x.TargetId
    WHERE NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS y
                      WHERE y.SourceSystem IN (N'PHL', N'PHLRETIRE') AND y.SourceTable = N'phl_phl_no' AND y.SourceKey = p.LabCode + N'|' + p.ReqId + N'|' + p.PhlNo);

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_phl_no', LabCode + N'|' + ReqId + N'|' + PhlNo, N'SKIPPED', N'DUPLICATE_PHL_ON_REQUEST', N'Same PHL number listed twice on one request after trimming and case folding; the latest row was kept.'
    FROM #Phl WHERE dup > 1;
    SET @cSubjSkip = @@ROWCOUNT;
    DELETE FROM #Phl WHERE dup > 1;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_phl_no', LabCode + N'|' + ReqId + N'|' + PhlNo, N'CORRECTED', N'PHL_NUMBER_TRUNCATED', N'PHL number longer than 12 characters; truncated.'
    FROM #Phl WHERE LEN(PhlNo) > 12;

    INSERT INTO lims.Subject (PhlNumber, SubjectTypeCode, RequestId, AnimalNumber, AltId, SpeciesCode, PriorityCode, Status, IsLegacy)
    SELECT LEFT(PhlNo, 12),
           CASE RequestSpecies WHEN N'MOUSE' THEN N'MOUSE' WHEN N'RAT' THEN N'RAT' WHEN N'HUMAN' THEN N'HUMAN_DONOR' ELSE N'OTHER_ANIMAL' END,
           RequestId, LEFT(AnimalNo, 30), LEFT(AltId, 50), RequestSpecies, PriorityCode,
           CASE RequestStatus WHEN N'CANCELLED' THEN N'CANCELLED' WHEN N'COMPLETE' THEN N'COMPLETE' ELSE N'ACTIVE' END, 1
    FROM #Phl
    ORDER BY RequestId, PhlNo;
    SET @cSubj = @@ROWCOUNT;

    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT CASE h.SourceDb WHEN N'RETIRE' THEN N'PHLRETIRE' ELSE N'PHL' END, N'phl_phl_no', h.LabCode + N'|' + h.ReqId + N'|' + h.PhlNo, N'lims.Subject', s.SubjectId, @run
    FROM #Phl AS h
    JOIN lims.Subject AS s ON s.RequestId = h.RequestId AND s.PhlNumber = LEFT(h.PhlNo, 12) AND s.IsLegacy = 1;

    INSERT INTO legacy.SubjectSource (SubjectId, SourceDb, AcucNo, ZapNbrAsEntered, StudyNoAsEntered, GroupAsEntered, LastUpdatedAt, LastUpdatedBy)
    SELECT s.SubjectId, h.SourceDb, LEFT(h.AcucNo, 50), LEFT(h.ZapNbr, 50), LEFT(h.StudyNo, 50), LEFT(h.GroupNo, 20), h.UpdateDate, LEFT(h.UpdateUser, 20)
    FROM #Phl AS h
    JOIN lims.Subject AS s ON s.RequestId = h.RequestId AND s.PhlNumber = LEFT(h.PhlNo, 12) AND s.IsLegacy = 1
    WHERE NOT EXISTS (SELECT 1 FROM legacy.SubjectSource AS ss WHERE ss.SubjectId = s.SubjectId);

    COMMIT TRANSACTION;
    DROP TABLE IF EXISTS #Req, #Phl;

    UPDATE legacy.LoadRun SET Status = N'SUCCEEDED', FinishedAt = sysutcdatetime(),
           RowCountsJson = CONCAT(N'{"requests":', @cReq, N',"requestAreas":', @cArea, N',"requestSource":', @cSrc, N',"requestsSkipped":', @cSkip,
                                  N',"subjects":', @cSubj, N',"subjectDuplicatesSkipped":', @cSubjSkip, N'}')
     WHERE LoadRunId = @run;
    PRINT CONCAT(N'110_load_requests done. Requests ', @cReq, N' (skipped ', @cSkip, N'), areas ', @cArea, N', subjects ', @cSubj);
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    UPDATE legacy.LoadRun SET Status = N'FAILED', FinishedAt = sysutcdatetime(), Notes = LEFT(CONCAT(Notes, N': ', ERROR_MESSAGE()), 4000) WHERE LoadRunId = @run;
    THROW;
END CATCH
GO
