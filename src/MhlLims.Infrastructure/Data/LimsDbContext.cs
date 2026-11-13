using MhlLims.Domain.Billing;
using MhlLims.Domain.Core;
using MhlLims.Domain.Ihc;
using MhlLims.Domain.Pathology;
using MhlLims.Domain.Tracking;
using Microsoft.EntityFrameworkCore;

namespace MhlLims.Infrastructure.Data;

/// <summary>
/// EF Core view of the MHL LIMS database. The schema itself is owned by the SQL scripts in /db
/// (see docs/adr/0002-database-schema-ownership.md); this context maps to it and is never used
/// to create or migrate the database.
/// </summary>
public class LimsDbContext(DbContextOptions<LimsDbContext> options) : DbContext(options)
{
    public DbSet<Investigator> Investigators => Set<Investigator>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<NasRequest> NasRequests => Set<NasRequest>();
    public DbSet<Study> Studies => Set<Study>();
    public DbSet<StudyGroup> StudyGroups => Set<StudyGroup>();
    public DbSet<Request> Requests => Set<Request>();
    public DbSet<RequestArea> RequestAreas => Set<RequestArea>();
    public DbSet<Subject> Subjects => Set<Subject>();
    public DbSet<Specimen> Specimens => Set<Specimen>();
    public DbSet<Block> Blocks => Set<Block>();
    public DbSet<Slide> Slides => Set<Slide>();
    public DbSet<TrackingEvent> TrackingEvents => Set<TrackingEvent>();

    public DbSet<ChargeCode> ChargeCodes => Set<ChargeCode>();
    public DbSet<ChargeCodeSection> ChargeCodeSections => Set<ChargeCodeSection>();
    public DbSet<PriceList> PriceLists => Set<PriceList>();
    public DbSet<PriceListItem> PriceListItems => Set<PriceListItem>();
    public DbSet<EstimateLine> EstimateLines => Set<EstimateLine>();
    public DbSet<ChargeLine> ChargeLines => Set<ChargeLine>();
    public DbSet<BillingBatch> BillingBatches => Set<BillingBatch>();

    // IHC (db/060_ihc.sql)
    public DbSet<Assay> Assays => Set<Assay>();
    public DbSet<IhcRequest> IhcRequests => Set<IhcRequest>();

    // Necropsy and pathology (db/070_necropsy_and_pathology.sql)
    public DbSet<Organ> Organs => Set<Organ>();
    public DbSet<DiagnosisTerm> DiagnosisTerms => Set<DiagnosisTerm>();
    public DbSet<DictionaryTerm> DictionaryTerms => Set<DictionaryTerm>();
    public DbSet<NecropsyProtocol> NecropsyProtocols => Set<NecropsyProtocol>();
    public DbSet<Necropsy> Necropsies => Set<Necropsy>();
    public DbSet<PathologyCase> PathologyCases => Set<PathologyCase>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(LimsDbContext).Assembly);
    }
}
