/* =============================================================================
   MHL LIMS migration  -  005_stage_views.sql
   Clean, trimmed, de-duplicated views over the raw stage copies. The loaders read these views, never the raw
   stage tables, so trimming and "which database wins" are decided in exactly one place.

   * PHL columns are fixed-width CHAR, so every text value is trimmed and empty text becomes NULL.
   * A request can exist in both the production and the archive ("retire") database if a retirement run was
     interrupted. The production copy of the request wins; child rows (PHL numbers, tracking, charges) found in
     both databases are matched on their natural key and the production copy wins, while child rows found in only
     one database are kept.
   Run after Copy-LegacyToStage.ps1 has copied the PHL tables. Safe to re-run.
   ============================================================================= */
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

CREATE OR ALTER VIEW stage.vRequest
AS
SELECT  UPPER(NULLIF(LTRIM(RTRIM(r_lab)), N''))        AS LabCode,
        NULLIF(LTRIM(RTRIM(r_req_id)), N'')            AS ReqId,
        x._SourceDb                                    AS SourceDb,
        CAST(r_inves_no AS int)                        AS InvesNo,
        NULLIF(LTRIM(RTRIM(r_inves_last)), N'')        AS InvesLast,
        NULLIF(LTRIM(RTRIM(r_inves_first_mi)), N'')    AS InvesFirst,
        NULLIF(LTRIM(RTRIM(r_inves_title)), N'')       AS InvesTitle,
        NULLIF(LTRIM(RTRIM(r_inves_institute)), N'')   AS InvesInstitute,
        NULLIF(LTRIM(RTRIM(r_inves_disp)), N'')        AS TissueDisp,
        NULLIF(LTRIM(RTRIM(r_center_no)), N'')         AS CenterNo,
        NULLIF(LTRIM(RTRIM(r_division)), N'')          AS Division,
        NULLIF(LTRIM(RTRIM(r_apo_no)), N'')            AS ApoNo,
        r_rec_date                                     AS RecDate,
        r_due_date                                     AS DueDate,
        r_comp_date                                    AS CompDate,
        NULLIF(LTRIM(RTRIM(r_req_type)), N'')          AS ReqType,
        NULLIF(LTRIM(RTRIM(r_necro)), N'')             AS FlagNecro,
        NULLIF(LTRIM(RTRIM(r_trimm)), N'')             AS FlagTrimm,
        NULLIF(LTRIM(RTRIM(r_embed)), N'')             AS FlagEmbed,
        NULLIF(LTRIM(RTRIM(r_micro)), N'')             AS FlagMicro,
        NULLIF(LTRIM(RTRIM(r_stain)), N'')             AS FlagStain,
        NULLIF(LTRIM(RTRIM(r_photo)), N'')             AS FlagPhoto,
        NULLIF(LTRIM(RTRIM(r_out)), N'')               AS FlagOut,
        NULLIF(LTRIM(RTRIM(r_other)), N'')             AS FlagOther,
        NULLIF(LTRIM(RTRIM(r_other_area)), N'')        AS OtherArea,
        NULLIF(LTRIM(RTRIM(r_desc)), N'')              AS [Description],
        NULLIF(LTRIM(RTRIM(r_fixative)), N'')          AS Fixative,
        NULLIF(LTRIM(RTRIM(r_species_name)), N'')      AS SpeciesName,
        NULLIF(LTRIM(RTRIM(r_species_abbrev)), N'')    AS SpeciesAbbrev,
        NULLIF(LTRIM(RTRIM(r_assign_path)), N'')       AS AssignPath,
        NULLIF(LTRIM(RTRIM(r_pa_name)), N'')           AS PaName,
        NULLIF(LTRIM(RTRIM(r_assign_team)), N'')       AS AssignTeam,
        NULLIF(LTRIM(RTRIM(r_charge_type)), N'')       AS ChargeType,
        CAST(r_web_id AS int)                          AS WebId,
        CAST(r_est_turn AS int)                        AS EstTurn,
        NULLIF(LTRIM(RTRIM(r_dev)), N'')               AS FlagDev,
        NULLIF(LTRIM(RTRIM(r_project)), N'')           AS FlagProject,
        NULLIF(LTRIM(RTRIM(r_part)), N'')              AS Part,
        CAST(r_app_budget AS decimal(14,2))            AS AppBudget,
        CAST(r_odrs_budget AS decimal(14,2))           AS OdrsBudget,
        NULLIF(LTRIM(RTRIM(r_deliverable)), N'')       AS Deliverable,
        r_update_date                                  AS UpdateDate,
        NULLIF(LTRIM(RTRIM(r_update_user)), N'')       AS UpdateUser
FROM (
    SELECT s.*, ROW_NUMBER() OVER (
               PARTITION BY UPPER(LTRIM(RTRIM(s.r_lab))), LTRIM(RTRIM(s.r_req_id))
               ORDER BY CASE s._SourceDb WHEN N'PROD' THEN 0 ELSE 1 END, s.r_update_date DESC) AS rn
    FROM stage.PHL_phl_request AS s
) AS x
WHERE x.rn = 1 AND NULLIF(LTRIM(RTRIM(r_req_id)), N'') IS NOT NULL AND NULLIF(LTRIM(RTRIM(r_lab)), N'') IS NOT NULL;
GO

/* Child rows (PHL numbers, tracking, charges). A request can be in both databases if a retirement run was
   interrupted; a child row can then be in both too. Rows found in both are matched on their natural key (with the
   same normalised text on both sides: blank and NULL are the same) and the position among identical keys inside
   one database; the copy that carries an extract date wins, then the production copy. Child rows found in only one
   database are always kept. Repeated keys inside ONE database are kept (the loaders log them), never merged. */
CREATE OR ALTER VIEW stage.vPhlNo
AS
SELECT z.LabCode, z.ReqId, z.SourceDb, z.PhlNo, z.Priority, z.AltId, z.AcucNo, z.ZapNbr, z.StudyNo, z.GroupNo, z.AnimalNo, z.UpdateDate, z.UpdateUser
FROM (
    SELECT y.*, ROW_NUMBER() OVER (PARTITION BY y.LabCode, y.ReqId, y.PhlNo, y.k ORDER BY y.SrcRank) AS pick
    FROM (
        SELECT n.*, ROW_NUMBER() OVER (PARTITION BY n.LabCode, n.ReqId, n.PhlNo, n.SourceDb ORDER BY n.UpdateDate DESC) AS k,
               CASE n.SourceDb WHEN N'PROD' THEN 0 ELSE 1 END AS SrcRank
        FROM (
            SELECT v.LabCode, v.ReqId, p._SourceDb AS SourceDb,
                   UPPER(NULLIF(LTRIM(RTRIM(p.p_phl_no)), N''))   AS PhlNo,
                   NULLIF(LTRIM(RTRIM(p.p_priority)), N'')        AS Priority,
                   NULLIF(LTRIM(RTRIM(p.p_alt_id)), N'')          AS AltId,
                   NULLIF(LTRIM(RTRIM(p.p_cenrep_no)), N'')       AS AcucNo,
                   NULLIF(LTRIM(RTRIM(p.p_comment)), N'')         AS ZapNbr,
                   NULLIF(LTRIM(RTRIM(p.p_study_no)), N'')        AS StudyNo,
                   NULLIF(LTRIM(RTRIM(p.p_group)), N'')           AS GroupNo,
                   NULLIF(LTRIM(RTRIM(p.p_an_no)), N'')           AS AnimalNo,
                   p.p_update_date                                AS UpdateDate,
                   NULLIF(LTRIM(RTRIM(p.p_update_user)), N'')     AS UpdateUser
            FROM stage.PHL_phl_phl_no AS p
            JOIN stage.vRequest AS v
              ON v.LabCode = UPPER(LTRIM(RTRIM(p.p_lab))) AND v.ReqId = LTRIM(RTRIM(p.p_req_id))
            WHERE NULLIF(LTRIM(RTRIM(p.p_phl_no)), N'') IS NOT NULL
        ) AS n
    ) AS y
) AS z
WHERE z.pick = 1;
GO

CREATE OR ALTER VIEW stage.vTracking
AS
SELECT z.LabCode, z.ReqId, z.SourceDb, z.Identity_, z.PhlNo, z.CurrArea, z.NextArea, z.Inits, z.Units, z.Proc_, z.TrackDate, z.Comment, z.[Status], z.UpdateDate, z.UpdateUser
FROM (
    SELECT y.*, ROW_NUMBER() OVER (PARTITION BY y.LabCode, y.ReqId, y.PhlNo, y.CurrArea, y.NextArea, y.TrackDate, y.Inits, y.Units, y.Proc_, y.k ORDER BY y.SrcRank) AS pick
    FROM (
        SELECT n.*, ROW_NUMBER() OVER (PARTITION BY n.LabCode, n.ReqId, n.PhlNo, n.CurrArea, n.NextArea, n.TrackDate, n.Inits, n.Units, n.Proc_, n.SourceDb ORDER BY n.Identity_) AS k,
               CASE n.SourceDb WHEN N'PROD' THEN 0 ELSE 1 END AS SrcRank
        FROM (
            SELECT v.LabCode, v.ReqId, t._SourceDb AS SourceDb,
                   CAST(t.t_identity AS int)                      AS Identity_,
                   UPPER(NULLIF(LTRIM(RTRIM(t.t_phl_no)), N''))   AS PhlNo,
                   UPPER(NULLIF(LTRIM(RTRIM(t.t_curr_area)), N'')) AS CurrArea,
                   UPPER(NULLIF(LTRIM(RTRIM(t.t_next_area)), N'')) AS NextArea,
                   NULLIF(LTRIM(RTRIM(t.t_inits)), N'')           AS Inits,
                   CAST(t.t_units AS decimal(9,2))                AS Units,
                   NULLIF(LTRIM(RTRIM(t.t_proc)), N'')            AS Proc_,
                   t.t_track_date                                 AS TrackDate,
                   NULLIF(LTRIM(RTRIM(t.t_comment)), N'')         AS Comment,
                   NULLIF(LTRIM(RTRIM(t.t_status)), N'')          AS [Status],
                   t.t_update_date                                AS UpdateDate,
                   NULLIF(LTRIM(RTRIM(t.t_update_user)), N'')     AS UpdateUser
            FROM stage.PHL_phl_tracking AS t
            JOIN stage.vRequest AS v
              ON v.LabCode = UPPER(LTRIM(RTRIM(t.t_lab))) AND v.ReqId = LTRIM(RTRIM(t.t_req_id))
        ) AS n
    ) AS y
) AS z
WHERE z.pick = 1;
GO

CREATE OR ALTER VIEW stage.vCharge
AS
SELECT z.LabCode, z.ReqId, z.SourceDb, z.PhlNo, z.ChargeDate, z.ChargeCode, z.BaseChargeCode, z.Units, z.UnitPrice, z.[Description], z.ExtractDate, z.UpdateDate, z.UpdateUser
FROM (
    SELECT y.*, ROW_NUMBER() OVER (PARTITION BY y.LabCode, y.ReqId, y.PhlNoKey, y.ChargeDay, y.ChargeCode, y.Units, y.UnitPrice, y.k
                                   ORDER BY CASE WHEN y.ExtractDate IS NOT NULL THEN 0 ELSE 1 END, y.SrcRank) AS pick
    FROM (
        SELECT n.*, ROW_NUMBER() OVER (PARTITION BY n.LabCode, n.ReqId, n.PhlNoKey, n.ChargeDay, n.ChargeCode, n.Units, n.UnitPrice, n.SourceDb ORDER BY n.UpdateDate) AS k,
               CASE n.SourceDb WHEN N'PROD' THEN 0 ELSE 1 END AS SrcRank
        FROM (
            SELECT v.LabCode, v.ReqId, c._SourceDb AS SourceDb,
                   UPPER(NULLIF(LTRIM(RTRIM(c.c_phl_no)), N''))   AS PhlNo,
                   COALESCE(UPPER(NULLIF(LTRIM(RTRIM(c.c_phl_no)), N'')), N'') AS PhlNoKey,
                   c.c_charge_date                                AS ChargeDate,
                   COALESCE(CAST(c.c_charge_date AS date), '1900-01-01') AS ChargeDay,
                   UPPER(NULLIF(LTRIM(RTRIM(c.c_charge_code)), N'')) AS ChargeCode,
                   UPPER(NULLIF(LTRIM(RTRIM(c.c_base_charge_code)), N'')) AS BaseChargeCode,
                   CAST(c.c_charge_units AS decimal(9,2))         AS Units,
                   CAST(c.c_charge_price AS decimal(10,2))        AS UnitPrice,
                   NULLIF(LTRIM(RTRIM(c.c_charge_desc)), N'')     AS [Description],
                   c.c_extract_date                               AS ExtractDate,
                   c.c_update_date                                AS UpdateDate,
                   NULLIF(LTRIM(RTRIM(c.c_update_user)), N'')     AS UpdateUser
            FROM stage.PHL_phl_charge AS c
            JOIN stage.vRequest AS v
              ON v.LabCode = UPPER(LTRIM(RTRIM(c.c_lab))) AND v.ReqId = LTRIM(RTRIM(c.c_req_id))
        ) AS n
    ) AS y
) AS z
WHERE z.pick = 1;
GO

-- Request with legacy codes translated: the translation tables are legacy.MapValue (editable) and the
-- reference codes added by 100_load_reference.sql.
CREATE OR ALTER VIEW stage.vRequestEff
AS
SELECT  r.*,
        COALESCE(mt.TargetValue, UPPER(r.ReqType))                          AS ReqTypeCode,
        COALESCE(ms1.TargetValue, ms2.TargetValue, UPPER(LEFT(r.SpeciesAbbrev, 10))) AS SpeciesCode,
        CASE WHEN UPPER(r.ChargeType) IN (N'C', N'N', N'L') THEN UPPER(r.ChargeType) ELSE N'C' END AS ChargeTypeCode
FROM stage.vRequest AS r
LEFT JOIN legacy.MapValue AS mt  ON mt.MapName  = N'REQTYPE' AND mt.SourceValue  = r.ReqType
LEFT JOIN legacy.MapValue AS ms1 ON ms1.MapName = N'SPECIES' AND ms1.SourceValue = r.SpeciesAbbrev
LEFT JOIN legacy.MapValue AS ms2 ON ms2.MapName = N'SPECIES' AND ms2.SourceValue = r.SpeciesName;
GO

PRINT N'Stage views ready.';
GO
