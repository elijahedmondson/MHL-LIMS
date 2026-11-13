/* =============================================================================
   MHL LIMS  -  020_core.sql
   Investigators, projects, NAS requests, requests, studies, subjects,
   specimens, blocks, slides, and the number allocator for PHL and request
   numbers.

   Temporal (system-versioned) tables keep every prior version of a row in the
   history schema. ModifiedBy is set by the application to the signed-in user
   on every write; temporal history then answers "who changed what, and when".
   ============================================================================= */
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;   -- required for filtered indexes
SET ANSI_NULLS ON;
GO

CREATE TABLE lims.Investigator (
    InvestigatorId    int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Investigator PRIMARY KEY,
    LastName          nvarchar(100) NOT NULL,
    FirstName         nvarchar(100) NULL,
    Title             nvarchar(100) NULL,
    Institute         nvarchar(100) NULL,        -- e.g. NCI/CCR
    Division          nvarchar(100) NULL,
    Email             nvarchar(256) NULL,
    Phone             nvarchar(50)  NULL,
    LegacySsgInvesNo  int           NULL,        -- ssg_investigators.i_inves_no where i_sys = 'PHL'
    IsActive          bit           NOT NULL CONSTRAINT DF_Investigator_IsActive DEFAULT (1),
    ModifiedBy        nvarchar(100) NOT NULL CONSTRAINT DF_Investigator_ModifiedBy DEFAULT (SUSER_SNAME()),
    ValidFrom         datetime2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo           datetime2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = history.Investigator));
CREATE INDEX IX_Investigator_Name ON lims.Investigator (LastName, FirstName);
CREATE UNIQUE INDEX UX_Investigator_LegacySsg ON lims.Investigator (LegacySsgInvesNo) WHERE LegacySsgInvesNo IS NOT NULL;
GO

-- Costpoint projects (synchronized from the Costpoint replica; read-only in the LIMS).
CREATE TABLE lims.Project (
    ProjectId           int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Project PRIMARY KEY,
    CostpointProjectId  nvarchar(30)  NOT NULL CONSTRAINT UQ_Project_Costpoint UNIQUE,
    Name                nvarchar(200) NULL,
    IsActive            bit           NOT NULL CONSTRAINT DF_Project_IsActive DEFAULT (1),
    AllowCharges        bit           NOT NULL CONSTRAINT DF_Project_AllowCharges DEFAULT (1),
    StartDate           date          NULL,
    EndDate             date          NULL,
    LastSyncedAt        datetime2(0)  NULL
);
GO

-- Approved NAS requests (synchronized from NAS / nas_information; read-only in the LIMS).
CREATE TABLE lims.NasRequest (
    NasRequestId        int           NOT NULL CONSTRAINT PK_NasRequest PRIMARY KEY,  -- NAS internal id
    RequestDisplayId    nvarchar(30)  NOT NULL CONSTRAINT UQ_NasRequest_DisplayId UNIQUE, -- the NAS# staff see
    RequesterLastName   nvarchar(100) NULL,
    RequesterFirstName  nvarchar(100) NULL,
    RequesterEmail      nvarchar(256) NULL,
    ServiceAreaName     nvarchar(200) NULL,
    CostpointProjectId  nvarchar(30)  NULL,
    Description         nvarchar(max) NULL,
    TotalEstimatedCost  decimal(12,2) NULL,
    AuthorizedAmount    decimal(12,2) NULL,
    RequestStatus       nvarchar(50)  NULL,
    DateSubmitted       datetime2(0)  NULL,
    DateAuthorized      datetime2(0)  NULL,
    DateWorkStarted     datetime2(0)  NULL,
    DateWorkCompleted   datetime2(0)  NULL,
    DateWorkCancelled   datetime2(0)  NULL,
    LastSyncedAt        datetime2(0)  NOT NULL CONSTRAINT DF_NasRequest_LastSyncedAt DEFAULT (sysutcdatetime())
);
GO

CREATE TABLE lims.Study (
    StudyId            int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Study PRIMARY KEY,
    ZapNumber          nvarchar(20)  NOT NULL CONSTRAINT UQ_Study_ZapNumber UNIQUE,
    Title              nvarchar(400) NULL,
    InvestigatorId     int           NOT NULL CONSTRAINT FK_Study_Investigator REFERENCES lims.Investigator (InvestigatorId),
    PathologistUserId  int           NULL CONSTRAINT FK_Study_Pathologist REFERENCES sec.AppUser (UserId),
    AcucProtocol       nvarchar(50)  NULL,
    AcucStartDate      date          NULL,
    AcucEndDate        date          NULL,
    Remarks            nvarchar(max) NULL,
    IsObsolete         bit           NOT NULL CONSTRAINT DF_Study_IsObsolete DEFAULT (0),
    IsLegacy           bit           NOT NULL CONSTRAINT DF_Study_IsLegacy DEFAULT (0),
    ModifiedBy         nvarchar(100) NOT NULL CONSTRAINT DF_Study_ModifiedBy DEFAULT (SUSER_SNAME()),
    ValidFrom          datetime2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo            datetime2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = history.Study));
GO

CREATE TABLE lims.StudyGroup (
    GroupId     int IDENTITY(1,1) NOT NULL CONSTRAINT PK_StudyGroup PRIMARY KEY,
    StudyId     int           NOT NULL CONSTRAINT FK_StudyGroup_Study REFERENCES lims.Study (StudyId),
    GroupCode   nvarchar(20)  NOT NULL,
    Name        nvarchar(200) NULL,
    Sex         nchar(1)      NULL CONSTRAINT CK_StudyGroup_Sex CHECK (Sex IN (N'M', N'F', N'U')),
    Genotype    nvarchar(200) NULL,
    Treatment   nvarchar(400) NULL,
    CONSTRAINT UQ_StudyGroup UNIQUE (StudyId, GroupCode)
);
GO

-- A request (accession). One request can include many subjects (PHL numbers).
CREATE TABLE lims.Request (
    RequestId                  int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Request PRIMARY KEY,
    RequestNumber              nvarchar(20)  NOT NULL CONSTRAINT UQ_Request_Number UNIQUE,
    LabCode                    nvarchar(4)   NOT NULL CONSTRAINT FK_Request_Lab REFERENCES ref.Lab (LabCode),
    RequestTypeCode            nvarchar(20)  NOT NULL CONSTRAINT FK_Request_Type REFERENCES ref.RequestType (RequestTypeCode),
    InvestigatorId             int           NOT NULL CONSTRAINT FK_Request_Investigator REFERENCES lims.Investigator (InvestigatorId),
    ProjectId                  int           NULL CONSTRAINT FK_Request_Project REFERENCES lims.Project (ProjectId),
    NasRequestId               int           NULL CONSTRAINT FK_Request_NasRequest REFERENCES lims.NasRequest (NasRequestId),
    StudyId                    int           NULL CONSTRAINT FK_Request_Study REFERENCES lims.Study (StudyId),
    Status                     nvarchar(20)  NOT NULL CONSTRAINT DF_Request_Status DEFAULT (N'OPEN')
                               CONSTRAINT CK_Request_Status CHECK (Status IN (N'DRAFT', N'OPEN', N'COMPLETE', N'CANCELLED')),
    ChargeType                 nchar(1)      NOT NULL CONSTRAINT DF_Request_ChargeType DEFAULT (N'C')
                               CONSTRAINT CK_Request_ChargeType CHECK (ChargeType IN (N'C', N'N', N'L')), -- charge / no charge / cancelled
    DefaultPriorityCode        nchar(1)      NOT NULL CONSTRAINT DF_Request_Priority DEFAULT (N'R')
                               CONSTRAINT FK_Request_Priority REFERENCES ref.Priority (PriorityCode),
    ReceivedDate               date          NOT NULL,
    DueDate                    date          NULL,
    CompletedDate              date          NULL,
    Description                nvarchar(max) NULL,
    SpeciesCode                nvarchar(10)  NULL CONSTRAINT FK_Request_Species REFERENCES ref.Species (SpeciesCode),
    FixativeCode               nvarchar(20)  NULL CONSTRAINT FK_Request_Fixative REFERENCES ref.Fixative (FixativeCode),
    AssignedPathologistUserId  int           NULL CONSTRAINT FK_Request_Pathologist REFERENCES sec.AppUser (UserId),
    TissueDisposition          nvarchar(200) NULL,
    IsLegacy                   bit           NOT NULL CONSTRAINT DF_Request_IsLegacy DEFAULT (0),
    ModifiedBy                 nvarchar(100) NOT NULL CONSTRAINT DF_Request_ModifiedBy DEFAULT (SUSER_SNAME()),
    RowVer                     rowversion    NOT NULL,
    ValidFrom                  datetime2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo                    datetime2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),
    CONSTRAINT CK_Request_Dates CHECK (CompletedDate IS NULL OR CompletedDate >= ReceivedDate),
    CONSTRAINT CK_Request_CompleteHasDate CHECK (Status <> N'COMPLETE' OR CompletedDate IS NOT NULL)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = history.Request));
CREATE INDEX IX_Request_Investigator ON lims.Request (InvestigatorId);
CREATE INDEX IX_Request_Nas ON lims.Request (NasRequestId) WHERE NasRequestId IS NOT NULL;
CREATE INDEX IX_Request_Study ON lims.Request (StudyId) WHERE StudyId IS NOT NULL;
CREATE INDEX IX_Request_Open ON lims.Request (Status, DueDate) INCLUDE (RequestNumber, InvestigatorId);
GO

-- Work areas requested for a request (replaces PHL's r_necro / r_trimm / ... check boxes).
CREATE TABLE lims.RequestArea (
    RequestId  int          NOT NULL CONSTRAINT FK_RequestArea_Request REFERENCES lims.Request (RequestId),
    AreaCode   nvarchar(10) NOT NULL CONSTRAINT FK_RequestArea_Area REFERENCES ref.WorkArea (AreaCode),
    CONSTRAINT PK_RequestArea PRIMARY KEY (RequestId, AreaCode)
);
GO

/* A subject is any source of tissue: a mouse, a coded human donor, a PDX model,
   an organoid line. It carries the PHL number. No direct human identifiers are
   stored anywhere in the LIMS; ExternalSourceId holds a coded ID only. */
CREATE TABLE lims.Subject (
    SubjectId         int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Subject PRIMARY KEY,
    PhlNumber         varchar(12)   NOT NULL,     -- 8 digits + letter; legacy 6-digit "PM" numbers allowed
    SubjectTypeCode   nvarchar(20)  NOT NULL CONSTRAINT FK_Subject_Type REFERENCES ref.SubjectType (SubjectTypeCode),
    RequestId         int           NOT NULL CONSTRAINT FK_Subject_Request REFERENCES lims.Request (RequestId),
    StudyId           int           NULL CONSTRAINT FK_Subject_Study REFERENCES lims.Study (StudyId),
    GroupId           int           NULL CONSTRAINT FK_Subject_Group REFERENCES lims.StudyGroup (GroupId),
    AnimalNumber      nvarchar(30)  NULL,
    AltId             nvarchar(50)  NULL,
    ExternalSourceId  nvarchar(50)  NULL,         -- CAPR AnimalId, coded donor ID, PDX model ID ...
    SpeciesCode       nvarchar(10)  NULL CONSTRAINT FK_Subject_Species REFERENCES ref.Species (SpeciesCode),
    Sex               nchar(1)      NULL CONSTRAINT CK_Subject_Sex CHECK (Sex IN (N'M', N'F', N'U')),
    Genotype          nvarchar(200) NULL,
    BirthDate         date          NULL,
    DeathDate         date          NULL,
    PriorityCode      nchar(1)      NOT NULL CONSTRAINT DF_Subject_Priority DEFAULT (N'R')
                      CONSTRAINT FK_Subject_Priority REFERENCES ref.Priority (PriorityCode),
    ParentSubjectId   int           NULL CONSTRAINT FK_Subject_Parent REFERENCES lims.Subject (SubjectId),
    PassageNumber     int           NULL CONSTRAINT CK_Subject_Passage CHECK (PassageNumber IS NULL OR PassageNumber >= 0),
    HostStrain        nvarchar(100) NULL,
    Status            nvarchar(20)  NOT NULL CONSTRAINT DF_Subject_Status DEFAULT (N'ACTIVE')
                      CONSTRAINT CK_Subject_Status CHECK (Status IN (N'ACTIVE', N'COMPLETE', N'CANCELLED')),
    IsLegacy          bit           NOT NULL CONSTRAINT DF_Subject_IsLegacy DEFAULT (0),
    ModifiedBy        nvarchar(100) NOT NULL CONSTRAINT DF_Subject_ModifiedBy DEFAULT (SUSER_SNAME()),
    RowVer            rowversion    NOT NULL,
    ValidFrom         datetime2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo           datetime2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),
    CONSTRAINT CK_Subject_Dates CHECK (DeathDate IS NULL OR BirthDate IS NULL OR DeathDate >= BirthDate),
    CONSTRAINT CK_Subject_NotOwnParent CHECK (ParentSubjectId IS NULL OR ParentSubjectId <> SubjectId)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = history.Subject));
-- New PHL numbers are unique. Migrated legacy rows may repeat (PHL allowed reuse across requests).
CREATE UNIQUE INDEX UX_Subject_PhlNumber_New ON lims.Subject (PhlNumber) WHERE IsLegacy = 0;
CREATE INDEX IX_Subject_PhlNumber ON lims.Subject (PhlNumber) INCLUDE (RequestId, StudyId);
CREATE INDEX IX_Subject_Request ON lims.Subject (RequestId);
CREATE INDEX IX_Subject_Study ON lims.Subject (StudyId) WHERE StudyId IS NOT NULL;
CREATE INDEX IX_Subject_Parent ON lims.Subject (ParentSubjectId) WHERE ParentSubjectId IS NOT NULL;
GO

CREATE TABLE lims.Specimen (
    SpecimenId        int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Specimen PRIMARY KEY,
    SubjectId         int           NOT NULL CONSTRAINT FK_Specimen_Subject REFERENCES lims.Subject (SubjectId),
    SpecimenTypeCode  nvarchar(20)  NOT NULL CONSTRAINT FK_Specimen_Type REFERENCES ref.SpecimenType (SpecimenTypeCode),
    OrganOrSite       nvarchar(100) NULL,
    ParentSpecimenId  int           NULL CONSTRAINT FK_Specimen_Parent REFERENCES lims.Specimen (SpecimenId),
    Barcode           varchar(40)   NULL,
    StorageLocation   nvarchar(200) NULL,
    CollectedAt       datetime2(0)  NULL,
    Notes             nvarchar(1000) NULL,
    CreatedAt         datetime2(0)  NOT NULL CONSTRAINT DF_Specimen_CreatedAt DEFAULT (sysutcdatetime())
);
CREATE UNIQUE INDEX UX_Specimen_Barcode ON lims.Specimen (Barcode) WHERE Barcode IS NOT NULL;
CREATE INDEX IX_Specimen_Subject ON lims.Specimen (SubjectId);
GO

CREATE TABLE lims.Block (
    BlockId      int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Block PRIMARY KEY,
    SubjectId    int           NOT NULL CONSTRAINT FK_Block_Subject REFERENCES lims.Subject (SubjectId),
    SpecimenId   int           NULL CONSTRAINT FK_Block_Specimen REFERENCES lims.Specimen (SpecimenId),
    BlockCode    nvarchar(10)  NOT NULL,          -- e.g. B3
    Barcode      varchar(40)   NOT NULL CONSTRAINT UQ_Block_Barcode UNIQUE,  -- e.g. 27000123A-B3
    MediumCode   nvarchar(20)  NULL CONSTRAINT FK_Block_Medium REFERENCES ref.EmbeddingMedium (MediumCode),
    Description  nvarchar(200) NULL,              -- tissues in the block
    CreatedAt    datetime2(0)  NOT NULL CONSTRAINT DF_Block_CreatedAt DEFAULT (sysutcdatetime()),
    CONSTRAINT UQ_Block_SubjectCode UNIQUE (SubjectId, BlockCode)
);
GO

CREATE TABLE lims.Slide (
    SlideId       int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Slide PRIMARY KEY,
    SubjectId     int           NOT NULL CONSTRAINT FK_Slide_Subject REFERENCES lims.Subject (SubjectId),
    BlockId       int           NULL CONSTRAINT FK_Slide_Block REFERENCES lims.Block (BlockId), -- NULL for smears, cytospins, touch preps
    SlideNumber   int           NOT NULL CONSTRAINT CK_Slide_Number CHECK (SlideNumber > 0),
    Barcode       varchar(40)   NOT NULL CONSTRAINT UQ_Slide_Barcode UNIQUE,  -- e.g. 27000123A-B3-S02
    StainOrAssay  nvarchar(100) NULL,
    CreatedAt     datetime2(0)  NOT NULL CONSTRAINT DF_Slide_CreatedAt DEFAULT (sysutcdatetime())
);
CREATE INDEX IX_Slide_Block ON lims.Slide (BlockId) WHERE BlockId IS NOT NULL;
CREATE INDEX IX_Slide_Subject ON lims.Slide (SubjectId);
GO

/* ---------------------------------------------------------------------------
   Number allocation for PHL and request numbers. Replaces PHL's phl_key table,
   which had to be reset by hand each contract year. A counter row per
   (CounterName, Period) is created on first use, so a new year needs no reset.
   Period = 0 for a never-resetting counter, or the 2-digit year when the
   number format is year-prefixed (see docs/adr/0003-identifiers.md).
   --------------------------------------------------------------------------- */
CREATE TABLE lims.NumberCounter (
    CounterName  varchar(40) NOT NULL,
    Period       smallint    NOT NULL,
    NextValue    int         NOT NULL CONSTRAINT CK_NumberCounter_Next CHECK (NextValue > 0),
    CONSTRAINT PK_NumberCounter PRIMARY KEY (CounterName, Period)
);
GO

CREATE OR ALTER PROCEDURE lims.usp_AllocateNumbers
    @CounterName varchar(40),
    @Period      smallint,
    @Count       int,
    @FirstValue  int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @Count IS NULL OR @Count < 1
        THROW 50010, N'Count must be at least 1.', 1;

    BEGIN TRANSACTION;
        -- UPDLOCK + HOLDLOCK serializes concurrent callers, including the first call for a new period.
        UPDATE lims.NumberCounter WITH (UPDLOCK, HOLDLOCK)
           SET @FirstValue = NextValue,          -- column references read the pre-update value
               NextValue   = NextValue + @Count
         WHERE CounterName = @CounterName AND Period = @Period;

        IF @@ROWCOUNT = 0
        BEGIN
            INSERT INTO lims.NumberCounter (CounterName, Period, NextValue)
            VALUES (@CounterName, @Period, 1 + @Count);
            SET @FirstValue = 1;
        END
    COMMIT TRANSACTION;
END
GO
