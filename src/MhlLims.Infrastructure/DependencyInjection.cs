using MhlLims.Domain.Identifiers;
using MhlLims.Infrastructure.Data;
using MhlLims.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MhlLims.Infrastructure;

public static class DependencyInjection
{
    /// <summary>Registers the database context and data services. The host must register an <see cref="ICurrentUser"/>.</summary>
    public static IServiceCollection AddLimsInfrastructure(this IServiceCollection services, string connectionString)
    {
        services.AddScoped<AuditStampInterceptor>();
        services.AddDbContext<LimsDbContext>((sp, options) =>
        {
            // No automatic retry: it conflicts with explicit transactions (billing release, request intake).
            options.UseSqlServer(connectionString);
            options.AddInterceptors(sp.GetRequiredService<AuditStampInterceptor>());
        });
        services.AddScoped<INumberAllocator, SqlNumberAllocator>();
        services.AddScoped<PriceCatalogLoader>();
        services.AddScoped<LookupService>();
        return services;
    }
}
