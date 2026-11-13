using MhlLims.Domain.Core;
using MhlLims.Domain.Tracking;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace MhlLims.Infrastructure.Data.Configurations;

internal sealed class InvestigatorConfiguration : IEntityTypeConfiguration<Investigator>
{
    public void Configure(EntityTypeBuilder<Investigator> b)
    {
        b.ToTemporalTable("Investigator", "lims");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("InvestigatorId");
        b.Property(x => x.LastName).HasMaxLength(100).IsRequired();
        b.Property(x => x.FirstName).HasMaxLength(100);
        b.Property(x => x.Title).HasMaxLength(100);
        b.Property(x => x.Institute).HasMaxLength(100);
        b.Property(x => x.Division).HasMaxLength(100);
        b.Property(x => x.Email).HasMaxLength(256);
        b.Property(x => x.Phone).HasMaxLength(50);
        b.Property(x => x.ModifiedBy).HasMaxLength(100);
        b.Ignore(x => x.DisplayName);
    }
}

internal sealed class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    public void Configure(EntityTypeBuilder<Project> b)
    {
        b.ToTable("Project", "lims");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("ProjectId");
        b.Property(x => x.CostpointProjectId).HasMaxLength(30).IsRequired();
        b.HasIndex(x => x.CostpointProjectId).IsUnique();
        b.Property(x => x.Name).HasMaxLength(200);
    }
}

internal sealed class NasRequestConfiguration : IEntityTypeConfiguration<NasRequest>
{
    public void Configure(EntityTypeBuilder<NasRequest> b)
    {
        b.ToTable("NasRequest", "lims");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("NasRequestId").ValueGeneratedNever();
        b.Property(x => x.RequestDisplayId).HasMaxLength(30).IsRequired();
        b.HasIndex(x => x.RequestDisplayId).IsUnique();
        b.Property(x => x.TotalEstimatedCost).HasPrecision(12, 2);
        b.Property(x => x.AuthorizedAmount).HasPrecision(12, 2);
        b.Property(x => x.CostpointProjectId).HasMaxLength(30);
    }
}

internal sealed class StudyConfiguration : IEntityTypeConfiguration<Study>
{
    public void Configure(EntityTypeBuilder<Study> b)
    {
        b.ToTemporalTable("Study", "lims");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("StudyId");
        b.Property(x => x.ZapNumber).HasMaxLength(20).IsRequired();
        b.HasIndex(x => x.ZapNumber).IsUnique();
        b.Property(x => x.Title).HasMaxLength(400);
        b.Property(x => x.AcucProtocol).HasMaxLength(50);
        b.Property(x => x.ModifiedBy).HasMaxLength(100);
        b.HasOne(x => x.Investigator).WithMany().HasForeignKey(x => x.InvestigatorId);
        b.HasMany(x => x.Groups).WithOne().HasForeignKey(g => g.StudyId);
        b.HasOne<MhlLims.Domain.Pathology.NecropsyProtocol>().WithMany().HasForeignKey(x => x.NecropsyProtocolId).OnDelete(DeleteBehavior.NoAction);
    }
}

internal sealed class StudyGroupConfiguration : IEntityTypeConfiguration<StudyGroup>
{
    public void Configure(EntityTypeBuilder<StudyGroup> b)
    {
        b.ToTable("StudyGroup", "lims");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("GroupId");
        b.Property(x => x.GroupCode).HasMaxLength(20).IsRequired();
        b.Property(x => x.Sex).HasMaxLength(1).IsFixedLength();
        b.HasIndex(x => new { x.StudyId, x.GroupCode }).IsUnique();
    }
}

internal sealed class RequestConfiguration : IEntityTypeConfiguration<Request>
{
    public void Configure(EntityTypeBuilder<Request> b)
    {
        b.ToTemporalTable("Request", "lims");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("RequestId");
        b.Property(x => x.RequestNumber).HasMaxLength(20).IsRequired();
        b.HasIndex(x => x.RequestNumber).IsUnique();
        b.Property(x => x.LabCode).HasMaxLength(4).IsRequired();
        b.Property(x => x.RequestTypeCode).HasMaxLength(20).IsRequired();
        b.Property(x => x.Status).HasUpperCaseEnumConversion(20);
        b.Property(x => x.ChargeType)
            .HasConversion(new ValueConverter<RequestChargeType, string>(v => ((char)v).ToString(), v => (RequestChargeType)v[0]))
            .HasMaxLength(1).IsFixedLength();
        b.Property(x => x.DefaultPriorityCode).HasMaxLength(1).IsFixedLength();
        b.Property(x => x.SpeciesCode).HasMaxLength(10);
        b.Property(x => x.FixativeCode).HasMaxLength(20);
        b.Property(x => x.TissueDisposition).HasMaxLength(200);
        b.Property(x => x.ModifiedBy).HasMaxLength(100);
        b.Property(x => x.RowVer).IsRowVersion();
        b.HasOne(x => x.Investigator).WithMany().HasForeignKey(x => x.InvestigatorId);
        b.HasOne(x => x.Project).WithMany().HasForeignKey(x => x.ProjectId);
        b.HasOne(x => x.NasRequest).WithMany().HasForeignKey(x => x.NasRequestId);
        b.HasOne(x => x.Study).WithMany().HasForeignKey(x => x.StudyId);
        b.HasMany(x => x.Subjects).WithOne(s => s.Request).HasForeignKey(s => s.RequestId);
        b.HasMany(x => x.Areas).WithOne().HasForeignKey(a => a.RequestId);
    }
}

internal sealed class RequestAreaConfiguration : IEntityTypeConfiguration<RequestArea>
{
    public void Configure(EntityTypeBuilder<RequestArea> b)
    {
        b.ToTable("RequestArea", "lims");
        b.HasKey(x => new { x.RequestId, x.AreaCode });
        b.Property(x => x.AreaCode).HasMaxLength(10);
    }
}

internal sealed class SubjectConfiguration : IEntityTypeConfiguration<Subject>
{
    public void Configure(EntityTypeBuilder<Subject> b)
    {
        b.ToTemporalTable("Subject", "lims");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("SubjectId");
        b.Property(x => x.PhlNumber).HasMaxLength(12).IsUnicode(false).IsRequired();
        b.HasIndex(x => x.PhlNumber);
        b.Property(x => x.SubjectTypeCode).HasMaxLength(20).IsRequired();
        b.Property(x => x.AnimalNumber).HasMaxLength(30);
        b.Property(x => x.AltId).HasMaxLength(50);
        b.Property(x => x.ExternalSourceId).HasMaxLength(50);
        b.Property(x => x.SpeciesCode).HasMaxLength(10);
        b.Property(x => x.Sex).HasMaxLength(1).IsFixedLength();
        b.Property(x => x.Genotype).HasMaxLength(200);
        b.Property(x => x.PriorityCode).HasMaxLength(1).IsFixedLength();
        b.Property(x => x.HostStrain).HasMaxLength(100);
        b.Property(x => x.Status).HasUpperCaseEnumConversion(20);
        b.Property(x => x.ModifiedBy).HasMaxLength(100);
        b.Property(x => x.RowVer).IsRowVersion();
        b.Ignore(x => x.IsStat);
        b.HasOne<Subject>().WithMany().HasForeignKey(x => x.ParentSubjectId).OnDelete(DeleteBehavior.NoAction);
    }
}

internal sealed class SpecimenConfiguration : IEntityTypeConfiguration<Specimen>
{
    public void Configure(EntityTypeBuilder<Specimen> b)
    {
        b.ToTable("Specimen", "lims");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("SpecimenId");
        b.Property(x => x.SpecimenTypeCode).HasMaxLength(20).IsRequired();
        b.Property(x => x.OrganOrSite).HasMaxLength(100);
        b.Property(x => x.Barcode).HasMaxLength(40).IsUnicode(false);
        b.Property(x => x.StorageLocation).HasMaxLength(200);
        b.Property(x => x.Notes).HasMaxLength(1000);
        b.Property(x => x.CreatedAt).ValueGeneratedOnAdd();
    }
}

internal sealed class BlockConfiguration : IEntityTypeConfiguration<Block>
{
    public void Configure(EntityTypeBuilder<Block> b)
    {
        b.ToTable("Block", "lims");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("BlockId");
        b.Property(x => x.BlockCode).HasMaxLength(10).IsRequired();
        b.Property(x => x.Barcode).HasMaxLength(40).IsUnicode(false).IsRequired();
        b.HasIndex(x => x.Barcode).IsUnique();
        b.Property(x => x.MediumCode).HasMaxLength(20);
        b.Property(x => x.Description).HasMaxLength(200);
        b.Property(x => x.CreatedAt).ValueGeneratedOnAdd();
    }
}

internal sealed class SlideConfiguration : IEntityTypeConfiguration<Slide>
{
    public void Configure(EntityTypeBuilder<Slide> b)
    {
        b.ToTable("Slide", "lims");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("SlideId");
        b.Property(x => x.Barcode).HasMaxLength(40).IsUnicode(false).IsRequired();
        b.HasIndex(x => x.Barcode).IsUnique();
        b.Property(x => x.StainOrAssay).HasMaxLength(100);
        b.Property(x => x.CreatedAt).ValueGeneratedOnAdd();
    }
}

internal sealed class TrackingEventConfiguration : IEntityTypeConfiguration<TrackingEvent>
{
    public void Configure(EntityTypeBuilder<TrackingEvent> b)
    {
        b.ToTable("TrackingEvent", "trk", tb => tb.HasTrigger("TR_TrackingEvent_AppendOnly"));
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("EventId");
        b.Property(x => x.EntityType).HasUpperCaseEnumConversion(10);
        b.Property(x => x.FromAreaCode).HasMaxLength(10);
        b.Property(x => x.ToAreaCode).HasMaxLength(10).IsRequired();
        b.Property(x => x.Units).HasPrecision(9, 2);
        b.Property(x => x.ProcedureCode).HasMaxLength(20);
        b.Property(x => x.Comment).HasMaxLength(1000);
        b.Property(x => x.RecordedAt).ValueGeneratedOnAdd();
        b.Property(x => x.RecordedBy).HasMaxLength(100);
    }
}
