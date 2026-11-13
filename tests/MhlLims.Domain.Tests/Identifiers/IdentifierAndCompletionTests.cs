using MhlLims.Domain.Common;
using MhlLims.Domain.Core;
using MhlLims.Domain.Identifiers;

namespace MhlLims.Domain.Tests.Identifiers;

public class PhlNumberTests
{
    [Theory]
    [InlineData("27000123A")]
    [InlineData(" 27000123a ")]
    [InlineData("123456B")]      // legacy PM number
    public void Valid_numbers_parse(string text) => Assert.True(PhlNumber.TryParse(text, out _));

    [Theory]
    [InlineData("")]
    [InlineData("2700012A")]
    [InlineData("27000123")]
    [InlineData("27000123AA")]
    [InlineData("2700O123A")]   // letter O, not zero
    [InlineData("270001231")]
    public void Invalid_numbers_do_not_parse(string text) => Assert.False(PhlNumber.TryParse(text, out _));

    [Fact]
    public void Parts_are_exposed()
    {
        var p = PhlNumber.Parse("27000123b");
        Assert.Equal("27000123B", p.Value);
        Assert.Equal("27000123", p.Base);
        Assert.Equal('B', p.Suffix);
        Assert.False(p.IsLegacyPmFormat);
        Assert.True(PhlNumber.Parse("123456B").IsLegacyPmFormat);
    }

    [Fact]
    public void Sequential_format_pads_to_eight_digits()
    {
        var numbers = PhlNumberGenerator.Format(41, 3, PhlNumberFormat.Sequential, new DateOnly(2027, 2, 1));
        Assert.Equal(new[] { "00000041A", "00000042A", "00000043A" }, numbers.Select(n => n.Value));
        Assert.Equal(0, PhlNumberGenerator.CounterPeriod(PhlNumberFormat.Sequential, new DateOnly(2027, 2, 1)));
    }

    [Fact]
    public void Year_prefixed_format_restarts_each_year_without_a_manual_reset()
    {
        var numbers = PhlNumberGenerator.Format(123, 2, PhlNumberFormat.YearPrefixed, new DateOnly(2027, 2, 1));
        Assert.Equal(new[] { "27000123A", "27000124A" }, numbers.Select(n => n.Value));
        Assert.Equal(27, PhlNumberGenerator.CounterPeriod(PhlNumberFormat.YearPrefixed, new DateOnly(2027, 2, 1)));
        Assert.Equal(28, PhlNumberGenerator.CounterPeriod(PhlNumberFormat.YearPrefixed, new DateOnly(2028, 1, 2)));
    }

    [Fact]
    public void Year_prefixed_format_refuses_a_seven_digit_counter() =>
        Assert.Throws<DomainException>(() => PhlNumberGenerator.Format(999_999, 2, PhlNumberFormat.YearPrefixed, new DateOnly(2027, 2, 1)));

    [Fact]
    public void Request_numbers_combine_lab_year_and_counter()
    {
        Assert.Equal("HP270123", RequestNumberGenerator.Format("hp", new DateOnly(2027, 5, 1), 123));
        Assert.Equal("PA2712345", RequestNumberGenerator.Format("PA", new DateOnly(2027, 5, 1), 12345));
    }

    [Fact]
    public void Block_and_slide_barcodes_derive_from_the_phl_number()
    {
        var phl = PhlNumber.Parse("27000123A");
        Assert.Equal("27000123A-B3", Barcodes.Block(phl, 3));
        Assert.Equal("27000123A-B3-S02", Barcodes.Slide(phl, 3, 2));
        Assert.Equal("27000123A-S01", Barcodes.LooseSlide(phl, 1));
        Assert.Throws<DomainException>(() => Barcodes.Slide(phl, 3, 0));
    }

    [Fact]
    public void Zpl_label_contains_a_datamatrix_and_the_human_readable_id()
    {
        var zpl = ZplLabels.Small("27000123A-B3-S02", "27000123A-B3-S02", "H&E", "Rivera");
        Assert.StartsWith("^XA", zpl);
        Assert.Contains("^BXN", zpl);
        Assert.Contains("^FD27000123A-B3-S02^FS", zpl);
        Assert.EndsWith("^XZ", zpl);
    }
}

public class CompletionRuleTests
{
    private static readonly HashSet<string> Terminal = ["QC-PA", "ARCHV", "INVES"];

    private static Request OpenRequest() => new() { RequestNumber = "HP270123", ReceivedDate = new DateOnly(2027, 1, 10), Status = RequestStatus.Open };

    [Fact]
    public void Request_completes_when_every_subject_is_in_a_final_area()
    {
        var r = OpenRequest();
        r.Complete(new DateOnly(2027, 2, 1), new DateOnly(2027, 2, 2),
            [new SubjectLocation("27000001A", "QC-PA"), new SubjectLocation("27000002A", "ARCHV"), new SubjectLocation("27000003A", "STAIN", IsCancelled: true)],
            Terminal);
        Assert.Equal(RequestStatus.Complete, r.Status);
        Assert.Equal(new DateOnly(2027, 2, 1), r.CompletedDate);
    }

    [Fact]
    public void Unfinished_subjects_block_completion_and_are_named()
    {
        var ex = Assert.Throws<DomainException>(() => OpenRequest().Complete(new DateOnly(2027, 2, 1), new DateOnly(2027, 2, 2),
            [new SubjectLocation("27000001A", "QC-PA"), new SubjectLocation("27000002A", "STAIN"), new SubjectLocation("27000004A", null)],
            Terminal));
        Assert.Contains("27000002A", ex.Message);
        Assert.Contains("27000004A", ex.Message);
    }

    [Fact]
    public void Completion_date_cannot_precede_receipt_or_be_in_the_future()
    {
        Assert.Throws<DomainException>(() => OpenRequest().Complete(new DateOnly(2027, 1, 9), new DateOnly(2027, 2, 2), [], Terminal));
        Assert.Throws<DomainException>(() => OpenRequest().Complete(new DateOnly(2027, 2, 3), new DateOnly(2027, 2, 2), [], Terminal));
    }
}
