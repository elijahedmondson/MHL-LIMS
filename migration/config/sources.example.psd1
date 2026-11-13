# Copy this file to sources.psd1 (git-ignored) and fill in the server and database names.
# Windows (integrated) authentication only: never put a user name or password in this file.
# Source connections are opened read-only (ApplicationIntent=ReadOnly) and only ever run SELECT.
@{
    # The WRITABLE database that receives the stage.* copies and, later, the migrated LIMS data.
    # Use a development database first. Never point this at a legacy system.
    Stage = @{
        Server   = '(localdb)\MSSQLLocalDB'
        Database = 'MhlLims_Dev'
    }

    Sources = @(
        # --- PHL tracking and billing (PowerBuilder app; database "FASDATA" per the Zaphod source) ---
        @{
            Name     = 'PHL'            # LoadRun.SourceSystem
            Tag      = 'PROD'           # stored in stage.<table>._SourceDb
            Server   = '<phl-production-sql-server>'
            Database = 'FASDATA'
            Tables   = @(
                @{ Source = 'dbo.phl_request';        Stage = 'PHL_phl_request' }
                @{ Source = 'dbo.phl_phl_no';         Stage = 'PHL_phl_phl_no' }
                @{ Source = 'dbo.phl_tracking';       Stage = 'PHL_phl_tracking' }
                @{ Source = 'dbo.phl_charge';         Stage = 'PHL_phl_charge' }
                @{ Source = 'dbo.phl_zaphod';         Stage = 'PHL_phl_zaphod' }
                @{ Source = 'dbo.phl_sys_table';      Stage = 'PHL_phl_sys_table' }
                @{ Source = 'dbo.fas_sys_table';      Stage = 'PHL_fas_sys_table' }
                @{ Source = 'dbo.ssg_investigators';  Stage = 'PHL_ssg_investigators' }
                @{ Source = 'dbo.nas_information';    Stage = 'PHL_nas_information' }
            )
        }

        # --- PHL archive ("retired") database: same shape as production for the four request tables ---
        # Confirm the real server/database names (FASRETIREPROD in PHL.exe) and table names with C&SS.
        @{
            Name     = 'PHLRETIRE'
            Tag      = 'RETIRE'
            Server   = '<phl-archive-sql-server>'
            Database = 'FASRETIREPROD'
            Tables   = @(
                @{ Source = 'dbo.phl_request';  Stage = 'PHL_phl_request' }
                @{ Source = 'dbo.phl_phl_no';   Stage = 'PHL_phl_phl_no' }
                @{ Source = 'dbo.phl_tracking'; Stage = 'PHL_phl_tracking' }
                @{ Source = 'dbo.phl_charge';   Stage = 'PHL_phl_charge' }
            )
        }

        # --- Zaphod necropsy and pathology (SQL Server database "Zaphod") ---
        @{
            Name     = 'ZAPHOD'
            Tag      = 'PROD'
            Server   = '<zaphod-sql-server>'
            Database = 'Zaphod'
            Tables   = @(
                # studies, groups, animals
                @{ Source = 'dbo.tblStudies';              Stage = 'ZAP_tblStudies' }
                @{ Source = 'dbo.vwStudies';               Stage = 'ZAP_vwStudies' }
                @{ Source = 'dbo.tblStudyInvest';          Stage = 'ZAP_tblStudyInvest' }
                @{ Source = 'dbo.tblACUC';                 Stage = 'ZAP_tblACUC' }
                @{ Source = 'dbo.tblEmail';                Stage = 'ZAP_tblEmail' }
                @{ Source = 'dbo.tblGroup';                Stage = 'ZAP_tblGroup' }
                @{ Source = 'dbo.tblAnimals';              Stage = 'ZAP_tblAnimals' }
                # protocols
                @{ Source = 'dbo.tblNecropsyProtocols';     Stage = 'ZAP_tblNecropsyProtocols' }
                @{ Source = 'dbo.tblNecropsyProtocolSteps'; Stage = 'ZAP_tblNecropsyProtocolSteps' }
                @{ Source = 'dbo.tblTrimProtocols';         Stage = 'ZAP_tblTrimProtocols' }
                @{ Source = 'dbo.tblTrimOrgans';            Stage = 'ZAP_tblTrimOrgans' }
                # necropsy
                @{ Source = 'dbo.tblNecropsyHeaders';      Stage = 'ZAP_tblNecropsyHeaders' }
                @{ Source = 'dbo.tblNecropsyOrgans';       Stage = 'ZAP_tblNecropsyOrgans' }
                @{ Source = 'dbo.tblNecropsyFindings';     Stage = 'ZAP_tblNecropsyFindings' }
                @{ Source = 'dbo.tblOrganMeasurements';    Stage = 'ZAP_tblOrganMeasurements' }
                # pathology
                @{ Source = 'dbo.tblPathologyHeaders';     Stage = 'ZAP_tblPathologyHeaders' }
                @{ Source = 'dbo.tblPathologyOrgans';      Stage = 'ZAP_tblPathologyOrgans' }
                @{ Source = 'dbo.tblPathologyFindings';    Stage = 'ZAP_tblPathologyFindings' }
                @{ Source = 'dbo.tblPathologyDiagnoses';   Stage = 'ZAP_tblPathologyDiagnoses' }
                @{ Source = 'dbo.tblPathologyCorrelation'; Stage = 'ZAP_tblPathologyCorrelation' }
                @{ Source = 'dbo.tblStudyDiagnosis';       Stage = 'ZAP_tblStudyDiagnosis' }
                # clinical pathology (staged now; no target tables in the LIMS schema yet)
                @{ Source = 'dbo.tblChemistry';            Stage = 'ZAP_tblChemistry' }
                @{ Source = 'dbo.tblHematology';           Stage = 'ZAP_tblHematology' }
                @{ Source = 'dbo.tblChemistryRanges';      Stage = 'ZAP_tblChemistryRanges' }
                @{ Source = 'dbo.tblHematologyRanges';     Stage = 'ZAP_tblHematologyRanges' }
                # dictionaries
                @{ Source = 'dbo.tblOrgans';        Stage = 'ZAP_tblOrgans' }
                @{ Source = 'dbo.tblSite';          Stage = 'ZAP_tblSite' }
                @{ Source = 'dbo.tblDiagnosis';     Stage = 'ZAP_tblDiagnosis' }
                @{ Source = 'dbo.tblMorphology';    Stage = 'ZAP_tblMorphology' }
                @{ Source = 'dbo.tblShape';         Stage = 'ZAP_tblShape' }
                @{ Source = 'dbo.tblColor';         Stage = 'ZAP_tblColor' }
                @{ Source = 'dbo.tblConsistency';   Stage = 'ZAP_tblConsistency' }
                @{ Source = 'dbo.tblCondition';     Stage = 'ZAP_tblCondition' }
                @{ Source = 'dbo.tblFate';          Stage = 'ZAP_tblFate' }
                @{ Source = 'dbo.tblFixative';      Stage = 'ZAP_tblFixative' }
                @{ Source = 'dbo.tblFreeze';        Stage = 'ZAP_tblFreeze' }
                @{ Source = 'dbo.tblSpecies';       Stage = 'ZAP_tblSpecies' }
                @{ Source = 'dbo.tblNeoplasm';      Stage = 'ZAP_tblNeoplasm' }
                @{ Source = 'dbo.tblSeverity';      Stage = 'ZAP_tblSeverity' }
                @{ Source = 'dbo.tblDistribution';  Stage = 'ZAP_tblDistribution' }
                @{ Source = 'dbo.tblHN';            Stage = 'ZAP_tblHN' }
                @{ Source = 'dbo.tblPairedOrgans';  Stage = 'ZAP_tblPairedOrgans' }
                @{ Source = 'dbo.tblPathologist';   Stage = 'ZAP_tblPathologist' }
                @{ Source = 'dbo.tblPhysicalID';    Stage = 'ZAP_tblPhysicalID' }
                @{ Source = 'dbo.tblNecropsyCharge';Stage = 'ZAP_tblNecropsyCharge' }
                @{ Source = 'dbo.tblApprovers';     Stage = 'ZAP_tblApprovers' }
            )
        }
    )

    # Used only by Invoke-LegacySchemaSnapshot.ps1: date ranges to report (table, column).
    DateColumns = @(
        @{ Source = 'PHL';    Table = 'dbo.phl_request';  Column = 'r_rec_date' }
        @{ Source = 'PHL';    Table = 'dbo.phl_charge';   Column = 'c_charge_date' }
        @{ Source = 'PHL';    Table = 'dbo.phl_tracking'; Column = 't_track_date' }
        @{ Source = 'PHLRETIRE'; Table = 'dbo.phl_request'; Column = 'r_rec_date' }
        @{ Source = 'ZAPHOD'; Table = 'dbo.tblStudies';   Column = 'DateEntered' }
        @{ Source = 'ZAPHOD'; Table = 'dbo.tblPathologyHeaders'; Column = 'DateCompleted' }
    )
}
