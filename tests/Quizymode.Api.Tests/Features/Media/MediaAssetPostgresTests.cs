using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Media;

/// <summary>#399: the AddMediaAssets migration's check constraints and unique key, on real PostgreSQL. Requires Docker.</summary>
[Trait("Category", "Postgres")]
public sealed class MediaAssetPostgresTests(PostgresContainerFixture fixture) : IClassFixture<PostgresContainerFixture>
{
    private static MediaAsset Row(MediaAssetState state, string? objectKey = null, string? failureCode = null, int bytes = 100) => new()
    {
        Id = Guid.NewGuid(),
        OwnerUserId = "owner",
        State = state,
        ObjectKey = objectKey,
        Sha256 = new string('a', 64),
        Width = 10,
        Height = 10,
        Bytes = bytes,
        Format = "webp",
        SourceFormat = "png",
        SourceBytes = 200,
        ProcessingVersion = 1,
        FailureCode = failureCode,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow
    };

    private static string Key() => $"normalized/v1/{Guid.NewGuid():N}/{new string('b', 64)}.webp";

    private async Task<bool> SavesAsync(MediaAsset row)
    {
        await using ApplicationDbContext db = fixture.CreateDbContext();
        db.MediaAssets.Add(row);
        try
        {
            await db.SaveChangesAsync();
            return true;
        }
        catch (DbUpdateException)
        {
            return false;
        }
    }

    [SkippableFact]
    public async Task CheckConstraints_RejectIncompleteOrOversizedRows()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);

        (await SavesAsync(Row(MediaAssetState.Processing))).Should().BeTrue();
        (await SavesAsync(Row(MediaAssetState.Ready, Key()))).Should().BeTrue();
        (await SavesAsync(Row(MediaAssetState.Failed, failureCode: "Media.StorageFailed"))).Should().BeTrue();

        (await SavesAsync(Row(MediaAssetState.Ready, objectKey: null))).Should().BeFalse("Ready needs an object key");
        (await SavesAsync(Row(MediaAssetState.Failed, failureCode: null))).Should().BeFalse("Failed needs a failure code");
        (await SavesAsync(Row(MediaAssetState.Processing, bytes: 102_401))).Should().BeFalse("the normalized size is capped at 100 KiB");
    }

    [SkippableFact]
    public async Task ObjectKey_IsUnique_AndStateIsStoredAsText()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        string key = Key();

        (await SavesAsync(Row(MediaAssetState.Ready, key))).Should().BeTrue();
        (await SavesAsync(Row(MediaAssetState.Ready, key))).Should().BeFalse();

        await using ApplicationDbContext db = fixture.CreateDbContext();
        string state = await db.Database.SqlQueryRaw<string>("SELECT \"State\" AS \"Value\" FROM \"MediaAssets\" WHERE \"ObjectKey\" = {0}", key).SingleAsync();
        state.Should().Be("Ready");
    }
}
