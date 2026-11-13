/* =============================================================================
   MHL LIMS  -  060_ihc.sql
   The IHC assay catalog and IHC requests from the investigator form. Replaces
   the IHC department's request site (phlrequest.ncifcrf.gov, "MHL Request
   System - Molecular Histology Request") and its assay database.

   Worked out in the pilot (lims/pilot): see core/ihc.mjs for the rules and
   docs/ihc-catalog-review.md for what the CSV export needed repairing.
   - An assay is one validated protocol (antibody + dilution + retrieval + ...).
     Kind, plex, chromogen, platform and the species/fixative tags are derived
     from the text fields by MhlLims.Domain.Ihc.IhcCatalogRules and stored so
     they can be queried ("assays validated for mouse NBF tissue").
   - A double stain is an assay whose two components are other assays.
   - What the import repaired (dilutions Excel stored as times, names stored as
     dates, duplicates) is kept as review flags until someone checks them.
   - An investigator's request keeps each stain's protocol as it was when the
     request was submitted (ProtocolSnapshotJson); the catalog can change later.
   - Accepting a request creates a LIMS request (lims.Request) with one PHL
     number per sample. IHC request numbers (MH26-0151) come from
     lims.usp_AllocateNumbers with CounterName = 'MH' and Period = 2-digit year.
   ============================================================================= */
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;   -- required for filtered indexes
SET ANSI_NULLS ON;
GO

CREATE TABLE ihc.Assay (
    AssayId              int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Assay PRIMARY KEY,
    Name                 nvarchar(200) NOT NULL,          -- antibody or panel, e.g. "CD8", "6-plex CD4+CD8+FoxP3+PDL1+Ki67+CK(AE1/AE3)"
    Dilution             nvarchar(200) NULL,              -- "Dilution & Time" column, e.g. "1:100 60'"
    AntigenRetrieval     nvarchar(600) NULL,
    ProteolyticDigestion nvarchar(200) NULL,
    DetectionKit         nvarchar(600) NULL,              -- "2° AB Kit" column
    Fixative             nvarchar(200) NULL,              -- as validated, free text; see AssayFixativeTag
    Species              nvarchar(200) NULL,              -- as validated, free text; see AssaySpeciesTag
    ControlTissue        nvarchar(600) NULL,
    Manufacturer         nvarchar(200) NULL,
    CatalogNumber        nvarchar(200) NULL,
    -- Added in the LIMS at the IHC department's request; the export has no columns for them.
    Clone                nvarchar(60)  NULL,              -- "N/A" for a polyclonal antibody or a kit
    Host                 nvarchar(30)  NULL,
    Clonality            nvarchar(20)  NULL CONSTRAINT CK_Assay_Clonality CHECK (Clonality IN (N'Monoclonal', N'Polyclonal', N'Not applicable')),
    PlatformSet          nvarchar(20)  NULL CONSTRAINT CK_Assay_PlatformSet CHECK (PlatformSet IN (N'Manual', N'Leica Bond', N'Ventana')),   -- NULL = worked out from the text
    ChromogenSet         nvarchar(20)  NULL CONSTRAINT CK_Assay_ChromogenSet CHECK (ChromogenSet IN (N'DAB', N'Red', N'DAB + Red', N'Fluorescent', N'X-gal')),
    Visibility           nvarchar(10)  NOT NULL CONSTRAINT DF_Assay_Visibility DEFAULT (N'PUBLIC') CONSTRAINT CK_Assay_Visibility CHECK (Visibility IN (N'PUBLIC', N'INTERNAL')),
    IsPreferred          bit           NOT NULL CONSTRAINT DF_Assay_IsPreferred DEFAULT (0),
    Result               nvarchar(12)  NULL CONSTRAINT CK_Assay_Result CHECK (Result IN (N'WORKS', N'OPTIMIZING', N'FAILED')),   -- NULL = not recorded
    Kind                 nvarchar(10)  NOT NULL CONSTRAINT CK_Assay_Kind CHECK (Kind IN (N'IHC', N'OPAL', N'IF', N'TUNEL', N'BETA_GAL')),
    Plex                 int           NOT NULL CONSTRAINT DF_Assay_Plex DEFAULT (1) CONSTRAINT CK_Assay_Plex CHECK (Plex BETWEEN 1 AND 9),
    Chromogen            nvarchar(30)  NOT NULL CONSTRAINT DF_Assay_Chromogen DEFAULT (N'DAB'),
    Platform             nvarchar(20)  NOT NULL CONSTRAINT DF_Assay_Platform DEFAULT (N'Manual'),   -- Leica Bond, Ventana, Manual, Mixed
    Status               nvarchar(10)  NOT NULL CONSTRAINT DF_Assay_Status DEFAULT (N'ACTIVE')
                         CONSTRAINT CK_Assay_Status CHECK (Status IN (N'ACTIVE', N'DUPLICATE', N'RETIRED')),
    DuplicateOfAssayId   int           NULL CONSTRAINT FK_Assay_DuplicateOf REFERENCES ihc.Assay (AssayId),
    Notes                nvarchar(1000) NULL,
    SourceReference      nvarchar(100) NULL,              -- e.g. "MHL IHC database.csv line 159, list 1"
    LegacyAssayKey       nvarchar(50)  NULL,              -- the phlrequest database key, once the database itself is migrated
    ModifiedBy           nvarchar(100) NOT NULL CONSTRAINT DF_Assay_ModifiedBy DEFAULT (SUSER_SNAME()),
    ValidFrom            datetime2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo              datetime2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),
    CONSTRAINT CK_Assay_DuplicateHasOriginal CHECK (Status <> N'DUPLICATE' OR DuplicateOfAssayId IS NOT NULL)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = history.Assay));
CREATE INDEX IX_Assay_Name ON ihc.Assay (Name) INCLUDE (Status, Kind, Plex);
CREATE INDEX IX_Assay_Catalog ON ihc.Assay (CatalogNumber) WHERE CatalogNumber IS NOT NULL;
CREATE UNIQUE INDEX UX_Assay_LegacyKey ON ihc.Assay (LegacyAssayKey) WHERE LegacyAssayKey IS NOT NULL;
GO

-- A double stain (or any composite) and the assays it is made of, in staining order.
CREATE TABLE ihc.AssayComponent (
    AssayId           int     NOT NULL CONSTRAINT FK_AssayComponent_Assay REFERENCES ihc.Assay (AssayId),
    ComponentAssayId  int     NOT NULL CONSTRAINT FK_AssayComponent_Component REFERENCES ihc.Assay (AssayId),
    StainOrder        int     NOT NULL CONSTRAINT CK_AssayComponent_Order CHECK (StainOrder >= 1),
    CONSTRAINT PK_AssayComponent PRIMARY KEY (AssayId, StainOrder),
    CONSTRAINT CK_AssayComponent_NotSelf CHECK (ComponentAssayId <> AssayId)
);
CREATE INDEX IX_AssayComponent_Component ON ihc.AssayComponent (ComponentAssayId);
GO

-- Standard terms read from the free-text Species and Fixative, so assays can be matched to a sample.
CREATE TABLE ihc.AssaySpeciesTag (
    AssayId  int          NOT NULL CONSTRAINT FK_AssaySpeciesTag_Assay REFERENCES ihc.Assay (AssayId),
    Tag      nvarchar(30) NOT NULL CONSTRAINT CK_AssaySpeciesTag_Tag CHECK (Tag IN (N'Mouse', N'Human', N'Human xenograft', N'Humanized mouse', N'Rat', N'Canine',
                                   N'Rhesus macaque', N'Marmoset', N'Porcine', N'Woodchuck', N'Zebrafish')),
    CONSTRAINT PK_AssaySpeciesTag PRIMARY KEY (AssayId, Tag)
);
CREATE INDEX IX_AssaySpeciesTag_Tag ON ihc.AssaySpeciesTag (Tag);

CREATE TABLE ihc.AssayFixativeTag (
    AssayId  int          NOT NULL CONSTRAINT FK_AssayFixativeTag_Assay REFERENCES ihc.Assay (AssayId),
    Tag      nvarchar(30) NOT NULL CONSTRAINT CK_AssayFixativeTag_Tag CHECK (Tag IN (N'NBF', N'PFA', N'Frozen', N'Zinc formalin', N'Ethanol', N'Methanol',
                                   N'Bouin''s', N'Carnoy''s', N'Methacarn', N'Telly''s', N'Davidson''s')),
    CONSTRAINT PK_AssayFixativeTag PRIMARY KEY (AssayId, Tag)
);
CREATE INDEX IX_AssayFixativeTag_Tag ON ihc.AssayFixativeTag (Tag);
GO

-- Something about an assay that needs checking, e.g. a dilution recovered from Excel's time format.
-- Cleared (not deleted) when someone checks it, so the repair stays on record.
CREATE TABLE ihc.AssayFlag (
    AssayFlagId    int IDENTITY(1,1) NOT NULL CONSTRAINT PK_AssayFlag PRIMARY KEY,
    AssayId        int           NOT NULL CONSTRAINT FK_AssayFlag_Assay REFERENCES ihc.Assay (AssayId),
    FlagCode       nvarchar(30)  NOT NULL CONSTRAINT CK_AssayFlag_Code CHECK (FlagCode IN (N'DILUTION_RECOVERED', N'NAME_RECOVERED', N'DUPLICATE', N'SPECIES_BLANK',
                                 N'SPECIES_UNRECOGNIZED', N'DOUBLE_INCOMPLETE', N'DOUBLE_SAME', N'RETRIEVAL_BLANK')),
    StoredValue    nvarchar(200) NULL,          -- what the export held before the repair, e.g. 0.111111111
    RaisedAt       datetime2(0)  NOT NULL CONSTRAINT DF_AssayFlag_RaisedAt DEFAULT (sysutcdatetime()),
    ClearedAt      datetime2(0)  NULL,
    ClearedBy      nvarchar(100) NULL,
    CONSTRAINT CK_AssayFlag_Cleared CHECK (ClearedAt IS NULL OR ClearedBy IS NOT NULL)
);
CREATE INDEX IX_AssayFlag_Open ON ihc.AssayFlag (AssayId) WHERE ClearedAt IS NULL;
GO

/* ---------------------------------------------------------------------------
   IHC requests from the investigator form. The form's seven steps:
   1 requester, 2 material, 3 samples, 4 H&E and unstained slides, 5 stains,
   6 imaging, 7 additional information.
   --------------------------------------------------------------------------- */
CREATE TABLE ihc.IhcRequest (
    IhcRequestId          int IDENTITY(1,1) NOT NULL CONSTRAINT PK_IhcRequest PRIMARY KEY,
    RequestNumber         nvarchar(20)  NOT NULL CONSTRAINT UQ_IhcRequest_Number UNIQUE,   -- MH26-0151
    Status                nvarchar(10)  NOT NULL CONSTRAINT DF_IhcRequest_Status DEFAULT (N'SUBMITTED')
                          CONSTRAINT CK_IhcRequest_Status CHECK (Status IN (N'SUBMITTED', N'ACCEPTED', N'DECLINED')),
    SubmittedAt           datetime2(0)  NOT NULL CONSTRAINT DF_IhcRequest_SubmittedAt DEFAULT (sysutcdatetime()),
    SubmittedByAccount    nvarchar(100) NULL,          -- the investigator's NIH account, from single sign-on
    -- 1. requester (as submitted; InvestigatorId once matched to the investigator list)
    InvestigatorId        int           NULL CONSTRAINT FK_IhcRequest_Investigator REFERENCES lims.Investigator (InvestigatorId),
    RequesterLastName     nvarchar(100) NOT NULL,
    RequesterFirstName    nvarchar(100) NULL,
    RequesterInstitute    nvarchar(200) NULL,
    BuildingRoom          nvarchar(40)  NULL,
    Phone                 nvarchar(30)  NULL,
    Email                 nvarchar(256) NOT NULL,
    BillTo                nvarchar(100) NOT NULL,
    CostpointProjectId    nvarchar(40)  NOT NULL,
    AcucProtocol          nvarchar(50)  NULL,
    PathologistUserId     int           NULL CONSTRAINT FK_IhcRequest_Pathologist REFERENCES sec.AppUser (UserId),   -- NULL = any MHL pathologist
    Importance            nvarchar(10)  NOT NULL CONSTRAINT DF_IhcRequest_Importance DEFAULT (N'ROUTINE')
                          CONSTRAINT CK_IhcRequest_Importance CHECK (Importance IN (N'ROUTINE', N'STAT')),
    -- 2. material
    SpeciesChoice         nvarchar(20)  NOT NULL CONSTRAINT CK_IhcRequest_Species CHECK (SpeciesChoice IN (N'Mouse', N'Rat', N'Human', N'PDX', N'Organoid', N'Canine', N'Other')),
    FixativeUsed          nvarchar(40)  NOT NULL,
    FixativeSubmittedIn   nvarchar(40)  NULL,
    DateIntoFixative      date          NULL,
    -- 4. general procedures
    HeSlidesPerBlock         int        NOT NULL CONSTRAINT DF_IhcRequest_He DEFAULT (0) CONSTRAINT CK_IhcRequest_He CHECK (HeSlidesPerBlock <= 10),
    UnstainedSlidesPerBlock  int        NOT NULL CONSTRAINT DF_IhcRequest_Unstained DEFAULT (0) CONSTRAINT CK_IhcRequest_Unstained CHECK (UnstainedSlidesPerBlock <= 20),
    -- 6. imaging, 7. additional information
    Scan20x               bit           NOT NULL CONSTRAINT DF_IhcRequest_Scan20 DEFAULT (0),
    Scan40x               bit           NOT NULL CONSTRAINT DF_IhcRequest_Scan40 DEFAULT (0),
    AdditionalInformation nvarchar(2000) NULL,
    CopiedFromIhcRequestId int          NULL CONSTRAINT FK_IhcRequest_CopiedFrom REFERENCES ihc.IhcRequest (IhcRequestId),
    -- review by the IHC team
    LimsRequestId         int           NULL CONSTRAINT FK_IhcRequest_LimsRequest REFERENCES lims.Request (RequestId),
    AcceptedByUserId      int           NULL CONSTRAINT FK_IhcRequest_AcceptedBy REFERENCES sec.AppUser (UserId),
    AcceptedAt            datetime2(0)  NULL,
    DeclinedByUserId      int           NULL CONSTRAINT FK_IhcRequest_DeclinedBy REFERENCES sec.AppUser (UserId),
    DeclinedAt            datetime2(0)  NULL,
    DeclineReason         nvarchar(500) NULL,
    LegacyWebId           nvarchar(30)  NULL,          -- PHL's r_web_id, for requests migrated from phlrequest
    ModifiedBy            nvarchar(100) NOT NULL CONSTRAINT DF_IhcRequest_ModifiedBy DEFAULT (SUSER_SNAME()),
    RowVer                rowversion    NOT NULL,
    ValidFrom             datetime2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo               datetime2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),
    CONSTRAINT CK_IhcRequest_Accepted CHECK (Status <> N'ACCEPTED' OR (LimsRequestId IS NOT NULL AND AcceptedByUserId IS NOT NULL AND AcceptedAt IS NOT NULL)),
    CONSTRAINT CK_IhcRequest_Declined CHECK (Status <> N'DECLINED' OR (DeclineReason IS NOT NULL AND DeclinedByUserId IS NOT NULL AND DeclinedAt IS NOT NULL))
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = history.IhcRequest));
CREATE INDEX IX_IhcRequest_Status ON ihc.IhcRequest (Status, SubmittedAt);
CREATE INDEX IX_IhcRequest_LimsRequest ON ihc.IhcRequest (LimsRequestId) WHERE LimsRequestId IS NOT NULL;
CREATE UNIQUE INDEX UX_IhcRequest_LegacyWebId ON ihc.IhcRequest (LegacyWebId) WHERE LegacyWebId IS NOT NULL;
GO

-- 3. samples: one row per block; each becomes a PHL number when the request is accepted.
CREATE TABLE ihc.IhcRequestSample (
    IhcRequestSampleId  int IDENTITY(1,1) NOT NULL CONSTRAINT PK_IhcRequestSample PRIMARY KEY,
    IhcRequestId        int           NOT NULL CONSTRAINT FK_IhcRequestSample_Request REFERENCES ihc.IhcRequest (IhcRequestId),
    SampleNumber        int           NOT NULL CONSTRAINT CK_IhcRequestSample_Number CHECK (SampleNumber >= 1),
    Tissue              nvarchar(60)  NOT NULL,
    AnimalOrBlockNo     nvarchar(30)  NULL,
    SampleType          nvarchar(10)  NOT NULL CONSTRAINT CK_IhcRequestSample_Type CHECK (SampleType IN (N'FIXED', N'FROZEN', N'BLOCK', N'SLIDES')),
    SubjectId           int           NULL CONSTRAINT FK_IhcRequestSample_Subject REFERENCES lims.Subject (SubjectId),        -- the PHL number issued on accept
    SourceSubjectId     int           NULL CONSTRAINT FK_IhcRequestSample_Source REFERENCES lims.Subject (SubjectId),        -- the existing PHL number, when the block is already at MHL
    CONSTRAINT UQ_IhcRequestSample UNIQUE (IhcRequestId, SampleNumber)
);
CREATE INDEX IX_IhcRequestSample_Source ON ihc.IhcRequestSample (SourceSubjectId) WHERE SourceSubjectId IS NOT NULL;
GO

-- 5. stains: a catalog assay, or a new antibody the IHC team must optimize first.
CREATE TABLE ihc.IhcRequestStain (
    IhcRequestStainId        int IDENTITY(1,1) NOT NULL CONSTRAINT PK_IhcRequestStain PRIMARY KEY,
    IhcRequestId             int           NOT NULL CONSTRAINT FK_IhcRequestStain_Request REFERENCES ihc.IhcRequest (IhcRequestId),
    StainNumber              int           NOT NULL CONSTRAINT CK_IhcRequestStain_Number CHECK (StainNumber >= 1),
    AssayId                  int           NULL CONSTRAINT FK_IhcRequestStain_Assay REFERENCES ihc.Assay (AssayId),
    Chromogen                nvarchar(30)  NOT NULL CONSTRAINT DF_IhcRequestStain_Chromogen DEFAULT (N'DAB'),
    ProtocolSnapshotJson     nvarchar(max) NULL CONSTRAINT CK_IhcRequestStain_Snapshot CHECK (ProtocolSnapshotJson IS NULL OR ISJSON(ProtocolSnapshotJson) = 1),
    NewAntibodyName          nvarchar(120) NULL,
    NewAntibodyManufacturer  nvarchar(120) NULL,
    NewAntibodyCatalog       nvarchar(60)  NULL,
    NewAntibodyHost          nvarchar(60)  NULL,
    RequesterSuppliesAntibody bit          NOT NULL CONSTRAINT DF_IhcRequestStain_Supplied DEFAULT (0),
    NewAntibodyNotes         nvarchar(500) NULL,
    CONSTRAINT UQ_IhcRequestStain UNIQUE (IhcRequestId, StainNumber),
    CONSTRAINT CK_IhcRequestStain_AssayOrNew CHECK ((AssayId IS NOT NULL AND NewAntibodyName IS NULL AND ProtocolSnapshotJson IS NOT NULL)
                                                  OR (AssayId IS NULL AND NewAntibodyName IS NOT NULL AND NewAntibodyManufacturer IS NOT NULL))
);
CREATE INDEX IX_IhcRequestStain_Assay ON ihc.IhcRequestStain (AssayId) WHERE AssayId IS NOT NULL;
GO

-- Requests waiting for the IHC team, with what the worklist shows.
CREATE OR ALTER VIEW ihc.vIhcRequestQueue
AS
SELECT r.IhcRequestId, r.RequestNumber, r.Status, r.SubmittedAt, r.Importance,
       r.RequesterLastName, r.RequesterFirstName, r.SpeciesChoice,
       (SELECT COUNT(*) FROM ihc.IhcRequestSample s WHERE s.IhcRequestId = r.IhcRequestId) AS Samples,
       (SELECT COUNT(*) FROM ihc.IhcRequestStain t WHERE t.IhcRequestId = r.IhcRequestId) AS Stains,
       (SELECT COUNT(*) FROM ihc.IhcRequestStain t WHERE t.IhcRequestId = r.IhcRequestId AND t.AssayId IS NULL) AS NewAntibodies,
       r.LimsRequestId
FROM ihc.IhcRequest AS r;
GO
