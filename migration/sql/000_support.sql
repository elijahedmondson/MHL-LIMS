/* =============================================================================
   MHL LIMS migration  -  000_support.sql
   Run ONCE in the LIMS development database (after db\deploy_all.sql), before the copy script.
   Creates: the stage schema (raw copies of legacy tables), the issue log, the editable value maps,
   the user-resolution table, side tables that keep legacy fields with no home in the new schema,
   and the placeholder objects the loaders need (system user, legacy price list, legacy section).
   Safe to re-run.
   ============================================================================= */
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF SCHEMA_ID(N'stage') IS NULL EXEC (N'CREATE SCHEMA stage');
GO

/* Everything the loaders correct, skip or want a person to look at is written here. */
IF OBJECT_ID(N'legacy.LoadIssue') IS NULL
CREATE TABLE legacy.LoadIssue (
    IssueId       int IDENTITY(1,1) NOT NULL CONSTRAINT PK_LoadIssue PRIMARY KEY,
    LoadRunId     int           NULL CONSTRAINT FK_LoadIssue_LoadRun REFERENCES legacy.LoadRun (LoadRunId),
    SourceSystem  nvarchar(10)  NOT NULL,
    SourceTable   nvarchar(128) NOT NULL,
    SourceKey     nvarchar(200) NULL,
    Severity      nvarchar(10)  NOT NULL CONSTRAINT CK_LoadIssue_Severity CHECK (Severity IN (N'INFO', N'CORRECTED', N'SKIPPED', N'REVIEW')),
    IssueCode     nvarchar(50)  NOT NULL,
    Detail        nvarchar(1000) NULL,
    LoggedAt      datetime2(0)  NOT NULL CONSTRAINT DF_LoadIssue_LoggedAt DEFAULT (sysutcdatetime())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LoadIssue_Code' AND object_id = OBJECT_ID(N'legacy.LoadIssue'))
    CREATE INDEX IX_LoadIssue_Code ON legacy.LoadIssue (IssueCode, Severity) INCLUDE (SourceTable);
GO

/* Editable translation tables. The loaders use these instead of hard-coded guesses.
   MapName  : the legacy value family (see the seed rows below)
   SourceValue : the legacy text, compared case-insensitively after trimming
   TargetValue : the new code; NULL means "no equivalent: leave empty and log a REVIEW issue".
   Pathologists and lab leads should review every row marked as a guess in Notes. */
IF OBJECT_ID(N'legacy.MapValue') IS NULL
CREATE TABLE legacy.MapValue (
    MapName      nvarchar(30)  NOT NULL,
    SourceValue  nvarchar(120) NOT NULL,
    TargetValue  nvarchar(120) NULL,
    Notes        nvarchar(400) NULL,
    CONSTRAINT PK_MapValue PRIMARY KEY (MapName, SourceValue)
);
GO

/* Maps any legacy user token (PHL initials, Zaphod user name, prosector, approver) to sec.AppUser.
   Filled by 100_load_reference.sql; staff can correct rows by hand before the later loads. */
IF OBJECT_ID(N'legacy.UserResolve') IS NULL
CREATE TABLE legacy.UserResolve (
    Token    nvarchar(100) NOT NULL CONSTRAINT PK_UserResolve PRIMARY KEY,
    UserId   int           NOT NULL CONSTRAINT FK_UserResolve_User REFERENCES sec.AppUser (UserId),
    Basis    nvarchar(20)  NOT NULL     -- ADACCOUNT, INITIALS, DISPLAYNAME, PLACEHOLDER, MANUAL
);
GO

/* Legacy request columns that have no column in lims.Request, kept so nothing is lost. */
IF OBJECT_ID(N'legacy.RequestSource') IS NULL
CREATE TABLE legacy.RequestSource (
    RequestId       int           NOT NULL CONSTRAINT PK_RequestSource PRIMARY KEY CONSTRAINT FK_RequestSource_Request REFERENCES lims.Request (RequestId),
    LegacyLab       nchar(2)      NOT NULL,
    LegacyReqId     nvarchar(20)  NOT NULL,
    SourceDb        nvarchar(20)  NOT NULL,        -- PROD or RETIRE
    CenterNo        nvarchar(60)  NULL,            -- r_center_no (Costpoint project)
    ApoNo           nvarchar(40)  NULL,            -- r_apo_no (NAS#, CSAS#, APO#)
    Division        nvarchar(100) NULL,
    InvestigatorNo  int           NULL,
    InvestigatorNameAsEntered nvarchar(120) NULL,  -- the denormalized copy on the request
    PathologistName nvarchar(100) NULL,            -- r_pa_name
    AssignPathologist nvarchar(100) NULL,          -- r_assign_path
    AssignTeam      nvarchar(50)  NULL,            -- r_assign_team ("Contact" on the tracking form)
    WebId           int           NULL,            -- r_web_id (phlrequest.ncifcrf.gov request id)
    EstTurnaround   int           NULL,            -- r_est_turn
    IsDevelopmental bit           NULL,            -- r_dev
    IsProject       bit           NULL,            -- r_project
    Part            nvarchar(50)  NULL,            -- r_part
    AppBudget       decimal(14,2) NULL,
    OdrsBudget      decimal(14,2) NULL,
    Deliverable     nvarchar(500) NULL,
    SpeciesNameAsEntered nvarchar(200) NULL,
    LastUpdatedAt   datetime2(0)  NULL,
    LastUpdatedBy   nvarchar(20)  NULL
);
GO

/* Legacy PHL-number columns with no column in lims.Subject. */
IF OBJECT_ID(N'legacy.SubjectSource') IS NULL
CREATE TABLE legacy.SubjectSource (
    SubjectId     int           NOT NULL CONSTRAINT PK_SubjectSource PRIMARY KEY CONSTRAINT FK_SubjectSource_Subject REFERENCES lims.Subject (SubjectId),
    SourceDb      nvarchar(20)  NOT NULL,
    AcucNo        nvarchar(50)  NULL,            -- p_cenrep_no ("ACUC#")
    ZapNbrAsEntered nvarchar(50) NULL,           -- p_comment (shown as "ZAPNbr" in PHL)
    StudyNoAsEntered nvarchar(50) NULL,          -- p_study_no
    GroupAsEntered   nvarchar(20) NULL,          -- p_group
    LastUpdatedAt datetime2(0)  NULL,
    LastUpdatedBy nvarchar(20)  NULL
);
GO

/* Every Zaphod animal and necropsy/pathology flag that has no column of its own. */
IF OBJECT_ID(N'legacy.AnimalSource') IS NULL
CREATE TABLE legacy.AnimalSource (
    SubjectId           int NOT NULL CONSTRAINT PK_AnimalSource PRIMARY KEY CONSTRAINT FK_AnimalSource_Subject REFERENCES lims.Subject (SubjectId),
    ZapPhlNbr           nvarchar(30) NOT NULL,
    ZapReqNbr           nvarchar(50) NULL,
    Strain              nvarchar(200) NULL,
    BodyWeight          real NULL,
    BodyWeightUnit      nvarchar(50) NULL,       -- tblAnimals.Measurement
    StartDate           datetime NULL,
    AgeDays             int NULL,
    TimeOnTestDays      int NULL,
    ClinicalObservations nvarchar(1024) NULL,
    NecropsyFlag        bit NULL,
    PathologyFlag       bit NULL,
    NoPathologyRequested bit NULL,
    InPathology         bit NULL,
    NecropsyApproved    bit NULL,
    PathologyComplete   bit NULL,
    Locked              bit NULL,
    NecropsyProtocolId  int NULL,
    TrimProtocolId      int NULL,
    MatchBasis          nvarchar(30) NOT NULL    -- how the animal was matched to a PHL number (see 210_load_zaphod_studies.sql)
);
GO

/* Reads a legacy flag that may be stored as bit, int or text (Y/N, True/False, 1/0). NULL stays NULL. */
CREATE OR ALTER FUNCTION legacy.fnBit (@v sql_variant)
RETURNS bit
AS
BEGIN
    DECLARE @t nvarchar(20) = CONVERT(nvarchar(20), @v);
    IF @t IS NULL RETURN NULL;
    SET @t = UPPER(LTRIM(RTRIM(@t)));
    IF @t = N'' RETURN NULL;
    IF @t IN (N'1', N'-1', N'Y', N'YES', N'T', N'TRUE') RETURN 1;
    RETURN 0;
END
GO

/* ---------- placeholder objects the loaders rely on ---------- */
IF NOT EXISTS (SELECT 1 FROM sec.AppUser WHERE AdAccount = N'LEGACY\MIGRATION')
    INSERT INTO sec.AppUser (AdAccount, DisplayName, Initials, IsPathologist, IsActive)
    VALUES (N'LEGACY\MIGRATION', N'Legacy data migration', N'MIG', 0, 0);
IF NOT EXISTS (SELECT 1 FROM sec.AppUser WHERE AdAccount = N'LEGACY\UNKNOWN')
    INSERT INTO sec.AppUser (AdAccount, DisplayName, Initials, IsPathologist, IsActive)
    VALUES (N'LEGACY\UNKNOWN', N'Unknown legacy user', N'UNK', 0, 0);
GO

-- Charges migrated from PHL need a section; the real section is taken from billing.ChargeCodeSection when the
-- code is on a current price list, otherwise this one is used.
IF NOT EXISTS (SELECT 1 FROM ref.ServiceSection WHERE SectionCode = N'LEGACY')
    INSERT INTO ref.ServiceSection (SectionCode, Name, DefaultAreaCode, SortOrder)
    VALUES (N'LEGACY', N'Legacy (migrated, section unknown)', N'OTHER', 99);
GO

-- One retired price list holds every legacy charge: legacy rows keep the price they were charged
-- (phl_charge.c_charge_price), so no historical price list is reconstructed here.
IF NOT EXISTS (SELECT 1 FROM billing.PriceList WHERE Name = N'LEGACY-PHL')
BEGIN
    DECLARE @mig int = (SELECT UserId FROM sec.AppUser WHERE AdAccount = N'LEGACY\MIGRATION');
    INSERT INTO billing.PriceList (Name, EffectiveFrom, EffectiveTo, Status, ApprovedByUserId, ApprovedAt, Notes)
    VALUES (N'LEGACY-PHL', '1990-01-01', '2100-01-01', N'RETIRED', @mig, sysutcdatetime(),
            N'Placeholder for charges migrated from PHL.exe. Each charge line keeps the unit price it was charged at; this list has no items.');
END
GO

/* ---------- seed value maps (GUESSES: review with the pathologists before loading pathology) ---------- */
MERGE legacy.MapValue AS t
USING (VALUES
  -- Zaphod severity text -> ref severity code on path.PathologyDiagnosis (1..5 or P = present)
  (N'SEVERITY', N'minimal',  N'1', N'guess: standard 5-grade scale'),
  (N'SEVERITY', N'mild',     N'2', N'guess'),
  (N'SEVERITY', N'moderate', N'3', N'guess'),
  (N'SEVERITY', N'marked',   N'4', N'guess'),
  (N'SEVERITY', N'severe',   N'5', N'guess'),
  (N'SEVERITY', N'present',  N'P', N'guess'),
  (N'SEVERITY', N'1', N'1', NULL), (N'SEVERITY', N'2', N'2', NULL), (N'SEVERITY', N'3', N'3', NULL),
  (N'SEVERITY', N'4', N'4', NULL), (N'SEVERITY', N'5', N'5', NULL),
  -- Zaphod neoplasm text -> BEHAVIOR/ORIGIN pair stored as 'BEHAVIOR|ORIGIN'; NONE = not a neoplasm
  (N'NEOPLASM', N'benign',            N'BENIGN|PRIMARY',        N'guess; check against tblNeoplasm'),
  (N'NEOPLASM', N'malignant',         N'MALIGNANT|PRIMARY',     N'guess'),
  (N'NEOPLASM', N'malignant primary', N'MALIGNANT|PRIMARY',     N'guess'),
  (N'NEOPLASM', N'malignant metastatic', N'MALIGNANT|METASTATIC', N'guess'),
  (N'NEOPLASM', N'metastatic',        N'MALIGNANT|METASTATIC',  N'guess'),
  (N'NEOPLASM', N'malignant met',     N'MALIGNANT|METASTATIC',  N'guess'),
  (N'NEOPLASM', N'none',              N'NONE',                  N'guess'),
  (N'NEOPLASM', N'not a neoplasm',    N'NONE',                  N'guess'),
  (N'NEOPLASM', N'n/a',               N'NONE',                  N'guess'),
  -- Zaphod pathology organ Finding text -> path.PathologyTissue.Result
  (N'TISSUE_RESULT', N'dx',            N'LESIONS',      N'Zaphod sets Finding = ''Dx'' when diagnoses were entered'),
  (N'TISSUE_RESULT', N'nsl',           N'NSL',          N'guess: no significant lesions'),
  (N'TISSUE_RESULT', N'no significant lesions', N'NSL', N'guess'),
  (N'TISSUE_RESULT', N'not examined',  N'NOT_EXAMINED', N'guess'),
  (N'TISSUE_RESULT', N'not present',   N'NOT_PRESENT',  N'guess'),
  -- Zaphod laterality text (tblPairedOrgans) -> free text kept as is; this row only normalizes known spellings
  (N'LATERALITY', N'left',      N'Left',      NULL),
  (N'LATERALITY', N'right',     N'Right',     NULL),
  (N'LATERALITY', N'bilateral', N'Bilateral', NULL),
  -- PHL species text that should map onto the seeded ref.Species codes
  (N'SPECIES', N'mouse', N'MOUSE', N'guess'), (N'SPECIES', N'mus musculus', N'MOUSE', N'guess'),
  (N'SPECIES', N'rat', N'RAT', N'guess'),     (N'SPECIES', N'human', N'HUMAN', N'guess'),
  -- PHL request type codes that should map onto the seeded ref.RequestType codes (fill in after reading REQTY)
  -- (N'REQTYPE', N'<legacy code>', N'NECRO-FULL', N'review')
  -- Zaphod / PHL sex text
  (N'SEX', N'male', N'M', NULL), (N'SEX', N'm', N'M', NULL), (N'SEX', N'female', N'F', NULL), (N'SEX', N'f', N'F', NULL),
  (N'SEX', N'unknown', N'U', NULL), (N'SEX', N'u', N'U', NULL), (N'SEX', N'mixed', N'U', NULL), (N'SEX', N'both', N'U', NULL)
) AS s (MapName, SourceValue, TargetValue, Notes)
ON t.MapName = s.MapName AND t.SourceValue = s.SourceValue
WHEN NOT MATCHED THEN INSERT (MapName, SourceValue, TargetValue, Notes) VALUES (s.MapName, s.SourceValue, s.TargetValue, s.Notes);
GO

PRINT N'Migration support objects ready. Next: scripts\Copy-LegacyToStage.ps1';
GO
