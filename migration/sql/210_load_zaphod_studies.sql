/* =============================================================================
   MHL LIMS migration  -  210_load_zaphod_studies.sql   (Zaphod side)
   Studies, groups and animals.
     tblStudies (+ tblACUC, vwStudies for the pathologist's name) -> lims.Study
     tblGroup                                                     -> lims.StudyGroup
     tblAnimals                                                   -> UPDATES the lims.Subject created from PHL
   Zaphod identifies an animal only by PHL number, but PHL numbers can repeat across requests, so each animal is
   matched to a subject in this order (recorded in legacy.AnimalSource.MatchBasis):
       1. PHL number + Zaphod's own request number (ReqNbr) equal to the legacy request id   -> 'PHL+REQ'
       2. PHL number + the ZAPNbr that PHL staff typed in the PHL# comment field            -> 'PHL+ZAP'
       3. the PHL number occurs only once among migrated subjects                            -> 'PHL_UNIQUE'
   Animals that match nothing, or that match several subjects equally well, are NOT loaded; they are listed in
   legacy.LoadIssue (ANIMAL_NO_PHL_MATCH, ANIMAL_AMBIGUOUS) and counted in 900_reconcile.sql. The usual cause of
   "no match" is a request that is only in the PHL archive database: load that first, then re-run this script.
   Needs: 110_load_requests.sql, 200_load_zaphod_dictionaries.sql.
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

DECLARE @run int;
DECLARE @cStudy int = 0, @cGroup int = 0, @cAnimal int = 0, @cNoMatch int = 0, @cAmbig int = 0, @cReqStudy int = 0;
INSERT INTO legacy.LoadRun (SourceSystem, Notes) VALUES (N'ZAPHOD', N'210_load_zaphod_studies.sql');
SET @run = SCOPE_IDENTITY();

BEGIN TRY
    DROP TABLE IF EXISTS #A, #Cand, #Pick, #Final;
    BEGIN TRANSACTION;

    /* ---- users named in Zaphod ---- */
    INSERT INTO legacy.UserToken (Token)
    SELECT DISTINCT LEFT(u.Token, 100)
    FROM (SELECT NULLIF(LTRIM(RTRIM(Pathologist)), N'') AS Token FROM stage.ZAP_vwStudies
          UNION SELECT NULLIF(LTRIM(RTRIM(Prosector)), N'') FROM stage.ZAP_tblNecropsyHeaders
          UNION SELECT NULLIF(LTRIM(RTRIM(ApprovedBy)), N'') FROM stage.ZAP_tblNecropsyHeaders
          UNION SELECT NULLIF(LTRIM(RTRIM(UserName)), N'') FROM stage.ZAP_tblNecropsyFindings
          UNION SELECT NULLIF(LTRIM(RTRIM(UserName)), N'') FROM stage.ZAP_tblPathologyDiagnoses
          UNION SELECT NULLIF(LTRIM(RTRIM(UserName)), N'') FROM stage.ZAP_tblApprovers) AS u
    WHERE u.Token IS NOT NULL AND NOT EXISTS (SELECT 1 FROM legacy.UserToken AS t WHERE t.Token = LEFT(u.Token, 100));
    EXEC legacy.usp_ResolveUsers;

    DECLARE @noInv int = (SELECT TOP (1) InvestigatorId FROM lims.Investigator WHERE LastName = N'(no investigator on legacy request)');
    IF @noInv IS NULL
    BEGIN
        INSERT INTO lims.Investigator (LastName, IsActive) VALUES (N'(no investigator on legacy request)', 0);
        SET @noInv = SCOPE_IDENTITY();
    END

    /* ---- studies ---- */
    INSERT INTO lims.Study (ZapNumber, Title, InvestigatorId, PathologistUserId, AcucProtocol, AcucStartDate, AcucEndDate, Remarks, IsObsolete, IsLegacy, NecropsyProtocolId)
    SELECT LEFT(LTRIM(RTRIM(s.ZAPNbr)), 20), LEFT(NULLIF(LTRIM(RTRIM(s.StudyTitle)), N''), 400),
           COALESCE(inv.InvestigatorId, @noInv), ur.UserId,
           LEFT(ac.ACUC, 50), CAST(ac.StartDate AS date), CAST(ac.EndDate AS date),
           NULLIF(LTRIM(RTRIM(s.Remarks)), N''), COALESCE(legacy.fnBit(s.Obsolete), 0), 1, np.TargetId
    FROM (SELECT x.*, ROW_NUMBER() OVER (PARTITION BY LEFT(LTRIM(RTRIM(x.ZAPNbr)), 20) ORDER BY x.DateEntered) AS rn FROM stage.ZAP_tblStudies AS x) AS s
    LEFT JOIN lims.Investigator AS inv ON inv.LegacySsgInvesNo = CAST(s.InvestigatorID AS int)
    LEFT JOIN (SELECT ZAPNbr, MAX(NULLIF(LTRIM(RTRIM(Pathologist)), N'')) AS Pathologist FROM stage.ZAP_vwStudies GROUP BY ZAPNbr) AS vs ON vs.ZAPNbr = s.ZAPNbr
    LEFT JOIN legacy.UserResolve AS ur ON ur.Token = LEFT(vs.Pathologist, 100)
    LEFT JOIN (SELECT a.*, ROW_NUMBER() OVER (PARTITION BY a.ZAPNbr ORDER BY a.StartDate DESC) AS rn FROM stage.ZAP_tblACUC AS a) AS ac ON ac.ZAPNbr = s.ZAPNbr AND ac.rn = 1
    LEFT JOIN legacy.IdCrosswalk AS np ON np.SourceSystem = N'ZAPHOD' AND np.SourceTable = N'tblNecropsyProtocols' AND np.SourceKey = CAST(s.NecropsyProtocolID AS nvarchar(20))
    WHERE s.rn = 1 AND NULLIF(LTRIM(RTRIM(s.ZAPNbr)), N'') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM lims.Study AS x WHERE x.ZapNumber = LEFT(LTRIM(RTRIM(s.ZAPNbr)), 20));
    SET @cStudy = @@ROWCOUNT;

    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT DISTINCT N'ZAPHOD', N'tblStudies', LEFT(LTRIM(RTRIM(s.ZAPNbr)), 20), N'lims.Study', st.StudyId, @run
    FROM stage.ZAP_tblStudies AS s
    JOIN lims.Study AS st ON st.ZapNumber = LEFT(LTRIM(RTRIM(s.ZAPNbr)), 20)
    WHERE NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblStudies' AND x.SourceKey = LEFT(LTRIM(RTRIM(s.ZAPNbr)), 20));

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblStudies', LEFT(LTRIM(RTRIM(s.ZAPNbr)), 20), N'REVIEW', N'STUDY_INVESTIGATOR_UNRESOLVED',
           N'Zaphod InvestigatorID does not match a migrated investigator (ssg_investigators i_inves_no assumed); linked to the placeholder investigator.'
    FROM stage.ZAP_tblStudies AS s
    JOIN lims.Study AS st ON st.ZapNumber = LEFT(LTRIM(RTRIM(s.ZAPNbr)), 20) AND st.InvestigatorId = @noInv
    WHERE NOT EXISTS (SELECT 1 FROM legacy.LoadIssue AS i WHERE i.IssueCode = N'STUDY_INVESTIGATOR_UNRESOLVED' AND i.SourceKey = LEFT(LTRIM(RTRIM(s.ZAPNbr)), 20));

    UPDATE u SET IsPathologist = 1
    FROM sec.AppUser AS u
    WHERE u.IsPathologist = 0 AND u.UserId IN (SELECT PathologistUserId FROM lims.Study WHERE PathologistUserId IS NOT NULL);

    /* ---- groups ---- */
    INSERT INTO lims.StudyGroup (StudyId, GroupCode, Name, Sex, Genotype, Treatment)
    SELECT sx.TargetId, LEFT(LTRIM(RTRIM(g.GroupID)), 20), LEFT(NULLIF(LTRIM(RTRIM(g.GroupName)), N''), 200),
           CASE WHEN LEN(LTRIM(RTRIM(g.Sex))) = 1 AND UPPER(LTRIM(RTRIM(g.Sex))) IN (N'M', N'F', N'U') THEN UPPER(LTRIM(RTRIM(g.Sex))) ELSE sm.TargetValue END,
           LEFT(NULLIF(LTRIM(RTRIM(g.Genotype)), N''), 200),
           LEFT(NULLIF(CONCAT(LTRIM(RTRIM(g.Treatment)), CASE WHEN NULLIF(LTRIM(RTRIM(g.Description)), N'') IS NOT NULL THEN CONCAT(N' | ', LTRIM(RTRIM(g.Description))) END), N''), 400)
    FROM (SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.ZAPNbr, LTRIM(RTRIM(x.GroupID)) ORDER BY x.GroupNbr) AS rn FROM stage.ZAP_tblGroup AS x
          WHERE NULLIF(LTRIM(RTRIM(x.GroupID)), N'') IS NOT NULL) AS g
    JOIN legacy.IdCrosswalk AS sx ON sx.SourceSystem = N'ZAPHOD' AND sx.SourceTable = N'tblStudies' AND sx.SourceKey = LEFT(LTRIM(RTRIM(g.ZAPNbr)), 20)
    LEFT JOIN legacy.MapValue AS sm ON sm.MapName = N'SEX' AND sm.SourceValue = LTRIM(RTRIM(g.Sex))
    WHERE g.rn = 1
      AND NOT EXISTS (SELECT 1 FROM lims.StudyGroup AS e WHERE e.StudyId = sx.TargetId AND e.GroupCode = LEFT(LTRIM(RTRIM(g.GroupID)), 20));
    SET @cGroup = @@ROWCOUNT;

    /* ---- animals: find the subject each belongs to ---- */
    -- these two issue codes describe the CURRENT state, so earlier rows are replaced rather than duplicated
    DELETE FROM legacy.LoadIssue WHERE SourceSystem = N'ZAPHOD' AND IssueCode IN (N'ANIMAL_NO_PHL_MATCH', N'ANIMAL_AMBIGUOUS');

    SELECT UPPER(LTRIM(RTRIM(a.PHLNbr))) AS PhlNo, NULLIF(LTRIM(RTRIM(a.ReqNbr)), N'') AS ReqNbr,
           LEFT(NULLIF(LTRIM(RTRIM(a.ZAPNbr)), N''), 20) AS ZapNbr, NULLIF(LTRIM(RTRIM(a.GroupID)), N'') AS GroupId,
           a.AnimalNbr, a.SpeciesID, a.Sex, a.Strain, a.Weight, a.Measurement, a.BirthDate, a.StartDate, a.DateOfDeath, a.Age, a.TimeOnTest,
           a.FateID, a.ConditionID, a.NecropsyProtocolID, a.TrimProtocolID, a.ClinObs,
           a.NecropsyFlag, a.PathologyFlag, a.NoPathologyRequested, a.InPathology, a.NecropsyApproved, a.PathologyComplete, a.Locked,
           ROW_NUMBER() OVER (PARTITION BY UPPER(LTRIM(RTRIM(a.PHLNbr))) ORDER BY a.PHLNbr) AS dup
    INTO #A
    FROM stage.ZAP_tblAnimals AS a
    WHERE NULLIF(LTRIM(RTRIM(a.PHLNbr)), N'') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblAnimals' AND x.SourceKey = UPPER(LTRIM(RTRIM(a.PHLNbr))));

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblAnimals', PhlNo, N'SKIPPED', N'ANIMAL_DUPLICATE_PHL', N'The same PHL number occurs twice in tblAnimals after trimming and case folding; the first was kept.' FROM #A WHERE dup > 1;
    DELETE FROM #A WHERE dup > 1;

    -- request numbers are compared ignoring case, spaces and dashes (the format Zaphod stored in ReqNbr is confirmed
    -- by the MatchBasis counts in 910_reconcile_zaphod.sql: almost every animal should be 'PHL+REQ')
    SELECT a.PhlNo, s.SubjectId,
           CASE WHEN a.ReqNbr IS NOT NULL AND UPPER(REPLACE(REPLACE(rs.LegacyReqId, N' ', N''), N'-', N'')) = UPPER(REPLACE(REPLACE(a.ReqNbr, N' ', N''), N'-', N'')) THEN 1
                WHEN a.ZapNbr IS NOT NULL AND ss.ZapNbrAsEntered = a.ZapNbr THEN 2 ELSE 3 END AS Rnk
    INTO #Cand
    FROM #A AS a
    JOIN lims.Subject AS s ON s.PhlNumber = a.PhlNo AND s.IsLegacy = 1
    LEFT JOIN legacy.RequestSource AS rs ON rs.RequestId = s.RequestId
    LEFT JOIN legacy.SubjectSource AS ss ON ss.SubjectId = s.SubjectId;

    -- best rank per animal, and how many subjects share it
    SELECT c.PhlNo, c.Rnk, COUNT(*) AS N, MIN(c.SubjectId) AS SubjectId,
           (SELECT COUNT(*) FROM #Cand AS t WHERE t.PhlNo = c.PhlNo) AS TotalCand
    INTO #Pick
    FROM #Cand AS c
    WHERE c.Rnk = (SELECT MIN(m.Rnk) FROM #Cand AS m WHERE m.PhlNo = c.PhlNo)
    GROUP BY c.PhlNo, c.Rnk;

    SELECT a.*, p.SubjectId,
           CASE p.Rnk WHEN 1 THEN N'PHL+REQ' WHEN 2 THEN N'PHL+ZAP' ELSE N'PHL_UNIQUE' END AS MatchBasis
    INTO #Final
    FROM #A AS a
    JOIN #Pick AS p ON p.PhlNo = a.PhlNo
    WHERE p.N = 1 AND (p.Rnk < 3 OR p.TotalCand = 1)
      -- one subject must not receive two animals
      AND NOT EXISTS (SELECT 1 FROM legacy.AnimalSource AS e WHERE e.SubjectId = p.SubjectId);

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblAnimals', a.PhlNo, N'SKIPPED', N'ANIMAL_NO_PHL_MATCH',
           N'No migrated PHL number equals this animal. Load the PHL archive database and re-run, or the request is missing from PHL.'
    FROM #A AS a WHERE NOT EXISTS (SELECT 1 FROM #Cand AS c WHERE c.PhlNo = a.PhlNo);
    SET @cNoMatch = @@ROWCOUNT;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblAnimals', a.PhlNo, N'SKIPPED', N'ANIMAL_AMBIGUOUS',
           N'The PHL number matches several migrated subjects equally well (request number and ZAPNbr do not decide). Needs a manual choice.'
    FROM #A AS a
    WHERE EXISTS (SELECT 1 FROM #Cand AS c WHERE c.PhlNo = a.PhlNo) AND NOT EXISTS (SELECT 1 FROM #Final AS f WHERE f.PhlNo = a.PhlNo);
    SET @cAmbig = @@ROWCOUNT;

    /* ---- apply to subjects ---- */
    UPDATE s SET
        StudyId      = COALESCE(s.StudyId, sx.TargetId),
        GroupId      = CASE WHEN COALESCE(s.StudyId, sx.TargetId) = sx.TargetId THEN COALESCE(s.GroupId, g.GroupId) ELSE s.GroupId END,
        AnimalNumber = COALESCE(s.AnimalNumber, LEFT(NULLIF(LTRIM(RTRIM(f.AnimalNbr)), N''), 30)),
        SpeciesCode  = COALESCE(s.SpeciesCode, sp.SpeciesCode),
        Sex          = COALESCE(s.Sex, sexm.TargetValue),
        Genotype     = COALESCE(s.Genotype, LEFT(NULLIF(LTRIM(RTRIM(g.Genotype)), N''), 200)),
        BirthDate    = d.NewBirth,
        DeathDate    = d.NewDeath
    FROM lims.Subject AS s
    JOIN #Final AS f ON f.SubjectId = s.SubjectId
    LEFT JOIN legacy.IdCrosswalk AS sx ON sx.SourceSystem = N'ZAPHOD' AND sx.SourceTable = N'tblStudies' AND sx.SourceKey = f.ZapNbr
    LEFT JOIN lims.StudyGroup AS g ON g.StudyId = sx.TargetId AND g.GroupCode = LEFT(f.GroupId, 20)
    LEFT JOIN (SELECT zs.SpeciesID, COALESCE(m.TargetValue, UPPER(LEFT(NULLIF(LTRIM(RTRIM(zs.Species)), N''), 10))) AS Code
               FROM stage.ZAP_tblSpecies AS zs LEFT JOIN legacy.MapValue AS m ON m.MapName = N'SPECIES' AND m.SourceValue = LTRIM(RTRIM(zs.Species))) AS spx ON spx.SpeciesID = f.SpeciesID
    LEFT JOIN ref.Species AS sp ON sp.SpeciesCode = spx.Code
    LEFT JOIN legacy.MapValue AS sexm ON sexm.MapName = N'SEX' AND sexm.SourceValue = LTRIM(RTRIM(f.Sex))
    CROSS APPLY (SELECT CASE WHEN s.BirthDate IS NOT NULL THEN s.BirthDate
                             WHEN f.BirthDate IS NOT NULL AND (s.DeathDate IS NULL OR CAST(f.BirthDate AS date) <= s.DeathDate) THEN CAST(f.BirthDate AS date) END AS NewBirth) AS b
    CROSS APPLY (SELECT b.NewBirth,
                        CASE WHEN s.DeathDate IS NOT NULL THEN s.DeathDate
                             WHEN f.DateOfDeath IS NOT NULL AND (b.NewBirth IS NULL OR CAST(f.DateOfDeath AS date) >= b.NewBirth) THEN CAST(f.DateOfDeath AS date) END AS NewDeath) AS d;

    -- a death date earlier than the birth date is not stored; say so
    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblAnimals', f.PhlNo, N'CORRECTED', N'DEATH_BEFORE_BIRTH_DROPPED', N'Date of death is earlier than birth date; death date not stored (kept in the stage table).'
    FROM #Final AS f WHERE f.DateOfDeath IS NOT NULL AND f.BirthDate IS NOT NULL AND CAST(f.DateOfDeath AS date) < CAST(f.BirthDate AS date);

    INSERT INTO legacy.AnimalSource (SubjectId, ZapPhlNbr, ZapReqNbr, Strain, BodyWeight, BodyWeightUnit, StartDate, AgeDays, TimeOnTestDays, ClinicalObservations,
                                     NecropsyFlag, PathologyFlag, NoPathologyRequested, InPathology, NecropsyApproved, PathologyComplete, Locked,
                                     NecropsyProtocolId, TrimProtocolId, MatchBasis)
    SELECT f.SubjectId, f.PhlNo, LEFT(f.ReqNbr, 50), LEFT(NULLIF(LTRIM(RTRIM(f.Strain)), N''), 50), f.Weight, LEFT(NULLIF(LTRIM(RTRIM(f.Measurement)), N''), 15),
           f.StartDate, f.Age, f.TimeOnTest, LEFT(f.ClinObs, 1024),
           legacy.fnBit(f.NecropsyFlag), legacy.fnBit(f.PathologyFlag), legacy.fnBit(f.NoPathologyRequested), legacy.fnBit(f.InPathology),
           legacy.fnBit(f.NecropsyApproved), legacy.fnBit(f.PathologyComplete), legacy.fnBit(f.Locked),
           CAST(f.NecropsyProtocolID AS int), CAST(f.TrimProtocolID AS int), f.MatchBasis
    FROM #Final AS f;
    SET @cAnimal = @@ROWCOUNT;

    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT N'ZAPHOD', N'tblAnimals', f.PhlNo, N'lims.Subject', f.SubjectId, @run FROM #Final AS f;

    -- a request whose animals all belong to one study gets that study
    UPDATE r SET StudyId = x.StudyId
    FROM lims.Request AS r
    JOIN (SELECT s.RequestId, MIN(s.StudyId) AS StudyId FROM lims.Subject AS s WHERE s.IsLegacy = 1
          GROUP BY s.RequestId HAVING COUNT(DISTINCT s.StudyId) = 1 AND COUNT(*) = COUNT(s.StudyId)) AS x ON x.RequestId = r.RequestId
    WHERE r.StudyId IS NULL AND r.IsLegacy = 1;
    SET @cReqStudy = @@ROWCOUNT;

    COMMIT TRANSACTION;
    DROP TABLE IF EXISTS #A, #Cand, #Pick, #Final;

    UPDATE legacy.LoadRun SET Status = N'SUCCEEDED', FinishedAt = sysutcdatetime(),
           RowCountsJson = CONCAT(N'{"studies":', @cStudy, N',"groups":', @cGroup, N',"animalsMatched":', @cAnimal, N',"animalsNoMatch":', @cNoMatch,
                                  N',"animalsAmbiguous":', @cAmbig, N',"requestsLinkedToStudy":', @cReqStudy, N'}')
     WHERE LoadRunId = @run;
    PRINT CONCAT(N'210_load_zaphod_studies done. Studies ', @cStudy, N', groups ', @cGroup, N', animals matched ', @cAnimal,
                 N' (no match ', @cNoMatch, N', ambiguous ', @cAmbig, N')');
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    UPDATE legacy.LoadRun SET Status = N'FAILED', FinishedAt = sysutcdatetime(), Notes = LEFT(CONCAT(Notes, N': ', ERROR_MESSAGE()), 4000) WHERE LoadRunId = @run;
    THROW;
END CATCH
GO
