using System.Net;
using System.Text.Json;
using FluentAssertions;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Games.GetRoster;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Games;

/// <summary>
/// #381: GET /games/roster over real HTTP with the production JWT bearer pipeline and PostgreSQL:
/// anonymous access, 400 validation and per-caller visibility. Requires Docker.
/// </summary>
[Trait("Category", "Postgres")]
public sealed class GameRosterHttpTests(PostgresContainerFixture fixture) : IClassFixture<PostgresContainerFixture>
{
    private async Task<JwtHttpTestHost> StartAsync()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        return await JwtHttpTestHost.StartAsync(
            () => fixture.CreateDbContext(),
            _ => { },
            app => new GetGameRoster.Endpoint().MapEndpoint(app),
            useUserUpsertMiddleware: true);
    }

    private async Task<(string Token, Guid UserId)> SeedUserAsync(JwtHttpTestHost host)
    {
        string subject = Guid.NewGuid().ToString();
        string email = $"{subject}@example.test";
        User user = new() { Id = Guid.NewGuid(), Subject = subject, Email = email, Name = subject };
        await using ApplicationDbContext db = fixture.CreateDbContext();
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (host.CreateToken(subject, email, emailVerified: true), user.Id);
    }

    private static async Task<JsonElement> GetJsonAsync(JwtHttpTestHost host, string url, string? token, HttpStatusCode expected)
    {
        using HttpRequestMessage request = JwtHttpTestHost.Request(HttpMethod.Get, url, token);
        using HttpResponseMessage response = await host.Client.SendAsync(request);
        response.StatusCode.Should().Be(expected);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private static HashSet<string> ItemIds(JsonElement body) =>
        body.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("id").GetString()!).ToHashSet();

    [SkippableTheory]
    [InlineData("/games/roster?limit=0")]
    [InlineData("/games/roster?limit=201")]
    [InlineData("/games/roster?scope=a/b/c/d")]
    [InlineData("/games/roster?scope=a//c")]
    [InlineData("/games/roster?scope=")]
    [InlineData("/games/roster?scope=a&scope=b&scope=c&scope=d&scope=e&scope=f&scope=g&scope=h&scope=i&scope=j&scope=k")]
    public async Task InvalidRequests_Return400(string url)
    {
        await using JwtHttpTestHost host = await StartAsync();

        await GetJsonAsync(host, url, null, HttpStatusCode.BadRequest);
    }

    [SkippableFact]
    public async Task SegmentOver100Chars_Returns400()
    {
        await using JwtHttpTestHost host = await StartAsync();

        await GetJsonAsync(host, $"/games/roster?scope={new string('a', 101)}", null, HttpStatusCode.BadRequest);
    }

    [SkippableFact]
    public async Task Anonymous_GetsPublicItemsOnly_WithScopeSummary()
    {
        await using JwtHttpTestHost host = await StartAsync();
        Category category;
        Item publicItem;
        await using (ApplicationDbContext db = fixture.CreateDbContext())
        {
            category = VisibilitySeed.AddCategory(db);
            publicItem = VisibilitySeed.AddItem(db, category, "someone", false);
            VisibilitySeed.AddItem(db, category, "someone", true);
            await db.SaveChangesAsync();
        }

        JsonElement body = await GetJsonAsync(
            host, $"/games/roster?scope={Uri.EscapeDataString(category.Name)}", null, HttpStatusCode.OK);

        ItemIds(body).Should().BeEquivalentTo([publicItem.Id.ToString()]);
        JsonElement scope = body.GetProperty("scopes").EnumerateArray().Single();
        scope.GetProperty("scope").GetString().Should().Be(category.Name);
        scope.GetProperty("available").GetInt32().Should().Be(1);
        scope.GetProperty("returned").GetInt32().Should().Be(1);
        scope.GetProperty("status").GetString().Should().Be("ok");
    }

    [SkippableFact]
    public async Task PrivateItems_AreReturnedToTheirOwnerOnly()
    {
        await using JwtHttpTestHost host = await StartAsync();
        (string ownerToken, Guid ownerId) = await SeedUserAsync(host);
        (string otherToken, _) = await SeedUserAsync(host);
        Category category;
        Item publicItem;
        Item privateItem;
        await using (ApplicationDbContext db = fixture.CreateDbContext())
        {
            category = VisibilitySeed.AddCategory(db);
            publicItem = VisibilitySeed.AddItem(db, category, "someone", false);
            privateItem = VisibilitySeed.AddItem(db, category, ownerId.ToString(), true);
            await db.SaveChangesAsync();
        }

        string url = $"/games/roster?scope={Uri.EscapeDataString(category.Name)}";

        ItemIds(await GetJsonAsync(host, url, ownerToken, HttpStatusCode.OK))
            .Should().BeEquivalentTo([publicItem.Id.ToString(), privateItem.Id.ToString()]);
        ItemIds(await GetJsonAsync(host, url, otherToken, HttpStatusCode.OK))
            .Should().BeEquivalentTo([publicItem.Id.ToString()]);
        ItemIds(await GetJsonAsync(host, url, null, HttpStatusCode.OK))
            .Should().BeEquivalentTo([publicItem.Id.ToString()]);
    }

    [SkippableFact]
    public async Task UnapprovedUploadedPictureItems_AreOmittedAndNotCountedForANonOwner()
    {
        await using JwtHttpTestHost host = await StartAsync();
        (string ownerToken, Guid ownerId) = await SeedUserAsync(host);
        (string otherToken, _) = await SeedUserAsync(host);
        Category category;
        Item textItem;
        Item pending;
        await using (ApplicationDbContext db = fixture.CreateDbContext())
        {
            category = VisibilitySeed.AddCategory(db);
            textItem = VisibilitySeed.AddItem(db, category, ownerId.ToString(), false);
            pending = PictureSeed.AddPictureItem(db, category, ownerId.ToString(), false, ItemImageReviewState.PendingReview, PictureSeed.AddAsset(db, ownerId.ToString()));
            await db.SaveChangesAsync();
        }

        string url = $"/games/roster?scope={Uri.EscapeDataString(category.Name)}";

        JsonElement other = await GetJsonAsync(host, url, otherToken, HttpStatusCode.OK);
        JsonElement owner = await GetJsonAsync(host, url, ownerToken, HttpStatusCode.OK);

        ItemIds(other).Should().BeEquivalentTo([textItem.Id.ToString()]).And.NotContain(pending.Id.ToString());
        other.GetProperty("scopes").EnumerateArray().Single().GetProperty("excludedPictures").GetInt32().Should().Be(0);
        ItemIds(owner).Should().NotContain(pending.Id.ToString());
    }
}
