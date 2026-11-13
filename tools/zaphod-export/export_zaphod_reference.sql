/* =============================================================================
   export_zaphod_reference.sql  -  READ ONLY

   Writes Zaphod's protocols, which study uses which, its dictionaries and its bloodwork reference ranges as one
   JSON document, for the MHL LIMS pilot (Necropsy > Protocols > Import from Zaphod). It only runs SELECTs.

   Table and column names come from the Zaphod source (the typed datasets, the SSRS reports NecropsyProtocol.rdl
   and TrimProtocol.rdl, and the SQL in the forms). Needs SQL Server 2016 or later (FOR JSON) and read access to
   the Zaphod database; C&SS can run it if MHL has no access.

   Save the result to a file with sqlcmd (one line, no truncation):

     sqlcmd -S <your-sql-server> -d Zaphod -E -i export_zaphod_reference.sql -o zaphod-export.json -y 0 -h -1 -W

   (-y 0 stops sqlcmd cutting long values; -h -1 drops the column header.) In SSMS, use Query > Results To > Results
   to File instead of the grid, which shortens long text. If a dictionary table does not exist in this copy of
   Zaphod, delete its line below; nothing else depends on it.
   ============================================================================= */
SET NOCOUNT ON;

DECLARE @json nvarchar(max) = (
  SELECT
    'zaphod-reference-export' AS [format],
    1 AS [version],
    CONVERT(varchar(19), GETDATE(), 126) AS exportedAt,
    DB_NAME() AS [database],

    -- Necropsy protocols with their steps (tblNecropsyProtocols, vwNecropsyProtocolStep).
    (SELECT p.ProtocolID, p.ProtocolName, p.Description, p.ProtocolDate, p.WeighAnimal, p.Approved, p.Obsolete,
            p.ApprovedBy, p.DateApproved, p.GeneralInstructions,
            (SELECT s.Sequence, s.Organ, s.Fixative, s.Freeze, s.WeighOrgan, s.MeasureOrgan, s.Description
               FROM vwNecropsyProtocolStep s WHERE s.ProtocolID = p.ProtocolID ORDER BY s.Sequence
               FOR JSON PATH, INCLUDE_NULL_VALUES) AS steps
       FROM tblNecropsyProtocols p ORDER BY p.ProtocolName
       FOR JSON PATH, INCLUDE_NULL_VALUES) AS necropsyProtocols,

    -- Trim protocols with their organs and blocks (tblTrimProtocols, vwTrimOrgans; Sex is M, F or N).
    (SELECT p.ProtocolID, p.ProtocolName, p.Description, p.ProtocolDate, p.Approved, p.Obsolete,
            p.ApprovedBy, p.DateApproved, p.GeneralInstructions,
            (SELECT o.BlockNbr, o.Organ, o.Sex, o.Description
               FROM vwTrimOrgans o WHERE o.ProtocolID = p.ProtocolID ORDER BY o.BlockNbr, o.Organ
               FOR JSON PATH, INCLUDE_NULL_VALUES) AS organs
       FROM tblTrimProtocols p ORDER BY p.ProtocolName
       FOR JSON PATH, INCLUDE_NULL_VALUES) AS trimProtocols,

    -- Which protocols each study uses (titles help match studies; no investigator details are exported).
    (SELECT s.ZAPNbr, s.StudyTitle, s.NecropsyProtocolID, s.TrimProtocolID, s.Obsolete
       FROM tblStudies s ORDER BY s.ZAPNbr
       FOR JSON PATH, INCLUDE_NULL_VALUES) AS studies,

    -- Dictionaries, as they are.
    (SELECT
       (SELECT * FROM tblOrgans FOR JSON PATH, INCLUDE_NULL_VALUES) AS organs,
       (SELECT * FROM tblDiagnosis FOR JSON PATH, INCLUDE_NULL_VALUES) AS diagnoses,
       (SELECT * FROM tblSite FOR JSON PATH, INCLUDE_NULL_VALUES) AS sites,
       (SELECT * FROM tblMorphology FOR JSON PATH, INCLUDE_NULL_VALUES) AS morphology,
       (SELECT * FROM tblShape FOR JSON PATH, INCLUDE_NULL_VALUES) AS shapes,
       (SELECT * FROM tblColor FOR JSON PATH, INCLUDE_NULL_VALUES) AS colors,
       (SELECT * FROM tblConsistency FOR JSON PATH, INCLUDE_NULL_VALUES) AS consistencies,
       (SELECT * FROM tblFate FOR JSON PATH, INCLUDE_NULL_VALUES) AS fates,
       (SELECT * FROM tblCondition FOR JSON PATH, INCLUDE_NULL_VALUES) AS conditions,
       (SELECT * FROM tblPhysicalID FOR JSON PATH, INCLUDE_NULL_VALUES) AS physicalIds,
       (SELECT * FROM tblFixative FOR JSON PATH, INCLUDE_NULL_VALUES) AS fixatives,
       (SELECT * FROM tblFreeze FOR JSON PATH, INCLUDE_NULL_VALUES) AS freezes,
       (SELECT * FROM tblSeverity FOR JSON PATH, INCLUDE_NULL_VALUES) AS severities,
       (SELECT * FROM tblDistribution FOR JSON PATH, INCLUDE_NULL_VALUES) AS distributions,
       (SELECT * FROM tblNeoplasm FOR JSON PATH, INCLUDE_NULL_VALUES) AS neoplasms,
       (SELECT * FROM tblHN FOR JSON PATH, INCLUDE_NULL_VALUES) AS hn,
       (SELECT * FROM tblSpecies FOR JSON PATH, INCLUDE_NULL_VALUES) AS species,
       (SELECT * FROM tblChemistryRanges FOR JSON PATH, INCLUDE_NULL_VALUES) AS chemistryRanges,
       (SELECT * FROM tblHematologyRanges FOR JSON PATH, INCLUDE_NULL_VALUES) AS hematologyRanges
     FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES) AS dictionaries

  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES
);

SELECT @json AS ZaphodExport;
