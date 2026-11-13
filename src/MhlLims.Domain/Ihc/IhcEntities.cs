using MhlLims.Domain.Common;

namespace MhlLims.Domain.Ihc;

// Entities for db/060_ihc.sql: the IHC assay catalog and IHC requests from the investigator form
// (replacing phlrequest.ncifcrf.gov). Enum values map to the upper snake case codes in the CHECK
// constraints (BetaGal -> BETA_GAL, DilutionRecovered -> DILUTION_RECOVERED).

public enum AssayKind { Ihc, Opal, If, Tunel, BetaGal }

public enum AssayStatus { Active, Duplicate, Retired }

public enum AssayFlagCode { DilutionRecovered, NameRecovered, Duplicate, SpeciesBlank, SpeciesUnrecognized, DoubleIncomplete, DoubleSame, RetrievalBlank }

public enum IhcRequestStatus { Submitted, Accepted, Declined }

public enum IhcImportance { Routine, Stat }

/// <summary>FIXED = tissue in fixative, FROZEN = frozen tissue, BLOCK = paraffin block, SLIDES = unstained slides.</summary>
public enum SampleType { Fixed, Frozen, Block, Slides }

/// <summary>One validated protocol: antibody, dilution, retrieval, detection, controls.</summary>
/// <summary>Public: investigators can request it. Internal: MHL staff only.</summary>
public enum AssayVisibility { Public, Internal }

/// <summary>Whether the protocol works, as recorded by the IHC team.</summary>
public enum AssayResult { Works, Optimizing, Failed }

public class Assay : IHasModifiedBy
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Dilution { get; set; }
    public string? AntigenRetrieval { get; set; }
    public string? ProteolyticDigestion { get; set; }
    public string? DetectionKit { get; set; }
    public string? Fixative { get; set; }
    public string? Species { get; set; }
    public string? ControlTissue { get; set; }
    public string? Manufacturer { get; set; }
    public string? CatalogNumber { get; set; }

    // Added in the LIMS at the IHC department's request (the IHC database export has no columns for them).
    public string? Clone { get; set; }               // "N/A" for a polyclonal antibody or a kit
    public string? Host { get; set; }                // Rabbit, Mouse, ... or "Not applicable"
    public string? Clonality { get; set; }           // Monoclonal, Polyclonal, Not applicable
    public string? PlatformSet { get; set; }         // set by hand; null = worked out from the text
    public string? ChromogenSet { get; set; }        // set by hand; null = worked out from the text
    public AssayVisibility Visibility { get; set; } = AssayVisibility.Public;
    public bool IsPreferred { get; set; }
    public AssayResult? Result { get; set; }         // null = not recorded

    // Derived from the text fields (and PlatformSet / ChromogenSet) by IhcCatalogRules.Derive; stored so they can be queried.
    public AssayKind Kind { get; set; } = AssayKind.Ihc;
    public int Plex { get; set; } = 1;
    public string Chromogen { get; set; } = "DAB";
    public string Platform { get; set; } = "Manual";

    public AssayStatus Status { get; set; } = AssayStatus.Active;
    public int? DuplicateOfAssayId { get; set; }
    public string? Notes { get; set; }
    public string? SourceReference { get; set; }
    public string? LegacyAssayKey { get; set; }
    public string ModifiedBy { get; set; } = string.Empty;

    public List<AssayComponent> Components { get; set; } = new();
    public List<AssaySpeciesTag> SpeciesTags { get; set; } = new();
    public List<AssayFixativeTag> FixativeTags { get; set; } = new();
    public List<AssayFlag> Flags { get; set; } = new();

    public bool IsDoubleStain => Components.Count > 0;
    public bool NeedsChecking => Flags.Any(f => f.ClearedAt is null && f.FlagCode != AssayFlagCode.Duplicate);
}

public class AssayComponent
{
    public int AssayId { get; set; }
    public int ComponentAssayId { get; set; }
    public int StainOrder { get; set; }
}

public class AssaySpeciesTag
{
    public int AssayId { get; set; }
    public string Tag { get; set; } = string.Empty;
}

public class AssayFixativeTag
{
    public int AssayId { get; set; }
    public string Tag { get; set; } = string.Empty;
}

public class AssayFlag
{
    public int Id { get; set; }
    public int AssayId { get; set; }
    public AssayFlagCode FlagCode { get; set; }
    public string? StoredValue { get; set; }
    public DateTime RaisedAt { get; set; }
    public DateTime? ClearedAt { get; set; }
    public string? ClearedBy { get; set; }
}

/// <summary>An IHC request from the investigator form (MH26-0151). Accepting it creates a LIMS request.</summary>
public class IhcRequest : IHasModifiedBy
{
    public int Id { get; set; }
    public string RequestNumber { get; set; } = string.Empty;
    public IhcRequestStatus Status { get; set; } = IhcRequestStatus.Submitted;
    public DateTime SubmittedAt { get; set; }
    public string? SubmittedByAccount { get; set; }

    // 1. requester
    public int? InvestigatorId { get; set; }
    public string RequesterLastName { get; set; } = string.Empty;
    public string? RequesterFirstName { get; set; }
    public string? RequesterInstitute { get; set; }
    public string? BuildingRoom { get; set; }
    public string? Phone { get; set; }
    public string Email { get; set; } = string.Empty;
    public string BillTo { get; set; } = string.Empty;
    public string CostpointProjectId { get; set; } = string.Empty;
    public string? AcucProtocol { get; set; }
    public int? PathologistUserId { get; set; }
    public IhcImportance Importance { get; set; } = IhcImportance.Routine;

    // 2. material
    public string SpeciesChoice { get; set; } = "Mouse";        // Mouse, Rat, Human, PDX, Organoid, Canine, Other
    public string FixativeUsed { get; set; } = "10% NBF";
    public string? FixativeSubmittedIn { get; set; }
    public DateOnly? DateIntoFixative { get; set; }

    // 4. general procedures (0 = none)
    public int HeSlidesPerBlock { get; set; }
    public int UnstainedSlidesPerBlock { get; set; }

    // 6. imaging, 7. additional information
    public bool Scan20x { get; set; }
    public bool Scan40x { get; set; }
    public string? AdditionalInformation { get; set; }
    public int? CopiedFromIhcRequestId { get; set; }

    // review
    public int? LimsRequestId { get; set; }
    public int? AcceptedByUserId { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public int? DeclinedByUserId { get; set; }
    public DateTime? DeclinedAt { get; set; }
    public string? DeclineReason { get; set; }
    public string? LegacyWebId { get; set; }
    public string ModifiedBy { get; set; } = string.Empty;
    public byte[]? RowVer { get; set; }

    public List<IhcRequestSample> Samples { get; set; } = new();
    public List<IhcRequestStain> Stains { get; set; } = new();

    /// <summary>The IHC team accepts the request once the LIMS request and its PHL numbers exist.</summary>
    public void Accept(int limsRequestId, int userId, DateTime utcNow)
    {
        if (Status != IhcRequestStatus.Submitted)
            throw new DomainException($"{RequestNumber} is {Status.ToString().ToLowerInvariant()}; only submitted requests can be accepted.");
        Status = IhcRequestStatus.Accepted;
        LimsRequestId = limsRequestId;
        AcceptedByUserId = userId;
        AcceptedAt = utcNow;
    }

    public void Decline(string reason, int userId, DateTime utcNow)
    {
        if (Status != IhcRequestStatus.Submitted)
            throw new DomainException($"{RequestNumber} is {Status.ToString().ToLowerInvariant()}; only submitted requests can be declined.");
        if (string.IsNullOrWhiteSpace(reason)) throw new DomainException("Give the investigator a reason.");
        Status = IhcRequestStatus.Declined;
        DeclineReason = reason.Trim();
        DeclinedByUserId = userId;
        DeclinedAt = utcNow;
    }
}

public class IhcRequestSample
{
    public int Id { get; set; }
    public int IhcRequestId { get; set; }
    public int SampleNumber { get; set; }
    public string Tissue { get; set; } = string.Empty;
    public string? AnimalOrBlockNo { get; set; }
    public SampleType SampleType { get; set; } = SampleType.Fixed;
    public int? SubjectId { get; set; }          // the PHL number issued on accept
    public int? SourceSubjectId { get; set; }    // the existing PHL number, when the block is already at MHL
}

public class IhcRequestStain
{
    public int Id { get; set; }
    public int IhcRequestId { get; set; }
    public int StainNumber { get; set; }
    public int? AssayId { get; set; }
    public string Chromogen { get; set; } = "DAB";
    public string? ProtocolSnapshotJson { get; set; }    // the assay as it was when the request was submitted
    public string? NewAntibodyName { get; set; }
    public string? NewAntibodyManufacturer { get; set; }
    public string? NewAntibodyCatalog { get; set; }
    public string? NewAntibodyHost { get; set; }
    public bool RequesterSuppliesAntibody { get; set; }
    public string? NewAntibodyNotes { get; set; }
}
