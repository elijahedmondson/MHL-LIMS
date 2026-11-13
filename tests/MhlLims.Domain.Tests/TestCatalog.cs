using System.Globalization;
using System.Text.Json;
using MhlLims.Domain.Billing;
using MhlLims.Domain.Core;

namespace MhlLims.Domain.Tests;

/// <summary>Builds price catalogs for tests, including the real CY2027 list converted from the billing worksheet.</summary>
internal static class TestCatalog
{
    public static readonly DateOnly Cy2027Start = new(2027, 1, 1);
    public static readonly DateTime Now = new(2027, 3, 15, 14, 0, 0, DateTimeKind.Utc);

    private sealed record JsonItem(string Code, string Lab, string Description, string Unit, bool RequiresDescription, decimal? Price, List<string> Sections);
    private sealed record JsonPriceList(string Name, string EffectiveFrom, List<JsonItem> Items);

    public static (List<ChargeCode> Codes, PriceList List) LoadCy2027(PriceListStatus status = PriceListStatus.Approved, int id = 27)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "TestData", "price-list-CY2027.json");
        var json = JsonSerializer.Deserialize<JsonPriceList>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                   ?? throw new InvalidOperationException("Could not read price-list-CY2027.json");
        var codes = json.Items.Select(i => new ChargeCode
        {
            Code = i.Code,
            LabCode = i.Lab,
            Description = i.Description,
            UnitOfMeasure = i.Unit,
            RequiresDescription = i.RequiresDescription,
            Sections = i.Sections.Select((s, n) => new ChargeCodeSection { ChargeCode = i.Code, SectionCode = s, SortOrder = n }).ToList(),
        }).ToList();
        var list = new PriceList
        {
            Id = id,
            Name = json.Name,
            EffectiveFrom = DateOnly.ParseExact(json.EffectiveFrom, "yyyy-MM-dd", CultureInfo.InvariantCulture),
            Status = status,
            Items = json.Items.Select(i => new PriceListItem { PriceListId = id, ChargeCode = i.Code, UnitPrice = i.Price }).ToList(),
        };
        return (codes, list);
    }

    public static PriceCatalog Cy2027()
    {
        var (codes, list) = LoadCy2027();
        return new PriceCatalog(codes, [list]);
    }

    public static RequestBillingContext Billable(int requestId = 1) =>
        new(requestId, RequestChargeType.Charge, ProjectIsActive: true, ProjectAllowsCharges: true);
}
