using MhlLims.Domain.Common;

namespace MhlLims.Domain.Pathology;

// Entities for the pathology half of db/070_necropsy_and_pathology.sql (Zaphod tblPathologyHeaders,
// tblPathologyOrgans, tblPathologyDiagnoses, tblPathologyCorrelation) and the dictionaries it uses.

public enum PathologyCaseStatus { Draft, Signed }

/// <summary>PENDING = not read yet, NSL = no significant lesions, LESIONS, NOT_EXAMINED, NOT_PRESENT (tissue missing).</summary>
public enum TissueResult { Pending, Nsl, Lesions, NotExamined, NotPresent }

public enum NeoplasmBehavior { Benign, Malignant, Uncertain }

public enum NeoplasmOrigin { Primary, Metastatic }

public enum CauseOfDeathKind { NotApplicable, Undetermined, Diagnosis }

/// <summary>One pathology case per PHL number. Signed out = locked; amendments create the next version.</summary>
public class PathologyCase : IHasModifiedBy
{
    public int Id { get; set; }
    public int SubjectId { get; set; }
    public PathologyCaseStatus Status { get; set; } = PathologyCaseStatus.Draft;
    public int Version { get; set; } = 1;
    public int? PathologistUserId { get; set; }
    public int? AssignedToUserId { get; set; }
    public CauseOfDeathKind? CauseOfDeathKind { get; set; }
    public int? CauseOfDeathDiagnosisEntryId { get; set; }
    public string? CauseOfDeathComment { get; set; }
    public string? PathologistComment { get; set; }
    public int ExtraQuarterHours { get; set; }
    public string? ExtraTimeNote { get; set; }
    public DateTime? StartedAt { get; set; }
    public int? SignedByUserId { get; set; }
    public DateTime? SignedAt { get; set; }
    public string ModifiedBy { get; set; } = string.Empty;
    public byte[]? RowVer { get; set; }

    public List<PathologyTissue> Tissues { get; set; } = new();
    public List<GrossNoCorrelate> NoCorrelate { get; set; } = new();
    public List<PathologyReportVersion> ReportVersions { get; set; } = new();
    public List<PathologyAmendment> Amendments { get; set; } = new();

    public IEnumerable<PathologyTissue> TissuesInOrder => Tissues.OrderBy(t => t.Sequence);
}

public class PathologyTissue
{
    public int Id { get; set; }
    public int PathologyCaseId { get; set; }
    public int Sequence { get; set; }
    public string OrganCode { get; set; } = string.Empty;
    public string? BlockCode { get; set; }
    public int? NecropsyOrganId { get; set; }
    public TissueResult Result { get; set; } = TissueResult.Pending;
    public string? Comment { get; set; }
    public bool RecutRequested { get; set; }
    public string? RecutNote { get; set; }
    public List<PathologyDiagnosis> Diagnoses { get; set; } = new();

    public IEnumerable<PathologyDiagnosis> DiagnosesInOrder => Diagnoses.OrderBy(d => d.Sequence);
}

/// <summary>A microscopic diagnosis on one tissue. The term is stored as recorded, so the report never changes if the dictionary does.</summary>
public class PathologyDiagnosis
{
    public int Id { get; set; }                      // DiagnosisEntryId
    public int PathologyTissueId { get; set; }
    public int Sequence { get; set; }
    public int? DiagnosisId { get; set; }            // ref.Diagnosis; null when the term is not in the dictionary
    public string Term { get; set; } = string.Empty;
    public bool IsNeoplasm { get; set; }
    public string? Modifier { get; set; }
    public string? Distribution { get; set; }
    public string? Laterality { get; set; }
    public string? Severity { get; set; }            // "1".."5" (minimal to severe) or "P" (present, not graded)
    public NeoplasmBehavior? Behavior { get; set; }
    public NeoplasmOrigin? Origin { get; set; }
    public string? Comment { get; set; }
    public List<PathologyCorrelation> Correlations { get; set; } = new();
}

/// <summary>A gross finding (from the necropsy) explained by a microscopic diagnosis.</summary>
public class PathologyCorrelation
{
    public int DiagnosisEntryId { get; set; }
    public int NecropsyFindingId { get; set; }
}

/// <summary>A gross finding the pathologist marked as having no microscopic correlate.</summary>
public class GrossNoCorrelate
{
    public int PathologyCaseId { get; set; }
    public int NecropsyFindingId { get; set; }
}

/// <summary>A signed-out report as it was signed; never changed (enforced by a trigger).</summary>
public class PathologyReportVersion
{
    public int PathologyCaseId { get; set; }
    public int Version { get; set; }
    public int SignedByUserId { get; set; }
    public DateTime SignedAt { get; set; }
    public string ReportJson { get; set; } = "{}";
}

public class PathologyAmendment
{
    public int PathologyCaseId { get; set; }
    public int Version { get; set; }
    public int AmendedByUserId { get; set; }
    public DateTime AmendedAt { get; set; }
    public string Reason { get; set; } = string.Empty;
}

// ---------- dictionaries (ref schema) ----------

public class Organ
{
    public string Code { get; set; } = string.Empty;   // OrganCode: the name, as in Zaphod's lists
    public bool IsPaired { get; set; }
    public int SortOrder { get; set; }
    public int? LegacyZaphodOrganId { get; set; }
    public bool IsActive { get; set; } = true;
}

public class DiagnosisTerm
{
    public int Id { get; set; }
    public string Term { get; set; } = string.Empty;
    public bool IsNeoplasm { get; set; }
    public bool IsGeneral { get; set; }
    public string? InhandTerm { get; set; }
    public int? LegacyZaphodDiagnosisId { get; set; }
    public bool IsActive { get; set; } = true;
    public List<DiagnosisOrgan> Organs { get; set; } = new();
}

public class DiagnosisOrgan
{
    public int DiagnosisId { get; set; }
    public string OrganCode { get; set; } = string.Empty;
}

public class DictionaryTerm
{
    public string DictionaryCode { get; set; } = string.Empty;   // NECROPSY_SITE, MORPHOLOGY, ..., DISTRIBUTION, LATERALITY
    public string Term { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}
