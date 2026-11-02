using FluentAssertions;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Plans = Quizymode.Api.Features.StudyPlans.StudyPlans;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.Features.LearningLoop;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.StudyPlans;

/// <summary>#364: test-date plan rules at the handler level, with an injected clock for the date window.</summary>
public sealed class StudyPlansTests : DatabaseTestFixture
{
    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private static readonly DateTime Now = new(2026, 11, 2, 15, 30, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = new(2026, 11, 2);
    private static readonly IValidator<Plans.UpsertRequest> Validator =
        new Plans.UpsertValidator(new FixedTimeProvider(new DateTimeOffset(Now)));

    private static string Date(int daysFromToday) => Today.AddDays(daysFromToday).ToString("yyyy-MM-dd");

    private async Task<Collection> AddCollectionAsync(string ownerId, bool isPublic = true, string name = "Spanish basics")
    {
        Collection collection = new()
        {
            Id = Guid.NewGuid(),
            Name = name,
            CreatedBy = ownerId,
            CreatedAt = Now.AddDays(-30),
            IsPublic = isPublic
        };
        DbContext.Collections.Add(collection);
        await DbContext.SaveChangesAsync();
        return collection;
    }

    private Task<Result<Plans.StudyPlanDto>> PutAsync(string userId, Guid collectionId, string? date, DateTime? now = null) =>
        Plans.UpsertAsync(
            collectionId,
            new Plans.UpsertRequest(date),
            Validator,
            DbContext,
            LearningLoopTestData.User(userId),
            now ?? Now,
            CancellationToken.None);

    private Task<Plans.ListResponse> ListAsync(string userId, DateTime? now = null) =>
        Plans.ListAsync(DbContext, LearningLoopTestData.User(userId), now ?? Now, CancellationToken.None);

    private async Task AddSessionAsync(string userId, Guid collectionId, string mode, DateTime completedAt, string origin = StudySessionOrigins.Quiz, string sourceKind = "collection")
    {
        DbContext.StudySessions.Add(new StudySession
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            RunId = Guid.NewGuid().ToString(),
            Origin = origin,
            Mode = mode,
            CompletedAt = completedAt,
            CreatedAt = completedAt,
            Correct = 1,
            Total = 2,
            SourceKind = sourceKind,
            SourceCollectionId = collectionId
        });
        await DbContext.SaveChangesAsync();
    }

    [Fact]
    public async Task Upsert_CreatesPlan_AndIsIdempotent()
    {
        Collection collection = await AddCollectionAsync("owner");

        Result<Plans.StudyPlanDto> first = await PutAsync("user-a", collection.Id, Date(5));
        Result<Plans.StudyPlanDto> second = await PutAsync("user-a", collection.Id, Date(5));

        first.IsSuccess.Should().BeTrue();
        first.Value.TestDate.Should().Be(Date(5));
        first.Value.Available.Should().BeTrue();
        first.Value.CollectionName.Should().Be("Spanish basics");
        second.IsSuccess.Should().BeTrue();
        (await DbContext.StudyPlans.AsNoTracking().CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Upsert_ChangingDate_KeepsCreatedAt_AndAdvancesUpdatedAt()
    {
        Collection collection = await AddCollectionAsync("owner");
        await PutAsync("user-a", collection.Id, Date(5));

        DateTime later = Now.AddHours(3);
        Result<Plans.StudyPlanDto> changed = await PutAsync("user-a", collection.Id, Date(9), later);

        changed.IsSuccess.Should().BeTrue();
        changed.Value.TestDate.Should().Be(Date(9));
        changed.Value.CreatedAt.Should().Be(Now);
        StudyPlan row = await DbContext.StudyPlans.AsNoTracking().SingleAsync();
        row.CreatedAt.Should().Be(Now);
        row.UpdatedAt.Should().Be(later);
    }

    [Fact]
    public async Task Upsert_SixthPlan_FailsWithLimitReached_ButUpdatingAtCapSucceeds()
    {
        List<Collection> collections = [];
        for (int i = 0; i < 6; i++) collections.Add(await AddCollectionAsync("owner", name: $"C{i}"));
        for (int i = 0; i < 5; i++) (await PutAsync("user-a", collections[i].Id, Date(3 + i))).IsSuccess.Should().BeTrue();

        Result<Plans.StudyPlanDto> sixth = await PutAsync("user-a", collections[5].Id, Date(4));
        Result<Plans.StudyPlanDto> update = await PutAsync("user-a", collections[0].Id, Date(10));

        sixth.IsFailure.Should().BeTrue();
        sixth.Error.Type.Should().Be(ErrorType.Validation);
        sixth.Error.Code.Should().Be("StudyPlans.LimitReached");
        sixth.Error.Description.Should().Be("You can plan up to 5 tests at a time.");
        update.IsSuccess.Should().BeTrue();
        (await PutAsync("user-b", collections[5].Id, Date(4))).IsSuccess.Should().BeTrue("the cap is per user");
    }

    [Fact]
    public async Task Upsert_Cap_IgnoresHiddenPastPlans()
    {
        List<Collection> collections = [];
        for (int i = 0; i < 6; i++) collections.Add(await AddCollectionAsync("owner", name: $"C{i}"));
        // Five stored plans whose test date was yesterday (kept for the 2-day grace period but not "upcoming"),
        // plus four upcoming ones: only the upcoming ones count towards the cap.
        for (int i = 0; i < 4; i++) await PutAsync("user-a", collections[i].Id, Date(3 + i));
        DbContext.StudyPlans.Add(new StudyPlan
        {
            UserId = "user-a", CollectionId = collections[4].Id, TestDate = Today.AddDays(-1), CreatedAt = Now.AddDays(-9), UpdatedAt = Now.AddDays(-9)
        });
        await DbContext.SaveChangesAsync();

        Result<Plans.StudyPlanDto> fifthUpcoming = await PutAsync("user-a", collections[5].Id, Date(8));

        fifthUpcoming.IsSuccess.Should().BeTrue();
    }

    [Theory]
    [InlineData(-2, false)]
    [InlineData(-1, true)]
    [InlineData(0, true)]
    [InlineData(31, true)]
    [InlineData(32, false)]
    public async Task Upsert_EnforcesDateWindowAroundUtcToday(int offset, bool accepted)
    {
        Collection collection = await AddCollectionAsync("owner");

        Result<Plans.StudyPlanDto> result = await PutAsync("user-a", collection.Id, Date(offset));

        result.IsSuccess.Should().Be(accepted);
        if (!accepted)
        {
            result.Error.Type.Should().Be(ErrorType.Validation);
            result.Error.Code.Should().Be("StudyPlans.InvalidDate");
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("11/09/2026")]
    [InlineData("2026-13-40")]
    [InlineData("2026-11-9")]
    public async Task Upsert_MalformedDate_IsRejected(string? date)
    {
        Collection collection = await AddCollectionAsync("owner");

        Result<Plans.StudyPlanDto> result = await PutAsync("user-a", collection.Id, date);

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("StudyPlans.InvalidDate");
    }

    [Fact]
    public async Task Upsert_InvalidDate_IsReportedBeforeCollectionLookup()
    {
        Result<Plans.StudyPlanDto> result = await PutAsync("user-a", Guid.NewGuid(), "nope");

        result.Error.Type.Should().Be(ErrorType.Validation);
    }

    [Fact]
    public async Task Upsert_MissingAndOthersPrivateCollection_AreIndistinguishableNotFound()
    {
        Collection privateCollection = await AddCollectionAsync("owner", isPublic: false);

        Result<Plans.StudyPlanDto> missing = await PutAsync("user-a", Guid.NewGuid(), Date(3));
        Result<Plans.StudyPlanDto> hidden = await PutAsync("user-a", privateCollection.Id, Date(3));
        Result<Plans.StudyPlanDto> own = await PutAsync("owner", privateCollection.Id, Date(3));

        missing.Error.Type.Should().Be(ErrorType.NotFound);
        hidden.Error.Type.Should().Be(ErrorType.NotFound);
        hidden.Error.Code.Should().Be(missing.Error.Code);
        hidden.Error.Description.Should().Be(missing.Error.Description);
        own.IsSuccess.Should().BeTrue("owners can plan their private collections");
        (await DbContext.StudyPlans.AsNoTracking().CountAsync(p => p.UserId == "user-a")).Should().Be(0);
    }

    [Fact]
    public async Task Upsert_PublicCollectionOfAnotherUser_IsAllowed()
    {
        Collection collection = await AddCollectionAsync("owner", isPublic: true);

        (await PutAsync("user-a", collection.Id, Date(3))).IsSuccess.Should().BeTrue();
    }

    [Fact]
    public async Task List_OrdersByTestDateThenCreatedAt_AndPrunesPlansPastGracePeriod()
    {
        Collection later = await AddCollectionAsync("owner", name: "Later");
        Collection sooner = await AddCollectionAsync("owner", name: "Sooner");
        Collection old = await AddCollectionAsync("owner", name: "Old");
        Collection yesterday = await AddCollectionAsync("owner", name: "Yesterday");
        await PutAsync("user-a", later.Id, Date(10));
        await PutAsync("user-a", sooner.Id, Date(2));
        DbContext.StudyPlans.AddRange(
            new StudyPlan { UserId = "user-a", CollectionId = old.Id, TestDate = Today.AddDays(-3), CreatedAt = Now.AddDays(-20), UpdatedAt = Now.AddDays(-20) },
            new StudyPlan { UserId = "user-a", CollectionId = yesterday.Id, TestDate = Today.AddDays(-2), CreatedAt = Now.AddDays(-20), UpdatedAt = Now.AddDays(-20) },
            new StudyPlan { UserId = "user-b", CollectionId = old.Id, TestDate = Today.AddDays(-3), CreatedAt = Now.AddDays(-20), UpdatedAt = Now.AddDays(-20) });
        await DbContext.SaveChangesAsync();

        Plans.ListResponse response = await ListAsync("user-a");

        response.Plans.Select(p => p.CollectionName).Should().Equal("Yesterday", "Sooner", "Later");
        (await DbContext.StudyPlans.AsNoTracking().AnyAsync(p => p.UserId == "user-a" && p.CollectionId == old.Id)).Should().BeFalse();
        (await DbContext.StudyPlans.AsNoTracking().AnyAsync(p => p.UserId == "user-b" && p.CollectionId == old.Id)).Should().BeTrue(
            "pruning only touches the caller's rows");
    }

    [Fact]
    public async Task List_ReportsItemCount_AndOnlyTheCallersPlans()
    {
        Collection collection = await AddCollectionAsync("owner");
        DbContext.CollectionItems.AddRange(
            new CollectionItem { Id = Guid.NewGuid(), CollectionId = collection.Id, ItemId = Guid.NewGuid(), AddedAt = Now },
            new CollectionItem { Id = Guid.NewGuid(), CollectionId = collection.Id, ItemId = Guid.NewGuid(), AddedAt = Now });
        await DbContext.SaveChangesAsync();
        await PutAsync("user-a", collection.Id, Date(4));
        await PutAsync("user-b", collection.Id, Date(6));

        Plans.ListResponse response = await ListAsync("user-a");

        response.Plans.Should().ContainSingle();
        response.Plans[0].ItemCount.Should().Be(2);
        response.Plans[0].TestDate.Should().Be(Date(4));
    }

    [Fact]
    public async Task List_ActivityIsScopedToCallerCollectionKindAndWindow()
    {
        Collection collection = await AddCollectionAsync("owner");
        Collection otherCollection = await AddCollectionAsync("owner", name: "Other");
        await PutAsync("user-a", collection.Id, Date(10));

        DateTime inWindowLearn = Now.AddDays(-13);
        DateTime inWindowQuiz = Now.AddHours(-2);
        await AddSessionAsync("user-a", collection.Id, StudySessionModes.Learn, Now.AddDays(-15));      // before the 14-day window
        await AddSessionAsync("user-a", collection.Id, StudySessionModes.Learn, inWindowLearn + TimeSpan.FromHours(5));
        await AddSessionAsync("user-a", collection.Id, StudySessionModes.Learn, inWindowLearn);
        await AddSessionAsync("user-a", collection.Id, StudySessionModes.Quiz, inWindowQuiz);
        await AddSessionAsync("user-a", otherCollection.Id, StudySessionModes.Learn, Now.AddHours(-1)); // other collection
        await AddSessionAsync("user-b", collection.Id, StudySessionModes.Learn, Now.AddHours(-1));      // other user
        await AddSessionAsync("user-a", collection.Id, StudySessionModes.Learn, Now.AddMinutes(-5), sourceKind: "category"); // other scope

        Plans.StudyPlanDto plan = (await ListAsync("user-a")).Plans.Single();

        plan.FirstLearnAt.Should().Be(inWindowLearn);
        plan.LastActivityAt.Should().Be(inWindowQuiz);
        plan.FirstLearnAt!.Value.Kind.Should().Be(DateTimeKind.Utc);
    }

    [Fact]
    public async Task List_ActivityCoversBothModes_AndImportedGuestRuns()
    {
        Collection collection = await AddCollectionAsync("owner");
        await PutAsync("user-a", collection.Id, Date(10));
        DateTime imported = Now.AddDays(-3);
        await AddSessionAsync("user-a", collection.Id, StudySessionModes.Learn, imported, StudySessionOrigins.GuestImport);

        Plans.StudyPlanDto plan = (await ListAsync("user-a")).Plans.Single();

        plan.FirstLearnAt.Should().Be(imported);
        plan.LastActivityAt.Should().Be(imported);
    }

    [Fact]
    public async Task List_QuizOnlyActivity_HasNoFirstLearn()
    {
        Collection collection = await AddCollectionAsync("owner");
        await PutAsync("user-a", collection.Id, Date(10));
        await AddSessionAsync("user-a", collection.Id, StudySessionModes.Quiz, Now.AddHours(-1));

        Plans.StudyPlanDto plan = (await ListAsync("user-a")).Plans.Single();

        plan.FirstLearnAt.Should().BeNull();
        plan.LastActivityAt.Should().NotBeNull();
    }

    [Fact]
    public async Task List_NoActivity_ReportsNulls()
    {
        Collection collection = await AddCollectionAsync("owner");
        await PutAsync("user-a", collection.Id, Date(10));

        Plans.StudyPlanDto plan = (await ListAsync("user-a")).Plans.Single();

        plan.FirstLearnAt.Should().BeNull();
        plan.LastActivityAt.Should().BeNull();
    }

    [Fact]
    public async Task List_ActivityBeforePlanWindow_IsIgnoredEvenIfOtherPlanIsOlder()
    {
        Collection oldPlanCollection = await AddCollectionAsync("owner", name: "Old plan");
        Collection newPlanCollection = await AddCollectionAsync("owner", name: "New plan");
        await PutAsync("user-a", oldPlanCollection.Id, Date(20), Now.AddDays(-30));
        await PutAsync("user-a", newPlanCollection.Id, Date(20), Now);
        await AddSessionAsync("user-a", newPlanCollection.Id, StudySessionModes.Learn, Now.AddDays(-20));

        Plans.ListResponse response = await ListAsync("user-a");

        response.Plans.Single(p => p.CollectionName == "New plan").FirstLearnAt.Should().BeNull();
    }

    [Fact]
    public async Task List_CollectionTurnedPrivate_IsUnavailableWithoutNameCountOrActivity()
    {
        Collection collection = await AddCollectionAsync("owner", isPublic: true, name: "Secret name");
        DbContext.CollectionItems.Add(new CollectionItem { Id = Guid.NewGuid(), CollectionId = collection.Id, ItemId = Guid.NewGuid(), AddedAt = Now });
        await DbContext.SaveChangesAsync();
        await PutAsync("user-a", collection.Id, Date(4));
        await AddSessionAsync("user-a", collection.Id, StudySessionModes.Learn, Now.AddHours(-1));
        collection.IsPublic = false;
        await DbContext.SaveChangesAsync();

        Plans.StudyPlanDto plan = (await ListAsync("user-a")).Plans.Single();

        plan.Available.Should().BeFalse();
        plan.CollectionName.Should().BeNull();
        plan.ItemCount.Should().Be(0);
        plan.FirstLearnAt.Should().BeNull();
        plan.LastActivityAt.Should().BeNull();
    }

    [Fact]
    public async Task List_DeletedCollection_IsUnavailable()
    {
        Collection collection = await AddCollectionAsync("owner");
        await PutAsync("user-a", collection.Id, Date(4));
        DbContext.Collections.Remove(collection);
        await DbContext.SaveChangesAsync();

        Plans.StudyPlanDto plan = (await ListAsync("user-a")).Plans.Single();

        plan.Available.Should().BeFalse();
        plan.CollectionName.Should().BeNull();
    }

    [Fact]
    public async Task Delete_IsIdempotent_AndOnlyRemovesCallersPlan()
    {
        Collection collection = await AddCollectionAsync("owner");
        await PutAsync("user-a", collection.Id, Date(4));
        await PutAsync("user-b", collection.Id, Date(4));

        await Plans.DeleteAsync(collection.Id, DbContext, "user-a", CancellationToken.None);
        await Plans.DeleteAsync(collection.Id, DbContext, "user-a", CancellationToken.None);
        await Plans.DeleteAsync(Guid.NewGuid(), DbContext, "user-a", CancellationToken.None);

        StudyPlan remaining = await DbContext.StudyPlans.AsNoTracking().SingleAsync();
        remaining.UserId.Should().Be("user-b");
    }
}
