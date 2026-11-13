namespace MhlLims.Domain.Tracking;

public enum TrackedEntityType { Subject, Specimen, Block, Slide }

/// <summary>One scan or move. Append-only: corrections are new events.</summary>
public class TrackingEvent
{
    public long Id { get; set; }
    public TrackedEntityType EntityType { get; set; }
    public int EntityId { get; set; }
    public int RequestId { get; set; }
    public string? FromAreaCode { get; set; }
    public string ToAreaCode { get; set; } = string.Empty;
    public int PerformedByUserId { get; set; }
    public DateTime PerformedAt { get; set; }
    public decimal? Units { get; set; }
    public string? ProcedureCode { get; set; }
    public bool IsRedo { get; set; }
    public string? Comment { get; set; }
    public DateTime RecordedAt { get; set; }
    public string RecordedBy { get; set; } = string.Empty;
}
