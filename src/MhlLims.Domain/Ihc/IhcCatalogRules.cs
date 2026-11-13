using System.Globalization;
using System.Text.RegularExpressions;

namespace MhlLims.Domain.Ihc;

public sealed record RecoveredValue(string Value, bool Recovered, string? Stored = null);

public sealed record SpeciesReading(IReadOnlyList<string> Tags, IReadOnlyList<string> Other);

public sealed record AssayClassification(AssayKind Kind, int Plex, string Chromogen, string Platform);

public sealed record AssayDerivation(AssayClassification Classification, IReadOnlyList<string> SpeciesTags, IReadOnlyList<string> SpeciesOther, IReadOnlyList<string> FixativeTags);

/// <summary>
/// Reading the IHC department's assay database: repairing what Excel did to the export, reading the free-text
/// species and fixative as standard terms, and working out what kind of assay a protocol is.
/// A port of pilot/core/ihc.mjs; tests/MhlLims.Domain.Tests/Golden checks both give the same answers.
/// </summary>
/// <remarks>
/// The patterns use RegexOptions.ECMAScript so that \b, \w, \d and \s behave as in the JavaScript original
/// (ASCII only), which keeps results identical for names such as "ERα" or "CD79α".
/// </remarks>
public static class IhcCatalogRules
{
    // CultureInvariant keeps case-insensitive matching the same on every machine (e.g. the Turkish dotless i).
    private static Regex Js(string pattern, bool ignoreCase = false) =>
        new(pattern, ignoreCase ? RegexOptions.ECMAScript | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant : RegexOptions.ECMAScript | RegexOptions.CultureInvariant);

    public static readonly IReadOnlyList<string> SpeciesTagOrder =
        ["Mouse", "Human", "Human xenograft", "Humanized mouse", "Rat", "Canine", "Rhesus macaque", "Marmoset", "Porcine", "Woodchuck", "Zebrafish"];

    public static readonly IReadOnlyList<string> FixativeTagOrder =
        ["NBF", "PFA", "Frozen", "Zinc formalin", "Ethanol", "Methanol", "Bouin's", "Carnoy's", "Methacarn", "Telly's", "Davidson's"];

    // ---------- repairing the export ----------

    private static readonly Regex NumberOnly = Js(@"^\d+(\.\d+)?$");

    /// <summary>
    /// Excel reads a dilution such as "1:100" as a time of day (1 hour + 100 minutes) and stores 0.111111111.
    /// A dilution 1:N was stored as (1 + N/60) / 24, so N = (value x 24 - 1) x 60.
    /// </summary>
    public static RecoveredValue DecodeExcelDilution(string? raw)
    {
        var v = (raw ?? string.Empty).Trim();
        if (!NumberOnly.IsMatch(v)) return new RecoveredValue(v, false);
        var n = (double.Parse(v, CultureInfo.InvariantCulture) * 24 - 1) * 60;
        var rounded = Math.Round(n, MidpointRounding.AwayFromZero);
        return rounded > 0 && Math.Abs(n - rounded) < 0.01
            ? new RecoveredValue("1:" + rounded.ToString("0", CultureInfo.InvariantCulture), true, v)
            : new RecoveredValue(v, false);
    }

    private static readonly Regex DayMonth = Js(@"^(\d{1,2})-([A-Z][a-z]{2})$");
    private static readonly string[] Months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    /// <summary>Excel turns names such as "Oct-4" into dates and writes them back as "4-Oct".</summary>
    public static RecoveredValue FixExcelDateName(string? raw)
    {
        var v = (raw ?? string.Empty).Trim();
        var m = DayMonth.Match(v);
        return m.Success && Months.Contains(m.Groups[2].Value)
            ? new RecoveredValue($"{m.Groups[2].Value}-{m.Groups[1].Value}", true, v)
            : new RecoveredValue(v, false);
    }

    // ---------- species and fixative ----------

    private static readonly Regex SpeciesSplit = Js("[,;/]");
    private static readonly Regex Xenograft = Js(@"\b(xg|xenografts?|pdx)\b|human in mouse|hu in mouse|hu cell line in mouse|human in mice|in mice\b");
    private static readonly Regex RabbitOrPig = Js("rabbit|pig");
    private static readonly Regex Humanized = Js("humanized");
    private static readonly Regex HumanWord = Js(@"\b(human|hu)\b");
    private static readonly Regex InWord = Js(@"\bin\b");
    private static readonly Regex MouseWord = Js(@"\b(mouse|mice|ms)\b");
    private static readonly Regex RatWord = Js(@"\brats?\b");
    private static readonly Regex Canine = Js(@"canine|\bdog\b");
    private static readonly Regex Rhesus = Js("rhesus|macaque");
    private static readonly Regex Porcine = Js(@"porcine|\bpig\b");

    /// <summary>"Human, Hu Xg in Mice" reads as Human and Human xenograft. Unrecognized parts are returned in Other.</summary>
    public static SpeciesReading SpeciesTags(string? raw)
    {
        var tags = new HashSet<string>();
        var other = new List<string>();
        foreach (var part in SpeciesSplit.Split(raw ?? string.Empty).Select(p => p.Trim().ToLowerInvariant()).Where(p => p.Length > 0))
        {
            if (Xenograft.IsMatch(part) && !RabbitOrPig.IsMatch(part)) tags.Add("Human xenograft");
            else if (Humanized.IsMatch(part)) tags.Add("Humanized mouse");
            else if (HumanWord.IsMatch(part) && !InWord.IsMatch(part)) tags.Add("Human");
            else if (MouseWord.IsMatch(part)) tags.Add("Mouse");
            else if (RatWord.IsMatch(part)) tags.Add("Rat");
            else if (Canine.IsMatch(part)) tags.Add("Canine");
            else if (Rhesus.IsMatch(part)) tags.Add("Rhesus macaque");
            else if (part.Contains("marmoset", StringComparison.Ordinal)) tags.Add("Marmoset");
            else if (Porcine.IsMatch(part) && !InWord.IsMatch(part)) tags.Add("Porcine");
            else if (part.Contains("woodchuck", StringComparison.Ordinal)) tags.Add("Woodchuck");
            else if (part.Contains("zebrafish", StringComparison.Ordinal)) tags.Add("Zebrafish");
            else other.Add(part);
        }
        return new SpeciesReading(SpeciesTagOrder.Where(tags.Contains).ToList(), other);
    }

    private static readonly Regex StartsFreshOrFrozen = Js(@"^\s*(fresh|frozen)");
    private static readonly Regex FrozenWords = Js(@"fresh|frozen|\boct\b|acetone");
    private static readonly Regex Formalin = Js("nbf|formalin");
    private static readonly Regex Pfa = Js("pfa|paraformaldehyde");
    private static readonly Regex Ethanol = Js("etoh|(^|[^m])ethanol");

    /// <summary>
    /// "FRESH/ FROZEN/ ACETONE" reads as Frozen (acetone fixes the cut sections, not the tissue);
    /// "4% PFA to Sucrose to OCT" reads as PFA and Frozen.
    /// </summary>
    public static IReadOnlyList<string> FixativeTags(string? raw)
    {
        var s = (raw ?? string.Empty).ToLowerInvariant();
        var tags = new HashSet<string>();
        if (FrozenWords.IsMatch(s)) tags.Add("Frozen");
        if (!StartsFreshOrFrozen.IsMatch(s))
        {
            if (s.Contains("zinc", StringComparison.Ordinal)) tags.Add("Zinc formalin");
            else if (Formalin.IsMatch(s)) tags.Add("NBF");
            if (Pfa.IsMatch(s) && !s.StartsWith("oct", StringComparison.Ordinal)) tags.Add("PFA");
            if (Ethanol.IsMatch(s)) tags.Add("Ethanol");
            if (s.Contains("methanol", StringComparison.Ordinal)) tags.Add("Methanol");
            if (s.Contains("methacarn", StringComparison.Ordinal)) tags.Add("Methacarn");
            if (s.Contains("bouin", StringComparison.Ordinal)) tags.Add("Bouin's");
            if (s.Contains("carnoy", StringComparison.Ordinal)) tags.Add("Carnoy's");
            if (s.Contains("telly", StringComparison.Ordinal)) tags.Add("Telly's");
            if (s.Contains("davidson", StringComparison.Ordinal)) tags.Add("Davidson's");
        }
        return FixativeTagOrder.Where(tags.Contains).ToList();
    }

    // ---------- kind of assay ----------

    private static readonly Regex Fluorescent = Js(@"alexa|fitc|\bcy[235]\b|texas red|dylight|\bpe\b|rhodamine|tritc|red 549|\bsa-af\d", ignoreCase: true);
    private static readonly Regex OpalWord = Js("opal", ignoreCase: true);
    private static readonly Regex OpalFluorophore = Js(@"\b(480|520|540|570|620|650|690|780)\b");
    private static readonly Regex Duplex = Js(@"^duplex\b", ignoreCase: true);
    private static readonly Regex Triplex = Js(@"^triplex\b", ignoreCase: true);
    private static readonly Regex NPlex = Js(@"^(\d)-plex", ignoreCase: true);
    private static readonly Regex Bond = Js("bond", ignoreCase: true);
    private static readonly Regex Ventana = Js("ventana|ultraview|optiview", ignoreCase: true);
    private static readonly Regex Tunel = Js("tunel|apoptag", ignoreCase: true);
    private static readonly Regex BetaGal = Js("β-gal|b-gal|x-gal|beta-gal", ignoreCase: true);
    private static readonly Regex AnyRed = Js("red", ignoreCase: true);
    private static readonly Regex RedChromogen = Js("refine red|fast red|permanent red|vector red", ignoreCase: true);

    /// <summary>What kind of assay a protocol is, how many markers it has, and how it is detected.</summary>
    public static AssayClassification Classify(string? name, string? kit)
    {
        var n = name ?? string.Empty;
        var k = kit ?? string.Empty;
        // Opal fluorophores are written "OPAL 520", "OPAL520" or "OPALs 690, 520, 570"; count the distinct ones.
        var opal = OpalWord.IsMatch(k) ? Math.Max(1, OpalFluorophore.Matches(k).Select(m => m.Value).Distinct().Count()) : 0;
        var nPlex = NPlex.Match(n);
        var namePlex = Duplex.IsMatch(n) ? 2 : Triplex.IsMatch(n) ? 3 : nPlex.Success ? int.Parse(nPlex.Groups[1].Value, CultureInfo.InvariantCulture) : 0;
        // A 4- to 6-plex panel is always fluorescent here, even when the kit column does not say so.
        if (namePlex >= 4 && opal == 0)
            return new AssayClassification(AssayKind.Opal, namePlex, "Opal", Bond.IsMatch(k) ? "Leica Bond" : "Manual");
        var platform = Bond.IsMatch(k) ? "Leica Bond" : Ventana.IsMatch(k) ? "Ventana" : "Manual";
        if (Tunel.IsMatch(n)) return new AssayClassification(AssayKind.Tunel, 1, "DAB", platform);
        if (BetaGal.IsMatch(n)) return new AssayClassification(AssayKind.BetaGal, 1, "X-gal", platform);
        var fluorescent = Fluorescent.IsMatch(k) || Fluorescent.IsMatch(n);
        if (namePlex >= 2 || opal >= 2)
        {
            var plex = Math.Max(namePlex, opal);
            if (opal >= 1) return new AssayClassification(AssayKind.Opal, plex, "Opal", platform);
            if (fluorescent) return new AssayClassification(AssayKind.If, plex, "Fluorescent", platform);
            return new AssayClassification(AssayKind.Ihc, plex, AnyRed.IsMatch(k) ? "DAB + Red" : "DAB", platform);
        }
        if (opal == 1) return new AssayClassification(AssayKind.Opal, 1, "Opal", platform);
        if (fluorescent) return new AssayClassification(AssayKind.If, 1, "Fluorescent", platform);
        return new AssayClassification(AssayKind.Ihc, 1, RedChromogen.IsMatch(k) ? "Red" : "DAB", platform);
    }

    public static string KindLabel(AssayKind kind, int plex) => kind switch
    {
        AssayKind.Opal => plex > 1 ? $"Opal {plex}-plex" : "Opal (1 marker)",
        AssayKind.If => plex > 1 ? $"IF {plex}-plex" : "Immunofluorescence",
        AssayKind.Ihc => plex > 1 ? $"IHC {plex}-plex" : "IHC",
        AssayKind.Tunel => "TUNEL",
        AssayKind.BetaGal => "β-gal",
        _ => kind.ToString(),
    };

    public static bool IsFluorescent(AssayKind kind) => kind is AssayKind.Opal or AssayKind.If;

    public static AssayDerivation Derive(string? name, string? kit, string? species, string? fixative)
    {
        var sp = SpeciesTags(species);
        return new AssayDerivation(Classify(name, kit), sp.Tags, sp.Other, FixativeTags(fixative));
    }

    /// <summary>
    /// Recomputes the derived fields of a single protocol after it is added or edited. Double stains keep their
    /// kind (worked out from their two components) and only have their tags refreshed.
    /// </summary>
    public static void ApplyDerived(Assay assay)
    {
        var d = Derive(assay.Name, assay.DetectionKit, assay.Species, assay.Fixative);
        if (!assay.IsDoubleStain)
        {
            assay.Kind = d.Classification.Kind;
            assay.Plex = d.Classification.Plex;
            assay.Chromogen = d.Classification.Chromogen;
            assay.Platform = d.Classification.Platform;
        }
        assay.SpeciesTags = d.SpeciesTags.Select(t => new AssaySpeciesTag { AssayId = assay.Id, Tag = t }).ToList();
        assay.FixativeTags = d.FixativeTags.Select(t => new AssayFixativeTag { AssayId = assay.Id, Tag = t }).ToList();
    }
}
