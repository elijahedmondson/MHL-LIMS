using MhlLims.Domain.Common;

namespace MhlLims.Domain.Billing;

public enum PriceListStatus { Draft, Approved, Retired }

/// <summary>A billable service, e.g. HP002001 Necropsy. The price lives on a price list, not here.</summary>
public class ChargeCode : IHasModifiedBy
{
    public string Code { get; set; } = string.Empty;
    public string LabCode { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string UnitOfMeasure { get; set; } = string.Empty;

    /// <summary>"(DEFINE)" items such as labor and reagents need a description of the work.</summary>
    public bool RequiresDescription { get; set; }

    public bool IsActive { get; set; } = true;
    public string ModifiedBy { get; set; } = string.Empty;

    /// <summary>Price list sections the code appears in. Labor (HP009002) appears in six.</summary>
    public List<ChargeCodeSection> Sections { get; set; } = new();

    public bool IsInSection(string sectionCode) =>
        Sections.Count == 0 || Sections.Any(s => string.Equals(s.SectionCode, sectionCode, StringComparison.OrdinalIgnoreCase));
}

public class ChargeCodeSection
{
    public string ChargeCode { get; set; } = string.Empty;
    public string SectionCode { get; set; } = string.Empty;
    public int SortOrder { get; set; }
}

/// <summary>
/// An effective-dated set of prices (e.g. CY2027). Prices can change only while the list is a
/// draft. Once approved it is frozen; a new year means a new list.
/// </summary>
public class PriceList
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateOnly EffectiveFrom { get; set; }

    /// <summary>Exclusive end date; null means open-ended.</summary>
    public DateOnly? EffectiveTo { get; set; }

    public PriceListStatus Status { get; set; } = PriceListStatus.Draft;
    public int? ApprovedByUserId { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public string? SourceFile { get; set; }
    public string? Notes { get; set; }
    public List<PriceListItem> Items { get; set; } = new();

    public bool IsEffectiveOn(DateOnly date) =>
        date >= EffectiveFrom && (EffectiveTo is null || date < EffectiveTo.Value);

    public bool Overlaps(PriceList other) =>
        EffectiveFrom < (other.EffectiveTo ?? DateOnly.MaxValue) && other.EffectiveFrom < (EffectiveTo ?? DateOnly.MaxValue);

    public IReadOnlyList<string> UnpricedCodes() =>
        Items.Where(i => i.UnitPrice is null).Select(i => i.ChargeCode).OrderBy(c => c, StringComparer.Ordinal).ToList();

    public void SetPrice(string chargeCode, decimal? unitPrice)
    {
        EnsureDraft();
        if (unitPrice is < 0m) throw new DomainException("A price cannot be negative.");
        decimal? rounded = unitPrice is null ? null : Money.Round(unitPrice.Value);
        var item = Items.FirstOrDefault(i => string.Equals(i.ChargeCode, chargeCode, StringComparison.OrdinalIgnoreCase));
        if (item is null)
            Items.Add(new PriceListItem { PriceListId = Id, ChargeCode = chargeCode, UnitPrice = rounded });
        else
            item.UnitPrice = rounded;
    }

    /// <summary>
    /// Approves the list. Unpriced codes are allowed (they simply cannot be charged), but the
    /// caller should show <see cref="UnpricedCodes"/> to the approver first.
    /// </summary>
    public void Approve(int approvedByUserId, DateTime utcNow, IEnumerable<PriceList> otherLists)
    {
        EnsureDraft();
        if (Items.Count == 0) throw new DomainException($"Price list {Name} has no items.");
        var clash = otherLists.FirstOrDefault(o => o.Id != Id && o.Status == PriceListStatus.Approved && o.Overlaps(this));
        if (clash is not null)
            throw new DomainException($"Price list {Name} overlaps approved price list {clash.Name}. Set an end date on {clash.Name} first.");
        Status = PriceListStatus.Approved;
        ApprovedByUserId = approvedByUserId;
        ApprovedAt = utcNow;
    }

    /// <summary>Ends an approved, open-ended list so the next year's list can start.</summary>
    public void EndOn(DateOnly exclusiveEndDate)
    {
        if (Status != PriceListStatus.Approved) throw new DomainException($"Only an approved price list can be given an end date ({Name} is {Status}).");
        if (exclusiveEndDate <= EffectiveFrom) throw new DomainException("The end date must be after the start date.");
        EffectiveTo = exclusiveEndDate;
    }

    public void Retire()
    {
        if (Status != PriceListStatus.Approved) throw new DomainException($"Only an approved price list can be retired ({Name} is {Status}).");
        Status = PriceListStatus.Retired;
    }

    private void EnsureDraft()
    {
        if (Status != PriceListStatus.Draft)
            throw new DomainException($"Price list {Name} is {Status}; prices can only change while it is a draft. Create a new price list instead.");
    }
}

public class PriceListItem : IHasModifiedBy
{
    public int PriceListId { get; set; }
    public string ChargeCode { get; set; } = string.Empty;

    /// <summary>Null means "not priced"; such a code cannot be charged.</summary>
    public decimal? UnitPrice { get; set; }

    public string ModifiedBy { get; set; } = string.Empty;
}

public sealed record PriceQuote(int PriceListId, string PriceListName, ChargeCode ChargeCode, decimal UnitPrice);

/// <summary>
/// All charge codes plus the approved price lists, answering "what does this code cost on this date?".
/// Load it once per unit of work (see Infrastructure PriceCatalogLoader).
/// </summary>
public sealed class PriceCatalog
{
    private readonly Dictionary<string, ChargeCode> _codes;
    private readonly List<PriceList> _lists;

    public PriceCatalog(IEnumerable<ChargeCode> chargeCodes, IEnumerable<PriceList> priceLists)
    {
        _codes = chargeCodes.ToDictionary(c => c.Code, StringComparer.OrdinalIgnoreCase);
        _lists = priceLists.Where(p => p.Status == PriceListStatus.Approved).OrderBy(p => p.EffectiveFrom).ToList();
        for (var i = 0; i < _lists.Count; i++)
            for (var j = i + 1; j < _lists.Count; j++)
                if (_lists[i].Overlaps(_lists[j]))
                    throw new DomainException($"Approved price lists {_lists[i].Name} and {_lists[j].Name} overlap.");
    }

    public IReadOnlyCollection<ChargeCode> ChargeCodes => _codes.Values;

    public ChargeCode GetChargeCode(string code) =>
        _codes.TryGetValue(code, out var c) ? c : throw new DomainException($"Unknown charge code {code}.");

    public PriceList? ListEffectiveOn(DateOnly date) => _lists.FirstOrDefault(l => l.IsEffectiveOn(date));

    public PriceQuote Quote(string chargeCode, DateOnly chargeDate)
    {
        var code = GetChargeCode(chargeCode);
        if (!code.IsActive) throw new DomainException($"Charge code {code.Code} is inactive.");
        var list = ListEffectiveOn(chargeDate)
                   ?? throw new DomainException($"No approved price list is in effect on {chargeDate:yyyy-MM-dd}.");
        var item = list.Items.FirstOrDefault(i => string.Equals(i.ChargeCode, code.Code, StringComparison.OrdinalIgnoreCase))
                   ?? throw new DomainException($"Charge code {code.Code} is not on price list {list.Name}.");
        if (item.UnitPrice is null)
            throw new DomainException($"Charge code {code.Code} ({code.Description}) has no price on price list {list.Name}.");
        return new PriceQuote(list.Id, list.Name, code, item.UnitPrice.Value);
    }
}
