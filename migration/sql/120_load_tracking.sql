/* =============================================================================
   MHL LIMS migration  -  120_load_tracking.sql   (PHL side)
   phl_tracking -> trk.TrackingEvent (one event per legacy row, append-only history).
     t_curr_area -> FromAreaCode, t_next_area -> ToAreaCode, t_inits (else t_update_user) -> PerformedBy,
     t_track_date -> PerformedAt, t_units -> Units, t_proc -> ProcedureCode.
   Rows are skipped (and logged) when the PHL number is not on the request or when no area is given.
   Work-area codes that are not in ref.WorkArea are added (and logged for review).
   The legacy t_status value is kept in the comment text: its meaning (X is "handled specially" in PHL) is an
   open question, so it is not turned into IsRedo.
   Needs: 110_load_requests.sql.
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

DECLARE @run int, @cEv int = 0, @cSkipNoSubject int = 0, @cSkipNoArea int = 0, @cAreas int = 0;
INSERT INTO legacy.LoadRun (SourceSystem, Notes) VALUES (N'PHL', N'120_load_tracking.sql');
SET @run = SCOPE_IDENTITY();

BEGIN TRY
    DROP TABLE IF EXISTS #T, #Map;
    BEGIN TRANSACTION;

    DECLARE @unknown int = (SELECT UserId FROM sec.AppUser WHERE AdAccount = N'LEGACY\UNKNOWN');

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_tracking', N'SKIPPED', N'TRACKING_NO_IDENTITY', CONCAT(COUNT(*), N' tracking rows have no t_identity and cannot be given a stable key; not loaded.')
    FROM stage.vTracking WHERE Identity_ IS NULL HAVING COUNT(*) > 0;

    SELECT q.*,
           q.LabCode + N'|' + q.ReqId + N'|' + CAST(q.Identity_ AS nvarchar(20)) + CASE WHEN q.n > 1 THEN N'#' + CAST(q.n AS nvarchar(10)) ELSE N'' END AS SourceKey
    INTO #T
    FROM (
        SELECT t.LabCode, t.ReqId, t.PhlNo, t.SourceDb, t.Identity_,
               ROW_NUMBER() OVER (PARTITION BY t.LabCode, t.ReqId, t.Identity_ ORDER BY CASE t.SourceDb WHEN N'PROD' THEN 0 ELSE 1 END, t.TrackDate, t.UpdateDate) AS n,   -- unique across PROD and RETIRE
               rq.TargetId AS RequestId, sb.TargetId AS SubjectId,
               t.CurrArea, COALESCE(t.NextArea, t.CurrArea) AS ToArea,
               COALESCE(ui.UserId, uu.UserId, @unknown) AS UserId,
               CAST(COALESCE(t.TrackDate, t.UpdateDate, '1990-01-01') AS datetime2(0)) AS PerformedAt,
               t.Units, LEFT(t.Proc_, 20) AS ProcedureCode,
               LEFT(CONCAT(t.Comment, CASE WHEN t.[Status] IS NOT NULL THEN CONCAT(CASE WHEN t.Comment IS NOT NULL THEN N' ' END, N'[legacy status ', t.[Status], N']') END), 1000) AS Comment,
               CAST(COALESCE(t.UpdateDate, t.TrackDate, '1990-01-01') AS datetime2(0)) AS RecordedAt,
               LEFT(N'LEGACY:' + COALESCE(t.UpdateUser, N'?'), 100) AS RecordedBy
        FROM stage.vTracking AS t
        LEFT JOIN legacy.IdCrosswalk AS rq ON rq.SourceSystem IN (N'PHL', N'PHLRETIRE') AND rq.SourceTable = N'phl_request' AND rq.SourceKey = t.LabCode + N'|' + t.ReqId
        LEFT JOIN legacy.IdCrosswalk AS sb ON sb.SourceSystem IN (N'PHL', N'PHLRETIRE') AND sb.SourceTable = N'phl_phl_no' AND sb.SourceKey = t.LabCode + N'|' + t.ReqId + N'|' + t.PhlNo
        LEFT JOIN legacy.UserResolve AS ui ON ui.Token = LEFT(t.Inits, 100)
        LEFT JOIN legacy.UserResolve AS uu ON uu.Token = LEFT(t.UpdateUser, 100)
        WHERE t.Identity_ IS NOT NULL
    ) AS q
    WHERE NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x
                      WHERE x.SourceSystem IN (N'PHL', N'PHLRETIRE') AND x.SourceTable = N'phl_tracking' AND x.SourceKey = q.LabCode + N'|' + q.ReqId + N'|' + CAST(q.Identity_ AS nvarchar(20)) + CASE WHEN q.n > 1 THEN N'#' + CAST(q.n AS nvarchar(10)) ELSE N'' END);

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_tracking', SourceKey, N'SKIPPED', N'TRACKING_NO_SUBJECT', N'PHL number is blank or is not on this request.'
    FROM #T WHERE SubjectId IS NULL OR RequestId IS NULL;
    SET @cSkipNoSubject = @@ROWCOUNT;
    DELETE FROM #T WHERE SubjectId IS NULL OR RequestId IS NULL;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_tracking', SourceKey, N'SKIPPED', N'TRACKING_NO_AREA', N'Neither current nor next area is filled in.'
    FROM #T WHERE ToArea IS NULL;
    SET @cSkipNoArea = @@ROWCOUNT;
    DELETE FROM #T WHERE ToArea IS NULL;

    -- area codes we have not seen before
    INSERT INTO ref.WorkArea (AreaCode, Name, LabCode, IsTerminal, SortOrder, IsActive)
    SELECT a.Code, a.Code, NULL, 0, 999, 0
    FROM (SELECT CurrArea AS Code FROM #T WHERE CurrArea IS NOT NULL UNION SELECT ToArea FROM #T) AS a
    WHERE LEN(a.Code) <= 10 AND NOT EXISTS (SELECT 1 FROM ref.WorkArea AS w WHERE w.AreaCode = a.Code);
    SET @cAreas = @@ROWCOUNT;
    IF @cAreas > 0
        INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, Severity, IssueCode, Detail)
        VALUES (@run, N'PHL', N'phl_tracking', N'REVIEW', N'WORK_AREAS_ADDED',
                CONCAT(@cAreas, N' legacy area codes were added to ref.WorkArea (inactive, named by their code). Give them proper names or merge them.'));
    -- codes too long for ref.WorkArea cannot be loaded
    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_tracking', SourceKey, N'SKIPPED', N'TRACKING_AREA_TOO_LONG', N'Area code is longer than 10 characters.' FROM #T WHERE LEN(ToArea) > 10 OR LEN(CurrArea) > 10;
    DELETE FROM #T WHERE LEN(ToArea) > 10 OR LEN(CurrArea) > 10;

    -- Insert in time order so EventId order follows PerformedAt (trk.vCurrentLocation breaks ties on EventId).
    -- With INSERT ... SELECT ... ORDER BY, SQL Server assigns identity values in that order; the new ids are then
    -- matched back to the source rows by position, and the counts are verified.
    DECLARE @maxEv bigint = (SELECT COALESCE(MAX(EventId), 0) FROM trk.TrackingEvent);
    INSERT INTO trk.TrackingEvent (EntityType, EntityId, RequestId, FromAreaCode, ToAreaCode, PerformedByUserId, PerformedAt, Units, ProcedureCode, IsRedo, Comment, RecordedAt, RecordedBy)
    SELECT N'SUBJECT', SubjectId, RequestId, CurrArea, ToArea, UserId, PerformedAt, Units, ProcedureCode, 0, Comment, RecordedAt, RecordedBy
    FROM #T
    ORDER BY PerformedAt, Identity_, SourceKey;
    SET @cEv = @@ROWCOUNT;

    CREATE TABLE #Map (SourceKey nvarchar(200) NOT NULL, SourceDb nvarchar(20) NOT NULL, EventId bigint NOT NULL);
    INSERT INTO #Map (SourceKey, SourceDb, EventId)
    SELECT o.SourceKey, o.SourceDb, e.EventId
    FROM (SELECT SourceKey, SourceDb, ROW_NUMBER() OVER (ORDER BY PerformedAt, Identity_, SourceKey) AS rn FROM #T) AS o
    JOIN (SELECT EventId, ROW_NUMBER() OVER (ORDER BY EventId) AS rn FROM trk.TrackingEvent WHERE EventId > @maxEv) AS e ON e.rn = o.rn;
    IF (SELECT COUNT(*) FROM #Map) <> @cEv
        THROW 50902, N'Tracking event ids could not be matched back to their legacy rows; nothing was committed.', 1;

    -- TargetId is int in legacy.IdCrosswalk; fail loudly rather than overflow if the event table ever outgrows it
    IF EXISTS (SELECT 1 FROM #Map WHERE EventId > 2147483647) THROW 50900, N'Tracking event ids exceed int; widen legacy.IdCrosswalk.TargetId.', 1;
    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT CASE m.SourceDb WHEN N'RETIRE' THEN N'PHLRETIRE' ELSE N'PHL' END, N'phl_tracking', m.SourceKey, N'trk.TrackingEvent', CAST(m.EventId AS int), @run
    FROM #Map AS m;

    COMMIT TRANSACTION;
    DROP TABLE IF EXISTS #T, #Map;

    UPDATE legacy.LoadRun SET Status = N'SUCCEEDED', FinishedAt = sysutcdatetime(),
           RowCountsJson = CONCAT(N'{"trackingEvents":', @cEv, N',"skippedNoSubject":', @cSkipNoSubject, N',"skippedNoArea":', @cSkipNoArea, N',"areasAdded":', @cAreas, N'}')
     WHERE LoadRunId = @run;
    PRINT CONCAT(N'120_load_tracking done. Events ', @cEv, N' (skipped: no subject ', @cSkipNoSubject, N', no area ', @cSkipNoArea, N')');
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    UPDATE legacy.LoadRun SET Status = N'FAILED', FinishedAt = sysutcdatetime(), Notes = LEFT(CONCAT(Notes, N': ', ERROR_MESSAGE()), 4000) WHERE LoadRunId = @run;
    THROW;
END CATCH
GO
