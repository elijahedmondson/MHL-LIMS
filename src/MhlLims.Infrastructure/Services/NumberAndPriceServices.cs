using System.Data;
using MhlLims.Domain.Billing;
using MhlLims.Domain.Identifiers;
using MhlLims.Infrastructure.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace MhlLims.Infrastructure.Services;

/// <summary>Calls lims.usp_AllocateNumbers, which hands out consecutive PHL and request numbers safely under concurrency.</summary>
public sealed class SqlNumberAllocator(LimsDbContext db) : INumberAllocator
{
    public async Task<int> AllocateAsync(string counterName, short period, int count, CancellationToken cancellationToken = default)
    {
        var first = new SqlParameter("@FirstValue", SqlDbType.Int) { Direction = ParameterDirection.Output };
        var parameters = new object[]
        {
            new SqlParameter("@CounterName", SqlDbType.VarChar, 40) { Value = counterName },
            new SqlParameter("@Period", SqlDbType.SmallInt) { Value = period },
            new SqlParameter("@Count", SqlDbType.Int) { Value = count },
            first,
        };
        await db.Database.ExecuteSqlRawAsync(
            "EXEC lims.usp_AllocateNumbers @CounterName, @Period, @Count, @FirstValue OUTPUT", parameters, cancellationToken);
        return (int)first.Value;
    }
}

/// <summary>Loads charge codes and approved price lists into a <see cref="PriceCatalog"/>.</summary>
public sealed class PriceCatalogLoader(LimsDbContext db)
{
    public async Task<PriceCatalog> LoadAsync(CancellationToken cancellationToken = default)
    {
        var codes = await db.ChargeCodes.AsNoTracking().Include(c => c.Sections).ToListAsync(cancellationToken);
        var lists = await db.PriceLists.AsNoTracking()
            .Where(p => p.Status == PriceListStatus.Approved)
            .Include(p => p.Items)
            .ToListAsync(cancellationToken);
        return new PriceCatalog(codes, lists);
    }
}
