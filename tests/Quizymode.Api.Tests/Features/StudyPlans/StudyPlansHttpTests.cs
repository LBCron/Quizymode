using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Plans = Quizymode.Api.Features.StudyPlans.StudyPlans;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.StudyPlans;

/// <summary>#364: authorization and per-user isolation of the study-plan endpoints with real JWT validation.</summary>
public sealed class StudyPlansHttpTests : DatabaseTestFixture, IAsyncLifetime
{
    private JwtHttpTestHost _host = null!;

    public async Task InitializeAsync()
    {
        _host = await JwtHttpTestHost.StartAsync(
            CreateDbContext,
            services =>
            {
                services.AddSingleton(TimeProvider.System);
                services.AddScoped<IValidator<Plans.UpsertRequest>, Plans.UpsertValidator>();
            },
            app => new Plans.Endpoint().MapEndpoint(app));
    }

    public async Task DisposeAsync() => await _host.DisposeAsync();

    private static string DateFromToday(int days) =>
        DateOnly.FromDateTime(DateTime.UtcNow).AddDays(days).ToString("yyyy-MM-dd");

    private async Task<(HttpStatusCode Status, string Body)> SendAsync(HttpMethod method, string url, string? token, object? body = null)
    {
        using HttpRequestMessage request = JwtHttpTestHost.Request(method, url, token);
        if (body is not null) request.Content = JsonContent.Create(body);
        using HttpResponseMessage response = await _host.Client.SendAsync(request);
        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    private async Task<Collection> AddCollectionAsync(string ownerId, bool isPublic, string name = "Secret collection name")
    {
        Collection collection = new()
        {
            Id = Guid.NewGuid(),
            Name = name,
            CreatedBy = ownerId,
            CreatedAt = DateTime.UtcNow.AddDays(-5),
            IsPublic = isPublic
        };
        DbContext.Collections.Add(collection);
        await DbContext.SaveChangesAsync();
        return collection;
    }

    /// <summary>The API user id (not the JWT subject) the host's user upsert assigned to this token's subject.</summary>
    private async Task<string> UserIdOfAsync(string subject, string token)
    {
        await SendAsync(HttpMethod.Get, "/study-plans", token);
        return (await DbContext.Users.AsNoTracking().SingleAsync(u => u.Subject == subject)).Id.ToString();
    }

    [Fact]
    public async Task Anonymous_IsRejectedOnAllEndpoints()
    {
        Guid id = Guid.NewGuid();

        (await SendAsync(HttpMethod.Get, "/study-plans", null)).Status.Should().Be(HttpStatusCode.Unauthorized);
        (await SendAsync(HttpMethod.Put, $"/study-plans/{id}", null, new { testDate = DateFromToday(3) })).Status.Should().Be(HttpStatusCode.Unauthorized);
        (await SendAsync(HttpMethod.Delete, $"/study-plans/{id}", null)).Status.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Member_CanRoundTripAPlan()
    {
        string token = _host.CreateToken("member-a", "a@example.com");
        Collection collection = await AddCollectionAsync("owner", isPublic: true, name: "Public set");

        (HttpStatusCode put, string putBody) = await SendAsync(HttpMethod.Put, $"/study-plans/{collection.Id}", token, new { testDate = DateFromToday(4) });
        (HttpStatusCode list, string listBody) = await SendAsync(HttpMethod.Get, "/study-plans", token);

        put.Should().Be(HttpStatusCode.OK, putBody);
        list.Should().Be(HttpStatusCode.OK);
        using JsonDocument doc = JsonDocument.Parse(listBody);
        JsonElement plan = doc.RootElement.GetProperty("plans")[0];
        plan.GetProperty("collectionId").GetGuid().Should().Be(collection.Id);
        plan.GetProperty("testDate").GetString().Should().Be(DateFromToday(4));
        plan.GetProperty("firstLearnAt").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Put_OnOthersPrivateCollection_IsByteIdenticalTo404ForRandomGuid()
    {
        string tokenB = _host.CreateToken("member-b", "b@example.com");
        string ownerId = await UserIdOfAsync("member-a", _host.CreateToken("member-a", "a@example.com"));
        Collection privateCollection = await AddCollectionAsync(ownerId, isPublic: false);

        (HttpStatusCode hiddenStatus, string hiddenBody) = await SendAsync(HttpMethod.Put, $"/study-plans/{privateCollection.Id}", tokenB, new { testDate = DateFromToday(3) });
        (HttpStatusCode missingStatus, string missingBody) = await SendAsync(HttpMethod.Put, $"/study-plans/{Guid.NewGuid()}", tokenB, new { testDate = DateFromToday(3) });

        hiddenStatus.Should().Be(HttpStatusCode.NotFound);
        missingStatus.Should().Be(HttpStatusCode.NotFound);
        hiddenBody.Should().Be(missingBody);
        hiddenBody.Should().BeEmpty();
    }

    [Fact]
    public async Task Get_ExcludesOtherUsersPlans()
    {
        string tokenA = _host.CreateToken("member-a", "a@example.com");
        string tokenB = _host.CreateToken("member-b", "b@example.com");
        Collection collection = await AddCollectionAsync(await UserIdOfAsync("member-a", tokenA), isPublic: false);
        (await SendAsync(HttpMethod.Put, $"/study-plans/{collection.Id}", tokenA, new { testDate = DateFromToday(3) })).Status.Should().Be(HttpStatusCode.OK);

        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, "/study-plans", tokenB);

        status.Should().Be(HttpStatusCode.OK);
        using JsonDocument doc = JsonDocument.Parse(body);
        doc.RootElement.GetProperty("plans").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task Delete_OfAnotherUsersCollection_Returns204AndLeavesTheirPlan()
    {
        string tokenA = _host.CreateToken("member-a", "a@example.com");
        string tokenB = _host.CreateToken("member-b", "b@example.com");
        Collection collection = await AddCollectionAsync(await UserIdOfAsync("member-a", tokenA), isPublic: false);
        await SendAsync(HttpMethod.Put, $"/study-plans/{collection.Id}", tokenA, new { testDate = DateFromToday(3) });

        (await SendAsync(HttpMethod.Delete, $"/study-plans/{collection.Id}", tokenB)).Status.Should().Be(HttpStatusCode.NoContent);

        (await SendAsync(HttpMethod.Get, "/study-plans", tokenA)).Body.Should().Contain(collection.Id.ToString());
        (await SendAsync(HttpMethod.Delete, $"/study-plans/{collection.Id}", tokenA)).Status.Should().Be(HttpStatusCode.NoContent);
        (await SendAsync(HttpMethod.Delete, $"/study-plans/{collection.Id}", tokenA)).Status.Should().Be(HttpStatusCode.NoContent);
        (await SendAsync(HttpMethod.Get, "/study-plans", tokenA)).Body.Should().NotContain(collection.Id.ToString());
    }

    [Fact]
    public async Task PlanForCollectionTurnedPrivate_IsUnavailable_AndNameNeverAppearsInJson()
    {
        string tokenB = _host.CreateToken("member-b", "b@example.com");
        Collection collection = await AddCollectionAsync(await UserIdOfAsync("member-a", _host.CreateToken("member-a", "a@example.com")), isPublic: true);
        (await SendAsync(HttpMethod.Put, $"/study-plans/{collection.Id}", tokenB, new { testDate = DateFromToday(3) })).Status.Should().Be(HttpStatusCode.OK);
        collection.IsPublic = false;
        await DbContext.SaveChangesAsync();

        (HttpStatusCode status, string body) = await SendAsync(HttpMethod.Get, "/study-plans", tokenB);

        status.Should().Be(HttpStatusCode.OK);
        body.Should().NotContain("Secret collection name");
        using JsonDocument doc = JsonDocument.Parse(body);
        JsonElement plan = doc.RootElement.GetProperty("plans")[0];
        plan.GetProperty("available").GetBoolean().Should().BeFalse();
        plan.GetProperty("collectionName").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Put_SixthPlan_Returns400WithLimitReachedTitle_AndBadDateReturns400()
    {
        string token = _host.CreateToken("member-a", "a@example.com");
        List<Collection> collections = [];
        for (int i = 0; i < 6; i++) collections.Add(await AddCollectionAsync("owner", isPublic: true, name: $"C{i}"));
        for (int i = 0; i < 5; i++)
        {
            (await SendAsync(HttpMethod.Put, $"/study-plans/{collections[i].Id}", token, new { testDate = DateFromToday(3 + i) })).Status.Should().Be(HttpStatusCode.OK);
        }

        (HttpStatusCode capStatus, string capBody) = await SendAsync(HttpMethod.Put, $"/study-plans/{collections[5].Id}", token, new { testDate = DateFromToday(3) });
        (HttpStatusCode badStatus, string badBody) = await SendAsync(HttpMethod.Put, $"/study-plans/{collections[5].Id}", token, new { testDate = "soon" });

        capStatus.Should().Be(HttpStatusCode.BadRequest);
        capBody.Should().Contain("StudyPlans.LimitReached").And.Contain("You can plan up to 5 tests at a time.");
        badStatus.Should().Be(HttpStatusCode.BadRequest);
        badBody.Should().Contain("StudyPlans.InvalidDate");
    }
}
