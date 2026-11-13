/* =============================================================================
   MHL LIMS migration  -  100_load_reference.sql   (PHL side)
   Loads, from the stage views: investigators, projects, NAS requests, the reference codes the requests use
   (request types, species, fixatives) and a user for every set of initials. Re-runnable: it only adds rows
   that are not there yet, and records what it did in legacy.LoadRun / legacy.LoadIssue.
   Needs: 000_support.sql, 005_stage_views.sql, and Copy-LegacyToStage.ps1 for the PHL_ tables.
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF OBJECT_ID(N'legacy.UserToken') IS NULL
CREATE TABLE legacy.UserToken (Token nvarchar(100) NOT NULL CONSTRAINT PK_UserToken PRIMARY KEY);
GO

/* Turns every token in legacy.UserToken into a sec.AppUser, trying in order: AD account (with or without
   domain), initials of an active user, display name, and finally an inactive placeholder user
   LEGACY\<token>. Result rows are in legacy.UserResolve. Staff can re-point a token afterwards by editing
   legacy.UserResolve (Basis = MANUAL) before the charge and necropsy loads. */
CREATE OR ALTER PROCEDURE legacy.usp_ResolveUsers
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO legacy.UserResolve (Token, UserId, Basis)
    SELECT t.Token, MIN(u.UserId), N'ADACCOUNT'
    FROM legacy.UserToken AS t
    JOIN sec.AppUser AS u ON u.IsActive = 1
         AND (u.AdAccount = t.Token OR RIGHT(u.AdAccount, LEN(t.Token) + 1) = N'\' + t.Token)
    WHERE NOT EXISTS (SELECT 1 FROM legacy.UserResolve AS r WHERE r.Token = t.Token)
    GROUP BY t.Token
    HAVING COUNT(*) = 1;

    INSERT INTO legacy.UserResolve (Token, UserId, Basis)
    SELECT t.Token, MIN(u.UserId), N'INITIALS'
    FROM legacy.UserToken AS t
    JOIN sec.AppUser AS u ON u.IsActive = 1 AND u.Initials = t.Token
    WHERE NOT EXISTS (SELECT 1 FROM legacy.UserResolve AS r WHERE r.Token = t.Token)
    GROUP BY t.Token
    HAVING COUNT(*) = 1;

    INSERT INTO legacy.UserResolve (Token, UserId, Basis)
    SELECT t.Token, MIN(u.UserId), N'DISPLAYNAME'
    FROM legacy.UserToken AS t
    JOIN sec.AppUser AS u ON u.IsActive = 1 AND u.DisplayName = t.Token
    WHERE NOT EXISTS (SELECT 1 FROM legacy.UserResolve AS r WHERE r.Token = t.Token)
    GROUP BY t.Token
    HAVING COUNT(*) = 1;

    -- placeholders for everything else (inactive, so they never appear in pick lists)
    INSERT INTO sec.AppUser (AdAccount, DisplayName, Initials, IsPathologist, IsActive)
    SELECT DISTINCT N'LEGACY\' + LEFT(t.Token, 90), N'Legacy user ' + LEFT(t.Token, 150), LEFT(t.Token, 4), 0, 0
    FROM legacy.UserToken AS t
    WHERE NOT EXISTS (SELECT 1 FROM legacy.UserResolve AS r WHERE r.Token = t.Token)
      AND NOT EXISTS (SELECT 1 FROM sec.AppUser AS u WHERE u.AdAccount = N'LEGACY\' + LEFT(t.Token, 90));

    INSERT INTO legacy.UserResolve (Token, UserId, Basis)
    SELECT t.Token, u.UserId, N'PLACEHOLDER'
    FROM legacy.UserToken AS t
    JOIN sec.AppUser AS u ON u.AdAccount = N'LEGACY\' + LEFT(t.Token, 90)
    WHERE NOT EXISTS (SELECT 1 FROM legacy.UserResolve AS r WHERE r.Token = t.Token);
END
GO

DECLARE @run int, @n int;
DECLARE @cInv int = 0, @cInvFromReq int = 0, @cProj int = 0, @cNas int = 0, @cType int = 0, @cSpec int = 0, @cFix int = 0, @cTok int = 0;
INSERT INTO legacy.LoadRun (SourceSystem, Notes) VALUES (N'PHL', N'100_load_reference.sql');
SET @run = SCOPE_IDENTITY();

BEGIN TRY
    BEGIN TRANSACTION;

    /* ---- 1. investigators from the shared registry (ssg_investigators, system PHL) ---- */
    INSERT INTO lims.Investigator (LastName, FirstName, Title, Institute, Division, Email, Phone, LegacySsgInvesNo, IsActive)
    SELECT COALESCE(NULLIF(LTRIM(RTRIM(i.i_last_name)), N''), N'(unknown)'),
           NULLIF(LTRIM(RTRIM(i.i_first_name_mi)), N''),
           NULLIF(LTRIM(RTRIM(i.i_title)), N''),
           NULLIF(LTRIM(RTRIM(i.i_institute)), N''),
           NULLIF(LTRIM(RTRIM(i.i_division)), N''),
           NULLIF(LTRIM(RTRIM(i.i_email_addr)), N''),
           NULLIF(LTRIM(RTRIM(i.i_phone)), N''),
           CAST(i.i_inves_no AS int),
           CASE WHEN UPPER(LTRIM(RTRIM(i.i_act_inact))) IN (N'I', N'N') THEN 0 ELSE 1 END   -- ASSUMPTION: I/N = inactive
    FROM (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.i_inves_no ORDER BY s.i_update_date DESC) AS rn
          FROM stage.PHL_ssg_investigators AS s
          WHERE UPPER(LTRIM(RTRIM(s.i_sys))) = N'PHL' AND s.i_inves_no IS NOT NULL) AS i
    WHERE i.rn = 1
      AND NOT EXISTS (SELECT 1 FROM lims.Investigator AS x WHERE x.LegacySsgInvesNo = CAST(i.i_inves_no AS int));
    SET @cInv = @@ROWCOUNT;

    /* investigators named on requests but absent from the registry: build them from the request's own copy */
    DECLARE @newInv TABLE (InvesNo int NOT NULL);
    INSERT INTO lims.Investigator (LastName, FirstName, Title, Institute, LegacySsgInvesNo, IsActive)
    OUTPUT inserted.LegacySsgInvesNo INTO @newInv (InvesNo)
    SELECT COALESCE(r.InvesLast, N'(unknown)'), r.InvesFirst, r.InvesTitle, r.InvesInstitute, r.InvesNo, 0
    FROM (SELECT v.*, ROW_NUMBER() OVER (PARTITION BY v.InvesNo ORDER BY v.RecDate DESC) AS rn
          FROM stage.vRequest AS v WHERE v.InvesNo IS NOT NULL AND v.InvesNo <> 0) AS r
    WHERE r.rn = 1 AND NOT EXISTS (SELECT 1 FROM lims.Investigator AS x WHERE x.LegacySsgInvesNo = r.InvesNo);
    SET @cInvFromReq = @@ROWCOUNT;
    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'PHL', N'phl_request', CAST(InvesNo AS nvarchar(20)), N'REVIEW', N'INVESTIGATOR_NOT_IN_REGISTRY',
           N'Investigator created inactive from the name typed on the request; not found in ssg_investigators (system PHL).'
    FROM @newInv;

    /* one placeholder for requests with no investigator number at all */
    IF EXISTS (SELECT 1 FROM stage.vRequest WHERE InvesNo IS NULL OR InvesNo = 0)
       AND NOT EXISTS (SELECT 1 FROM lims.Investigator WHERE LastName = N'(no investigator on legacy request)')
        INSERT INTO lims.Investigator (LastName, IsActive) VALUES (N'(no investigator on legacy request)', 0);

    /* ---- 2. projects: one row per project number seen on a request (the Costpoint sync fills in the rest) ---- */
    INSERT INTO lims.Project (CostpointProjectId, Name, IsActive, AllowCharges)
    SELECT DISTINCT LEFT(v.CenterNo, 30), NULL, 0, 0
    FROM stage.vRequest AS v
    WHERE v.CenterNo IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM lims.Project AS p WHERE p.CostpointProjectId = LEFT(v.CenterNo, 30));
    SET @cProj = @@ROWCOUNT;

    /* ---- 3. NAS requests (one row per NAS id; the feed has one row per service area) ---- */
    ;WITH n AS (
        SELECT s.*,
               ROW_NUMBER() OVER (PARTITION BY s.NasRequestId
                                  ORDER BY CASE WHEN s.ServiceAreaName LIKE N'%path%' OR s.ServiceAreaName LIKE N'%histo%' OR s.ServiceAreaName LIKE N'%MHL%' THEN 0 ELSE 1 END,
                                           s.DateRequestSubmitted DESC) AS rn
        FROM stage.PHL_nas_information AS s
        WHERE TRY_CAST(s.NasRequestId AS int) > 0 AND NULLIF(LTRIM(RTRIM(s.RequestDisplayId)), N'') IS NOT NULL
    ), n2 AS (
        SELECT n.*, ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(n.RequestDisplayId)) ORDER BY n.NasRequestId) AS rn2
        FROM n WHERE n.rn = 1
    )
    INSERT INTO lims.NasRequest (NasRequestId, RequestDisplayId, RequesterLastName, RequesterFirstName, RequesterEmail,
                                 ServiceAreaName, CostpointProjectId, Description, TotalEstimatedCost, AuthorizedAmount,
                                 RequestStatus, DateSubmitted, DateAuthorized, DateWorkStarted, DateWorkCompleted, DateWorkCancelled)
    SELECT CAST(n2.NasRequestId AS int), LTRIM(RTRIM(n2.RequestDisplayId)),
           LEFT(NULLIF(LTRIM(RTRIM(n2.RequesterLastName)), N''), 100), LEFT(NULLIF(LTRIM(RTRIM(n2.RequesterFirstName)), N''), 100),
           LEFT(NULLIF(LTRIM(RTRIM(n2.RequesterEmail)), N''), 256), LEFT(NULLIF(LTRIM(RTRIM(n2.ServiceAreaName)), N''), 200),
           LEFT(NULLIF(LTRIM(RTRIM(n2.ProjectId)), N''), 30), n2.RequestDescription,
           n2.TotalEstimatedCost, n2.AuthorizedAmount, LEFT(NULLIF(LTRIM(RTRIM(n2.RequestStatus)), N''), 50),
           n2.DateRequestSubmitted, n2.DateFullyReviewedAndAuthorized, n2.DateWorkStarted, n2.DateWorkCompleted, n2.DateWorkCancelled
    FROM n2
    WHERE n2.rn2 = 1
      AND NOT EXISTS (SELECT 1 FROM lims.NasRequest AS x WHERE x.NasRequestId = CAST(n2.NasRequestId AS int) OR x.RequestDisplayId = LTRIM(RTRIM(n2.RequestDisplayId)));
    SET @cNas = @@ROWCOUNT;

    SELECT @n = COUNT(*) FROM (SELECT NasRequestId FROM stage.PHL_nas_information GROUP BY NasRequestId HAVING COUNT(*) > 1) AS d;
    IF @n > 0
        INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, Severity, IssueCode, Detail)
        VALUES (@run, N'PHL', N'nas_information', N'REVIEW', N'NAS_MULTI_SERVICE_AREA',
                CONCAT(@n, N' NAS requests have several service-area rows; the pathology/histology/MHL row was kept, else the latest. Check that this picks the MHL estimate.'));

    /* ---- 4. reference codes used by requests but missing from the new reference tables ---- */
    INSERT INTO ref.RequestType (RequestTypeCode, Name, LabCode, StartAreaCode, SortOrder, IsActive)
    SELECT x.Code, COALESCE(d.Descrip, x.Code), x.LabCode, N'ENTRY', 900, COALESCE(d.IsActive, 1)
    FROM (SELECT v.ReqTypeCode AS Code, MIN(v.LabCode) AS LabCode
          FROM stage.vRequestEff AS v WHERE v.ReqTypeCode IS NOT NULL GROUP BY v.ReqTypeCode) AS x
    LEFT JOIN (SELECT UPPER(NULLIF(LTRIM(RTRIM(t.t_table_code)), N'')) AS Code,
                      MAX(CASE WHEN LEFT(LTRIM(RTRIM(t.t_table_descrip)), 1) = N'*' THEN LTRIM(RTRIM(SUBSTRING(LTRIM(RTRIM(t.t_table_descrip)), 2, 200)))
                               ELSE LTRIM(RTRIM(t.t_table_descrip)) END) AS Descrip,
                      MIN(CASE WHEN LEFT(LTRIM(RTRIM(t.t_table_descrip)), 1) = N'*' THEN 0 ELSE 1 END) AS IsActive
               FROM stage.PHL_fas_sys_table AS t
               WHERE UPPER(LTRIM(RTRIM(t.t_table_sys))) = N'PHL' AND UPPER(LTRIM(RTRIM(t.t_table_set))) = N'REQTY'
               GROUP BY UPPER(NULLIF(LTRIM(RTRIM(t.t_table_code)), N''))) AS d ON d.Code = x.Code
    WHERE x.LabCode IN (SELECT LabCode FROM ref.Lab)
      AND NOT EXISTS (SELECT 1 FROM ref.RequestType AS rt WHERE rt.RequestTypeCode = x.Code);
    SET @cType = @@ROWCOUNT;
    IF @cType > 0
        INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, Severity, IssueCode, Detail)
        VALUES (@run, N'PHL', N'phl_request', N'REVIEW', N'REQUEST_TYPES_ADDED',
                CONCAT(@cType, N' legacy request types were added to ref.RequestType with start area ENTRY. Set the real start area, or map them onto existing types in legacy.MapValue (MapName REQTYPE).'));

    INSERT INTO ref.Species (SpeciesCode, Name, IsActive)
    SELECT x.Code, COALESCE(x.Name, x.Code), 1
    FROM (SELECT v.SpeciesCode AS Code, MAX(v.SpeciesName) AS Name FROM stage.vRequestEff AS v WHERE v.SpeciesCode IS NOT NULL GROUP BY v.SpeciesCode) AS x
    WHERE NOT EXISTS (SELECT 1 FROM ref.Species AS s WHERE s.SpeciesCode = x.Code);
    SET @cSpec = @@ROWCOUNT;

    INSERT INTO ref.Fixative (FixativeCode, Name, IsActive)
    SELECT x.Code, x.Code, 1
    FROM (SELECT DISTINCT LEFT(v.Fixative, 20) AS Code FROM stage.vRequest AS v WHERE v.Fixative IS NOT NULL) AS x
    WHERE NOT EXISTS (SELECT 1 FROM ref.Fixative AS f WHERE f.FixativeCode = x.Code);
    SET @cFix = @@ROWCOUNT;

    /* ---- 5. users: every set of initials / user code that appears in PHL ---- */
    INSERT INTO legacy.UserToken (Token)
    SELECT DISTINCT LEFT(u.Token, 100)
    FROM (SELECT Inits AS Token FROM stage.vTracking
          UNION SELECT UpdateUser FROM stage.vTracking
          UNION SELECT UpdateUser FROM stage.vCharge
          UNION SELECT UpdateUser FROM stage.vRequest
          UNION SELECT UpdateUser FROM stage.vPhlNo
          UNION SELECT AssignPath FROM stage.vRequest
          UNION SELECT PaName FROM stage.vRequest) AS u
    WHERE u.Token IS NOT NULL AND NOT EXISTS (SELECT 1 FROM legacy.UserToken AS t WHERE t.Token = LEFT(u.Token, 100));
    SET @cTok = @@ROWCOUNT;
    EXEC legacy.usp_ResolveUsers;

    COMMIT TRANSACTION;

    UPDATE legacy.LoadRun
       SET Status = N'SUCCEEDED', FinishedAt = sysutcdatetime(),
           RowCountsJson = CONCAT(N'{"investigators":', @cInv, N',"investigatorsFromRequests":', @cInvFromReq, N',"projects":', @cProj,
                                  N',"nasRequests":', @cNas, N',"requestTypesAdded":', @cType, N',"speciesAdded":', @cSpec,
                                  N',"fixativesAdded":', @cFix, N',"userTokens":', @cTok, N'}')
     WHERE LoadRunId = @run;
    PRINT CONCAT(N'100_load_reference done. Investigators ', @cInv, N' (+', @cInvFromReq, N' from requests), projects ', @cProj, N', NAS ', @cNas,
                 N', request types ', @cType, N', species ', @cSpec, N', fixatives ', @cFix, N', user tokens ', @cTok);
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    UPDATE legacy.LoadRun SET Status = N'FAILED', FinishedAt = sysutcdatetime(), Notes = LEFT(CONCAT(Notes, N': ', ERROR_MESSAGE()), 4000) WHERE LoadRunId = @run;
    THROW;
END CATCH
GO
