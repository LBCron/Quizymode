using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Items.AddBulk;
using Quizymode.Api.Features.StudyGuideDocuments;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Shared.Options;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace Quizymode.Api.Tests.Features.StudyGuideDocuments;

/// <summary>#363 "Make a quiz": quick-path generation flags, the auto-save step, and the quick endpoint's outcomes.</summary>
public sealed class StudyGuideQuickPathTests : StudyGuideDocumentFixture
{
    private ServiceProvider Provider(IAuditService? audit = null)
    {
        ServiceCollection services = new();
        services.AddScoped(_ => CreateDbContext());
        services.AddScoped(provider => NewSaver(
            provider.GetRequiredService<ApplicationDbContext>(),
            provider.GetRequiredService<IServiceScopeFactory>(),
            audit));
        return services.BuildServiceProvider();
    }

    private StudyGuideAutoSaver NewSaver(ApplicationDbContext db, IServiceScopeFactory scopes, IAuditService? audit = null) =>
        new(
            db,
            scopes,
            SimHashService,
            new TaxonomyItemCategoryResolver(db, TaxonomyRegistry),
            TaxonomyRegistry,
            audit ?? Mock.Of<IAuditService>(),
            StudyGuideTestData.Moderation(),
            MsOptions.Create(GenerationOptions),
            MsOptions.Create(DocumentOptions),
            Clock,
            NullLogger<StudyGuideAutoSaver>.Instance);

    private async Task<QuickStudyGuideDocument.Response> QuickAsync(string text, StudyGuideAutoSaver saver, string? userId = null)
    {
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(text, userId);
        return await QuickStudyGuideDocument.RunAsync(
            document,
            DbContext,
            userId ?? UserA,
            Vendors,
            saver,
            GenerationOptions,
            DocumentOptions.RetentionDays,
            Clock.UtcNow,
            NullLogger.Instance,
            CancellationToken.None);
    }

    private async Task CompleteAllAsync(StudyGuideDocumentContracts.Document document, int candidates = 2)
    {
        foreach (StudyGuideDocumentContracts.Section section in document.Sections)
        {
            await CompleteGenerationAsync(await GenerationIdOfAsync(section.Id), candidates);
        }
    }

    private Task<Result<AcceptStudyGuideCandidates.Response?>> ManualAcceptAsync(
        string documentId,
        IEnumerable<Guid> candidateIds,
        string? userId = null) =>
        AcceptStudyGuideCandidates.HandleAsync(
            Guid.Parse(documentId),
            new AcceptStudyGuideCandidates.Request(candidateIds.Select(id => new AcceptStudyGuideCandidates.CandidateEdit(id, null, null, null, null)).ToList()),
            DbContext,
            StudyGuideTestData.User(userId ?? UserA).Object,
            SimHashService,
            TaxonomyItemCategoryResolver,
            TaxonomyRegistry,
            Mock.Of<IAuditService>(),
            StudyGuideTestData.Moderation(),
            DocumentOptions.RetentionDays,
            Clock.UtcNow,
            CancellationToken.None);

    private async Task<StudyGuideDocumentContracts.Document> ReloadAsync(string documentId)
    {
        DbContext.ChangeTracker.Clear();
        return (await GetAsync(documentId))!;
    }

    private async Task<int> TotalChargesAsync() =>
        await DbContext.StudyGuideQuotaCharges.AsNoTracking().SumAsync(charge => charge.Cost);

    // ----- Generate flags (R7, R8) -----

    [Fact]
    public async Task Generate_QuickPath_MarksEverySectionPendingAndSkipsTheFreeTierDelay()
    {
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(2));

        Result<GenerateStudyGuideSections.Response?> result = await GenerateStudyGuideSections.HandleAsync(
            Guid.Parse(document.Id),
            new GenerateStudyGuideSections.Request(document.Sections.Select(s => Guid.Parse(s.Id)).ToList()),
            DbContext, UserA, Vendors, GenerationOptions, DocumentOptions.RetentionDays, Clock.UtcNow, CancellationToken.None,
            autoSave: true, quickPath: true);

        result.IsSuccess.Should().BeTrue();
        result.Value!.ChargedSections.Should().Be(2);
        List<StudyGuideSection> sections = await DbContext.StudyGuideSections.AsNoTracking().ToListAsync();
        sections.Should().OnlyContain(s => s.AutoSave == StudyGuideAutoSave.Pending);
        (await DbContext.SectionGenerations.AsNoTracking().ToListAsync())
            .Should().OnlyContain(g => g.Status == SectionGenerationStatus.Pending && g.NotBeforeUtc == Clock.UtcNow);
    }

    [Fact]
    public async Task Generate_Manual_LeavesAutoSaveNullAndKeepsTheFreeTierDelay()
    {
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(1));

        await GenerateAsync(document, document.Sections);

        (await DbContext.StudyGuideSections.AsNoTracking().SingleAsync()).AutoSave.Should().BeNull();
        (await DbContext.SectionGenerations.AsNoTracking().SingleAsync()).NotBeforeUtc
            .Should().Be(Clock.UtcNow.AddMinutes(GenerationOptions.FreeTierDelayMinutes));
    }

    [Fact]
    public async Task Generate_QuickPath_PullsAnAttachedFreeJobForwardWithoutChangingItsTier()
    {
        StudyGuideDocumentContracts.Document manual = await CreateTextAsync(MultiSectionText(1, "shared"), UserB);
        await GenerateAsync(manual, manual.Sections, UserB);
        SectionGeneration waiting = await DbContext.SectionGenerations.AsNoTracking().SingleAsync();
        waiting.NotBeforeUtc.Should().BeAfter(Clock.UtcNow);

        StudyGuideDocumentContracts.Document mine = await CreateTextAsync(MultiSectionText(1, "shared"), UserA, title: "Mine");
        Result<GenerateStudyGuideSections.Response?> result = await GenerateStudyGuideSections.HandleAsync(
            Guid.Parse(mine.Id),
            new GenerateStudyGuideSections.Request(mine.Sections.Select(s => Guid.Parse(s.Id)).ToList()),
            DbContext, UserA, Vendors, GenerationOptions, DocumentOptions.RetentionDays, Clock.UtcNow, CancellationToken.None,
            autoSave: true, quickPath: true);

        result.Value!.ChargedSections.Should().Be(0);
        result.Value.QueuedCount.Should().Be(1);
        DbContext.ChangeTracker.Clear();
        SectionGeneration pulled = await DbContext.SectionGenerations.SingleAsync(g => g.Id == waiting.Id);
        pulled.NotBeforeUtc.Should().Be(Clock.UtcNow);
        pulled.Tier.Should().Be(StudyGuideTier.Free);
        (await DbContext.StudyGuideSections.AsNoTracking().SingleAsync(s => s.DocumentId == Guid.Parse(mine.Id)))
            .AutoSave.Should().Be(StudyGuideAutoSave.Pending);
    }

    // ----- Quick endpoint outcomes (R5, R6) -----

    [Fact]
    public async Task Quick_ShortDocument_ChargesEverySectionAndIsGenerating()
    {
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());

        QuickStudyGuideDocument.Response response = await QuickAsync(MultiSectionText(2), saver);

        response.Outcome.Should().Be("Generating");
        response.ChargedSections.Should().Be(2);
        response.Document.Sections.Should().OnlyContain(s => s.AutoSave == "Pending" && s.Status == "Queued");
        response.Document.Quota.DailyUsed.Should().Be(2);
    }

    [Fact]
    public async Task Quick_SameRequestAgain_IsADuplicateAndChargesNothingMore()
    {
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());
        await QuickAsync(MultiSectionText(2), saver);

        QuickStudyGuideDocument.Response again = await QuickAsync(MultiSectionText(2), saver);

        again.Outcome.Should().Be("Generating");
        again.Document.IsDuplicate.Should().BeTrue();
        again.ChargedSections.Should().Be(0);
        (await TotalChargesAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Quick_MoreSectionsThanTheCap_GeneratesNothingAndNeedsAChoice()
    {
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());

        QuickStudyGuideDocument.Response response = await QuickAsync(MultiSectionText(4), saver);

        response.Outcome.Should().Be("NeedsChoice");
        response.Message.Should().Contain("4 sections").And.Contain("up to 3");
        (await TotalChargesAsync()).Should().Be(0);
        (await DbContext.SectionGenerations.CountAsync()).Should().Be(0);
        response.Document.Sections.Should().OnlyContain(s => s.AutoSave == null);
    }

    [Fact]
    public async Task Quick_CapCountsOnlySectionsWithNothingSaved()
    {
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(4));
        await GenerateAsync(document, document.Sections.Take(2));
        foreach (StudyGuideDocumentContracts.Section section in document.Sections.Take(2))
        {
            await CompleteGenerationAsync(await GenerationIdOfAsync(section.Id), candidates: 2);
        }

        StudyGuideDocumentContracts.Document generated = await ReloadAsync(document.Id);
        (await ManualAcceptAsync(document.Id, generated.Sections[0].Candidates.Take(1).Select(c => Guid.Parse(c.Id)))).IsSuccess.Should().BeTrue();
        StudyGuideDocumentContracts.Document reopened = await ReloadAsync(document.Id);

        QuickStudyGuideDocument.Response response = await QuickStudyGuideDocument.RunAsync(
            reopened, DbContext, UserA, Vendors, saver, GenerationOptions, DocumentOptions.RetentionDays, Clock.UtcNow,
            NullLogger.Instance, CancellationToken.None);

        response.Outcome.Should().Be("Generating", "3 sections still need questions: within the cap even though the document has 4");
        response.ChargedSections.Should().Be(2, "section 2 is already generated and attaches for free");
        response.Document.Sections.Select(s => s.AutoSave).Should().Equal(null, "Pending", "Pending", "Pending");
    }

    [Fact]
    public async Task Quick_OverTheDailyAllowance_ChargesNothingAndExplainsTheLimit()
    {
        await SetSettingAsync(UserA, StudyGuideSettingKeys.DailySections, "1");
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());

        QuickStudyGuideDocument.Response response = await QuickAsync(MultiSectionText(2), saver);

        response.Outcome.Should().Be("OverAllowance");
        response.Message.Should().Contain("daily limit");
        (await TotalChargesAsync()).Should().Be(0);
        response.Document.Sections.Should().OnlyContain(s => s.AutoSave == null);
    }

    [Fact]
    public async Task Quick_GlobalBudgetUsedUp_IsUnavailableAndChargesNothing()
    {
        GenerationOptions.MonthlySectionBudget = 0;
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());

        QuickStudyGuideDocument.Response response = await QuickAsync(MultiSectionText(1), saver);

        response.Outcome.Should().Be("Unavailable");
        (await TotalChargesAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Quick_AllSectionsAlreadyGeneratedByAnotherUser_IsReadyAndSavedPrivatelyForMe()
    {
        string text = MultiSectionText(1, "shared");
        StudyGuideDocumentContracts.Document theirs = await CreateTextAsync(text, UserB);
        await GenerateAsync(theirs, theirs.Sections, UserB);
        await CompleteAllAsync(theirs, candidates: 3);
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());

        QuickStudyGuideDocument.Response response = await QuickAsync(text, saver, UserA);

        response.Outcome.Should().Be("Ready");
        response.ChargedSections.Should().Be(0);
        response.Document.CollectionId.Should().NotBeNull();
        response.CollectionName.Should().Be(response.Document.Title);
        response.Document.Sections[0].AutoSave.Should().Be("Saved");

        List<Item> mine = await DbContext.Items.AsNoTracking().Where(i => i.CreatedBy == UserA).ToListAsync();
        mine.Should().HaveCount(3).And.OnlyContain(i => i.IsPrivate);
        (await DbContext.Items.AsNoTracking().CountAsync(i => i.CreatedBy == UserB)).Should().Be(0);
        (await DbContext.StudyGuideAcceptedCandidates.AsNoTracking().CountAsync(a => a.DocumentId == Guid.Parse(theirs.Id))).Should().Be(0);
        Collection collection = await DbContext.Collections.AsNoTracking().SingleAsync();
        collection.CreatedBy.Should().Be(UserA);
        collection.IsPublic.Should().BeFalse();
        collection.IsDiscoverable.Should().BeFalse();
    }

    [Fact]
    public async Task Quick_AllCachedButNothingSavable_NeedsAChoiceInsteadOfReady()
    {
        string text = MultiSectionText(1, "empty");
        StudyGuideDocumentContracts.Document theirs = await CreateTextAsync(text, UserB);
        await GenerateAsync(theirs, theirs.Sections, UserB);
        await CompleteAllAsync(theirs, candidates: 0);
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());

        QuickStudyGuideDocument.Response response = await QuickAsync(text, saver, UserA);

        response.Outcome.Should().Be("NeedsChoice");
        response.Message.Should().Contain("couldn't make any questions");
        response.Document.CollectionId.Should().BeNull();
        (await DbContext.Collections.CountAsync()).Should().Be(0);
    }

    // ----- Auto-save (AC: private items, idempotent, lenient, terminal failure, atomic) -----

    [Fact]
    public async Task AutoSave_SavesPrivateItemsOnceAndIsIdempotent()
    {
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());
        QuickStudyGuideDocument.Response response = await QuickAsync(MultiSectionText(1), saver);
        await CompleteAllAsync(response.Document, candidates: 3);

        (await saver.SweepAsync(CancellationToken.None)).Should().Be(1);
        (await saver.SweepAsync(CancellationToken.None)).Should().Be(0);

        List<Item> items = await DbContext.Items.AsNoTracking().ToListAsync();
        items.Should().HaveCount(3);
        items.Should().OnlyContain(i => i.IsPrivate && i.CreatedBy == UserA && !i.ReadyForReview && i.UploadId == Guid.Parse(response.Document.Id));
        StudyGuideDocumentContracts.Document reloaded = await ReloadAsync(response.Document.Id);
        reloaded.CollectionId.Should().NotBeNull();
        reloaded.Sections[0].AutoSave.Should().Be("Saved");
        reloaded.Sections[0].Candidates.Should().OnlyContain(c => c.Accepted && c.ItemId != null);
        Collection collection = await DbContext.Collections.AsNoTracking().SingleAsync();
        collection.Name.Should().Be(reloaded.Title);
        collection.IsPublic.Should().BeFalse();
        collection.IsDiscoverable.Should().BeFalse();
        (await DbContext.CollectionItems.CountAsync()).Should().Be(3);
        (await DbContext.StudyGuideAcceptedCandidates.CountAsync()).Should().Be(3);
    }

    [Fact]
    public async Task AutoSave_SkipsBlockedAndInvalidCandidatesAndStillFinishesTheSection()
    {
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());
        QuickStudyGuideDocument.Response response = await QuickAsync(MultiSectionText(1), saver);
        await CompleteAllAsync(response.Document, candidates: 3);
        List<GenerationCandidate> candidates = await DbContext.GenerationCandidates.OrderBy(c => c.Index).ToListAsync();
        candidates[0].Question = "Why badword?";
        candidates[1].CorrectAnswer = "Lyon";
        await DbContext.SaveChangesAsync();

        await saver.SweepAsync(CancellationToken.None);

        (await DbContext.Items.AsNoTracking().ToListAsync()).Should().ContainSingle()
            .Which.Question.Should().Be(candidates[2].Question);
        (await ReloadAsync(response.Document.Id)).Sections[0].AutoSave.Should().Be("Saved");

        // The public accept still refuses the same invalid candidate.
        Result<AcceptStudyGuideCandidates.Response?> manual = await ManualAcceptAsync(response.Document.Id, [candidates[1].Id]);
        manual.IsFailure.Should().BeTrue();
        manual.Error.Code.Should().Be("StudyGuideDocument.InvalidEdit");
    }

    [Fact]
    public async Task AutoSave_WaitsForCompletionAndNeverSavesFailedGenerations()
    {
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());
        QuickStudyGuideDocument.Response response = await QuickAsync(MultiSectionText(2), saver);

        (await saver.SweepAsync(CancellationToken.None)).Should().Be(0, "nothing has completed yet");

        SectionGeneration failed = await DbContext.SectionGenerations.OrderBy(g => g.CreatedUtc).FirstAsync();
        await StudyGuideTestData.Processor(DbContext, new FakeVendorHandler((_, _) => FakeVendorHandler.Status(System.Net.HttpStatusCode.InternalServerError)), Clock)
            .FailAsync(failed, CancellationToken.None);

        (await saver.SweepAsync(CancellationToken.None)).Should().Be(0);
        (await DbContext.Items.CountAsync()).Should().Be(0);
        StudyGuideDocumentContracts.Document reloaded = await ReloadAsync(response.Document.Id);
        reloaded.Sections.Should().OnlyContain(s => s.AutoSave == "Pending");
        reloaded.Sections.Count(s => s.Status == "Failed").Should().Be(1);
        (await TotalChargesAsync()).Should().Be(1, "the failed section was refunded");
    }

    [Fact]
    public async Task AutoSave_ASectionRetriedFromThePickerStillAutoSaves()
    {
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());
        QuickStudyGuideDocument.Response response = await QuickAsync(MultiSectionText(1), saver);
        SectionGeneration generation = await DbContext.SectionGenerations.SingleAsync();
        await StudyGuideTestData.Processor(DbContext, new FakeVendorHandler((_, _) => FakeVendorHandler.Status(System.Net.HttpStatusCode.InternalServerError)), Clock)
            .FailAsync(generation, CancellationToken.None);

        (await GenerateAsync(response.Document, response.Document.Sections)).IsSuccess.Should().BeTrue();
        await CompleteAllAsync(response.Document);
        await saver.SweepAsync(CancellationToken.None);

        (await ReloadAsync(response.Document.Id)).Sections[0].AutoSave.Should().Be("Saved");
        (await DbContext.Items.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task AutoSave_SectionsGeneratedThroughTheNormalFlowAreNotAutoSaved()
    {
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(1));
        await GenerateAsync(document, document.Sections);
        await CompleteAllAsync(document);

        (await saver.SweepAsync(CancellationToken.None)).Should().Be(0);

        (await DbContext.Items.CountAsync()).Should().Be(0);
        (await ReloadAsync(document.Id)).Sections[0].AutoSave.Should().BeNull();
    }

    [Fact]
    public async Task AutoSave_RepeatedFailuresEndInAFailedStateAndRollBackEverything()
    {
        Mock<IAuditService> audit = new();
        audit.Setup(a => a.LogAsync(It.IsAny<AuditAction>(), It.IsAny<Guid?>(), It.IsAny<Guid?>(), It.IsAny<Dictionary<string, string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("audit down"));
        using ServiceProvider provider = Provider(audit.Object);
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>(), audit.Object);
        QuickStudyGuideDocument.Response response = await QuickAsync(MultiSectionText(1), saver);
        await CompleteAllAsync(response.Document);

        for (int attempt = 0; attempt < GenerationOptions.AutoSaveMaxAttempts; attempt++)
        {
            (await saver.SaveDocumentAsync(Guid.Parse(response.Document.Id), CancellationToken.None)).Should().BeFalse();
        }

        (await saver.SweepAsync(CancellationToken.None)).Should().Be(0, "a Failed section is not picked up again");
        (await DbContext.Items.CountAsync()).Should().Be(0);
        (await DbContext.StudyGuideAcceptedCandidates.CountAsync()).Should().Be(0);
        StudyGuideSection section = await DbContext.StudyGuideSections.AsNoTracking().SingleAsync();
        section.AutoSave.Should().Be(StudyGuideAutoSave.Failed);
        section.AutoSaveAttempts.Should().Be(GenerationOptions.AutoSaveMaxAttempts);
        (await ReloadAsync(response.Document.Id)).Sections[0].AutoSave.Should().Be("Failed");
    }

    [Fact]
    public async Task AutoSave_AFailureAfterTheItemsWereCreatedLeavesNoOrphansAndTheRerunSucceeds()
    {
        FailAcceptedRowsOnce interceptor = new();
        await using ApplicationDbContext failing = CreateDbContext(interceptor);
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(failing, provider.GetRequiredService<IServiceScopeFactory>());
        QuickStudyGuideDocument.Response response = await QuickAsync(MultiSectionText(1), saver);
        await CompleteAllAsync(response.Document, candidates: 2);
        interceptor.Armed = true;

        (await saver.SaveDocumentAsync(Guid.Parse(response.Document.Id), CancellationToken.None)).Should().BeFalse();

        (await DbContext.Items.CountAsync()).Should().Be(0, "items, accepted rows and collection links commit together");
        (await DbContext.Collections.CountAsync()).Should().Be(0);
        (await DbContext.StudyGuideSections.AsNoTracking().SingleAsync()).AutoSave.Should().Be(StudyGuideAutoSave.Pending);

        (await saver.SaveDocumentAsync(Guid.Parse(response.Document.Id), CancellationToken.None)).Should().BeTrue();

        (await DbContext.Items.CountAsync()).Should().Be(2);
        (await DbContext.StudyGuideAcceptedCandidates.CountAsync()).Should().Be(2);
        (await DbContext.StudyGuideSections.AsNoTracking().SingleAsync()).AutoSave.Should().Be(StudyGuideAutoSave.Saved);
    }

    private sealed class FailAcceptedRowsOnce : SaveChangesInterceptor
    {
        public bool Armed { get; set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (Armed && eventData.Context!.ChangeTracker.Entries<StudyGuideAcceptedCandidate>().Any(e => e.State == EntityState.Added))
            {
                Armed = false;
                throw new DbUpdateException("simulated failure after the items were created");
            }

            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    [Fact]
    public async Task Document_SavedQuestionWhoseItemWasDeletedStaysSavedWithoutAnItemId()
    {
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());
        QuickStudyGuideDocument.Response response = await QuickAsync(MultiSectionText(1), saver);
        await CompleteAllAsync(response.Document, candidates: 2);
        await saver.SweepAsync(CancellationToken.None);
        Item removed = await DbContext.Items.OrderBy(i => i.Question).FirstAsync();
        DbContext.Items.Remove(removed);
        await DbContext.SaveChangesAsync();

        StudyGuideDocumentContracts.Document reloaded = await ReloadAsync(response.Document.Id);

        reloaded.Sections[0].Candidates.Should().OnlyContain(c => c.Accepted);
        reloaded.Sections[0].Candidates.Count(c => c.ItemId == null).Should().Be(1);
        reloaded.Sections[0].Candidates.Count(c => c.ItemId != null).Should().Be(1);
    }

    // ----- Worker (R11) -----

    [Fact]
    public async Task Worker_ProcessesAQuickJobAndSavesItsQuestionsInTheSameTick()
    {
        FakeVendorHandler handler = new((_, _) => FakeVendorHandler.Completion(StudyGuideTestData.QuestionsJson()));
        ServiceCollection services = new();
        services.AddScoped(_ => CreateDbContext());
        services.AddScoped(provider => new StudyGuideGenerationQueue(provider.GetRequiredService<ApplicationDbContext>(), MsOptions.Create(GenerationOptions), Clock));
        services.AddScoped(provider => StudyGuideTestData.Processor(provider.GetRequiredService<ApplicationDbContext>(), handler, Clock));
        services.AddScoped(provider => NewSaver(provider.GetRequiredService<ApplicationDbContext>(), provider.GetRequiredService<IServiceScopeFactory>()));
        await using ServiceProvider provider = services.BuildServiceProvider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());
        QuickStudyGuideDocument.Response response = await QuickAsync(StudyGuideTestData.SectionText, saver);
        StudyGuideGenerationWorker worker = new(
            provider.GetRequiredService<IServiceScopeFactory>(),
            Vendors,
            MsOptions.Create(GenerationOptions),
            NullLogger<StudyGuideGenerationWorker>.Instance);

        (await worker.RunOnceAsync(CancellationToken.None)).Should().Be(1);

        (await DbContext.Items.AsNoTracking().ToListAsync()).Should().HaveCount(4).And.OnlyContain(i => i.IsPrivate && i.CreatedBy == UserA);
        (await ReloadAsync(response.Document.Id)).Sections[0].AutoSave.Should().Be("Saved");
    }

    [Fact]
    public async Task Worker_StillSweepsWhenClaimingJobsThrows()
    {
        ServiceCollection services = new();
        services.AddScoped(_ => CreateDbContext());
        services.AddScoped(provider => NewSaver(provider.GetRequiredService<ApplicationDbContext>(), provider.GetRequiredService<IServiceScopeFactory>()));
        await using ServiceProvider provider = services.BuildServiceProvider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());
        QuickStudyGuideDocument.Response response = await QuickAsync(MultiSectionText(1), saver);
        await CompleteAllAsync(response.Document);
        StudyGuideGenerationWorker worker = new(
            provider.GetRequiredService<IServiceScopeFactory>(),
            Vendors,
            MsOptions.Create(GenerationOptions),
            NullLogger<StudyGuideGenerationWorker>.Instance);

        (await worker.RunOnceAsync(CancellationToken.None)).Should().Be(0, "the queue is not registered, so claiming throws");

        (await DbContext.Items.CountAsync()).Should().Be(2);
    }

    // ----- Config and bulk handler transaction ownership -----

    [Fact]
    public async Task Config_ReportsTheQuickPathSectionCap()
    {
        GetStudyGuideDocumentConfig.Response config = await GetStudyGuideDocumentConfig.HandleAsync(
            DbContext, UserA, Vendors, DocumentOptions, GenerationOptions, Clock.UtcNow, CancellationToken.None);

        config.QuickPathMaxSections.Should().Be(3);
    }

    [Fact]
    public async Task BulkAdd_InsideACallersTransaction_LeavesCommitAndRollbackToTheCaller()
    {
        AddItemsBulk.Request request = new(
            IsPrivate: true,
            Category: "geography",
            Keyword1: "capitals",
            Keyword2: "europe",
            Keywords: [],
            Items: [new AddItemsBulk.ItemRequest("Which city is the capital of Norway?", "Oslo", ["Bergen"], "Oslo is the capital.")]);

        await using (Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction = await DbContext.Database.BeginTransactionAsync())
        {
            Result<AddItemsBulk.Response> result = await AddItemsBulkHandler.HandleAsync(
                request, DbContext, SimHashService, StudyGuideTestData.User(UserA).Object, TaxonomyItemCategoryResolver,
                TaxonomyRegistry, Mock.Of<IAuditService>(), NullLogger.Instance, CancellationToken.None);

            result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Description : null);
            result.Value.CreatedCount.Should().Be(1);
            await transaction.RollbackAsync();
        }

        DbContext.ChangeTracker.Clear();
        (await DbContext.Items.CountAsync()).Should().Be(0);

        Result<AddItemsBulk.Response> standalone = await AddItemsBulkHandler.HandleAsync(
            request, DbContext, SimHashService, StudyGuideTestData.User(UserA).Object, TaxonomyItemCategoryResolver,
            TaxonomyRegistry, Mock.Of<IAuditService>(), NullLogger.Instance, CancellationToken.None);
        standalone.IsSuccess.Should().BeTrue();
        (await DbContext.Items.CountAsync()).Should().Be(1);
    }

    // ----- Generate failure mapping and degraded paths -----

    private sealed class FailGenerationInsertsInterceptor(int failures) : SaveChangesInterceptor
    {
        public int Remaining { get; private set; } = failures;

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (Remaining > 0 && eventData.Context!.ChangeTracker.Entries<SectionGeneration>().Any(e => e.State == EntityState.Added))
            {
                Remaining--;
                throw new DbUpdateException("simulated concurrent insert");
            }

            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    private async Task<QuickStudyGuideDocument.Response> QuickWithAsync(ApplicationDbContext db, StudyGuideAutoSaver saver, StudyGuideDocumentContracts.Document document) =>
        await QuickStudyGuideDocument.RunAsync(
            document, db, UserA, Vendors, saver, GenerationOptions, DocumentOptions.RetentionDays, Clock.UtcNow,
            NullLogger.Instance, CancellationToken.None);

    [Fact]
    public async Task Quick_AConflictingGenerateIsRetriedOnceAndThenSucceeds()
    {
        FailGenerationInsertsInterceptor interceptor = new(1);
        await using ApplicationDbContext failing = CreateDbContext(interceptor);
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(failing, provider.GetRequiredService<IServiceScopeFactory>());
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(1));

        QuickStudyGuideDocument.Response response = await QuickWithAsync(failing, saver, document);

        interceptor.Remaining.Should().Be(0);
        response.Outcome.Should().Be("Generating");
        response.ChargedSections.Should().Be(1);
    }

    [Fact]
    public async Task Quick_APersistentConflictIsUnavailableWithATryAgainLine()
    {
        FailGenerationInsertsInterceptor interceptor = new(2);
        await using ApplicationDbContext failing = CreateDbContext(interceptor);
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(failing, provider.GetRequiredService<IServiceScopeFactory>());
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(1));

        QuickStudyGuideDocument.Response response = await QuickWithAsync(failing, saver, document);

        response.Outcome.Should().Be("Unavailable");
        response.Message.Should().Contain("try again");
        (await TotalChargesAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Quick_ExpiredSectionTextNeedsAChoice()
    {
        using ServiceProvider provider = Provider();
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>());
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(1));
        StudyGuideSection stored = await DbContext.StudyGuideSections.SingleAsync();
        stored.Text = null;
        await DbContext.SaveChangesAsync();

        QuickStudyGuideDocument.Response response = await QuickWithAsync(DbContext, saver, document);

        response.Outcome.Should().Be("NeedsChoice");
        response.Message.Should().Contain("expired");
        (await TotalChargesAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Quick_WhenTheInlineAutoSaveFailsItDegradesToGeneratingInsteadOfFailing()
    {
        string text = MultiSectionText(1, "inline");
        StudyGuideDocumentContracts.Document theirs = await CreateTextAsync(text, UserB);
        await GenerateAsync(theirs, theirs.Sections, UserB);
        await CompleteAllAsync(theirs, candidates: 2);
        Mock<IAuditService> audit = new();
        audit.Setup(a => a.LogAsync(It.IsAny<AuditAction>(), It.IsAny<Guid?>(), It.IsAny<Guid?>(), It.IsAny<Dictionary<string, string>?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("audit down"));
        using ServiceProvider provider = Provider(audit.Object);
        StudyGuideAutoSaver saver = NewSaver(DbContext, provider.GetRequiredService<IServiceScopeFactory>(), audit.Object);

        QuickStudyGuideDocument.Response response = await QuickAsync(text, saver, UserA);

        response.Outcome.Should().Be("Generating");
        response.Document.Sections[0].AutoSave.Should().Be("Pending");
        (await DbContext.Items.CountAsync(i => i.CreatedBy == UserA)).Should().Be(0);
    }
}
