using MhlLims.Domain.Billing;
using MhlLims.Domain.Common;

namespace MhlLims.Domain.Pathology;

/// <summary>A gross finding from the approved necropsy, as the sign-out check needs it.</summary>
public sealed record GrossFindingRef(int Id, string Organ);

/// <summary>
/// Looks up diagnosis terms. Built from ref.Diagnosis in production; <see cref="Starter"/> holds the pilot's
/// starter list in INHAND style (db/120_seed_pathology_dictionary.sql is generated from the same list).
/// </summary>
public sealed class DiagnosisDictionary
{
    public sealed record Entry(string Term, bool IsNeoplasm, IReadOnlyList<string> Organs)   // Organs empty = any tissue
    {
        public bool IsGeneral => Organs.Count == 0;
    }

    private readonly List<Entry> _entries;
    private readonly Dictionary<string, Entry> _byTerm;

    public DiagnosisDictionary(IEnumerable<Entry> entries)
    {
        _entries = entries.ToList();
        _byTerm = new Dictionary<string, Entry>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in _entries) _byTerm.TryAdd(e.Term, e);
    }

    public static DiagnosisDictionary FromTerms(IEnumerable<DiagnosisTerm> terms) =>
        new(terms.Where(t => t.IsActive).Select(t => new Entry(t.Term, t.IsNeoplasm, t.IsGeneral ? [] : t.Organs.Select(o => o.OrganCode).ToList())));

    public Entry? Find(string? term) => term is not null && _byTerm.TryGetValue(term.Trim(), out var e) ? e : null;

    /// <summary>Terms offered for a tissue: that organ's own terms first, then the general ones.</summary>
    public IReadOnlyList<Entry> For(string organ)
    {
        var own = _entries.Where(e => e.Organs.Contains(organ)).ToList();
        return [.. own, .. _entries.Where(e => e.IsGeneral && !own.Contains(e))];
    }

    private static Entry D(string term, params string[] organs) => new(term, false, organs);
    private static Entry N(string term, params string[] organs) => new(term, true, organs);

    /// <summary>The pilot's starter list (PLACEHOLDER until Zaphod's tblDiagnosis is migrated; open question 21).</summary>
    public static DiagnosisDictionary Starter { get; } = new(
    [
        D("Inflammation"), D("Inflammation, acute"), D("Inflammation, chronic"), D("Inflammation, granulomatous"),
        D("Infiltrate, mononuclear cell"), D("Infiltrate, neutrophilic"), D("Necrosis"), D("Hemorrhage"), D("Fibrosis"),
        D("Mineralization"), D("Edema"), D("Congestion"), D("Thrombus"), D("Atrophy"), D("Hyperplasia"),
        D("Degeneration"), D("Cyst"), D("Abscess"), D("Pigment"), D("Autolysis"), D("Angiectasis"),
        N("Lymphoma, malignant"), N("Histiocytic sarcoma"), N("Hemangiosarcoma"), N("Hemangioma"), N("Leukemia"), N("Neoplasm, metastatic"),
        D("Hyperplasia, bronchiolo-alveolar", "Lungs"), N("Adenoma, bronchiolo-alveolar", "Lungs"), N("Carcinoma, bronchiolo-alveolar", "Lungs"),
        D("Accumulation, alveolar macrophage", "Lungs"), D("Infiltrate, perivascular, mononuclear cell", "Lungs"), D("Hemorrhage, alveolar", "Lungs"),
        D("Vacuolation, hepatocellular", "Liver"), D("Hypertrophy, hepatocellular", "Liver"), D("Hematopoiesis, extramedullary", "Liver", "Spleen"),
        D("Necrosis, hepatocellular", "Liver"), D("Focus of cellular alteration, basophilic", "Liver"), D("Focus of cellular alteration, eosinophilic", "Liver"),
        D("Focus of cellular alteration, clear cell", "Liver"), N("Adenoma, hepatocellular", "Liver"), N("Carcinoma, hepatocellular", "Liver"),
        N("Hepatoblastoma", "Liver"), N("Cholangiocarcinoma", "Liver"),
        D("Hematopoiesis, extramedullary, increased", "Spleen"), D("Hyperplasia, lymphoid", "Spleen", "Lymph nodes", "Thymus"),
        D("Depletion, lymphoid", "Spleen", "Lymph nodes", "Thymus"), D("Pigment, hemosiderin", "Spleen", "Liver", "Lungs"),
        D("Nephropathy, chronic progressive", "Kidneys"), D("Basophilia, tubular", "Kidneys"), D("Dilation, tubular", "Kidneys"), D("Hydronephrosis", "Kidneys"),
        D("Cast, hyaline", "Kidneys"), D("Glomerulopathy", "Kidneys"), N("Adenoma, renal tubule", "Kidneys"), N("Carcinoma, renal tubule", "Kidneys"),
        D("Cardiomyopathy", "Heart"), D("Mineralization, epicardial", "Heart"), D("Thrombus, atrial", "Heart"),
        D("Gliosis", "Brain", "Spinal cord"), D("Hydrocephalus", "Brain"), D("Vacuolation, neuropil", "Brain", "Spinal cord"), N("Glioma, malignant", "Brain"),
        N("Thymoma", "Thymus"), D("Plasmacytosis", "Lymph nodes"), D("Histiocytosis, sinus", "Lymph nodes"),
        D("Hyperplasia, squamous cell", "Stomach", "Esophagus", "Skin"), N("Papilloma, squamous cell", "Stomach", "Esophagus", "Skin"),
        N("Carcinoma, squamous cell", "Stomach", "Esophagus", "Skin", "Tumor"), D("Erosion", "Stomach", "Small intestine", "Large intestine", "Skin"),
        D("Ulcer", "Stomach", "Small intestine", "Large intestine", "Skin"),
        D("Hyperplasia, epithelial", "Small intestine", "Large intestine", "Cecum"), N("Adenoma", "Small intestine", "Large intestine", "Cecum", "Mammary gland", "Pituitary gland"),
        N("Adenocarcinoma", "Small intestine", "Large intestine", "Cecum", "Mammary gland", "Uterus", "Tumor"),
        D("Hyperkeratosis", "Skin"), D("Hyperplasia, alveolar", "Mammary gland"),
        D("Atrophy, acinar", "Pancreas"), D("Hyperplasia, islet cell", "Pancreas"), N("Adenoma, islet cell", "Pancreas"), N("Carcinoma, acinar cell", "Pancreas"),
        D("Hyperplasia, subcapsular cell", "Adrenal glands"), D("Vacuolation, cortical", "Adrenal glands"), N("Adenoma, cortical", "Adrenal glands"),
        N("Pheochromocytoma, benign", "Adrenal glands"), N("Pheochromocytoma, malignant", "Adrenal glands"),
        D("Hypercellularity, bone marrow", "Femur and bone marrow", "Sternum"), D("Hypocellularity, bone marrow", "Femur and bone marrow", "Sternum"),
        D("Hyperostosis", "Femur and bone marrow", "Sternum"), N("Osteosarcoma", "Femur and bone marrow", "Sternum", "Tumor"),
        D("Degeneration, germ cell", "Testes"), D("Atrophy, seminiferous tubule", "Testes"), D("Hypospermia", "Epididymides"),
        N("Granulosa cell tumor", "Ovaries"), D("Hyperplasia, endometrial, cystic", "Uterus"), D("Hyperplasia, urothelial", "Urinary bladder"),
        N("Carcinoma, urothelial", "Urinary bladder"), D("Degeneration, myofiber", "Skeletal muscle"), D("Regeneration, myofiber", "Skeletal muscle"),
        N("Adenoma, Harderian gland", "Harderian glands"), N("Adenoma, follicular cell", "Thyroid glands"),
        N("Carcinoma", "Tumor"), N("Sarcoma", "Tumor"), N("Melanoma, malignant", "Tumor", "Skin"), N("Neuroblastoma", "Tumor"),
        D("Necrosis, tumor", "Tumor"), D("Invasion, local", "Tumor"),
    ]);
}

/// <summary>
/// How a diagnosis reads, how many slides a case read, what must be done before sign-out, and the charges a
/// sign-out creates. A port of pilot/core/pathology.mjs.
/// </summary>
public static class PathologyRules
{
    public static readonly IReadOnlyList<(string Code, string Word)> Severity =
        [("1", "Minimal"), ("2", "Mild"), ("3", "Moderate"), ("4", "Marked"), ("5", "Severe"), ("P", "Present (not graded)")];

    public static string GradeWord(string? severity) => Severity.FirstOrDefault(s => s.Code == severity).Word ?? string.Empty;

    /// <summary>"Vacuolation, hepatocellular, centrilobular, diffuse, mild (2)"; "Adenoma, bronchiolo-alveolar, left [benign]".</summary>
    public static string DiagnosisText(PathologyDiagnosis dx)
    {
        var parts = new[] { dx.Term, dx.Modifier, dx.Distribution?.ToLowerInvariant(), dx.Laterality?.ToLowerInvariant() }.Where(p => !string.IsNullOrEmpty(p));
        var tail = string.Empty;
        if (dx.IsNeoplasm)
        {
            var tags = new[] { dx.Behavior?.ToString().ToLowerInvariant(), dx.Origin == NeoplasmOrigin.Metastatic ? "metastatic" : null }.Where(t => t is not null).ToList();
            if (tags.Count > 0) tail = $" [{string.Join(", ", tags)}]";
        }
        else if (!string.IsNullOrEmpty(dx.Severity))
            tail = dx.Severity == "P" ? ", present" : $", {GradeWord(dx.Severity).ToLowerInvariant()} ({dx.Severity})";
        return string.Join(", ", parts) + tail;
    }

    /// <summary>Short code for the individual animal table: 1-5, P, B (benign), M (malignant), U; "m" marks metastatic.</summary>
    public static string Mark(PathologyDiagnosis dx) => dx.IsNeoplasm
        ? (dx.Behavior switch { NeoplasmBehavior.Malignant => "M", NeoplasmBehavior.Benign => "B", _ => "U" }) + (dx.Origin == NeoplasmOrigin.Metastatic ? "m" : string.Empty)
        : string.IsNullOrEmpty(dx.Severity) ? "+" : dx.Severity;

    public static bool IsRead(PathologyTissue t) => t.Result is TissueResult.Nsl or TissueResult.Lesions;

    /// <summary>One glass slide per block read; tissues without a block count as a slide each.</summary>
    public static int SlidesRead(PathologyCase c)
    {
        var blocks = new HashSet<string>();
        var loose = 0;
        foreach (var t in c.Tissues.Where(IsRead))
            if (!string.IsNullOrEmpty(t.BlockCode)) blocks.Add(t.BlockCode); else loose++;
        return blocks.Count + loose;
    }

    /// <summary>Everything that must be true before the case can be signed out (empty when it is ready).</summary>
    public static IReadOnlyList<string> SignOutProblems(PathologyCase c, IReadOnlyList<GrossFindingRef> grossFindings, bool needCauseOfDeath)
    {
        var p = new List<string>();
        var tissues = c.TissuesInOrder.ToList();
        if (tissues.Count == 0) p.Add("add at least one tissue");
        var pending = tissues.Where(t => t.Result == TissueResult.Pending).Select(t => t.OrganCode).ToList();
        if (pending.Count > 0) p.Add($"give a result for {string.Join(", ", pending)}");
        var lesionNoDx = tissues.Where(t => t.Result == TissueResult.Lesions && t.Diagnoses.Count == 0).Select(t => t.OrganCode).ToList();
        if (lesionNoDx.Count > 0) p.Add($"add a diagnosis for {string.Join(", ", lesionNoDx)} or change the result");
        foreach (var t in tissues)
            foreach (var dx in t.DiagnosesInOrder)
            {
                if (string.IsNullOrEmpty(dx.Term)) p.Add($"choose the diagnosis in {t.OrganCode}");
                else if (dx.IsNeoplasm && dx.Behavior is null) p.Add($"say whether {dx.Term} in {t.OrganCode} is benign or malignant");
                else if (!dx.IsNeoplasm && string.IsNullOrEmpty(dx.Severity)) p.Add($"grade {dx.Term} in {t.OrganCode}");
            }
        if (!tissues.Any(IsRead)) p.Add("read at least one tissue");
        var correlated = tissues.SelectMany(t => t.Diagnoses).SelectMany(d => d.Correlations).Select(x => x.NecropsyFindingId).ToHashSet();
        var noCorrelate = c.NoCorrelate.Select(x => x.NecropsyFindingId).ToHashSet();
        var open = grossFindings.Where(g => !correlated.Contains(g.Id) && !noCorrelate.Contains(g.Id)).ToList();
        if (open.Count > 0)
            p.Add($"correlate {(open.Count == 1 ? "the gross finding" : $"{open.Count} gross findings")} ({string.Join(", ", open.Select(g => g.Organ))}) with a diagnosis, or mark no microscopic correlate");
        if (needCauseOfDeath && c.CauseOfDeathKind is null) p.Add("record the cause of death (the animal was found dead or euthanized moribund)");
        if (c.CauseOfDeathKind == CauseOfDeathKind.Diagnosis && c.CauseOfDeathDiagnosisEntryId is null) p.Add("choose the diagnosis that caused death");
        if (c.ExtraQuarterHours > 0 && string.IsNullOrWhiteSpace(c.ExtraTimeNote)) p.Add("describe the additional pathologist time");
        return p;
    }

    /// <summary>
    /// Charges a sign-out creates: PA001002 per glass slide read and PA001004 per quarter hour of extra pathologist
    /// time. After an amendment only what goes beyond what was already billed (released, plus adjustments) is charged.
    /// </summary>
    public static IReadOnlyList<PlannedCharge> SignOutCharges(int slides, int extraQuarterHours, string? extraTimeNote, decimal billedSlides, decimal billedQuarterHours, int version)
    {
        var output = new List<PlannedCharge>();
        var s = slides - billedSlides;
        if (s > 0) output.Add(new PlannedCharge("PATH", "PA001002", s, $"Pathology, {slides} slide{(slides == 1 ? "" : "s")} read{(version > 1 ? $" (amended report v{version})" : "")}"));
        var t = extraQuarterHours - billedQuarterHours;
        if (t > 0) output.Add(new PlannedCharge("PATH", "PA001004", t, extraTimeNote ?? string.Empty));
        return output;
    }

    /// <summary>Whether the cause of death must be recorded: the animal was found dead or euthanized moribund.</summary>
    public static bool NeedsCauseOfDeath(Necropsy? necropsy) =>
        necropsy is { Status: NecropsyStatus.Approved } && necropsy.Fate is "Found dead" or "Moribund euthanasia";

    /// <summary>The approved necropsy's gross findings, for correlation.</summary>
    public static IReadOnlyList<GrossFindingRef> GrossFindings(Necropsy? necropsy) =>
        necropsy is { Status: NecropsyStatus.Approved }
            ? necropsy.Organs.OrderBy(o => o.Sequence).SelectMany(o => o.Findings.Select(f => new GrossFindingRef(f.Id, o.OrganCode))).ToList()
            : [];

    // ---------- sign-out and amendment ----------

    /// <summary>
    /// Signs the case out: checks it, locks it and freezes the report as a new version. The caller prices the
    /// charges from <see cref="SignOutCharges"/> and moves the subject on.
    /// </summary>
    public static void SignOut(PathologyCase c, IReadOnlyList<GrossFindingRef> grossFindings, bool needCauseOfDeath, int userId, DateTime utcNow, string reportJson)
    {
        if (c.Status == PathologyCaseStatus.Signed) throw new DomainException("This report is already signed out.");
        var problems = SignOutProblems(c, grossFindings, needCauseOfDeath);
        if (problems.Count > 0) throw new DomainException($"Before signing out: {string.Join("; ", problems)}.");
        c.Status = PathologyCaseStatus.Signed;
        c.SignedByUserId = userId;
        c.SignedAt = utcNow;
        c.ReportVersions.Add(new PathologyReportVersion { PathologyCaseId = c.Id, Version = c.Version, SignedByUserId = userId, SignedAt = utcNow, ReportJson = reportJson });
    }

    /// <summary>
    /// Reopens a signed-out report for amendment. Needs a reason, which is printed on the amended report. Pending
    /// and approved charges from the sign-out are voided; released ones stay, and the next sign-out bills only the difference.
    /// </summary>
    public static void Amend(PathologyCase c, string reason, int userId, DateTime utcNow, IEnumerable<ChargeLine> signOutCharges)
    {
        if (c.Status != PathologyCaseStatus.Signed) throw new DomainException("Only a signed-out report can be amended.");
        if (string.IsNullOrWhiteSpace(reason)) throw new DomainException("Give a reason for amending the report. It appears on the amended report.");
        foreach (var ch in signOutCharges.Where(x => x.Status is ChargeLineStatus.Pending or ChargeLineStatus.Approved)) ch.Void();
        c.Status = PathologyCaseStatus.Draft;
        c.Version += 1;
        c.SignedByUserId = null;
        c.SignedAt = null;
        c.Amendments.Add(new PathologyAmendment { PathologyCaseId = c.Id, Version = c.Version, AmendedByUserId = userId, AmendedAt = utcNow, Reason = reason.Trim() });
    }

    /// <summary>A signed-out case cannot change until it is amended.</summary>
    public static void EnsureEditable(PathologyCase c)
    {
        if (c.Status == PathologyCaseStatus.Signed) throw new DomainException("This report is signed out. Amend it (with a reason) before editing.");
    }
}
