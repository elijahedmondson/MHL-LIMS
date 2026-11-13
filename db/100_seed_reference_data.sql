/* =============================================================================
   MHL LIMS  -  100_seed_reference_data.sql
   Reference data. Idempotent: inserts missing rows, updates names of existing
   rows, never deletes. Codes marked PLACEHOLDER must be replaced with the
   lab's real values (PHL code sets REQTY, FIXAT, SPECI, etc.) in Phase 0.
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

MERGE ref.Lab AS t
USING (VALUES (N'HP', N'Histotechnology (MHL)', 1),
              (N'PA', N'Pathology', 2)) AS s (LabCode, Name, SortOrder)
ON t.LabCode = s.LabCode
WHEN MATCHED THEN UPDATE SET Name = s.Name, SortOrder = s.SortOrder
WHEN NOT MATCHED THEN INSERT (LabCode, Name, SortOrder) VALUES (s.LabCode, s.Name, s.SortOrder);

-- Work areas: legacy PHL codes, plus SPATL for spatial (Xenium) work.
MERGE ref.WorkArea AS t
USING (VALUES
    (N'ENTRY', N'Accessioning',                 N'HP', 0, 10),
    (N'NECRO', N'Necropsy',                     N'HP', 0, 20),
    (N'BLOOD', N'Blood / clinical pathology',   N'HP', 0, 30),
    (N'TRIMM', N'Trimming',                     N'HP', 0, 40),
    (N'EMBED', N'Embedding',                    N'HP', 0, 50),
    (N'MICRO', N'Microtomy',                    N'HP', 0, 60),
    (N'STAIN', N'Staining / IHC / ISH',         N'HP', 0, 70),
    (N'IMAGE', N'Slide scanning / imaging',     N'HP', 0, 80),
    (N'SPATL', N'Spatial (10x Xenium)',         N'HP', 0, 85),
    (N'STAGE', N'Staging',                      N'HP', 0, 90),
    (N'QC-HP', N'Histology QC',                 N'HP', 0, 95),
    (N'PATHO', N'Pathology',                    N'PA', 0, 100),
    (N'QC-PA', N'Pathology QC (complete)',      N'PA', 1, 110),
    (N'TOSUB', N'Sent to subcontractor',        NULL,  0, 120),
    (N'OTHER', N'Other',                        NULL,  0, 130),
    (N'OUT',   N'Out of lab',                   NULL,  0, 140),
    (N'BILLN', N'Billing',                      NULL,  0, 150),
    (N'ARCHV', N'Archived (complete)',          NULL,  1, 160),
    (N'INVES', N'Returned to investigator (complete)', NULL, 1, 170)
) AS s (AreaCode, Name, LabCode, IsTerminal, SortOrder)
ON t.AreaCode = s.AreaCode
WHEN MATCHED THEN UPDATE SET Name = s.Name, LabCode = s.LabCode, IsTerminal = s.IsTerminal, SortOrder = s.SortOrder
WHEN NOT MATCHED THEN INSERT (AreaCode, Name, LabCode, IsTerminal, SortOrder) VALUES (s.AreaCode, s.Name, s.LabCode, s.IsTerminal, s.SortOrder);

MERGE ref.Priority AS t
USING (VALUES (N'R', N'Routine', 1), (N'P', N'Priority', 2), (N'S', N'STAT', 3)) AS s (PriorityCode, Name, SortOrder)
ON t.PriorityCode = s.PriorityCode
WHEN MATCHED THEN UPDATE SET Name = s.Name, SortOrder = s.SortOrder
WHEN NOT MATCHED THEN INSERT (PriorityCode, Name, SortOrder) VALUES (s.PriorityCode, s.Name, s.SortOrder);

MERGE ref.SubjectType AS t
USING (VALUES
    (N'MOUSE',         N'Mouse',                0),
    (N'RAT',           N'Rat',                  0),
    (N'OTHER_ANIMAL',  N'Other animal',         0),
    (N'HUMAN_DONOR',   N'Human donor (coded)',  1),
    (N'PDX_MODEL',     N'PDX model',            1),
    (N'ORGANOID_LINE', N'Organoid line',        1),
    (N'CELL_LINE',     N'Cell line',            0)
) AS s (SubjectTypeCode, Name, IsRestrictedAccess)
ON t.SubjectTypeCode = s.SubjectTypeCode
WHEN MATCHED THEN UPDATE SET Name = s.Name, IsRestrictedAccess = s.IsRestrictedAccess
WHEN NOT MATCHED THEN INSERT (SubjectTypeCode, Name, IsRestrictedAccess) VALUES (s.SubjectTypeCode, s.Name, s.IsRestrictedAccess);

MERGE ref.SpecimenType AS t
USING (VALUES (N'TISSUE', N'Tissue'), (N'BLOOD', N'Whole blood'), (N'SERUM', N'Serum / plasma'),
              (N'MARROW', N'Bone marrow'), (N'PELLET', N'Cell pellet'), (N'CRYOVIAL', N'Cryopreserved vial'),
              (N'FLUID', N'Body fluid'), (N'OTHER', N'Other')) AS s (SpecimenTypeCode, Name)
ON t.SpecimenTypeCode = s.SpecimenTypeCode
WHEN MATCHED THEN UPDATE SET Name = s.Name
WHEN NOT MATCHED THEN INSERT (SpecimenTypeCode, Name) VALUES (s.SpecimenTypeCode, s.Name);

MERGE ref.EmbeddingMedium AS t
USING (VALUES (N'PARAFFIN', N'Paraffin'), (N'OCT', N'OCT (frozen)'), (N'AGAR', N'Agar (vibratome)'), (N'GMA', N'GMA plastic')) AS s (MediumCode, Name)
ON t.MediumCode = s.MediumCode
WHEN MATCHED THEN UPDATE SET Name = s.Name
WHEN NOT MATCHED THEN INSERT (MediumCode, Name) VALUES (s.MediumCode, s.Name);

-- PLACEHOLDER: replace with PHL code set SPECI.
MERGE ref.Species AS t
USING (VALUES (N'MOUSE', N'Mouse (Mus musculus)'), (N'RAT', N'Rat (Rattus norvegicus)'),
              (N'HUMAN', N'Human'), (N'OTHER', N'Other')) AS s (SpeciesCode, Name)
ON t.SpeciesCode = s.SpeciesCode
WHEN MATCHED THEN UPDATE SET Name = s.Name
WHEN NOT MATCHED THEN INSERT (SpeciesCode, Name) VALUES (s.SpeciesCode, s.Name);

-- PLACEHOLDER: replace with PHL code set FIXAT (PHL default was 10%NBF).
MERGE ref.Fixative AS t
USING (VALUES (N'10%NBF', N'10% neutral buffered formalin'), (N'4%PFA', N'4% paraformaldehyde'),
              (N'ZNFORM', N'Zinc formalin'), (N'ETOH70', N'70% ethanol'), (N'FRESH', N'Fresh / unfixed'),
              (N'MULTI', N'Multiple'), (N'OTHER', N'Other')) AS s (FixativeCode, Name)
ON t.FixativeCode = s.FixativeCode
WHEN MATCHED THEN UPDATE SET Name = s.Name
WHEN NOT MATCHED THEN INSERT (FixativeCode, Name) VALUES (s.FixativeCode, s.Name);

-- Billing sections, in worksheet order.
MERGE ref.ServiceSection AS t
USING (VALUES (N'NECRO', N'Necropsy', N'NECRO', 1), (N'BLOOD', N'Blood / clinical path', N'BLOOD', 2),
              (N'TRIM_EMBED', N'Trim / embed', N'EMBED', 3), (N'MICROTOMY', N'Microtomy', N'MICRO', 4),
              (N'STAIN', N'Staining / molecular', N'STAIN', 5), (N'IMAGE', N'Imaging', N'IMAGE', 6),
              (N'PATH', N'Pathology', N'PATHO', 7)) AS s (SectionCode, Name, DefaultAreaCode, SortOrder)
ON t.SectionCode = s.SectionCode
WHEN MATCHED THEN UPDATE SET Name = s.Name, DefaultAreaCode = s.DefaultAreaCode, SortOrder = s.SortOrder
WHEN NOT MATCHED THEN INSERT (SectionCode, Name, DefaultAreaCode, SortOrder) VALUES (s.SectionCode, s.Name, s.DefaultAreaCode, s.SortOrder);

-- PLACEHOLDER: replace with PHL code set REQTY ("path thru lab" = start area).
MERGE ref.RequestType AS t
USING (VALUES
    (N'NECRO-FULL', N'Necropsy, histology and pathology', N'HP', N'NECRO', 30, 1),
    (N'HISTO',      N'Histology only (fixed tissue received)', N'HP', N'TRIMM', 14, 2),
    (N'CUT-STAIN',  N'Sectioning and staining of blocks', N'HP', N'MICRO', 10, 3),
    (N'MOLEC',      N'IHC / RNAscope / multiplex IF', N'HP', N'STAIN', 21, 4),
    (N'SCAN',       N'Slide scanning only', N'HP', N'IMAGE', 5, 5),
    (N'XENIUM',     N'10x Xenium spatial', N'HP', N'SPATL', 30, 6),
    (N'PATH-ONLY',  N'Pathology review of submitted slides', N'PA', N'PATHO', 14, 7)
) AS s (RequestTypeCode, Name, LabCode, StartAreaCode, TurnaroundDays, SortOrder)
ON t.RequestTypeCode = s.RequestTypeCode
WHEN MATCHED THEN UPDATE SET Name = s.Name, LabCode = s.LabCode, StartAreaCode = s.StartAreaCode, TurnaroundDays = s.TurnaroundDays, SortOrder = s.SortOrder
WHEN NOT MATCHED THEN INSERT (RequestTypeCode, Name, LabCode, StartAreaCode, TurnaroundDays, SortOrder)
                      VALUES (s.RequestTypeCode, s.Name, s.LabCode, s.StartAreaCode, s.TurnaroundDays, s.SortOrder);

MERGE sec.Role AS t
USING (VALUES
    (N'READ_ONLY',      N'Read only',            N'Search and view records'),
    (N'LAB_STAFF',      N'Lab staff',            N'Create requests, print labels, record tracking'),
    (N'PROSECTOR',      N'Prosector',            N'Record necropsy findings and weights'),
    (N'PATHOLOGIST',    N'Pathologist',          N'Enter diagnoses and sign out'),
    (N'BILLING_ADMIN',  N'Billing administrator',N'Review charges, approve price lists, release billing batches'),
    (N'LAB_ADMIN',      N'Lab administrator',    N'Maintain reference data, protocols and users'),
    (N'HUMAN_TISSUE',   N'Human tissue access',  N'See restricted human donor, PDX and organoid records'),
    (N'SYSTEM_ADMIN',   N'System administrator', N'Technical administration')
) AS s (RoleCode, Name, Description)
ON t.RoleCode = s.RoleCode
WHEN MATCHED THEN UPDATE SET Name = s.Name, Description = s.Description
WHEN NOT MATCHED THEN INSERT (RoleCode, Name, Description) VALUES (s.RoleCode, s.Name, s.Description);

-- Charge rules: seeded DISABLED. See docs/price-list-review-CY2027.md, findings 6 and 7.
IF NOT EXISTS (SELECT 1 FROM billing.ChargeRule WHERE RuleCode = N'STAT_SURCHARGE')
    INSERT INTO billing.ChargeRule (RuleCode, RuleType, IsEnabled, ChargeCode, ParametersJson, Notes)
    VALUES (N'STAT_SURCHARGE', N'STAT_SURCHARGE', 0, NULL, N'{"perSubject": true, "units": 1}',
            N'Legacy PHL added <lab>009050 per STAT PHL#. No surcharge code in the CY2027 list; confirm before enabling.');
IF NOT EXISTS (SELECT 1 FROM billing.ChargeRule WHERE RuleCode = N'WSI_ANALYSIS_LABOR')
    INSERT INTO billing.ChargeRule (RuleCode, RuleType, IsEnabled, ChargeCode, ParametersJson, Notes)
    VALUES (N'WSI_ANALYSIS_LABOR', N'IMAGE_ANALYSIS_LABOR', 0, NULL,
            N'{"laborUnitsPerBlock": 4, "imagesPerBlock": 6, "rounding": "ProportionalRoundUp"}',
            N'Worksheet note: 4 labor units per 6 slide images; each multiplex target is an image. Confirm labor code and rounding.');

COMMIT TRANSACTION;
PRINT N'Reference data seeded.';
GO
