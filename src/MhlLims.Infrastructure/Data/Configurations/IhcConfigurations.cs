using MhlLims.Domain.Ihc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MhlLims.Infrastructure.Data.Configurations;

// Mapping for db/060_ihc.sql. The schema is owned by the SQL scripts (ADR 0002); these only map to it.

internal sealed class AssayConfiguration : IEntityTypeConfiguration<Assay>
{
    public void Configure(EntityTypeBuilder<Assay> b)
    {
        b.ToTemporalTable("Assay", "ihc");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("AssayId");
        b.Property(x => x.Name).HasMaxLength(200).IsRequired();
        b.Property(x => x.Dilution).HasMaxLength(200);
        b.Property(x => x.AntigenRetrieval).HasMaxLength(600);
        b.Property(x => x.ProteolyticDigestion).HasMaxLength(200);
        b.Property(x => x.DetectionKit).HasMaxLength(600);
        b.Property(x => x.Fixative).HasMaxLength(200);
        b.Property(x => x.Species).HasMaxLength(200);
        b.Property(x => x.ControlTissue).HasMaxLength(600);
        b.Property(x => x.Manufacturer).HasMaxLength(200);
        b.Property(x => x.CatalogNumber).HasMaxLength(200);
        b.Property(x => x.Clone).HasMaxLength(60);
        b.Property(x => x.Host).HasMaxLength(30);
        b.Property(x => x.Clonality).HasMaxLength(20);
        b.Property(x => x.PlatformSet).HasMaxLength(20);
        b.Property(x => x.ChromogenSet).HasMaxLength(20);
        b.Property(x => x.Visibility).HasSnakeCaseEnumConversion(10);
        b.Property(x => x.Result).HasSnakeCaseNullableEnumConversion(12);
        b.Property(x => x.Kind).HasSnakeCaseEnumConversion(10);
        b.Property(x => x.Chromogen).HasMaxLength(30);
        b.Property(x => x.Platform).HasMaxLength(20);
        b.Property(x => x.Status).HasSnakeCaseEnumConversion(10);
        b.Property(x => x.Notes).HasMaxLength(1000);
        b.Property(x => x.SourceReference).HasMaxLength(100);
        b.Property(x => x.LegacyAssayKey).HasMaxLength(50);
        b.Property(x => x.ModifiedBy).HasMaxLength(100);
        b.Ignore(x => x.IsDoubleStain);
        b.Ignore(x => x.NeedsChecking);
        b.HasOne<Assay>().WithMany().HasForeignKey(x => x.DuplicateOfAssayId).OnDelete(DeleteBehavior.NoAction);
        b.HasMany(x => x.Components).WithOne().HasForeignKey(c => c.AssayId).OnDelete(DeleteBehavior.NoAction);
        b.HasMany(x => x.SpeciesTags).WithOne().HasForeignKey(t => t.AssayId);
        b.HasMany(x => x.FixativeTags).WithOne().HasForeignKey(t => t.AssayId);
        b.HasMany(x => x.Flags).WithOne().HasForeignKey(f => f.AssayId);
        b.HasIndex(x => x.Name);
    }
}

internal sealed class AssayComponentConfiguration : IEntityTypeConfiguration<AssayComponent>
{
    public void Configure(EntityTypeBuilder<AssayComponent> b)
    {
        b.ToTable("AssayComponent", "ihc");
        b.HasKey(x => new { x.AssayId, x.StainOrder });
        b.HasOne<Assay>().WithMany().HasForeignKey(x => x.ComponentAssayId).OnDelete(DeleteBehavior.NoAction);
    }
}

internal sealed class AssaySpeciesTagConfiguration : IEntityTypeConfiguration<AssaySpeciesTag>
{
    public void Configure(EntityTypeBuilder<AssaySpeciesTag> b)
    {
        b.ToTable("AssaySpeciesTag", "ihc");
        b.HasKey(x => new { x.AssayId, x.Tag });
        b.Property(x => x.Tag).HasMaxLength(30);
    }
}

internal sealed class AssayFixativeTagConfiguration : IEntityTypeConfiguration<AssayFixativeTag>
{
    public void Configure(EntityTypeBuilder<AssayFixativeTag> b)
    {
        b.ToTable("AssayFixativeTag", "ihc");
        b.HasKey(x => new { x.AssayId, x.Tag });
        b.Property(x => x.Tag).HasMaxLength(30);
    }
}

internal sealed class AssayFlagConfiguration : IEntityTypeConfiguration<AssayFlag>
{
    public void Configure(EntityTypeBuilder<AssayFlag> b)
    {
        b.ToTable("AssayFlag", "ihc");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("AssayFlagId");
        b.Property(x => x.FlagCode).HasSnakeCaseEnumConversion(30);
        b.Property(x => x.StoredValue).HasMaxLength(200);
        b.Property(x => x.RaisedAt).HasDefaultValueSql("sysutcdatetime()");
        b.Property(x => x.ClearedBy).HasMaxLength(100);
    }
}

internal sealed class IhcRequestConfiguration : IEntityTypeConfiguration<IhcRequest>
{
    public void Configure(EntityTypeBuilder<IhcRequest> b)
    {
        b.ToTemporalTable("IhcRequest", "ihc");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("IhcRequestId");
        b.Property(x => x.RequestNumber).HasMaxLength(20).IsRequired();
        b.HasIndex(x => x.RequestNumber).IsUnique();
        b.Property(x => x.Status).HasSnakeCaseEnumConversion(10);
        b.Property(x => x.SubmittedAt).HasDefaultValueSql("sysutcdatetime()");
        b.Property(x => x.SubmittedByAccount).HasMaxLength(100);
        b.Property(x => x.RequesterLastName).HasMaxLength(100).IsRequired();
        b.Property(x => x.RequesterFirstName).HasMaxLength(100);
        b.Property(x => x.RequesterInstitute).HasMaxLength(200);
        b.Property(x => x.BuildingRoom).HasMaxLength(40);
        b.Property(x => x.Phone).HasMaxLength(30);
        b.Property(x => x.Email).HasMaxLength(256).IsRequired();
        b.Property(x => x.BillTo).HasMaxLength(100).IsRequired();
        b.Property(x => x.CostpointProjectId).HasMaxLength(40).IsRequired();
        b.Property(x => x.AcucProtocol).HasMaxLength(50);
        b.Property(x => x.Importance).HasSnakeCaseEnumConversion(10);
        b.Property(x => x.SpeciesChoice).HasMaxLength(20).IsRequired();
        b.Property(x => x.FixativeUsed).HasMaxLength(40).IsRequired();
        b.Property(x => x.FixativeSubmittedIn).HasMaxLength(40);
        b.Property(x => x.AdditionalInformation).HasMaxLength(2000);
        b.Property(x => x.DeclineReason).HasMaxLength(500);
        b.Property(x => x.LegacyWebId).HasMaxLength(30);
        b.Property(x => x.ModifiedBy).HasMaxLength(100);
        b.Property(x => x.RowVer).IsRowVersion();
        b.HasMany(x => x.Samples).WithOne().HasForeignKey(s => s.IhcRequestId);
        b.HasMany(x => x.Stains).WithOne().HasForeignKey(s => s.IhcRequestId);
        b.HasOne<IhcRequest>().WithMany().HasForeignKey(x => x.CopiedFromIhcRequestId).OnDelete(DeleteBehavior.NoAction);
    }
}

internal sealed class IhcRequestSampleConfiguration : IEntityTypeConfiguration<IhcRequestSample>
{
    public void Configure(EntityTypeBuilder<IhcRequestSample> b)
    {
        b.ToTable("IhcRequestSample", "ihc");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("IhcRequestSampleId");
        b.Property(x => x.Tissue).HasMaxLength(60).IsRequired();
        b.Property(x => x.AnimalOrBlockNo).HasMaxLength(30);
        b.Property(x => x.SampleType).HasSnakeCaseEnumConversion(10);
        b.HasIndex(x => new { x.IhcRequestId, x.SampleNumber }).IsUnique();
    }
}

internal sealed class IhcRequestStainConfiguration : IEntityTypeConfiguration<IhcRequestStain>
{
    public void Configure(EntityTypeBuilder<IhcRequestStain> b)
    {
        b.ToTable("IhcRequestStain", "ihc");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("IhcRequestStainId");
        b.Property(x => x.Chromogen).HasMaxLength(30);
        b.Property(x => x.NewAntibodyName).HasMaxLength(120);
        b.Property(x => x.NewAntibodyManufacturer).HasMaxLength(120);
        b.Property(x => x.NewAntibodyCatalog).HasMaxLength(60);
        b.Property(x => x.NewAntibodyHost).HasMaxLength(60);
        b.Property(x => x.NewAntibodyNotes).HasMaxLength(500);
        b.HasOne<Assay>().WithMany().HasForeignKey(x => x.AssayId).OnDelete(DeleteBehavior.NoAction);
        b.HasIndex(x => new { x.IhcRequestId, x.StainNumber }).IsUnique();
    }
}
