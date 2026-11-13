using MhlLims.Domain.Common;

namespace MhlLims.Domain.Core;

public enum RequestStatus { Draft, Open, Complete, Cancelled }

public enum SubjectStatus { Active, Complete, Cancelled }

/// <summary>PHL r_charge_type: C = charge, N = no charge, L = cancelled.</summary>
public enum RequestChargeType { Charge = 'C', NoCharge = 'N', Cancelled = 'L' }

public class Investigator : IHasModifiedBy
{
    public int Id { get; set; }
    public string LastName { get; set; } = string.Empty;
    public string? FirstName { get; set; }
    public string? Title { get; set; }
    public string? Institute { get; set; }
    public string? Division { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public int? LegacySsgInvesNo { get; set; }
    public bool IsActive { get; set; } = true;
    public string ModifiedBy { get; set; } = string.Empty;

    public string DisplayName => string.IsNullOrWhiteSpace(FirstName) ? LastName : $"{LastName}, {FirstName}";
}

/// <summary>A Costpoint project, synchronized read-only from the Costpoint replica.</summary>
public class Project
{
    public int Id { get; set; }
    public string CostpointProjectId { get; set; } = string.Empty;
    public string? Name { get; set; }
    public bool IsActive { get; set; } = true;
    public bool AllowCharges { get; set; } = true;
    public DateOnly? StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public DateTime? LastSyncedAt { get; set; }
}

/// <summary>An approved NAS request, synchronized read-only from NAS.</summary>
public class NasRequest
{
    public int Id { get; set; }                       // NAS internal id
    public string RequestDisplayId { get; set; } = string.Empty;  // the NAS# staff see
    public string? RequesterLastName { get; set; }
    public string? RequesterFirstName { get; set; }
    public string? RequesterEmail { get; set; }
    public string? ServiceAreaName { get; set; }
    public string? CostpointProjectId { get; set; }
    public string? Description { get; set; }
    public decimal? TotalEstimatedCost { get; set; }
    public decimal? AuthorizedAmount { get; set; }
    public string? RequestStatus { get; set; }
    public DateTime? DateSubmitted { get; set; }
    public DateTime? DateAuthorized { get; set; }
    public DateTime? DateWorkStarted { get; set; }
    public DateTime? DateWorkCompleted { get; set; }
    public DateTime? DateWorkCancelled { get; set; }
    public DateTime LastSyncedAt { get; set; }
}

public class Study : IHasModifiedBy
{
    public int Id { get; set; }
    public string ZapNumber { get; set; } = string.Empty;
    public string? Title { get; set; }
    public int InvestigatorId { get; set; }
    public Investigator? Investigator { get; set; }
    public int? PathologistUserId { get; set; }
    public string? AcucProtocol { get; set; }
    public DateOnly? AcucStartDate { get; set; }
    public DateOnly? AcucEndDate { get; set; }
    public string? Remarks { get; set; }
    public bool IsObsolete { get; set; }
    public bool IsLegacy { get; set; }
    public string ModifiedBy { get; set; } = string.Empty;
    public int? NecropsyProtocolId { get; set; }    // the study's necropsy protocol (Zaphod tblStudies.NecropsyProtocolID)
    public List<StudyGroup> Groups { get; set; } = new();
}

public class StudyGroup
{
    public int Id { get; set; }
    public int StudyId { get; set; }
    public string GroupCode { get; set; } = string.Empty;
    public string? Name { get; set; }
    public string? Sex { get; set; }        // M, F, U
    public string? Genotype { get; set; }
    public string? Treatment { get; set; }
}

public class Request : IHasModifiedBy
{
    public int Id { get; set; }
    public string RequestNumber { get; set; } = string.Empty;
    public string LabCode { get; set; } = "HP";
    public string RequestTypeCode { get; set; } = string.Empty;
    public int InvestigatorId { get; set; }
    public Investigator? Investigator { get; set; }
    public int? ProjectId { get; set; }
    public Project? Project { get; set; }
    public int? NasRequestId { get; set; }
    public NasRequest? NasRequest { get; set; }
    public int? StudyId { get; set; }
    public Study? Study { get; set; }
    public RequestStatus Status { get; set; } = RequestStatus.Open;
    public RequestChargeType ChargeType { get; set; } = RequestChargeType.Charge;
    public string DefaultPriorityCode { get; set; } = "R";
    public DateOnly ReceivedDate { get; set; }
    public DateOnly? DueDate { get; set; }
    public DateOnly? CompletedDate { get; set; }
    public string? Description { get; set; }
    public string? SpeciesCode { get; set; }
    public string? FixativeCode { get; set; }
    public int? AssignedPathologistUserId { get; set; }
    public string? TissueDisposition { get; set; }
    public bool IsLegacy { get; set; }
    public string ModifiedBy { get; set; } = string.Empty;
    public byte[]? RowVer { get; set; }

    public List<Subject> Subjects { get; set; } = new();
    public List<RequestArea> Areas { get; set; } = new();

    /// <summary>
    /// Completes the request. Same rules as PHL: the date may not precede receipt or be in the
    /// future, and every non-cancelled subject must have reached a final work area
    /// (QC-PA, ARCHV or INVES in the seed data).
    /// </summary>
    public void Complete(DateOnly completedDate, DateOnly today, IEnumerable<SubjectLocation> subjectLocations, IReadOnlySet<string> terminalAreaCodes)
    {
        if (Status != RequestStatus.Open)
            throw new DomainException($"Request {RequestNumber} is {Status}; only open requests can be completed.");
        if (completedDate < ReceivedDate)
            throw new DomainException($"The completion date {completedDate:yyyy-MM-dd} is before the received date {ReceivedDate:yyyy-MM-dd}.");
        if (completedDate > today)
            throw new DomainException("The completion date cannot be in the future.");

        var unfinished = CompletionRule.Unfinished(subjectLocations, terminalAreaCodes);
        if (unfinished.Count > 0)
        {
            var shown = string.Join(", ", unfinished.Take(10));
            var more = unfinished.Count > 10 ? $" and {unfinished.Count - 10} more" : string.Empty;
            throw new DomainException($"Request {RequestNumber} cannot be completed: {shown}{more} not yet at a final area.");
        }

        Status = RequestStatus.Complete;
        CompletedDate = completedDate;
    }
}

public class RequestArea
{
    public int RequestId { get; set; }
    public string AreaCode { get; set; } = string.Empty;
}

/// <summary>Where a subject currently is, for the completion check.</summary>
public sealed record SubjectLocation(string PhlNumber, string? CurrentAreaCode, bool IsCancelled = false);

public static class CompletionRule
{
    /// <returns>PHL numbers of non-cancelled subjects that are not yet in a terminal area.</returns>
    public static IReadOnlyList<string> Unfinished(IEnumerable<SubjectLocation> locations, IReadOnlySet<string> terminalAreaCodes) =>
        locations
            .Where(l => !l.IsCancelled && (l.CurrentAreaCode is null || !terminalAreaCodes.Contains(l.CurrentAreaCode)))
            .Select(l => l.PhlNumber)
            .OrderBy(p => p, StringComparer.Ordinal)
            .ToList();
}

/// <summary>
/// A source of tissue: a mouse, a coded human donor, a PDX model or an organoid line.
/// No direct human identifiers are stored; ExternalSourceId holds a coded ID only.
/// </summary>
public class Subject : IHasModifiedBy
{
    public int Id { get; set; }
    public string PhlNumber { get; set; } = string.Empty;
    public string SubjectTypeCode { get; set; } = "MOUSE";
    public int RequestId { get; set; }
    public Request? Request { get; set; }
    public int? StudyId { get; set; }
    public int? GroupId { get; set; }
    public string? AnimalNumber { get; set; }
    public string? AltId { get; set; }
    public string? ExternalSourceId { get; set; }
    public string? SpeciesCode { get; set; }
    public string? Sex { get; set; }            // M, F, U
    public string? Genotype { get; set; }
    public DateOnly? BirthDate { get; set; }
    public DateOnly? DeathDate { get; set; }
    public string PriorityCode { get; set; } = "R";   // R, P, S
    public int? ParentSubjectId { get; set; }
    public int? PassageNumber { get; set; }
    public string? HostStrain { get; set; }
    public SubjectStatus Status { get; set; } = SubjectStatus.Active;
    public bool IsLegacy { get; set; }
    public string ModifiedBy { get; set; } = string.Empty;
    public byte[]? RowVer { get; set; }

    public bool IsStat => PriorityCode == "S";
}

public class Specimen
{
    public int Id { get; set; }
    public int SubjectId { get; set; }
    public string SpecimenTypeCode { get; set; } = "TISSUE";
    public string? OrganOrSite { get; set; }
    public int? ParentSpecimenId { get; set; }
    public string? Barcode { get; set; }
    public string? StorageLocation { get; set; }
    public DateTime? CollectedAt { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class Block
{
    public int Id { get; set; }
    public int SubjectId { get; set; }
    public int? SpecimenId { get; set; }
    public string BlockCode { get; set; } = string.Empty;
    public string Barcode { get; set; } = string.Empty;
    public string? MediumCode { get; set; }
    public string? Description { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class Slide
{
    public int Id { get; set; }
    public int SubjectId { get; set; }
    public int? BlockId { get; set; }
    public int SlideNumber { get; set; }
    public string Barcode { get; set; } = string.Empty;
    public string? StainOrAssay { get; set; }
    public DateTime CreatedAt { get; set; }
}
