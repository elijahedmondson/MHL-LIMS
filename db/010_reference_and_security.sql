/* =============================================================================
   MHL LIMS  -  010_reference_and_security.sql
   Reference (lookup) tables and the user/role model.
   Reference rows are seeded by 100_seed_reference_data.sql.
   Convention: a code is never deleted once used; set IsActive = 0 instead
   (replaces PHL's "leading * means inactive" convention).
   ============================================================================= */
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;   -- required for filtered indexes
SET ANSI_NULLS ON;
GO

-- Laboratories. HP = histotechnology (MHL), PA = pathology. Charge codes are prefixed with the lab.
CREATE TABLE ref.Lab (
    LabCode     nvarchar(4)   NOT NULL CONSTRAINT PK_Lab PRIMARY KEY,
    Name        nvarchar(100) NOT NULL,
    SortOrder   int           NOT NULL CONSTRAINT DF_Lab_SortOrder DEFAULT (0),
    IsActive    bit           NOT NULL CONSTRAINT DF_Lab_IsActive DEFAULT (1)
);

-- Work areas a specimen, block or slide moves through (PHL area codes kept for continuity).
CREATE TABLE ref.WorkArea (
    AreaCode     nvarchar(10)  NOT NULL CONSTRAINT PK_WorkArea PRIMARY KEY,
    Name         nvarchar(100) NOT NULL,
    LabCode      nvarchar(4)   NULL CONSTRAINT FK_WorkArea_Lab REFERENCES ref.Lab (LabCode),
    IsTerminal   bit           NOT NULL CONSTRAINT DF_WorkArea_IsTerminal DEFAULT (0), -- reaching it completes the item (QC-PA, ARCHV, INVES)
    SortOrder    int           NOT NULL CONSTRAINT DF_WorkArea_SortOrder DEFAULT (0),
    IsActive     bit           NOT NULL CONSTRAINT DF_WorkArea_IsActive DEFAULT (1)
);

CREATE TABLE ref.RequestType (
    RequestTypeCode  nvarchar(20)  NOT NULL CONSTRAINT PK_RequestType PRIMARY KEY,
    Name             nvarchar(200) NOT NULL,
    LabCode          nvarchar(4)   NOT NULL CONSTRAINT FK_RequestType_Lab REFERENCES ref.Lab (LabCode),
    StartAreaCode    nvarchar(10)  NOT NULL CONSTRAINT FK_RequestType_StartArea REFERENCES ref.WorkArea (AreaCode),
    TurnaroundDays   int           NULL CONSTRAINT CK_RequestType_Turnaround CHECK (TurnaroundDays IS NULL OR TurnaroundDays >= 0),
    SortOrder        int           NOT NULL CONSTRAINT DF_RequestType_SortOrder DEFAULT (0),
    IsActive         bit           NOT NULL CONSTRAINT DF_RequestType_IsActive DEFAULT (1)
);

CREATE TABLE ref.Species (
    SpeciesCode  nvarchar(10)  NOT NULL CONSTRAINT PK_Species PRIMARY KEY,
    Name         nvarchar(100) NOT NULL,
    IsActive     bit           NOT NULL CONSTRAINT DF_Species_IsActive DEFAULT (1)
);

CREATE TABLE ref.Fixative (
    FixativeCode nvarchar(20)  NOT NULL CONSTRAINT PK_Fixative PRIMARY KEY,
    Name         nvarchar(100) NOT NULL,
    IsActive     bit           NOT NULL CONSTRAINT DF_Fixative_IsActive DEFAULT (1)
);

-- R = routine, S = STAT, P = priority (PHL p_priority values)
CREATE TABLE ref.Priority (
    PriorityCode nchar(1)      NOT NULL CONSTRAINT PK_Priority PRIMARY KEY,
    Name         nvarchar(50)  NOT NULL,
    SortOrder    int           NOT NULL CONSTRAINT DF_Priority_SortOrder DEFAULT (0)
);

-- MOUSE, RAT, HUMAN_DONOR, PDX_MODEL, ORGANOID_LINE, CELL_LINE, OTHER
CREATE TABLE ref.SubjectType (
    SubjectTypeCode    nvarchar(20)  NOT NULL CONSTRAINT PK_SubjectType PRIMARY KEY,
    Name               nvarchar(100) NOT NULL,
    IsRestrictedAccess bit           NOT NULL CONSTRAINT DF_SubjectType_Restricted DEFAULT (0), -- human material: restricted role only
    IsActive           bit           NOT NULL CONSTRAINT DF_SubjectType_IsActive DEFAULT (1)
);

CREATE TABLE ref.SpecimenType (
    SpecimenTypeCode nvarchar(20)  NOT NULL CONSTRAINT PK_SpecimenType PRIMARY KEY,
    Name             nvarchar(100) NOT NULL,
    IsActive         bit           NOT NULL CONSTRAINT DF_SpecimenType_IsActive DEFAULT (1)
);

CREATE TABLE ref.EmbeddingMedium (
    MediumCode   nvarchar(20)  NOT NULL CONSTRAINT PK_EmbeddingMedium PRIMARY KEY,
    Name         nvarchar(100) NOT NULL,
    IsActive     bit           NOT NULL CONSTRAINT DF_EmbeddingMedium_IsActive DEFAULT (1)
);

-- Billing sections of the price list (NECRO, BLOOD, TRIM_EMBED, MICROTOMY, STAIN, IMAGE, PATH).
CREATE TABLE ref.ServiceSection (
    SectionCode     nvarchar(20)  NOT NULL CONSTRAINT PK_ServiceSection PRIMARY KEY,
    Name            nvarchar(100) NOT NULL,
    DefaultAreaCode nvarchar(10)  NOT NULL CONSTRAINT FK_ServiceSection_Area REFERENCES ref.WorkArea (AreaCode),
    SortOrder       int           NOT NULL CONSTRAINT DF_ServiceSection_SortOrder DEFAULT (0)
);
GO

/* ---------------------------------------------------------------------------
   Users and roles. Authentication is NIH single sign-on; this table only maps
   an AD account to display data, initials (used on worksheets and tracking)
   and roles. There are no application passwords.
   --------------------------------------------------------------------------- */
CREATE TABLE sec.AppUser (
    UserId        int IDENTITY(1,1) NOT NULL CONSTRAINT PK_AppUser PRIMARY KEY,
    AdAccount     nvarchar(100) NOT NULL CONSTRAINT UQ_AppUser_AdAccount UNIQUE,   -- e.g. NIH\jdoe
    DisplayName   nvarchar(200) NOT NULL,
    Initials      nvarchar(4)   NOT NULL,
    Email         nvarchar(256) NULL,
    IsPathologist bit           NOT NULL CONSTRAINT DF_AppUser_IsPathologist DEFAULT (0),
    IsActive      bit           NOT NULL CONSTRAINT DF_AppUser_IsActive DEFAULT (1),
    CreatedAt     datetime2(0)  NOT NULL CONSTRAINT DF_AppUser_CreatedAt DEFAULT (sysutcdatetime())
);
CREATE UNIQUE INDEX UX_AppUser_Initials_Active ON sec.AppUser (Initials) WHERE IsActive = 1;

CREATE TABLE sec.Role (
    RoleCode     nvarchar(30)  NOT NULL CONSTRAINT PK_Role PRIMARY KEY,
    Name         nvarchar(100) NOT NULL,
    Description  nvarchar(400) NULL
);

CREATE TABLE sec.UserRole (
    UserId    int          NOT NULL CONSTRAINT FK_UserRole_User REFERENCES sec.AppUser (UserId),
    RoleCode  nvarchar(30) NOT NULL CONSTRAINT FK_UserRole_Role REFERENCES sec.Role (RoleCode),
    GrantedAt datetime2(0) NOT NULL CONSTRAINT DF_UserRole_GrantedAt DEFAULT (sysutcdatetime()),
    GrantedBy nvarchar(100) NULL,
    CONSTRAINT PK_UserRole PRIMARY KEY (UserId, RoleCode)
);
GO
