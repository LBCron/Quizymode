using Quizymode.Api.Shared.Http;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Shared.Options;

namespace Quizymode.Api.Features.StudyGuideDocuments;

/// <summary>
/// POST /study-guides/documents/{id}/generate: queue question generation for selected sections. Sections whose text was
/// already generated (by anyone) attach to the shared cached generation for free; sections already queued attach for free
/// (a premium caller moves the job to the front); everything else is charged one section of quota and queued (free tier
/// after a delay, premium immediately). All-or-nothing: if the charge would exceed the daily or monthly quota, nothing is
/// queued. Rejected with 503 Disabled, before anything is charged, when no vendor in the caller's tier route has an API key.
/// </summary>
public static class GenerateStudyGuideSections
{
    public const int MaxSectionsPerRequest = 50;

    public sealed record Request(List<Guid>? SectionIds);

    public sealed record Response(int QueuedCount, int CachedCount, int ChargedSections, StudyGuideDocumentContracts.Quota Quota);

    public sealed class Validator : AbstractValidator<Request>
    {
        public Validator()
        {
            RuleFor(x => x.SectionIds)
                .NotNull()
                .WithMessage("Select at least one section.")
                .Must(ids => ids is not null && ids.Count is > 0 and <= MaxSectionsPerRequest)
                .WithMessage($"Select between 1 and {MaxSectionsPerRequest} sections.");
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPost("study-guides/documents/{id:guid}/generate", Handler)
                .WithTags("StudyGuideDocuments")
                .WithSummary("Queue question generation for selected sections of my study guide")
                .WithDescription("Returns 202 with queued/cached/charged counts and the updated quota. 429 StudyGuideDocument.QuotaExceeded " +
                    "when the charge would exceed the daily or monthly section quota (nothing is queued); 503 StudyGuideDocument.Disabled " +
                    "when no vendor in the caller's tier route has an API key (nothing is charged or queued) or StudyGuideDocument.BudgetReached when the global monthly budget is used up.")
                .RequireAuthorization()
                .Produces<Response>(StatusCodes.Status202Accepted)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status404NotFound)
                .Produces(StatusCodes.Status429TooManyRequests)
                .Produces(StatusCodes.Status503ServiceUnavailable);
        }

        private static async Task<IResult> Handler(
            Guid id,
            Request request,
            IValidator<Request> validator,
            ApplicationDbContext db,
            IUserContext userContext,
            ILlmVendorRegistry vendors,
            IOptions<StudyGuideGenerationOptions> generationOptions,
            IOptions<StudyGuideDocumentOptions> documentOptions,
            TimeProvider timeProvider,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            FluentValidation.Results.ValidationResult validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid)
            {
                return Results.BadRequest(validation.Errors);
            }

            Result<Response?> result = await HandleAsync(
                id,
                request,
                db,
                userContext.UserId,
                vendors,
                generationOptions.Value,
                documentOptions.Value.RetentionDays,
                timeProvider.GetUtcNow().UtcDateTime,
                cancellationToken);

            return result.Match(
                value => value is null ? Results.NotFound() : Results.Accepted($"/study-guides/documents/{id}", value),
                _ => StudyGuideDocumentResults.Problem(result));
        }
    }

    internal static async Task<Result<Response?>> HandleAsync(
        Guid id,
        Request request,
        ApplicationDbContext db,
        string userId,
        ILlmVendorRegistry vendors,
        StudyGuideGenerationOptions options,
        int retentionDays,
        DateTime nowUtc,
        CancellationToken cancellationToken,
        bool autoSave = false,
        bool quickPath = false)
    {
        StudyGuideDocument? document = await db.StudyGuideDocuments
            .FirstOrDefaultAsync(d => d.Id == id && d.UserId == userId, cancellationToken);
        if (document is null)
        {
            return Result.Success<Response?>(null);
        }

        // Runs before the quota transaction: seeding the routing row can SaveChanges and recover from a DbUpdateException,
        // which would abort an open Npgsql transaction.
        StudyGuideTier callerTier = await StudyGuideQuota.GetTierAsync(db, userId, cancellationToken);
        if (!await LlmProviderSettingsStore.IsTierRouteAvailableAsync(db, vendors, callerTier, cancellationToken))
        {
            return Result.Failure<Response?>(StudyGuideDocumentErrors.Disabled);
        }

        // Serialize generate requests per user (Postgres only) so concurrent calls cannot both pass the quota check.
        // The transaction-scoped advisory lock is released on commit, or on rollback when an early return disposes it.
        await using Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction? quotaLock = db.Database.IsNpgsql()
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;
        if (quotaLock is not null)
        {
            string lockKey = "study-guide-quota:" + userId;
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock(hashtext({lockKey}))",
                cancellationToken);
        }

        List<Guid> sectionIds = (request.SectionIds ?? []).Distinct().ToList();
        List<StudyGuideSection> sections = await db.StudyGuideSections
            .Where(section => section.DocumentId == document.Id && sectionIds.Contains(section.Id))
            .OrderBy(section => section.Index)
            .ToListAsync(cancellationToken);
        if (sections.Count == 0 || sections.Count != sectionIds.Count)
        {
            return Result.Failure<Response?>(StudyGuideDocumentErrors.InvalidSections);
        }

        List<Guid> attachedIds = sections.Where(s => s.GenerationId.HasValue).Select(s => s.GenerationId!.Value).Distinct().ToList();
        List<string> hashes = sections.Select(s => s.TextSha256).Distinct().ToList();
        List<SectionGeneration> known = await db.SectionGenerations
            .Where(generation =>
                attachedIds.Contains(generation.Id) ||
                (hashes.Contains(generation.TextSha256) &&
                 generation.Mode == SectionGeneration.GuideOnlyMode &&
                 generation.PromptVersion == SectionGeneration.CurrentPromptVersion))
            .ToListAsync(cancellationToken);

        Dictionary<Guid, SectionGeneration> byId = known.ToDictionary(generation => generation.Id);
        Dictionary<string, SectionGeneration> byHash = known
            .Where(generation => generation.Mode == SectionGeneration.GuideOnlyMode &&
                                 generation.PromptVersion == SectionGeneration.CurrentPromptVersion)
            .GroupBy(generation => generation.TextSha256, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

        StudyGuideQuotaSnapshot quota = await StudyGuideQuota.GetAsync(db, userId, options, nowUtc, cancellationToken);
        bool premium = quota.Tier == StudyGuideTier.Premium;
        int delayMinutes = quickPath ? options.QuickPathFreeTierDelayMinutes : options.FreeTierDelayMinutes;
        DateTime dueUtc = premium ? nowUtc : nowUtc.AddMinutes(Math.Max(0, delayMinutes));

        int queued = 0;
        int cached = 0;
        HashSet<Guid> resetIds = [];
        List<SectionGeneration> created = [];
        List<(StudyGuideSection Section, SectionGeneration Generation)> charged = [];
        List<(StudyGuideSection Section, SectionGeneration Generation)> attachments = [];
        HashSet<Guid> bumped = [];
        // Quick path (#363): attached free jobs that are still waiting are pulled forward to the quick-path due time.
        HashSet<Guid> pulled = [];

        foreach (StudyGuideSection section in sections)
        {
            SectionGeneration? attached = section.GenerationId.HasValue ? byId.GetValueOrDefault(section.GenerationId.Value) : null;
            if (attached is not null && attached.Status != SectionGenerationStatus.Failed)
            {
                // Already attached: nothing new to queue or charge.
                if (attached.Status == SectionGenerationStatus.Completed)
                {
                    cached++;
                }
                else
                {
                    queued++;
                    if (premium)
                    {
                        bumped.Add(attached.Id);
                    }

                    if (quickPath)
                    {
                        pulled.Add(attached.Id);
                    }
                }

                continue;
            }

            SectionGeneration? shared = byHash.GetValueOrDefault(section.TextSha256) ?? attached;
            if (shared is not null && (resetIds.Contains(shared.Id) || created.Contains(shared)))
            {
                // Another selected section with the same text is already being charged in this request.
                attachments.Add((section, shared));
                queued++;
                continue;
            }

            if (shared is not null && shared.Status == SectionGenerationStatus.Completed)
            {
                attachments.Add((section, shared));
                cached++;
                continue;
            }

            if (shared is not null && shared.Status is SectionGenerationStatus.Pending or SectionGenerationStatus.Processing)
            {
                attachments.Add((section, shared));
                queued++;
                if (premium)
                {
                    bumped.Add(shared.Id);
                }

                if (quickPath)
                {
                    pulled.Add(shared.Id);
                }

                continue;
            }

            if (section.Text is null)
            {
                return Result.Failure<Response?>(StudyGuideDocumentErrors.SectionExpired);
            }

            SectionGeneration generation;
            if (shared is not null)
            {
                // Failed generation: retry it as a new charge.
                generation = shared;
                resetIds.Add(generation.Id);
            }
            else
            {
                generation = new SectionGeneration
                {
                    Id = Guid.NewGuid(),
                    TextSha256 = section.TextSha256,
                    Mode = SectionGeneration.GuideOnlyMode,
                    PromptVersion = SectionGeneration.CurrentPromptVersion,
                    CreatedUtc = nowUtc
                };
                created.Add(generation);
                byHash[section.TextSha256] = generation;
            }

            generation.SourceText = section.Text;
            charged.Add((section, generation));
            queued++;
        }

        int chargedCount = charged.Count;
        if (chargedCount > quota.RemainingToday)
        {
            return Result.Failure<Response?>(StudyGuideDocumentErrors.QuotaExceeded(QuotaMessage(quota, chargedCount)));
        }

        if (chargedCount > 0)
        {
            int budgetUsed = await StudyGuideQuota.GlobalMonthlyUsedAsync(db, nowUtc, cancellationToken);
            if (budgetUsed + chargedCount > options.MonthlySectionBudget)
            {
                return Result.Failure<Response?>(StudyGuideDocumentErrors.BudgetReached);
            }
        }

        foreach ((StudyGuideSection section, SectionGeneration generation) in charged)
        {
            generation.Status = SectionGenerationStatus.Pending;
            generation.Tier = premium ? StudyGuideTier.Premium : StudyGuideTier.Free;
            generation.NotBeforeUtc = dueUtc;
            generation.LeaseUntilUtc = null;
            generation.Attempts = 0;
            generation.Error = null;
            generation.CompletedUtc = null;
            generation.QueuedUtc = nowUtc;
            section.GenerationId = generation.Id;
            section.RequestedUtc = nowUtc;
            db.StudyGuideQuotaCharges.Add(new StudyGuideQuotaCharge
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                SectionId = section.Id,
                GenerationId = generation.Id,
                ChargedUtc = nowUtc,
                Cost = 1
            });
        }

        foreach ((StudyGuideSection section, SectionGeneration generation) in attachments)
        {
            section.GenerationId = generation.Id;
            section.RequestedUtc = nowUtc;
        }

        if (autoSave)
        {
            // Every requested section auto-saves, including cached and already-queued ones (they carry no charge).
            foreach (StudyGuideSection section in sections.Where(section => section.AutoSave != StudyGuideAutoSave.Saved))
            {
                section.AutoSave = StudyGuideAutoSave.Pending;
                section.AutoSaveAttempts = 0;
            }
        }

        foreach (Guid generationId in pulled)
        {
            SectionGeneration generation = byId.GetValueOrDefault(generationId) ?? byHash.Values.First(g => g.Id == generationId);
            if (generation.Status == SectionGenerationStatus.Pending && generation.NotBeforeUtc > dueUtc)
            {
                generation.NotBeforeUtc = dueUtc;
            }
        }

        foreach (Guid generationId in bumped)
        {
            SectionGeneration generation = byId.GetValueOrDefault(generationId) ?? byHash.Values.First(g => g.Id == generationId);
            generation.Tier = StudyGuideTier.Premium;
            if (generation.Status == SectionGenerationStatus.Pending && generation.NotBeforeUtc > nowUtc)
            {
                generation.NotBeforeUtc = nowUtc;
            }
        }

        db.SectionGenerations.AddRange(created);
        document.LastActivityUtc = nowUtc;
        document.ExpiresUtc = nowUtc.AddDays(Math.Max(1, retentionDays));

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            if (quotaLock is not null)
            {
                await quotaLock.CommitAsync(cancellationToken);
            }
        }
        catch (DbUpdateException)
        {
            // A concurrent request created the same generation (unique text hash key). Nothing was charged.
            db.ChangeTracker.Clear();
            return Result.Failure<Response?>(StudyGuideDocumentErrors.Conflict);
        }

        StudyGuideQuotaSnapshot updated = quota with
        {
            DailyUsed = quota.DailyUsed + chargedCount,
            MonthlyUsed = quota.MonthlyUsed + chargedCount
        };
        return Result.Success<Response?>(new Response(queued, cached, chargedCount, updated.ToResponse()));
    }

    internal static string QuotaMessage(StudyGuideQuotaSnapshot quota, int requested)
    {
        int dailyLeft = Math.Max(0, quota.DailyLimit - quota.DailyUsed);
        int monthlyLeft = Math.Max(0, quota.MonthlyLimit - quota.MonthlyUsed);
        return dailyLeft <= monthlyLeft
            ? $"This needs {requested} new section(s), but your daily limit of {quota.DailyLimit} sections leaves {dailyLeft} for today."
            : $"This needs {requested} new section(s), but your monthly limit of {quota.MonthlyLimit} sections leaves {monthlyLeft} this month.";
    }
}
