using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Features.Media;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;
namespace Quizymode.Api.Tests.Features.Media;
public sealed class MediaLifecycleTests : DatabaseTestFixture
{
    [Fact]
    public async Task ReservationSurvivesNewContextAndRejectsChangedBytesOrConcurrentReplay()
    {
        MediaOptions options = new(); DateTime now = DateTime.UtcNow;
        var first = await MediaAdmission.ReserveAsync(DbContext, "owner", "request-1", [1, 2, 3], options, now, CancellationToken.None);
        first.Claim.Should().NotBeNull(); first.Error.Should().BeNull();
        await using var nextContext = CreateDbContext();
        var same = await MediaAdmission.ReserveAsync(nextContext, "owner", "request-1", [1, 2, 3], options, now, CancellationToken.None);
        ((IStatusCodeHttpResult)same.Error!).StatusCode.Should().Be(409);
        var changed = await MediaAdmission.ReserveAsync(nextContext, "owner", "request-1", [9], options, now, CancellationToken.None);
        ((IStatusCodeHttpResult)changed.Error!).StatusCode.Should().Be(409);
        (await DbContext.MediaUploadClaims.CountAsync()).Should().Be(1);
    }
    [Fact]
    public async Task DurableReservationConsumesRetainedCapacityBeforeDecodeAndHasBoundedCrashRetry()
    {
        MediaOptions options = new() { MaxRetainedBytes = 102400 }; DateTime now = DateTime.UtcNow;
        var first = await MediaAdmission.ReserveAsync(DbContext, "owner", "first", [1], options, now, CancellationToken.None);
        first.Claim.Should().NotBeNull();
        var second = await MediaAdmission.ReserveAsync(DbContext, "owner", "second", [2], options, now, CancellationToken.None);
        ((IStatusCodeHttpResult)second.Error!).StatusCode.Should().Be(429);
        for (int attempt = 1; attempt < 3; attempt++)
        {
            await using var restarted = CreateDbContext();
            var retry = await MediaAdmission.ReserveAsync(restarted, "owner", "first", [1], options, now.AddMinutes(6 * attempt), CancellationToken.None);
            retry.Claim.Should().NotBeNull(); retry.Claim!.Attempts.Should().Be(attempt + 1);
        }
        await using var exhausted = CreateDbContext();
        var refused = await MediaAdmission.ReserveAsync(exhausted, "owner", "first", [1], options, now.AddMinutes(20), CancellationToken.None);
        ((IStatusCodeHttpResult)refused.Error!).StatusCode.Should().Be(409);
    }
    [Fact]
    public async Task CleanupCommitsTombstoneBeforeDeletionAndNeverTouchesAnotherOwner()
    {
        DateTime now = DateTime.UtcNow;
        MediaAsset owned = PictureSeed.AddAsset(DbContext, "test-owner"); owned.CreatedAt = now.AddDays(-10);
        MediaAsset foreign = PictureSeed.AddAsset(DbContext, "other-owner"); foreign.CreatedAt = now.AddDays(-10);
        await DbContext.SaveChangesAsync();
        FakeMediaObjectStore store = new(); store.Objects[owned.ObjectKey!] = [1]; store.Objects[foreign.ObjectKey!] = [2];
        store.OnDelete = async key => { await using var verify = CreateDbContext(); (await verify.MediaAssets.AsNoTracking().SingleAsync(x => x.Id == owned.Id)).DeletedAt.Should().NotBeNull(); };
        int count = await MediaCleanupWorker.RunOnceAsync(DbContext, store, new MediaOptions { CleanupOwnerUserId = "test-owner" }, now, CancellationToken.None);
        count.Should().Be(1); store.Objects.Should().NotContainKey(owned.ObjectKey!); store.Objects.Should().ContainKey(foreign.ObjectKey!);
        owned.PurgedAt.Should().NotBeNull(); foreign.DeletedAt.Should().BeNull();
    }
    [Fact]
    public async Task AdvisoryCostReservationsSurviveRestartAndAmbiguousFailureWithoutCallingProvider()
    {
        DateTime now = DateTime.UtcNow;
        MediaAdvisoryOptions options = new() { DailyReservationBudgetUsd = .10m, OwnerDailyReservationBudgetUsd = .05m, PerCallReservationUsd = .05m };
        options.IsValid().Should().BeTrue();
        DbContext.MediaAdvisoryJobs.Add(new MediaAdvisoryJob { Id = new string('a', 64), ItemId = Guid.NewGuid(), Revision = 1, OwnerUserId = "owner", ContentHash = new string('b', 64), Model = options.Model, PolicyVersion = "pictures-v1", CreatedAt = now, State = "Unavailable", FailureCode = "Timeout", ReservedCostUsd = .05m });
        await DbContext.SaveChangesAsync();
        await using var restarted = CreateDbContext();
        (await MediaAdvisoryBudget.HasCostCapacityAsync(restarted, "owner", options, now, CancellationToken.None)).Should().BeFalse("an ambiguous failed provider call remains reserved");
        (await MediaAdvisoryBudget.HasCostCapacityAsync(restarted, "other-owner", options, now, CancellationToken.None)).Should().BeTrue();
        (await MediaAdvisoryBudget.HasCostCapacityAsync(restarted, "owner", options, now.AddDays(1), CancellationToken.None)).Should().BeTrue();
    }

    [Theory]
    [InlineData("[{\"questionImage\":{\"assetId\":\"11111111-1111-1111-1111-111111111111\",\"altText\":\"x\"}}]")]
    [InlineData("[{\"mediaKey\":\"normalized/v1/arbitrary\"}]")]
    [InlineData("[{\"explanationImage\":{\"key\":\"https://example.invalid/image\",\"altText\":\"x\"}}]")]
    public void SeedPrevalidationRejectsUploadedUrlAndStorageFields(string json) => FluentActions.Invoking(() => Quizymode.Api.Services.DatabaseSeederHostedService.ValidateSeedMediaJson(json)).Should().Throw<InvalidDataException>();

    [Fact]
    public void SeedPrevalidationKeepsUnrelatedEditorialFieldsCompatible() => FluentActions.Invoking(() => Quizymode.Api.Services.DatabaseSeederHostedService.ValidateSeedMediaJson("[{\"questionImage\":{\"key\":\"curated:flags/fr\",\"altText\":\"Bands\"},\"factChecks\":[{\"source\":\"https://example.invalid\"}]}]")).Should().NotThrow();

    [Fact]
    public async Task ExpiredClaimRetryCannotBypassOwnerStorageFilledByAnotherClaim()
    {
        MediaOptions options = new() { MaxRetainedBytes = 100, MaxOutputBytes = 100 };
        DateTime now = DateTime.UtcNow;
        var claimA = await MediaAdmission.ReserveAsync(DbContext, "owner", "claim-a", [1], options, now, CancellationToken.None);
        claimA.Claim.Should().NotBeNull();
        await using (var later = CreateDbContext())
        {
            var claimB = await MediaAdmission.ReserveAsync(later, "owner", "claim-b", [2], options, now.AddMinutes(6), CancellationToken.None);
            claimB.Claim.Should().NotBeNull();
            MediaAsset stored = PictureSeed.AddAsset(later, "owner"); stored.Bytes = 100;
            claimB.Claim!.AssetId = stored.Id; claimB.Claim.State = "Ready";
            await later.SaveChangesAsync();
        }
        await using var restarted = CreateDbContext();
        var retry = await MediaAdmission.ReserveAsync(restarted, "owner", "claim-a", [1], options, now.AddMinutes(7), CancellationToken.None);
        ((IStatusCodeHttpResult)retry.Error!).StatusCode.Should().Be(429);
        (await restarted.MediaUploadClaims.AsNoTracking().SingleAsync(x => x.Id == claimA.Claim!.Id)).Attempts.Should().Be(1);
        (await restarted.MediaUploadAttempts.CountAsync()).Should().Be(2, "a refused retry must not consume or create a decode admission");
    }

    [Fact]
    public async Task ExpiredClaimRetryCannotBypassPendingReviewQuotaReachedAfterInitialAdmission()
    {
        MediaOptions options = new() { MaxPendingReviewItems = 1 }; DateTime now = DateTime.UtcNow;
        var initial = await MediaAdmission.ReserveAsync(DbContext, "owner", "pending-claim", [1], options, now, CancellationToken.None);
        initial.Claim.Should().NotBeNull();
        Category category = VisibilitySeed.AddCategory(DbContext);
        MediaAsset asset = PictureSeed.AddAsset(DbContext, "owner");
        PictureSeed.AddPictureItem(DbContext, category, "owner", true, ItemImageReviewState.PendingReview, asset);
        await DbContext.SaveChangesAsync();
        await using var restarted = CreateDbContext();
        var retry = await MediaAdmission.ReserveAsync(restarted, "owner", "pending-claim", [1], options, now.AddMinutes(6), CancellationToken.None);
        ((IStatusCodeHttpResult)retry.Error!).StatusCode.Should().Be(429);
        (await restarted.MediaUploadAttempts.CountAsync()).Should().Be(1);
        (await restarted.MediaUploadClaims.AsNoTracking().SingleAsync()).Attempts.Should().Be(1);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task GlobalActiveCeilingAppliesToFreshOwnersAndExpiredClaimRetries(bool retryExpired)
    {
        MediaOptions options = new() { MaxGlobalUploads = 1 }; DateTime now = DateTime.UtcNow;
        if (retryExpired)
        {
            var previous = await MediaAdmission.ReserveAsync(DbContext, "owner-b", "request-b", [2], options, now.AddMinutes(-6), CancellationToken.None);
            previous.Claim.Should().NotBeNull();
        }
        var active = await MediaAdmission.ReserveAsync(DbContext, "owner-a", "request-a", [1], options, now, CancellationToken.None);
        active.Claim.Should().NotBeNull();
        await using var restarted = CreateDbContext();
        var refused = await MediaAdmission.ReserveAsync(restarted, "owner-b", "request-b", [2], options, now, CancellationToken.None);
        refused.Claim.Should().BeNull();
        ((IStatusCodeHttpResult)refused.Error!).StatusCode.Should().Be(429);
        ((Microsoft.AspNetCore.Http.HttpResults.ProblemHttpResult)refused.Error).ProblemDetails.Title.Should().Be("Media.GlobalBusy");
        (await restarted.MediaUploadClaims.CountAsync(x => x.State == "Processing" && x.LeaseUntil > now)).Should().Be(1);
        (await restarted.MediaUploadAttempts.CountAsync()).Should().Be(retryExpired ? 2 : 1, "refused work creates no attempt or extra active reservation");
    }


    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DeletedOrHistoricalPendingAuditDoesNotRetainOldBytesAfterRestart(bool historical)
    {
        DateTime now = DateTime.UtcNow;
        var category = VisibilitySeed.AddCategory(DbContext);
        MediaAsset asset = PictureSeed.AddAsset(DbContext, "owner"); asset.CreatedAt = now.AddDays(-10);
        Item item = PictureSeed.AddPictureItem(DbContext, category, "owner", true, ItemImageReviewState.PendingReview, asset);
        await DbContext.SaveChangesAsync();
        if (historical) { item.QuestionImageAssetId = null; item.QuestionImageKey = null; item.ImageRevision++; item.ImageReviewState = null; }
        else DbContext.Items.Remove(item);
        await DbContext.SaveChangesAsync();
        FakeMediaObjectStore store = new(); store.Objects[asset.ObjectKey!] = [1];
        await using var restarted = CreateDbContext();
        (await MediaCleanupWorker.RunOnceAsync(restarted, store, new MediaOptions { CleanupOwnerUserId = "owner" }, now, CancellationToken.None)).Should().Be(1);
        (await restarted.ItemImageReviews.CountAsync()).Should().Be(1, "audit history survives object retention");
        (await restarted.MediaAssets.SingleAsync()).PurgedAt.Should().NotBeNull();
    }

    [Theory]
    [InlineData(null)]
    [InlineData(ItemImageReviewState.Approved)]
    [InlineData(ItemImageReviewState.PendingReview)]
    public async Task RejectedDistinctSlotsReclaimBothAcrossRestartsUnlessSiblingHasAnotherLiveOwner(ItemImageReviewState? shared)
    {
        DateTime now = DateTime.UtcNow;
        var category = VisibilitySeed.AddCategory(DbContext);
        MediaAsset a = PictureSeed.AddAsset(DbContext, "owner"), b = PictureSeed.AddAsset(DbContext, "owner");
        a.CreatedAt = now.AddDays(-11); b.CreatedAt = now.AddDays(-10);
        PictureSeed.AddPictureItem(DbContext, category, "owner", true, ItemImageReviewState.Rejected, a, b);
        foreach (ItemImageReview review in DbContext.ItemImageReviews.Local) review.DecidedAt = now.AddDays(-9);
        if (shared is not null) PictureSeed.AddPictureItem(DbContext, category, "another-owner", true, shared.Value, b);
        await DbContext.SaveChangesAsync();
        FakeMediaObjectStore store = new(); store.Objects[a.ObjectKey!] = [1]; store.Objects[b.ObjectKey!] = [2];
        await MediaCleanupWorker.RunOnceAsync(DbContext, store, new MediaOptions { CleanupOwnerUserId = "owner" }, now, CancellationToken.None);
        await using var restarted = CreateDbContext();
        await MediaCleanupWorker.RunOnceAsync(restarted, store, new MediaOptions { CleanupOwnerUserId = "owner" }, now.AddMinutes(1), CancellationToken.None);
        (await restarted.MediaAssets.SingleAsync(x => x.Id == a.Id)).PurgedAt.Should().NotBeNull();
        MediaAsset sibling = await restarted.MediaAssets.SingleAsync(x => x.Id == b.Id);
        if (shared is null) { sibling.PurgedAt.Should().NotBeNull(); store.Objects.Should().NotContainKey(b.ObjectKey!); }
        else { sibling.DeletedAt.Should().BeNull(); sibling.PurgedAt.Should().BeNull(); store.Objects.Should().ContainKey(b.ObjectKey!); }
    }

    [Fact]
    public async Task CurrentRejectedWithoutDueDecisionAndCurrentPendingRemainProtected()
    {
        DateTime now = DateTime.UtcNow;
        var category = VisibilitySeed.AddCategory(DbContext);
        MediaAsset a = PictureSeed.AddAsset(DbContext, "owner"), b = PictureSeed.AddAsset(DbContext, "owner");
        a.CreatedAt = b.CreatedAt = now.AddDays(-10);
        PictureSeed.AddPictureItem(DbContext, category, "owner", true, ItemImageReviewState.Rejected, a);
        PictureSeed.AddPictureItem(DbContext, category, "owner", true, ItemImageReviewState.PendingReview, b);
        await DbContext.SaveChangesAsync();
        FakeMediaObjectStore store = new(); store.Objects[a.ObjectKey!] = [1]; store.Objects[b.ObjectKey!] = [2];
        (await MediaCleanupWorker.RunOnceAsync(DbContext, store, new MediaOptions { CleanupOwnerUserId = "owner" }, now, CancellationToken.None)).Should().Be(0);
        (await DbContext.MediaAssets.CountAsync(x => x.DeletedAt != null)).Should().Be(0);
    }

    [Fact]
    public async Task SameAssetInBothRejectedSlotsDeletesOnceAndDirectWithdrawalKeepsOriginalSchedule()
    {
        DateTime now = DateTime.UtcNow;
        var category = VisibilitySeed.AddCategory(DbContext);
        MediaAsset rejected = PictureSeed.AddAsset(DbContext, "owner"); rejected.CreatedAt = now.AddDays(-10);
        PictureSeed.AddPictureItem(DbContext, category, "owner", true, ItemImageReviewState.Rejected, rejected, rejected);
        foreach (var review in DbContext.ItemImageReviews.Local) review.DecidedAt = now.AddDays(-9);
        MediaAsset withdrawn = PictureSeed.AddAsset(DbContext, "owner"); withdrawn.CreatedAt = now.AddDays(-10); withdrawn.DeletedAt = now.AddDays(-1);
        DateTime original = withdrawn.DeletedAt.Value;
        await DbContext.SaveChangesAsync();
        int deletes = 0; FakeMediaObjectStore store = new(); store.Objects[rejected.ObjectKey!] = [1]; store.Objects[withdrawn.ObjectKey!] = [2]; store.OnDelete = _ => { deletes++; return Task.CompletedTask; };
        (await MediaCleanupWorker.RunOnceAsync(DbContext, store, new MediaOptions { CleanupOwnerUserId = "owner" }, now, CancellationToken.None)).Should().Be(1);
        deletes.Should().Be(1); withdrawn.DeletedAt.Should().Be(original); withdrawn.PurgedAt.Should().BeNull();
        await using var restarted = CreateDbContext();
        (await MediaCleanupWorker.RunOnceAsync(restarted, store, new MediaOptions { CleanupOwnerUserId = "owner" }, now.AddDays(7), CancellationToken.None)).Should().Be(1);
        (await restarted.MediaAssets.SingleAsync(x => x.Id == withdrawn.Id)).DeletedAt.Should().Be(original); deletes.Should().Be(2);
    }

    [Theory]
    [InlineData("missing-current-decision")]
    [InlineData("recent-current-rejection")]
    [InlineData("young-direct-tombstone")]
    public async Task DueCandidatesBeyondFiftyBlockedRowsArePurgedAcrossRestart(string blockedKind)
    {
        DateTime now = DateTime.UtcNow;
        var category = VisibilitySeed.AddCategory(DbContext);
        FakeMediaObjectStore store = new();
        List<Guid> blockedIds = [];
        for (int index = 0; index < 50; index++)
        {
            MediaAsset asset = PictureSeed.AddAsset(DbContext, "owner"); asset.CreatedAt = now.AddDays(-12);
            blockedIds.Add(asset.Id); store.Objects[asset.ObjectKey!] = [1];
            if (blockedKind == "young-direct-tombstone") asset.DeletedAt = now.AddDays(-1);
            else
            {
                Item item = PictureSeed.AddPictureItem(DbContext, category, "owner", true, ItemImageReviewState.Rejected, asset);
                ItemImageReview review = DbContext.ItemImageReviews.Local.Single(x => x.ItemId == item.Id);
                if (blockedKind == "missing-current-decision") DbContext.ItemImageReviews.Remove(review);
                else review.DecidedAt = now.AddDays(-1);
            }
        }
        List<Guid> protectedIds = [];
        foreach (ItemImageReviewState state in new[] { ItemImageReviewState.Approved, ItemImageReviewState.PendingReview })
        {
            MediaAsset asset = PictureSeed.AddAsset(DbContext, "owner"); asset.CreatedAt = now.AddDays(-13); protectedIds.Add(asset.Id); store.Objects[asset.ObjectKey!] = [2];
            PictureSeed.AddPictureItem(DbContext, category, "another-owner", true, state, asset);
        }
        MediaAsset foreign = PictureSeed.AddAsset(DbContext, "another-owner"); foreign.CreatedAt = now.AddDays(-13); protectedIds.Add(foreign.Id); store.Objects[foreign.ObjectKey!] = [3];
        MediaAsset due = PictureSeed.AddAsset(DbContext, "owner"); due.CreatedAt = now.AddDays(-9); store.Objects[due.ObjectKey!] = [4];
        MediaAsset dueWithdrawal = PictureSeed.AddAsset(DbContext, "owner"); dueWithdrawal.CreatedAt = now.AddDays(-8); dueWithdrawal.DeletedAt = now.AddDays(-8); store.Objects[dueWithdrawal.ObjectKey!] = [5];
        await DbContext.SaveChangesAsync();
        var audits = await DbContext.ItemImageReviews.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.ItemId, x.Revision, x.Decision, x.DecidedAt }).ToListAsync();
        MediaOptions options = new() { CleanupOwnerUserId = "owner" };
        (await MediaCleanupWorker.RunOnceAsync(DbContext, store, options, now, CancellationToken.None)).Should().Be(2, "blocked rows must not fill the fifty-row batch");
        store.Objects.Should().NotContainKey(due.ObjectKey!).And.NotContainKey(dueWithdrawal.ObjectKey!);
        await using var restarted = CreateDbContext();
        MediaAsset nextDue = PictureSeed.AddAsset(restarted, "owner"); nextDue.CreatedAt = now.AddDays(-8); store.Objects[nextDue.ObjectKey!] = [6]; await restarted.SaveChangesAsync();
        (await MediaCleanupWorker.RunOnceAsync(restarted, store, options, now.AddMinutes(1), CancellationToken.None)).Should().Be(1);
        store.Objects.Should().NotContainKey(nextDue.ObjectKey!);
        (await restarted.MediaAssets.AsNoTracking().Where(x => blockedIds.Contains(x.Id)).ToListAsync()).Should().HaveCount(50).And.OnlyContain(x => x.PurgedAt == null && x.DeleteAttempts == 0 && x.State == MediaAssetState.Ready && (blockedKind == "young-direct-tombstone" ? x.DeletedAt == now.AddDays(-1) : x.DeletedAt == null));
        (await restarted.MediaAssets.CountAsync(x => protectedIds.Contains(x.Id) && x.PurgedAt == null && x.DeletedAt == null)).Should().Be(3);
        (await restarted.ItemImageReviews.AsNoTracking().OrderBy(x => x.Id).Select(x => new { x.Id, x.ItemId, x.Revision, x.Decision, x.DecidedAt }).ToListAsync()).Should().BeEquivalentTo(audits);
        if (blockedKind != "young-direct-tombstone") (await restarted.Items.CountAsync(x => x.QuestionImageAssetId != null && blockedIds.Contains(x.QuestionImageAssetId.Value) && x.ImageReviewState == ItemImageReviewState.Rejected && x.ImageRevision == 1)).Should().Be(50);
        foreach (MediaAsset asset in await restarted.MediaAssets.Where(x => blockedIds.Contains(x.Id) || protectedIds.Contains(x.Id)).ToListAsync()) store.Objects.Should().ContainKey(asset.ObjectKey!);
    }
}
