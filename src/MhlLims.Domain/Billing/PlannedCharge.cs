namespace MhlLims.Domain.Billing;

/// <summary>
/// A charge a rule says should be made (an estimate line, or the charges a necropsy approval or pathology sign-out
/// creates) before it is priced. ChargeCalculator.Create prices it from the catalog and turns it into a ChargeLine.
/// </summary>
public sealed record PlannedCharge(string SectionCode, string ChargeCode, decimal Units, string? Description = null);
