using MhlLims.Domain.Common;

namespace MhlLims.Domain.Billing;

/// <summary>
/// Planned units for a request: the "PLANNED" column of the billing worksheet.
/// The total becomes the initial cost estimate that is compared with the NAS authorization.
/// </summary>
public class EstimateLine
{
    public int Id { get; set; }
    public int RequestId { get; set; }
    public string SectionCode { get; set; } = string.Empty;
    public string ChargeCode { get; set; } = string.Empty;
    public int PriceListId { get; set; }
    public decimal PlannedUnits { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal Amount { get; private set; }   // persisted computed column in SQL
    public string? Description { get; set; }
    public string CreatedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }

    internal void RecalculateAmount() => Amount = Money.Amount(PlannedUnits, UnitPrice);
}

public sealed record SectionTotal(string SectionCode, decimal Amount);

public sealed record EstimateSummary(
    IReadOnlyList<SectionTotal> Sections,
    decimal EstimatedTotal,
    decimal? AuthorizedAmount,
    decimal ChargedToDate,
    decimal? RemainingAuthorization,
    bool EstimateExceedsAuthorization,
    bool ChargesExceedAuthorization);

public static class EstimateCalculator
{
    public static EstimateLine CreateLine(
        int requestId, string sectionCode, string chargeCode, decimal plannedUnits, DateOnly priceDate,
        PriceCatalog catalog, string createdBy, DateTime utcNow, string? description = null)
    {
        ChargeCalculator.ValidateUnits(plannedUnits);
        var quote = catalog.Quote(chargeCode, priceDate);
        if (!quote.ChargeCode.IsInSection(sectionCode))
            throw new DomainException($"Charge code {quote.ChargeCode.Code} is not part of the {sectionCode} section of the price list.");
        var line = new EstimateLine
        {
            RequestId = requestId,
            SectionCode = sectionCode.ToUpperInvariant(),
            ChargeCode = quote.ChargeCode.Code,
            PriceListId = quote.PriceListId,
            PlannedUnits = plannedUnits,
            UnitPrice = quote.UnitPrice,
            Description = description,
            CreatedBy = createdBy,
            CreatedAt = utcNow,
        };
        line.RecalculateAmount();
        return line;
    }

    /// <summary>
    /// Totals the estimate by section and compares the estimate and the charges to date
    /// with the NAS authorized amount (when there is one). Void charges are ignored.
    /// </summary>
    public static EstimateSummary Summarize(IEnumerable<EstimateLine> lines, decimal? authorizedAmount, IEnumerable<ChargeLine> charges)
    {
        var sections = lines
            .GroupBy(l => l.SectionCode, StringComparer.OrdinalIgnoreCase)
            .Select(g => new SectionTotal(g.Key, g.Sum(l => Money.Amount(l.PlannedUnits, l.UnitPrice))))
            .ToList();
        var total = sections.Sum(s => s.Amount);
        var charged = charges.Where(c => c.Status != ChargeLineStatus.Void).Sum(c => Money.Amount(c.Units, c.UnitPrice));
        decimal? remaining = authorizedAmount is null ? null : authorizedAmount.Value - charged;
        return new EstimateSummary(
            sections,
            total,
            authorizedAmount,
            charged,
            remaining,
            authorizedAmount is not null && total > authorizedAmount.Value,
            authorizedAmount is not null && charged > authorizedAmount.Value);
    }
}
