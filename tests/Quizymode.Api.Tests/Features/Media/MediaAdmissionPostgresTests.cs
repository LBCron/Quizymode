using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Media;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Media;

[Trait("Category", "Postgres")]
public sealed class MediaAdmissionPostgresTests(PostgresContainerFixture fixture) : IClassFixture<PostgresContainerFixture>
{
    [SkippableFact]
    public async Task DistinctOwnersRacingForOneGlobalSlotAdmitExactlyOneDecode()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        DateTime now = DateTime.UtcNow;
        MediaOptions options = new() { MaxGlobalUploads = 1 };
        TaskCompletionSource start = new(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<bool> AdmitAsync(string owner)
        {
            await using ApplicationDbContext db = fixture.CreateDbContext();
            await start.Task;
            var result = await MediaAdmission.ReserveAsync(db, owner, "fresh-key", [1], options, now, CancellationToken.None);
            if (result.Claim is not null) { result.Error.Should().BeNull(); return true; }
            ((IStatusCodeHttpResult)result.Error!).StatusCode.Should().Be(429);
            ((Microsoft.AspNetCore.Http.HttpResults.ProblemHttpResult)result.Error).ProblemDetails.Title.Should().Be("Media.GlobalBusy");
            return false;
        }
        Task<bool> first = AdmitAsync("owner-a");
        Task<bool> second = AdmitAsync("owner-b");
        start.SetResult();
        bool[] admitted = await Task.WhenAll(first, second);
        admitted.Count(value => value).Should().Be(1, "new keys must share the durable PostgreSQL global admission ceiling across owners");
        await using ApplicationDbContext verify = fixture.CreateDbContext();
        (await verify.MediaUploadClaims.CountAsync(x => x.State == "Processing" && x.LeaseUntil > now)).Should().Be(1);
        (await verify.MediaUploadAttempts.CountAsync()).Should().Be(1);
    }

    [SkippableFact]
    public async Task DistinctReplicasReserveOneTransportReadBeforeAnyDecode()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        DateTime now = DateTime.UtcNow;
        MediaOptions options = new() { MaxGlobalIngress = 1 };
        TaskCompletionSource gate = new(TaskCreationOptions.RunContinuationsAsynchronously);
        async Task<bool> Reserve(string owner)
        {
            await using var db = fixture.CreateDbContext(); await gate.Task;
            var result = await MediaIngress.ReserveAsync(db, owner, options, now, CancellationToken.None);
            if (result.Attempt is not null) return true;
            ((IStatusCodeHttpResult)result.Error!).StatusCode.Should().Be(429); return false;
        }
        Task<bool> a = Reserve("ingress-a"), b = Reserve("ingress-b"); gate.SetResult();
        (await Task.WhenAll(a, b)).Count(x => x).Should().Be(1);
        await using var restarted = fixture.CreateDbContext();
        (await restarted.MediaIngressAttempts.CountAsync(x => x.CompletedAt == null && x.LeaseUntil > now)).Should().Be(1);
        (await MediaIngress.ReserveAsync(restarted, "ingress-c", options, now, CancellationToken.None)).Attempt.Should().BeNull();
    }
}
