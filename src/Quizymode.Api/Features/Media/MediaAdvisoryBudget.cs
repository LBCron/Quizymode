using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
namespace Quizymode.Api.Features.Media;
internal static class MediaAdvisoryBudget
{
    internal static async Task<bool> HasCostCapacityAsync(ApplicationDbContext db, string owner, MediaAdvisoryOptions options, DateTime now, CancellationToken ct)
    {
        // The call ceiling bounds these daily rows. Client decimal summation is exact and also works in SQLite tests.
        decimal global = (await db.MediaAdvisoryJobs.Where(x => x.CreatedAt >= now.Date).Select(x => new { x.ReservedCostUsd, x.EstimatedCostUsd }).ToListAsync(ct)).Sum(x => Math.Max(x.ReservedCostUsd, x.EstimatedCostUsd ?? 0));
        decimal owned = (await db.MediaAdvisoryJobs.Where(x => x.CreatedAt >= now.Date && x.OwnerUserId == owner).Select(x => new { x.ReservedCostUsd, x.EstimatedCostUsd }).ToListAsync(ct)).Sum(x => Math.Max(x.ReservedCostUsd, x.EstimatedCostUsd ?? 0));
        return global + options.PerCallReservationUsd <= options.DailyReservationBudgetUsd && owned + options.PerCallReservationUsd <= options.OwnerDailyReservationBudgetUsd;
    }
}
