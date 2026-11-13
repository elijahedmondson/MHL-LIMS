/* =============================================================================
   MHL LIMS  -  050_audit_and_legacy.sql
   Application event log and the legacy crosswalk used by data migration.
   ============================================================================= */
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;   -- required for filtered indexes
SET ANSI_NULLS ON;
GO

-- Business events that temporal history alone does not explain: approvals,
-- releases, reasons for change, sign-outs, failed imports.
CREATE TABLE audit.EventLog (
    EventLogId   bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_EventLog PRIMARY KEY,
    OccurredAt   datetime2(3)  NOT NULL CONSTRAINT DF_EventLog_OccurredAt DEFAULT (sysutcdatetime()),
    UserAccount  nvarchar(100) NOT NULL,
    EntityType   nvarchar(50)  NOT NULL,
    EntityId     nvarchar(50)  NOT NULL,
    Action       nvarchar(50)  NOT NULL,      -- e.g. PRICE_LIST_APPROVED, BATCH_RELEASED, CHARGE_VOIDED
    Reason       nvarchar(1000) NULL,
    DetailsJson  nvarchar(max) NULL CONSTRAINT CK_EventLog_Json CHECK (DetailsJson IS NULL OR ISJSON(DetailsJson) = 1)
);
CREATE INDEX IX_EventLog_Entity ON audit.EventLog (EntityType, EntityId, OccurredAt DESC);
GO

CREATE TABLE legacy.LoadRun (
    LoadRunId      int IDENTITY(1,1) NOT NULL CONSTRAINT PK_LoadRun PRIMARY KEY,
    SourceSystem   nvarchar(10)  NOT NULL CONSTRAINT CK_LoadRun_Source CHECK (SourceSystem IN (N'PHL', N'PHLRETIRE', N'ZAPHOD', N'PHLREQUEST', N'NAS', N'COSTPOINT')),
    StartedAt      datetime2(0)  NOT NULL CONSTRAINT DF_LoadRun_StartedAt DEFAULT (sysutcdatetime()),
    FinishedAt     datetime2(0)  NULL,
    Status         nvarchar(20)  NOT NULL CONSTRAINT DF_LoadRun_Status DEFAULT (N'RUNNING')
                   CONSTRAINT CK_LoadRun_Status CHECK (Status IN (N'RUNNING', N'SUCCEEDED', N'FAILED')),
    RowCountsJson  nvarchar(max) NULL CONSTRAINT CK_LoadRun_Json CHECK (RowCountsJson IS NULL OR ISJSON(RowCountsJson) = 1),
    Notes          nvarchar(max) NULL
);
GO

-- Maps every migrated legacy key to the new row, so any old PHL or Zaphod
-- reference can still be found (e.g. PHL request + lab + PHL#, Zaphod PHLNbr).
CREATE TABLE legacy.IdCrosswalk (
    SourceSystem  nvarchar(10)  NOT NULL,       -- PHL, PHLRETIRE, ZAPHOD, PHLREQUEST
    SourceTable   nvarchar(128) NOT NULL,       -- e.g. phl_phl_no, tblAnimals
    SourceKey     nvarchar(200) NOT NULL,       -- composite keys joined with '|', e.g. HP|R12345|27000123A
    TargetTable   nvarchar(128) NOT NULL,       -- e.g. lims.Subject
    TargetId      int           NOT NULL,
    LoadRunId     int           NULL CONSTRAINT FK_IdCrosswalk_LoadRun REFERENCES legacy.LoadRun (LoadRunId),
    CONSTRAINT PK_IdCrosswalk PRIMARY KEY (SourceSystem, SourceTable, SourceKey)
);
CREATE INDEX IX_IdCrosswalk_Target ON legacy.IdCrosswalk (TargetTable, TargetId);
GO
