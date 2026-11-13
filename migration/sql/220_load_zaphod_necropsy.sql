/* =============================================================================
   MHL LIMS migration  -  220_load_zaphod_necropsy.sql   (Zaphod side)
   tblNecropsyHeaders -> path.Necropsy;  tblNecropsyOrgans (+ tblOrganMeasurements) -> path.NecropsyOrgan;
   tblNecropsyFindings -> path.NecropsyFinding.
   Rules built in:
     * Only animals that were matched to a subject by 210_load_zaphod_studies.sql are loaded.
     * Necropsy status is APPROVED only when Zaphod has an approver, an approval date AND its NecropsyApproved
       flag set; otherwise DRAFT, and a REVIEW issue is logged whenever those disagree (either direction).
     * Protocol: the animal's own protocol, else its study's, else the placeholder protocol "(legacy: not recorded)".
     * Necropsy date (required): date of death, else approval date, else the request's received date. (Zaphod's
       StartDate is the study start, not the necropsy date, so it is not used.)
     * Fate (required): from tblFate, else "Unknown". Fate, condition and the other terms are kept as text.
     * Body weight is converted to grams when the unit (tblAnimals.Measurement) says kg or mg; otherwise it is
       taken as grams. Organ weights are assumed to be grams (the unit is not stored): REVIEW with a prosector.
     * An organ weight belongs to the organ, not to each block: it is placed on the first necropsy row of that organ.
   Needs: 210_load_zaphod_studies.sql.
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

DECLARE @run int;
DECLARE @cNec int = 0, @cOrgan int = 0, @cFind int = 0, @cNoDate int = 0, @cFlag int = 0;
INSERT INTO legacy.LoadRun (SourceSystem, Notes) VALUES (N'ZAPHOD', N'220_load_zaphod_necropsy.sql');
SET @run = SCOPE_IDENTITY();

BEGIN TRY
    DROP TABLE IF EXISTS #N, #O, #MapO, #MapF;
    BEGIN TRANSACTION;

    DECLARE @unknown int = (SELECT UserId FROM sec.AppUser WHERE AdAccount = N'LEGACY\UNKNOWN');
    IF NOT EXISTS (SELECT 1 FROM path.NecropsyProtocol WHERE Name = N'(legacy: not recorded)')
        INSERT INTO path.NecropsyProtocol (Name, WeighAnimal, Instructions, IsApproved, IsActive)
        VALUES (N'(legacy: not recorded)', 0, N'Placeholder for migrated necropsies whose Zaphod animal had no necropsy protocol.', 0, 0);
    DECLARE @noProt int = (SELECT ProtocolId FROM path.NecropsyProtocol WHERE Name = N'(legacy: not recorded)');

    /* ---- one row per necropsy ---- */
    SELECT sb.TargetId AS SubjectId, UPPER(LTRIM(RTRIM(h.PHLNbr))) AS PhlNo,
           COALESCE(pa.TargetId, st.NecropsyProtocolId, @noProt) AS ProtocolId,
           CAST(COALESCE(an.DateOfDeath, h.DateApproved, rq.ReceivedDate) AS date) AS NecropsyDate,
           CAST(CASE WHEN an.DateOfDeath IS NULL AND h.DateApproved IS NULL THEN 1 ELSE 0 END AS bit) AS DateFallback,
           pu.UserId AS ProsectorUserId, COALESCE(pu2.Initials, N'UNK') AS ProsectorInitials,
           COALESCE(NULLIF(LTRIM(RTRIM(fa.Fate)), N''), N'Unknown') AS Fate,
           NULLIF(LTRIM(RTRIM(co.[Condition])), N'') AS Condition,
           LEFT(NULLIF(LTRIM(RTRIM(CAST(h.PhysicalID AS nvarchar(60)))), N''), 60) AS PhysicalId,
           CAST(CASE WHEN UPPER(LEFT(LTRIM(RTRIM(CAST(h.MatchesCageCard AS nvarchar(10)))), 1)) IN (N'Y', N'T', N'1') THEN 1 ELSE 0 END AS bit) AS MatchesCageCard,
           TRY_CAST(CASE WHEN an.Weight IS NULL OR an.Weight < 0 THEN NULL
                     WHEN LOWER(LTRIM(RTRIM(an.Measurement))) = N'kg' THEN an.Weight * 1000.0
                     WHEN LOWER(LTRIM(RTRIM(an.Measurement))) = N'mg' THEN an.Weight / 1000.0
                     ELSE an.Weight END AS decimal(9,3)) AS BodyWeightG,
           LEFT(NULLIF(CONCAT(LTRIM(RTRIM(h.NecropsyObservations)),
                              CASE WHEN NULLIF(LTRIM(RTRIM(h.TrimObservations)), N'') IS NOT NULL THEN CONCAT(CHAR(13), CHAR(10), N'Trim: ', LTRIM(RTRIM(h.TrimObservations))) END), N''), 2000) AS Observations,
           au.UserId AS ApprovedByUserId, CAST(h.DateApproved AS datetime2(0)) AS ApprovedAt,
           legacy.fnBit(an.NecropsyApproved) AS FlagApproved,
           ROW_NUMBER() OVER (PARTITION BY sb.TargetId ORDER BY h.DateApproved DESC, h.PHLNbr) AS rn
    INTO #N
    FROM stage.ZAP_tblNecropsyHeaders AS h
    JOIN legacy.IdCrosswalk AS sb ON sb.SourceSystem = N'ZAPHOD' AND sb.SourceTable = N'tblAnimals' AND sb.SourceKey = UPPER(LTRIM(RTRIM(h.PHLNbr)))
    JOIN lims.Subject AS su ON su.SubjectId = sb.TargetId
    JOIN lims.Request AS rq ON rq.RequestId = su.RequestId
    JOIN stage.ZAP_tblAnimals AS an ON UPPER(LTRIM(RTRIM(an.PHLNbr))) = UPPER(LTRIM(RTRIM(h.PHLNbr)))
    LEFT JOIN lims.Study AS st ON st.StudyId = su.StudyId
    LEFT JOIN legacy.IdCrosswalk AS pa ON pa.SourceSystem = N'ZAPHOD' AND pa.SourceTable = N'tblNecropsyProtocols' AND pa.SourceKey = CAST(an.NecropsyProtocolID AS nvarchar(20))
    LEFT JOIN stage.ZAP_tblFate AS fa ON fa.FateID = an.FateID
    LEFT JOIN stage.ZAP_tblCondition AS co ON co.ConditionID = an.ConditionID
    LEFT JOIN legacy.UserResolve AS pu  ON pu.Token  = LEFT(NULLIF(LTRIM(RTRIM(h.Prosector)), N''), 100)
    LEFT JOIN sec.AppUser        AS pu2 ON pu2.UserId = pu.UserId
    LEFT JOIN legacy.UserResolve AS au  ON au.Token  = LEFT(NULLIF(LTRIM(RTRIM(h.ApprovedBy)), N''), 100)
    WHERE NOT EXISTS (SELECT 1 FROM path.Necropsy AS e WHERE e.SubjectId = sb.TargetId);

    -- more than one header (or animal row) for one subject: keep the latest, log the rest
    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblNecropsyHeaders', PhlNo, N'SKIPPED', N'NECROPSY_DUPLICATE_FOR_SUBJECT', N'More than one necropsy header maps to this subject; the one with the latest approval date was kept.'
    FROM #N WHERE rn > 1;
    DELETE FROM #N WHERE rn > 1;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblNecropsyHeaders', PhlNo, N'CORRECTED', N'NECROPSY_DATE_FROM_REQUEST', N'No date of death or approval date; used the request received date.' FROM #N WHERE DateFallback = 1;
    SET @cNoDate = @@ROWCOUNT;
    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblNecropsyHeaders', PhlNo, N'REVIEW', N'NECROPSY_APPROVAL_MISMATCH',
           CASE WHEN COALESCE(FlagApproved, 0) = 1 THEN N'Zaphod marks the necropsy approved but there is no approver and date; loaded as DRAFT.'
                ELSE N'The header has an approver and date but Zaphod''s NecropsyApproved flag is not set (approval may have been withdrawn); loaded as DRAFT.' END
    FROM #N WHERE CASE WHEN COALESCE(FlagApproved, 0) = 1 THEN 1 ELSE 0 END
              <> CASE WHEN ApprovedByUserId IS NOT NULL AND ApprovedAt IS NOT NULL THEN 1 ELSE 0 END;
    SET @cFlag = @@ROWCOUNT;

    INSERT INTO path.Necropsy (SubjectId, ProtocolId, Status, NecropsyDate, ProsectorUserId, ProsectorInitials, Fate, Condition, PhysicalId, MatchesCageCard,
                               BodyWeightG, IsPartial, Observations, ApprovedByUserId, ApprovedAt)
    SELECT SubjectId, ProtocolId,
           CASE WHEN ApprovedByUserId IS NOT NULL AND ApprovedAt IS NOT NULL AND COALESCE(FlagApproved, 0) = 1 THEN N'APPROVED' ELSE N'DRAFT' END,
           NecropsyDate, ProsectorUserId, LEFT(ProsectorInitials, 4), LEFT(Fate, 60), LEFT(Condition, 60), PhysicalId, MatchesCageCard,
           BodyWeightG, 0, Observations,
           CASE WHEN ApprovedByUserId IS NOT NULL AND ApprovedAt IS NOT NULL AND COALESCE(FlagApproved, 0) = 1 THEN ApprovedByUserId END,
           CASE WHEN ApprovedByUserId IS NOT NULL AND ApprovedAt IS NOT NULL AND COALESCE(FlagApproved, 0) = 1 THEN ApprovedAt END
    FROM #N;
    SET @cNec = @@ROWCOUNT;

    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT N'ZAPHOD', N'tblNecropsyHeaders', n.PhlNo, N'path.Necropsy', e.NecropsyId, @run
    FROM #N AS n JOIN path.Necropsy AS e ON e.SubjectId = n.SubjectId
    WHERE NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblNecropsyHeaders' AND x.SourceKey = n.PhlNo);

    /* ---- necropsy organs ---- */
    SELECT CAST(o.NecropsyOrganID AS int) AS NecropsyOrganID, nx.TargetId AS NecropsyId, og.OrganCode,
           LEFT(NULLIF(LTRIM(RTRIM(o.BlockNbr)), N''), 12) AS BlockCode, LEFT(NULLIF(LTRIM(RTRIM(o.Observations)), N''), 500) AS Observations,
           ROW_NUMBER() OVER (PARTITION BY nx.TargetId ORDER BY o.NecropsyOrganID) AS Seq,
           ROW_NUMBER() OVER (PARTITION BY nx.TargetId, o.OrganID ORDER BY o.NecropsyOrganID) AS OrganOrdinal,
           UPPER(LTRIM(RTRIM(o.PHLNbr))) AS PhlNo, o.OrganID
    INTO #O
    FROM stage.ZAP_tblNecropsyOrgans AS o
    JOIN legacy.IdCrosswalk AS nx ON nx.SourceSystem = N'ZAPHOD' AND nx.SourceTable = N'tblNecropsyHeaders' AND nx.SourceKey = UPPER(LTRIM(RTRIM(o.PHLNbr)))
    JOIN (SELECT zo.OrganID, ro.OrganCode FROM stage.ZAP_tblOrgans AS zo JOIN ref.Organ AS ro ON ro.OrganCode = LEFT(NULLIF(LTRIM(RTRIM(zo.Organ)), N''), 40)) AS og ON og.OrganID = o.OrganID
    WHERE NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblNecropsyOrgans' AND x.SourceKey = CAST(o.NecropsyOrganID AS nvarchar(20)))
      AND NOT EXISTS (SELECT 1 FROM path.NecropsyOrgan AS e WHERE e.NecropsyId = nx.TargetId);   -- re-run safety: a necropsy that already has organs is left alone

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblNecropsyOrgans', CAST(o.NecropsyOrganID AS nvarchar(20)), N'SKIPPED', N'NECROPSY_ORGAN_NOT_LOADED',
           N'The animal has no migrated necropsy header, or the organ id is not in tblOrgans.'
    FROM stage.ZAP_tblNecropsyOrgans AS o
    WHERE NOT EXISTS (SELECT 1 FROM #O AS x WHERE x.NecropsyOrganID = CAST(o.NecropsyOrganID AS int))
      AND NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS c WHERE c.SourceSystem = N'ZAPHOD' AND c.SourceTable = N'tblNecropsyOrgans' AND c.SourceKey = CAST(o.NecropsyOrganID AS nvarchar(20)));

    CREATE TABLE #MapO (NecropsyOrganID int NOT NULL, NecropsyOrganId_new int NOT NULL);
    MERGE path.NecropsyOrgan AS tgt
    USING (SELECT o.*, m.W AS WeightG FROM #O AS o
           LEFT JOIN (SELECT UPPER(LTRIM(RTRIM(PHLNbr))) AS PhlNo, OrganId AS OrganID, MAX(TRY_CAST(OrganWeight AS decimal(9,4))) AS W
                      FROM stage.ZAP_tblOrganMeasurements WHERE TRY_CAST(OrganWeight AS decimal(9,4)) >= 0 GROUP BY UPPER(LTRIM(RTRIM(PHLNbr))), OrganId) AS m
                  ON m.PhlNo = o.PhlNo AND m.OrganID = o.OrganID AND o.OrganOrdinal = 1) AS s ON 1 = 0
    WHEN NOT MATCHED THEN
        INSERT (NecropsyId, Sequence, OrganCode, BlockCode, IsWeighed, WeightG, NotCollected, Observations)
        VALUES (s.NecropsyId, s.Seq, s.OrganCode, s.BlockCode, CASE WHEN s.WeightG IS NOT NULL THEN 1 ELSE 0 END, s.WeightG, 0, s.Observations)
    OUTPUT s.NecropsyOrganID, inserted.NecropsyOrganId INTO #MapO (NecropsyOrganID, NecropsyOrganId_new);
    SET @cOrgan = @@ROWCOUNT;

    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT N'ZAPHOD', N'tblNecropsyOrgans', CAST(NecropsyOrganID AS nvarchar(20)), N'path.NecropsyOrgan', NecropsyOrganId_new, @run FROM #MapO;

    /* ---- necropsy findings ---- */
    CREATE TABLE #MapF (NecropsyFindingID int NOT NULL, NecropsyFindingId_new int NOT NULL);
    MERGE path.NecropsyFinding AS tgt
    USING (SELECT CAST(f.NecropsyFindingID AS int) AS NecropsyFindingID, ox.TargetId AS NecropsyOrganId,
                  LEFT(NULLIF(LTRIM(RTRIM(si.[Site])), N''), 60) AS Site,
                  LEFT(COALESCE(NULLIF(LTRIM(RTRIM(mo.Morphology)), N''), N'(not recorded)'), 60) AS Morphology,
                  LEFT(NULLIF(LTRIM(RTRIM(sh.Shape)), N''), 40) AS Shape, LEFT(NULLIF(LTRIM(RTRIM(cl.Color)), N''), 40) AS Color,
                  LEFT(NULLIF(LTRIM(RTRIM(cs.Consistency)), N''), 40) AS Consistency,
                  CASE WHEN TRY_CAST(f.Qty AS int) >= 1 THEN TRY_CAST(f.Qty AS int) END AS Quantity,
                  COALESCE(legacy.fnBit(f.NBF), 0) AS FixedNbf, COALESCE(legacy.fnBit(f.OCT), 0) AS FixedOct,
                  COALESCE(legacy.fnBit(f.LiqNit), 0) AS FrozenLn2, COALESCE(legacy.fnBit(f.PBS), 0) AS InPbs,
                  LEFT(NULLIF(CONCAT_WS(N' ; ', NULLIF(LTRIM(RTRIM(f.Observations)), N''),
                                        CASE WHEN NULLIF(LTRIM(RTRIM(CAST(f.Measurement AS nvarchar(100)))), N'') IS NOT NULL THEN CONCAT(N'measurement: ', LTRIM(RTRIM(CAST(f.Measurement AS nvarchar(100))))) END), N''), 300) AS Notes
           FROM stage.ZAP_tblNecropsyFindings AS f
           JOIN legacy.IdCrosswalk AS ox ON ox.SourceSystem = N'ZAPHOD' AND ox.SourceTable = N'tblNecropsyOrgans' AND ox.SourceKey = CAST(f.NecropsyOrganID AS nvarchar(20))
           LEFT JOIN stage.ZAP_tblSite AS si ON si.SiteID = f.SiteID
           LEFT JOIN stage.ZAP_tblMorphology AS mo ON mo.MorphologyID = f.MorphologyID
           LEFT JOIN stage.ZAP_tblShape AS sh ON sh.ShapeID = f.ShapeID
           LEFT JOIN stage.ZAP_tblColor AS cl ON cl.ColorID = f.ColorID
           LEFT JOIN stage.ZAP_tblConsistency AS cs ON cs.ConsistencyID = f.ConsistencyID
           WHERE NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblNecropsyFindings' AND x.SourceKey = CAST(f.NecropsyFindingID AS nvarchar(20)))
          ) AS s ON 1 = 0
    WHEN NOT MATCHED THEN
        INSERT (NecropsyOrganId, Site, Morphology, Shape, Color, Consistency, Quantity, FixedNbf, FixedOct, FrozenLn2, InPbs, Notes)
        VALUES (s.NecropsyOrganId, s.Site, s.Morphology, s.Shape, s.Color, s.Consistency, s.Quantity, s.FixedNbf, s.FixedOct, s.FrozenLn2, s.InPbs, s.Notes)
    OUTPUT s.NecropsyFindingID, inserted.NecropsyFindingId INTO #MapF (NecropsyFindingID, NecropsyFindingId_new);
    SET @cFind = @@ROWCOUNT;

    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT N'ZAPHOD', N'tblNecropsyFindings', CAST(NecropsyFindingID AS nvarchar(20)), N'path.NecropsyFinding', NecropsyFindingId_new, @run FROM #MapF;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblNecropsyFindings', CAST(f.NecropsyFindingID AS nvarchar(20)), N'SKIPPED', N'NECROPSY_FINDING_NOT_LOADED', N'The finding''s necropsy organ was not loaded.'
    FROM stage.ZAP_tblNecropsyFindings AS f
    WHERE NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblNecropsyFindings' AND x.SourceKey = CAST(f.NecropsyFindingID AS nvarchar(20)));

    -- text longer than the new columns allow is cut; say how much
    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', t.Tbl, N'CORRECTED', N'TEXT_TRUNCATED', CONCAT(t.N, N' values of ', t.Col, N' are longer than ', t.Lim, N' characters and were cut. The full text stays in the stage table.')
    FROM (SELECT N'tblNecropsyHeaders' AS Tbl, N'NecropsyObservations' AS Col, 2000 AS Lim, COUNT(*) AS N FROM stage.ZAP_tblNecropsyHeaders WHERE LEN(NecropsyObservations) > 2000
          UNION ALL SELECT N'tblNecropsyOrgans', N'Observations', 500, COUNT(*) FROM stage.ZAP_tblNecropsyOrgans WHERE LEN(Observations) > 500
          UNION ALL SELECT N'tblNecropsyFindings', N'Observations', 300, COUNT(*) FROM stage.ZAP_tblNecropsyFindings WHERE LEN(Observations) > 300) AS t
    WHERE t.N > 0;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, Severity, IssueCode, Detail)
    VALUES (@run, N'ZAPHOD', N'tblNecropsyFindings', N'REVIEW', N'FINDING_SIZE_IN_NOTES',
            N'Zaphod stores finding size as free text (Measurement); it is copied into the finding notes, not into SizeMm. Organ weights are assumed to be grams.');

    COMMIT TRANSACTION;
    DROP TABLE IF EXISTS #N, #O, #MapO, #MapF;

    UPDATE legacy.LoadRun SET Status = N'SUCCEEDED', FinishedAt = sysutcdatetime(),
           RowCountsJson = CONCAT(N'{"necropsies":', @cNec, N',"organs":', @cOrgan, N',"findings":', @cFind, N',"dateFromRequest":', @cNoDate, N',"approvedFlagWithoutApproval":', @cFlag, N'}')
     WHERE LoadRunId = @run;
    PRINT CONCAT(N'220_load_zaphod_necropsy done. Necropsies ', @cNec, N', organs ', @cOrgan, N', findings ', @cFind);
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    UPDATE legacy.LoadRun SET Status = N'FAILED', FinishedAt = sysutcdatetime(), Notes = LEFT(CONCAT(Notes, N': ', ERROR_MESSAGE()), 4000) WHERE LoadRunId = @run;
    THROW;
END CATCH
GO
