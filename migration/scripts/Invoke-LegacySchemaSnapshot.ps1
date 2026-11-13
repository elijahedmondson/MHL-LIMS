<#
.SYNOPSIS
  Step 1 of the legacy migration: a READ-ONLY look at what each legacy database really contains.

.DESCRIPTION
  For every source in the config file this script connects with Windows authentication and
  ApplicationIntent=ReadOnly, runs SELECT statements only, and writes four CSV files per source to
  the output folder:  <Name>-columns.csv, <Name>-rowcounts.csv, <Name>-dateranges.csv, <Name>-permissions.csv.
  It never writes to a legacy database. Send the CSVs (not any data) back to the project team.

.PARAMETER ConfigPath  Path to sources.psd1 (copy of config\sources.example.psd1).
.PARAMETER OutDir      Where the CSV files go (default: migration\out, which is git-ignored).
.PARAMETER Only        Optional list of source names (PHL, PHLRETIRE, ZAPHOD).

.EXAMPLE
  .\Invoke-LegacySchemaSnapshot.ps1 -ConfigPath ..\config\sources.psd1
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $ConfigPath,
    [string] $OutDir = (Join-Path $PSScriptRoot '..\out'),
    [string[]] $Only
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$config = Import-PowerShellDataFile -Path $ConfigPath
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Open-ReadOnlyConnection([string] $server, [string] $database) {
    $csb = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
    $csb['Data Source'] = $server
    $csb['Initial Catalog'] = $database
    $csb['Integrated Security'] = $true          # Windows authentication only
    $csb['ApplicationIntent'] = 'ReadOnly'
    $csb['Application Name'] = 'MHL-LIMS-migration-snapshot'
    $csb['Connect Timeout'] = 30
    $csb['Encrypt'] = $true
    $csb['TrustServerCertificate'] = $true       # internal servers often have private certificates
    $cn = New-Object System.Data.SqlClient.SqlConnection($csb.ConnectionString)
    $cn.Open()
    return $cn
}

function Invoke-Select([System.Data.SqlClient.SqlConnection] $cn, [string] $sql) {
    # Safety net: this script must only ever read.
    if ($sql -notmatch '^\s*(SELECT|WITH)\b') { throw "Refusing to run non-SELECT statement: $sql" }
    $cmd = $cn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 120
    $da = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
    $dt = New-Object System.Data.DataTable
    [void]$da.Fill($dt)
    return , $dt
}

function Export-Table($dt, [string] $path) {
    $dt | Select-Object * -ExcludeProperty RowError, RowState, Table, ItemArray, HasErrors | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $path
}

foreach ($src in $config.Sources) {
    if ($Only -and ($Only -notcontains $src.Name)) { continue }
    Write-Host "== $($src.Name): $($src.Server) / $($src.Database)" -ForegroundColor Cyan
    try { $cn = Open-ReadOnlyConnection $src.Server $src.Database }
    catch { Write-Warning "Cannot connect to $($src.Name): $($_.Exception.Message)"; continue }
    try {
        $who = Invoke-Select $cn 'SELECT SUSER_SNAME() AS LoginName, DB_NAME() AS DatabaseName, @@SERVERNAME AS ServerName, @@VERSION AS Version'
        Write-Host ("   connected as {0}" -f $who.Rows[0].LoginName)

        $cols = $null; $rc = $null
        try {
        $cols = Invoke-Select $cn @"
SELECT c.TABLE_SCHEMA, c.TABLE_NAME, t.TABLE_TYPE, c.ORDINAL_POSITION, c.COLUMN_NAME, c.DATA_TYPE,
       c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, c.NUMERIC_SCALE, c.IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS AS c
JOIN INFORMATION_SCHEMA.TABLES  AS t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
"@
        Export-Table $cols (Join-Path $OutDir "$($src.Name)-columns.csv")
        } catch { Write-Warning "$($src.Name): column list failed ($($_.Exception.Message.Split("`n")[0]))" }
        try {

        $rc = Invoke-Select $cn @"
SELECT s.name AS SchemaName, t.name AS TableName, SUM(p.row_count) AS [RowCount]
FROM sys.dm_db_partition_stats AS p
JOIN sys.tables  AS t ON t.object_id = p.object_id
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
WHERE p.index_id IN (0, 1)
GROUP BY s.name, t.name
ORDER BY s.name, t.name
"@
        Export-Table $rc (Join-Path $OutDir "$($src.Name)-rowcounts.csv")
        } catch { Write-Warning "$($src.Name): row counts failed; this login may lack VIEW DATABASE STATE ($($_.Exception.Message.Split("`n")[0]))" }

        $dr = New-Object System.Collections.Generic.List[object]
        foreach ($d in ($config.DateColumns | Where-Object { $_.Source -eq $src.Name })) {
            # Table and column names come from our own config file; still validate them.
            if ($d.Table -notmatch '^[\w\.]+$' -or $d.Column -notmatch '^\w+$') { throw "Bad name in DateColumns: $($d.Table).$($d.Column)" }
            try {
                $r = Invoke-Select $cn "SELECT MIN([$($d.Column)]) AS MinDate, MAX([$($d.Column)]) AS MaxDate, COUNT(*) AS Rows FROM $($d.Table)"
                $dr.Add([pscustomobject]@{ Table = $d.Table; Column = $d.Column; MinDate = $r.Rows[0].MinDate; MaxDate = $r.Rows[0].MaxDate; Rows = $r.Rows[0].Rows; Error = '' })
            } catch { $dr.Add([pscustomobject]@{ Table = $d.Table; Column = $d.Column; MinDate = ''; MaxDate = ''; Rows = ''; Error = $_.Exception.Message }) }
        }
        $dr | Export-Csv -NoTypeInformation -Encoding UTF8 -Path (Join-Path $OutDir "$($src.Name)-dateranges.csv")

        # What can this login do? (membership checks only; nothing is modified)
        $perm = Invoke-Select $cn @"
SELECT IS_MEMBER('db_datareader') AS IsDataReader, IS_MEMBER('db_datawriter') AS IsDataWriter,
       IS_MEMBER('db_owner') AS IsDbOwner, IS_SRVROLEMEMBER('sysadmin') AS IsSysAdmin,
       HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') AS CanInsertSomewhere,
       HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS CanUpdateSomewhere,
       HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE') AS CanDeleteSomewhere
"@
        Export-Table $perm (Join-Path $OutDir "$($src.Name)-permissions.csv")
        $p = $perm.Rows[0]
        if ($p.IsDataWriter -eq 1 -or $p.IsDbOwner -eq 1 -or $p.IsSysAdmin -eq 1 -or $p.CanInsertSomewhere -eq 1 -or $p.CanUpdateSomewhere -eq 1 -or $p.CanDeleteSomewhere -eq 1) {
            Write-Warning "$($src.Name): this login has WRITE rights. Ask C&SS for a read-only login for the migration."
        } else { Write-Host '   read-only access confirmed' -ForegroundColor Green }
        Write-Host ("   snapshot files written to {0}" -f $OutDir)
    }
    finally { $cn.Dispose() }
}
Write-Host 'Done. Review the CSV files, then run Copy-LegacyToStage.ps1.' -ForegroundColor Green
