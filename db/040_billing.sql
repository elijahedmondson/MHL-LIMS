/* =============================================================================
   MHL LIMS  -  040_billing.sql
   Charge codes, effective-dated price lists, estimates, charge lines, billing
   batches and billing QC reviews.

   Design (see docs/adr/0004-price-list-and-charges.md):
   - Prices live in rows, not in character positions of a description.
   - A price list is DRAFT until approved; approved lists cannot be edited and
     cannot overlap in time. A new year = a new price list.
   - A charge line copies the unit price in effect on its charge date.
   - Lines go PENDING -> APPROVED (billing QC) -> RELEASED (in a billing batch).
     Released lines are locked. Corrections are ADJUSTMENT lines that point at
     the original; nothing is deleted (VOID before release).
   ============================================================================= */
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;   -- required for filtered indexes
SET ANSI_NULLS ON;
GO

CREATE TABLE billing.ChargeCode (
    ChargeCode           nvarchar(10)  NOT NULL CONSTRAINT PK_ChargeCode PRIMARY KEY,  -- e.g. HP002001
    LabCode              nvarchar(4)   NOT NULL CONSTRAINT FK_ChargeCode_Lab REFERENCES ref.Lab (LabCode),
    Description          nvarchar(200) NOT NULL,
    UnitOfMeasure        nvarchar(40)  NOT NULL,        -- animal, slide, block, quarter hour, dollar unit ...
    RequiresDescription  bit           NOT NULL CONSTRAINT DF_ChargeCode_RequiresDescription DEFAULT (0), -- "(DEFINE)" items
    IsActive             bit           NOT NULL CONSTRAINT DF_ChargeCode_IsActive DEFAULT (1),
    ModifiedBy           nvarchar(100) NOT NULL CONSTRAINT DF_ChargeCode_ModifiedBy DEFAULT (SUSER_SNAME()),
    ValidFrom            datetime2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo              datetime2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = history.ChargeCode));
GO

-- Which sections of the price list a code appears in (labor HP009002 appears in six).
CREATE TABLE billing.ChargeCodeSection (
    ChargeCode   nvarchar(10) NOT NULL CONSTRAINT FK_ChargeCodeSection_Code REFERENCES billing.ChargeCode (ChargeCode),
    SectionCode  nvarchar(20) NOT NULL CONSTRAINT FK_ChargeCodeSection_Section REFERENCES ref.ServiceSection (SectionCode),
    SortOrder    int          NOT NULL CONSTRAINT DF_ChargeCodeSection_SortOrder DEFAULT (0),
    CONSTRAINT PK_ChargeCodeSection PRIMARY KEY (ChargeCode, SectionCode)
);
GO

CREATE TABLE billing.PriceList (
    PriceListId       int IDENTITY(1,1) NOT NULL CONSTRAINT PK_PriceList PRIMARY KEY,
    Name              nvarchar(50)  NOT NULL CONSTRAINT UQ_PriceList_Name UNIQUE,  -- e.g. CY2027
    EffectiveFrom     date          NOT NULL,
    EffectiveTo       date          NULL,      -- exclusive; NULL = open-ended
    Status            nvarchar(10)  NOT NULL CONSTRAINT DF_PriceList_Status DEFAULT (N'DRAFT')
                      CONSTRAINT CK_PriceList_Status CHECK (Status IN (N'DRAFT', N'APPROVED', N'RETIRED')),
    ApprovedByUserId  int           NULL CONSTRAINT FK_PriceList_ApprovedBy REFERENCES sec.AppUser (UserId),
    ApprovedAt        datetime2(0)  NULL,
    SourceFile        nvarchar(260) NULL,
    Notes             nvarchar(max) NULL,
    CONSTRAINT CK_PriceList_Range CHECK (EffectiveTo IS NULL OR EffectiveTo > EffectiveFrom),
    CONSTRAINT CK_PriceList_Approval CHECK (Status = N'DRAFT' OR (ApprovedByUserId IS NOT NULL AND ApprovedAt IS NOT NULL))
);
GO

CREATE OR ALTER TRIGGER billing.TR_PriceList_NoOverlap
ON billing.PriceList
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1
        FROM billing.PriceList AS a
        JOIN billing.PriceList AS b ON a.PriceListId < b.PriceListId
        WHERE a.Status = N'APPROVED' AND b.Status = N'APPROVED'
          AND a.EffectiveFrom < ISNULL(b.EffectiveTo, '9999-12-31')
          AND b.EffectiveFrom < ISNULL(a.EffectiveTo, '9999-12-31'))
        THROW 50020, N'Approved price lists may not have overlapping effective dates.', 1;
END
GO

CREATE TABLE billing.PriceListItem (
    PriceListId  int           NOT NULL CONSTRAINT FK_PriceListItem_List REFERENCES billing.PriceList (PriceListId),
    ChargeCode   nvarchar(10)  NOT NULL CONSTRAINT FK_PriceListItem_Code REFERENCES billing.ChargeCode (ChargeCode),
    UnitPrice    decimal(10,2) NULL CONSTRAINT CK_PriceListItem_Price CHECK (UnitPrice IS NULL OR UnitPrice >= 0), -- NULL = not priced
    ModifiedBy   nvarchar(100) NOT NULL CONSTRAINT DF_PriceListItem_ModifiedBy DEFAULT (SUSER_SNAME()),
    ValidFrom    datetime2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo      datetime2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),
    CONSTRAINT PK_PriceListItem PRIMARY KEY (PriceListId, ChargeCode)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = history.PriceListItem));
GO

-- Items of an approved or retired list are frozen.
CREATE OR ALTER TRIGGER billing.TR_PriceListItem_Frozen
ON billing.PriceListItem
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1 FROM (SELECT PriceListId FROM inserted UNION SELECT PriceListId FROM deleted) AS x
        JOIN billing.PriceList AS p ON p.PriceListId = x.PriceListId
        WHERE p.Status <> N'DRAFT')
        THROW 50021, N'Prices on an approved or retired price list cannot be changed. Create a new price list.', 1;
END
GO

/* Automatic charge rules, configurable without code changes.
   STAT_SURCHARGE:        {"perSubject": true, "units": 1}   (legacy PHL code <lab>009050)
   IMAGE_ANALYSIS_LABOR:  {"laborUnitsPerBlock": 4, "imagesPerBlock": 6, "rounding": "ProportionalRoundUp"}
   Both are seeded DISABLED until the billing administrator confirms them. */
CREATE TABLE billing.ChargeRule (
    RuleCode        nvarchar(40)  NOT NULL CONSTRAINT PK_ChargeRule PRIMARY KEY,
    RuleType        nvarchar(30)  NOT NULL CONSTRAINT CK_ChargeRule_Type CHECK (RuleType IN (N'STAT_SURCHARGE', N'IMAGE_ANALYSIS_LABOR')),
    IsEnabled       bit           NOT NULL CONSTRAINT DF_ChargeRule_IsEnabled DEFAULT (0),
    ChargeCode      nvarchar(10)  NULL CONSTRAINT FK_ChargeRule_Code REFERENCES billing.ChargeCode (ChargeCode),
    ParametersJson  nvarchar(max) NOT NULL CONSTRAINT CK_ChargeRule_Json CHECK (ISJSON(ParametersJson) = 1),
    Notes           nvarchar(1000) NULL,
    ModifiedBy      nvarchar(100) NOT NULL CONSTRAINT DF_ChargeRule_ModifiedBy DEFAULT (SUSER_SNAME()),
    CONSTRAINT CK_ChargeRule_EnabledHasCode CHECK (IsEnabled = 0 OR ChargeCode IS NOT NULL)
);
GO

-- Planned units per request (the "PLANNED" column of the billing worksheet); drives the initial cost estimate.
CREATE TABLE billing.EstimateLine (
    EstimateLineId   int IDENTITY(1,1) NOT NULL CONSTRAINT PK_EstimateLine PRIMARY KEY,
    RequestId        int           NOT NULL CONSTRAINT FK_EstimateLine_Request REFERENCES lims.Request (RequestId),
    SectionCode      nvarchar(20)  NOT NULL CONSTRAINT FK_EstimateLine_Section REFERENCES ref.ServiceSection (SectionCode),
    ChargeCode       nvarchar(10)  NOT NULL CONSTRAINT FK_EstimateLine_Code REFERENCES billing.ChargeCode (ChargeCode),
    PriceListId      int           NOT NULL CONSTRAINT FK_EstimateLine_List REFERENCES billing.PriceList (PriceListId),
    PlannedUnits     decimal(9,2)  NOT NULL CONSTRAINT CK_EstimateLine_Units CHECK (PlannedUnits > 0),
    UnitPrice        decimal(10,2) NOT NULL,
    Amount           AS CAST(ROUND(PlannedUnits * UnitPrice, 2) AS decimal(12,2)) PERSISTED,
    Description      nvarchar(500) NULL,
    CreatedBy        nvarchar(100) NOT NULL CONSTRAINT DF_EstimateLine_CreatedBy DEFAULT (SUSER_SNAME()),
    CreatedAt        datetime2(0)  NOT NULL CONSTRAINT DF_EstimateLine_CreatedAt DEFAULT (sysutcdatetime())
);
CREATE INDEX IX_EstimateLine_Request ON billing.EstimateLine (RequestId);
GO

CREATE TABLE billing.BillingBatch (
    BillingBatchId    int IDENTITY(1,1) NOT NULL CONSTRAINT PK_BillingBatch PRIMARY KEY,
    LabCode           nvarchar(4)   NOT NULL CONSTRAINT FK_BillingBatch_Lab REFERENCES ref.Lab (LabCode),
    PeriodStart       date          NOT NULL,
    PeriodEnd         date          NOT NULL,     -- inclusive
    Status            nvarchar(10)  NOT NULL CONSTRAINT DF_BillingBatch_Status DEFAULT (N'OPEN')
                      CONSTRAINT CK_BillingBatch_Status CHECK (Status IN (N'OPEN', N'RELEASED')),
    CreatedByUserId   int           NOT NULL CONSTRAINT FK_BillingBatch_CreatedBy REFERENCES sec.AppUser (UserId),
    CreatedAt         datetime2(0)  NOT NULL CONSTRAINT DF_BillingBatch_CreatedAt DEFAULT (sysutcdatetime()),
    ReleasedByUserId  int           NULL CONSTRAINT FK_BillingBatch_ReleasedBy REFERENCES sec.AppUser (UserId),
    ReleasedAt        datetime2(0)  NULL,
    ExportFormat      nvarchar(20)  NULL,         -- RPT080 initially
    ExportFileName    nvarchar(260) NULL,
    LineCount         int           NULL,
    TotalAmount       decimal(14,2) NULL,
    CONSTRAINT CK_BillingBatch_Period CHECK (PeriodEnd >= PeriodStart),
    CONSTRAINT CK_BillingBatch_Released CHECK (Status = N'OPEN' OR (ReleasedByUserId IS NOT NULL AND ReleasedAt IS NOT NULL))
);
GO

CREATE TABLE billing.ChargeLine (
    ChargeLineId         int IDENTITY(1,1) NOT NULL CONSTRAINT PK_ChargeLine PRIMARY KEY,
    RequestId            int           NOT NULL CONSTRAINT FK_ChargeLine_Request REFERENCES lims.Request (RequestId),
    SubjectId            int           NULL CONSTRAINT FK_ChargeLine_Subject REFERENCES lims.Subject (SubjectId),
    SectionCode          nvarchar(20)  NOT NULL CONSTRAINT FK_ChargeLine_Section REFERENCES ref.ServiceSection (SectionCode),
    ChargeCode           nvarchar(10)  NOT NULL CONSTRAINT FK_ChargeLine_Code REFERENCES billing.ChargeCode (ChargeCode),
    PriceListId          int           NOT NULL CONSTRAINT FK_ChargeLine_List REFERENCES billing.PriceList (PriceListId),
    ChargeDate           date          NOT NULL,
    Units                decimal(9,2)  NOT NULL CONSTRAINT CK_ChargeLine_UnitsNonZero CHECK (Units <> 0),
    UnitPrice            decimal(10,2) NOT NULL CONSTRAINT CK_ChargeLine_Price CHECK (UnitPrice >= 0),
    Amount               AS CAST(ROUND(Units * UnitPrice, 2) AS decimal(12,2)) PERSISTED,
    Description          nvarchar(500) NULL,
    SourceType           nvarchar(12)  NOT NULL CONSTRAINT CK_ChargeLine_Source
                         CHECK (SourceType IN (N'MANUAL', N'EVENT', N'RULE', N'ADJUSTMENT', N'MIGRATED')),
    SourceEventId        bigint        NULL CONSTRAINT FK_ChargeLine_Event REFERENCES trk.TrackingEvent (EventId),
    RuleCode             nvarchar(40)  NULL CONSTRAINT FK_ChargeLine_Rule REFERENCES billing.ChargeRule (RuleCode),
    Status               nvarchar(10)  NOT NULL CONSTRAINT DF_ChargeLine_Status DEFAULT (N'PENDING')
                         CONSTRAINT CK_ChargeLine_Status CHECK (Status IN (N'PENDING', N'APPROVED', N'RELEASED', N'VOID')),
    AdjustsChargeLineId  int           NULL CONSTRAINT FK_ChargeLine_Adjusts REFERENCES billing.ChargeLine (ChargeLineId),
    BillingBatchId       int           NULL CONSTRAINT FK_ChargeLine_Batch REFERENCES billing.BillingBatch (BillingBatchId),
    EnteredByUserId      int           NOT NULL CONSTRAINT FK_ChargeLine_EnteredBy REFERENCES sec.AppUser (UserId),
    EnteredAt            datetime2(0)  NOT NULL CONSTRAINT DF_ChargeLine_EnteredAt DEFAULT (sysutcdatetime()),
    ModifiedBy           nvarchar(100) NOT NULL CONSTRAINT DF_ChargeLine_ModifiedBy DEFAULT (SUSER_SNAME()),
    RowVer               rowversion    NOT NULL,
    ValidFrom            datetime2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    ValidTo              datetime2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo),
    CONSTRAINT CK_ChargeLine_NegativeOnlyAdjustment CHECK (Units > 0 OR SourceType = N'ADJUSTMENT'),
    CONSTRAINT CK_ChargeLine_AdjustmentHasOriginal CHECK (SourceType <> N'ADJUSTMENT' OR AdjustsChargeLineId IS NOT NULL),
    CONSTRAINT CK_ChargeLine_ReleasedHasBatch CHECK (Status <> N'RELEASED' OR BillingBatchId IS NOT NULL)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = history.ChargeLine));
CREATE INDEX IX_ChargeLine_Request ON billing.ChargeLine (RequestId, Status);
CREATE INDEX IX_ChargeLine_Unbilled ON billing.ChargeLine (ChargeDate) INCLUDE (RequestId, ChargeCode, Units, UnitPrice) WHERE Status IN (N'PENDING', N'APPROVED');
CREATE INDEX IX_ChargeLine_Batch ON billing.ChargeLine (BillingBatchId) WHERE BillingBatchId IS NOT NULL;
GO

CREATE OR ALTER TRIGGER billing.TR_ChargeLine_Protect
ON billing.ChargeLine
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        THROW 50040, N'Charge lines cannot be deleted. Set Status = VOID (before release) or add an ADJUSTMENT line.', 1;
    IF EXISTS (SELECT 1 FROM deleted WHERE Status = N'RELEASED')
        THROW 50041, N'Released charge lines are locked. Add an ADJUSTMENT line instead.', 1;
END
GO

-- The "BILLING QC" row of the worksheet: who reviewed a request's charges, and when.
CREATE TABLE billing.BillingReview (
    BillingReviewId   int IDENTITY(1,1) NOT NULL CONSTRAINT PK_BillingReview PRIMARY KEY,
    RequestId         int           NOT NULL CONSTRAINT FK_BillingReview_Request REFERENCES lims.Request (RequestId),
    ReviewedByUserId  int           NOT NULL CONSTRAINT FK_BillingReview_User REFERENCES sec.AppUser (UserId),
    ReviewedAt        datetime2(0)  NOT NULL CONSTRAINT DF_BillingReview_ReviewedAt DEFAULT (sysutcdatetime()),
    Outcome           nvarchar(20)  NOT NULL CONSTRAINT CK_BillingReview_Outcome CHECK (Outcome IN (N'OK', N'CORRECTIONS_NEEDED')),
    Comment           nvarchar(1000) NULL
);
CREATE INDEX IX_BillingReview_Request ON billing.BillingReview (RequestId, ReviewedAt DESC);
GO

-- One row per request: estimate, NAS authorization, charges to date, and what remains.
CREATE OR ALTER VIEW billing.vRequestFinancials
AS
SELECT r.RequestId,
       r.RequestNumber,
       n.RequestDisplayId                         AS NasNumber,
       n.AuthorizedAmount,
       n.TotalEstimatedCost                       AS NasEstimatedCost,
       ISNULL(e.EstimatedAmount, 0)               AS EstimatedAmount,
       ISNULL(c.ChargedAmount, 0)                 AS ChargedAmount,
       ISNULL(c.ReleasedAmount, 0)                AS ReleasedAmount,
       n.AuthorizedAmount - ISNULL(c.ChargedAmount, 0) AS RemainingAuthorization
FROM lims.Request AS r
LEFT JOIN lims.NasRequest AS n ON n.NasRequestId = r.NasRequestId
LEFT JOIN (SELECT RequestId, SUM(Amount) AS EstimatedAmount FROM billing.EstimateLine GROUP BY RequestId) AS e
       ON e.RequestId = r.RequestId
LEFT JOIN (SELECT RequestId,
                  SUM(CASE WHEN Status <> N'VOID' THEN Amount ELSE 0 END)      AS ChargedAmount,
                  SUM(CASE WHEN Status = N'RELEASED' THEN Amount ELSE 0 END)   AS ReleasedAmount
           FROM billing.ChargeLine GROUP BY RequestId) AS c
       ON c.RequestId = r.RequestId;
GO
