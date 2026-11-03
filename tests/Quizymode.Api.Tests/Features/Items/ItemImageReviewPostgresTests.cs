using System.Data.Common;
using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Categories;
using Quizymode.Api.Features.Featured;
using Quizymode.Api.Features.Items.ImageReview;
using Quizymode.Api.Features.Items.Update;
using Quizymode.Api.Features.Keywords;
using Quizymode.Api.Features.Search;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Shared.Options;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Items;

/// <summary>
/// #400 (AC 3.25) on real PostgreSQL: the migration's check constraints and foreign keys (SQLite strips check constraints), the raw-SQL and
/// Dapper read surfaces, and the revision claim under real row locks: decision against decision, and edit against decision in both
/// orders. Requires Docker.
/// </summary>
[Trait("Category", "Postgres")]
public sealed class ItemImageReviewPostgresTests(PostgresContainerFixture fixture) : IClassFixture<PostgresContainerFixture>
{
    private static readonly string[] AdminGroups = ["Admins"];

    private static readonly TaxonomyRegistry Registry = new(
        new TestHostEnvironment(),
        Options.Create(new TaxonomyOptions()),
        NullLogger<TaxonomyRegistry>.Instance);

    private void RequireDatabase() => Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);

    // ---- schema ------------------------------------------------------------------------------------------------------

    private static (Item Item, MediaAsset Asset) PendingUploadItem(ApplicationDbContext db)
    {
        Category category = VisibilitySeed.AddCategory(db);
        MediaAsset asset = PictureSeed.AddAsset(db, "owner");
        Item item = VisibilitySeed.AddItem(db, category, "owner", false);
        item.QuestionImageAssetId = asset.Id;
        item.QuestionImageKey = $"media:{asset.Id:N}";
        item.QuestionImageAlt = "alt";
        item.ImageReviewState = ItemImageReviewState.PendingReview;
        item.ImageRevision = 1;
        return (item, asset);
    }

    private async Task<bool> SavesAsync(Action<ApplicationDbContext, Item, MediaAsset> mutate)
    {
        await using ApplicationDbContext db = fixture.CreateDbContext();
        (Item item, MediaAsset asset) = PendingUploadItem(db);
        mutate(db, item, asset);
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
    public async Task Migration_AddsColumnsAndTable_AndAValidUploadItemRoundTrips()
    {
        RequireDatabase();
        Guid id;
        await using (ApplicationDbContext db = fixture.CreateDbContext())
        {
            (Item item, MediaAsset asset) = PendingUploadItem(db);
            item.QuestionImageAttribution = "Photo by A";
            item.ExplanationImageAssetId = asset.Id;
            item.ExplanationImageKey = $"media:{asset.Id:N}";
            item.ExplanationImageAlt = "second slot, same asset";
            id = item.Id;
            await db.SaveChangesAsync();
        }

        await using (ApplicationDbContext db = fixture.CreateDbContext())
        {
            Item saved = await db.Items.AsNoTracking().SingleAsync(i => i.Id == id);
            saved.ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
            saved.ImageRevision.Should().Be(1);
            saved.QuestionImageAttribution.Should().Be("Photo by A");
            saved.QuestionImageAssetId.Should().Be(saved.ExplanationImageAssetId, "one asset may fill both slots");

            string state = await db.Database.SqlQueryRaw<string>(
                "SELECT \"ImageReviewState\" AS \"Value\" FROM \"Items\" WHERE \"Id\" = {0}", id).SingleAsync();
            state.Should().Be("PendingReview", "the state is stored as text");

            List<string> types = await db.Database.SqlQueryRaw<string>(
                "SELECT column_name || ':' || data_type || ':' || COALESCE(character_maximum_length::text, '') AS \"Value\" " +
                "FROM information_schema.columns WHERE table_name = 'Items' AND column_name IN " +
                "('QuestionImageAssetId','ExplanationImageAssetId','QuestionImageAttribution','ExplanationImageAttribution','ImageReviewState','ImageRevision') " +
                "ORDER BY column_name").ToListAsync();
            types.Should().Equal(
                "ExplanationImageAssetId:uuid:",
                "ExplanationImageAttribution:character varying:300",
                "ImageReviewState:character varying:20",
                "ImageRevision:integer:",
                "QuestionImageAssetId:uuid:",
                "QuestionImageAttribution:character varying:300");
        }

        await using ApplicationDbContext plain = fixture.CreateDbContext();
        Category category = VisibilitySeed.AddCategory(plain);
        Item textOnly = VisibilitySeed.AddItem(plain, category, "owner", false);
        await plain.SaveChangesAsync();
        Item defaults = await plain.Items.AsNoTracking().SingleAsync(i => i.Id == textOnly.Id);
        defaults.ImageRevision.Should().Be(0);
        defaults.ImageReviewState.Should().BeNull();
    }

    [SkippableFact]
    public async Task CheckConstraints_TieKeyToAssetAndStateToAssets()
    {
        RequireDatabase();

        (await SavesAsync((_, _, _) => { })).Should().BeTrue("a consistent upload item");
        (await SavesAsync((_, item, _) => item.QuestionImageKey = $"media:{Guid.NewGuid():N}")).Should().BeFalse("the key must be the asset's own key");
        (await SavesAsync((_, item, _) => item.QuestionImageKey = "curated:flags/fr")).Should().BeFalse("an upload slot cannot hold a curated key");
        (await SavesAsync((_, item, _) => item.QuestionImageKey = null)).Should().BeFalse("an asset id needs its key");
        (await SavesAsync((_, item, _) =>
        {
            item.QuestionImageAssetId = null;
            item.ImageReviewState = null;
        })).Should().BeFalse("a media: key needs an asset id");
        (await SavesAsync((_, item, asset) =>
        {
            item.ExplanationImageAssetId = asset.Id;
            item.ExplanationImageKey = $"media:{Guid.NewGuid():N}";
            item.ExplanationImageAlt = "x";
        })).Should().BeFalse("the explanation slot has the same rule");
        (await SavesAsync((_, item, _) => item.ImageReviewState = null)).Should().BeFalse("an upload needs a review state");
        (await SavesAsync((_, item, _) =>
        {
            item.QuestionImageAssetId = null;
            item.QuestionImageKey = null;
            item.QuestionImageAlt = null;
        })).Should().BeFalse("a state needs an upload");
        (await SavesAsync((_, item, _) =>
        {
            item.QuestionImageAssetId = null;
            item.QuestionImageKey = "curated:flags/fr";
            item.QuestionImageAlt = "Three bands";
            item.ImageReviewState = null;
        })).Should().BeTrue("a curated picture has no review state");
        (await SavesAsync((_, item, _) =>
        {
            item.QuestionImageAssetId = null;
            item.QuestionImageKey = "curated:flags/fr";
            item.QuestionImageAlt = "Three bands";
        })).Should().BeFalse("a curated picture cannot carry a review state");
        (await SavesAsync((_, item, _) => item.QuestionImageAssetId = Guid.NewGuid())).Should().BeFalse("the asset must exist");
    }

    [SkippableFact]
    public async Task StateColumn_RejectsUnknownText_AndAnAssetInUseCannotBeDeleted()
    {
        RequireDatabase();
        Guid itemId;
        Guid assetId;
        await using (ApplicationDbContext db = fixture.CreateDbContext())
        {
            (Item item, MediaAsset asset) = PendingUploadItem(db);
            itemId = item.Id;
            assetId = asset.Id;
            await db.SaveChangesAsync();
        }

        await using ApplicationDbContext verify = fixture.CreateDbContext();
        Func<Task> badState = () => verify.Database.ExecuteSqlRawAsync(
            "UPDATE \"Items\" SET \"ImageReviewState\" = 'Bogus' WHERE \"Id\" = {0}", itemId);
        await badState.Should().ThrowAsync<Exception>();
        foreach (string good in new[] { "PendingReview", "Approved", "Rejected", "Withdrawn" })
        {
            (await verify.Database.ExecuteSqlRawAsync(
                "UPDATE \"Items\" SET \"ImageReviewState\" = {0} WHERE \"Id\" = {1}", good, itemId)).Should().Be(1);
        }

        Func<Task> deleteAsset = () => verify.Database.ExecuteSqlRawAsync("DELETE FROM \"MediaAssets\" WHERE \"Id\" = {0}", assetId);
        await deleteAsset.Should().ThrowAsync<Exception>("the foreign key restricts deletes");
    }

    [SkippableFact]
    public async Task ReviewTrail_IsUniquePerItemRevision_AndSurvivesItemDeletion()
    {
        RequireDatabase();
        Guid itemId = Guid.NewGuid();
        ItemImageReview Row(int revision) => new()
        {
            Id = Guid.NewGuid(),
            ItemId = itemId,
            Revision = revision,
            ContentHash = new string('a', 64),
            SubmittedBy = "owner",
            SubmittedAt = DateTime.UtcNow
        };

        await using (ApplicationDbContext db = fixture.CreateDbContext())
        {
            db.ItemImageReviews.AddRange(Row(1), Row(2));
            await db.SaveChangesAsync();
        }

        await using (ApplicationDbContext db = fixture.CreateDbContext())
        {
            db.ItemImageReviews.Add(Row(2));
            Func<Task> duplicate = () => db.SaveChangesAsync();
            DbUpdateException ex = (await duplicate.Should().ThrowAsync<DbUpdateException>()).Which;
            Quizymode.Api.Shared.Helpers.ItemImageReviewRules.IsRevisionConflict(ex).Should().BeTrue();
        }

        await using ApplicationDbContext verify = fixture.CreateDbContext();
        (await verify.ItemImageReviews.CountAsync(r => r.ItemId == itemId)).Should().Be(2, "there is no foreign key to Items");
    }

    // ---- raw SQL and Dapper read surfaces ----------------------------------------------------------------------------------

    private static async Task<(Category Category, Item Approved, Item Pending, Item Rejected, Item TextOnly)> SeedMixedAsync(ApplicationDbContext db, string owner)
    {
        Category category = VisibilitySeed.AddCategory(db);
        Item approved = PictureSeed.AddPictureItem(db, category, owner, false, ItemImageReviewState.Approved, PictureSeed.AddAsset(db, owner));
        Item pending = PictureSeed.AddPictureItem(db, category, owner, false, ItemImageReviewState.PendingReview, PictureSeed.AddAsset(db, owner));
        Item rejected = PictureSeed.AddPictureItem(db, category, owner, false, ItemImageReviewState.Rejected, PictureSeed.AddAsset(db, owner));
        Item textOnly = VisibilitySeed.AddItem(db, category, owner, false);
        await db.SaveChangesAsync();
        return (category, approved, pending, rejected, textOnly);
    }

    [SkippableFact]
    public async Task GetCategories_RawSqlCounts_ExcludeUnapprovedItemsForOthers_NotForTheCreator()
    {
        RequireDatabase();
        string owner = Guid.NewGuid().ToString();
        await using ApplicationDbContext db = fixture.CreateDbContext();
        (Category category, _, _, _, _) = await SeedMixedAsync(db, owner);

        async Task<int> CountAsync(IUserContext caller)
        {
            Quizymode.Api.Shared.Kernel.Result<GetCategories.Response> result = await GetCategories.HandleAsync(
                new GetCategories.QueryRequest(category.Name), db, caller, NullLogger<GetCategories.Endpoint>.Instance, CancellationToken.None);
            result.IsSuccess.Should().BeTrue();
            return result.Value.Categories.Single(c => c.Id == category.Id).Count;
        }

        (await CountAsync(FakeUserContext.Anonymous)).Should().Be(2);
        (await CountAsync(FakeUserContext.User(Guid.NewGuid().ToString()))).Should().Be(2);
        (await CountAsync(FakeUserContext.User(owner))).Should().Be(4);
    }

    [SkippableFact]
    public async Task GetItemTagKeywords_IgnoresUnapprovedItemsForOthers()
    {
        RequireDatabase();
        string owner = Guid.NewGuid().ToString();
        await using ApplicationDbContext db = fixture.CreateDbContext();
        (Category category, Item approved, Item pending, Item rejected, _) = await SeedMixedAsync(db, owner);
        Keyword onApproved = new() { Id = Guid.NewGuid(), Name = $"ok-{Guid.NewGuid():N}"[..20], IsPrivate = false, CreatedBy = "seed", CreatedAt = DateTime.UtcNow };
        Keyword onPending = new() { Id = Guid.NewGuid(), Name = $"hid-{Guid.NewGuid():N}"[..20], IsPrivate = false, CreatedBy = "seed", CreatedAt = DateTime.UtcNow };
        db.Keywords.AddRange(onApproved, onPending);
        db.ItemKeywords.AddRange(
            new ItemKeyword { Id = Guid.NewGuid(), ItemId = approved.Id, KeywordId = onApproved.Id, AddedAt = DateTime.UtcNow },
            new ItemKeyword { Id = Guid.NewGuid(), ItemId = pending.Id, KeywordId = onPending.Id, AddedAt = DateTime.UtcNow },
            new ItemKeyword { Id = Guid.NewGuid(), ItemId = rejected.Id, KeywordId = onPending.Id, AddedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();

        async Task<List<string>> TagsAsync(IUserContext caller)
        {
            var result = await GetItemTagKeywords.HandleAsync(category.Name, db, caller, CancellationToken.None);
            result.IsSuccess.Should().BeTrue();
            return result.Value.Names;
        }

        (await TagsAsync(FakeUserContext.Anonymous)).Should().Contain(onApproved.Name).And.NotContain(onPending.Name);
        (await TagsAsync(FakeUserContext.User(Guid.NewGuid().ToString()))).Should().Contain(onApproved.Name).And.NotContain(onPending.Name);
        (await TagsAsync(FakeUserContext.User(owner))).Should().Contain(onApproved.Name).And.Contain(onPending.Name);
    }

    [SkippableFact]
    public async Task GetFeatured_SetAndCollectionCounts_ExcludeUnapprovedItems()
    {
        RequireDatabase();
        string owner = Guid.NewGuid().ToString();
        await using ApplicationDbContext db = fixture.CreateDbContext();
        (Category category, Item approved, Item pending, _, Item textOnly) = await SeedMixedAsync(db, owner);
        Collection collection = VisibilitySeed.AddCollection(db, owner, true);
        VisibilitySeed.Link(db, collection, approved);
        VisibilitySeed.Link(db, collection, pending);
        VisibilitySeed.Link(db, collection, textOnly);
        FeaturedItem set = new() { Id = Guid.NewGuid(), Type = FeaturedItemType.Set, DisplayName = "set", CategorySlug = category.Name.ToLowerInvariant(), CreatedBy = "admin" };
        FeaturedItem featuredCollection = new() { Id = Guid.NewGuid(), Type = FeaturedItemType.Collection, DisplayName = "col", CollectionId = collection.Id, CreatedBy = "admin" };
        db.FeaturedItems.AddRange(set, featuredCollection);
        await db.SaveChangesAsync();

        var result = await GetFeatured.HandleAsync(db, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.Sets.Single(s => s.Id == set.Id).ItemCount.Should().Be(2, "approved and text-only; pending and rejected are hidden");
        result.Value.Collections.Single(c => c.Id == featuredCollection.Id).ItemCount.Should().Be(2);
    }

    [SkippableFact]
    public async Task GlobalSearch_ItemsAndCollectionItemCounts_ExcludeUnapprovedItems()
    {
        RequireDatabase();
        string word = "zq" + new string(Guid.NewGuid().ToByteArray().Take(8).Select(b => (char)('a' + (b % 26))).ToArray());
        Guid ownerId = Guid.NewGuid();
        string owner = ownerId.ToString();
        await using ApplicationDbContext db = fixture.CreateDbContext();
        (_, Item approved, Item pending, Item rejected, Item textOnly) = await SeedMixedAsync(db, owner);
        foreach ((Item item, string label) in new[] { (approved, "approved"), (pending, "pending"), (rejected, "rejected"), (textOnly, "plain") })
        {
            item.Question = $"{word} {label}";
        }

        Collection collection = new() { Id = Guid.NewGuid(), Name = $"{word} shelf", CreatedBy = owner, IsPublic = true, IsDiscoverable = true };
        db.Collections.Add(collection);
        foreach (Item item in new[] { approved, pending, rejected, textOnly })
        {
            VisibilitySeed.Link(db, collection, item);
        }

        await db.SaveChangesAsync();

        await using JwtHttpTestHost host = await JwtHttpTestHost.StartAsync(
            () => fixture.CreateDbContext(),
            services =>
            {
                services.AddMemoryCache();
                services.AddSingleton<ITaxonomySearchIndex>(_ => new TaxonomySearchIndex(Registry));
                services.AddSingleton<TaxonomySearchCounts>();
            },
            app => new GlobalSearch.Endpoint().MapEndpoint(app),
            useUserUpsertMiddleware: true);

        using HttpRequestMessage request = JwtHttpTestHost.Request(HttpMethod.Get, $"/search?q={word}%20&limit=20");
        using HttpResponseMessage response = await host.Client.SendAsync(request);
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        JsonElement groups = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("groups");

        groups.GetProperty("items").GetProperty("results").EnumerateArray()
            .Select(e => e.GetProperty("snippet").GetProperty("text").GetString()).Should().BeEquivalentTo([$"{word} approved", $"{word} plain"]);
        groups.GetProperty("collections").GetProperty("results").EnumerateArray().Single().GetProperty("itemCount").GetInt32()
            .Should().Be(2, "pending and rejected items are not counted");
    }

    // ---- concurrency: decision against decision, edit against decision --------------------------------------------------

    /// <summary>Runs a hook right before or right after the revision-claim UPDATE of PUT /items/{id} (the one that writes the asset columns).</summary>
    private sealed class ClaimHook : DbCommandInterceptor
    {
        public Func<Task>? BeforeClaim { get; set; }

        public Func<Task>? AfterClaim { get; set; }

        private static bool IsClaim(DbCommand command) =>
            command.CommandText.Contains("UPDATE \"Items\"", StringComparison.Ordinal)
            && command.CommandText.Contains("\"QuestionImageAssetId\"", StringComparison.Ordinal);

        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (IsClaim(command) && BeforeClaim is { } hook)
            {
                BeforeClaim = null;
                await hook();
            }

            return result;
        }

        public override async ValueTask<int> NonQueryExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (IsClaim(command) && AfterClaim is { } hook)
            {
                AfterClaim = null;
                await hook();
            }

            return result;
        }
    }

    private sealed class Scenario : IAsyncDisposable
    {
        public required JwtHttpTestHost Host { get; init; }

        public required ClaimHook Hook { get; init; }

        public required Guid OwnerId { get; init; }

        public required Guid AdminId { get; init; }

        public string OwnerToken => Host.CreateToken($"owner-{OwnerId}", $"{OwnerId}@example.test");

        public string AdminToken => Host.CreateToken($"admin-{AdminId}", $"{AdminId}@example.test", AdminGroups);

        public async ValueTask DisposeAsync() => await Host.DisposeAsync();
    }

    private async Task<Scenario> StartScenarioAsync()
    {
        RequireDatabase();
        Guid ownerId = Guid.NewGuid();
        Guid adminId = Guid.NewGuid();
        await using (ApplicationDbContext db = fixture.CreateDbContext())
        {
            db.Users.AddRange(
                new User { Id = ownerId, Subject = $"owner-{ownerId}", Email = $"{ownerId}@example.test", Name = $"owner-{ownerId}" },
                new User { Id = adminId, Subject = $"admin-{adminId}", Email = $"{adminId}@example.test", Name = $"admin-{adminId}" });
            await EnsureGeographyAsync(db);
            await db.SaveChangesAsync();
        }

        ClaimHook hook = new();
        JwtHttpTestHost host = await JwtHttpTestHost.StartAsync(
            () => fixture.CreateDbContext(hook),
            services =>
            {
                services.AddScoped<IValidator<UpdateItem.Request>, UpdateItem.Validator>();
                services.AddScoped<IValidator<SetItemImageReview.Request>, SetItemImageReview.Validator>();
                services.AddSingleton<ISimHashService>(new SimHashService());
                services.AddSingleton<ITaxonomyRegistry>(Registry);
                services.AddScoped<ITaxonomyItemCategoryResolver>(sp =>
                    new TaxonomyItemCategoryResolver(sp.GetRequiredService<ApplicationDbContext>(), Registry));
            },
            app =>
            {
                new UpdateItem.Endpoint().MapEndpoint(app);
                new SetItemImageReview.Endpoint().MapEndpoint(app);
            });
        return new Scenario { Host = host, Hook = hook, OwnerId = ownerId, AdminId = adminId };
    }

    private static async Task EnsureGeographyAsync(ApplicationDbContext db)
    {
        Category? category = await db.Categories.FirstOrDefaultAsync(c => c.Name == "geography");
        if (category is null)
        {
            category = new Category { Id = Guid.NewGuid(), Name = "geography", IsPrivate = false, CreatedBy = "seed", CreatedAt = DateTime.UtcNow };
            db.Categories.Add(category);
        }

        Keyword? k1 = await db.Keywords.FirstOrDefaultAsync(k => k.Name == "capitals" && !k.IsPrivate);
        if (k1 is null)
        {
            k1 = new Keyword { Id = Guid.NewGuid(), Name = "capitals", IsPrivate = false, CreatedBy = "seed", CreatedAt = DateTime.UtcNow };
            db.Keywords.Add(k1);
        }

        Keyword? k2 = await db.Keywords.FirstOrDefaultAsync(k => k.Name == "europe" && !k.IsPrivate);
        if (k2 is null)
        {
            k2 = new Keyword { Id = Guid.NewGuid(), Name = "europe", IsPrivate = false, CreatedBy = "seed", CreatedAt = DateTime.UtcNow };
            db.Keywords.Add(k2);
        }

        await db.SaveChangesAsync();
        if (!await db.KeywordRelations.AnyAsync(kr => kr.CategoryId == category.Id && kr.ParentKeywordId == null && kr.ChildKeywordId == k1.Id))
        {
            db.KeywordRelations.Add(new KeywordRelation { Id = Guid.NewGuid(), CategoryId = category.Id, ParentKeywordId = null, ChildKeywordId = k1.Id, SortOrder = 0, CreatedAt = DateTime.UtcNow });
        }

        if (!await db.KeywordRelations.AnyAsync(kr => kr.CategoryId == category.Id && kr.ParentKeywordId == k1.Id && kr.ChildKeywordId == k2.Id))
        {
            db.KeywordRelations.Add(new KeywordRelation { Id = Guid.NewGuid(), CategoryId = category.Id, ParentKeywordId = k1.Id, ChildKeywordId = k2.Id, SortOrder = 0, CreatedAt = DateTime.UtcNow });
        }

        await db.SaveChangesAsync();
    }

    private async Task<(Item Item, MediaAsset Asset)> SeedPendingAsync(Scenario scenario)
    {
        await using ApplicationDbContext db = fixture.CreateDbContext();
        Category category = await db.Categories.FirstAsync(c => c.Name == "geography");
        MediaAsset asset = PictureSeed.AddAsset(db, scenario.OwnerId.ToString());
        Item item = PictureSeed.AddPictureItem(db, category, scenario.OwnerId.ToString(), true, ItemImageReviewState.PendingReview, asset);
        item.Question = "Which flag?";
        item.CorrectAnswer = "France";
        item.IncorrectAnswers = ["Italy"];
        await db.SaveChangesAsync();
        return (item, asset);
    }

    private static string PutBody(MediaAsset asset, string question) =>
        "{\"category\":\"geography\",\"navigationKeyword1\":\"capitals\",\"navigationKeyword2\":\"europe\",\"isPrivate\":true," +
        $"\"question\":\"{question}\",\"correctAnswer\":\"France\",\"incorrectAnswers\":[\"Italy\"],\"explanation\":\"\"," +
        $"\"questionImage\":{{\"assetId\":\"{asset.Id}\",\"altText\":\"A question picture\"}}}}";

    private static async Task<(HttpStatusCode Status, string Body)> SendAsync(JwtHttpTestHost host, HttpMethod method, string path, string json, string token)
    {
        using StringContent content = new(json, Encoding.UTF8, "application/json");
        using HttpRequestMessage request = JwtHttpTestHost.Request(method, path, token, content);
        using HttpResponseMessage response = await host.Client.SendAsync(request);
        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    private static Task<(HttpStatusCode Status, string Body)> DecideAsync(Scenario s, Guid itemId, string decision, int revision) =>
        SendAsync(s.Host, HttpMethod.Put, $"/admin/items/{itemId}/image-review",
            $"{{\"decision\":\"{decision}\",\"expectedRevision\":{revision}" + (decision == "reject" ? ",\"reason\":\"No\"" : "") + "}", s.AdminToken);

    private async Task WaitUntilABackendWaitsOnALockAsync()
    {
        await using ApplicationDbContext db = fixture.CreateDbContext();
        for (int attempt = 0; attempt < 100; attempt++)
        {
            int waiting = await db.Database.SqlQueryRaw<int>(
                "SELECT count(*)::int AS \"Value\" FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'").SingleAsync();
            if (waiting > 0)
            {
                return;
            }

            await Task.Delay(100);
        }

        throw new TimeoutException("No backend ever waited on a row lock.");
    }

    [SkippableFact]
    public async Task DecisionCommitsFirst_ThenTheEdit_ClaimsTheNextRevision_AndResubmits()
    {
        await using Scenario s = await StartScenarioAsync();
        (Item item, MediaAsset asset) = await SeedPendingAsync(s);
        (HttpStatusCode Status, string Body) decision = default;
        s.Hook.BeforeClaim = async () => decision = await DecideAsync(s, item.Id, "approve", 1);

        (HttpStatusCode editStatus, string editBody) = await SendAsync(s.Host, HttpMethod.Put, $"/items/{item.Id}", PutBody(asset, "Edited?"), s.OwnerToken);

        decision.Status.Should().Be(HttpStatusCode.OK, decision.Body);
        editStatus.Should().Be(HttpStatusCode.OK, editBody);
        await using ApplicationDbContext db = fixture.CreateDbContext();
        Item final = await db.Items.AsNoTracking().SingleAsync(i => i.Id == item.Id);
        final.ImageReviewState.Should().Be(ItemImageReviewState.PendingReview, "the edit changed reviewed content after the decision");
        final.ImageRevision.Should().Be(2);
        final.Question.Should().Be("Edited?");
        List<ItemImageReview> rows = await db.ItemImageReviews.AsNoTracking().Where(r => r.ItemId == item.Id).OrderBy(r => r.Revision).ToListAsync();
        rows.Select(r => (r.Revision, r.Decision)).Should().Equal((1, "Approved"), (2, null));
    }

    [SkippableFact]
    public async Task EditClaimsFirst_ThenTheDecision_IsRefusedAsStale_AndNothingIsApproved()
    {
        await using Scenario s = await StartScenarioAsync();
        (Item item, MediaAsset asset) = await SeedPendingAsync(s);
        Task<(HttpStatusCode Status, string Body)>? decision = null;
        s.Hook.AfterClaim = async () =>
        {
            decision = DecideAsync(s, item.Id, "approve", 1);
            await WaitUntilABackendWaitsOnALockAsync();
        };

        (HttpStatusCode editStatus, string editBody) = await SendAsync(s.Host, HttpMethod.Put, $"/items/{item.Id}", PutBody(asset, "Edited?"), s.OwnerToken);

        editStatus.Should().Be(HttpStatusCode.OK, editBody);
        decision.Should().NotBeNull();
        (HttpStatusCode decisionStatus, string decisionBody) = await decision!;
        decisionStatus.Should().Be(HttpStatusCode.Conflict, decisionBody);
        JsonElement problem = JsonDocument.Parse(decisionBody).RootElement;
        problem.GetProperty("title").GetString().Should().Be("Item.ImageReviewStale");
        problem.GetProperty("currentRevision").GetInt32().Should().Be(2);
        problem.GetProperty("currentState").GetString().Should().Be("PendingReview");
        await using ApplicationDbContext db = fixture.CreateDbContext();
        Item final = await db.Items.AsNoTracking().SingleAsync(i => i.Id == item.Id);
        final.ImageReviewState.Should().Be(ItemImageReviewState.PendingReview);
        final.ImageRevision.Should().Be(2);
        (await db.ItemImageReviews.AsNoTracking().Where(r => r.ItemId == item.Id).OrderBy(r => r.Revision).Select(r => r.Decision).ToListAsync())
            .Should().Equal("Superseded", null);
    }

    [SkippableFact]
    public async Task TwoEditsRacing_TheSecondIsRefusedAsStale_AndExactlyOneRevisionIsClaimed()
    {
        await using Scenario s = await StartScenarioAsync();
        (Item item, MediaAsset asset) = await SeedPendingAsync(s);
        Task<(HttpStatusCode Status, string Body)>? second = null;
        s.Hook.AfterClaim = async () =>
        {
            second = SendAsync(s.Host, HttpMethod.Put, $"/items/{item.Id}", PutBody(asset, "Second?"), s.OwnerToken);
            await WaitUntilABackendWaitsOnALockAsync();
        };

        (HttpStatusCode firstStatus, string firstBody) = await SendAsync(s.Host, HttpMethod.Put, $"/items/{item.Id}", PutBody(asset, "First?"), s.OwnerToken);

        firstStatus.Should().Be(HttpStatusCode.OK, firstBody);
        (HttpStatusCode secondStatus, string secondBody) = await second!;
        secondStatus.Should().Be(HttpStatusCode.Conflict, secondBody);
        JsonDocument.Parse(secondBody).RootElement.GetProperty("title").GetString().Should().Be("Item.ImageReviewStale");
        await using ApplicationDbContext db = fixture.CreateDbContext();
        Item final = await db.Items.AsNoTracking().SingleAsync(i => i.Id == item.Id);
        final.Question.Should().Be("First?", "the refused edit changed nothing");
        final.ImageRevision.Should().Be(2);
        (await db.ItemImageReviews.CountAsync(r => r.ItemId == item.Id)).Should().Be(2);
    }

    [SkippableTheory]
    [InlineData("approve", "approve")]
    [InlineData("reject", "reject")]
    [InlineData("approve", "reject")]
    public async Task TwoDecisionsRacing_RecordExactlyOneDecision(string first, string second)
    {
        await using Scenario s = await StartScenarioAsync();
        (Item item, _) = await SeedPendingAsync(s);
        TaskCompletionSource gate = new(TaskCreationOptions.RunContinuationsAsynchronously);

        Task<(HttpStatusCode Status, string Body)> A = Task.Run(async () => { await gate.Task; return await DecideAsync(s, item.Id, first, 1); });
        Task<(HttpStatusCode Status, string Body)> B = Task.Run(async () => { await gate.Task; return await DecideAsync(s, item.Id, second, 1); });
        gate.SetResult();
        (HttpStatusCode Status, string Body)[] outcomes = await Task.WhenAll(A, B);

        await using ApplicationDbContext db = fixture.CreateDbContext();
        Item final = await db.Items.AsNoTracking().SingleAsync(i => i.Id == item.Id);
        ItemImageReview row = await db.ItemImageReviews.AsNoTracking().SingleAsync(r => r.ItemId == item.Id);
        final.ImageRevision.Should().Be(1);
        row.Decision.Should().Be(final.ImageReviewState == ItemImageReviewState.Approved ? "Approved" : "Rejected");
        row.DecidedBy.Should().Be(s.AdminId.ToString());
        if (first == second)
        {
            outcomes.Should().OnlyContain(o => o.Status == HttpStatusCode.OK, "an identical decision is idempotent");
        }
        else
        {
            outcomes.Count(o => o.Status == HttpStatusCode.OK).Should().Be(1);
            outcomes.Count(o => o.Status == HttpStatusCode.Conflict).Should().Be(1);
        }
    }
}
