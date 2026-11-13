using System.Globalization;
using System.Text;

namespace MhlLims.Domain.Billing;

/// <summary>A released charge with the request details the extract needs.</summary>
public sealed record BillableLine(
    string RequestNumber, string LabCode, string? CostpointProjectId, string InvestigatorName, string? NasNumber, string ChargeCode, decimal Units);

public sealed record Rpt080Record(string TransId, string TransDate, string CenterNo, string Requestor, decimal Units, string ChargeCode, string CsasNo);

/// <summary>
/// Reproduces PHL's "Rpt080 - Shared Service Transaction Extract" so C&amp;SS shared-service billing
/// keeps working unchanged after cutover. Formulas come from the PHL DataWindow d_rep080:
///   trans_id  = first letter of lab + last 5 characters of the request id
///   center_no = characters 3-12 of the project number
///   units     = summed per request and charge code
///   csas_no   = "CS-" + NAS number (column r_apo_no)
/// VERIFY against a real extract file before the parallel billing run: field order, delimiter,
/// date used for trans_date and the requestor format are inferred, not confirmed.
/// </summary>
public static class Rpt080Extract
{
    public const string FormatName = "RPT080";

    public static IReadOnlyList<Rpt080Record> Build(IEnumerable<BillableLine> lines, DateOnly transDate)
    {
        var date = transDate.ToString("yyMMdd", CultureInfo.InvariantCulture);
        return lines
            .GroupBy(l => (l.RequestNumber, l.ChargeCode))
            .Select(g => new { First = g.First(), Units = g.Sum(x => x.Units) })
            .Where(x => x.Units != 0)
            .OrderBy(x => x.First.RequestNumber, StringComparer.Ordinal)
            .ThenBy(x => x.First.ChargeCode, StringComparer.Ordinal)
            .Select(x => new Rpt080Record(
                TransId(x.First.LabCode, x.First.RequestNumber),
                date,
                CenterNo(x.First.CostpointProjectId),
                Clean(x.First.InvestigatorName),
                x.Units,
                x.First.ChargeCode,
                string.IsNullOrWhiteSpace(x.First.NasNumber) ? string.Empty : "CS-" + x.First.NasNumber.Trim()))
            .ToList();
    }

    /// <summary>mid(lab,1,1) + right(req_id,5)</summary>
    public static string TransId(string labCode, string requestNumber)
    {
        var right5 = requestNumber.Length <= 5 ? requestNumber : requestNumber[^5..];
        return labCode[..1].ToUpperInvariant() + right5;
    }

    /// <summary>mid(r_center_no,3,10): skip two characters, take up to ten.</summary>
    public static string CenterNo(string? projectNumber)
    {
        if (string.IsNullOrEmpty(projectNumber) || projectNumber.Length <= 2) return string.Empty;
        var rest = projectNumber[2..];
        return rest.Length > 10 ? rest[..10] : rest;
    }

    /// <summary>PHL ran f_replace_commas on text fields; commas would break the delimited file.</summary>
    public static string Clean(string text) =>
        text.Replace(",", " ", StringComparison.Ordinal).Replace("\r", " ", StringComparison.Ordinal).Replace("\n", " ", StringComparison.Ordinal).Trim();

    public static string Write(IEnumerable<Rpt080Record> records)
    {
        var sb = new StringBuilder();
        foreach (var r in records)
        {
            sb.Append(string.Join(",",
                r.TransId, r.TransDate, r.CenterNo, r.Requestor,
                r.Units.ToString("0.##", CultureInfo.InvariantCulture), r.ChargeCode, r.CsasNo));
            sb.Append("\r\n");
        }
        return sb.ToString();
    }

    /// <summary>PHL wrote &lt;extract dir&gt;\&lt;lab&gt;\&lt;LAB&gt;yymmdd.txt, e.g. hp\HP271231.txt.</summary>
    public static string FileName(string labCode, DateOnly periodEnd) =>
        $"{labCode.ToLowerInvariant()}\\{labCode.ToUpperInvariant()}{periodEnd.ToString("yyMMdd", CultureInfo.InvariantCulture)}.txt";
}
