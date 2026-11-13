/* =============================================================================
   MHL LIMS migration  -  200_load_zaphod_dictionaries.sql   (Zaphod side)
   Zaphod's organs, diagnoses, small dictionaries and necropsy protocols -> ref.* and path.NecropsyProtocol*.
     * ref.Organ: the organ NAME is the code. Existing rows with the same name keep their data and get
       LegacyZaphodOrganId filled in.
     * ref.Diagnosis: Zaphod lists diagnoses per organ (the same term can exist for several organs), the new
       dictionary has one row per term, linked to its organs through ref.DiagnosisOrgan. IsNeoplasm is taken from
       Zaphod's Code column, where N is read as "neoplasm" (open questions 21 and 28 - confirm with a pathologist).
     * Small dictionaries (sites, morphology, shape, color, consistency, fate, condition, distribution,
       laterality): terms are added if missing, never changed.
     * Trim protocols and the extra columns of necropsy protocol steps (fixative, freeze, measure organ) have no
       table in the new schema yet; they stay in the stage tables.
   Needs: 100_load_reference.sql, Zaphod stage tables.
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

DECLARE @run int;
DECLARE @cOrgan int = 0, @cDiag int = 0, @cDiagOrgan int = 0, @cTerm int = 0, @cProt int = 0, @cStep int = 0;
INSERT INTO legacy.LoadRun (SourceSystem, Notes) VALUES (N'ZAPHOD', N'200_load_zaphod_dictionaries.sql');
SET @run = SCOPE_IDENTITY();

BEGIN TRY
    BEGIN TRANSACTION;

    /* ---- organs ---- */
    UPDATE o SET LegacyZaphodOrganId = z.OrganID
    FROM ref.Organ AS o
    JOIN (SELECT LEFT(NULLIF(LTRIM(RTRIM(Organ)), N''), 40) AS Name, MIN(CAST(OrganID AS int)) AS OrganID FROM stage.ZAP_tblOrgans GROUP BY LEFT(NULLIF(LTRIM(RTRIM(Organ)), N''), 40)) AS z
      ON z.Name = o.OrganCode
    WHERE o.LegacyZaphodOrganId IS NULL;

    INSERT INTO ref.Organ (OrganCode, IsPaired, SortOrder, LegacyZaphodOrganId, IsActive)
    SELECT z.Name, 0, 0, z.OrganID, 1                       -- IsPaired unknown: set from the paired-organ list in the admin screen
    FROM (SELECT LEFT(NULLIF(LTRIM(RTRIM(Organ)), N''), 40) AS Name, MIN(CAST(OrganID AS int)) AS OrganID
          FROM stage.ZAP_tblOrgans GROUP BY LEFT(NULLIF(LTRIM(RTRIM(Organ)), N''), 40)) AS z
    WHERE z.Name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ref.Organ AS o WHERE o.OrganCode = z.Name);
    SET @cOrgan = @@ROWCOUNT;

    /* ---- diagnoses: one per term; organs through ref.DiagnosisOrgan ---- */
    INSERT INTO ref.Diagnosis (Term, IsNeoplasm, IsGeneral, LegacyZaphodDiagnosisId, IsActive)
    SELECT t.Term,
           CASE WHEN MAX(CASE WHEN UPPER(t.Code) = N'N' THEN 1 ELSE 0 END) = 1 THEN 1 ELSE 0 END,
           0, MIN(t.DiagnosisId), 1
    FROM (SELECT LEFT(NULLIF(LTRIM(RTRIM(Diagnosis)), N''), 120) AS Term, NULLIF(LTRIM(RTRIM(Code)), N'') AS Code, CAST(DiagnosisID AS int) AS DiagnosisId
          FROM stage.ZAP_tblDiagnosis) AS t
    WHERE t.Term IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ref.Diagnosis AS d WHERE d.Term = t.Term)
    GROUP BY t.Term;
    SET @cDiag = @@ROWCOUNT;

    -- terms that were already in ref.Diagnosis (for example the starter dictionary) get their Zaphod id too
    UPDATE d SET LegacyZaphodDiagnosisId = z.MinId
    FROM ref.Diagnosis AS d
    JOIN (SELECT LEFT(NULLIF(LTRIM(RTRIM(Diagnosis)), N''), 120) AS Term, MIN(CAST(DiagnosisID AS int)) AS MinId
          FROM stage.ZAP_tblDiagnosis GROUP BY LEFT(NULLIF(LTRIM(RTRIM(Diagnosis)), N''), 120)) AS z ON z.Term = d.Term
    WHERE d.LegacyZaphodDiagnosisId IS NULL;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblDiagnosis', CAST(DiagnosisID AS nvarchar(20)), N'SKIPPED', N'DIAGNOSIS_BLANK_TERM',
           N'Zaphod diagnosis with no text; not loaded. Any pathology diagnosis that uses it will be reported as not loaded.'
    FROM stage.ZAP_tblDiagnosis WHERE NULLIF(LTRIM(RTRIM(Diagnosis)), N'') IS NULL;

    -- one Zaphod diagnosis id -> one ref.Diagnosis
    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT N'ZAPHOD', N'tblDiagnosis', CAST(z.DiagnosisID AS nvarchar(20)), N'ref.Diagnosis', d.DiagnosisId, @run
    FROM stage.ZAP_tblDiagnosis AS z
    JOIN ref.Diagnosis AS d ON d.Term = LEFT(NULLIF(LTRIM(RTRIM(z.Diagnosis)), N''), 120)
    WHERE NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblDiagnosis' AND x.SourceKey = CAST(z.DiagnosisID AS nvarchar(20)));

    INSERT INTO ref.DiagnosisOrgan (DiagnosisId, OrganCode)
    SELECT DISTINCT d.DiagnosisId, o.OrganCode
    FROM stage.ZAP_tblDiagnosis AS z
    JOIN ref.Diagnosis AS d ON d.Term = LEFT(NULLIF(LTRIM(RTRIM(z.Diagnosis)), N''), 120)
    JOIN stage.ZAP_tblOrgans AS zo ON zo.OrganID = z.OrganID
    JOIN ref.Organ AS o ON o.OrganCode = LEFT(NULLIF(LTRIM(RTRIM(zo.Organ)), N''), 40)
    WHERE NOT EXISTS (SELECT 1 FROM ref.DiagnosisOrgan AS x WHERE x.DiagnosisId = d.DiagnosisId AND x.OrganCode = o.OrganCode);
    SET @cDiagOrgan = @@ROWCOUNT;

    /* ---- small dictionaries ---- */
    INSERT INTO ref.DictionaryTerm (DictionaryCode, Term, SortOrder, IsActive)
    SELECT s.DictionaryCode, s.Term, 0, 1
    FROM (
        SELECT N'NECROPSY_SITE' AS DictionaryCode, LEFT(NULLIF(LTRIM(RTRIM([Site])), N''), 60) AS Term FROM stage.ZAP_tblSite
        UNION SELECT N'MORPHOLOGY',   LEFT(NULLIF(LTRIM(RTRIM(Morphology)), N''), 60)   FROM stage.ZAP_tblMorphology
        UNION SELECT N'SHAPE',        LEFT(NULLIF(LTRIM(RTRIM(Shape)), N''), 60)        FROM stage.ZAP_tblShape
        UNION SELECT N'COLOR',        LEFT(NULLIF(LTRIM(RTRIM(Color)), N''), 60)        FROM stage.ZAP_tblColor
        UNION SELECT N'CONSISTENCY',  LEFT(NULLIF(LTRIM(RTRIM(Consistency)), N''), 60)  FROM stage.ZAP_tblConsistency
        UNION SELECT N'FATE',         LEFT(NULLIF(LTRIM(RTRIM(Fate)), N''), 60)         FROM stage.ZAP_tblFate
        UNION SELECT N'CONDITION',    LEFT(NULLIF(LTRIM(RTRIM([Condition])), N''), 60)  FROM stage.ZAP_tblCondition
        UNION SELECT N'DISTRIBUTION', LEFT(NULLIF(LTRIM(RTRIM(Distribution)), N''), 60) FROM stage.ZAP_tblDistribution
        UNION SELECT N'LATERALITY',   LEFT(NULLIF(LTRIM(RTRIM(PairedOrgans)), N''), 60) FROM stage.ZAP_tblPairedOrgans
    ) AS s
    WHERE s.Term IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ref.DictionaryTerm AS d WHERE d.DictionaryCode = s.DictionaryCode AND d.Term = s.Term);
    SET @cTerm = @@ROWCOUNT;

    /* ---- necropsy protocols ---- */
    UPDATE p SET LegacyZaphodProtocolId = z.ProtocolId
    FROM path.NecropsyProtocol AS p
    JOIN (SELECT LEFT(LTRIM(RTRIM(ProtocolName)), 100) AS Name, MIN(CAST(ProtocolID AS int)) AS ProtocolId
          FROM stage.ZAP_tblNecropsyProtocols WHERE NULLIF(LTRIM(RTRIM(ProtocolName)), N'') IS NOT NULL GROUP BY LEFT(LTRIM(RTRIM(ProtocolName)), 100)) AS z
      ON z.Name = p.Name
    WHERE p.LegacyZaphodProtocolId IS NULL;

    INSERT INTO path.NecropsyProtocol (Name, WeighAnimal, Instructions, IsApproved, IsActive, LegacyZaphodProtocolId)
    SELECT LEFT(LTRIM(RTRIM(z.ProtocolName)), 100),
           COALESCE(legacy.fnBit(z.WeighAnimal), 1),
           LEFT(NULLIF(CONCAT(LTRIM(RTRIM(z.GeneralInstructions)), CASE WHEN NULLIF(LTRIM(RTRIM(z.Description)), N'') IS NOT NULL THEN CONCAT(CHAR(13), CHAR(10), LTRIM(RTRIM(z.Description))) END), N''), 2000),
           COALESCE(legacy.fnBit(z.Approved), 0),
           CASE WHEN COALESCE(legacy.fnBit(z.Obsolete), 0) = 1 THEN 0 ELSE 1 END,
           CAST(z.ProtocolID AS int)
    FROM (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY LEFT(LTRIM(RTRIM(s.ProtocolName)), 100) ORDER BY s.ProtocolID) AS rn FROM stage.ZAP_tblNecropsyProtocols AS s
          WHERE NULLIF(LTRIM(RTRIM(s.ProtocolName)), N'') IS NOT NULL) AS z
    WHERE z.rn = 1 AND NOT EXISTS (SELECT 1 FROM path.NecropsyProtocol AS p WHERE p.Name = LEFT(LTRIM(RTRIM(z.ProtocolName)), 100));
    SET @cProt = @@ROWCOUNT;

    INSERT INTO legacy.LoadIssue (LoadRunId, SourceSystem, SourceTable, SourceKey, Severity, IssueCode, Detail)
    SELECT @run, N'ZAPHOD', N'tblNecropsyProtocols', CAST(s.ProtocolID AS nvarchar(20)), N'REVIEW', N'PROTOCOL_NAME_DUPLICATE',
           N'Another Zaphod protocol has the same name; only the lowest id was loaded. Animals using this protocol id are attached to that one.'
    FROM (SELECT x.*, ROW_NUMBER() OVER (PARTITION BY LEFT(LTRIM(RTRIM(x.ProtocolName)), 100) ORDER BY x.ProtocolID) AS rn FROM stage.ZAP_tblNecropsyProtocols AS x
          WHERE NULLIF(LTRIM(RTRIM(x.ProtocolName)), N'') IS NOT NULL) AS s
    WHERE s.rn > 1;

    -- protocol id (Zaphod) -> protocol (LIMS), including the duplicates above
    INSERT INTO legacy.IdCrosswalk (SourceSystem, SourceTable, SourceKey, TargetTable, TargetId, LoadRunId)
    SELECT N'ZAPHOD', N'tblNecropsyProtocols', CAST(z.ProtocolID AS nvarchar(20)), N'path.NecropsyProtocol', p.ProtocolId, @run
    FROM stage.ZAP_tblNecropsyProtocols AS z
    JOIN path.NecropsyProtocol AS p ON p.Name = LEFT(LTRIM(RTRIM(z.ProtocolName)), 100)
    WHERE NOT EXISTS (SELECT 1 FROM legacy.IdCrosswalk AS x WHERE x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblNecropsyProtocols' AND x.SourceKey = CAST(z.ProtocolID AS nvarchar(20)));

    INSERT INTO path.NecropsyProtocolOrgan (ProtocolId, Sequence, OrganCode, WeighOrgan, DefaultBlock)
    SELECT x.TargetId, st.Seq, o.OrganCode, st.WeighOrgan, NULL
    FROM (SELECT CAST(s.ProtocolID AS int) AS ProtocolID, CAST(s.OrganID AS int) AS OrganID, COALESCE(legacy.fnBit(s.WeighOrgan), 0) AS WeighOrgan,
                 ROW_NUMBER() OVER (PARTITION BY s.ProtocolID ORDER BY s.Sequence, s.OrganID) AS Seq
          FROM stage.ZAP_tblNecropsyProtocolSteps AS s) AS st
    JOIN legacy.IdCrosswalk AS x ON x.SourceSystem = N'ZAPHOD' AND x.SourceTable = N'tblNecropsyProtocols' AND x.SourceKey = CAST(st.ProtocolID AS nvarchar(20))
    JOIN stage.ZAP_tblOrgans AS zo ON zo.OrganID = st.OrganID
    JOIN ref.Organ AS o ON o.OrganCode = LEFT(NULLIF(LTRIM(RTRIM(zo.Organ)), N''), 40)
    WHERE NOT EXISTS (SELECT 1 FROM path.NecropsyProtocolOrgan AS e WHERE e.ProtocolId = x.TargetId)    -- never touch a protocol that already has steps
      AND x.TargetId IN (SELECT ProtocolId FROM path.NecropsyProtocol WHERE LegacyZaphodProtocolId = CAST(st.ProtocolID AS int));
    SET @cStep = @@ROWCOUNT;

    COMMIT TRANSACTION;

    UPDATE legacy.LoadRun SET Status = N'SUCCEEDED', FinishedAt = sysutcdatetime(),
           RowCountsJson = CONCAT(N'{"organs":', @cOrgan, N',"diagnoses":', @cDiag, N',"diagnosisOrgans":', @cDiagOrgan, N',"dictionaryTerms":', @cTerm,
                                  N',"necropsyProtocols":', @cProt, N',"protocolSteps":', @cStep, N'}')
     WHERE LoadRunId = @run;
    PRINT CONCAT(N'200_load_zaphod_dictionaries done. Organs ', @cOrgan, N', diagnoses ', @cDiag, N', terms ', @cTerm, N', protocols ', @cProt, N' (steps ', @cStep, N')');
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    UPDATE legacy.LoadRun SET Status = N'FAILED', FinishedAt = sysutcdatetime(), Notes = LEFT(CONCAT(Notes, N': ', ERROR_MESSAGE()), 4000) WHERE LoadRunId = @run;
    THROW;
END CATCH
GO
