/* =============================================================================
   MHL LIMS migration  -  230_load_zaphod_pathology.sql   (Zaphod side)
   tblPathologyHeaders -> path.PathologyCase;  tblPathologyOrgans -> path.PathologyTissue;
   tblPathologyDiagnoses -> path.PathologyDiagnosis;  tblPathologyCorrelation -> path.PathologyCorrelation.

   Every case is loaded as DRAFT. Signing out is a separate, deliberate step: 235_sign_pathology_cases.sql.

   Rules built in (review with the pathologists; most are marked GUESS):
     * The case's pathologist is the study's pathologist.
     * Tissue result: legacy.MapValue TISSUE_RESULT on tblPathologyOrgans.Finding; otherwise LESIONS if the tissue
       has diagnoses and PENDING if not.                                                   GUESS
     * Neoplasm: legacy.MapValue NEOPLASM on tblNeoplasm.Neoplasm gives behavior|origin (or NONE); otherwise a
       diagnosis counts as a neoplasm when Zaphod's diagnosis Code is N. Non-neoplasms take a severity from
       legacy.MapValue SEVERITY. Unmapped words, and map values the new schema does not allow, are treated as unmapped and logged, never guessed.   GUESS
     * Cause of death: linked as a diagnosis only when the case has that diagnosis in that organ; otherwise only
       the comment is kept.                                                                 GUESS
     * Anything that cannot be loaded (a tissue with no organ, a diagnosis with no term, a correlation whose ends
       were not loaded) is logged in legacy.LoadIssue as *_NOT_LOADED and keeps the case from being signed in 235.
   Needs: 220_load_zaphod_necropsy.sql, and the ASSUMED columns PathologyFindingID (tblPathologyFindings),
   PathologyDiagnosisID (tblPathologyDiagnoses) confirmed by 010_check_stage.sql.
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

DECLARE @run int;
DECLARE @cCase int = 0, @cTissue int = 0, @cDiag int = 0, @cCorr int = 0, @cCod int = 0;
INSERT INTO legacy.LoadRun (SourceSystem, Notes) VALUES (N'ZAPHOD', N'230_load_zaphod_pathology.sql');
SET @run = SCOPE_IDENTITY();

BEGIN TRY
    DROP TABLE IF EXISTS #P, #T, #MapT, #D, #MapD, #Sig, #Corr;
    BEGIN TRANSACTION;

    /* ---- cases (all DRAFT) ---- */
    SELECT q.* INTO #P
    FROM (
        SELECT sb.TargetId AS SubjectId, UPPER(LTRIM(RTRIM(h.PHLNbr))) AS PhlNo, st.PathologistUserId,
               LEFT(NULLIF(LTRIM(RTRIM(h.CODComments)), N''), 300) AS CodComment, LEFT(NULLIF(LTRIM(RTRIM(h.Comments)), N''), 4000) AS PathComment,
               h.CODOrganID, h.CauseOfDeathID,
               ROW_NUMBER() OVER (PARTITION BY sb.TargetId ORDER BY h.DateUpdated DESC, h.PHLNbr) AS rn
        FROM stage.ZAP_tblPathologyHeaders AS h
        JOIN legacy.IdCrosswalk AS sb ON sb.SourceSystem = N'ZAPHOD' AND sb.SourceTable = N'tblAnimals' AND sb.SourceKey = UPPER(LTRIM(RTRIM(h.PHLNbr)))
        JOIN lims.Subject AS su ON su.SubjectId = sb.TargetId
        LEFT JOIN lims.Study AS st ON st.StudyId = su.StudyId
        WHERE NOT EXISTS (SELECT 1 FROM path.PathologyCase AS e WHERE e.SubjectId = sb.TargetId)
    ) AS q;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblPathologyHeaders', PhlNo, N'SKIPPED', N'PATHOLOGY_DUPLICATE_FOR_SUBJECT', N'More than one pathology header maps to this subject; the most recently updated one was kept.'
    FROM #P WHERE rn > 1;
    DELETE FROM #P WHERE rn > 1;

    INSERT INTO path.PathologyCase (SubjectId, Status, Version, PathologistUserId, CauseOfDeathComment, PathologistComment, ExtraQuarterHours)
    SELECT SubjectId, N'DRAFT', 1, PathologistUserId, CodComment, PathComment, 0 FROM #P;
    SET @cCase = @@ROWCOUNT;

    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT N'ZAPHOD', N'tblPathologyHeaders', p.PhlNo, N'path.PathologyCase', c.PathologyCaseId, @run
    FROM #P AS p JOIN path.PathologyCase AS c ON c.SubjectId = p.SubjectId
    WHERE NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblPathologyHeaders' AND x.SourceKey = p.PhlNo);

    SELECT p.SubjectId, c.PathologyCaseId, p.CODOrganID, p.CauseOfDeathID, p.PhlNo
    INTO #Sig
    FROM #P AS p JOIN path.PathologyCase AS c ON c.SubjectId = p.SubjectId;

    /* ---- tissues ---- */
    SELECT CAST(o.PathologyOrganID AS int) AS PathologyOrganID, cx.TargetId AS PathologyCaseId, og.OrganCode,
           LEFT(NULLIF(LTRIM(RTRIM(o.BlockNbr)), N''), 12) AS BlockCode, nox.TargetId AS NecropsyOrganId,
           LEFT(NULLIF(LTRIM(RTRIM(o.Comments)), N''), 500) AS Comment, NULLIF(LTRIM(RTRIM(o.Finding)), N'') AS Finding,
           ROW_NUMBER() OVER (PARTITION BY cx.TargetId ORDER BY o.PathologyOrganID) AS Seq,
           CAST(CASE WHEN EXISTS (SELECT 1 FROM stage.ZAP_tblPathologyDiagnoses AS d WHERE d.PathologyOrganID = o.PathologyOrganID) THEN 1 ELSE 0 END AS bit) AS HasDiagnoses
    INTO #T
    FROM stage.ZAP_tblPathologyOrgans AS o
    JOIN legacy.IdCrosswalk AS cx ON cx.SourceSystem = N'ZAPHOD' AND cx.SourceTable = N'tblPathologyHeaders' AND cx.SourceKey = UPPER(LTRIM(RTRIM(o.PHLNbr)))
    JOIN (SELECT zo.OrganID, ro.OrganCode FROM stage.ZAP_tblOrgans AS zo JOIN ref.Organ AS ro ON ro.OrganCode = LEFT(NULLIF(LTRIM(RTRIM(zo.Organ)), N''), 40)) AS og ON og.OrganID = o.OrganID
    LEFT JOIN legacy.IdCrosswalk AS nox ON nox.SourceSystem = N'ZAPHOD' AND nox.SourceTable = N'tblNecropsyOrgans' AND nox.SourceKey = CAST(o.NecropsyOrganID AS nvarchar(20))
    WHERE cx.TargetId IN (SELECT PathologyCaseId FROM #Sig)
      AND NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblPathologyOrgans' AND x.SourceKey = CAST(o.PathologyOrganID AS nvarchar(20)));

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblPathologyOrgans', CAST(o.PathologyOrganID AS nvarchar(20)), N'SKIPPED', N'PATHOLOGY_TISSUE_NOT_LOADED',
           N'The tissue''s organ id is not in tblOrgans, or the organ has no name. The case cannot be signed in 235 until this is resolved.'
    FROM stage.ZAP_tblPathologyOrgans AS o
    JOIN legacy.IdCrosswalk AS cx ON cx.SourceSystem = N'ZAPHOD' AND cx.SourceTable = N'tblPathologyHeaders' AND cx.SourceKey = UPPER(LTRIM(RTRIM(o.PHLNbr)))
    WHERE cx.TargetId IN (SELECT PathologyCaseId FROM #Sig)
      AND NOT EXISTS (SELECT 1 FROM #T AS t WHERE t.PathologyOrganID = CAST(o.PathologyOrganID AS int));

    CREATE TABLE #MapT (PathologyOrganID int NOT NULL, PathologyTissueId int NOT NULL);
    MERGE path.PathologyTissue AS tgt
    USING (SELECT t.*, COALESCE(CASE WHEN m.TargetValue IN (N'PENDING', N'NSL', N'LESIONS', N'NOT_EXAMINED', N'NOT_PRESENT') THEN m.TargetValue END,
                                CASE WHEN t.HasDiagnoses = 1 THEN N'LESIONS' ELSE N'PENDING' END) AS Result
           FROM #T AS t LEFT JOIN legacy.MapValue AS m ON m.MapName = N'TISSUE_RESULT' AND m.SourceValue = t.Finding) AS s ON 1 = 0
    WHEN NOT MATCHED THEN
        INSERT (PathologyCaseId, Sequence, OrganCode, BlockCode, NecropsyOrganId, Result, Comment, RecutRequested)
        VALUES (s.PathologyCaseId, s.Seq, s.OrganCode, s.BlockCode, s.NecropsyOrganId, s.Result, s.Comment, 0)
    OUTPUT s.PathologyOrganID, inserted.PathologyTissueId INTO #MapT (PathologyOrganID, PathologyTissueId);
    SET @cTissue = @@ROWCOUNT;

    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT N'ZAPHOD', N'tblPathologyOrgans', CAST(PathologyOrganID AS nvarchar(20)), N'path.PathologyTissue', PathologyTissueId, @run FROM #MapT;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT DISTINCT @run, N'ZAPHOD', N'tblPathologyOrgans', t.Finding, N'REVIEW', N'TISSUE_FINDING_TEXT_UNMAPPED',
           N'Pathology organ Finding text has no entry in legacy.MapValue (TISSUE_RESULT); result set from whether diagnoses exist.'
    FROM #T AS t WHERE t.Finding IS NOT NULL AND NOT EXISTS (SELECT 1 FROM legacy.MapValue AS m WHERE m.MapName = N'TISSUE_RESULT' AND m.SourceValue = t.Finding);

    /* ---- diagnoses ---- */
    SELECT q.*, CASE WHEN q.NeoplasmMap = N'NONE' THEN CAST(0 AS bit) WHEN q.NeoplasmMap IS NOT NULL THEN CAST(1 AS bit) ELSE q.RefIsNeoplasm END AS IsNeoplasm
    INTO #D
    FROM (
        SELECT CAST(d.PathologyDiagnosisID AS int) AS PathologyDiagnosisID, tx.TargetId AS PathologyTissueId, dx.TargetId AS DiagnosisId, rd.Term AS RefTerm, rd.IsNeoplasm AS RefIsNeoplasm,
               NULLIF(LTRIM(RTRIM(ne.Neoplasm)), N'') AS NeoplasmText,
               CASE WHEN nm.TargetValue IN (N'NONE', N'BENIGN', N'MALIGNANT', N'UNCERTAIN', N'BENIGN|PRIMARY', N'BENIGN|METASTATIC', N'MALIGNANT|PRIMARY', N'MALIGNANT|METASTATIC', N'UNCERTAIN|PRIMARY', N'UNCERTAIN|METASTATIC') THEN nm.TargetValue END AS NeoplasmMap,
               NULLIF(LTRIM(RTRIM(sv.Severity)), N'') AS SeverityText, CASE WHEN svm.TargetValue IN (N'1', N'2', N'3', N'4', N'5', N'P') THEN svm.TargetValue END AS SeverityMap,
               LEFT(NULLIF(LTRIM(RTRIM(ds.Distribution)), N''), 30) AS Distribution,
               LEFT(COALESCE(lm.TargetValue, NULLIF(LTRIM(RTRIM(po.PairedOrgans)), N'')), 20) AS Laterality,
               ROW_NUMBER() OVER (PARTITION BY tx.TargetId ORDER BY d.PathologyDiagnosisID) AS Seq
        FROM stage.ZAP_tblPathologyDiagnoses AS d
        JOIN legacy.IdCrosswalk AS tx ON tx.SourceSystem = N'ZAPHOD' AND tx.SourceTable = N'tblPathologyOrgans' AND tx.SourceKey = CAST(d.PathologyOrganID AS nvarchar(20))
        JOIN legacy.IdCrosswalk AS dx ON dx.SourceSystem = N'ZAPHOD' AND dx.SourceTable = N'tblDiagnosis' AND dx.SourceKey = CAST(d.DiagnosisID AS nvarchar(20))
        JOIN ref.Diagnosis AS rd ON rd.DiagnosisId = dx.TargetId
        LEFT JOIN stage.ZAP_tblNeoplasm AS ne ON ne.NeoplasmID = d.NeoplasmID
        LEFT JOIN legacy.MapValue AS nm ON nm.MapName = N'NEOPLASM' AND nm.SourceValue = LTRIM(RTRIM(ne.Neoplasm))
        LEFT JOIN stage.ZAP_tblSeverity AS sv ON sv.SeverityID = d.SeverityID
        LEFT JOIN legacy.MapValue AS svm ON svm.MapName = N'SEVERITY' AND svm.SourceValue = LTRIM(RTRIM(sv.Severity))
        LEFT JOIN stage.ZAP_tblDistribution AS ds ON ds.DistributionID = d.DistributionID
        LEFT JOIN stage.ZAP_tblPairedOrgans AS po ON po.PairedOrgansID = d.PairedOrgansID
        LEFT JOIN legacy.MapValue AS lm ON lm.MapName = N'LATERALITY' AND lm.SourceValue = LTRIM(RTRIM(po.PairedOrgans))
        WHERE tx.TargetId IN (SELECT PathologyTissueId FROM #MapT)
          AND NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblPathologyDiagnoses' AND x.SourceKey = CAST(d.PathologyDiagnosisID AS nvarchar(20)))
    ) AS q;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblPathologyDiagnoses', CAST(d.PathologyDiagnosisID AS nvarchar(20)), N'SKIPPED', N'PATHOLOGY_DIAGNOSIS_NOT_LOADED',
           N'The diagnosis id has no loaded term (blank text in tblDiagnosis, or not in it). The case cannot be signed in 235 until this is resolved.'
    FROM stage.ZAP_tblPathologyDiagnoses AS d
    JOIN legacy.IdCrosswalk AS tx ON tx.SourceSystem = N'ZAPHOD' AND tx.SourceTable = N'tblPathologyOrgans' AND tx.SourceKey = CAST(d.PathologyOrganID AS nvarchar(20))
    WHERE tx.TargetId IN (SELECT PathologyTissueId FROM #MapT)
      AND NOT EXISTS (SELECT 1 FROM #D AS x WHERE x.PathologyDiagnosisID = CAST(d.PathologyDiagnosisID AS int))
      AND NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS c WHERE c.SourceSystem = N'ZAPHOD' AND c.SourceTable = N'tblPathologyDiagnoses' AND c.SourceKey = CAST(d.PathologyDiagnosisID AS nvarchar(20)));

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT DISTINCT @run, N'ZAPHOD', N'tblNeoplasm', NeoplasmText, N'REVIEW', N'NEOPLASM_TEXT_UNMAPPED', N'Add a row to legacy.MapValue (NEOPLASM) as BEHAVIOR|ORIGIN, or NONE. Affected diagnoses use the dictionary default.'
    FROM #D WHERE NeoplasmText IS NOT NULL AND NeoplasmMap IS NULL
    UNION
    SELECT DISTINCT @run, N'ZAPHOD', N'tblSeverity', SeverityText, N'REVIEW', N'SEVERITY_TEXT_UNMAPPED', N'Add a row to legacy.MapValue (SEVERITY) with 1-5 or P.'
    FROM #D WHERE SeverityText IS NOT NULL AND SeverityMap IS NULL AND IsNeoplasm = 0;

    CREATE TABLE #MapD (PathologyDiagnosisID int NOT NULL, DiagnosisEntryId int NOT NULL);
    MERGE path.PathologyDiagnosis AS tgt
    USING #D AS s ON 1 = 0
    WHEN NOT MATCHED THEN
        INSERT (PathologyTissueId, Sequence, DiagnosisId, Term, IsNeoplasm, Distribution, Laterality, Severity, Behavior, Origin)
        VALUES (s.PathologyTissueId, s.Seq, s.DiagnosisId, s.RefTerm, s.IsNeoplasm, s.Distribution, s.Laterality,
                CASE WHEN s.IsNeoplasm = 0 THEN LEFT(s.SeverityMap, 1) END,
                CASE WHEN s.IsNeoplasm = 1 THEN LEFT(s.NeoplasmMap, CHARINDEX(N'|', s.NeoplasmMap + N'|') - 1) END,
                CASE WHEN s.IsNeoplasm = 1 AND CHARINDEX(N'|', s.NeoplasmMap) > 0 THEN SUBSTRING(s.NeoplasmMap, CHARINDEX(N'|', s.NeoplasmMap) + 1, 10) END)
    OUTPUT s.PathologyDiagnosisID, inserted.DiagnosisEntryId INTO #MapD (PathologyDiagnosisID, DiagnosisEntryId);
    SET @cDiag = @@ROWCOUNT;

    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT N'ZAPHOD', N'tblPathologyDiagnoses', CAST(PathologyDiagnosisID AS nvarchar(20)), N'path.PathologyDiagnosis', DiagnosisEntryId, @run FROM #MapD;

    /* ---- gross-to-micro correlation (Zaphod links a PATHOLOGY finding, which is a copy of a necropsy finding) ---- */
    SELECT dd.DiagnosisEntryId, nf.TargetId AS NecropsyFindingId, cr.PathologyDiagnosisID,
           ROW_NUMBER() OVER (PARTITION BY nf.TargetId ORDER BY cr.PathologyDiagnosisID) AS rn
    INTO #Corr
    FROM stage.ZAP_tblPathologyCorrelation AS cr
    JOIN stage.ZAP_tblPathologyFindings AS pf ON pf.PathologyFindingID = cr.PathologyFindingId
    JOIN legacy.IdCrosswalk AS dx ON dx.SourceSystem = N'ZAPHOD' AND dx.SourceTable = N'tblPathologyDiagnoses' AND dx.SourceKey = CAST(cr.PathologyDiagnosisID AS nvarchar(20))
    JOIN path.PathologyDiagnosis AS dd ON dd.DiagnosisEntryId = dx.TargetId
    JOIN legacy.IdCrosswalk AS nf ON nf.SourceSystem = N'ZAPHOD' AND nf.SourceTable = N'tblNecropsyFindings' AND nf.SourceKey = CAST(pf.NecropsyFindingID AS nvarchar(20))
    WHERE dd.DiagnosisEntryId IN (SELECT DiagnosisEntryId FROM #MapD)
      AND NOT EXISTS (SELECT 1 FROM path.PathologyCorrelation AS e WHERE e.NecropsyFindingId = nf.TargetId);

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblPathologyCorrelation', CAST(PathologyDiagnosisID AS nvarchar(20)), N'SKIPPED', N'CORRELATION_DUPLICATE_FINDING',
           N'The finding is already correlated with another diagnosis (the new schema allows one); the lowest diagnosis id was kept.'
    FROM #Corr WHERE rn > 1;

    INSERT INTO path.PathologyCorrelation (DiagnosisEntryId, NecropsyFindingId)
    SELECT DiagnosisEntryId, NecropsyFindingId FROM #Corr WHERE rn = 1;
    SET @cCorr = @@ROWCOUNT;
    DROP TABLE #Corr;

    -- correlations with a diagnosis or finding that was not loaded
    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblPathologyCorrelation', CAST(cr.PathologyDiagnosisID AS nvarchar(20)), N'SKIPPED', N'CORRELATION_NOT_LOADED',
           N'The correlated diagnosis or necropsy finding was not loaded.'
    FROM stage.ZAP_tblPathologyCorrelation AS cr
    WHERE EXISTS (SELECT 1 FROM #Sig)                                    -- only meaningful when cases were loaded in this run
      AND (NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS dx WHERE dx.SourceSystem = N'ZAPHOD' AND dx.SourceTable = N'tblPathologyDiagnoses' AND dx.SourceKey = CAST(cr.PathologyDiagnosisID AS nvarchar(20)))
           OR NOT EXISTS (SELECT 1 FROM stage.ZAP_tblPathologyFindings AS pf JOIN legacy.IdCrosswalk AS nf ON nf.SourceSystem = N'ZAPHOD' AND nf.SourceTable = N'tblNecropsyFindings' AND nf.SourceKey = CAST(pf.NecropsyFindingID AS nvarchar(20))
                          WHERE pf.PathologyFindingID = cr.PathologyFindingId));

    /* ---- cause of death: link only when the case has that diagnosis in that organ (organ matched by name) ---- */
    UPDATE pc SET CauseOfDeathKind = N'DIAGNOSIS', CauseOfDeathDiagnosisEntryId = hit.DiagnosisEntryId
    FROM path.PathologyCase AS pc
    JOIN #Sig AS sg ON sg.PathologyCaseId = pc.PathologyCaseId
    CROSS APPLY (SELECT TOP (1) d.DiagnosisEntryId
                 FROM path.PathologyDiagnosis AS d
                 JOIN path.PathologyTissue AS t ON t.PathologyTissueId = d.PathologyTissueId
                 WHERE t.PathologyCaseId = pc.PathologyCaseId
                   AND t.OrganCode = (SELECT LEFT(NULLIF(LTRIM(RTRIM(zo.Organ)), N''), 40) FROM stage.ZAP_tblOrgans AS zo WHERE zo.OrganID = sg.CODOrganID)
                   AND EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblDiagnosis'
                                 AND x.SourceKey = CAST(sg.CauseOfDeathID AS nvarchar(20)) AND x.TargetId = d.DiagnosisId)
                 ORDER BY d.DiagnosisEntryId) AS hit
    WHERE sg.CauseOfDeathID IS NOT NULL AND sg.CODOrganID IS NOT NULL;
    SET @cCod = @@ROWCOUNT;

    -- text longer than the new columns allow is cut; say how much
    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', t.Tbl, N'CORRECTED', N'TEXT_TRUNCATED', CONCAT(t.N, N' values of ', t.Col, N' are longer than ', t.Lim, N' characters and were cut. The full text stays in the stage table.')
    FROM (SELECT N'tblPathologyHeaders' AS Tbl, N'Comments' AS Col, 4000 AS Lim, COUNT(*) AS N FROM stage.ZAP_tblPathologyHeaders WHERE LEN(Comments) > 4000
          UNION ALL SELECT N'tblPathologyHeaders', N'CODComments', 300, COUNT(*) FROM stage.ZAP_tblPathologyHeaders WHERE LEN(CODComments) > 300
          UNION ALL SELECT N'tblPathologyOrgans', N'Comments', 500, COUNT(*) FROM stage.ZAP_tblPathologyOrgans WHERE LEN(Comments) > 500) AS t
    WHERE t.N > 0;
    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, Severity, IssueCode, Detail)
    VALUES (@run, N'ZAPHOD', N'tblPathologyDiagnoses', N'INFO', N'PATHOLOGY_FIELDS_NOT_CARRIED',
            N'Zaphod fields with no column in the new schema were not loaded: diagnosis HN code and quantity/observations, tissue Code. They stay in the stage tables.');

    COMMIT TRANSACTION;
    DROP TABLE IF EXISTS #P, #T, #MapT, #D, #MapD, #Sig, #Corr;

    UPDATE legacy.LoadRun SET Status = N'SUCCEEDED', FinishedAt = sysutcdatetime(),
           RowCountsJson = CONCAT(N'{"cases":', @cCase, N',"tissues":', @cTissue, N',"diagnoses":', @cDiag, N',"correlations":', @cCorr, N',"causeOfDeathLinked":', @cCod, N'}')
     WHERE LoadRunId = @run;
    PRINT CONCAT(N'230_load_zaphod_pathology done. Cases ', @cCase, N' (all DRAFT; run 235 to sign), tissues ', @cTissue, N', diagnoses ', @cDiag, N', correlations ', @cCorr);
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    UPDATE legacy.LoadRun SET Status = N'FAILED', FinishedAt = sysutcdatetime(), Notes = LEFT(CONCAT(Notes, N': ', ERROR_MESSAGE()), 4000) WHERE LoadRunId = @run;
    THROW;
END CATCH
GO
