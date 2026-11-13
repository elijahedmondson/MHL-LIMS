using System.Globalization;
using MhlLims.Domain.Common;

namespace MhlLims.Domain.Identifiers;

/// <summary>
/// An MHL number: eight digits followed by an upper-case suffix letter (e.g. 27000123A).
/// Legacy six-digit "PM" numbers (e.g. 123456B) are accepted so migrated records still parse.
/// </summary>
public readonly record struct PhlNumber
{
    private PhlNumber(string value) => Value = value;

    public string Value { get; }

    /// <summary>The digits without the suffix letter.</summary>
    public string Base => Value[..^1];

    public char Suffix => Value[^1];

    /// <summary>True for the old six-digit format, which new numbers never use.</summary>
    public bool IsLegacyPmFormat => Value.Length == 7;

    public static bool TryParse(string? text, out PhlNumber result)
    {
        result = default;
        if (string.IsNullOrWhiteSpace(text)) return false;
        var t = text.Trim().ToUpperInvariant();
        if (t.Length != 9 && t.Length != 7) return false;
        for (var i = 0; i < t.Length - 1; i++)
            if (t[i] < '0' || t[i] > '9') return false;
        var suffix = t[^1];
        if (suffix < 'A' || suffix > 'Z') return false;
        result = new PhlNumber(t);
        return true;
    }

    public static PhlNumber Parse(string text) =>
        TryParse(text, out var p)
            ? p
            : throw new DomainException($"'{text}' is not a valid MHL number (eight digits followed by a letter, e.g. 27000123A).");

    public override string ToString() => Value ?? string.Empty;
}

public enum PhlNumberFormat
{
    /// <summary>A single counter that never resets, zero-padded to eight digits.</summary>
    Sequential,

    /// <summary>Two-digit year of the received date followed by a six-digit counter that restarts each year.</summary>
    YearPrefixed,
}

/// <summary>
/// Hands out blocks of consecutive numbers. Implemented in SQL by lims.usp_AllocateNumbers,
/// which replaces PHL's phl_key table and its manual contract-year reset.
/// </summary>
public interface INumberAllocator
{
    /// <returns>The first value of a block of <paramref name="count"/> consecutive values.</returns>
    Task<int> AllocateAsync(string counterName, short period, int count, CancellationToken cancellationToken = default);
}

public static class PhlNumberGenerator
{
    public const string CounterName = "PHL";

    public static short CounterPeriod(PhlNumberFormat format, DateOnly receivedDate) =>
        format == PhlNumberFormat.YearPrefixed ? (short)(receivedDate.Year % 100) : (short)0;

    /// <summary>Formats a block of allocated counter values as MHL numbers.</summary>
    public static IReadOnlyList<PhlNumber> Format(int firstValue, int count, PhlNumberFormat format, DateOnly receivedDate, char suffix = 'A')
    {
        if (count < 1) throw new DomainException("At least one MHL number must be requested.");
        if (firstValue < 1) throw new DomainException("Counter values start at 1.");
        if (suffix < 'A' || suffix > 'Z') throw new DomainException("The MHL number suffix must be a letter A-Z.");

        var numbers = new List<PhlNumber>(count);
        for (var i = 0; i < count; i++)
        {
            long n = (long)firstValue + i;
            string digits = format switch
            {
                PhlNumberFormat.Sequential when n <= 99_999_999 =>
                    n.ToString("D8", CultureInfo.InvariantCulture),
                PhlNumberFormat.YearPrefixed when n <= 999_999 =>
                    (receivedDate.Year % 100).ToString("D2", CultureInfo.InvariantCulture) + n.ToString("D6", CultureInfo.InvariantCulture),
                PhlNumberFormat.Sequential => throw new DomainException("The MHL number counter has exceeded eight digits."),
                PhlNumberFormat.YearPrefixed => throw new DomainException("More than 999,999 MHL numbers were requested in one year."),
                _ => throw new ArgumentOutOfRangeException(nameof(format)),
            };
            numbers.Add(PhlNumber.Parse(digits + suffix));
        }
        return numbers;
    }
}

public static class RequestNumberGenerator
{
    public static string CounterName(string labCode) => "REQ-" + labCode.ToUpperInvariant();

    public static short CounterPeriod(DateOnly receivedDate) => (short)(receivedDate.Year % 100);

    /// <summary>Lab code + two-digit year + at least four digits, e.g. HP270123.</summary>
    public static string Format(string labCode, DateOnly receivedDate, int counterValue)
    {
        if (counterValue < 1) throw new DomainException("Counter values start at 1.");
        return labCode.ToUpperInvariant()
               + (receivedDate.Year % 100).ToString("D2", CultureInfo.InvariantCulture)
               + counterValue.ToString("D4", CultureInfo.InvariantCulture);
    }
}

/// <summary>Barcode values for blocks and slides, derived from the MHL number.</summary>
public static class Barcodes
{
    public static string Block(PhlNumber phl, int blockNumber)
    {
        if (blockNumber is < 1 or > 999) throw new DomainException("Block numbers run from 1 to 999.");
        return $"{phl}-B{blockNumber}";
    }

    public static string Slide(PhlNumber phl, int blockNumber, int slideNumber)
    {
        if (slideNumber is < 1 or > 99) throw new DomainException("Slide numbers run from 1 to 99.");
        return $"{Block(phl, blockNumber)}-S{slideNumber:00}";
    }

    /// <summary>Slides with no block: smears, cytospins, touch preps.</summary>
    public static string LooseSlide(PhlNumber phl, int slideNumber)
    {
        if (slideNumber is < 1 or > 99) throw new DomainException("Slide numbers run from 1 to 99.");
        return $"{phl}-S{slideNumber:00}";
    }
}

/// <summary>
/// ZPL for thermal label printers. The printer draws the DataMatrix itself (^BX), so no
/// barcode fonts are needed on any PC. Layouts are starting points to tune on the real printers.
/// </summary>
public static class ZplLabels
{
    /// <summary>A small slide or cassette label: 2D code on the left, three text lines on the right.</summary>
    public static string Small(string barcode, string line1, string line2, string line3) =>
        "^XA^CI28"
        + $"^FO15,15^BXN,4,200^FD{Clean(barcode)}^FS"
        + $"^FO110,12^A0N,24,24^FD{Clean(line1)}^FS"
        + $"^FO110,42^A0N,20,20^FD{Clean(line2)}^FS"
        + $"^FO110,68^A0N,20,20^FD{Clean(line3)}^FS"
        + "^XZ";

    private static string Clean(string s) => s.Replace("^", " ", StringComparison.Ordinal).Replace("~", " ", StringComparison.Ordinal);
}
