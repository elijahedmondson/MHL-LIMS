using MhlLims.Domain.Billing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace MhlLims.Infrastructure.Data.Configurations;

internal sealed class ChargeCodeConfiguration : IEntityTypeConfiguration<ChargeCode>
{
    public void Configure(EntityTypeBuilder<ChargeCode> b)
    {
        b.ToTemporalTable("ChargeCode", "billing");
        b.HasKey(x => x.Code);
        b.Property(x => x.Code).HasColumnName("ChargeCode").HasMaxLength(10);
        b.Property(x => x.LabCode).HasMaxLength(4).IsRequired();
        b.Property(x => x.Description).HasMaxLength(200).IsRequired();
        b.Property(x => x.UnitOfMeasure).HasMaxLength(40).IsRequired();
        b.Property(x => x.ModifiedBy).HasMaxLength(100);
        b.HasMany(x => x.Sections).WithOne().HasForeignKey(s => s.ChargeCode);
    }
}

internal sealed class ChargeCodeSectionConfiguration : IEntityTypeConfiguration<ChargeCodeSection>
{
    public void Configure(EntityTypeBuilder<ChargeCodeSection> b)
    {
        b.ToTable("ChargeCodeSection", "billing");
        b.HasKey(x => new { x.ChargeCode, x.SectionCode });
        b.Property(x => x.ChargeCode).HasMaxLength(10);
        b.Property(x => x.SectionCode).HasMaxLength(20);
    }
}

internal sealed class PriceListConfiguration : IEntityTypeConfiguration<PriceList>
{
    public void Configure(EntityTypeBuilder<PriceList> b)
    {
        b.ToTable("PriceList", "billing", tb => tb.HasTrigger("TR_PriceList_NoOverlap"));
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("PriceListId");
        b.Property(x => x.Name).HasMaxLength(50).IsRequired();
        b.HasIndex(x => x.Name).IsUnique();
        b.Property(x => x.Status).HasUpperCaseEnumConversion(10);
        b.Property(x => x.SourceFile).HasMaxLength(260);
        b.HasMany(x => x.Items).WithOne().HasForeignKey(i => i.PriceListId);
    }
}

internal sealed class PriceListItemConfiguration : IEntityTypeConfiguration<PriceListItem>
{
    public void Configure(EntityTypeBuilder<PriceListItem> b)
    {
        b.ToTemporalTable("PriceListItem", "billing", "TR_PriceListItem_Frozen");
        b.HasKey(x => new { x.PriceListId, x.ChargeCode });
        b.Property(x => x.ChargeCode).HasMaxLength(10);
        b.Property(x => x.UnitPrice).HasPrecision(10, 2);
        b.Property(x => x.ModifiedBy).HasMaxLength(100);
    }
}

internal sealed class EstimateLineConfiguration : IEntityTypeConfiguration<EstimateLine>
{
    public void Configure(EntityTypeBuilder<EstimateLine> b)
    {
        b.ToTable("EstimateLine", "billing");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("EstimateLineId");
        b.Property(x => x.SectionCode).HasMaxLength(20).IsRequired();
        b.Property(x => x.ChargeCode).HasMaxLength(10).IsRequired();
        b.Property(x => x.PlannedUnits).HasPrecision(9, 2);
        b.Property(x => x.UnitPrice).HasPrecision(10, 2);
        b.Property(x => x.Amount).IsPersistedAmount("CAST(ROUND([PlannedUnits] * [UnitPrice], 2) AS decimal(12,2))");
        b.Property(x => x.Description).HasMaxLength(500);
        b.Property(x => x.CreatedBy).HasMaxLength(100);
    }
}

internal sealed class ChargeLineConfiguration : IEntityTypeConfiguration<ChargeLine>
{
    public void Configure(EntityTypeBuilder<ChargeLine> b)
    {
        b.ToTemporalTable("ChargeLine", "billing", "TR_ChargeLine_Protect");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("ChargeLineId");
        b.Property(x => x.SectionCode).HasMaxLength(20).IsRequired();
        b.Property(x => x.ChargeCode).HasMaxLength(10).IsRequired();
        b.Property(x => x.Units).HasPrecision(9, 2);
        b.Property(x => x.UnitPrice).HasPrecision(10, 2);
        b.Property(x => x.Amount).IsPersistedAmount("CAST(ROUND([Units] * [UnitPrice], 2) AS decimal(12,2))");
        b.Property(x => x.Description).HasMaxLength(500);
        b.Property(x => x.SourceType).HasUpperCaseEnumConversion(12);
        b.Property(x => x.RuleCode).HasMaxLength(40);
        b.Property(x => x.Status).HasUpperCaseEnumConversion(10);
        b.Property(x => x.ModifiedBy).HasMaxLength(100);
        b.Property(x => x.RowVer).IsRowVersion();
        b.HasIndex(x => new { x.RequestId, x.Status });
    }
}

internal sealed class BillingBatchConfiguration : IEntityTypeConfiguration<BillingBatch>
{
    public void Configure(EntityTypeBuilder<BillingBatch> b)
    {
        b.ToTable("BillingBatch", "billing");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).HasColumnName("BillingBatchId");
        b.Property(x => x.LabCode).HasMaxLength(4).IsRequired();
        b.Property(x => x.Status).HasUpperCaseEnumConversion(10);
        b.Property(x => x.ExportFormat).HasMaxLength(20);
        b.Property(x => x.ExportFileName).HasMaxLength(260);
        b.Property(x => x.TotalAmount).HasPrecision(14, 2);
    }
}
