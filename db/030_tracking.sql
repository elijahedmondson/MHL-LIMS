/* =============================================================================
   MHL LIMS  -  030_tracking.sql
   Append-only tracking events. Every scan or move of a subject, specimen,
   block or slide is one row. Corrections are new events, never edits.
   ============================================================================= */
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;   -- required for filtered indexes
SET ANSI_NULLS ON;
GO

CREATE TABLE trk.TrackingEvent (
    EventId            bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_TrackingEvent PRIMARY KEY,
    EntityType         nvarchar(10)  NOT NULL CONSTRAINT CK_TrackingEvent_EntityType
                       CHECK (EntityType IN (N'SUBJECT', N'SPECIMEN', N'BLOCK', N'SLIDE')),
    EntityId           int           NOT NULL,
    RequestId          int           NOT NULL CONSTRAINT FK_TrackingEvent_Request REFERENCES lims.Request (RequestId),
    FromAreaCode       nvarchar(10)  NULL CONSTRAINT FK_TrackingEvent_From REFERENCES ref.WorkArea (AreaCode),
    ToAreaCode         nvarchar(10)  NOT NULL CONSTRAINT FK_TrackingEvent_To REFERENCES ref.WorkArea (AreaCode),
    PerformedByUserId  int           NOT NULL CONSTRAINT FK_TrackingEvent_User REFERENCES sec.AppUser (UserId),
    PerformedAt        datetime2(0)  NOT NULL,
    Units              decimal(9,2)  NULL,          -- productivity units (PHL t_units)
    ProcedureCode      nvarchar(20)  NULL,          -- PHL t_proc
    IsRedo             bit           NOT NULL CONSTRAINT DF_TrackingEvent_IsRedo DEFAULT (0),
    Comment            nvarchar(1000) NULL,
    RecordedAt         datetime2(0)  NOT NULL CONSTRAINT DF_TrackingEvent_RecordedAt DEFAULT (sysutcdatetime()),
    RecordedBy         nvarchar(100) NOT NULL CONSTRAINT DF_TrackingEvent_RecordedBy DEFAULT (SUSER_SNAME())
);
CREATE INDEX IX_TrackingEvent_Entity ON trk.TrackingEvent (EntityType, EntityId, PerformedAt DESC, EventId DESC);
CREATE INDEX IX_TrackingEvent_Request ON trk.TrackingEvent (RequestId, PerformedAt);
CREATE INDEX IX_TrackingEvent_ToArea ON trk.TrackingEvent (ToAreaCode, PerformedAt);
GO

CREATE OR ALTER TRIGGER trk.TR_TrackingEvent_AppendOnly
ON trk.TrackingEvent
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM deleted)
        THROW 50030, N'Tracking events are append-only. Record a correcting event instead.', 1;
END
GO

-- Current location of every tracked item = its most recent event.
CREATE OR ALTER VIEW trk.vCurrentLocation
AS
SELECT EntityType, EntityId, RequestId, ToAreaCode AS CurrentAreaCode,
       PerformedAt AS ArrivedAt, PerformedByUserId, EventId
FROM (
    SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e.EntityType, e.EntityId
                                   ORDER BY e.PerformedAt DESC, e.EventId DESC) AS rn
    FROM trk.TrackingEvent AS e
) AS x
WHERE x.rn = 1;
GO
