namespace Quizymode.Api.Shared.Models;

/// <summary>
/// A signed-in user's test date for one collection (#364). One row per (<see cref="UserId"/>, <see cref="CollectionId"/>);
/// the daily step is derived by the client, so no per-day rows exist. Intentionally not a foreign key to Collections:
/// DeleteCollection removes the rows explicitly, like the other per-collection tables.
/// </summary>
public sealed class StudyPlan
{
    public string UserId { get; set; } = string.Empty;

    public Guid CollectionId { get; set; }

    public DateOnly TestDate { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}
