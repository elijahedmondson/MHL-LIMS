/* =============================================================================
   MHL LIMS  -  070_necropsy_and_pathology.sql
   Necropsy and pathology for each PHL number (replaces Zaphod), plus the
   dictionaries they use.

   Modeled on Zaphod's tables (tblNecropsyHeaders/Organs/Findings,
   tblPathologyHeaders/Organs/Diagnoses/Correlation, tblDiagnosis) and worked
   out in the pilot (lims/pilot: core/core.mjs necropsy and pathology sections,
   core/pathology.mjs). Rules live in MhlLims.Domain.Necropsy and
   MhlLims.Domain.Pathology.

   - One necropsy and one pathology case per subject (PHL number).
   - Pathology on a necropsy animal starts from the approved necropsy: tissues
     come from the necropsy organs, gross findings must be correlated with a
     diagnosis or marked "no microscopic correlate" before sign-out.
   - Submitted slides or blocks (no necropsy at MHL): the pathologist adds the
     tissues.
   - Sign-out locks the case (triggers below) and stores the signed report as an
     immutable version. Amending needs a reason and creates the next version.
   - Charges created by necropsy approval or pathology sign-out point back to
     the necropsy or case (columns added to billing.ChargeLine at the end).
   ============================================================================= */
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;   -- required for filtered indexes
SET ANSI_NULLS ON;
GO

/* ---------------------------------------------------------------------------
   Dictionaries. Seeded by 120_seed_pathology_dictionary.sql with a starter set
   (PLACEHOLDER) until Zaphod's own dictionaries are migrated.
   --------------------------------------------------------------------------- */
CREATE TABLE ref.Organ (
    OrganCode   nvarchar(40)  NOT NULL CONSTRAINT PK_Organ PRIMARY KEY,     -- the name is the code, as in Zaphod's lists
    IsPaired    bit           NOT NULL CONSTRAINT DF_Organ_IsPaired DEFAULT (0),   -- offers left / right / bilateral
    SortOrder   int           NOT NULL CONSTRAINT DF_Organ_SortOrder DEFAULT (0),
    LegacyZaphodOrganId int   NULL,
    IsActive    bit           NOT NULL CONSTRAINT DF_Organ_IsActive DEFAULT (1)
);

-- Small controlled lists: necropsy sites, morphology, shapes, colors, consistencies, fates,
-- conditions, identification methods, and pathology distribution and laterality.
CREATE TABLE ref.DictionaryTerm (
    DictionaryCode  nvarchar(30)  NOT NULL CONSTRAINT CK_DictionaryTerm_Code CHECK (DictionaryCode IN (
                        N'NECROPSY_SITE', N'MORPHOLOGY', N'SHAPE', N'COLOR', N'CONSISTENCY', N'FATE', N'CONDITION', N'PHYSICAL_ID',
                        N'DISTRIBUTION', N'LATERALITY')),
    Term            nvarchar(60)  NOT NULL,
    SortOrder       int           NOT NULL CONSTRAINT DF_DictionaryTerm_SortOrder DEFAULT (0),
    IsActive        bit           NOT NULL CONSTRAINT DF_DictionaryTerm_IsActive DEFAULT (1),
    CONSTRAINT PK_DictionaryTerm PRIMARY KEY (DictionaryCode, Term)
);

-- Microscopic diagnosis terms. IsGeneral = offered for any tissue; otherwise see DiagnosisOrgan.
CREATE TABLE ref.Diagnosis (
    DiagnosisId     int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Diagnosis PRIMARY KEY,
    Term            nvarchar(120) NOT NULL CONSTRAINT UQ_Diagnosis_Term UNIQUE,
    IsNeoplasm      bit           NOT NULL CONSTRAINT DF_Diagnosis_IsNeoplasm DEFAULT (0),
    IsGeneral       bit           NOT NULL CONSTRAINT DF_Diagnosis_IsGeneral DEFAULT (0),
    InhandTerm      nvarchar(200) NULL,          -- for SEND/INHAND mapping, if adopted
    LegacyZaphodDiagnosisId int   NULL,
    IsActive        bit           NOT NULL CONSTRAINT DF_Diagnosis_IsActive DEFAULT (1)
);

CREATE TABLE ref.DiagnosisOrgan (
    DiagnosisId  int          NOT NULL CONSTRAINT FK_DiagnosisOrgan_Diagnosis REFERENCES ref.Diagnosis (DiagnosisId),
    OrganCode    nvarchar(40) NOT NULL CONSTRAINT FK_DiagnosisOrgan_Organ REFERENCES ref.Organ (OrganCode),
    CONSTRAINT PK_DiagnosisOrgan PRIMARY KEY (DiagnosisId, OrganCode)
);
GO

/* ---------------------------------------------------------------------------
   Necropsy
   --------------------------------------------------------------------------- */
CREATE TABLE path.NecropsyProtocol (
    ProtocolId    int IDENTITY(1,1) NOT NULL CONSTRAINT PK_NecropsyProtocol PRIMARY KEY,
    Name          nvarchar(100) NOT NULL CONSTRAINT UQ_NecropsyProtocol_Name UNIQUE,
    WeighAnimal   bit           NOT NULL CONSTRAINT DF_NecropsyProtocol_WeighAnimal DEFAULT (1),
    Perfusion     nvarchar(10)  NULL CONSTRAINT CK_NecropsyProtocol_Perfusion CHECK (Perfusion IN (N'WHOLE', N'LUNG', N'LIVER')),
    Instructions  nvarchar(2000) NULL,
    IsApproved    bit           NOT NULL CONSTRAINT DF_NecropsyProtocol_IsApproved DEFAULT (0),
    IsActive      bit           NOT NULL CONSTRAINT DF_NecropsyProtocol_IsActive DEFAULT (1),
    LegacyZaphodProtocolId int  NULL
);

CREATE TABLE path.NecropsyProtocolOrgan (
    ProtocolId    int           NOT NULL CONSTRAINT FK_NecropsyProtocolOrgan_Protocol REFERENCES path.NecropsyProtocol (ProtocolId),
    Sequence      int           NOT NULL,
    OrganCode     nvarchar(40)  NOT NULL CONSTRAINT FK_NecropsyProtocolOrgan_Organ REFERENCES ref.Organ (OrganCode),
    WeighOrgan    bit           NOT NULL CONSTRAINT DF_NecropsyProtocolOrgan_Weigh DEFAULT (0),
    DefaultBlock  nvarchar(12)  NULL,
    CONSTRAINT PK_NecropsyProtocolOrgan PRIMARY KEY (ProtocolId, Sequence)
);

-- Which necropsy protocol a study uses (Zaphod tblStudies.NecropsyProtocolID).
ALTER TABLE lims.Study ADD NecropsyProtocolId int NULL CONSTRAINT FK_Study_NecropsyProtocol REFERENCES path.NecropsyProtocol (ProtocolId);
GO

CREATE TABLE path.Necropsy (
    NecropsyId         int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Necropsy PRIMARY KEY,
    SubjectId          int           NOT NULL CONSTRAINT UQ_Necropsy_Subject UNIQUE CONSTRAINT FK_Necropsy_Subject REFERENCES lims.Subject (SubjectId),
    ProtocolId         int           NOT NULL CONSTRAINT FK_Necropsy_Protocol REFERENCES path.NecropsyProtocol (ProtocolId),
    Status             nvarchar(10)  NOT NULL CONSTRAINT DF_Necropsy_Status DEFAULT (N'DRAFT') CONSTRAINT CK_Necropsy_Status CHECK (Status IN (N'DRAFT', N'APPROVED')),
    NecropsyDate       date          NOT NULL,
    ProsectorUserId    int           NULL CONSTRAINT FK_Necropsy_Prosector REFERENCES sec.AppUser (UserId),
    ProsectorInitials  nvarchar(4)   NOT NULL,
    Fate               nvarchar(60)  NOT NULL,          -- ref.DictionaryTerm FATE
    Condition          nvarchar(60)  NULL,              -- ref.DictionaryTerm CONDITION
    PhysicalId         nvarchar(60)  NULL,              -- ref.DictionaryTerm PHYSICAL_ID
    MatchesCageCard    bit           NOT NULL CONSTRAINT DF_Necropsy_MatchesCageCard DEFAULT (0),
    BodyWeightG        decimal(9,3)  NULL CONSTRAINT CK_Necropsy_BodyWeight CHECK (BodyWeightG IS NULL OR BodyWeightG >= 0),
    IsPartial          bit           NOT NULL CONSTRAINT DF_Necropsy_IsPartial DEFAULT (0),
    Perfusion          nvarchar(10)  NULL CONSTRAINT CK_Necropsy_Perfusion CHECK (Perfusion IN (N'WHOLE', N'LUNG', N'LIVER')),
    Observations       nvarchar(2000) NULL,
    ApprovedByUserId   int           NULL CONSTRAINT FK_Necropsy_ApprovedBy REFERENCES sec.AppUser (UserId),
    ApprovedAt         datetime2(0)  NULL,
    ModifiedBy         nvarchar(100) NOT NULL CONSTRAINT DF_Necropsy_ModifiedBy DEFAULT (SUSER_SNAME()),
    RowVer             rowversion    NOT NULL,
    ValidFrom          datetime2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo            datetime2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),
    CONSTRAINT CK_Necropsy_Approved CHECK (Status <> N'APPROVED' OR (ApprovedByUserId IS NOT NULL AND ApprovedAt IS NOT NULL))
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = history.Necropsy));
GO

CREATE TABLE path.NecropsyOrgan (
    NecropsyOrganId  int IDENTITY(1,1) NOT NULL CONSTRAINT PK_NecropsyOrgan PRIMARY KEY,
    NecropsyId       int           NOT NULL CONSTRAINT FK_NecropsyOrgan_Necropsy REFERENCES path.Necropsy (NecropsyId),
    Sequence         int           NOT NULL,
    OrganCode        nvarchar(40)  NOT NULL CONSTRAINT FK_NecropsyOrgan_Organ REFERENCES ref.Organ (OrganCode),
    BlockCode        nvarchar(12)  NULL,
    IsWeighed        bit           NOT NULL CONSTRAINT DF_NecropsyOrgan_IsWeighed DEFAULT (0),
    WeightG          decimal(9,4)  NULL CONSTRAINT CK_NecropsyOrgan_Weight CHECK (WeightG IS NULL OR WeightG >= 0),
    NotCollected     bit           NOT NULL CONSTRAINT DF_NecropsyOrgan_NotCollected DEFAULT (0),
    Observations     nvarchar(500) NULL,
    CONSTRAINT UQ_NecropsyOrgan UNIQUE (NecropsyId, Sequence),
    CONSTRAINT CK_NecropsyOrgan_WeightOnlyIfCollected CHECK (NotCollected = 0 OR WeightG IS NULL)
);
CREATE INDEX IX_NecropsyOrgan_Necropsy ON path.NecropsyOrgan (NecropsyId);

CREATE TABLE path.NecropsyFinding (
    NecropsyFindingId  int IDENTITY(1,1) NOT NULL CONSTRAINT PK_NecropsyFinding PRIMARY KEY,
    NecropsyOrganId    int           NOT NULL CONSTRAINT FK_NecropsyFinding_Organ REFERENCES path.NecropsyOrgan (NecropsyOrganId),
    Site               nvarchar(60)  NULL,
    Morphology         nvarchar(60)  NOT NULL,
    Shape              nvarchar(40)  NULL,
    Color              nvarchar(40)  NULL,
    Consistency        nvarchar(40)  NULL,
    Quantity           int           NULL CONSTRAINT CK_NecropsyFinding_Qty CHECK (Quantity IS NULL OR Quantity >= 1),
    SizeMm             decimal(7,2)  NULL CONSTRAINT CK_NecropsyFinding_Size CHECK (SizeMm IS NULL OR SizeMm >= 0),
    FixedNbf           bit           NOT NULL CONSTRAINT DF_NecropsyFinding_Nbf DEFAULT (0),
    FixedOct           bit           NOT NULL CONSTRAINT DF_NecropsyFinding_Oct DEFAULT (0),
    FrozenLn2          bit           NOT NULL CONSTRAINT DF_NecropsyFinding_Ln2 DEFAULT (0),
    InPbs              bit           NOT NULL CONSTRAINT DF_NecropsyFinding_Pbs DEFAULT (0),
    Notes              nvarchar(300) NULL
);
CREATE INDEX IX_NecropsyFinding_Organ ON path.NecropsyFinding (NecropsyOrganId);

-- Billable procedures ticked at necropsy (terminal bleed, snap-frozen tubes ...); approval turns them into charges.
CREATE TABLE path.NecropsyProcedure (
    NecropsyId     int           NOT NULL CONSTRAINT FK_NecropsyProcedure_Necropsy REFERENCES path.Necropsy (NecropsyId),
    ProcedureCode  nvarchar(30)  NOT NULL CONSTRAINT CK_NecropsyProcedure_Code CHECK (ProcedureCode IN (
                       N'TERMINAL_BLEED', N'BLOOD_COLLECTION', N'BONE_MARROW_SMEAR', N'BIOHAZARD', N'SNAP_FREEZE_TUBES', N'BLOOD_SMEAR_PAIRS')),
    Quantity       int           NOT NULL CONSTRAINT DF_NecropsyProcedure_Qty DEFAULT (1) CONSTRAINT CK_NecropsyProcedure_Qty CHECK (Quantity BETWEEN 1 AND 200),
    CONSTRAINT PK_NecropsyProcedure PRIMARY KEY (NecropsyId, ProcedureCode)
);
GO

/* ---------------------------------------------------------------------------
   Pathology
   --------------------------------------------------------------------------- */
CREATE TABLE path.PathologyCase (
    PathologyCaseId        int IDENTITY(1,1) NOT NULL CONSTRAINT PK_PathologyCase PRIMARY KEY,
    SubjectId              int           NOT NULL CONSTRAINT UQ_PathologyCase_Subject UNIQUE CONSTRAINT FK_PathologyCase_Subject REFERENCES lims.Subject (SubjectId),
    Status                 nvarchar(10)  NOT NULL CONSTRAINT DF_PathologyCase_Status DEFAULT (N'DRAFT') CONSTRAINT CK_PathologyCase_Status CHECK (Status IN (N'DRAFT', N'SIGNED')),
    Version                int           NOT NULL CONSTRAINT DF_PathologyCase_Version DEFAULT (1) CONSTRAINT CK_PathologyCase_Version CHECK (Version >= 1),
    PathologistUserId      int           NULL CONSTRAINT FK_PathologyCase_Pathologist REFERENCES sec.AppUser (UserId),
    AssignedToUserId       int           NULL CONSTRAINT FK_PathologyCase_AssignedTo REFERENCES sec.AppUser (UserId),
    CauseOfDeathKind       nvarchar(14)  NULL CONSTRAINT CK_PathologyCase_CodKind CHECK (CauseOfDeathKind IN (N'NOT_APPLICABLE', N'UNDETERMINED', N'DIAGNOSIS')),
    CauseOfDeathDiagnosisEntryId int     NULL,          -- FK added below (circular reference)
    CauseOfDeathComment    nvarchar(300) NULL,
    PathologistComment     nvarchar(4000) NULL,
    ExtraQuarterHours      int           NOT NULL CONSTRAINT DF_PathologyCase_ExtraTime DEFAULT (0) CONSTRAINT CK_PathologyCase_ExtraTime CHECK (ExtraQuarterHours <= 40),
    ExtraTimeNote          nvarchar(200) NULL,
    StartedAt              datetime2(0)  NULL,
    SignedByUserId         int           NULL CONSTRAINT FK_PathologyCase_SignedBy REFERENCES sec.AppUser (UserId),
    SignedAt               datetime2(0)  NULL,
    ModifiedBy             nvarchar(100) NOT NULL CONSTRAINT DF_PathologyCase_ModifiedBy DEFAULT (SUSER_SNAME()),
    RowVer                 rowversion    NOT NULL,       -- optimistic locking, like Zaphod's LockTimeStamp
    ValidFrom              datetime2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo                datetime2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),
    CONSTRAINT CK_PathologyCase_Signed CHECK (Status <> N'SIGNED' OR (SignedByUserId IS NOT NULL AND SignedAt IS NOT NULL)),
    CONSTRAINT CK_PathologyCase_ExtraTimeNote CHECK (ExtraQuarterHours = 0 OR ExtraTimeNote IS NOT NULL)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = history.PathologyCase));
CREATE INDEX IX_PathologyCase_Assigned ON path.PathologyCase (AssignedToUserId, Status);
GO

CREATE TABLE path.PathologyTissue (
    PathologyTissueId  int IDENTITY(1,1) NOT NULL CONSTRAINT PK_PathologyTissue PRIMARY KEY,
    PathologyCaseId    int           NOT NULL CONSTRAINT FK_PathologyTissue_Case REFERENCES path.PathologyCase (PathologyCaseId),
    Sequence           int           NOT NULL,
    OrganCode          nvarchar(40)  NOT NULL CONSTRAINT FK_PathologyTissue_Organ REFERENCES ref.Organ (OrganCode),
    BlockCode          nvarchar(12)  NULL,          -- slides read are counted per block
    NecropsyOrganId    int           NULL CONSTRAINT FK_PathologyTissue_NecropsyOrgan REFERENCES path.NecropsyOrgan (NecropsyOrganId),
    Result             nvarchar(14)  NOT NULL CONSTRAINT DF_PathologyTissue_Result DEFAULT (N'PENDING')
                       CONSTRAINT CK_PathologyTissue_Result CHECK (Result IN (N'PENDING', N'NSL', N'LESIONS', N'NOT_EXAMINED', N'NOT_PRESENT')),
    Comment            nvarchar(500) NULL,
    RecutRequested     bit           NOT NULL CONSTRAINT DF_PathologyTissue_Recut DEFAULT (0),
    RecutNote          nvarchar(200) NULL,
    CONSTRAINT UQ_PathologyTissue UNIQUE (PathologyCaseId, Sequence)
);
CREATE INDEX IX_PathologyTissue_Recut ON path.PathologyTissue (PathologyCaseId) WHERE RecutRequested = 1;

CREATE TABLE path.PathologyDiagnosis (
    DiagnosisEntryId   int IDENTITY(1,1) NOT NULL CONSTRAINT PK_PathologyDiagnosis PRIMARY KEY,
    PathologyTissueId  int           NOT NULL CONSTRAINT FK_PathologyDiagnosis_Tissue REFERENCES path.PathologyTissue (PathologyTissueId),
    Sequence           int           NOT NULL,
    DiagnosisId        int           NULL CONSTRAINT FK_PathologyDiagnosis_Diagnosis REFERENCES ref.Diagnosis (DiagnosisId),   -- NULL = term not in the dictionary
    Term               nvarchar(120) NOT NULL,       -- as recorded, so the report never changes if the dictionary does
    IsNeoplasm         bit           NOT NULL,
    Modifier           nvarchar(120) NULL,
    Distribution       nvarchar(30)  NULL,
    Laterality         nvarchar(20)  NULL,
    Severity           nchar(1)      NULL CONSTRAINT CK_PathologyDiagnosis_Severity CHECK (Severity IN (N'1', N'2', N'3', N'4', N'5', N'P')),
    Behavior           nvarchar(10)  NULL CONSTRAINT CK_PathologyDiagnosis_Behavior CHECK (Behavior IN (N'BENIGN', N'MALIGNANT', N'UNCERTAIN')),
    Origin             nvarchar(10)  NULL CONSTRAINT CK_PathologyDiagnosis_Origin CHECK (Origin IN (N'PRIMARY', N'METASTATIC')),
    Comment            nvarchar(300) NULL,
    CONSTRAINT UQ_PathologyDiagnosis UNIQUE (PathologyTissueId, Sequence),
    -- neoplasms carry behavior and origin, not a severity grade; other findings the reverse
    CONSTRAINT CK_PathologyDiagnosis_NeoplasmFields CHECK ((IsNeoplasm = 1 AND Severity IS NULL) OR (IsNeoplasm = 0 AND Behavior IS NULL AND Origin IS NULL))
);
CREATE INDEX IX_PathologyDiagnosis_Diagnosis ON path.PathologyDiagnosis (DiagnosisId) WHERE DiagnosisId IS NOT NULL;

ALTER TABLE path.PathologyCase ADD CONSTRAINT FK_PathologyCase_CodDiagnosis
    FOREIGN KEY (CauseOfDeathDiagnosisEntryId) REFERENCES path.PathologyDiagnosis (DiagnosisEntryId);
GO

-- Gross-to-microscopic correlation (Zaphod tblPathologyCorrelation).
CREATE TABLE path.PathologyCorrelation (
    DiagnosisEntryId   int NOT NULL CONSTRAINT FK_PathologyCorrelation_Diagnosis REFERENCES path.PathologyDiagnosis (DiagnosisEntryId),
    NecropsyFindingId  int NOT NULL CONSTRAINT FK_PathologyCorrelation_Finding REFERENCES path.NecropsyFinding (NecropsyFindingId),
    CONSTRAINT PK_PathologyCorrelation PRIMARY KEY (DiagnosisEntryId, NecropsyFindingId)
);
CREATE UNIQUE INDEX UX_PathologyCorrelation_Finding ON path.PathologyCorrelation (NecropsyFindingId);   -- a finding correlates with one diagnosis

-- Gross findings the pathologist has marked as having no microscopic correlate.
CREATE TABLE path.GrossNoCorrelate (
    PathologyCaseId    int NOT NULL CONSTRAINT FK_GrossNoCorrelate_Case REFERENCES path.PathologyCase (PathologyCaseId),
    NecropsyFindingId  int NOT NULL CONSTRAINT FK_GrossNoCorrelate_Finding REFERENCES path.NecropsyFinding (NecropsyFindingId),
    CONSTRAINT PK_GrossNoCorrelate PRIMARY KEY (PathologyCaseId, NecropsyFindingId)
);

-- Every signed-out report, frozen as it was signed. Amended reports add a new version.
CREATE TABLE path.PathologyReportVersion (
    PathologyCaseId  int           NOT NULL CONSTRAINT FK_PathologyReportVersion_Case REFERENCES path.PathologyCase (PathologyCaseId),
    Version          int           NOT NULL,
    SignedByUserId   int           NOT NULL CONSTRAINT FK_PathologyReportVersion_SignedBy REFERENCES sec.AppUser (UserId),
    SignedAt         datetime2(0)  NOT NULL,
    ReportJson       nvarchar(max) NOT NULL CONSTRAINT CK_PathologyReportVersion_Json CHECK (ISJSON(ReportJson) = 1),
    CONSTRAINT PK_PathologyReportVersion PRIMARY KEY (PathologyCaseId, Version)
);

CREATE TABLE path.PathologyAmendment (
    PathologyCaseId   int           NOT NULL CONSTRAINT FK_PathologyAmendment_Case REFERENCES path.PathologyCase (PathologyCaseId),
    Version           int           NOT NULL,          -- the version being created by the amendment
    AmendedByUserId   int           NOT NULL CONSTRAINT FK_PathologyAmendment_User REFERENCES sec.AppUser (UserId),
    AmendedAt         datetime2(0)  NOT NULL CONSTRAINT DF_PathologyAmendment_At DEFAULT (sysutcdatetime()),
    Reason            nvarchar(300) NOT NULL CONSTRAINT CK_PathologyAmendment_Reason CHECK (LEN(Reason) > 0),
    CONSTRAINT PK_PathologyAmendment PRIMARY KEY (PathologyCaseId, Version)
);
GO

-- A signed-out case cannot change: amend it first (sets Status back to DRAFT and Version + 1).
CREATE OR ALTER TRIGGER path.TR_PathologyTissue_Locked ON path.PathologyTissue AFTER INSERT, UPDATE, DELETE AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM (SELECT PathologyCaseId FROM inserted UNION SELECT PathologyCaseId FROM deleted) AS x
               JOIN path.PathologyCase AS c ON c.PathologyCaseId = x.PathologyCaseId WHERE c.Status = N'SIGNED')
        THROW 50070, N'This pathology report is signed out. Amend it (with a reason) before changing it.', 1;
END
GO
CREATE OR ALTER TRIGGER path.TR_PathologyDiagnosis_Locked ON path.PathologyDiagnosis AFTER INSERT, UPDATE, DELETE AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM (SELECT PathologyTissueId FROM inserted UNION SELECT PathologyTissueId FROM deleted) AS x
               JOIN path.PathologyTissue AS t ON t.PathologyTissueId = x.PathologyTissueId
               JOIN path.PathologyCase AS c ON c.PathologyCaseId = t.PathologyCaseId WHERE c.Status = N'SIGNED')
        THROW 50071, N'This pathology report is signed out. Amend it (with a reason) before changing it.', 1;
END
GO
CREATE OR ALTER TRIGGER path.TR_PathologyCorrelation_Locked ON path.PathologyCorrelation AFTER INSERT, UPDATE, DELETE AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM (SELECT DiagnosisEntryId FROM inserted UNION SELECT DiagnosisEntryId FROM deleted) AS x
               JOIN path.PathologyDiagnosis AS d ON d.DiagnosisEntryId = x.DiagnosisEntryId
               JOIN path.PathologyTissue AS t ON t.PathologyTissueId = d.PathologyTissueId
               JOIN path.PathologyCase AS c ON c.PathologyCaseId = t.PathologyCaseId WHERE c.Status = N'SIGNED')
        THROW 50072, N'This pathology report is signed out. Amend it (with a reason) before changing it.', 1;
END
GO
CREATE OR ALTER TRIGGER path.TR_PathologyReportVersion_Immutable ON path.PathologyReportVersion AFTER UPDATE, DELETE AS
BEGIN
    SET NOCOUNT ON;
    THROW 50073, N'Signed pathology report versions cannot be changed or deleted.', 1;
END
GO

-- Charges created by necropsy approval or pathology sign-out point back to their source.
ALTER TABLE billing.ChargeLine ADD
    NecropsyId       int NULL CONSTRAINT FK_ChargeLine_Necropsy REFERENCES path.Necropsy (NecropsyId),
    PathologyCaseId  int NULL CONSTRAINT FK_ChargeLine_PathologyCase REFERENCES path.PathologyCase (PathologyCaseId);
GO
CREATE INDEX IX_ChargeLine_PathologyCase ON billing.ChargeLine (PathologyCaseId) WHERE PathologyCaseId IS NOT NULL;
CREATE INDEX IX_ChargeLine_Necropsy ON billing.ChargeLine (NecropsyId) WHERE NecropsyId IS NOT NULL;
GO

-- Pathology worklist: every subject on an open request that includes the Pathology work area.
CREATE OR ALTER VIEW path.vPathologyWorklist
AS
SELECT s.SubjectId, s.PhlNumber, s.PriorityCode, r.RequestId, r.RequestNumber, r.DueDate, st.ZapNumber,
       n.Status                                   AS NecropsyStatus,
       c.PathologyCaseId, c.Status                AS CaseStatus, c.Version, c.AssignedToUserId,
       CASE WHEN c.PathologyCaseId IS NOT NULL THEN c.Status
            WHEN EXISTS (SELECT 1 FROM lims.RequestArea ra WHERE ra.RequestId = r.RequestId AND ra.AreaCode = N'NECRO')
                 AND ISNULL(n.Status, N'') <> N'APPROVED' THEN N'WAITING'
            ELSE N'NOT_STARTED' END              AS WorklistStatus
FROM lims.Subject AS s
JOIN lims.Request AS r ON r.RequestId = s.RequestId AND r.Status = N'OPEN'
JOIN lims.RequestArea AS pa ON pa.RequestId = r.RequestId AND pa.AreaCode = N'PATHO'
LEFT JOIN lims.Study AS st ON st.StudyId = r.StudyId
LEFT JOIN path.Necropsy AS n ON n.SubjectId = s.SubjectId
LEFT JOIN path.PathologyCase AS c ON c.SubjectId = s.SubjectId;
GO
