using MhlLims.Domain.Common;
using MhlLims.Domain.Tracking;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace MhlLims.Infrastructure.Data;

/// <summary>The signed-in user, as seen by the data layer.</summary>
public interface ICurrentUser
{
    /// <summary>AD account, e.g. NIH\jdoe. Written to ModifiedBy so temporal history shows who changed each row.</summary>
    string AccountName { get; }
}

/// <summary>Stamps ModifiedBy (and TrackingEvent.RecordedBy) on every insert and update.</summary>
public sealed class AuditStampInterceptor(ICurrentUser currentUser) : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Stamp(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Stamp(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private void Stamp(DbContext? context)
    {
        if (context is null) return;
        var account = string.IsNullOrWhiteSpace(currentUser.AccountName) ? "unknown" : currentUser.AccountName;
        foreach (var entry in context.ChangeTracker.Entries<IHasModifiedBy>())
            if (entry.State is EntityState.Added or EntityState.Modified)
                entry.Entity.ModifiedBy = account;
        foreach (var entry in context.ChangeTracker.Entries<TrackingEvent>())
            if (entry.State == EntityState.Added && string.IsNullOrWhiteSpace(entry.Entity.RecordedBy))
                entry.Entity.RecordedBy = account;
    }
}
