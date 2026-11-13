using MhlLims.Domain.Billing;
using MhlLims.Domain.Common;
using MhlLims.Domain.Tracking;
using MhlLims.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace MhlLims.Infrastructure.Services;

public sealed record LookupHit(
    int RequestId, string RequestNumber, string Investigator, string? NasNumber, string? ZapNumber,
    string Status, DateOnly ReceivedDate, string MatchedOn);

public sealed record SubjectRow(int SubjectId, string PhlNumber, string? AnimalNumber, string? GroupCode, string Priority, string? CurrentArea, DateTime? ArrivedAt);

public sealed record SectionCharges(string SectionCode, decimal Amount, int Lines);

public sealed record RequestDetail(
    int RequestId, string RequestNumber, string LabCode, string RequestType, string Status,
    DateOnly ReceivedDate, DateOnly? DueDate, DateOnly? CompletedDate, string? Description,
    string Investigator, string? InvestigatorEmail,
    string? NasNumber, decimal? NasAuthorized, decimal? NasEstimated,
    string? ProjectNumber, string? ZapNumber, string? StudyTitle,
    IReadOnlyList<SubjectRow> Subjects,
    IReadOnlyList<SectionCharges> Charges,
    decimal ChargedTotal);

/// <summary>
/// The unified lookup: find a request by request number, PHL#, ZAP#, NAS# or investigator,
/// then show everything about it on one page.
/// </summary>
public sealed class LookupService(LimsDbContext db)
{
    public async Task<IReadOnlyList<LookupHit>> SearchAsync(string term, int maxResults = 50, CancellationToken ct = default)
    {
        term = (term ?? string.Empty).Trim();
        if (term.Length < 2) return [];
        var upper = term.ToUpperInvariant();
        var matches = new Dictionary<int, string>();

        void Add(int requestId, string matchedOn)
        {
            if (!matches.ContainsKey(requestId)) matches[requestId] = matchedOn;
        }

        foreach (var r in await db.Requests.AsNoTracking()
                     .Where(r => r.RequestNumber.StartsWith(upper))
                     .Select(r => new { r.Id, r.RequestNumber }).Take(maxResults).ToListAsync(ct))
            Add(r.Id, $"Request {r.RequestNumber}");

        foreach (var s in await db.Subjects.AsNoTracking()
                     .Where(s => s.PhlNumber.StartsWith(upper))
                     .Select(s => new { s.RequestId, s.PhlNumber }).Take(maxResults).ToListAsync(ct))
            Add(s.RequestId, $"PHL# {s.PhlNumber}");

        foreach (var r in await db.Requests.AsNoTracking()
                     .Where(r => r.Study != null && r.Study.ZapNumber == upper)
                     .Select(r => r.Id).Take(maxResults).ToListAsync(ct))
            Add(r, $"ZAP# {upper}");

        foreach (var r in await db.Requests.AsNoTracking()
                     .Where(r => r.NasRequest != null && r.NasRequest.RequestDisplayId == upper)
                     .Select(r => r.Id).Take(maxResults).ToListAsync(ct))
            Add(r, $"NAS# {upper}");

        foreach (var r in await db.Requests.AsNoTracking()
                     .Where(r => r.Investigator != null && r.Investigator.LastName.StartsWith(term))
                     .OrderByDescending(r => r.ReceivedDate)
                     .Select(r => new { r.Id, r.Investigator!.LastName }).Take(maxResults).ToListAsync(ct))
            Add(r.Id, $"Investigator {r.LastName}");

        if (matches.Count == 0) return [];
        var ids = matches.Keys.Take(maxResults).ToList();
        var rows = await db.Requests.AsNoTracking()
            .Where(r => ids.Contains(r.Id))
            .Select(r => new
            {
                r.Id, r.RequestNumber, r.Status, r.ReceivedDate,
                InvLast = r.Investigator!.LastName, InvFirst = r.Investigator.FirstName,
                Nas = r.NasRequest != null ? r.NasRequest.RequestDisplayId : null,
                Zap = r.Study != null ? r.Study.ZapNumber : null,
            })
            .ToListAsync(ct);

        return rows
            .OrderByDescending(r => r.ReceivedDate)
            .Select(r => new LookupHit(r.Id, r.RequestNumber,
                string.IsNullOrWhiteSpace(r.InvFirst) ? r.InvLast : $"{r.InvLast}, {r.InvFirst}",
                r.Nas, r.Zap, r.Status.ToString(), r.ReceivedDate, matches[r.Id]))
            .ToList();
    }

    public async Task<RequestDetail?> GetRequestDetailAsync(int requestId, CancellationToken ct = default)
    {
        var r = await db.Requests.AsNoTracking()
            .Include(x => x.Investigator)
            .Include(x => x.NasRequest)
            .Include(x => x.Project)
            .Include(x => x.Study)
            .Include(x => x.Subjects)
            .FirstOrDefaultAsync(x => x.Id == requestId, ct);
        if (r is null) return null;

        var groupCodes = r.StudyId is null
            ? new Dictionary<int, string>()
            : await db.StudyGroups.AsNoTracking().Where(g => g.StudyId == r.StudyId)
                .ToDictionaryAsync(g => g.Id, g => g.GroupCode, ct);

        // Latest tracking event per subject = its current area.
        var events = await db.TrackingEvents.AsNoTracking()
            .Where(e => e.RequestId == requestId && e.EntityType == TrackedEntityType.Subject)
            .Select(e => new { e.EntityId, e.ToAreaCode, e.PerformedAt, e.Id })
            .ToListAsync(ct);
        var current = events
            .GroupBy(e => e.EntityId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(e => e.PerformedAt).ThenByDescending(e => e.Id).First());

        var subjects = r.Subjects
            .OrderBy(s => s.PhlNumber, StringComparer.Ordinal)
            .Select(s =>
            {
                current.TryGetValue(s.Id, out var loc);
                string? group = s.GroupId is int gid && groupCodes.TryGetValue(gid, out var code) ? code : null;
                return new SubjectRow(s.Id, s.PhlNumber, s.AnimalNumber, group, s.PriorityCode, loc?.ToAreaCode, loc?.PerformedAt);
            })
            .ToList();

        var charges = await db.ChargeLines.AsNoTracking()
            .Where(c => c.RequestId == requestId && c.Status != ChargeLineStatus.Void)
            .Select(c => new { c.SectionCode, c.Units, c.UnitPrice })
            .ToListAsync(ct);
        var bySection = charges
            .GroupBy(c => c.SectionCode)
            .Select(g => new SectionCharges(g.Key, g.Sum(c => Money.Amount(c.Units, c.UnitPrice)), g.Count()))
            .OrderBy(s => s.SectionCode, StringComparer.Ordinal)
            .ToList();

        return new RequestDetail(
            r.Id, r.RequestNumber, r.LabCode, r.RequestTypeCode, r.Status.ToString(),
            r.ReceivedDate, r.DueDate, r.CompletedDate, r.Description,
            r.Investigator?.DisplayName ?? "(unknown)", r.Investigator?.Email,
            r.NasRequest?.RequestDisplayId, r.NasRequest?.AuthorizedAmount, r.NasRequest?.TotalEstimatedCost,
            r.Project?.CostpointProjectId, r.Study?.ZapNumber, r.Study?.Title,
            subjects, bySection, bySection.Sum(s => s.Amount));
    }
}
