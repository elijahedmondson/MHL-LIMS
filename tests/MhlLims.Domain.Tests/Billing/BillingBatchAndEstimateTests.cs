using MhlLims.Domain.Billing;
using MhlLims.Domain.Common;

namespace MhlLims.Domain.Tests.Billing;

public class BillingBatchTests
{
    private static readonly PriceCatalog Catalog = TestCatalog.Cy2027();

    private static ChargeLine Approved(int id, string section, string code, decimal units, DateOnly date, string? description = null)
    {
        var line = ChargeCalculator.Create(new NewCharge(section, code, date, units, description), TestCatalog.Billable(), Catalog, 5, TestCatalog.Now);
        line.Id = id;
        line.Approve();
        return line;
    }

    private static BillingBatch MarchBatch(string lab = "HP")
    {
        var batch = BillingBatch.Open(lab, new DateOnly(2027, 3, 1), new DateOnly(2027, 3, 31), 9, TestCatalog.Now);
        batch.Id = 12;
        return batch;
    }

    [Fact]
    public void Only_approved_lines_in_the_period_and_lab_are_eligible()
    {
        var inMarch = Approved(1, "NECRO", "HP002001", 4, new DateOnly(2027, 3, 10));
        var inApril = Approved(2, "NECRO", "HP002001", 4, new DateOnly(2027, 4, 1));
        var pathology = Approved(3, "PATH", "PA001002", 10, new DateOnly(2027, 3, 12));
        var pending = ChargeCalculator.Create(new NewCharge("STAIN", "HP005003", new DateOnly(2027, 3, 11), 8), TestCatalog.Billable(), Catalog, 5, TestCatalog.Now);

        var eligible = MarchBatch().SelectEligible([inMarch, inApril, pathology, pending]);

        Assert.Equal(new[] { 1 }, eligible.Select(l => l.Id));
        Assert.Equal(new[] { 3 }, MarchBatch("PA").SelectEligible([inMarch, inApril, pathology, pending]).Select(l => l.Id));
    }

    [Fact]
    public void Release_locks_lines_and_records_totals()
    {
        var a = Approved(1, "NECRO", "HP002001", 4, new DateOnly(2027, 3, 10));   // 164.24
        var b = Approved(2, "STAIN", "HP006017", 2, new DateOnly(2027, 3, 20));   // 358.50
        var batch = MarchBatch();

        batch.Release([a, b], 9, TestCatalog.Now, Rpt080Extract.FormatName, Rpt080Extract.FileName("HP", batch.PeriodEnd));

        Assert.Equal(BillingBatchStatus.Released, batch.Status);
        Assert.Equal(2, batch.LineCount);
        Assert.Equal(522.74m, batch.TotalAmount);
        Assert.Equal("hp\\HP270331.txt", batch.ExportFileName);
        Assert.All(new[] { a, b }, l => Assert.Equal(ChargeLineStatus.Released, l.Status));
        Assert.All(new[] { a, b }, l => Assert.Equal(12, l.BillingBatchId));
    }

    [Fact]
    public void A_batch_is_released_only_once_and_never_empty()
    {
        var batch = MarchBatch();
        Assert.Throws<DomainException>(() => batch.Release([], 9, TestCatalog.Now, "RPT080", "x"));
        batch.Release([Approved(1, "NECRO", "HP002001", 1, new DateOnly(2027, 3, 2))], 9, TestCatalog.Now, "RPT080", "x");
        Assert.Throws<DomainException>(() => batch.Release([Approved(2, "NECRO", "HP002001", 1, new DateOnly(2027, 3, 3))], 9, TestCatalog.Now, "RPT080", "x"));
    }

    [Fact]
    public void Ineligible_lines_block_the_release()
    {
        var april = Approved(2, "NECRO", "HP002001", 4, new DateOnly(2027, 4, 1));
        var ex = Assert.Throws<DomainException>(() => MarchBatch().Release([april], 9, TestCatalog.Now, "RPT080", "x"));
        Assert.Contains("does not belong", ex.Message);
        Assert.Equal(ChargeLineStatus.Approved, april.Status);
    }

    [Fact]
    public void Unsaved_batch_cannot_be_released()
    {
        var batch = BillingBatch.Open("HP", new DateOnly(2027, 3, 1), new DateOnly(2027, 3, 31), 9, TestCatalog.Now);
        Assert.Throws<DomainException>(() => batch.Release([Approved(1, "NECRO", "HP002001", 1, new DateOnly(2027, 3, 2))], 9, TestCatalog.Now, "RPT080", "x"));
    }
}

public class EstimateTests
{
    private static readonly PriceCatalog Catalog = TestCatalog.Cy2027();
    private static readonly DateOnly Day = new(2027, 2, 1);

    private static EstimateLine Plan(string section, string code, decimal units) =>
        EstimateCalculator.CreateLine(1, section, code, units, Day, Catalog, "tester", TestCatalog.Now);

    [Fact]
    public void Estimate_totals_by_section_and_compares_with_authorization()
    {
        // A small necropsy study: 10 mice, 30 paraffin blocks, 30 first sections, 30 H&E, 30 scans, 30 slides read.
        var lines = new[]
        {
            Plan("NECRO", "HP002001", 10),       //  410.60
            Plan("TRIM_EMBED", "HP003003", 30),  //  464.10
            Plan("MICROTOMY", "HP004001", 30),   //  406.50
            Plan("STAIN", "HP005003", 30),       //   94.50
            Plan("IMAGE", "HP001006", 30),       //  373.50
            Plan("PATH", "PA001002", 30),        //  715.20
        };

        var summary = EstimateCalculator.Summarize(lines, authorizedAmount: 2500m, charges: []);

        Assert.Equal(2464.40m, summary.EstimatedTotal);
        Assert.Equal(6, summary.Sections.Count);
        Assert.Equal(715.20m, summary.Sections.Single(s => s.SectionCode == "PATH").Amount);
        Assert.False(summary.EstimateExceedsAuthorization);
        Assert.Equal(2500m, summary.RemainingAuthorization);
    }

    [Fact]
    public void Charges_to_date_reduce_the_remaining_authorization_and_void_lines_do_not()
    {
        var c1 = ChargeCalculator.Create(new NewCharge("NECRO", "HP002001", Day, 10), TestCatalog.Billable(), Catalog, 5, TestCatalog.Now); // 410.60
        var c2 = ChargeCalculator.Create(new NewCharge("NECRO", "HP002007", Day, 10), TestCatalog.Billable(), Catalog, 5, TestCatalog.Now); // 503.10
        c2.Void();

        var summary = EstimateCalculator.Summarize([Plan("NECRO", "HP002001", 10)], 400m, [c1, c2]);

        Assert.Equal(410.60m, summary.ChargedToDate);
        Assert.Equal(-10.60m, summary.RemainingAuthorization);
        Assert.True(summary.ChargesExceedAuthorization);
        Assert.True(summary.EstimateExceedsAuthorization);
    }

    [Fact]
    public void No_authorization_means_no_remaining_amount()
    {
        var summary = EstimateCalculator.Summarize([Plan("STAIN", "HP006004", 5)], null, []);
        Assert.Null(summary.RemainingAuthorization);
        Assert.False(summary.EstimateExceedsAuthorization);
    }
}
