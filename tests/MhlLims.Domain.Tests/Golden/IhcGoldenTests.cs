using MhlLims.Domain.Ihc;

namespace MhlLims.Domain.Tests.Golden;

/// <summary>The C# IHC rules give the same answers as the pilot's JavaScript, case for case.</summary>
public class IhcGoldenTests
{
    private static GoldenFile G => GoldenData.Cases;

    public static IEnumerable<object[]> DilutionCases => GoldenData.Rows(g => g.ExcelDilution, c => c.Input);
    public static IEnumerable<object[]> DateNameCases => GoldenData.Rows(g => g.ExcelDateName, c => c.Input);
    public static IEnumerable<object[]> SpeciesCases => GoldenData.Rows(g => g.SpeciesTags, c => c.Input);
    public static IEnumerable<object[]> FixativeCases => GoldenData.Rows(g => g.FixativeTags, c => c.Input);
    public static IEnumerable<object[]> FitCases => GoldenData.Rows(g => g.AssayFit, c => $"{c.Assay.Name} {c.Species} {c.Fixative}");
    public static IEnumerable<object[]> RequestCases => GoldenData.Rows(g => g.IhcRequests, c => c.Name);

    [Theory, MemberData(nameof(DilutionCases))]
    public void Dilutions_stored_as_times_are_recovered(string name, int i)
    {
        var c = G.ExcelDilution[i];
        var r = IhcCatalogRules.DecodeExcelDilution(c.Input);
        Assert.True((c.Value, c.Recovered) == (r.Value, r.Recovered), $"{name}: expected {c.Value}/{c.Recovered}, got {r.Value}/{r.Recovered}");
    }

    [Theory, MemberData(nameof(DateNameCases))]
    public void Names_stored_as_dates_are_recovered(string name, int i)
    {
        var c = G.ExcelDateName[i];
        var r = IhcCatalogRules.FixExcelDateName(c.Input);
        Assert.True((c.Value, c.Recovered) == (r.Value, r.Recovered), $"{name}: expected {c.Value}/{c.Recovered}, got {r.Value}/{r.Recovered}");
    }

    [Theory, MemberData(nameof(SpeciesCases))]
    public void Species_text_reads_as_the_same_terms(string name, int i)
    {
        var c = G.SpeciesTags[i];
        var r = IhcCatalogRules.SpeciesTags(c.Input);
        Assert.Equal(c.Tags, r.Tags);
        Assert.Equal(c.Other, r.Other);
        _ = name;
    }

    [Theory, MemberData(nameof(FixativeCases))]
    public void Fixative_text_reads_as_the_same_terms(string name, int i)
    {
        var c = G.FixativeTags[i];
        Assert.Equal(c.Tags, IhcCatalogRules.FixativeTags(c.Input));
        _ = name;
    }

    /// <summary>All 756 protocols in the catalog are classified the same way.</summary>
    [Fact]
    public void Every_protocol_in_the_catalog_is_classified_the_same()
    {
        var mismatches = G.Classify
            .Select(c => (c, r: IhcCatalogRules.Classify(c.Name, c.Kit, c.Dilution)))
            .Where(x => x.r.Kind != GoldenData.Kind(x.c.Kind) || x.r.Plex != x.c.Plex || x.r.Chromogen != x.c.Chromogen || x.r.Platform != x.c.Platform)
            .Select(x => $"{x.c.Name}: expected {x.c.Kind} {x.c.Plex} {x.c.Chromogen} {x.c.Platform}, got {x.r.Kind} {x.r.Plex} {x.r.Chromogen} {x.r.Platform}")
            .ToList();
        Assert.True(G.Classify.Count >= 756, "the golden file should cover the whole catalog");
        Assert.True(mismatches.Count == 0, string.Join(Environment.NewLine, mismatches.Take(20)));
    }

    [Fact]
    public void Kind_labels_match()
    {
        foreach (var c in G.KindLabel) Assert.Equal(c.Label, IhcCatalogRules.KindLabel(GoldenData.Kind(c.Kind), c.Plex, c.Chromogen));
    }

    /// <summary>Platform and chromogen set by hand on an assay win over the guess from the text.</summary>
    [Fact]
    public void Platform_and_chromogen_set_by_hand_apply_the_same()
    {
        Assert.NotEmpty(G.ApplyDetection);
        foreach (var c in G.ApplyDetection)
        {
            var r = IhcCatalogRules.ApplyDetection(new AssayClassification(GoldenData.Kind(c.Kind), 1, c.Chromogen, c.Platform), c.PlatformSet, c.ChromogenSet);
            Assert.Equal((GoldenData.Kind(c.Result.Kind), c.Result.Plex, c.Result.Chromogen, c.Result.Platform), (r.Kind, r.Plex, r.Chromogen, r.Platform));
        }
    }

    [Theory, MemberData(nameof(FitCases))]
    public void Assay_fit_warnings_match(string name, int i)
    {
        var c = G.AssayFit[i];
        var notes = IhcRequestRules.AssayFit(GoldenData.Assay(c.Assay), c.Species, c.Fixative, c.SampleTypes.Select(GoldenData.Sample).ToList());
        Assert.Equal(c.Notes, notes);
        _ = name;
    }

    [Theory, MemberData(nameof(RequestCases))]
    public void Requests_are_estimated_checked_and_described_the_same(string name, int i)
    {
        var c = G.IhcRequests[i];
        var assays = c.Assays.ToDictionary(a => a.Id, GoldenData.Assay);
        AssayView? lookup(int id) => assays.GetValueOrDefault(id);
        var draft = GoldenData.Draft(c.Draft);

        var estimate = IhcRequestRules.Estimate(draft, lookup);
        Assert.Equal(c.Lines.Select(l => $"{l.Section} {l.Code} x{l.Units:0.##}"), estimate.Lines.Select(l => $"{l.SectionCode} {l.ChargeCode} x{l.Units:0.##}"));
        Assert.Equal(c.Assumptions, estimate.Assumptions);
        Assert.Equal(c.Blocks, estimate.Blocks);
        Assert.Equal(c.Areas, IhcRequestRules.WorkAreas(draft));
        Assert.Equal(c.Warnings, IhcRequestRules.Warnings(draft, lookup, DateOnly.Parse(c.Today, System.Globalization.CultureInfo.InvariantCulture)));
        Assert.Equal(c.Summary, IhcRequestRules.Summarize(draft, lookup));
        _ = name;
    }
}
