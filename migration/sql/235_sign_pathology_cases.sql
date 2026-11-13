/* =============================================================================
   MHL LIMS migration  -  235_sign_pathology_cases.sql   (Zaphod side)
   Signs out migrated pathology cases that Zaphod itself had completed. Signed cases are locked (triggers) and get a
   frozen path.PathologyReportVersion, so this step is deliberately conservative and can be run again after problems
   have been fixed. A case is signed only when ALL of these hold:
     1. Zaphod's PathologyComplete flag is set for the animal;
     2. Zaphod recorded a completion date (tblPathologyHeaders.DateCompleted);
     3. everything loaded: tissue, diagnosis and correlation counts equal the Zaphod counts, no tissue is still
        PENDING, no diagnosis has a neoplasm or severity word that legacy.MapValue could not translate, a cause of
        death that Zaphod recorded is linked, the case has at least one tissue, and the completion date is
        plausible (1990 or later, not in the future).
   Whatever Zaphod did not record is NOT invented:
     * Signed by = the LEGACY\MIGRATION user (Zaphod keeps no signer per case); the study's pathologist stays on the
       case as its pathologist. The report snapshot says so ("signerBasis").
     * Signed at = Zaphod's DateCompleted.
   Cases that are complete in Zaphod but blocked are listed in legacy.LoadIssue as SIGN_BLOCKED, with the reasons.
   The frozen report is a reconstructed snapshot (format "migrated-from-zaphod-v1"), not the original printed report.
   Needs: 230_load_zaphod_pathology.sql.
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

DECLARE @run int;
DECLARE @cSigned int = 0, @cBlocked int = 0;
INSERT INTO legacy.LoadRun (SourceSystem, Notes) VALUES (N'ZAPHOD', N'235_sign_pathology_cases.sql');
SET @run = SCOPE_IDENTITY();

BEGIN TRY
    DROP TABLE IF EXISTS #C;
    BEGIN TRANSACTION;

    DECLARE @mig int = (SELECT UserId FROM sec.AppUser WHERE AdAccount = N'LEGACY\MIGRATION');
    IF @mig IS NULL THROW 50901, N'Run 000_support.sql first (migration user missing).', 1;

    -- these issues describe the current state, so earlier rows are replaced
    DELETE FROM legacy.LoadIssue WHERE SourceSystem = N'ZAPHOD' AND IssueCode = N'SIGN_BLOCKED';

    SELECT x.PathologyCaseId, x.PhlNo, x.CompletedAt, x.ZaphodComplete,
           x.StageTissues, x.LoadedTissues, x.StageDiagnoses, x.LoadedDiagnoses, x.StageCorrelations, x.LoadedCorrelations, x.CodUnlinked, x.PendingTissues, x.UnmappedDiagnoses,
           CAST(CASE WHEN x.ZaphodComplete = 1 AND x.CompletedAt IS NOT NULL
                      AND x.StageTissues = x.LoadedTissues AND x.LoadedTissues > 0 AND x.StageDiagnoses = x.LoadedDiagnoses
                      AND x.StageCorrelations = x.LoadedCorrelations AND x.CodUnlinked = 0
                      AND x.PendingTissues = 0 AND x.UnmappedDiagnoses = 0 THEN 1 ELSE 0 END AS bit) AS Eligible
    INTO #C
    FROM (
        SELECT pc.PathologyCaseId, cx.SourceKey AS PhlNo,
               CASE WHEN h.DateCompleted >= '1990-01-01' AND h.DateCompleted <= SYSDATETIME() THEN CAST(h.DateCompleted AS datetime2(0)) END AS CompletedAt,
               COALESCE(an.PathologyComplete, 0) AS ZaphodComplete,
               (SELECT COUNT(*) FROM stage.ZAP_tblPathologyOrgans AS o WHERE UPPER(LTRIM(RTRIM(o.PHLNbr))) = cx.SourceKey) AS StageTissues,
               (SELECT COUNT(*) FROM path.PathologyTissue AS t WHERE t.PathologyCaseId = pc.PathologyCaseId) AS LoadedTissues,
               (SELECT COUNT(*) FROM stage.ZAP_tblPathologyOrgans AS o JOIN stage.ZAP_tblPathologyDiagnoses AS d ON d.PathologyOrganID = o.PathologyOrganID
                 WHERE UPPER(LTRIM(RTRIM(o.PHLNbr))) = cx.SourceKey) AS StageDiagnoses,
               (SELECT COUNT(*) FROM path.PathologyDiagnosis AS d JOIN path.PathologyTissue AS t ON t.PathologyTissueId = d.PathologyTissueId WHERE t.PathologyCaseId = pc.PathologyCaseId) AS LoadedDiagnoses,
               (SELECT COUNT(*) FROM stage.ZAP_tblPathologyOrgans AS o JOIN stage.ZAP_tblPathologyDiagnoses AS d ON d.PathologyOrganID = o.PathologyOrganID
                  JOIN stage.ZAP_tblPathologyCorrelation AS cr ON cr.PathologyDiagnosisID = d.PathologyDiagnosisID
                 WHERE UPPER(LTRIM(RTRIM(o.PHLNbr))) = cx.SourceKey) AS StageCorrelations,
               (SELECT COUNT(*) FROM path.PathologyCorrelation AS c2 JOIN path.PathologyDiagnosis AS d2 ON d2.DiagnosisEntryId = c2.DiagnosisEntryId
                  JOIN path.PathologyTissue AS t2 ON t2.PathologyTissueId = d2.PathologyTissueId WHERE t2.PathologyCaseId = pc.PathologyCaseId) AS LoadedCorrelations,
               CAST(CASE WHEN h.CauseOfDeathID IS NOT NULL AND pc.CauseOfDeathDiagnosisEntryId IS NULL THEN 1 ELSE 0 END AS bit) AS CodUnlinked,
               (SELECT COUNT(*) FROM path.PathologyTissue AS t WHERE t.PathologyCaseId = pc.PathologyCaseId AND t.Result = N'PENDING') AS PendingTissues,
               (SELECT COUNT(*)
                FROM stage.ZAP_tblPathologyOrgans AS o
                JOIN stage.ZAP_tblPathologyDiagnoses AS d ON d.PathologyOrganID = o.PathologyOrganID
                JOIN legacy.IdCrosswalk AS dc ON dc.SourceSystem = N'ZAPHOD' AND dc.SourceTable = N'tblPathologyDiagnoses' AND dc.SourceKey = CAST(d.PathologyDiagnosisID AS nvarchar(20))
                JOIN path.PathologyDiagnosis AS p ON p.DiagnosisEntryId = dc.TargetId
                LEFT JOIN stage.ZAP_tblNeoplasm AS ne ON ne.NeoplasmID = d.NeoplasmID
                LEFT JOIN legacy.MapValue AS nm ON nm.MapName = N'NEOPLASM' AND nm.SourceValue = LTRIM(RTRIM(ne.Neoplasm))
                LEFT JOIN stage.ZAP_tblSeverity AS sv ON sv.SeverityID = d.SeverityID
                LEFT JOIN legacy.MapValue AS sm ON sm.MapName = N'SEVERITY' AND sm.SourceValue = LTRIM(RTRIM(sv.Severity))
                WHERE UPPER(LTRIM(RTRIM(o.PHLNbr))) = cx.SourceKey
                  AND ((NULLIF(LTRIM(RTRIM(ne.Neoplasm)), N'') IS NOT NULL AND nm.TargetValue IS NULL)
                       OR (p.IsNeoplasm = 0 AND NULLIF(LTRIM(RTRIM(sv.Severity)), N'') IS NOT NULL AND sm.TargetValue IS NULL))) AS UnmappedDiagnoses
        FROM path.PathologyCase AS pc
        JOIN legacy.IdCrosswalk AS cx ON cx.SourceSystem = N'ZAPHOD' AND cx.SourceTable = N'tblPathologyHeaders' AND cx.TargetId = pc.PathologyCaseId
        JOIN (SELECT hh.*, ROW_NUMBER() OVER (PARTITION BY UPPER(LTRIM(RTRIM(hh.PHLNbr))) ORDER BY hh.DateUpdated DESC, hh.PHLNbr) AS rn
              FROM stage.ZAP_tblPathologyHeaders AS hh) AS h ON UPPER(LTRIM(RTRIM(h.PHLNbr))) = cx.SourceKey AND h.rn = 1
        LEFT JOIN (SELECT UPPER(LTRIM(RTRIM(PHLNbr))) AS PhlNo, MAX(CASE WHEN legacy.fnBit(PathologyComplete) = 1 THEN 1 ELSE 0 END) AS PathologyComplete
                   FROM stage.ZAP_tblAnimals GROUP BY UPPER(LTRIM(RTRIM(PHLNbr)))) AS an ON an.PhlNo = cx.SourceKey
        WHERE pc.Status = N'DRAFT'
    ) AS x
    WHERE x.ZaphodComplete = 1;      -- only cases Zaphod itself had completed are candidates

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblPathologyHeaders', c.PhlNo, N'REVIEW', N'SIGN_BLOCKED',
           CONCAT_WS(N'; ',
                     CASE WHEN c.CompletedAt IS NULL THEN N'Zaphod has no usable completion date (missing, before 1990, or in the future)' END,
                     CASE WHEN c.LoadedTissues = 0 THEN N'no tissues loaded' END,
                     CASE WHEN c.StageTissues <> c.LoadedTissues THEN CONCAT(N'tissues loaded ', c.LoadedTissues, N' of ', c.StageTissues) END,
                     CASE WHEN c.StageDiagnoses <> c.LoadedDiagnoses THEN CONCAT(N'diagnoses loaded ', c.LoadedDiagnoses, N' of ', c.StageDiagnoses) END,
                     CASE WHEN c.StageCorrelations <> c.LoadedCorrelations THEN CONCAT(N'correlations loaded ', c.LoadedCorrelations, N' of ', c.StageCorrelations) END,
                     CASE WHEN c.CodUnlinked = 1 THEN N'cause of death recorded in Zaphod but not linked to a diagnosis' END,
                     CASE WHEN c.PendingTissues > 0 THEN CONCAT(c.PendingTissues, N' tissue(s) still PENDING (finding text not mapped?)') END,
                     CASE WHEN c.UnmappedDiagnoses > 0 THEN CONCAT(c.UnmappedDiagnoses, N' diagnosis(es) with an unmapped neoplasm or severity word') END)
    FROM #C AS c WHERE c.Eligible = 0;
    SET @cBlocked = @@ROWCOUNT;

    -- frozen report snapshot, then the status change (children first: signed cases are locked by triggers)
    INSERT INTO path.PathologyReportVersion (PathologyCaseId, Version, SignedByUserId, SignedAt, ReportJson)
    SELECT c.PathologyCaseId, pc.Version, @mig, c.CompletedAt,
           (SELECT N'migrated-from-zaphod-v1' AS [format],
                   N'LEGACY\MIGRATION; Zaphod does not record who signed each case' AS signerBasis,
                   CONVERT(nvarchar(30), c.CompletedAt, 126) AS completedInZaphodAt,
                   su.PhlNumber AS phlNumber, st.ZapNumber AS zapNumber, pu.DisplayName AS studyPathologist,
                   pc.PathologistComment AS pathologistComment, pc.CauseOfDeathComment AS causeOfDeathComment,
                   (SELECT t.OrganCode AS organ, t.BlockCode AS block, t.Result AS result, t.Comment AS comment,
                           (SELECT d.Term AS term, d.IsNeoplasm AS isNeoplasm, d.Severity AS severity, d.Behavior AS behavior, d.Origin AS origin,
                                   d.Distribution AS distribution, d.Laterality AS laterality
                            FROM path.PathologyDiagnosis AS d WHERE d.PathologyTissueId = t.PathologyTissueId ORDER BY d.Sequence FOR JSON PATH) AS diagnoses
                    FROM path.PathologyTissue AS t WHERE t.PathologyCaseId = pc.PathologyCaseId ORDER BY t.Sequence FOR JSON PATH) AS tissues
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
    FROM #C AS c
    JOIN path.PathologyCase AS pc ON pc.PathologyCaseId = c.PathologyCaseId
    JOIN lims.Subject AS su ON su.SubjectId = pc.SubjectId
    LEFT JOIN lims.Study AS st ON st.StudyId = su.StudyId
    LEFT JOIN sec.AppUser AS pu ON pu.UserId = pc.PathologistUserId
    WHERE c.Eligible = 1
      AND NOT EXISTS (SELECT 1 FROM path.PathologyReportVersion AS v WHERE v.PathologyCaseId = c.PathologyCaseId AND v.Version = pc.Version);

    UPDATE pc SET Status = N'SIGNED', SignedByUserId = @mig, SignedAt = c.CompletedAt
    FROM path.PathologyCase AS pc
    JOIN #C AS c ON c.PathologyCaseId = pc.PathologyCaseId
    WHERE c.Eligible = 1 AND pc.Status = N'DRAFT';
    SET @cSigned = @@ROWCOUNT;

    COMMIT TRANSACTION;
    DROP TABLE IF EXISTS #C;

    UPDATE legacy.LoadRun SET Status = N'SUCCEEDED', FinishedAt = sysutcdatetime(),
           RowCountsJson = CONCAT(N'{"signed":', @cSigned, N',"blocked":', @cBlocked, N'}')
     WHERE LoadRunId = @run;
    PRINT CONCAT(N'235_sign_pathology_cases done. Signed ', @cSigned, N', blocked ', @cBlocked, N' (see legacy.LoadIssue, IssueCode SIGN_BLOCKED)');
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    UPDATE legacy.LoadRun SET Status = N'FAILED', FinishedAt = sysutcdatetime(), Notes = LEFT(CONCAT(Notes, N': ', ERROR_MESSAGE()), 4000) WHERE LoadRunId = @run;
    THROW;
END CATCH
GO
