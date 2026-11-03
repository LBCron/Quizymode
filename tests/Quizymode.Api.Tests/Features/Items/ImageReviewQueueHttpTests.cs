using System.Net;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Items.ImageReview;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Items;

/// <summary>#401 (AC 3.26): the admin picture review queue over real HTTP with the production JWT pipeline.</summary>
public sealed class ImageReviewQueueHttpTests : ItemTestFixture, IAsyncLifetime
{
    private static readonly string[] AdminGroups = ["Admins"];

    private JwtHttpTestHost _host = null!;
    private Guid _ownerId;
    private Guid _adminId;
    private Category _category = null!;

    public async Task InitializeAsync()
    {
        _host = await JwtHttpTestHost.StartAsync(
            CreateDbContext,
            services =>
            {
                services.AddScoped<IValidator<GetImageReviewQueue.QueryRequest>, GetImageReviewQueue.Validator>();
                services.AddScoped<IValidator<SetItemImageReview.Request>, SetItemImageReview.Validator>();
            },
            app =>
            {
                new GetImageReviewQueue.Endpoint().MapEndpoint(app);
                new SetItemImageReview.Endpoint().MapEndpoint(app);
            });

        _ownerId = Guid.NewGuid();
        _adminId = Guid.NewGuid();
        DbContext.Users.AddRange(
            new User { Id = _ownerId, Subject = "owner-sub", Email = "owner@example.com", Name = "owner" },
            new User { Id = _adminId, Subject = "admin-sub", Email = "admin@example.com", Name = "admin" },
            new User { Id = Guid.NewGuid(), Subject = "admin2-sub", Email = "admin2@example.com", Name = "admin2" });
        await DbContext.SaveChangesAsync();
        await EnsureGeographyPublicWithNavAsync(_ownerId.ToString());
        _category = await DbContext.Categories.FirstAsync(c => c.Name == "geography");
    }

    public async Task DisposeAsync() => await _host.DisposeAsync();

    private string Owner => _ownerId.ToString();

    private string OwnerToken => _host.CreateToken("owner-sub", "owner@example.com");

    private string AdminToken => _host.CreateToken("admin-sub", "admin@example.com", AdminGroups);

    private string Admin2Token => _host.CreateToken("admin2-sub", "admin2@example.com", AdminGroups);

    private async Task<(HttpStatusCode Status, string Body)> SendAsync(HttpMethod method, string path, string? json = null, string? token = null)
    {
        using StringContent? content = json is null ? null : new StringContent(json, Encoding.UTF8, "application/json");
        using HttpRequestMessage request = JwtHttpTestHost.Request(method, path, token, content);
        using HttpResponseMessage response = await _host.Client.SendAsync(request);
        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    private static JsonElement Json(string body) => JsonDocument.Parse(body).RootElement.Clone();

    private async Task<Item> SeedAsync(
        ItemImageReviewState state,
        bool isPrivate = false,
        bool readyForReview = false,
        DateTime? submittedAt = null,
        bool withExplanation = false)
    {
        MediaAsset question = PictureSeed.AddAsset(DbContext, Owner);
        MediaAsset? explanation = withExplanation ? PictureSeed.AddAsset(DbContext, Owner) : null;
        Item item = PictureSeed.AddPictureItem(DbContext, _category, Owner, isPrivate, state, question, explanation);
        item.ReadyForReview = readyForReview;
        await DbContext.SaveChangesAsync();
        if (submittedAt is not null)
        {
            await SetSubmittedAtAsync(item.Id, 1, submittedAt.Value);
        }

        return item;
    }

    private async Task SetSubmittedAtAsync(Guid itemId, int revision, DateTime at)
    {
        await using ApplicationDbContext db = CreateDbContext();
        await db.ItemImageReviews.Where(r => r.ItemId == itemId && r.Revision == revision)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.SubmittedAt, at));
    }

    private async Task<JsonElement> QueueAsync(string query = "", string? token = null)
    {
        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, "/admin/items/image-review" + query, token: token ?? AdminToken);
        status.Should().Be(HttpStatusCode.OK, body);
        return Json(body);
    }

    private static List<string> Ids(JsonElement queue) =>
        queue.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()!).ToList();

    [Fact]
    public async Task Queue_Anonymous_Returns401()
    {
        (HttpStatusCode status, _) = await SendAsync(HttpMethod.Get, "/admin/items/image-review");

        status.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Queue_NonAdmin_Returns403()
    {
        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, "/admin/items/image-review", token: OwnerToken);

        status.Should().Be(HttpStatusCode.Forbidden, body);
    }

    [Fact]
    public async Task Queue_ListsOldestSubmissionFirst_AcrossPages_WithTotalsAndOldest()
    {
        DateTime baseTime = DateTime.UtcNow.AddDays(-3);
        Item newest = await SeedAsync(ItemImageReviewState.PendingReview, submittedAt: baseTime.AddHours(5));
        Item oldest = await SeedAsync(ItemImageReviewState.PendingReview, submittedAt: baseTime);
        Item middle = await SeedAsync(ItemImageReviewState.PendingReview, submittedAt: baseTime.AddHours(2));

        JsonElement page1 = await QueueAsync("?pageSize=2&page=1");
        JsonElement page2 = await QueueAsync("?pageSize=2&page=2");

        Ids(page1).Should().Equal(oldest.Id.ToString(), middle.Id.ToString());
        Ids(page2).Should().Equal(newest.Id.ToString());
        page1.GetProperty("totalCount").GetInt32().Should().Be(3);
        page1.GetProperty("totalPages").GetInt32().Should().Be(2);
        page2.GetProperty("page").GetInt32().Should().Be(2);
        page1.GetProperty("oldestSubmittedAt").GetDateTime().Should().BeCloseTo(baseTime, TimeSpan.FromSeconds(1));
        page1.GetProperty("items")[0].GetProperty("ageSeconds").GetInt64().Should().BeGreaterThan(2 * 24 * 3600);
    }

    [Fact]
    public async Task Queue_DefaultsToPendingReview_AndFiltersByState()
    {
        Item pending = await SeedAsync(ItemImageReviewState.PendingReview);
        Item approved = await SeedAsync(ItemImageReviewState.Approved);
        Item rejected = await SeedAsync(ItemImageReviewState.Rejected);

        Ids(await QueueAsync()).Should().Equal(pending.Id.ToString());
        Ids(await QueueAsync("?state=Rejected")).Should().Equal(rejected.Id.ToString());
        Ids(await QueueAsync("?state=approved")).Should().Equal(approved.Id.ToString());
        Ids(await QueueAsync("?state=Withdrawn")).Should().BeEmpty();
        JsonElement empty = await QueueAsync("?state=Withdrawn");
        empty.GetProperty("totalCount").GetInt32().Should().Be(0);
        empty.GetProperty("oldestSubmittedAt").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Theory]
    [InlineData("?state=Bogus")]
    [InlineData("?state=1")]
    [InlineData("?state=Superseded")]
    public async Task Queue_InvalidState_Returns400(string query)
    {
        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, "/admin/items/image-review" + query, token: AdminToken);

        status.Should().Be(HttpStatusCode.BadRequest, body);
    }

    [Fact]
    public async Task Queue_ClampsPageSize()
    {
        await SeedAsync(ItemImageReviewState.PendingReview);

        JsonElement queue = await QueueAsync("?pageSize=5000");

        queue.GetProperty("pageSize").GetInt32().Should().Be(100);
    }

    [Fact]
    public async Task Queue_ListsPrivateAndPublic_RegardlessOfItemReviewState_WithRowDetails()
    {
        Item privateItem = await SeedAsync(ItemImageReviewState.PendingReview, isPrivate: true, readyForReview: false, withExplanation: true);
        Item publicItem = await SeedAsync(ItemImageReviewState.PendingReview, isPrivate: false, readyForReview: true);

        JsonElement queue = await QueueAsync();

        Ids(queue).Should().BeEquivalentTo([privateItem.Id.ToString(), publicItem.Id.ToString()]);
        JsonElement row = queue.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("id").GetString() == privateItem.Id.ToString());
        row.GetProperty("isPrivate").GetBoolean().Should().BeTrue();
        row.GetProperty("readyForReview").GetBoolean().Should().BeFalse();
        row.GetProperty("category").GetString().Should().Be("geography");
        row.GetProperty("createdBy").GetString().Should().Be(Owner);
        row.GetProperty("questionImage").GetProperty("key").GetString().Should().StartWith("media:");
        row.GetProperty("explanationImage").GetProperty("key").GetString().Should().StartWith("media:");
        JsonElement review = row.GetProperty("imageReview");
        review.GetProperty("state").GetString().Should().Be("PendingReview");
        review.GetProperty("revision").GetInt32().Should().Be(1);
        review.GetProperty("submittedBy").GetString().Should().Be(Owner);
        review.GetProperty("submittedByDisplay").GetString().Should().Be("owner@example.com");
        queue.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("id").GetString() == publicItem.Id.ToString())
            .GetProperty("readyForReview").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Queue_ShowsTheCurrentRevisionsSubmission_AfterAResubmit()
    {
        Item item = await SeedAsync(ItemImageReviewState.PendingReview, submittedAt: DateTime.UtcNow.AddDays(-5));
        DateTime resubmittedAt = DateTime.UtcNow.AddHours(-1);
        await using (ApplicationDbContext db = CreateDbContext())
        {
            db.ItemImageReviews.Add(new ItemImageReview
            {
                Id = Guid.NewGuid(), ItemId = item.Id, Revision = 2, ContentHash = new string('e', 64), SubmittedBy = Owner,
                SubmittedAt = resubmittedAt
            });
            await db.Items.Where(i => i.Id == item.Id).ExecuteUpdateAsync(s => s.SetProperty(i => i.ImageRevision, 2));
            await db.SaveChangesAsync();
        }

        JsonElement queue = await QueueAsync();

        JsonElement review = queue.GetProperty("items").EnumerateArray().Single().GetProperty("imageReview");
        review.GetProperty("revision").GetInt32().Should().Be(2);
        review.GetProperty("submittedAt").GetDateTime().Should().BeCloseTo(resubmittedAt, TimeSpan.FromSeconds(1));
        queue.GetProperty("oldestSubmittedAt").GetDateTime().Should().BeCloseTo(resubmittedAt, TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task Queue_ListsAnItemWhoseAuditRowIsMissing_First()
    {
        Item withRow = await SeedAsync(ItemImageReviewState.PendingReview, submittedAt: DateTime.UtcNow.AddDays(-1));
        Item withoutRow = await SeedAsync(ItemImageReviewState.PendingReview);
        await using (ApplicationDbContext db = CreateDbContext())
        {
            await db.ItemImageReviews.Where(r => r.ItemId == withoutRow.Id).ExecuteDeleteAsync();
        }

        JsonElement queue = await QueueAsync();

        Ids(queue).Should().Equal(withoutRow.Id.ToString(), withRow.Id.ToString());
        queue.GetProperty("items")[0].GetProperty("ageSeconds").ValueKind.Should().Be(JsonValueKind.Null);
        queue.GetProperty("items")[0].GetProperty("imageReview").GetProperty("submittedAt").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Decision_ThenQueue_RemovesTheItemFromPending_AndRepeatingTheSameDecisionIsIdempotent()
    {
        Item item = await SeedAsync(ItemImageReviewState.PendingReview);
        string approve = "{\"decision\":\"approve\",\"expectedRevision\":1}";

        (HttpStatusCode first, string firstBody) = await SendAsync(HttpMethod.Put, $"/admin/items/{item.Id}/image-review", approve, AdminToken);
        (HttpStatusCode again, string againBody) = await SendAsync(HttpMethod.Put, $"/admin/items/{item.Id}/image-review", approve, Admin2Token);

        first.Should().Be(HttpStatusCode.OK, firstBody);
        again.Should().Be(HttpStatusCode.OK, againBody);
        Ids(await QueueAsync()).Should().BeEmpty();
        Ids(await QueueAsync("?state=Approved")).Should().Equal(item.Id.ToString());
    }

    [Fact]
    public async Task Decision_TwoAdminsWithConflictingDecisions_SecondGets409Stale()
    {
        Item item = await SeedAsync(ItemImageReviewState.PendingReview);

        (HttpStatusCode reject, string rejectBody) = await SendAsync(
            HttpMethod.Put, $"/admin/items/{item.Id}/image-review", "{\"decision\":\"reject\",\"expectedRevision\":1,\"reason\":\"Blurry\"}", AdminToken);
        (HttpStatusCode approve, string approveBody) = await SendAsync(
            HttpMethod.Put, $"/admin/items/{item.Id}/image-review", "{\"decision\":\"approve\",\"expectedRevision\":1}", Admin2Token);

        reject.Should().Be(HttpStatusCode.OK, rejectBody);
        approve.Should().Be(HttpStatusCode.Conflict, approveBody);
        approveBody.Should().Contain("Item.ImageReviewStale");
        Json(approveBody).GetProperty("currentState").GetString().Should().Be("Rejected");
        JsonElement rejected = (await QueueAsync("?state=Rejected")).GetProperty("items").EnumerateArray().Single();
        rejected.GetProperty("imageReview").GetProperty("reason").GetString().Should().Be("Blurry");
    }
}
