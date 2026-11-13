using MhlLims.Domain.Pathology;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MhlLims.Infrastructure.Data.Configurations;

// Mapping for db/070_necropsy_and_pathology.sql: dictionaries (ref), necropsy and pathology (path).
// Triggers are declared so EF does not use OUTPUT without INTO on those tables.

internal sealed class OrganConfiguration : IEntityTypeConfiguration<Organ>
{
    public void Configure(EntityTypeBuilder<Organ> b)
    {
        b.ToTable("Organ", "ref");
        b.HasKey(x => x.Code);
        b.Property(x => x.Code).HasColumnName("OrganCode").HasMaxLength(40);
    }
}

internal sealed class DiagnosisTermConfiguration : IEntityTypeConfiguration<DiagnosisTerm>
{
    public void Configure(EntityTypeBuilder<DiagnosisTerm> b)
    {
        b.ToTable("Diagnosis", "ref");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("DiagnosisId");
        b.Property(x => x.Term).HasMaxLength(120).IsRequired();
        b.HasIndex(x => x.Term).IsUnique();
        b.Property(x => x.InhandTerm).HasMaxLength(200);
        b.HasMany(x => x.Organs).WithOne().HasForeignKey(o => o.DiagnosisId);
    }
}

internal sealed class DiagnosisOrganConfiguration : IEntityTypeConfiguration<DiagnosisOrgan>
{
    public void Configure(EntityTypeBuilder<DiagnosisOrgan> b)
    {
        b.ToTable("DiagnosisOrgan", "ref");
        b.HasKey(x => new { x.DiagnosisId, x.OrganCode });
        b.Property(x => x.OrganCode).HasMaxLength(40);
    }
}

internal sealed class DictionaryTermConfiguration : IEntityTypeConfiguration<DictionaryTerm>
{
    public void Configure(EntityTypeBuilder<DictionaryTerm> b)
    {
        b.ToTable("DictionaryTerm", "ref");
        b.HasKey(x => new { x.DictionaryCode, x.Term });
        b.Property(x => x.DictionaryCode).HasMaxLength(30);
        b.Property(x => x.Term).HasMaxLength(60);
    }
}

internal sealed class NecropsyProtocolConfiguration : IEntityTypeConfiguration<NecropsyProtocol>
{
    public void Configure(EntityTypeBuilder<NecropsyProtocol> b)
    {
        b.ToTable("NecropsyProtocol", "path");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("ProtocolId");
        b.Property(x => x.Name).HasMaxLength(100).IsRequired();
        b.Property(x => x.Perfusion).HasSnakeCaseNullableEnumConversion(10);
        b.Property(x => x.Instructions).HasMaxLength(2000);
        b.HasMany(x => x.Organs).WithOne().HasForeignKey(o => o.ProtocolId);
    }
}

internal sealed class NecropsyProtocolOrganConfiguration : IEntityTypeConfiguration<NecropsyProtocolOrgan>
{
    public void Configure(EntityTypeBuilder<NecropsyProtocolOrgan> b)
    {
        b.ToTable("NecropsyProtocolOrgan", "path");
        b.HasKey(x => new { x.ProtocolId, x.Sequence });
        b.Property(x => x.OrganCode).HasMaxLength(40).IsRequired();
        b.Property(x => x.DefaultBlock).HasMaxLength(12);
    }
}

internal sealed class NecropsyConfiguration : IEntityTypeConfiguration<Necropsy>
{
    public void Configure(EntityTypeBuilder<Necropsy> b)
    {
        b.ToTemporalTable("Necropsy", "path");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("NecropsyId");
        b.HasIndex(x => x.SubjectId).IsUnique();
        b.Property(x => x.Status).HasSnakeCaseEnumConversion(10);
        b.Property(x => x.ProsectorInitials).HasMaxLength(4).IsRequired();
        b.Property(x => x.Fate).HasMaxLength(60).IsRequired();
        b.Property(x => x.Condition).HasMaxLength(60);
        b.Property(x => x.PhysicalId).HasMaxLength(60);
        b.Property(x => x.BodyWeightG).HasPrecision(9, 3);
        b.Property(x => x.Perfusion).HasSnakeCaseNullableEnumConversion(10);
        b.Property(x => x.Observations).HasMaxLength(2000);
        b.Property(x => x.ModifiedBy).HasMaxLength(100);
        b.Property(x => x.RowVer).IsRowVersion();
        b.HasMany(x => x.Organs).WithOne().HasForeignKey(o => o.NecropsyId);
        b.HasMany(x => x.Procedures).WithOne().HasForeignKey(p => p.NecropsyId);
    }
}

internal sealed class NecropsyOrganConfiguration : IEntityTypeConfiguration<NecropsyOrgan>
{
    public void Configure(EntityTypeBuilder<NecropsyOrgan> b)
    {
        b.ToTable("NecropsyOrgan", "path");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("NecropsyOrganId");
        b.Property(x => x.OrganCode).HasMaxLength(40).IsRequired();
        b.Property(x => x.BlockCode).HasMaxLength(12);
        b.Property(x => x.WeightG).HasPrecision(9, 4);
        b.Property(x => x.Observations).HasMaxLength(500);
        b.HasMany(x => x.Findings).WithOne().HasForeignKey(f => f.NecropsyOrganId);
    }
}

internal sealed class NecropsyFindingConfiguration : IEntityTypeConfiguration<NecropsyFinding>
{
    public void Configure(EntityTypeBuilder<NecropsyFinding> b)
    {
        b.ToTable("NecropsyFinding", "path");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("NecropsyFindingId");
        b.Property(x => x.Site).HasMaxLength(60);
        b.Property(x => x.Morphology).HasMaxLength(60).IsRequired();
        b.Property(x => x.Shape).HasMaxLength(40);
        b.Property(x => x.Color).HasMaxLength(40);
        b.Property(x => x.Consistency).HasMaxLength(40);
        b.Property(x => x.SizeMm).HasPrecision(7, 2);
        b.Property(x => x.Notes).HasMaxLength(300);
    }
}

internal sealed class NecropsyProcedureConfiguration : IEntityTypeConfiguration<NecropsyProcedure>
{
    public void Configure(EntityTypeBuilder<NecropsyProcedure> b)
    {
        b.ToTable("NecropsyProcedure", "path");
        b.HasKey(x => new { x.NecropsyId, x.ProcedureCode });
        b.Property(x => x.ProcedureCode).HasSnakeCaseEnumConversion(30);
    }
}

internal sealed class PathologyCaseConfiguration : IEntityTypeConfiguration<PathologyCase>
{
    public void Configure(EntityTypeBuilder<PathologyCase> b)
    {
        b.ToTemporalTable("PathologyCase", "path");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("PathologyCaseId");
        b.HasIndex(x => x.SubjectId).IsUnique();
        b.Property(x => x.Status).HasSnakeCaseEnumConversion(10);
        b.Property(x => x.CauseOfDeathKind).HasSnakeCaseNullableEnumConversion(14);
        b.Property(x => x.CauseOfDeathComment).HasMaxLength(300);
        b.Property(x => x.PathologistComment).HasMaxLength(4000);
        b.Property(x => x.ExtraTimeNote).HasMaxLength(200);
        b.Property(x => x.ModifiedBy).HasMaxLength(100);
        b.Property(x => x.RowVer).IsRowVersion();     // optimistic locking, like Zaphod's LockTimeStamp
        b.Ignore(x => x.TissuesInOrder);
        b.HasMany(x => x.Tissues).WithOne().HasForeignKey(t => t.PathologyCaseId);
        b.HasMany(x => x.NoCorrelate).WithOne().HasForeignKey(n => n.PathologyCaseId);
        b.HasMany(x => x.ReportVersions).WithOne().HasForeignKey(v => v.PathologyCaseId);
        b.HasMany(x => x.Amendments).WithOne().HasForeignKey(a => a.PathologyCaseId);
        // Case -> tissue -> diagnosis plus this reference form a cycle: save the case and its diagnoses first,
        // then set the cause-of-death diagnosis in a second SaveChanges.
        b.HasOne<PathologyDiagnosis>().WithMany().HasForeignKey(x => x.CauseOfDeathDiagnosisEntryId).OnDelete(DeleteBehavior.NoAction);
    }
}

internal sealed class PathologyTissueConfiguration : IEntityTypeConfiguration<PathologyTissue>
{
    public void Configure(EntityTypeBuilder<PathologyTissue> b)
    {
        b.ToTable("PathologyTissue", "path", tb => tb.HasTrigger("TR_PathologyTissue_Locked"));
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("PathologyTissueId");
        b.Property(x => x.OrganCode).HasMaxLength(40).IsRequired();
        b.Property(x => x.BlockCode).HasMaxLength(12);
        b.Property(x => x.Result).HasSnakeCaseEnumConversion(14);
        b.Property(x => x.Comment).HasMaxLength(500);
        b.Property(x => x.RecutNote).HasMaxLength(200);
        b.Ignore(x => x.DiagnosesInOrder);
        b.HasMany(x => x.Diagnoses).WithOne().HasForeignKey(d => d.PathologyTissueId);
        b.HasIndex(x => new { x.PathologyCaseId, x.Sequence }).IsUnique();
    }
}

internal sealed class PathologyDiagnosisConfiguration : IEntityTypeConfiguration<PathologyDiagnosis>
{
    public void Configure(EntityTypeBuilder<PathologyDiagnosis> b)
    {
        b.ToTable("PathologyDiagnosis", "path", tb => tb.HasTrigger("TR_PathologyDiagnosis_Locked"));
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("DiagnosisEntryId");
        b.Property(x => x.Term).HasMaxLength(120).IsRequired();
        b.Property(x => x.Modifier).HasMaxLength(120);
        b.Property(x => x.Distribution).HasMaxLength(30);
        b.Property(x => x.Laterality).HasMaxLength(20);
        b.Property(x => x.Severity).HasMaxLength(1).IsFixedLength();
        b.Property(x => x.Behavior).HasSnakeCaseNullableEnumConversion(10);
        b.Property(x => x.Origin).HasSnakeCaseNullableEnumConversion(10);
        b.Property(x => x.Comment).HasMaxLength(300);
        b.HasMany(x => x.Correlations).WithOne().HasForeignKey(c => c.DiagnosisEntryId);
        b.HasIndex(x => new { x.PathologyTissueId, x.Sequence }).IsUnique();
    }
}

internal sealed class PathologyCorrelationConfiguration : IEntityTypeConfiguration<PathologyCorrelation>
{
    public void Configure(EntityTypeBuilder<PathologyCorrelation> b)
    {
        b.ToTable("PathologyCorrelation", "path", tb => tb.HasTrigger("TR_PathologyCorrelation_Locked"));
        b.HasKey(x => new { x.DiagnosisEntryId, x.NecropsyFindingId });
        b.HasIndex(x => x.NecropsyFindingId).IsUnique();   // a gross finding correlates with one diagnosis
    }
}

internal sealed class GrossNoCorrelateConfiguration : IEntityTypeConfiguration<GrossNoCorrelate>
{
    public void Configure(EntityTypeBuilder<GrossNoCorrelate> b)
    {
        b.ToTable("GrossNoCorrelate", "path");
        b.HasKey(x => new { x.PathologyCaseId, x.NecropsyFindingId });
    }
}

internal sealed class PathologyReportVersionConfiguration : IEntityTypeConfiguration<PathologyReportVersion>
{
    public void Configure(EntityTypeBuilder<PathologyReportVersion> b)
    {
        b.ToTable("PathologyReportVersion", "path", tb => tb.HasTrigger("TR_PathologyReportVersion_Immutable"));
        b.HasKey(x => new { x.PathologyCaseId, x.Version });
        b.Property(x => x.ReportJson).IsRequired();
    }
}

internal sealed class PathologyAmendmentConfiguration : IEntityTypeConfiguration<PathologyAmendment>
{
    public void Configure(EntityTypeBuilder<PathologyAmendment> b)
    {
        b.ToTable("PathologyAmendment", "path");
        b.HasKey(x => new { x.PathologyCaseId, x.Version });
        b.Property(x => x.Reason).HasMaxLength(300).IsRequired();
    }
}
