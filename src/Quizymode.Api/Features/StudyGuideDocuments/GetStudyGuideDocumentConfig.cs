using Quizymode.Api.Shared.Http;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Options;

namespace Quizymode.Api.Features.StudyGuideDocuments;

/// <summary>GET /study-guides/documents/config: availability, upload limits, free-tier delay, the "Make a quiz" section cap, and the caller's quota.</summary>
public static class GetStudyGuideDocumentConfig
{
    public static readonly IReadOnlyList<string> AcceptedExtensions = [".pdf", ".docx", ".pptx", ".txt", ".md"];

    public sealed record Response(
        bool Enabled,
        int MaxFileBytes,
        int MaxPages,
        int MaxTextBytes,
        List<string> AcceptedExtensions,
        int FreeTierDelayMinutes,
        StudyGuideDocumentContracts.Quota Quota,
        int QuickPathMaxSections);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("study-guides/documents/config", Handler)
                .WithTags("StudyGuideDocuments")
                .WithSummary("Get study guide document upload availability, limits, and my section quota")
                .WithDescription("enabled is true when at least one vendor in the caller's tier route (free or premium) has an API key configured.")
                .RequireAuthorization()
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status401Unauthorized);
        }

        private static async Task<IResult> Handler(
            ApplicationDbContext db,
            IUserContext userContext,
            ILlmVendorRegistry vendors,
            IOptions<StudyGuideDocumentOptions> documentOptions,
            IOptions<StudyGuideGenerationOptions> generationOptions,
            TimeProvider timeProvider,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            return Results.Ok(await HandleAsync(
                db,
                userContext.UserId,
                vendors,
                documentOptions.Value,
                generationOptions.Value,
                timeProvider.GetUtcNow().UtcDateTime,
                cancellationToken));
        }
    }

    internal static async Task<Response> HandleAsync(
        ApplicationDbContext db,
        string userId,
        ILlmVendorRegistry vendors,
        StudyGuideDocumentOptions documentOptions,
        StudyGuideGenerationOptions generationOptions,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        StudyGuideQuotaSnapshot quota = await StudyGuideQuota.GetAsync(db, userId, generationOptions, nowUtc, cancellationToken);
        return new Response(
            await LlmProviderSettingsStore.IsTierRouteAvailableAsync(db, vendors, quota.Tier, cancellationToken),
            documentOptions.MaxFileBytes,
            documentOptions.MaxPages,
            documentOptions.MaxTextBytes,
            AcceptedExtensions.ToList(),
            generationOptions.FreeTierDelayMinutes,
            quota.ToResponse(),
            Math.Max(1, generationOptions.QuickPathMaxSections));
    }
}
