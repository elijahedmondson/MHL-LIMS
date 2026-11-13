using MhlLims.Domain.Billing;
using MhlLims.Domain.Common;

namespace MhlLims.Domain.Ihc;

/// <summary>The parts of an assay the request rules need.</summary>
public sealed record AssayView(int Id, string Name, AssayKind Kind, int Plex, AssayStatus Status, IReadOnlyList<string> SpeciesTags, IReadOnlyList<string> FixativeTags)
{
    public static AssayView From(Assay a) =>
        new(a.Id, a.Name, a.Kind, a.Plex, a.Status, a.SpeciesTags.Select(t => t.Tag).ToList(), a.FixativeTags.Select(t => t.Tag).ToList());
}

public sealed record NewAntibodyDraft(string Name, bool Supplied);

/// <summary>A stain on a request: a catalog assay, or a new antibody the IHC team must optimize first.</summary>
public sealed record StainDraft(int? AssayId, NewAntibodyDraft? NewAntibody);

public sealed record SampleDraft(string Tissue, SampleType Type);

/// <summary>What the rules need from an IHC request, whether submitted or still being filled in.</summary>
public sealed record IhcDraft(
    string Species, string FixativeUsed, DateOnly? DateIntoFixative, IhcImportance Importance,
    int HePerBlock, int UnstainedPerBlock, bool Scan20x, bool Scan40x,
    IReadOnlyList<SampleDraft> Samples, IReadOnlyList<StainDraft> Stains)
{
    public static IhcDraft From(IhcRequest r) => new(
        r.SpeciesChoice, r.FixativeUsed, r.DateIntoFixative, r.Importance, r.HeSlidesPerBlock, r.UnstainedSlidesPerBlock, r.Scan20x, r.Scan40x,
        r.Samples.OrderBy(s => s.SampleNumber).Select(s => new SampleDraft(s.Tissue, s.SampleType)).ToList(),
        r.Stains.OrderBy(s => s.StainNumber).Select(s => new StainDraft(s.AssayId,
            s.AssayId is null && s.NewAntibodyName is not null ? new NewAntibodyDraft(s.NewAntibodyName, s.RequesterSuppliesAntibody) : null)).ToList());
}

public sealed record IhcEstimate(IReadOnlyList<PlannedCharge> Lines, IReadOnlyList<string> Assumptions, int Blocks);

/// <summary>
/// Matching assays to a sample, pricing an IHC request from the CY2027 codes, the work areas it passes through,
/// and what the IHC team should check before accepting it. A port of pilot/core/ihc.mjs.
/// </summary>
public static class IhcRequestRules
{
    /// <summary>The form's species choices and the subject type a PHL number gets (ref.SubjectType).</summary>
    public static readonly IReadOnlyList<(string Choice, string Label, string SubjectTypeCode)> RequestSpecies =
    [
        ("Mouse", "Mouse", "MOUSE"), ("Rat", "Rat", "RAT"), ("Human", "Human (coded tissue)", "HUMAN_DONOR"),
        ("PDX", "Human xenograft in mouse (PDX)", "PDX_MODEL"), ("Organoid", "Organoid", "ORGANOID_LINE"),
        ("Canine", "Canine", "OTHER_ANIMAL"), ("Other", "Other", "OTHER_ANIMAL"),
    ];

    /// <summary>The form's fixative choices and the catalog fixative term each matches (null = no check).</summary>
    public static readonly IReadOnlyList<(string Label, string? Tag)> RequestFixatives =
    [
        ("10% NBF", "NBF"), ("4% PFA", "PFA"), ("Zinc formalin", "Zinc formalin"), ("70% ethanol", "Ethanol"), ("Methanol", "Methanol"),
        ("Bouin's", "Bouin's"), ("Carnoy's", "Carnoy's"), ("Fresh frozen (OCT)", "Frozen"), ("Other", null),
    ];

    private static readonly Dictionary<string, string[]> SpeciesAccepts = new()
    {
        ["Mouse"] = ["Mouse"], ["Rat"] = ["Rat"], ["Human"] = ["Human"], ["PDX"] = ["Human xenograft", "Human"],
        ["Organoid"] = ["Human", "Mouse"], ["Canine"] = ["Canine"],
    };

    /// <summary>
    /// Why an assay may not suit the sample. Warnings, not errors: the IHC team may still run an assay outside
    /// the species or fixative it was validated on.
    /// </summary>
    public static IReadOnlyList<string> AssayFit(AssayView assay, string species, string fixative, IReadOnlyCollection<SampleType> sampleTypes)
    {
        var notes = new List<string>();
        if (SpeciesAccepts.TryGetValue(species, out var want) && assay.SpeciesTags.Count > 0 && !want.Any(assay.SpeciesTags.Contains))
            notes.Add($"listed for {string.Join(", ", assay.SpeciesTags)}, not {(species == "PDX" ? "human xenografts" : species.ToLowerInvariant())}");
        var fixTag = RequestFixatives.FirstOrDefault(f => f.Label == fixative).Tag;
        var frozenOnly = sampleTypes.Count > 0 && sampleTypes.All(t => t == SampleType.Frozen);
        if (frozenOnly && assay.FixativeTags.Count > 0 && !assay.FixativeTags.Contains("Frozen"))
            notes.Add("validated on fixed tissue, not frozen");
        else if (!frozenOnly && fixTag is not null && fixTag != "Frozen" && assay.FixativeTags.Count > 0 && !assay.FixativeTags.Contains(fixTag))
            notes.Add($"validated on {string.Join(", ", assay.FixativeTags)}, not {fixative}");
        return notes;
    }

    private static readonly Dictionary<int, string> OpalCodes = new()
    {
        [1] = "HP006009", [2] = "HP006010", [3] = "HP006011", [4] = "HP006012", [5] = "HP006013", [6] = "HP006014",
    };

    /// <summary>The STAIN codes one slide of a stain is charged at.</summary>
    public static IReadOnlyList<(string Section, string Code, int PerSlide)> StainCodes(StainDraft stain, AssayView? assay)
    {
        if (stain.NewAntibody is not null) return [("STAIN", stain.NewAntibody.Supplied ? "HP006005" : "HP006004", 1)];
        if (assay is null) return [];
        return assay.Kind switch
        {
            AssayKind.Tunel => [("STAIN", "HP006008", 1)],
            AssayKind.BetaGal => [("STAIN", "HP006001", 1)],
            AssayKind.Opal => [("STAIN", OpalCodes[Math.Min(6, Math.Max(1, assay.Plex))], 1)],
            _ => [("STAIN", "HP006004", Math.Max(1, assay.Plex))],
        };
    }

    private static readonly string[] SectionOrder = ["TRIM_EMBED", "MICROTOMY", "STAIN", "IMAGE"];

    /// <summary>
    /// Turns a request into estimate lines. Per block: a paraffin or OCT block for fixed or frozen tissue, one first
    /// section and the rest as subsequent sections, H&amp;E, each stain, and scans (brightfield on the Aperio at the
    /// magnifications asked for, fluorescent slides on the Akoya). Where the price list has no obvious code the
    /// estimate says what it assumed.
    /// </summary>
    public static IhcEstimate Estimate(IhcDraft draft, Func<int, AssayView?> assayById)
    {
        var units = new Dictionary<(string Section, string Code), decimal>();
        var assumptions = new List<string>();
        void Add(string section, string code, decimal n) { if (n > 0) units[(section, code)] = units.GetValueOrDefault((section, code)) + n; }
        void Assume(string text) { if (!assumptions.Contains(text)) assumptions.Add(text); }

        var he = Math.Max(0, draft.HePerBlock);
        var unstained = Math.Max(0, draft.UnstainedPerBlock);
        var stains = draft.Stains.Select(s => (Stain: s, Assay: s.AssayId is int id ? assayById(id) : null)).ToList();
        var scanning = draft.Scan20x || draft.Scan40x;
        foreach (var sample in draft.Samples)
        {
            var cut = sample.Type != SampleType.Slides;
            var slides = he + (cut ? unstained : 0) + stains.Count;
            if (sample.Type == SampleType.Fixed) Add("TRIM_EMBED", "HP003003", 1);
            if (sample.Type == SampleType.Frozen) Add("TRIM_EMBED", "HP003005", 1);
            if (cut && slides > 0) { Add("MICROTOMY", "HP004001", 1); Add("MICROTOMY", "HP004002", slides - 1); }
            if (!cut && unstained > 0) Assume("Unstained slides cannot be cut from submitted slides, so they are not estimated.");
            Add("STAIN", "HP005003", he);
            var bright = he;
            var fluorescent = 0;
            foreach (var (stain, assay) in stains)
            {
                foreach (var c in StainCodes(stain, assay)) Add(c.Section, c.Code, c.PerSlide);
                if (assay is not null && IhcCatalogRules.IsFluorescent(assay.Kind)) fluorescent++; else bright++;
            }
            if (draft.Scan20x) Add("IMAGE", "HP001006", bright);
            if (draft.Scan40x) Add("IMAGE", "HP001007", bright);
            if (scanning) Add("IMAGE", "HP001009", fluorescent);
        }
        foreach (var (stain, assay) in stains)
        {
            if (stain.NewAntibody is not null)
            {
                Add("STAIN", "HP009002", 8);
                Assume("A new antibody is estimated with 2 hours of optimization labor (HP009002 x 8) plus one slide per block; MHL confirms after reviewing the antibody.");
                if (stain.NewAntibody.Supplied) Assume("The requester supplies the antibody, so slides use HP006005 (IHC, labor only).");
            }
            else if (assay is { Kind: AssayKind.Ihc, Plex: > 1 })
                Assume($"{assay.Name}: the price list has no chromogenic multiplex code, so it is estimated as {assay.Plex} x HP006004 per slide.");
            else if (assay is { Kind: AssayKind.If })
                Assume($"{assay.Name}: non-Opal immunofluorescence has no code of its own, so it is estimated as HP006004 per slide.");
        }
        if (scanning && stains.Any(s => s.Assay is not null && IhcCatalogRules.IsFluorescent(s.Assay.Kind)))
            Assume("Fluorescent slides are scanned on the Akoya system (HP001009) instead of the Aperio.");
        if (draft.Importance == IhcImportance.Stat) Assume("STAT: the CY2027 list has no STAT surcharge code, so none is estimated.");

        var lines = units
            .Select(kv => new PlannedCharge(kv.Key.Section, kv.Key.Code, kv.Value))
            .OrderBy(l => Array.IndexOf(SectionOrder, l.SectionCode))
            .ThenBy(l => l.ChargeCode, StringComparer.Ordinal)
            .ToList();
        return new IhcEstimate(lines, assumptions, draft.Samples.Count);
    }

    /// <summary>Work areas the request passes through, from the sample types and whether scanning was asked for.</summary>
    public static IReadOnlyList<string> WorkAreas(IhcDraft draft)
    {
        var types = draft.Samples.Select(s => s.Type).ToHashSet();
        var areas = new List<string>();
        if (types.Contains(SampleType.Fixed)) areas.Add("TRIMM");
        if (types.Contains(SampleType.Fixed) || types.Contains(SampleType.Frozen)) areas.Add("EMBED");
        if (types.Contains(SampleType.Fixed) || types.Contains(SampleType.Frozen) || types.Contains(SampleType.Block)) areas.Add("MICRO");
        areas.Add("STAIN");
        if (draft.Scan20x || draft.Scan40x) areas.Add("IMAGE");
        return areas;
    }

    /// <summary>What the IHC team would want to know before accepting: long fixation, assays outside their validation, new antibodies.</summary>
    public static IReadOnlyList<string> Warnings(IhcDraft draft, Func<int, AssayView?> assayById, DateOnly today)
    {
        var output = new List<string>();
        var types = draft.Samples.Select(s => s.Type).ToList();
        if (draft.DateIntoFixative is DateOnly intoFixative && types.Contains(SampleType.Fixed))
        {
            var days = today.DayNumber - intoFixative.DayNumber;
            if (days > 7) output.Add($"Tissue has been in fixative for {days} days. Long formalin fixation can weaken IHC staining; moving the tissue to 70% ethanol, or processing it soon, helps.");
        }
        foreach (var s in draft.Stains)
        {
            var a = s.AssayId is int id ? assayById(id) : null;
            if (a is not null)
            {
                if (a.Status != AssayStatus.Active) output.Add($"{a.Name} (#{a.Id}) is {a.Status.ToString().ToLowerInvariant()} in the catalog.");
                foreach (var note in AssayFit(a, draft.Species, draft.FixativeUsed, types)) output.Add($"{a.Name} (#{a.Id}) is {note}.");
            }
            else if (s.NewAntibody is not null)
                output.Add($"{s.NewAntibody.Name} is not in the catalog, so the IHC team will optimize it first. The antibody's datasheet helps.");
        }
        return output;
    }

    /// <summary>One line describing the request, used as the LIMS request's description.</summary>
    public static string Summarize(IhcDraft draft, Func<int, AssayView?> assayById)
    {
        var names = draft.Stains.Select(s => (s.AssayId is int id ? assayById(id)?.Name : s.NewAntibody?.Name) is { Length: > 0 } n ? n : "?").ToList();
        var parts = new List<string>();
        if (names.Count > 0) parts.Add(string.Join(", ", names));
        if (draft.HePerBlock > 0) parts.Add($"H&E x{draft.HePerBlock}");
        if (draft.UnstainedPerBlock > 0) parts.Add($"unstained x{draft.UnstainedPerBlock}");
        var scan = string.Join(" and ", new[] { draft.Scan20x ? "20x" : null, draft.Scan40x ? "40x" : null }.Where(x => x is not null));
        var tissues = string.Join(", ", draft.Samples.Select(s => s.Tissue).Where(t => !string.IsNullOrEmpty(t)).Distinct());
        return $"IHC request: {string.Join("; ", parts)} on {draft.Samples.Count} block(s){(tissues.Length > 0 ? $" ({tissues})" : "")}{(scan.Length > 0 ? $"; scan at {scan}" : "")}.";
    }

    /// <summary>The subject type for the PHL numbers an accepted request issues.</summary>
    public static string SubjectTypeFor(string speciesChoice) =>
        RequestSpecies.FirstOrDefault(s => s.Choice == speciesChoice).SubjectTypeCode
        ?? throw new DomainException($"Unknown species choice {speciesChoice}.");
}
