using MhlLims.Domain.Billing;
using MhlLims.Domain.Common;

namespace MhlLims.Domain.Tests.Billing;

public class ImageAnalysisLaborRuleTests
{
    private static ImageAnalysisSettings Settings(LaborRounding rounding = LaborRounding.ProportionalRoundUp, bool enabled = true) =>
        new(enabled, "PA001004", "PATH", 4, 6, rounding);

    [Theory]
    [InlineData(6, 4)]
    [InlineData(12, 8)]
    [InlineData(7, 5)]   // 4.67 rounded up to whole quarter hours
    [InlineData(1, 1)]
    [InlineData(0, 0)]
    public void Proportional_round_up(int images, int expectedUnits) =>
        Assert.Equal(expectedUnits, ImageAnalysisLaborRule.LaborUnits(images, Settings()));

    [Theory]
    [InlineData(6, 4)]
    [InlineData(7, 8)]
    [InlineData(1, 4)]
    public void Whole_blocks_round_up(int images, int expectedUnits) =>
        Assert.Equal(expectedUnits, ImageAnalysisLaborRule.LaborUnits(images, Settings(LaborRounding.WholeBlocksRoundUp)));

    [Fact]
    public void Proportional_exact_keeps_two_decimals() =>
        Assert.Equal(4.67m, ImageAnalysisLaborRule.LaborUnits(7, Settings(LaborRounding.ProportionalExact)));

    [Fact]
    public void Each_multiplex_target_counts_as_an_image()
    {
        // 3 brightfield slides + 2 slides of a 4-plex mIF panel = 3 + 8 = 11 images
        var images = ImageAnalysisLaborRule.CountImages([new ImagedSlides(3), new ImagedSlides(2, 4)]);
        Assert.Equal(11, images);
        Assert.Equal(8m, ImageAnalysisLaborRule.LaborUnits(images, Settings()));   // 11 x 4 / 6 = 7.33 -> 8
    }

    [Fact]
    public void Disabled_rule_produces_nothing() =>
        Assert.Null(ImageAnalysisLaborRule.Evaluate(Settings(enabled: false), [new ImagedSlides(6)], new DateOnly(2027, 3, 1)));

    [Fact]
    public void Enabled_rule_produces_a_described_charge()
    {
        var charge = ImageAnalysisLaborRule.Evaluate(Settings(), [new ImagedSlides(6)], new DateOnly(2027, 3, 1));
        Assert.NotNull(charge);
        Assert.Equal("PA001004", charge.ChargeCode);
        Assert.Equal(4m, charge.Units);
        Assert.Contains("6 image", charge.Description);
    }

    [Fact]
    public void Enabled_rule_without_a_code_is_a_configuration_error() =>
        Assert.Throws<DomainException>(() => ImageAnalysisLaborRule.Evaluate(new ImageAnalysisSettings(true, null, "PATH"), [new ImagedSlides(6)], new DateOnly(2027, 3, 1)));
}

public class StatSurchargeRuleTests
{
    private static readonly DateOnly Day = new(2027, 3, 1);
    private static readonly StatSurchargeSettings Enabled = new(true, "HP009050", "NECRO");

    private static ChargeLine Line(int subjectId, string? ruleCode = null, ChargeLineStatus status = ChargeLineStatus.Pending) =>
        new() { SubjectId = subjectId, ChargeCode = "HP002001", RuleCode = ruleCode, Status = status, Units = 1, UnitPrice = 41.06m };

    private static readonly SubjectBillingInfo[] Subjects =
    [
        new(1, "27000001A", "S"),
        new(2, "27000002A", "R"),
        new(3, "27000003A", "S"),
    ];

    [Fact]
    public void Disabled_by_default_produces_nothing() =>
        Assert.Empty(StatSurchargeRule.Evaluate(Enabled with { IsEnabled = false }, Subjects, [Line(1)], Day));

    [Fact]
    public void Stat_subjects_with_work_get_one_surcharge()
    {
        var charges = StatSurchargeRule.Evaluate(Enabled, Subjects, [Line(1), Line(2)], Day);
        var single = Assert.Single(charges);
        Assert.Equal(1, single.SubjectId);
        Assert.Contains("27000001A", single.Description);
    }

    [Fact]
    public void Running_twice_adds_nothing_the_second_time() =>
        Assert.Empty(StatSurchargeRule.Evaluate(Enabled, Subjects, [Line(1), Line(1, StatSurchargeRule.RuleCode)], Day));

    [Fact]
    public void Void_work_does_not_trigger_a_surcharge() =>
        Assert.Empty(StatSurchargeRule.Evaluate(Enabled, Subjects, [Line(3, status: ChargeLineStatus.Void)], Day));
}

public class Rpt080ExtractTests
{
    [Fact]
    public void Formulas_match_the_legacy_report()
    {
        Assert.Equal("H70123", Rpt080Extract.TransId("HP", "HP270123"));
        Assert.Equal("P123", Rpt080Extract.TransId("PA", "123"));
        Assert.Equal("1234567890", Rpt080Extract.CenterNo("XX1234567890ABC"));
        Assert.Equal("ABC", Rpt080Extract.CenterNo("12ABC"));
        Assert.Equal(string.Empty, Rpt080Extract.CenterNo("12"));
        Assert.Equal(string.Empty, Rpt080Extract.CenterNo(null));
    }

    [Fact]
    public void Units_are_summed_per_request_and_code_and_zero_rows_dropped()
    {
        var lines = new[]
        {
            new BillableLine("HP270123", "HP", "25X0012345.01", "Rivera, Jordan", "27-0456", "HP005003", 10),
            new BillableLine("HP270123", "HP", "25X0012345.01", "Rivera, Jordan", "27-0456", "HP005003", 5),
            new BillableLine("HP270123", "HP", "25X0012345.01", "Rivera, Jordan", "27-0456", "HP002001", 4),
            new BillableLine("HP270124", "HP", "25X0099999.01", "Chen, Wei", null, "HP001006", 3),
            new BillableLine("HP270124", "HP", "25X0099999.01", "Chen, Wei", null, "HP001006", -3),
        };

        var records = Rpt080Extract.Build(lines, new DateOnly(2027, 3, 31));

        Assert.Equal(2, records.Count);
        Assert.Equal(new Rpt080Record("H70123", "270331", "X0012345.0", "Rivera  Jordan", 4, "HP002001", "CS-27-0456"), records[0]);
        Assert.Equal(15m, records[1].Units);
        Assert.Equal("H70123,270331,X0012345.0,Rivera  Jordan,15,HP005003,CS-27-0456\r\n", Rpt080Extract.Write([records[1]]));
    }

    [Fact]
    public void File_name_follows_the_legacy_pattern() =>
        Assert.Equal("pa\\PA271231.txt", Rpt080Extract.FileName("PA", new DateOnly(2027, 12, 31)));
}
