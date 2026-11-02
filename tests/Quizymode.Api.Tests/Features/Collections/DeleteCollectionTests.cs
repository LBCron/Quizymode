using FluentAssertions;
using Moq;
using Quizymode.Api.Features.Collections;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Collections;

public sealed class DeleteCollectionTests : DatabaseTestFixture
{
    private async Task<Collection> CreateCollectionAsync(string userId, bool isPublic = false)
    {
        Collection col = new()
        {
            Id = Guid.NewGuid(),
            Name = "Test",
            CreatedBy = userId,
            CreatedAt = DateTime.UtcNow,
            IsPublic = isPublic
        };
        DbContext.Collections.Add(col);
        await DbContext.SaveChangesAsync();
        return col;
    }

    private Mock<IUserContext> UserContext(string userId)
    {
        Mock<IUserContext> ctx = new();
        ctx.SetupGet(x => x.UserId).Returns(userId);
        ctx.SetupGet(x => x.IsAuthenticated).Returns(true);
        return ctx;
    }

    [Fact]
    public async Task HandleAsync_DeletesCollection_WhenOwner()
    {
        string userId = Guid.NewGuid().ToString();
        Collection col = await CreateCollectionAsync(userId);

        var result = await DeleteCollection.HandleAsync(col.Id.ToString(), DbContext, UserContext(userId).Object, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        DbContext.Collections.Should().NotContain(c => c.Id == col.Id);
    }

    [Fact]
    public async Task HandleAsync_AlsoDeletesCollectionItems_WhenDeleting()
    {
        string userId = Guid.NewGuid().ToString();
        Collection col = await CreateCollectionAsync(userId);

        DbContext.CollectionItems.Add(new CollectionItem
        {
            Id = Guid.NewGuid(),
            CollectionId = col.Id,
            ItemId = Guid.NewGuid(),
            AddedAt = DateTime.UtcNow
        });
        await DbContext.SaveChangesAsync();

        var result = await DeleteCollection.HandleAsync(col.Id.ToString(), DbContext, UserContext(userId).Object, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        DbContext.CollectionItems.Should().NotContain(ci => ci.CollectionId == col.Id);
    }

    [Fact]
    public async Task HandleAsync_AlsoDeletesEveryUsersStudyPlans_WhenDeleting()
    {
        string userId = Guid.NewGuid().ToString();
        Collection col = await CreateCollectionAsync(userId, isPublic: true);
        Collection other = await CreateCollectionAsync(userId, isPublic: true);
        DateOnly testDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(5);
        DbContext.StudyPlans.AddRange(
            new StudyPlan { UserId = userId, CollectionId = col.Id, TestDate = testDate, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
            new StudyPlan { UserId = "another-user", CollectionId = col.Id, TestDate = testDate, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow },
            new StudyPlan { UserId = userId, CollectionId = other.Id, TestDate = testDate, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
        await DbContext.SaveChangesAsync();

        var result = await DeleteCollection.HandleAsync(col.Id.ToString(), DbContext, UserContext(userId).Object, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        DbContext.StudyPlans.Should().NotContain(p => p.CollectionId == col.Id);
        DbContext.StudyPlans.Should().ContainSingle(p => p.CollectionId == other.Id);
    }

    [Fact]
    public async Task HandleAsync_AlsoDeletesBookmarks_WhenDeleting()
    {
        string userId = Guid.NewGuid().ToString();
        Collection col = await CreateCollectionAsync(userId);

        DbContext.CollectionBookmarks.Add(new CollectionBookmark
        {
            Id = Guid.NewGuid(),
            CollectionId = col.Id,
            UserId = "some-user",
            CreatedAt = DateTime.UtcNow
        });
        await DbContext.SaveChangesAsync();

        await DeleteCollection.HandleAsync(col.Id.ToString(), DbContext, UserContext(userId).Object, CancellationToken.None);

        DbContext.CollectionBookmarks.Should().NotContain(b => b.CollectionId == col.Id);
    }

    [Fact]
    public async Task HandleAsync_ReturnsNotFound_WhenCollectionDoesNotExist()
    {
        var result = await DeleteCollection.HandleAsync(
            Guid.NewGuid().ToString(),
            DbContext,
            UserContext(Guid.NewGuid().ToString()).Object,
            CancellationToken.None);

        result.IsFailure.Should().BeTrue();
        result.Error.Type.Should().Be(ErrorType.NotFound);
    }

    [Theory]
    [InlineData(false, "Collection.NotFound")]
    [InlineData(true, "Collection.Forbidden")]
    public async Task HandleAsync_NonOwner_ReturnsNotFoundForPrivate_ForbiddenForPublic(bool isPublic, string code)
    {
        string ownerId = Guid.NewGuid().ToString();
        Collection col = await CreateCollectionAsync(ownerId, isPublic);

        var result = await DeleteCollection.HandleAsync(
            col.Id.ToString(),
            DbContext,
            UserContext(Guid.NewGuid().ToString()).Object,
            CancellationToken.None);

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be(code);
        DbContext.Collections.Should().ContainSingle(c => c.Id == col.Id);
    }

    [Theory]
    [InlineData(null, false, "Collection.NotFound")]
    [InlineData("", false, "Collection.NotFound")]
    [InlineData(null, true, "Collection.Forbidden")]
    [InlineData("", true, "Collection.Forbidden")]
    public async Task HandleAsync_NullOrEmptyUserId_IsNonOwner(string? userId, bool isPublic, string code)
    {
        Collection col = await CreateCollectionAsync(string.Empty, isPublic);
        Mock<IUserContext> ctx = new();
        ctx.SetupGet(x => x.UserId).Returns(userId);
        ctx.SetupGet(x => x.IsAuthenticated).Returns(true);

        var result = await DeleteCollection.HandleAsync(col.Id.ToString(), DbContext, ctx.Object, CancellationToken.None);

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be(code);
        DbContext.Collections.Should().ContainSingle(c => c.Id == col.Id);
    }

    [Fact]
    public async Task HandleAsync_ReturnsValidation_WhenIdIsNotGuid()
    {
        var result = await DeleteCollection.HandleAsync(
            "not-a-guid",
            DbContext,
            UserContext(Guid.NewGuid().ToString()).Object,
            CancellationToken.None);

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("Collection.InvalidId");
    }
}
