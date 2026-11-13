namespace MhlLims.Domain.Pathology;

/// <summary>A signed-out case and the animal it belongs to, for study and request summaries.</summary>
public sealed record SummaryCase(int SubjectId, string Phl, string Label, string GroupKey, string Sex, PathologyCase Case);

public sealed record GroupIncidence(int Affected, int Examined, double? MeanGrade);

public sealed record IncidenceRow(string Organ, string Term, bool IsNeoplasm, IReadOnlyDictionary<string, GroupIncidence> ByGroup);

public sealed class NeoplasmCounts
{
    public int Animals { get; set; }
    public int Any { get; set; }
    public int Benign { get; set; }
    public int Malignant { get; set; }
    public int Metastatic { get; set; }
    public int PrimaryBenign { get; set; }
    public int PrimaryMalignant { get; set; }
}

public sealed record AnimalColumn(int SubjectId, string Phl, string Label, string Group, string Sex);

public sealed record TabulatedDiagnosis(string Term, IReadOnlyDictionary<int, string> Cells);

/// <summary>One tissue row of the individual animal table: each animal's status (-, +, NE, NP), then a row per diagnosis.</summary>
public sealed record TabulatedRow(string Organ, IReadOnlyDictionary<int, string> Status, IReadOnlyList<TabulatedDiagnosis> Diagnoses);

public sealed record PathologySummary(
    IReadOnlyDictionary<string, Dictionary<string, int>> Examined,
    IReadOnlyList<IncidenceRow> Incidence,
    IReadOnlyDictionary<string, NeoplasmCounts> Neoplasms,
    IReadOnlyList<AnimalColumn> Animals,
    IReadOnlyList<TabulatedRow> Tabulated,
    IReadOnlyList<string> NotRead);

/// <summary>
/// Study and request summaries over signed-out cases: incidence of each microscopic finding by group with the mean
/// severity of affected animals, neoplasm counts, and the individual animal table (Zaphod's pathology count, neoplasm,
/// severity summary and tabulated pathology reports). A port of summarizePathology in pilot/core/pathology.mjs.
/// </summary>
public static class PathologySummarizer
{
    private sealed class Cell { public int N; public readonly List<int> Grades = new(); }

    public static PathologySummary Summarize(IReadOnlyList<SummaryCase> cases, IReadOnlyList<string> groupKeys)
    {
        var examined = new Dictionary<string, Dictionary<string, int>>();
        var incidence = new Dictionary<(string Organ, string Term), (bool IsNeoplasm, Dictionary<string, Cell> ByGroup)>();
        var incidenceOrder = new List<(string Organ, string Term)>();
        var neoplasms = groupKeys.ToDictionary(g => g, _ => new NeoplasmCounts());
        var organOrder = new List<string>();

        foreach (var sc in cases)
        {
            if (!neoplasms.TryGetValue(sc.GroupKey, out var neo)) continue;
            neo.Animals++;
            bool any = false, benign = false, malignant = false, metastatic = false;
            // Counted once per animal: an organ in two blocks of one case is one animal examined, and one animal affected.
            var read = new HashSet<string>();
            var seen = new HashSet<(string, string)>();
            foreach (var t in sc.Case.TissuesInOrder)
            {
                if (!organOrder.Contains(t.OrganCode)) organOrder.Add(t.OrganCode);
                if (PathologyRules.IsRead(t) && read.Add(t.OrganCode))
                {
                    var byGroup = examined.TryGetValue(t.OrganCode, out var e) ? e : examined[t.OrganCode] = new Dictionary<string, int>();
                    byGroup[sc.GroupKey] = byGroup.GetValueOrDefault(sc.GroupKey) + 1;
                }
                foreach (var dx in t.DiagnosesInOrder)
                {
                    var key = (t.OrganCode, dx.Term);
                    if (!incidence.ContainsKey(key)) { incidence[key] = (dx.IsNeoplasm, new Dictionary<string, Cell>()); incidenceOrder.Add(key); }
                    var cells = incidence[key].ByGroup;
                    var cell = cells.TryGetValue(sc.GroupKey, out var existing) ? existing : cells[sc.GroupKey] = new Cell();
                    if (seen.Add(key)) cell.N++;
                    if (!dx.IsNeoplasm && dx.Severity is { Length: 1 } sev && sev[0] is >= '1' and <= '5') cell.Grades.Add(sev[0] - '0');
                    if (dx.IsNeoplasm)
                    {
                        any = true;
                        if (dx.Origin == NeoplasmOrigin.Metastatic) metastatic = true;
                        else if (dx.Behavior == NeoplasmBehavior.Malignant) { malignant = true; neo.PrimaryMalignant++; }
                        else if (dx.Behavior == NeoplasmBehavior.Benign) { benign = true; neo.PrimaryBenign++; }
                    }
                }
            }
            if (any) neo.Any++;
            if (benign) neo.Benign++;
            if (malignant) neo.Malignant++;
            if (metastatic) neo.Metastatic++;
        }

        var rows = incidenceOrder.Select(key =>
        {
            var (isNeoplasm, byGroup) = incidence[key];
            var groups = groupKeys.ToDictionary(g => g, g =>
            {
                byGroup.TryGetValue(g, out var cell);
                double? mean = cell is { Grades.Count: > 0 } ? Math.Round(cell.Grades.Average() * 10, MidpointRounding.AwayFromZero) / 10 : null;
                return new GroupIncidence(cell?.N ?? 0, examined.GetValueOrDefault(key.Organ)?.GetValueOrDefault(g) ?? 0, mean);
            });
            return new IncidenceRow(key.Organ, key.Term, isNeoplasm, groups);
        })
        .OrderBy(r => organOrder.IndexOf(r.Organ))
        .ThenBy(r => r.IsNeoplasm ? 1 : 0)
        .ThenBy(r => r.Term, StringComparer.InvariantCulture)
        .ToList();

        var animals = cases.Select(sc => new AnimalColumn(sc.SubjectId, sc.Phl, sc.Label, sc.GroupKey, sc.Sex)).ToList();
        var tabulated = new List<TabulatedRow>();
        foreach (var organ in organOrder)
        {
            var status = new Dictionary<int, string>();
            var terms = new Dictionary<string, Dictionary<int, string>>();
            var termOrder = new List<string>();
            foreach (var sc in cases)
            {
                var ts = sc.Case.TissuesInOrder.Where(t => t.OrganCode == organ).ToList();
                if (ts.Count == 0) continue;
                status[sc.SubjectId] = ts.Any(t => t.Result == TissueResult.Lesions) ? "+" : StatusMark(ts[0].Result);
                foreach (var dx in ts.SelectMany(t => t.DiagnosesInOrder))
                {
                    if (!terms.ContainsKey(dx.Term)) { terms[dx.Term] = new Dictionary<int, string>(); termOrder.Add(dx.Term); }
                    terms[dx.Term][sc.SubjectId] = PathologyRules.Mark(dx);
                }
            }
            tabulated.Add(new TabulatedRow(organ, status, termOrder.Select(t => new TabulatedDiagnosis(t, terms[t])).ToList()));
        }
        // Tissues no animal had read would only fill the table with "NE"; list them separately.
        var shown = tabulated.Where(r => r.Status.Values.Any(m => m is "-" or "+")).ToList();
        var notRead = tabulated.Where(r => !shown.Contains(r)).Select(r => r.Organ).ToList();
        return new PathologySummary(examined, rows, neoplasms, animals, shown, notRead);
    }

    private static string StatusMark(TissueResult r) => r switch
    {
        TissueResult.Nsl => "-",
        TissueResult.Lesions => "+",
        TissueResult.NotExamined => "NE",
        TissueResult.NotPresent => "NP",
        _ => "?",
    };
}
