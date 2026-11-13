using MhlLims.Domain.Pathology;

namespace MhlLims.Domain.Tests.Golden;

/// <summary>The C# necropsy and pathology rules give the same answers as the pilot's JavaScript.</summary>
public class PathologyGoldenTests
{
    private static GoldenFile G => GoldenData.Cases;

    public static IEnumerable<object[]> NecropsyCases => GoldenData.Rows(g => g.Necropsy, c => c.Name);
    public static IEnumerable<object[]> CaseCases => GoldenData.Rows(g => g.PathologyCases, c => c.Name);
    public static IEnumerable<object[]> SummaryCases => GoldenData.Rows(g => g.PathologySummaries, c => c.Name);

    [Theory, MemberData(nameof(NecropsyCases))]
    public void Necropsy_approval_checks_and_charges_match(string name, int i)
    {
        var c = G.Necropsy[i];
        var n = GoldenData.Necropsy(c.Necropsy);
        Assert.Equal(c.Problems, NecropsyRules.ApprovalProblems(n, c.ProtocolWeighsAnimal));
        Assert.Equal(c.Charges.Select(x => $"{x.Section} {x.Code} x{x.Units:0.##}"), NecropsyRules.ApprovalCharges(n).Select(x => $"{x.SectionCode} {x.ChargeCode} x{x.Units:0.##}"));
        _ = name;
    }

    [Fact]
    public void Diagnoses_read_the_same()
    {
        foreach (var c in G.DxText)
        {
            var dx = GoldenData.Diagnosis(c.Dx, 1, 1);
            Assert.Equal(c.Text, PathologyRules.DiagnosisText(dx));
            Assert.Equal(c.Mark, PathologyRules.Mark(dx));
        }
    }

    [Fact]
    public void Diagnosis_terms_are_offered_in_the_same_order()
    {
        foreach (var c in G.DiagnosesFor)
            Assert.Equal(c.Terms, DiagnosisDictionary.Starter.For(c.Organ).Select(e => e.Term));
    }

    [Theory, MemberData(nameof(CaseCases))]
    public void Slides_and_sign_out_checks_match(string name, int i)
    {
        var c = G.PathologyCases[i];
        var pc = GoldenData.Case(c.Case);
        Assert.Equal(c.Slides, PathologyRules.SlidesRead(pc));
        var gross = c.GrossFindings.Select(g => new GrossFindingRef(g.Id, g.Organ)).ToList();
        Assert.Equal(c.Problems, PathologyRules.SignOutProblems(pc, gross, c.NeedCauseOfDeath));
        _ = name;
    }

    [Fact]
    public void Sign_out_charges_match_including_amendments()
    {
        foreach (var c in G.SignOutCharges)
        {
            var planned = PathologyRules.SignOutCharges(c.Slides, c.ExtraQuarterHours, c.ExtraTimeNote, c.BilledSlides, c.BilledQuarterHours, c.Version);
            Assert.Equal(c.Charges.Select(x => $"{x.Section} {x.Code} x{x.Units:0.##} {x.Note}"), planned.Select(x => $"{x.SectionCode} {x.ChargeCode} x{x.Units:0.##} {x.Description}"));
        }
    }

    [Theory, MemberData(nameof(SummaryCases))]
    public void Study_summaries_match(string name, int i)
    {
        var c = G.PathologySummaries[i];
        var cases = c.Cases.Select(x => new SummaryCase(x.SubjectId, x.Phl, x.Label, x.GroupKey, x.Sex, GoldenData.Case(x.Case))).ToList();
        var s = PathologySummarizer.Summarize(cases, c.GroupKeys);

        Assert.Equal(
            c.Incidence.Select(r => $"{r.Organ}|{r.Term}|{r.Neoplasm}|" + string.Join(";", c.GroupKeys.Select(g => $"{r.ByGroup[g].Affected}/{r.ByGroup[g].Examined}/{r.ByGroup[g].MeanGrade}"))),
            s.Incidence.Select(r => $"{r.Organ}|{r.Term}|{r.IsNeoplasm}|" + string.Join(";", c.GroupKeys.Select(g => $"{r.ByGroup[g].Affected}/{r.ByGroup[g].Examined}/{r.ByGroup[g].MeanGrade}"))));
        foreach (var g in c.GroupKeys)
        {
            var e = c.Neoplasms[g]; var a = s.Neoplasms[g];
            Assert.Equal((e.Animals, e.Any, e.Benign, e.Malignant, e.Metastatic, e.PrimaryBenign, e.PrimaryMalignant),
                (a.Animals, a.Any, a.Benign, a.Malignant, a.Metastatic, a.PrimaryBenign, a.PrimaryMalignant));
        }
        Assert.Equal(
            c.Tabulated.Select(r => $"{r.Organ}: " + string.Join(" ", r.Status.OrderBy(kv => kv.Key).Select(kv => $"{kv.Key}={kv.Value}")) + " | "
                + string.Join(" ; ", r.Diagnoses.Select(d => d.Term + " " + string.Join(" ", d.Cells.OrderBy(kv => kv.Key).Select(kv => $"{kv.Key}={kv.Value}"))))),
            s.Tabulated.Select(r => $"{r.Organ}: " + string.Join(" ", r.Status.Select(kv => (Key: kv.Key.ToString(System.Globalization.CultureInfo.InvariantCulture), kv.Value)).OrderBy(kv => kv.Key).Select(kv => $"{kv.Key}={kv.Value}")) + " | "
                + string.Join(" ; ", r.Diagnoses.Select(d => d.Term + " " + string.Join(" ", d.Cells.Select(kv => (Key: kv.Key.ToString(System.Globalization.CultureInfo.InvariantCulture), kv.Value)).OrderBy(kv => kv.Key).Select(kv => $"{kv.Key}={kv.Value}"))))));
        Assert.Equal(c.NotRead, s.NotRead);
        _ = name;
    }
}
