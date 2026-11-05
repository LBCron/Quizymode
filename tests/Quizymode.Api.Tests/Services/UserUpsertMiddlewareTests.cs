using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Services;

/// <summary>
/// Tests for UserUpsertMiddleware via the public InvokeAsync method.
/// Uses an in-memory SQLite database (DatabaseTestFixture pattern)
/// and a minimal service provider that resolves ApplicationDbContext and IAuditService.
/// </summary>
public sealed class UserUpsertMiddlewareTests : DatabaseTestFixture
{
    private readonly Mock<IAuditService> _auditService = new();

    private HttpContext BuildHttpContext(
        string? sub = null,
        string? email = null,
        string? name = null,
        bool authenticated = true)
    {
        var httpContext = new DefaultHttpContext();

        if (authenticated && sub is not null)
        {
            var claims = new List<Claim> { new("sub", sub) };
            if (email is not null) claims.Add(new("email", email));
            if (name is not null) claims.Add(new("name", name));
            httpContext.User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));
        }

        // Wire up service provider so the middleware can resolve DbContext and AuditService
        var services = new ServiceCollection();
        services.AddSingleton(DbContext);
        services.AddSingleton(_auditService.Object);
        httpContext.RequestServices = services.BuildServiceProvider();

        return httpContext;
    }

    private static UserUpsertMiddleware BuildMiddleware(RequestDelegate? next = null)
    {
        next ??= _ => Task.CompletedTask;
        return new UserUpsertMiddleware(next, NullLogger<UserUpsertMiddleware>.Instance);
    }

    /// <summary>
    /// NOTE: The middleware uses PostgreSQL-specific FOR UPDATE row locking which SQLite cannot execute.
    /// The middleware catches this exception gracefully and still calls next().
    /// Tests here verify the observable contract: next is always called, no unhandled exceptions.
    /// The full user-creation/update/relink path is covered against real PostgreSQL in UserUpsertMiddlewarePostgresTests.
    /// </summary>
    [Fact]
    public async Task InvokeAsync_CallsNextDelegate_ForAuthenticatedUser()
    {
        bool nextCalled = false;
        var middleware = BuildMiddleware(next: _ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        var ctx = BuildHttpContext(sub: Guid.NewGuid().ToString(), email: "e@example.com", name: "Alice");
        await middleware.InvokeAsync(ctx);

        nextCalled.Should().BeTrue();
    }

    [Fact]
    public async Task InvokeAsync_CallsNextDelegate_ForAnonymousUser()
    {
        bool nextCalled = false;
        var middleware = BuildMiddleware(next: _ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        var ctx = BuildHttpContext(authenticated: false);
        await middleware.InvokeAsync(ctx);

        nextCalled.Should().BeTrue();
        DbContext.Users.Should().BeEmpty();
    }

    [Fact]
    public async Task InvokeAsync_DoesNotThrow_WhenAuthenticatedUserHasNoSubClaim()
    {
        bool nextCalled = false;
        var middleware = BuildMiddleware(next: _ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        // Authenticated user with no "sub" claim
        var httpContext = new DefaultHttpContext();
        httpContext.User = new System.Security.Claims.ClaimsPrincipal(
            new System.Security.Claims.ClaimsIdentity(
                new[] { new System.Security.Claims.Claim("name", "NoSub") }, "test"));
        var services = new ServiceCollection();
        services.AddSingleton(DbContext);
        services.AddSingleton(_auditService.Object);
        httpContext.RequestServices = services.BuildServiceProvider();

        await middleware.InvokeAsync(httpContext);

        nextCalled.Should().BeTrue();
    }

    [Fact]
    public async Task InvokeAsync_SetsUserIdViaFallback_WhenUserExistsButForUpdateFails()
    {
        // The middleware's FOR UPDATE SQL fails on SQLite.
        // The fallback lookup (AsNoTracking) uses standard EF Core and works.
        string sub = Guid.NewGuid().ToString();
        User user = new()
        {
            Id = Guid.NewGuid(), Subject = sub, Email = "fb@example.com",
            Name = "Fallback", LastLogin = DateTime.UtcNow.AddDays(-1)
        };
        DbContext.Users.Add(user);
        await DbContext.SaveChangesAsync();
        DbContext.ChangeTracker.Clear();

        var middleware = BuildMiddleware();
        var ctx = BuildHttpContext(sub: sub, email: "fb@example.com", name: "Fallback");

        await middleware.InvokeAsync(ctx);

        // The fallback lookup sets UserId even when FOR UPDATE path throws
        ctx.Items["UserId"].Should().Be(user.Id.ToString());
    }

    [Fact]
    public async Task InvokeAsync_ResolvesUserWithoutLockedPath_WhenRowUnchangedAndRecent()
    {
        // #328: the cheap path needs only a plain SELECT, so it also runs on SQLite with no failure logged.
        string sub = Guid.NewGuid().ToString();
        User user = new()
        {
            Id = Guid.NewGuid(), Subject = sub, Email = "cheap@example.com",
            Name = "Custom Name", LastLogin = DateTime.UtcNow.AddMinutes(-1)
        };
        DbContext.Users.Add(user);
        await DbContext.SaveChangesAsync();
        DbContext.ChangeTracker.Clear();

        CapturingLoggerProvider logs = new();
        using ILoggerFactory loggerFactory = LoggerFactory.Create(builder => builder.AddProvider(logs).SetMinimumLevel(LogLevel.Debug));
        UserUpsertMiddleware middleware = new(_ => Task.CompletedTask, loggerFactory.CreateLogger<UserUpsertMiddleware>());
        HttpContext ctx = BuildHttpContext(sub: sub, email: "cheap@example.com", name: "Alice");

        await middleware.InvokeAsync(ctx);

        ctx.Items["UserId"].Should().Be(user.Id.ToString());
        logs.Entries.Where(e => e.Level >= LogLevel.Warning).Should().BeEmpty();
        logs.Entries.Should().Contain(e => e.Message.Contains("Skipped user upsert"));
    }

    [Fact]
    public async Task InvokeAsync_LogsNoEmailOrName_ForUpsertDebugOrMissingSubject()
    {
        // #476: email and name are personal data, so no log line may contain them.
        const string email = "pii-check@example.com";
        const string name = "Pat Privacy";
        CapturingLoggerProvider logs = new();
        using ILoggerFactory loggerFactory = LoggerFactory.Create(builder => builder.AddProvider(logs).SetMinimumLevel(LogLevel.Debug));
        UserUpsertMiddleware middleware = new(_ => Task.CompletedTask, loggerFactory.CreateLogger<UserUpsertMiddleware>());

        await middleware.InvokeAsync(BuildHttpContext(sub: Guid.NewGuid().ToString(), email: email, name: name));

        DefaultHttpContext noSubject = new();
        noSubject.User = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim("email", email), new Claim("name", name) }, "test"));
        noSubject.RequestServices = BuildHttpContext().RequestServices;
        await middleware.InvokeAsync(noSubject);

        logs.Entries.Should().Contain(e => e.Message.Contains("Processing user upsert for subject"));
        logs.Entries.Should().Contain(e => e.Message.Contains("Available claim types: email, name"));
        logs.Entries.Should().OnlyContain(e => !e.Message.Contains(email) && !e.Message.Contains(name));
    }

    [Fact]
    public async Task InvokeAsync_CallsNextExactlyOnce_WhenAuthenticatedUserHasNoSubAndNextThrows()
    {
        int calls = 0;
        UserUpsertMiddleware middleware = BuildMiddleware(next: _ =>
        {
            calls++;
            throw new InvalidOperationException("downstream failure");
        });
        DefaultHttpContext httpContext = new()
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("name", "NoSub")], "test"))
        };
        ServiceCollection services = new();
        services.AddSingleton(DbContext);
        services.AddSingleton(_auditService.Object);
        httpContext.RequestServices = services.BuildServiceProvider();

        Func<Task> act = () => middleware.InvokeAsync(httpContext);

        await act.Should().ThrowAsync<InvalidOperationException>();
        calls.Should().Be(1);
    }
}
