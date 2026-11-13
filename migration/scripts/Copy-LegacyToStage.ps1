<#
.SYNOPSIS
  Step 2 of the legacy migration: copy legacy tables, unchanged, into the stage schema of the LIMS
  development database.

.DESCRIPTION
  * Source databases are opened read-only (Windows authentication, ApplicationIntent=ReadOnly) and only
    SELECT * is run against them.
  * Each legacy table is copied into stage.<StageName> in the LIMS database. If the stage table does not
    exist it is created from the source's own column definitions, so the copy never depends on guesses
    about the legacy schema. The extra columns _SourceDb, _LoadRunId and _LoadedAt are added.
  * Re-running replaces the rows of the same _SourceDb tag only (PROD and RETIRE copies of the same table
    can coexist in one stage table).
  * Every copy is logged in legacy.LoadRun (row counts per table).
  * Run sql\000_support.sql in the LIMS database first (it creates the stage schema and legacy.LoadRun usage).

.PARAMETER ConfigPath  Path to sources.psd1.
.PARAMETER Only        Optional list of source names (PHL, PHLRETIRE, ZAPHOD).
.PARAMETER Table       Optional list of stage table names (e.g. PHL_phl_request) to copy.
.PARAMETER WhatIf      Show what would be copied without writing anything.

.EXAMPLE
  .\Copy-LegacyToStage.ps1 -ConfigPath ..\config\sources.psd1 -Only ZAPHOD
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [string] $ConfigPath,
    [string[]] $Only,
    [string[]] $Table
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$config = Import-PowerShellDataFile -Path $ConfigPath

function New-Connection([string] $server, [string] $database, [bool] $readOnly, [string] $appName) {
    $csb = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
    $csb['Data Source'] = $server
    $csb['Initial Catalog'] = $database
    $csb['Integrated Security'] = $true
    if ($readOnly) { $csb['ApplicationIntent'] = 'ReadOnly' }
    $csb['Application Name'] = $appName
    $csb['Connect Timeout'] = 30
    $csb['Encrypt'] = $true
    $csb['TrustServerCertificate'] = $true
    $cn = New-Object System.Data.SqlClient.SqlConnection($csb.ConnectionString)
    $cn.Open()
    return $cn
}

function Get-SqlColumnType($row) {
    # $row comes from SqlDataReader.GetSchemaTable(). Everything is created NULLable: this is a raw copy.
    $t = $row.DataTypeName.ToLowerInvariant()
    $size = $row.ColumnSize
    switch ($t) {
        { $_ -in 'char', 'varchar', 'nchar', 'nvarchar' } {
            $isUnicode = $t.StartsWith('n')
            $limit = if ($isUnicode) { 4000 } else { 8000 }
            if ($size -le 0 -or $size -gt $limit) { if ($isUnicode) { return 'nvarchar(max)' } else { return 'varchar(max)' } }
            return "$t($size)" }
        { $_ -in 'text' }        { return 'varchar(max)' }
        { $_ -in 'ntext' }       { return 'nvarchar(max)' }
        { $_ -in 'decimal', 'numeric' } { return "decimal($($row.NumericPrecision),$($row.NumericScale))" }
        { $_ -in 'money', 'smallmoney', 'float', 'real', 'int', 'bigint', 'smallint', 'tinyint', 'bit',
                 'datetime', 'smalldatetime', 'date', 'uniqueidentifier' } { return $t }
        { $_ -in 'datetime2', 'datetimeoffset', 'time' } { return "$t($($row.NumericScale))" }
        { $_ -in 'timestamp', 'rowversion' } { return 'binary(8)' }       # cannot copy into a timestamp column
        { $_ -in 'binary', 'varbinary' } { if ($size -le 0 -or $size -gt 8000) { return 'varbinary(max)' } else { return "$t($size)" } }
        { $_ -in 'image' }       { return 'varbinary(max)' }
        { $_ -in 'xml' }         { return 'xml' }
        default                  { return 'sql_variant' }
    }
}

$stage = $config.Stage
# Safety: the stage database must never be one of the legacy sources (this script runs DELETE and CREATE TABLE there).
foreach ($src in $config.Sources) {
    if ($src.Server -eq $stage.Server -and $src.Database -eq $stage.Database) {
        throw "Stage target ($($stage.Server)/$($stage.Database)) is the same as source '$($src.Name)'. Refusing to continue."
    }
}
$dst = New-Connection $stage.Server $stage.Database $false 'MHL-LIMS-migration-stage'
try {
    $cmd = $dst.CreateCommand(); $cmd.CommandText = "SELECT CASE WHEN SCHEMA_ID(N'stage') IS NULL THEN 0 ELSE 1 END"
    if ([int]$cmd.ExecuteScalar() -eq 0) { throw 'Schema [stage] not found. Run migration\sql\000_support.sql in the LIMS database first.' }

    foreach ($src in $config.Sources) {
        if ($Only -and ($Only -notcontains $src.Name)) { continue }
        if ($src.Server -like '<*') { Write-Warning "$($src.Name): server name not filled in; skipped."; continue }
        Write-Host "== $($src.Name) [$($src.Tag)] $($src.Server)/$($src.Database)" -ForegroundColor Cyan
        $srcCn = New-Connection $src.Server $src.Database $true 'MHL-LIMS-migration-copy'
        $counts = [ordered]@{}
        $runId = $null
        try {
            if ($PSCmdlet.ShouldProcess("legacy.LoadRun", "start run for $($src.Name)")) {
                $c = $dst.CreateCommand()
                $c.CommandText = "INSERT INTO legacy.LoadRun (SourceSystem, Notes) VALUES (@s, N'Copy-LegacyToStage.ps1'); SELECT CAST(SCOPE_IDENTITY() AS int);"
                [void]$c.Parameters.AddWithValue('@s', $src.Name)
                $runId = [int]$c.ExecuteScalar()
            }
            foreach ($t in $src.Tables) {
                if ($Table -and ($Table -notcontains $t.Stage)) { continue }
                # names come from our own config; validate anyway
                if ($t.Source -notmatch '^[\w\.]+$' -or $t.Stage -notmatch '^\w+$') { throw "Bad table name in config: $($t.Source) / $($t.Stage)" }
                $sel = $srcCn.CreateCommand(); $sel.CommandText = "SELECT * FROM $($t.Source)"; $sel.CommandTimeout = 0
                try { $rd = $sel.ExecuteReader([System.Data.CommandBehavior]::SequentialAccess -bor [System.Data.CommandBehavior]::SchemaOnly) }
                catch { Write-Warning ("   {0}: not readable ({1})" -f $t.Source, $_.Exception.Message.Split("`n")[0]); $counts[$t.Stage] = 'NOT READABLE'; continue }
                $schema = $rd.GetSchemaTable(); $rd.Close()

                $colDefs = foreach ($r in $schema.Rows) { "[{0}] {1} NULL" -f $r.ColumnName, (Get-SqlColumnType $r) }
                $ddl = @"
IF OBJECT_ID(N'stage.$($t.Stage)') IS NULL
CREATE TABLE stage.[$($t.Stage)] (
    $($colDefs -join ",`n    "),
    _SourceDb  nvarchar(20) NULL,
    _LoadRunId int NULL,
    _LoadedAt  datetime2(0) NOT NULL CONSTRAINT [DF_stage_$($t.Stage)_LoadedAt] DEFAULT (sysutcdatetime())
)
"@
                if ($PSCmdlet.ShouldProcess("stage.$($t.Stage)", "copy from $($src.Database).$($t.Source)")) {
                    $c = $dst.CreateCommand(); $c.CommandText = $ddl; [void]$c.ExecuteNonQuery()

                    # Delete the old copy of this source, copy, and tag the new rows in ONE transaction, so an
                    # interrupted copy can never leave untagged or duplicated rows behind.
                    $tx = $dst.BeginTransaction()
                    try {
                        $c = $dst.CreateCommand(); $c.Transaction = $tx
                        $c.CommandText = "DELETE FROM stage.[$($t.Stage)] WHERE _SourceDb = @tag OR _SourceDb IS NULL"
                        [void]$c.Parameters.AddWithValue('@tag', $src.Tag); [void]$c.ExecuteNonQuery()

                        $sel2 = $srcCn.CreateCommand(); $sel2.CommandText = "SELECT * FROM $($t.Source)"; $sel2.CommandTimeout = 0
                        $rd = $sel2.ExecuteReader()
                        $bc = New-Object System.Data.SqlClient.SqlBulkCopy($dst, [System.Data.SqlClient.SqlBulkCopyOptions]::TableLock, $tx)
                        $bc.DestinationTableName = "stage.[$($t.Stage)]"; $bc.BulkCopyTimeout = 0; $bc.BatchSize = 5000
                        for ($i = 0; $i -lt $rd.FieldCount; $i++) { [void]$bc.ColumnMappings.Add($rd.GetName($i), $rd.GetName($i)) }
                        try { $bc.WriteToServer($rd) } finally { $rd.Close(); $bc.Close() }

                        $c = $dst.CreateCommand(); $c.Transaction = $tx
                        $c.CommandText = "UPDATE stage.[$($t.Stage)] SET _SourceDb = @tag, _LoadRunId = @run WHERE _SourceDb IS NULL; SELECT COUNT(*) FROM stage.[$($t.Stage)] WHERE _SourceDb = @tag;"
                        [void]$c.Parameters.AddWithValue('@tag', $src.Tag); [void]$c.Parameters.AddWithValue('@run', $runId)
                        $n = [int]$c.ExecuteScalar()
                        $tx.Commit()
                    }
                    catch { $tx.Rollback(); throw }
                    $counts[$t.Stage] = $n
                    Write-Host ("   {0,-34} {1,10:N0} rows" -f $t.Stage, $n)
                } else { Write-Host ("   would copy {0} -> stage.{1}" -f $t.Source, $t.Stage) }
            }
            if ($runId) {
                $c = $dst.CreateCommand()
                $c.CommandText = "UPDATE legacy.LoadRun SET Status = N'SUCCEEDED', FinishedAt = sysutcdatetime(), RowCountsJson = @j WHERE LoadRunId = @run"
                [void]$c.Parameters.AddWithValue('@j', ($counts | ConvertTo-Json -Compress)); [void]$c.Parameters.AddWithValue('@run', $runId); [void]$c.ExecuteNonQuery()
            }
        }
        catch {
            if ($runId) {
                $c = $dst.CreateCommand(); $c.CommandText = "UPDATE legacy.LoadRun SET Status = N'FAILED', FinishedAt = sysutcdatetime(), Notes = LEFT(CONCAT(Notes, N': ', @m), 4000) WHERE LoadRunId = @run"
                [void]$c.Parameters.AddWithValue('@m', $_.Exception.Message); [void]$c.Parameters.AddWithValue('@run', $runId); [void]$c.ExecuteNonQuery()
            }
            throw
        }
        finally { $srcCn.Dispose() }
    }
}
finally { $dst.Dispose() }
Write-Host 'Done. Next: run sql\010_check_stage.sql in the LIMS database.' -ForegroundColor Green
