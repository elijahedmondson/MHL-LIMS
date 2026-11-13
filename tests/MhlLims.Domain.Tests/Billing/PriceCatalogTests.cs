using MhlLims.Domain.Billing;
using MhlLims.Domain.Common;

namespace MhlLims.Domain.Tests.Billing;

public class PriceCatalogTests
{
    [Fact]
    public void Cy2027_list_has_the_55_codes_from_the_worksheet()
    {
        var (codes, list) = TestCatalog.LoadCy2027();
        Assert.Equal(55, codes.Count);
        Assert.Equal(55, list.Items.Count);
    }

    [Fact]
    public void Cy2027_flags_the_three_unpriced_codes()
    {
        var (_, list) = TestCatalog.LoadCy2027();
        Assert.Equal(new[] { "HP002017", "HP002018", "HP003007" }, list.UnpricedCodes());
    }

    [Theory]
    [InlineData("HP002001", 41.06)]   // Necropsy
    [InlineData("HP006017", 179.25)]  // RNAscope
    [InlineData("HP006014", 262.94)]  // IHC6-Opal
    [InlineData("HP001009", 34.59)]   // Akoya HT FL scan
    [InlineData("PA001004", 51.10)]   // Pathology labor
    public void Quote_returns_the_worksheet_price(string code, double expected)
    {
        var quote = TestCatalog.Cy2027().Quote(code, new DateOnly(2027, 6, 1));
        Assert.Equal((decimal)expected, quote.UnitPrice);
        Assert.Equal("CY2027", quote.PriceListName);
    }

    [Fact]
    public void Quote_refuses_an_unpriced_code()
    {
        var ex = Assert.Throws<DomainException>(() => TestCatalog.Cy2027().Quote("HP002018", new DateOnly(2027, 6, 1)));
        Assert.Contains("no price", ex.Message);
    }

    [Fact]
    public void Quote_refuses_an_unknown_code()
    {
        Assert.Throws<DomainException>(() => TestCatalog.Cy2027().Quote("HP999999", new DateOnly(2027, 6, 1)));
    }

    [Fact]
    public void Quote_refuses_a_date_with_no_approved_list()
    {
        var ex = Assert.Throws<DomainException>(() => TestCatalog.Cy2027().Quote("HP002001", new DateOnly(2026, 12, 31)));
        Assert.Contains("No approved price list", ex.Message);
    }

    [Fact]
    public void Draft_lists_are_not_used_for_pricing()
    {
        var (codes, draft) = TestCatalog.LoadCy2027(PriceListStatus.Draft);
        var catalog = new PriceCatalog(codes, [draft]);
        Assert.Throws<DomainException>(() => catalog.Quote("HP002001", new DateOnly(2027, 6, 1)));
    }

    [Fact]
    public void Quote_uses_the_list_in_effect_on_the_charge_date()
    {
        var (codes, cy2027) = TestCatalog.LoadCy2027();
        cy2027.EffectiveTo = new DateOnly(2028, 1, 1);
        var cy2028 = new PriceList { Id = 28, Name = "CY2028", EffectiveFrom = new DateOnly(2028, 1, 1), Status = PriceListStatus.Approved };
        cy2028.Items.Add(new PriceListItem { PriceListId = 28, ChargeCode = "HP002001", UnitPrice = 43.00m });
        var catalog = new PriceCatalog(codes, [cy2027, cy2028]);

        Assert.Equal(41.06m, catalog.Quote("HP002001", new DateOnly(2027, 12, 31)).UnitPrice);
        Assert.Equal(43.00m, catalog.Quote("HP002001", new DateOnly(2028, 1, 1)).UnitPrice);
    }

    [Fact]
    public void Overlapping_approved_lists_are_rejected()
    {
        var (codes, cy2027) = TestCatalog.LoadCy2027();
        var other = new PriceList { Id = 99, Name = "Overlap", EffectiveFrom = new DateOnly(2027, 7, 1), Status = PriceListStatus.Approved };
        Assert.Throws<DomainException>(() => new PriceCatalog(codes, [cy2027, other]));
    }

    [Fact]
    public void Approved_list_prices_are_frozen()
    {
        var (_, list) = TestCatalog.LoadCy2027();
        Assert.Throws<DomainException>(() => list.SetPrice("HP002001", 50m));
    }

    [Fact]
    public void Draft_list_can_be_priced_and_approved()
    {
        var (_, draft) = TestCatalog.LoadCy2027(PriceListStatus.Draft);
        draft.SetPrice("HP002018", 6.25m);
        draft.Approve(approvedByUserId: 7, TestCatalog.Now, otherLists: []);
        Assert.Equal(PriceListStatus.Approved, draft.Status);
        Assert.DoesNotContain("HP002018", draft.UnpricedCodes());
    }

    [Fact]
    public void Approval_is_blocked_by_an_overlapping_approved_list()
    {
        var (_, draft) = TestCatalog.LoadCy2027(PriceListStatus.Draft, id: 1);
        var existing = new PriceList { Id = 2, Name = "CY2026", EffectiveFrom = new DateOnly(2026, 1, 1), Status = PriceListStatus.Approved };
        var ex = Assert.Throws<DomainException>(() => draft.Approve(7, TestCatalog.Now, [existing]));
        Assert.Contains("CY2026", ex.Message);
    }

    [Fact]
    public void Labor_code_belongs_to_six_sections()
    {
        var code = TestCatalog.Cy2027().GetChargeCode("HP009002");
        Assert.Equal(6, code.Sections.Count);
        Assert.True(code.RequiresDescription);
    }
}
