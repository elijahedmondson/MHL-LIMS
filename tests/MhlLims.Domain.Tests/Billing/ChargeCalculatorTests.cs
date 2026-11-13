using MhlLims.Domain.Billing;
using MhlLims.Domain.Common;
using MhlLims.Domain.Core;

namespace MhlLims.Domain.Tests.Billing;

public class ChargeCalculatorTests
{
    private static readonly DateOnly Day = new(2027, 3, 15);
    private readonly PriceCatalog _catalog = TestCatalog.Cy2027();

    private ChargeLine Charge(string section, string code, decimal units, string? description = null, RequestBillingContext? ctx = null) =>
        ChargeCalculator.Create(new NewCharge(section, code, Day, units, description), ctx ?? TestCatalog.Billable(), _catalog, 5, TestCatalog.Now);

    [Fact]
    public void Necropsy_charge_is_priced_from_the_list()
    {
        var line = Charge("NECRO", "HP002001", 12);
        Assert.Equal(41.06m, line.UnitPrice);
        Assert.Equal(492.72m, line.Amount);
        Assert.Equal(ChargeLineStatus.Pending, line.Status);
        Assert.Equal(27, line.PriceListId);
    }

    [Fact]
    public void Amount_rounds_half_away_from_zero_like_sql_server()
    {
        // 0.5 x 24.95 = 12.475 -> 12.48
        var line = Charge("STAIN", "HP009002", 0.5m, "Antigen retrieval optimization");
        Assert.Equal(12.48m, line.Amount);
    }

    [Fact]
    public void Define_items_need_a_description()
    {
        var ex = Assert.Throws<DomainException>(() => Charge("NECRO", "HP009002", 2));
        Assert.Contains("description", ex.Message);
        var ok = Charge("NECRO", "HP009002", 2, "Perfusion setup, 30 min");
        Assert.Equal(49.90m, ok.Amount);
    }

    [Fact]
    public void Code_must_belong_to_the_section()
    {
        var ex = Assert.Throws<DomainException>(() => Charge("NECRO", "HP005003", 10));   // H&E is a STAIN code
        Assert.Contains("STAIN", Charge("STAIN", "HP005003", 10).SectionCode);
        Assert.Contains("NECRO", ex.Message);
    }

    [Fact]
    public void Shared_codes_work_in_each_of_their_sections()
    {
        Assert.Equal(12.08m, Charge("NECRO", "HP003005", 1).Amount);       // OCT block in NECRO
        Assert.Equal(12.08m, Charge("TRIM_EMBED", "HP003005", 1).Amount);  // and in TRIM/EMBED
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(1.005)]
    public void Units_must_be_positive_with_two_decimals_at_most(double units)
    {
        Assert.Throws<DomainException>(() => Charge("STAIN", "HP005003", (decimal)units));
    }

    [Fact]
    public void No_charge_and_cancelled_requests_refuse_charges()
    {
        Assert.Throws<DomainException>(() => Charge("NECRO", "HP002001", 1, ctx: new RequestBillingContext(1, RequestChargeType.NoCharge, true, true)));
        Assert.Throws<DomainException>(() => Charge("NECRO", "HP002001", 1, ctx: new RequestBillingContext(1, RequestChargeType.Cancelled, true, true)));
    }

    [Fact]
    public void Inactive_or_closed_projects_refuse_charges()
    {
        Assert.Throws<DomainException>(() => Charge("NECRO", "HP002001", 1, ctx: new RequestBillingContext(1, RequestChargeType.Charge, false, true)));
        Assert.Throws<DomainException>(() => Charge("NECRO", "HP002001", 1, ctx: new RequestBillingContext(1, RequestChargeType.Charge, true, false)));
    }

    [Fact]
    public void Pending_line_can_be_corrected_and_approved_then_not_edited()
    {
        var line = Charge("STAIN", "HP006004", 10);
        line.Correct(12, null, _catalog.GetChargeCode("HP006004"));
        Assert.Equal(669.48m, line.Amount);   // 12 x 55.79
        line.Approve();
        Assert.Throws<DomainException>(() => line.Correct(13, null, _catalog.GetChargeCode("HP006004")));
    }

    [Fact]
    public void Released_lines_cannot_be_voided_but_can_be_adjusted()
    {
        var line = Charge("IMAGE", "HP001006", 20);
        line.Id = 101;
        line.Approve();
        var batch = BillingBatch.Open("HP", new DateOnly(2027, 3, 1), new DateOnly(2027, 3, 31), 9, TestCatalog.Now);
        batch.Id = 1;
        batch.Release([line], 9, TestCatalog.Now, Rpt080Extract.FormatName, "hp\\HP270331.txt");

        Assert.Throws<DomainException>(() => line.Void());
        var adjustment = line.CreateAdjustment(-2, "Two slides re-scanned at no charge", 9, new DateOnly(2027, 4, 2), TestCatalog.Now);
        Assert.Equal(ChargeSourceType.Adjustment, adjustment.SourceType);
        Assert.Equal(101, adjustment.AdjustsChargeLineId);
        Assert.Equal(-24.90m, adjustment.Amount);
        Assert.Equal(line.UnitPrice, adjustment.UnitPrice);
    }

    [Fact]
    public void Adjustment_cannot_reverse_more_than_the_original()
    {
        var line = Charge("IMAGE", "HP001006", 2);
        line.Approve();
        line.Status = ChargeLineStatus.Released;
        Assert.Throws<DomainException>(() => line.CreateAdjustment(-3, "too much", 9, Day, TestCatalog.Now));
    }
}
