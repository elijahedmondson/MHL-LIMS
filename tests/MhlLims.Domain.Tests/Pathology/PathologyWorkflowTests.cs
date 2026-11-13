using MhlLims.Domain.Billing;
using MhlLims.Domain.Common;
using MhlLims.Domain.Ihc;
using MhlLims.Domain.Pathology;

namespace MhlLims.Domain.Tests.Pathology;

public class PathologyWorkflowTests
{
    private static readonly DateTime Now = new(2027, 3, 15, 14, 0, 0, DateTimeKind.Utc);

    private static PathologyCase ReadyCase() => new()
    {
        Id = 7,
        Tissues =
        [
            new PathologyTissue { Sequence = 1, OrganCode = "Lungs", BlockCode = "2", Result = TissueResult.Lesions,
                Diagnoses = [new PathologyDiagnosis { Id = 1, Sequence = 1, Term = "Adenoma, bronchiolo-alveolar", IsNeoplasm = true, Behavior = NeoplasmBehavior.Benign,
                    Correlations = [new PathologyCorrelation { DiagnosisEntryId = 1, NecropsyFindingId = 50 }] }] },
            new PathologyTissue { Sequence = 2, OrganCode = "Heart", BlockCode = "2", Result = TissueResult.Nsl },
            new PathologyTissue { Sequence = 3, OrganCode = "Liver", BlockCode = "3", Result = TissueResult.Nsl },
            new PathologyTissue { Sequence = 4, OrganCode = "Brain", BlockCode = "1", Result = TissueResult.NotExamined },
        ],
    };

    private static readonly GrossFindingRef[] Gross = [new(50, "Lungs")];

    [Fact]
    public void Sign_out_needs_every_check_to_pass_then_locks_and_keeps_the_signed_version()
    {
        var c = ReadyCase();
        c.Tissues[2].Result = TissueResult.Pending;
        var ex = Assert.Throws<DomainException>(() => PathologyRules.SignOut(c, Gross, false, 3, Now, "{}"));
        Assert.StartsWith("Before signing out: give a result for Liver", ex.Message);

        c.Tissues[2].Result = TissueResult.Nsl;
        PathologyRules.SignOut(c, Gross, false, 3, Now, "{\"v\":1}");
        Assert.Equal(PathologyCaseStatus.Signed, c.Status);
        Assert.Equal(3, c.SignedByUserId);
        Assert.Single(c.ReportVersions);
        Assert.Equal(1, c.ReportVersions[0].Version);
        Assert.Equal(2, PathologyRules.SlidesRead(c));   // lungs and heart share block 2
        Assert.Throws<DomainException>(() => PathologyRules.EnsureEditable(c));
        Assert.Throws<DomainException>(() => PathologyRules.SignOut(c, Gross, false, 3, Now, "{}"));
    }

    [Fact]
    public void Amending_needs_a_reason_voids_unbilled_charges_and_bills_only_the_difference_next_time()
    {
        var c = ReadyCase();
        PathologyRules.SignOut(c, Gross, false, 3, Now, "{}");
        var released = new ChargeLine { ChargeCode = "PA001002", Units = 2, Status = ChargeLineStatus.Released, BillingBatchId = 9 };
        var pending = new ChargeLine { ChargeCode = "PA001004", Units = 1, Status = ChargeLineStatus.Pending };

        Assert.Throws<DomainException>(() => PathologyRules.Amend(c, " ", 3, Now, [released, pending]));
        PathologyRules.Amend(c, "Adrenal section added", 3, Now, [released, pending]);
        Assert.Equal(PathologyCaseStatus.Draft, c.Status);
        Assert.Equal(2, c.Version);
        Assert.Equal(ChargeLineStatus.Released, released.Status);
        Assert.Equal(ChargeLineStatus.Void, pending.Status);
        Assert.Equal("Adrenal section added", c.Amendments.Single().Reason);

        c.Tissues.Add(new PathologyTissue { Sequence = 5, OrganCode = "Adrenal glands", BlockCode = "5", Result = TissueResult.Nsl });
        var charges = PathologyRules.SignOutCharges(PathologyRules.SlidesRead(c), 0, null, billedSlides: 2, billedQuarterHours: 0, c.Version);
        var line = Assert.Single(charges);
        Assert.Equal(("PA001002", 1m), (line.ChargeCode, line.Units));
        Assert.Equal("Pathology, 3 slides read (amended report v2)", line.Description);
    }

    [Fact]
    public void Only_signed_reports_can_be_amended()
    {
        Assert.Throws<DomainException>(() => PathologyRules.Amend(ReadyCase(), "reason", 3, Now, []));
    }

    [Fact]
    public void Cause_of_death_is_needed_when_the_animal_was_found_dead()
    {
        var n = new Necropsy { Status = NecropsyStatus.Approved, Fate = "Found dead" };
        Assert.True(PathologyRules.NeedsCauseOfDeath(n));
        Assert.False(PathologyRules.NeedsCauseOfDeath(new Necropsy { Status = NecropsyStatus.Approved, Fate = "Scheduled euthanasia" }));
        Assert.False(PathologyRules.NeedsCauseOfDeath(new Necropsy { Status = NecropsyStatus.Draft, Fate = "Found dead" }));
        var problems = PathologyRules.SignOutProblems(ReadyCase(), Gross, needCauseOfDeath: true);
        Assert.Contains("record the cause of death (the animal was found dead or euthanized moribund)", problems);
    }

    [Fact]
    public void Necropsy_approval_and_unapproval()
    {
        var n = new Necropsy
        {
            Fate = "Scheduled euthanasia", BodyWeightG = 22.5m, MatchesCageCard = false, Perfusion = Perfusion.Lung,
            Organs = [new NecropsyOrgan { Sequence = 1, OrganCode = "Lungs", IsWeighed = true, WeightG = 0.2m }],
            Procedures = [new NecropsyProcedure { ProcedureCode = NecropsyProcedureCode.SnapFreezeTubes, Quantity = 3 }],
        };
        var ex = Assert.Throws<DomainException>(() => NecropsyRules.Approve(n, true, 4, Now));
        Assert.Equal("Before approving: confirm the animal matches its cage card.", ex.Message);
        n.MatchesCageCard = true;
        NecropsyRules.Approve(n, true, 4, Now);
        Assert.Equal(NecropsyStatus.Approved, n.Status);
        Assert.Equal(new[] { "HP002001 x1", "HP002008 x1", "HP002016 x3" }, NecropsyRules.ApprovalCharges(n).Select(c => $"{c.ChargeCode} x{c.Units:0}"));

        var released = new ChargeLine { Status = ChargeLineStatus.Released, BillingBatchId = 1 };
        Assert.Contains("released", Assert.Throws<DomainException>(() => NecropsyRules.Unapprove(n, "wrong animal", [released], false)).Message);
        Assert.Contains("Amend the pathology report first", Assert.Throws<DomainException>(() => NecropsyRules.Unapprove(n, "wrong animal", [], true)).Message);
        var pending = new ChargeLine { Status = ChargeLineStatus.Pending };
        NecropsyRules.Unapprove(n, "wrong animal", [pending], false);
        Assert.Equal(NecropsyStatus.Draft, n.Status);
        Assert.Equal(ChargeLineStatus.Void, pending.Status);
    }

    [Fact]
    public void Gross_finding_text_reads_like_the_necropsy_screen()
    {
        var f = new NecropsyFinding { Site = "Multifocal", Quantity = 3, Morphology = "Nodule", Shape = "Round", Color = "White", Consistency = "Firm", SizeMm = 2m, FixedNbf = true };
        Assert.Equal("Multifocal, 3 Nodule, Round, White, Firm, 2 mm (NBF)", f.Text());
    }

    [Fact]
    public void Ihc_requests_are_accepted_or_declined_once()
    {
        var r = new IhcRequest { RequestNumber = "MH27-0001" };
        Assert.Throws<DomainException>(() => r.Decline("", 2, Now));
        r.Accept(limsRequestId: 40, userId: 2, utcNow: Now);
        Assert.Equal(IhcRequestStatus.Accepted, r.Status);
        Assert.Equal(40, r.LimsRequestId);
        Assert.Contains("accepted", Assert.Throws<DomainException>(() => r.Decline("duplicate", 2, Now)).Message);
    }

    [Fact]
    public void Editing_an_assay_recomputes_what_is_derived_from_its_text()
    {
        var a = new Assay { Id = 5, Name = "Triplex CK19 + CD8 + CD4", DetectionKit = "Bond Polymer Refine, OPALs 690, 520, 570", Species = "Human, Hu Xg in Mice", Fixative = "10% NBF" };
        IhcCatalogRules.ApplyDerived(a);
        Assert.Equal((AssayKind.Opal, 3, "Leica Bond"), (a.Kind, a.Plex, a.Platform));
        Assert.Equal(new[] { "Human", "Human xenograft" }, a.SpeciesTags.Select(t => t.Tag));
        Assert.Equal(new[] { "NBF" }, a.FixativeTags.Select(t => t.Tag));

        var pair = new Assay { Id = 6, Name = "Double stain: CD3 + CD45R/B220", Kind = AssayKind.Ihc, Plex = 2, Species = "Mouse", Components = [new AssayComponent { AssayId = 6, ComponentAssayId = 1, StainOrder = 1 }] };
        IhcCatalogRules.ApplyDerived(pair);
        Assert.Equal((AssayKind.Ihc, 2), (pair.Kind, pair.Plex));    // a double stain keeps the kind worked out from its components
        Assert.Equal(new[] { "Mouse" }, pair.SpeciesTags.Select(t => t.Tag));
    }
}
