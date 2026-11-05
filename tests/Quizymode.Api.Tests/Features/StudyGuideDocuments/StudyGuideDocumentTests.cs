using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Features.StudyGuideDocuments;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Xunit;

namespace Quizymode.Api.Tests.Features.StudyGuideDocuments;

public sealed class StudyGuideDocumentTests : StudyGuideDocumentFixture
{
    [Fact]
    public async Task Create_PastedText_StoresSectionsAndReturnsQuota()
    {
        Result<CreateStudyGuideDocument.Outcome> result = await CreateAsync(
            new CreateStudyGuideDocument.Request(MultiSectionText(3), null, "Geography", "Capitals", "Europe", ["Chapter-1", "capitals"]));

        result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Description : null);
        result.Value.Created.Should().BeTrue();
        StudyGuideDocumentContracts.Document document = result.Value.Document;
        document.FileType.Should().Be("txt");
        document.Title.Should().Be("Topic fact 1", "the first line is the default title for pasted text");
        document.IsDuplicate.Should().BeFalse();
        document.Keywords.Should().Equal("chapter-1");
        document.NavigationKeyword1.Should().Be("capitals");
        document.ExpiresUtc.Should().Be(Clock.UtcNow.AddDays(30));
        document.Sections.Should().HaveCount(3);
        document.Sections.Should().OnlyContain(section => section.Status == "New" && !section.TextExpired && section.Preview.Length <= 240);
        document.Sections[0].Label.Should().Be("Topic fact 1");
        document.Quota.Should().Be(new StudyGuideDocumentContracts.Quota("Free", 10, 0, 60, 0, 10));

        StudyGuideDocument stored = await DbContext.StudyGuideDocuments.SingleAsync();
        stored.UserId.Should().Be(UserA);
        stored.FileSha256.Should().HaveLength(64);
        stored.TextSha256.Should().HaveLength(64);
    }

    [Fact]
    public async Task Create_SameTextForSameUser_ReturnsExistingDocumentAsDuplicate()
    {
        StudyGuideDocumentContracts.Document first = await CreateTextAsync(MultiSectionText(2));

        Result<CreateStudyGuideDocument.Outcome> again = await CreateAsync(
            new CreateStudyGuideDocument.Request("  " + MultiSectionText(2).ToUpperInvariant(), "Other title", "geography", "capitals", "europe", null));

        again.Value.Created.Should().BeFalse();
        again.Value.Document.IsDuplicate.Should().BeTrue();
        again.Value.Document.Id.Should().Be(first.Id);
        (await DbContext.StudyGuideDocuments.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Create_SameTextForAnotherUser_CreatesSeparateDocument()
    {
        await CreateTextAsync(MultiSectionText(2));
        StudyGuideDocumentContracts.Document other = await CreateTextAsync(MultiSectionText(2), UserB);

        other.IsDuplicate.Should().BeFalse();
        (await DbContext.StudyGuideDocuments.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Create_RequiresExactlyOneOfFileOrText()
    {
        Result<CreateStudyGuideDocument.Outcome> neither = await CreateAsync(
            new CreateStudyGuideDocument.Request(null, null, "geography", "capitals", "europe", null));
        Result<CreateStudyGuideDocument.Outcome> both = await CreateAsync(
            new CreateStudyGuideDocument.Request("text", null, "geography", "capitals", "europe", null),
            new CreateStudyGuideDocument.UploadedFile(StudyGuideTestData.Bytes("file text"), "notes.txt"));

        neither.Error.Should().Be(StudyGuideDocumentErrors.FileOrTextRequired);
        both.Error.Should().Be(StudyGuideDocumentErrors.FileOrTextRequired);
    }

    [Fact]
    public async Task Create_ProfaneTextOrTitle_IsRejectedAndNothingStored()
    {
        Result<CreateStudyGuideDocument.Outcome> text = await CreateAsync(
            new CreateStudyGuideDocument.Request("A guide with a badword inside.", null, "geography", "capitals", "europe", null));
        Result<CreateStudyGuideDocument.Outcome> title = await CreateAsync(
            new CreateStudyGuideDocument.Request("Clean guide text.", "badword title", "geography", "capitals", "europe", null));

        text.Error.Should().Be(StudyGuideDocumentErrors.ProfanityBlocked);
        title.Error.Should().Be(StudyGuideDocumentErrors.ProfanityBlocked);
        (await DbContext.StudyGuideDocuments.AnyAsync()).Should().BeFalse();
    }

    [Fact]
    public async Task Create_InvalidTopic_IsRejected()
    {
        Result<CreateStudyGuideDocument.Outcome> path = await CreateAsync(
            new CreateStudyGuideDocument.Request("Some text.", null, "geography", "capitals", "not-a-real-subtopic", null));
        Result<CreateStudyGuideDocument.Outcome> category = await CreateAsync(
            new CreateStudyGuideDocument.Request("Some text.", null, "no-such-category-xyz", "capitals", "europe", null));

        path.Error.Code.Should().Be("StudyGuideDocument.InvalidNavigationPath");
        category.Error.Code.Should().Be("StudyGuideDocument.InvalidCategory");
    }

    [Fact]
    public async Task Create_PdfFile_UsesFileNameAsTitleAndPageLabels()
    {
        byte[] pdf = StudyGuideFixtures.Pdf(
            ["Paris is the capital and most populous city of France."],
            ["Berlin is the capital of Germany and its largest city by population."]);

        Result<CreateStudyGuideDocument.Outcome> result = await CreateAsync(
            new CreateStudyGuideDocument.Request(null, null, "geography", "capitals", "europe", null),
            new CreateStudyGuideDocument.UploadedFile(pdf, @"C:\fakepath\Europe Capitals.pdf"));

        result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Description : null);
        result.Value.Document.Title.Should().Be("Europe Capitals");
        result.Value.Document.FileType.Should().Be("pdf");
        result.Value.Document.PageCount.Should().Be(2);
        StudyGuideDocumentContracts.Section section = result.Value.Document.Sections.Single();
        section.Label.Should().Be("pp. 1\u20132");
        section.PageStart.Should().Be(1);
        section.Preview.Should().StartWith("Paris is the capital").And.NotContain("[p.");
    }

    [Fact]
    public async Task Create_UnsupportedFile_IsRejected()
    {
        Result<CreateStudyGuideDocument.Outcome> result = await CreateAsync(
            new CreateStudyGuideDocument.Request(null, null, "geography", "capitals", "europe", null),
            new CreateStudyGuideDocument.UploadedFile([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00], "image.png"));

        result.Error.Should().Be(StudyGuideDocumentErrors.UnsupportedType);
    }

    [Fact]
    public async Task GetAndList_AreOwnerOnly()
    {
        StudyGuideDocumentContracts.Document mine = await CreateTextAsync(MultiSectionText(1, "alpha"));
        Clock.UtcNow = Clock.UtcNow.AddMinutes(1);
        StudyGuideDocumentContracts.Document newer = await CreateTextAsync(MultiSectionText(1, "beta"));
        await CreateTextAsync(MultiSectionText(1, "gamma"), UserB);

        (await GetAsync(mine.Id, UserB)).Should().BeNull();
        (await GetAsync(mine.Id)).Should().NotBeNull();
        (await GetAsync(Guid.NewGuid().ToString())).Should().BeNull();

        ListStudyGuideDocuments.Response list = await ListStudyGuideDocuments.HandleAsync(DbContext, UserA, CancellationToken.None);
        list.Documents.Select(document => document.Id).Should().Equal(newer.Id, mine.Id);
        list.Documents[0].SectionCount.Should().Be(1);
        list.Documents[0].GeneratedSectionCount.Should().Be(0);
    }

    [Fact]
    public async Task Config_ReportsLimitsQuotaAndVendorAvailability()
    {
        GetStudyGuideDocumentConfig.Response enabled = await GetStudyGuideDocumentConfig.HandleAsync(
            DbContext, UserA, Vendors, DocumentOptions, GenerationOptions, Clock.UtcNow, CancellationToken.None);
        GetStudyGuideDocumentConfig.Response disabled = await GetStudyGuideDocumentConfig.HandleAsync(
            DbContext, UserA, new LlmVendorRegistry(StudyGuideTestData.Keys(false, false, false)), DocumentOptions, GenerationOptions, Clock.UtcNow, CancellationToken.None);

        enabled.Enabled.Should().BeTrue();
        disabled.Enabled.Should().BeFalse();
        enabled.MaxFileBytes.Should().Be(20 * 1024 * 1024);
        enabled.MaxPages.Should().Be(300);
        enabled.MaxTextBytes.Should().Be(1_048_576);
        enabled.AcceptedExtensions.Should().Equal(".pdf", ".docx", ".pptx", ".txt", ".md");
        enabled.FreeTierDelayMinutes.Should().Be(10);
        enabled.Quota.RemainingToday.Should().Be(10);
    }

    [Fact]
    public async Task Generate_FreeTier_ChargesQueuesWithDelayAndReportsStatus()
    {
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(3));

        Result<GenerateStudyGuideSections.Response?> result = await GenerateAsync(document, document.Sections.Take(2));

        result.Value!.ChargedSections.Should().Be(2);
        result.Value.QueuedCount.Should().Be(2);
        result.Value.CachedCount.Should().Be(0);
        result.Value.Quota.Should().Be(new StudyGuideDocumentContracts.Quota("Free", 10, 2, 60, 2, 8));

        List<SectionGeneration> generations = await DbContext.SectionGenerations.ToListAsync();
        generations.Should().HaveCount(2);
        generations.Should().OnlyContain(g =>
            g.Status == SectionGenerationStatus.Pending &&
            g.Tier == StudyGuideTier.Free &&
            g.NotBeforeUtc == Clock.UtcNow.AddMinutes(10) &&
            g.SourceText != null &&
            g.Mode == SectionGeneration.GuideOnlyMode &&
            g.PromptVersion == 1);
        (await DbContext.StudyGuideQuotaCharges.SumAsync(c => c.Cost)).Should().Be(2);

        StudyGuideDocumentContracts.Document? reloaded = await GetAsync(document.Id);
        reloaded!.Sections.Select(section => section.Status).Should().Equal("Queued", "Queued", "New");
        reloaded.Sections[0].NotBeforeUtc.Should().Be(Clock.UtcNow.AddMinutes(10));
        reloaded.Quota.DailyUsed.Should().Be(2);
    }

    [Fact]
    public async Task Generate_SameSectionsAgain_IsNotChargedTwice()
    {
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(2));
        await GenerateAsync(document, document.Sections);

        Result<GenerateStudyGuideSections.Response?> again = await GenerateAsync(document, document.Sections);

        again.Value!.ChargedSections.Should().Be(0);
        again.Value.QueuedCount.Should().Be(2);
        (await DbContext.StudyGuideQuotaCharges.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Generate_Premium_IsDueImmediatelyWithPremiumLimits()
    {
        await MakePremiumAsync(UserA);
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(12));

        Result<GenerateStudyGuideSections.Response?> result = await GenerateAsync(document, document.Sections);

        result.Value!.ChargedSections.Should().Be(12);
        result.Value.Quota.Tier.Should().Be("Premium");
        result.Value.Quota.DailyLimit.Should().Be(50);
        result.Value.Quota.MonthlyLimit.Should().Be(1000);
        (await DbContext.SectionGenerations.ToListAsync()).Should().OnlyContain(g =>
            g.Tier == StudyGuideTier.Premium && g.NotBeforeUtc == Clock.UtcNow);
    }

    [Fact]
    public async Task Generate_OverDailyQuota_IsAllOrNothing()
    {
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(11));

        Result<GenerateStudyGuideSections.Response?> result = await GenerateAsync(document, document.Sections);

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be(StudyGuideDocumentErrors.QuotaExceededCode);
        result.Error.Description.Should().Contain("daily limit of 10");
        (await DbContext.SectionGenerations.AnyAsync()).Should().BeFalse();
        (await DbContext.StudyGuideQuotaCharges.AnyAsync()).Should().BeFalse();
        (await DbContext.StudyGuideSections.AnyAsync(s => s.GenerationId != null)).Should().BeFalse();
    }

    [Fact]
    public async Task Generate_DailyQuotaResetsAtUtcMidnight()
    {
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(12));
        (await GenerateAsync(document, document.Sections.Take(10))).IsSuccess.Should().BeTrue();
        (await GenerateAsync(document, document.Sections.Skip(10).Take(1))).Error.Code.Should().Be(StudyGuideDocumentErrors.QuotaExceededCode);

        Clock.UtcNow = new DateTime(2026, 10, 18, 0, 0, 1, DateTimeKind.Utc);
        Result<GenerateStudyGuideSections.Response?> nextDay = await GenerateAsync(document, document.Sections.Skip(10));

        nextDay.Value!.ChargedSections.Should().Be(2);
        nextDay.Value.Quota.DailyUsed.Should().Be(2);
        nextDay.Value.Quota.MonthlyUsed.Should().Be(12);
    }

    [Fact]
    public async Task Generate_OverMonthlyQuota_NamesTheMonthlyLimit()
    {
        for (int day = 1; day <= 11; day++)
        {
            DbContext.StudyGuideQuotaCharges.Add(new StudyGuideQuotaCharge
            {
                Id = Guid.NewGuid(),
                UserId = UserA,
                SectionId = Guid.NewGuid(),
                GenerationId = Guid.NewGuid(),
                ChargedUtc = new DateTime(2026, 10, day, 9, 0, 0, DateTimeKind.Utc),
                Cost = 5
            });
        }

        DbContext.StudyGuideQuotaCharges.Add(new StudyGuideQuotaCharge
        {
            Id = Guid.NewGuid(),
            UserId = UserA,
            SectionId = Guid.NewGuid(),
            GenerationId = Guid.NewGuid(),
            ChargedUtc = new DateTime(2026, 9, 30, 23, 0, 0, DateTimeKind.Utc),
            Cost = 50
        });
        await DbContext.SaveChangesAsync();
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(6));
        document.Quota.MonthlyUsed.Should().Be(55, "charges from last month do not count");

        Result<GenerateStudyGuideSections.Response?> tooMany = await GenerateAsync(document, document.Sections);
        Result<GenerateStudyGuideSections.Response?> fits = await GenerateAsync(document, document.Sections.Take(5));

        tooMany.Error.Description.Should().Contain("monthly limit of 60");
        fits.Value!.Quota.RemainingToday.Should().Be(0);
    }

    [Fact]
    public async Task Generate_AdminOverridesReplaceTierLimits()
    {
        await SetSettingAsync(UserA, StudyGuideSettingKeys.DailySections, "2");
        await SetSettingAsync(UserA, StudyGuideSettingKeys.MonthlySections, "500");
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(3));

        Result<GenerateStudyGuideSections.Response?> result = await GenerateAsync(document, document.Sections);

        document.Quota.DailyLimit.Should().Be(2);
        document.Quota.MonthlyLimit.Should().Be(500);
        result.Error.Code.Should().Be(StudyGuideDocumentErrors.QuotaExceededCode);
    }

    [Fact]
    public async Task Generate_SectionAlreadyGeneratedByAnotherUser_IsFreeAndCached()
    {
        string text = MultiSectionText(2);
        StudyGuideDocumentContracts.Document theirs = await CreateTextAsync(text, UserB);
        await GenerateAsync(theirs, theirs.Sections.Take(1), UserB);
        await CompleteGenerationAsync(await GenerationIdOfAsync(theirs.Sections[0].Id));
        StudyGuideDocumentContracts.Document mine = await CreateTextAsync(text);

        Result<GenerateStudyGuideSections.Response?> result = await GenerateAsync(mine, mine.Sections);

        result.Value!.CachedCount.Should().Be(1);
        result.Value.ChargedSections.Should().Be(1, "only the section nobody generated yet is charged");
        StudyGuideDocumentContracts.Document? reloaded = await GetAsync(mine.Id);
        reloaded!.Sections[0].Status.Should().Be("Generated");
        reloaded.Sections[0].Cached.Should().BeTrue();
        reloaded.Sections[0].DroppedCount.Should().Be(1);
        reloaded.Sections[0].Candidates.Should().HaveCount(2);
        reloaded.Sections[0].Candidates[0].IncorrectAnswers.Should().Equal("Lyon", "Vienna", "Lisbon");
        reloaded.Sections[0].Candidates.Should().OnlyContain(candidate => !candidate.Accepted);
        (await DbContext.SectionGenerations.CountAsync()).Should().Be(2, "the cached generation is shared, not duplicated");

        StudyGuideDocumentContracts.Document? theirsReloaded = await GetAsync(theirs.Id, UserB);
        theirsReloaded!.Sections[0].Cached.Should().BeFalse("the user who paid for it was charged");
    }

    [Fact]
    public async Task Generate_SectionQueuedByAnotherUser_IsFreeAndPremiumMovesItForward()
    {
        string text = MultiSectionText(1);
        StudyGuideDocumentContracts.Document theirs = await CreateTextAsync(text, UserB);
        await GenerateAsync(theirs, theirs.Sections, UserB);
        await MakePremiumAsync(UserA);
        StudyGuideDocumentContracts.Document mine = await CreateTextAsync(text);

        Result<GenerateStudyGuideSections.Response?> result = await GenerateAsync(mine, mine.Sections);

        result.Value!.ChargedSections.Should().Be(0);
        result.Value.QueuedCount.Should().Be(1);
        SectionGeneration generation = await DbContext.SectionGenerations.SingleAsync();
        generation.Tier.Should().Be(StudyGuideTier.Premium);
        generation.NotBeforeUtc.Should().Be(Clock.UtcNow);
        (await DbContext.StudyGuideQuotaCharges.CountAsync(c => c.UserId == UserA)).Should().Be(0);
    }

    [Fact]
    public async Task Generate_FailedGeneration_IsRetriedAsANewCharge()
    {
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(1));
        await GenerateAsync(document, document.Sections);
        SectionGeneration generation = await DbContext.SectionGenerations.SingleAsync();
        generation.Status = SectionGenerationStatus.Failed;
        generation.Error = "failed";
        generation.SourceText = null;
        generation.Attempts = 3;
        DbContext.StudyGuideQuotaCharges.RemoveRange(DbContext.StudyGuideQuotaCharges);
        await DbContext.SaveChangesAsync();

        Result<GenerateStudyGuideSections.Response?> retry = await GenerateAsync(document, document.Sections);

        retry.Value!.ChargedSections.Should().Be(1);
        generation.Status.Should().Be(SectionGenerationStatus.Pending);
        generation.Attempts.Should().Be(0);
        generation.Error.Should().BeNull();
        generation.SourceText.Should().NotBeNull();
        (await DbContext.SectionGenerations.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Generate_GlobalBudgetReached_Returns503Error()
    {
        GenerationOptions.MonthlySectionBudget = 3;
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(4));
        (await GenerateAsync(document, document.Sections.Take(2))).IsSuccess.Should().BeTrue();

        Result<GenerateStudyGuideSections.Response?> result = await GenerateAsync(document, document.Sections.Skip(2));

        result.Error.Code.Should().Be(StudyGuideDocumentErrors.BudgetReachedCode);
        (await DbContext.StudyGuideQuotaCharges.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Generate_NoVendorKey_IsDisabled()
    {
        Vendors = new LlmVendorRegistry(StudyGuideTestData.Keys(false, false, false));
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(1));

        (await GenerateAsync(document, document.Sections)).Error.Code.Should().Be(StudyGuideDocumentErrors.DisabledCode);
    }

    private async Task SetUpPremiumRouteWithoutKeyAsync()
    {
        // Only Gemini has a key; the free route reaches it, the premium route (OpenRouter, OpenAI) does not.
        Vendors = new LlmVendorRegistry(StudyGuideTestData.Keys(false, false, true));
        await SetRoutesAsync([LlmVendors.Gemini], [LlmVendors.OpenRouter, LlmVendors.OpenAI]);
        await MakePremiumAsync(UserA);
    }

    private Task<GetStudyGuideDocumentConfig.Response> ConfigAsync(string userId) =>
        GetStudyGuideDocumentConfig.HandleAsync(DbContext, userId, Vendors, DocumentOptions, GenerationOptions, Clock.UtcNow, CancellationToken.None);

    [Fact]
    public async Task Config_PremiumRouteWithoutKeyedVendor_DisabledForPremiumEnabledForFree()
    {
        await SetUpPremiumRouteWithoutKeyAsync();

        (await ConfigAsync(UserA)).Enabled.Should().BeFalse("the premium user's route has no keyed vendor");
        (await ConfigAsync(UserB)).Enabled.Should().BeTrue("the free route reaches the keyed Gemini");
    }

    [Fact]
    public async Task Generate_PremiumRouteWithoutKeyedVendor_IsDisabledAndWritesNothing()
    {
        await SetUpPremiumRouteWithoutKeyAsync();
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(1));

        Result<GenerateStudyGuideSections.Response?> result = await GenerateAsync(document, document.Sections);

        result.Error.Code.Should().Be(StudyGuideDocumentErrors.DisabledCode);
        (await DbContext.StudyGuideQuotaCharges.CountAsync()).Should().Be(0);
        (await DbContext.SectionGenerations.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Generate_FreeUserWithKeyedFreeRoute_Succeeds()
    {
        await SetUpPremiumRouteWithoutKeyAsync();
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(1), UserB);

        Result<GenerateStudyGuideSections.Response?> result = await GenerateAsync(document, document.Sections, UserB);

        result.IsSuccess.Should().BeTrue();
        result.Value!.ChargedSections.Should().Be(1);
    }

    [Fact]
    public async Task Generate_ForeignSectionsOrDocument_AreRejected()
    {
        StudyGuideDocumentContracts.Document mine = await CreateTextAsync(MultiSectionText(1, "mine"));
        StudyGuideDocumentContracts.Document theirs = await CreateTextAsync(MultiSectionText(1, "theirs"), UserB);

        Result<GenerateStudyGuideSections.Response?> foreignSection = await GenerateAsync(
            Guid.Parse(mine.Id), [Guid.Parse(mine.Sections[0].Id), Guid.Parse(theirs.Sections[0].Id)]);
        Result<GenerateStudyGuideSections.Response?> foreignDocument = await GenerateAsync(theirs, theirs.Sections);

        foreignSection.Error.Should().Be(StudyGuideDocumentErrors.InvalidSections);
        foreignDocument.IsSuccess.Should().BeTrue();
        foreignDocument.Value.Should().BeNull("another user's document is reported as not found");
    }

    [Fact]
    public async Task Generate_ExpiredSectionText_IsRejected()
    {
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(1));
        await DbContext.StudyGuideSections.ExecuteUpdateAsync(setters => setters.SetProperty(s => s.Text, (string?)null));
        DbContext.ChangeTracker.Clear();

        (await GenerateAsync(document, document.Sections)).Error.Should().Be(StudyGuideDocumentErrors.SectionExpired);
        (await GetAsync(document.Id))!.Sections[0].TextExpired.Should().BeTrue();
    }

    [Fact]
    public async Task Generate_RefreshesDocumentExpiry()
    {
        StudyGuideDocumentContracts.Document document = await CreateTextAsync(MultiSectionText(1));
        Clock.UtcNow = Clock.UtcNow.AddDays(5);

        await GenerateAsync(document, document.Sections);

        StudyGuideDocument stored = await DbContext.StudyGuideDocuments.SingleAsync();
        stored.LastActivityUtc.Should().Be(Clock.UtcNow);
        stored.ExpiresUtc.Should().Be(Clock.UtcNow.AddDays(30));
    }

    [Fact]
    public void GenerateValidator_LimitsSectionCount()
    {
        GenerateStudyGuideSections.Validator validator = new();

        validator.Validate(new GenerateStudyGuideSections.Request([])).IsValid.Should().BeFalse();
        validator.Validate(new GenerateStudyGuideSections.Request(null)).IsValid.Should().BeFalse();
        validator.Validate(new GenerateStudyGuideSections.Request(Enumerable.Range(0, 51).Select(_ => Guid.NewGuid()).ToList())).IsValid.Should().BeFalse();
        validator.Validate(new GenerateStudyGuideSections.Request([Guid.NewGuid()])).IsValid.Should().BeTrue();
    }

    [Fact]
    public void CreateValidator_EnforcesTitleKeywordsAndTextSize()
    {
        CreateStudyGuideDocument.Validator validator = new(Microsoft.Extensions.Options.Options.Create(DocumentOptions));

        validator.Validate(new CreateStudyGuideDocument.Request("x", new string('t', 201), "geography", "capitals", "europe", null)).IsValid.Should().BeFalse();
        validator.Validate(new CreateStudyGuideDocument.Request("x", null, "geography", "capitals", "europe", ["bad keyword!"])).IsValid.Should().BeFalse();
        validator.Validate(new CreateStudyGuideDocument.Request("x", null, null, "capitals", "europe", null)).IsValid.Should().BeFalse();
        validator.Validate(new CreateStudyGuideDocument.Request(StudyGuideTestData.Utf8(1_048_577), null, "geography", "capitals", "europe", null)).IsValid.Should().BeFalse();
        validator.Validate(new CreateStudyGuideDocument.Request("x", "Title", "geography", "capitals", "europe", ["ok-1"])).IsValid.Should().BeTrue();
        StudyGuideDocumentForm.SplitKeywords(["a, b", "c"]).Should().Equal("a", "b", "c");
    }
}
