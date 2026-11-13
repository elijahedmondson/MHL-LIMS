using MhlLims.Domain.Common;

namespace MhlLims.Domain.Billing;

public enum BillingBatchStatus { Open, Released }

/// <summary>
/// A billing run for one lab and period. Releasing it locks every included line and records
/// what was exported. Lines belong to the lab of their charge code (HP or PA).
/// Save the batch before releasing it so it has an Id to stamp on the lines.
/// </summary>
public class BillingBatch
{
    public int Id { get; set; }
    public string LabCode { get; set; } = string.Empty;
    public DateOnly PeriodStart { get; set; }

    /// <summary>Inclusive.</summary>
    public DateOnly PeriodEnd { get; set; }

    public BillingBatchStatus Status { get; set; } = BillingBatchStatus.Open;
    public int CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; }
    public int? ReleasedByUserId { get; set; }
    public DateTime? ReleasedAt { get; set; }
    public string? ExportFormat { get; set; }
    public string? ExportFileName { get; set; }
    public int? LineCount { get; set; }
    public decimal? TotalAmount { get; set; }

    public static BillingBatch Open(string labCode, DateOnly periodStart, DateOnly periodEnd, int createdByUserId, DateTime utcNow)
    {
        if (string.IsNullOrWhiteSpace(labCode)) throw new DomainException("A billing batch needs a lab.");
        if (periodEnd < periodStart) throw new DomainException("The billing period ends before it starts.");
        return new BillingBatch
        {
            LabCode = labCode.ToUpperInvariant(),
            PeriodStart = periodStart,
            PeriodEnd = periodEnd,
            CreatedByUserId = createdByUserId,
            CreatedAt = utcNow,
        };
    }

    public bool IsEligible(ChargeLine line) =>
        line.Status == ChargeLineStatus.Approved
        && line.ChargeDate >= PeriodStart
        && line.ChargeDate <= PeriodEnd
        && line.ChargeCode.StartsWith(LabCode, StringComparison.OrdinalIgnoreCase);

    public IReadOnlyList<ChargeLine> SelectEligible(IEnumerable<ChargeLine> lines) => lines.Where(IsEligible).ToList();

    public void Release(IReadOnlyCollection<ChargeLine> lines, int releasedByUserId, DateTime utcNow, string exportFormat, string exportFileName)
    {
        if (Status != BillingBatchStatus.Open) throw new DomainException("This billing batch has already been released.");
        if (Id == 0) throw new DomainException("Save the billing batch before releasing it.");
        if (lines.Count == 0) throw new DomainException("There are no approved charge lines in this lab and period to release.");
        var ineligible = lines.FirstOrDefault(l => !IsEligible(l));
        if (ineligible is not null)
            throw new DomainException(
                $"Charge line {ineligible.Id} ({ineligible.ChargeCode}, {ineligible.ChargeDate:yyyy-MM-dd}, {ineligible.Status}) does not belong in this batch.");

        foreach (var line in lines) line.MarkReleased(Id);
        LineCount = lines.Count;
        TotalAmount = lines.Sum(l => Money.Amount(l.Units, l.UnitPrice));
        Status = BillingBatchStatus.Released;
        ReleasedByUserId = releasedByUserId;
        ReleasedAt = utcNow;
        ExportFormat = exportFormat;
        ExportFileName = exportFileName;
    }
}
