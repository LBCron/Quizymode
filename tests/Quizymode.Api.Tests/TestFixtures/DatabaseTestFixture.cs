using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Quizymode.Api.Data;

namespace Quizymode.Api.Tests.TestFixtures;

/// <summary>
/// Base fixture for tests that need a database context.
/// Provides an isolated SQLite in-memory database for each test.
/// </summary>
public abstract class DatabaseTestFixture : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly DbContextOptions<ApplicationDbContext> _options;
    protected ApplicationDbContext DbContext { get; }

    protected DatabaseTestFixture() : this([])
    {
    }

    /// <param name="interceptors">EF Core interceptors for every context of this database (for example a command counter).</param>
    protected DatabaseTestFixture(IReadOnlyList<IInterceptor> interceptors)
    {
        // Create and open a connection to keep the in-memory database alive
        _connection = new SqliteConnection("Data Source=:memory:");
        _connection.Open();

        _options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlite(_connection)
            .ReplaceService<IModelCustomizer, TestModelCustomizer>()
            .EnableSensitiveDataLogging()
            .AddInterceptors(interceptors.ToArray())
            .Options;

        DbContext = new ApplicationDbContext(_options);
        
        // Ensure database is created - create database directly from model
        // Disable migrations completely to avoid PostgreSQL-specific SQL from migrations
        // The TestModelCustomizer handles PostgreSQL-specific SQL conversion for SQLite
        try
        {
            // Get the database creator and ensure migrations are not used
            IRelationalDatabaseCreator databaseCreator = DbContext.Database.GetService<IRelationalDatabaseCreator>();
            
            // EnsureCreated creates from model, not migrations, but we need to make sure
            // no migration history table is created or checked
            DbContext.Database.EnsureCreated();
        }
        catch (Microsoft.Data.Sqlite.SqliteException ex) when (ex.Message.Contains("unrecognized token"))
        {
            // If EnsureCreated fails due to migration SQL, provide better error message
            throw new InvalidOperationException(
                $"Database creation failed due to PostgreSQL-specific SQL. " +
                $"Error: {ex.Message}. " +
                $"Ensure TestModelCustomizer properly handles all PostgreSQL-specific syntax.", ex);
        }
    }

    /// <summary>
    /// A separate context on the same in-memory database, for code that owns and disposes its context
    /// (for example one DI scope per HTTP request).
    /// </summary>
    protected ApplicationDbContext CreateDbContext() => new(_options);

    /// <summary>A separate context on the same database with extra interceptors (for example one that fails a save).</summary>
    protected ApplicationDbContext CreateDbContext(params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlite(_connection)
            .ReplaceService<IModelCustomizer, TestModelCustomizer>()
            .EnableSensitiveDataLogging()
            .AddInterceptors(interceptors)
            .Options);

    public void Dispose()
    {
        DbContext.Dispose();
        _connection.Dispose();
    }
}

