using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Npgsql;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Items.AddBulk;
using Quizymode.Api.Features.StudyGuideDocuments;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Shared.Options;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.StudyGuideDocuments;

/// <summary>
/// #363 on real PostgreSQL: the manual accept and the auto-save sweep serialise on one per-document advisory lock inside
/// one transaction (no duplicate items, no unique-key 500), a busy document is skipped, and the bulk item handler leaves
/// commit and rollback to a caller's transaction. Requires Docker.
/// </summary>
[Trait("Category", "Postgres")]
public sealed class StudyGuideAutoSavePostgresTests(PostgresContainerFixture fixture) : IClassFixture<PostgresContainerFixture>
{
    private static readonly DateTime Now = new(2026, 11, 2, 12, 0, 0, DateTimeKind.Utc);

    private readonly TaxonomyRegistry _taxonomy = new(new TestHostEnvironment(), Options.Create(new TaxonomyOptions()), NullLogger<TaxonomyRegistry>.Instance);

    private async Task SeedGeographyAsync()
    {
        await using ApplicationDbContext db = fixture.CreateDbContext();
        if (await db.Categories.AnyAsync(c => c.Name == "geography"))
        {
            return;
        }

        Category category = new() { Id = Guid.NewGuid(), Name = "geography", IsPrivate = false, CreatedBy = "seeder", CreatedAt = Now };
        Keyword capitals = new() { Id = Guid.NewGuid(), Name = "capitals", IsPrivate = false, CreatedBy = "seeder", CreatedAt = Now };
        Keyword europe = new() { Id = Guid.NewGuid(), Name = "europe", IsPrivate = false, CreatedBy = "seeder", CreatedAt = Now };
        db.Categories.Add(category);
        db.Keywords.AddRange(capitals, europe);
        db.KeywordRelations.AddRange(
            new KeywordRelation { Id = Guid.NewGuid(), CategoryId = category.Id, ParentKeywordId = null, ChildKeywordId = capitals.Id, SortOrder = 0, CreatedAt = Now },
            new KeywordRelation { Id = Guid.NewGuid(), CategoryId = category.Id, ParentKeywordId = capitals.Id, ChildKeywordId = europe.Id, SortOrder = 0, CreatedAt = Now });
        await db.SaveChangesAsync();
    }

    /// <summary>A document with one auto-save Pending section whose generation already completed with <paramref name="candidates"/> questions.</summary>
    private async Task<(Guid DocumentId, List<Guid> CandidateIds)> SeedDocumentAsync(string userId, int candidates)
    {
        await SeedGeographyAsync();
        Guid documentId = Guid.NewGuid();
        Guid generationId = Guid.NewGuid();
        string hash = Guid.NewGuid().ToString("N");
        List<Guid> candidateIds = [];
        await using ApplicationDbContext db = fixture.CreateDbContext();
        db.SectionGenerations.Add(new SectionGeneration
        {
            Id = generationId,
            TextSha256 = hash,
            Status = SectionGenerationStatus.Completed,
            NotBeforeUtc = Now,
            CreatedUtc = Now,
            QueuedUtc = Now,
            CompletedUtc = Now
        });
        for (int i = 0; i < candidates; i++)
        {
            Guid id = Guid.NewGuid();
            candidateIds.Add(id);
            db.GenerationCandidates.Add(new GenerationCandidate
            {
                Id = id,
                GenerationId = generationId,
                Index = i,
                Question = $"Which city is number {i + 1} on the list of {documentId:N}?",
                CorrectAnswer = $"City {i + 1}",
                IncorrectAnswersJson = "[\"Town\",\"Village\"]",
                Explanation = "Because the guide says so.",
                SourceQuote = "quote"
            });
        }

        db.StudyGuideDocuments.Add(new StudyGuideDocument
        {
            Id = documentId,
            UserId = userId,
            Title = "Capitals notes",
            FileType = "txt",
            FileSha256 = hash,
            TextSha256 = hash,
            CategoryName = "geography",
            NavigationKeyword1 = "capitals",
            NavigationKeyword2 = "europe",
            CreatedUtc = Now,
            LastActivityUtc = Now,
            ExpiresUtc = Now.AddDays(30),
            Sections =
            [
                new StudyGuideSection
                {
                    Id = Guid.NewGuid(),
                    Index = 0,
                    Label = "Section 1",
                    TextSha256 = hash,
                    SizeBytes = 100,
                    GenerationId = generationId,
                    AutoSave = StudyGuideAutoSave.Pending
                }
            ]
        });
        await db.SaveChangesAsync();
        return (documentId, candidateIds);
    }

    private StudyGuideAutoSaver NewSaver(ApplicationDbContext db, IServiceScopeFactory scopes) =>
        new(
            db,
            scopes,
            new SimHashService(),
            new TaxonomyItemCategoryResolver(db, _taxonomy),
            _taxonomy,
            Mock.Of<IAuditService>(),
            StudyGuideTestData.Moderation(),
            Options.Create(new StudyGuideGenerationOptions()),
            Options.Create(new StudyGuideDocumentOptions()),
            TimeProvider.System,
            NullLogger<StudyGuideAutoSaver>.Instance);

    private ServiceProvider Provider()
    {
        ServiceCollection services = new();
        services.AddScoped(_ => fixture.CreateDbContext());
        services.AddScoped(provider => NewSaver(provider.GetRequiredService<ApplicationDbContext>(), provider.GetRequiredService<IServiceScopeFactory>()));
        return services.BuildServiceProvider();
    }

    private Task<Result<AcceptStudyGuideCandidates.Response?>> ManualAcceptAsync(ApplicationDbContext db, string userId, Guid documentId, List<Guid> candidateIds) =>
        AcceptStudyGuideCandidates.HandleAsync(
            documentId,
            new AcceptStudyGuideCandidates.Request(candidateIds.Select(id => new AcceptStudyGuideCandidates.CandidateEdit(id, null, null, null, null)).ToList()),
            db,
            StudyGuideTestData.User(userId).Object,
            new SimHashService(),
            new TaxonomyItemCategoryResolver(db, _taxonomy),
            _taxonomy,
            Mock.Of<IAuditService>(),
            StudyGuideTestData.Moderation(),
            30,
            Now,
            CancellationToken.None);

    [SkippableFact]
    public async Task ManualAcceptAndSweepRunningTogether_SaveEachCandidateExactlyOnce()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        using ServiceProvider provider = Provider();
        string userId = Guid.NewGuid().ToString();

        for (int round = 0; round < 3; round++)
        {
            (Guid documentId, List<Guid> candidateIds) = await SeedDocumentAsync(userId, candidates: 6);
            await using ApplicationDbContext manualDb = fixture.CreateDbContext();
            await using ApplicationDbContext sweepDb = fixture.CreateDbContext();
            StudyGuideAutoSaver saver = NewSaver(sweepDb, provider.GetRequiredService<IServiceScopeFactory>());

            Task<Result<AcceptStudyGuideCandidates.Response?>> manual = ManualAcceptAsync(manualDb, userId, documentId, candidateIds);
            Task<bool> sweep = saver.SaveDocumentAsync(documentId, CancellationToken.None);
            await Task.WhenAll(manual, sweep);

            manual.Result.IsSuccess.Should().BeTrue(manual.Result.IsFailure ? manual.Result.Error.Description : null);
            await using ApplicationDbContext verify = fixture.CreateDbContext();
            (await verify.StudyGuideAcceptedCandidates.CountAsync(a => a.DocumentId == documentId)).Should().Be(6);
            List<Guid> itemIds = await verify.StudyGuideAcceptedCandidates.Where(a => a.DocumentId == documentId).Select(a => a.ItemId).ToListAsync();
            itemIds.Distinct().Should().HaveCount(6);
            (await verify.Items.CountAsync(i => i.UploadId == documentId)).Should().Be(6, "no duplicate items");
            (await verify.CollectionItems.CountAsync(ci => itemIds.Contains(ci.ItemId))).Should().Be(6);
            (await verify.Collections.CountAsync(c => c.CreatedBy == userId)).Should().Be(round + 1, "one collection per document");
            (await verify.StudyGuideSections.SingleAsync(s => s.DocumentId == documentId)).AutoSave.Should().NotBe(StudyGuideAutoSave.Failed);
        }
    }

    [SkippableFact]
    public async Task Sweep_SkipsADocumentThatAnotherTransactionHoldsAndSavesItOnceFree()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        using ServiceProvider provider = Provider();
        string userId = Guid.NewGuid().ToString();
        (Guid documentId, List<Guid> candidateIds) = await SeedDocumentAsync(userId, candidates: 2);
        await using ApplicationDbContext sweepDb = fixture.CreateDbContext();
        StudyGuideAutoSaver saver = NewSaver(sweepDb, provider.GetRequiredService<IServiceScopeFactory>());

        await using (NpgsqlConnection holder = new(fixture.ConnectionString))
        {
            await holder.OpenAsync();
            await using NpgsqlTransaction transaction = await holder.BeginTransactionAsync();
            await using (NpgsqlCommand command = new("SELECT pg_advisory_xact_lock(hashtext(@key))", holder, transaction))
            {
                command.Parameters.AddWithValue("key", "study-guide-accept:" + documentId);
                await command.ExecuteNonQueryAsync();
            }

            (await saver.SaveDocumentAsync(documentId, CancellationToken.None)).Should().BeFalse("the document is busy");

            await using ApplicationDbContext busy = fixture.CreateDbContext();
            (await busy.Items.CountAsync(i => i.UploadId == documentId)).Should().Be(0);
            StudyGuideSection section = await busy.StudyGuideSections.SingleAsync(s => s.DocumentId == documentId);
            section.AutoSave.Should().Be(StudyGuideAutoSave.Pending);
            section.AutoSaveAttempts.Should().Be(0, "a busy document is not a failure");
            await transaction.RollbackAsync();
        }

        (await saver.SaveDocumentAsync(documentId, CancellationToken.None)).Should().BeTrue();

        await using ApplicationDbContext verify = fixture.CreateDbContext();
        (await verify.Items.CountAsync(i => i.UploadId == documentId)).Should().Be(candidateIds.Count);
        (await verify.StudyGuideSections.SingleAsync(s => s.DocumentId == documentId)).AutoSave.Should().Be(StudyGuideAutoSave.Saved);
    }

    [SkippableFact]
    public async Task ManualAccept_WithNoAmbientTransaction_StillCommitsAtomically()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        string userId = Guid.NewGuid().ToString();
        (Guid documentId, List<Guid> candidateIds) = await SeedDocumentAsync(userId, candidates: 3);
        await using ApplicationDbContext db = fixture.CreateDbContext();

        Result<AcceptStudyGuideCandidates.Response?> result = await ManualAcceptAsync(db, userId, documentId, candidateIds);

        result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Description : null);
        result.Value!.CreatedCount.Should().Be(3);
        await using ApplicationDbContext verify = fixture.CreateDbContext();
        (await verify.StudyGuideAcceptedCandidates.CountAsync(a => a.DocumentId == documentId)).Should().Be(3);
        (await verify.StudyGuideDocuments.SingleAsync(d => d.Id == documentId)).CollectionId.Should().NotBeNull();
    }

    [SkippableFact]
    public async Task BulkAdd_InsideACallersTransaction_RollsBackWithTheCaller()
    {
        Skip.If(fixture.UnavailableReason is not null, fixture.UnavailableReason);
        await SeedGeographyAsync();
        string userId = Guid.NewGuid().ToString();
        string question = $"Which city is the capital of Norway ({Guid.NewGuid():N})?";
        AddItemsBulk.Request request = new(
            IsPrivate: true,
            Category: "geography",
            Keyword1: "capitals",
            Keyword2: "europe",
            Keywords: [],
            Items: [new AddItemsBulk.ItemRequest(question, "Oslo", ["Bergen"], "Oslo is the capital.")]);

        await using (ApplicationDbContext db = fixture.CreateDbContext())
        await using (Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction = await db.Database.BeginTransactionAsync())
        {
            Result<AddItemsBulk.Response> result = await AddItemsBulkHandler.HandleAsync(
                request, db, new SimHashService(), StudyGuideTestData.User(userId).Object, new TaxonomyItemCategoryResolver(db, _taxonomy),
                _taxonomy, Mock.Of<IAuditService>(), NullLogger.Instance, CancellationToken.None);

            result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Description : null);
            await transaction.RollbackAsync();
        }

        await using (ApplicationDbContext verify = fixture.CreateDbContext())
        {
            (await verify.Items.CountAsync(i => i.Question == question)).Should().Be(0);
        }

        await using ApplicationDbContext standalone = fixture.CreateDbContext();
        Result<AddItemsBulk.Response> committed = await AddItemsBulkHandler.HandleAsync(
            request, standalone, new SimHashService(), StudyGuideTestData.User(userId).Object, new TaxonomyItemCategoryResolver(standalone, _taxonomy),
            _taxonomy, Mock.Of<IAuditService>(), NullLogger.Instance, CancellationToken.None);
        committed.IsSuccess.Should().BeTrue();
        await using ApplicationDbContext after = fixture.CreateDbContext();
        (await after.Items.CountAsync(i => i.Question == question)).Should().Be(1);
    }
}
