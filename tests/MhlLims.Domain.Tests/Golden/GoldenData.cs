using System.Text.Json;
using MhlLims.Domain.Ihc;
using MhlLims.Domain.Pathology;

namespace MhlLims.Domain.Tests.Golden;

// Cases written by tools/rules-reference/make_golden.mjs from the pilot's JavaScript rules
// (pilot/core/ihc.mjs, pathology.mjs, necrules.mjs). Each test feeds the same inputs to MhlLims.Domain
// and expects the same outputs, so the C# port matches the rules staff have tried in the pilot.
// After changing a rule in the pilot, re-run the generator; a failing test then shows where C# must follow.

internal sealed record GDilution(string Input, string Value, bool Recovered);
internal sealed record GSpecies(string Input, List<string> Tags, List<string> Other);
internal sealed record GFixative(string Input, List<string> Tags);
internal sealed record GClassify(string Name, string Kit, string Kind, int Plex, string Chromogen, string Platform);
internal sealed record GKindLabel(string Kind, int Plex, string Label);
internal sealed record GAssay(int Id, string Name, string Kind, int Plex, string Status, List<string> SpeciesTags, List<string> FixTags);
internal sealed record GFit(GAssay Assay, string Species, string Fixative, List<string> SampleTypes, List<string> Notes);
internal sealed record GNewAntibody(string Name, bool Supplied);
internal sealed record GStain(int? AssayId, GNewAntibody? NewAntibody);
internal sealed record GSample(string Tissue, string Type);
internal sealed record GDraft(string Species, string FixativeUsed, string? DateIntoFixative, string Importance, int HePerBlock, int UnstainedPerBlock,
    bool Scan20x, bool Scan40x, List<GSample> Samples, List<GStain> Stains);
internal sealed record GLine(string Section, string Code, decimal Units, string? Note);
internal sealed record GIhcRequest(string Name, string Today, GDraft Draft, List<GAssay> Assays, List<GLine> Lines, List<string> Assumptions, int Blocks,
    List<string> Areas, List<string> Warnings, string Summary);

internal sealed record GFinding(string Morphology);
internal sealed record GOrgan(string Organ, bool Weigh, decimal? Weight, bool NotCollected, List<GFinding> Findings);
internal sealed record GNecropsyInput(decimal? BodyWeight, string Fate, bool Partial, bool MatchesCageCard, string Perfusion, Dictionary<string, JsonElement>? Extras, List<GOrgan> Organs);
internal sealed record GNecropsy(string Name, bool ProtocolWeighsAnimal, GNecropsyInput Necropsy, List<string> Problems, List<GLine> Charges);

internal sealed record GDx(string? Id, string Term, bool Neoplasm, string? Modifier, string? Distribution, string? Laterality, string? Severity, string? Behavior, string? Origin, List<int>? Correlates);
internal sealed record GDxText(GDx Dx, string Text, string Mark);
internal sealed record GDiagnosesFor(string Organ, List<string> Terms);
internal sealed record GTissue(string Organ, string? Block, string Result, List<GDx> Diagnoses);
internal sealed record GCase(List<GTissue> Tissues, List<int> GrossNoCorrelate, string? CauseOfDeathKind, string? CauseOfDeathDxId, int ExtraQuarterHours, string? ExtraTimeNote);
internal sealed record GGross(int Id, string Organ);
internal sealed record GPathologyCase(string Name, GCase Case, List<GGross> GrossFindings, bool NeedCauseOfDeath, int Slides, List<string> Problems);
internal sealed record GSignOutCharges(int Slides, int ExtraQuarterHours, string ExtraTimeNote, decimal BilledSlides, decimal BilledQuarterHours, int Version, List<GLine> Charges);
internal sealed record GSummaryCase(int SubjectId, string Phl, string Label, string GroupKey, string Sex, GCase Case);
internal sealed record GGroupIncidence(int Affected, int Examined, double? MeanGrade);
internal sealed record GIncidence(string Organ, string Term, bool Neoplasm, Dictionary<string, GGroupIncidence> ByGroup);
internal sealed record GNeoplasms(int Animals, int Any, int Benign, int Malignant, int Metastatic, int PrimaryBenign, int PrimaryMalignant);
internal sealed record GTabulatedDx(string Term, Dictionary<string, string> Cells);
internal sealed record GTabulated(string Organ, Dictionary<string, string> Status, List<GTabulatedDx> Diagnoses);
internal sealed record GSummary(string Name, List<GSummaryCase> Cases, List<string> GroupKeys, List<GIncidence> Incidence, Dictionary<string, GNeoplasms> Neoplasms,
    List<GTabulated> Tabulated, List<string> NotRead);

internal sealed record GoldenFile(
    List<GDilution> ExcelDilution, List<GDilution> ExcelDateName, List<GSpecies> SpeciesTags, List<GFixative> FixativeTags,
    List<GClassify> Classify, List<GKindLabel> KindLabel, List<GFit> AssayFit, List<GIhcRequest> IhcRequests, List<GNecropsy> Necropsy,
    List<GDxText> DxText, List<GDiagnosesFor> DiagnosesFor, List<GPathologyCase> PathologyCases, List<GSignOutCharges> SignOutCharges,
    List<GSummary> PathologySummaries);

internal static class GoldenData
{
    private static readonly Lazy<GoldenFile> File = new(() =>
    {
        var path = Path.Combine(AppContext.BaseDirectory, "TestData", "ihc-pathology-golden.json");
        return JsonSerializer.Deserialize<GoldenFile>(System.IO.File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
               ?? throw new InvalidOperationException("Could not read ihc-pathology-golden.json");
    });

    public static GoldenFile Cases => File.Value;

    /// <summary>xUnit MemberData rows: (case name, index), so test names show which case failed.</summary>
    public static IEnumerable<object[]> Rows<T>(Func<GoldenFile, List<T>> pick, Func<T, string> name) =>
        pick(Cases).Select((c, i) => new object[] { $"{i:000} {Truncate(name(c))}", i });

    private static string Truncate(string s) => s.Length > 60 ? s[..60] : s;

    // ---------- converting the JavaScript shapes ----------

    public static AssayKind Kind(string js) => js switch
    {
        "IHC" => AssayKind.Ihc, "Opal" => AssayKind.Opal, "IF" => AssayKind.If, "TUNEL" => AssayKind.Tunel, "β-gal" => AssayKind.BetaGal,
        _ => throw new ArgumentOutOfRangeException(nameof(js), js, null),
    };

    public static AssayView Assay(GAssay a) =>
        new(a.Id, a.Name, Kind(a.Kind), a.Plex, Enum.Parse<AssayStatus>(a.Status, true), a.SpeciesTags, a.FixTags);

    public static SampleType Sample(string js) => Enum.Parse<SampleType>(js, true);

    public static IhcDraft Draft(GDraft d) => new(
        d.Species, d.FixativeUsed, d.DateIntoFixative is null ? null : DateOnly.Parse(d.DateIntoFixative, System.Globalization.CultureInfo.InvariantCulture),
        d.Importance == "STAT" ? IhcImportance.Stat : IhcImportance.Routine, d.HePerBlock, d.UnstainedPerBlock, d.Scan20x, d.Scan40x,
        d.Samples.Select(s => new SampleDraft(s.Tissue, Sample(s.Type))).ToList(),
        d.Stains.Select(s => new StainDraft(s.AssayId, s.NewAntibody is null ? null : new NewAntibodyDraft(s.NewAntibody.Name, s.NewAntibody.Supplied))).ToList());

    private static readonly (string Key, NecropsyProcedureCode Code)[] Extras =
    [
        ("terminalBleed", NecropsyProcedureCode.TerminalBleed), ("bloodCollection", NecropsyProcedureCode.BloodCollection),
        ("boneMarrowSmear", NecropsyProcedureCode.BoneMarrowSmear), ("biohazard", NecropsyProcedureCode.Biohazard),
        ("snapFreezeTubes", NecropsyProcedureCode.SnapFreezeTubes), ("bloodSmearPairs", NecropsyProcedureCode.BloodSmearPairs),
    ];

    public static Necropsy Necropsy(GNecropsyInput n)
    {
        var necropsy = new Necropsy
        {
            BodyWeightG = n.BodyWeight, Fate = n.Fate, IsPartial = n.Partial, MatchesCageCard = n.MatchesCageCard,
            Perfusion = string.IsNullOrEmpty(n.Perfusion) ? null : Enum.Parse<Perfusion>(n.Perfusion, true),
            Organs = n.Organs.Select((o, i) => new NecropsyOrgan
            {
                Sequence = i + 1, OrganCode = o.Organ, IsWeighed = o.Weigh, WeightG = o.Weight, NotCollected = o.NotCollected,
                Findings = o.Findings.Select(f => new NecropsyFinding { Morphology = f.Morphology }).ToList(),
            }).ToList(),
        };
        foreach (var (key, code) in Extras)
        {
            if (n.Extras is null || !n.Extras.TryGetValue(key, out var v)) continue;
            var quantity = v.ValueKind switch { JsonValueKind.True => 1, JsonValueKind.Number => v.GetInt32(), _ => 0 };
            if (quantity > 0) necropsy.Procedures.Add(new NecropsyProcedure { ProcedureCode = code, Quantity = quantity });
        }
        return necropsy;
    }

    public static TissueResult Result(string js) => Enum.Parse<TissueResult>(js.Replace("_", string.Empty), true);

    public static PathologyDiagnosis Diagnosis(GDx d, int id, int sequence) => new()
    {
        Id = id, Sequence = sequence, Term = d.Term, IsNeoplasm = d.Neoplasm, Modifier = Blank(d.Modifier), Distribution = Blank(d.Distribution),
        Laterality = Blank(d.Laterality), Severity = Blank(d.Severity),
        Behavior = string.IsNullOrEmpty(d.Behavior) ? null : Enum.Parse<NeoplasmBehavior>(d.Behavior, true),
        Origin = string.IsNullOrEmpty(d.Origin) ? null : Enum.Parse<NeoplasmOrigin>(d.Origin, true),
        Correlations = (d.Correlates ?? []).Select(g => new PathologyCorrelation { DiagnosisEntryId = id, NecropsyFindingId = g }).ToList(),
    };

    /// <summary>Builds a case; diagnosis ids are numbered in order, and the cause-of-death reference follows them.</summary>
    public static PathologyCase Case(GCase g)
    {
        var ids = new Dictionary<string, int>();
        var next = 1;
        var c = new PathologyCase
        {
            ExtraQuarterHours = g.ExtraQuarterHours, ExtraTimeNote = g.ExtraTimeNote,
            NoCorrelate = g.GrossNoCorrelate.Select(f => new GrossNoCorrelate { NecropsyFindingId = f }).ToList(),
            Tissues = g.Tissues.Select((t, ti) => new PathologyTissue
            {
                Sequence = ti + 1, OrganCode = t.Organ, BlockCode = t.Block, Result = Result(t.Result),
                Diagnoses = t.Diagnoses.Select((d, di) =>
                {
                    var id = next++;
                    if (d.Id is not null) ids.TryAdd(d.Id, id);
                    return Diagnosis(d, id, di + 1);
                }).ToList(),
            }).ToList(),
        };
        c.CauseOfDeathKind = g.CauseOfDeathKind switch
        {
            "NA" => CauseOfDeathKind.NotApplicable, "UNDETERMINED" => CauseOfDeathKind.Undetermined, "DIAGNOSIS" => CauseOfDeathKind.Diagnosis, _ => null,
        };
        c.CauseOfDeathDiagnosisEntryId = g.CauseOfDeathDxId is not null && ids.TryGetValue(g.CauseOfDeathDxId, out var dxId) ? dxId : null;
        return c;
    }

    private static string? Blank(string? s) => string.IsNullOrEmpty(s) ? null : s;
}
