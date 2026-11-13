using MhlLims.Domain.Common;

namespace MhlLims.Domain.Billing;

/// <summary>
/// Legacy PHL rule: a STAT (priority S) PHL number gets a surcharge line (code &lt;lab&gt;009050).
/// The CY2027 price list has no surcharge code, so the rule ships disabled until the
/// billing administrator confirms it (price-list review, finding 6).
/// </summary>
public sealed record StatSurchargeSettings(bool IsEnabled, string? ChargeCode, string SectionCode, decimal UnitsPerSubject = 1m);

public sealed record SubjectBillingInfo(int SubjectId, string PhlNumber, string PriorityCode);

public static class StatSurchargeRule
{
    public const string RuleCode = "STAT_SURCHARGE";

    /// <summary>
    /// Returns the surcharge charges still owed: one per STAT subject that has at least one
    /// non-void charge and no surcharge yet. Running it twice adds nothing the second time.
    /// </summary>
    public static IReadOnlyList<NewCharge> Evaluate(
        StatSurchargeSettings settings, IEnumerable<SubjectBillingInfo> subjects, IEnumerable<ChargeLine> existingLines, DateOnly chargeDate)
    {
        if (!settings.IsEnabled) return Array.Empty<NewCharge>();
        if (string.IsNullOrWhiteSpace(settings.ChargeCode))
            throw new DomainException("The STAT surcharge rule is enabled but has no charge code.");

        var lines = existingLines.Where(l => l.Status != ChargeLineStatus.Void).ToList();
        var result = new List<NewCharge>();
        foreach (var subject in subjects.Where(s => s.PriorityCode == "S"))
        {
            var hasWork = lines.Any(l => l.SubjectId == subject.SubjectId && l.RuleCode != RuleCode);
            var hasSurcharge = lines.Any(l => l.SubjectId == subject.SubjectId && l.RuleCode == RuleCode);
            if (hasWork && !hasSurcharge)
                result.Add(new NewCharge(settings.SectionCode, settings.ChargeCode, chargeDate, settings.UnitsPerSubject,
                                         $"STAT surcharge for {subject.PhlNumber}", subject.SubjectId));
        }
        return result;
    }
}

public enum LaborRounding
{
    /// <summary>images x 4 / 6, rounded up to a whole quarter hour (7 images = 5 units).</summary>
    ProportionalRoundUp,

    /// <summary>Whole groups of 6 images, rounded up (7 images = 2 groups = 8 units).</summary>
    WholeBlocksRoundUp,

    /// <summary>images x 4 / 6 to two decimals (7 images = 4.67 units).</summary>
    ProportionalExact,
}

/// <summary>
/// Worksheet note: "WSI analysis is charged at 4 units labor per 6 slide images. For FL multiplex
/// images, each target is considered a separate image." The labor code and the rounding of partial
/// groups are not stated, so both are settings (price-list review, finding 7).
/// </summary>
public sealed record ImageAnalysisSettings(
    bool IsEnabled, string? ChargeCode, string SectionCode,
    int LaborUnitsPerBlock = 4, int ImagesPerBlock = 6, LaborRounding Rounding = LaborRounding.ProportionalRoundUp);

/// <summary>Slides analyzed together. For multiplex fluorescence, TargetsPerSlide is the number of markers.</summary>
public sealed record ImagedSlides(int SlideCount, int TargetsPerSlide = 1);

public static class ImageAnalysisLaborRule
{
    public const string RuleCode = "WSI_ANALYSIS_LABOR";

    public static int CountImages(IEnumerable<ImagedSlides> slides) =>
        slides.Sum(s =>
        {
            if (s.SlideCount < 0 || s.TargetsPerSlide < 0) throw new DomainException("Slide and target counts cannot be negative.");
            return s.SlideCount * Math.Max(1, s.TargetsPerSlide);
        });

    public static decimal LaborUnits(int images, ImageAnalysisSettings settings)
    {
        if (images < 0) throw new DomainException("The image count cannot be negative.");
        if (settings.ImagesPerBlock <= 0 || settings.LaborUnitsPerBlock <= 0)
            throw new DomainException("Images per group and labor units per group must be positive.");
        if (images == 0) return 0m;

        decimal exact = (decimal)images * settings.LaborUnitsPerBlock / settings.ImagesPerBlock;
        return settings.Rounding switch
        {
            LaborRounding.ProportionalRoundUp => Math.Ceiling(exact),
            LaborRounding.WholeBlocksRoundUp => Math.Ceiling((decimal)images / settings.ImagesPerBlock) * settings.LaborUnitsPerBlock,
            LaborRounding.ProportionalExact => Money.Round(exact),
            _ => throw new ArgumentOutOfRangeException(nameof(settings)),
        };
    }

    public static NewCharge? Evaluate(ImageAnalysisSettings settings, IEnumerable<ImagedSlides> slides, DateOnly chargeDate, int? subjectId = null)
    {
        if (!settings.IsEnabled) return null;
        if (string.IsNullOrWhiteSpace(settings.ChargeCode))
            throw new DomainException("The WSI analysis labor rule is enabled but has no charge code.");
        var images = CountImages(slides);
        var units = LaborUnits(images, settings);
        return units == 0
            ? null
            : new NewCharge(settings.SectionCode, settings.ChargeCode, chargeDate, units, $"WSI analysis: {images} image(s)", subjectId);
    }
}
