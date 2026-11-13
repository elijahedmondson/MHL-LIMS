using MhlLims.Domain.Common;
using MhlLims.Domain.Core;

namespace MhlLims.Domain.Billing;

public enum ChargeLineStatus { Pending, Approved, Released, Void }

public enum ChargeSourceType { Manual, Event, Rule, Adjustment, Migrated }

/// <summary>
/// One billable line: units of a charge code for a request (and optionally one subject),
/// priced from the list in effect on the charge date.
/// Life cycle: Pending -> Approved (billing QC) -> Released (in a billing batch).
/// Pending or approved lines can be voided; released lines are locked and corrected by adjustments.
/// </summary>
public class ChargeLine : IHasModifiedBy
{
    public int Id { get; set; }
    public int RequestId { get; set; }
    public int? SubjectId { get; set; }
    public string SectionCode { get; set; } = string.Empty;
    public string ChargeCode { get; set; } = string.Empty;
    public int PriceListId { get; set; }
    public DateOnly ChargeDate { get; set; }
    public decimal Units { get; set; }
    public decimal UnitPrice { get; set; }

    /// <summary>Units x price, rounded. A persisted computed column in SQL; mirrored here so unsaved lines have it too.</summary>
    public decimal Amount { get; private set; }

    public string? Description { get; set; }
    public ChargeSourceType SourceType { get; set; } = ChargeSourceType.Manual;
    public long? SourceEventId { get; set; }
    public string? RuleCode { get; set; }
    public ChargeLineStatus Status { get; set; } = ChargeLineStatus.Pending;
    public int? AdjustsChargeLineId { get; set; }
    public int? BillingBatchId { get; set; }
    // Set when a necropsy approval or pathology sign-out created the line. Plain columns (no navigation):
    // save the necropsy or case first so its Id exists.
    public int? NecropsyId { get; set; }
    public int? PathologyCaseId { get; set; }
    public int EnteredByUserId { get; set; }
    public DateTime EnteredAt { get; set; }
    public string ModifiedBy { get; set; } = string.Empty;
    public byte[]? RowVer { get; set; }

    internal void RecalculateAmount() => Amount = Money.Amount(Units, UnitPrice);

    /// <summary>Billing QC accepts the line.</summary>
    public void Approve()
    {
        if (Status != ChargeLineStatus.Pending) throw new DomainException($"Only pending charge lines can be approved (this one is {Status}).");
        Status = ChargeLineStatus.Approved;
    }

    /// <summary>Billing QC sends an approved line back for correction.</summary>
    public void ReturnToPending()
    {
        if (Status != ChargeLineStatus.Approved) throw new DomainException($"Only approved charge lines can be returned (this one is {Status}).");
        Status = ChargeLineStatus.Pending;
    }

    /// <summary>Corrects units or description before billing QC.</summary>
    public void Correct(decimal units, string? description, ChargeCode code)
    {
        if (Status != ChargeLineStatus.Pending) throw new DomainException("Only pending charge lines can be edited. Return the line to pending first.");
        if (SourceType == ChargeSourceType.Adjustment) throw new DomainException("Adjustment lines cannot be edited; void it and add a new adjustment.");
        ChargeCalculator.ValidateUnits(units);
        if (code.RequiresDescription && string.IsNullOrWhiteSpace(description))
            throw new DomainException($"Charge code {code.Code} needs a description of the work.");
        Units = units;
        Description = description;
        RecalculateAmount();
    }

    public void Void()
    {
        if (Status == ChargeLineStatus.Released) throw new DomainException("Released charge lines cannot be voided. Add an adjustment instead.");
        if (Status == ChargeLineStatus.Void) throw new DomainException("This charge line is already void.");
        Status = ChargeLineStatus.Void;
    }

    internal void MarkReleased(int billingBatchId)
    {
        if (Status != ChargeLineStatus.Approved) throw new DomainException($"Only approved charge lines can be released (line {Id} is {Status}).");
        Status = ChargeLineStatus.Released;
        BillingBatchId = billingBatchId;
    }

    /// <summary>
    /// Corrects a released line with a new line for the difference, priced like the original.
    /// Negative units reduce the charge; positive units add to it.
    /// </summary>
    public ChargeLine CreateAdjustment(decimal unitsDelta, string reason, int enteredByUserId, DateOnly chargeDate, DateTime utcNow)
    {
        if (Status != ChargeLineStatus.Released) throw new DomainException("Only released charge lines are adjusted. Edit or void the line instead.");
        if (unitsDelta == 0) throw new DomainException("An adjustment must change the units.");
        if (decimal.Round(unitsDelta, 2) != unitsDelta) throw new DomainException("Units can have at most two decimal places.");
        if (string.IsNullOrWhiteSpace(reason)) throw new DomainException("An adjustment needs a reason.");
        if (Units + unitsDelta < 0) throw new DomainException("An adjustment cannot reverse more units than the original line.");

        var adjustment = new ChargeLine
        {
            RequestId = RequestId,
            SubjectId = SubjectId,
            SectionCode = SectionCode,
            ChargeCode = ChargeCode,
            PriceListId = PriceListId,
            ChargeDate = chargeDate,
            Units = unitsDelta,
            UnitPrice = UnitPrice,
            Description = reason,
            SourceType = ChargeSourceType.Adjustment,
            AdjustsChargeLineId = Id,
            Status = ChargeLineStatus.Pending,
            EnteredByUserId = enteredByUserId,
            EnteredAt = utcNow,
        };
        adjustment.RecalculateAmount();
        return adjustment;
    }
}

/// <summary>What the request allows: PHL refused charges on no-charge requests and on projects that are inactive or closed to charges.</summary>
public sealed record RequestBillingContext(int RequestId, RequestChargeType ChargeType, bool ProjectIsActive, bool ProjectAllowsCharges);

/// <summary>A charge to be created. SectionCode is the price list section the work belongs to (NECRO, STAIN ...).</summary>
public sealed record NewCharge(string SectionCode, string ChargeCode, DateOnly ChargeDate, decimal Units, string? Description = null, int? SubjectId = null);

public static class ChargeCalculator
{
    public static ChargeLine Create(
        NewCharge charge,
        RequestBillingContext request,
        PriceCatalog catalog,
        int enteredByUserId,
        DateTime utcNow,
        ChargeSourceType source = ChargeSourceType.Manual,
        long? sourceEventId = null,
        string? ruleCode = null)
    {
        if (source == ChargeSourceType.Adjustment)
            throw new DomainException("Use ChargeLine.CreateAdjustment to adjust a released line.");
        if (request.ChargeType == RequestChargeType.NoCharge)
            throw new DomainException("This request is marked no charge; charges cannot be added.");
        if (request.ChargeType == RequestChargeType.Cancelled)
            throw new DomainException("This request is cancelled; charges cannot be added.");
        if (!request.ProjectIsActive || !request.ProjectAllowsCharges)
            throw new DomainException("The request's project is inactive or closed to charges. Update the project on the request before adding charges.");

        ValidateUnits(charge.Units);
        var quote = catalog.Quote(charge.ChargeCode, charge.ChargeDate);
        var code = quote.ChargeCode;
        if (!code.IsInSection(charge.SectionCode))
            throw new DomainException($"Charge code {code.Code} is not part of the {charge.SectionCode} section of the price list.");
        if (code.RequiresDescription && string.IsNullOrWhiteSpace(charge.Description))
            throw new DomainException($"Charge code {code.Code} ({code.Description}) needs a description of the work.");

        var line = new ChargeLine
        {
            RequestId = request.RequestId,
            SubjectId = charge.SubjectId,
            SectionCode = charge.SectionCode.ToUpperInvariant(),
            ChargeCode = code.Code,
            PriceListId = quote.PriceListId,
            ChargeDate = charge.ChargeDate,
            Units = charge.Units,
            UnitPrice = quote.UnitPrice,
            Description = string.IsNullOrWhiteSpace(charge.Description) ? null : charge.Description.Trim(),
            SourceType = source,
            SourceEventId = sourceEventId,
            RuleCode = ruleCode,
            Status = ChargeLineStatus.Pending,
            EnteredByUserId = enteredByUserId,
            EnteredAt = utcNow,
        };
        line.RecalculateAmount();
        return line;
    }

    public static void ValidateUnits(decimal units)
    {
        if (units <= 0) throw new DomainException("Units must be greater than zero.");
        if (decimal.Round(units, 2) != units) throw new DomainException("Units can have at most two decimal places.");
        if (units > 9_999_999.99m) throw new DomainException("Units are too large.");
    }
}
