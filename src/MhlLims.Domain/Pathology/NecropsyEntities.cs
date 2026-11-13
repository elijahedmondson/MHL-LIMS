using System.Globalization;
using MhlLims.Domain.Billing;
using MhlLims.Domain.Common;

namespace MhlLims.Domain.Pathology;

// Necropsy entities and rules (namespace Pathology, like the SQL schema "path"), for the necropsy half of db/070_necropsy_and_pathology.sql (Zaphod tblNecropsyHeaders, tblNecropsyOrgans,
// tblNecropsyFindings, tblNecropsyProtocols) and the rules for approving a necropsy. A port of pilot/core/necrules.mjs.

public enum NecropsyStatus { Draft, Approved }

public enum Perfusion { Whole, Lung, Liver }

public enum NecropsyProcedureCode { TerminalBleed, BloodCollection, BoneMarrowSmear, Biohazard, SnapFreezeTubes, BloodSmearPairs }

public class NecropsyProtocol
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool WeighAnimal { get; set; } = true;
    public Perfusion? Perfusion { get; set; }
    public string? Instructions { get; set; }
    public bool IsApproved { get; set; }
    public bool IsActive { get; set; } = true;
    public int? LegacyZaphodProtocolId { get; set; }
    public List<NecropsyProtocolOrgan> Organs { get; set; } = new();
}

public class NecropsyProtocolOrgan
{
    public int ProtocolId { get; set; }
    public int Sequence { get; set; }
    public string OrganCode { get; set; } = string.Empty;
    public bool WeighOrgan { get; set; }
    public string? DefaultBlock { get; set; }
}

public class Necropsy : IHasModifiedBy
{
    public int Id { get; set; }
    public int SubjectId { get; set; }
    public int ProtocolId { get; set; }
    public NecropsyStatus Status { get; set; } = NecropsyStatus.Draft;
    public DateOnly NecropsyDate { get; set; }
    public int? ProsectorUserId { get; set; }
    public string ProsectorInitials { get; set; } = string.Empty;
    public string Fate { get; set; } = "Scheduled euthanasia";
    public string? Condition { get; set; }
    public string? PhysicalId { get; set; }
    public bool MatchesCageCard { get; set; }
    public decimal? BodyWeightG { get; set; }
    public bool IsPartial { get; set; }
    public Perfusion? Perfusion { get; set; }
    public string? Observations { get; set; }
    public int? ApprovedByUserId { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public string ModifiedBy { get; set; } = string.Empty;
    public byte[]? RowVer { get; set; }

    public List<NecropsyOrgan> Organs { get; set; } = new();
    public List<NecropsyProcedure> Procedures { get; set; } = new();
}

public class NecropsyOrgan
{
    public int Id { get; set; }
    public int NecropsyId { get; set; }
    public int Sequence { get; set; }
    public string OrganCode { get; set; } = string.Empty;
    public string? BlockCode { get; set; }
    public bool IsWeighed { get; set; }
    public decimal? WeightG { get; set; }
    public bool NotCollected { get; set; }
    public string? Observations { get; set; }
    public List<NecropsyFinding> Findings { get; set; } = new();
}

public class NecropsyFinding
{
    public int Id { get; set; }
    public int NecropsyOrganId { get; set; }
    public string? Site { get; set; }
    public string Morphology { get; set; } = string.Empty;
    public string? Shape { get; set; }
    public string? Color { get; set; }
    public string? Consistency { get; set; }
    public int? Quantity { get; set; }
    public decimal? SizeMm { get; set; }
    public bool FixedNbf { get; set; }
    public bool FixedOct { get; set; }
    public bool FrozenLn2 { get; set; }
    public bool InPbs { get; set; }
    public string? Notes { get; set; }

    /// <summary>How the finding reads on the report, e.g. "Multifocal, 3 Nodule, Round, White, Firm, 2 mm (NBF)".</summary>
    public string Text()
    {
        var qty = Quantity is > 1 ? $"{Quantity} " : string.Empty;
        var size = SizeMm is decimal mm && mm > 0 ? mm.ToString("0.##", CultureInfo.InvariantCulture) + " mm" : null;
        var parts = new[] { Site, $"{qty}{Morphology}".Trim(), Shape, Color, Consistency, size }.Where(p => !string.IsNullOrWhiteSpace(p));
        // Same order as the necropsy screen's fixation choices: NBF, OCT, LN2, PBS.
        var fixation = new[] { FixedNbf ? "NBF" : null, FixedOct ? "OCT" : null, FrozenLn2 ? "LN2" : null, InPbs ? "PBS" : null }.Where(f => f is not null).ToList();
        return string.Join(", ", parts) + (fixation.Count > 0 ? $" ({string.Join(", ", fixation)})" : string.Empty) + (string.IsNullOrWhiteSpace(Notes) ? string.Empty : $". {Notes}");
    }
}

public class NecropsyProcedure
{
    public int NecropsyId { get; set; }
    public NecropsyProcedureCode ProcedureCode { get; set; }
    public int Quantity { get; set; } = 1;
}

public static class NecropsyRules
{
    /// <summary>Charge code for each billable procedure, in the order charges are created.</summary>
    public static readonly IReadOnlyList<(NecropsyProcedureCode Procedure, string ChargeCode, bool Counted)> ProcedureCharges =
    [
        (NecropsyProcedureCode.TerminalBleed, "HP002005", false), (NecropsyProcedureCode.BloodCollection, "HP002021", false),
        (NecropsyProcedureCode.BoneMarrowSmear, "HP002010", false), (NecropsyProcedureCode.Biohazard, "HP002006", false),
        (NecropsyProcedureCode.SnapFreezeTubes, "HP002016", true), (NecropsyProcedureCode.BloodSmearPairs, "HP002019", true),
    ];

    public static string PerfusionCode(Perfusion p) => p switch
    {
        Perfusion.Whole => "HP002007",
        Perfusion.Lung => "HP002008",
        Perfusion.Liver => "HP002009",
        _ => throw new DomainException($"Unknown perfusion {p}."),
    };

    /// <summary>What must be recorded before a necropsy can be approved (empty when it is ready).</summary>
    public static IReadOnlyList<string> ApprovalProblems(Necropsy n, bool protocolWeighsAnimal)
    {
        var problems = new List<string>();
        var organs = n.Organs.OrderBy(o => o.Sequence).ToList();
        if (!n.IsPartial && protocolWeighsAnimal && !(n.BodyWeightG > 0) && n.Fate != "Found dead") problems.Add("enter the body weight");
        var missing = organs.Where(o => o.IsWeighed && !o.NotCollected && !(o.WeightG > 0)).Select(o => o.OrganCode).ToList();
        if (!n.IsPartial && missing.Count > 0) problems.Add($"weigh {string.Join(", ", missing)} (or mark not collected)");
        var incomplete = organs.Where(o => o.Findings.Any(f => string.IsNullOrEmpty(f.Morphology))).Select(o => o.OrganCode).ToList();
        if (incomplete.Count > 0) problems.Add($"choose a morphology for each finding in {string.Join(", ", incomplete)}");
        if (!n.MatchesCageCard) problems.Add("confirm the animal matches its cage card");
        return problems;
    }

    /// <summary>The work drives billing: approval charges the necropsy, any perfusion and each ticked procedure (NECRO section).</summary>
    public static IReadOnlyList<PlannedCharge> ApprovalCharges(Necropsy n)
    {
        var charges = new List<PlannedCharge> { new("NECRO", n.IsPartial ? "HP002022" : "HP002001", 1) };
        if (n.Perfusion is Perfusion p) charges.Add(new PlannedCharge("NECRO", PerfusionCode(p), 1));
        foreach (var (procedure, code, counted) in ProcedureCharges)
        {
            var done = n.Procedures.FirstOrDefault(x => x.ProcedureCode == procedure);
            if (done is null || done.Quantity <= 0) continue;
            charges.Add(new PlannedCharge("NECRO", code, counted ? done.Quantity : 1));
        }
        return charges;
    }

    /// <summary>Approves the necropsy. The caller creates the charges from ApprovalCharges and moves the subject on.</summary>
    public static void Approve(Necropsy n, bool protocolWeighsAnimal, int userId, DateTime utcNow)
    {
        if (n.Status == NecropsyStatus.Approved) throw new DomainException("This necropsy is already approved.");
        var problems = ApprovalProblems(n, protocolWeighsAnimal);
        if (problems.Count > 0) throw new DomainException($"Before approving: {string.Join("; ", problems)}.");
        n.Status = NecropsyStatus.Approved;
        n.ApprovedByUserId = userId;
        n.ApprovedAt = utcNow;
    }

    /// <summary>
    /// Reopens an approved necropsy for correction. Its charges are voided unless already released (then correct them
    /// with adjustments first); a signed-out pathology report must be amended first.
    /// </summary>
    public static void Unapprove(Necropsy n, string reason, IEnumerable<ChargeLine> linkedCharges, bool pathologySignedOut)
    {
        if (n.Status != NecropsyStatus.Approved) throw new DomainException("This necropsy is not approved.");
        if (string.IsNullOrWhiteSpace(reason)) throw new DomainException("Give a reason for unapproving the necropsy.");
        var charges = linkedCharges.ToList();
        if (charges.Any(c => c.Status == ChargeLineStatus.Released))
            throw new DomainException("Its charges have already been released for billing. Correct them with adjustments in the request's charges, then unapprove.");
        if (pathologySignedOut)
            throw new DomainException("The pathology report for this animal is signed out. Amend the pathology report first, then unapprove the necropsy.");
        foreach (var c in charges.Where(c => c.Status != ChargeLineStatus.Void)) c.Void();
        n.Status = NecropsyStatus.Draft;
        n.ApprovedByUserId = null;
        n.ApprovedAt = null;
    }
}
