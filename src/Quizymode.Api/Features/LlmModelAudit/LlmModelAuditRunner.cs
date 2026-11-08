using System.Text;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Shared.Email;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.LlmModelAudit;

internal sealed record LlmModelAuditRunResult(int NewFindings, int Resolved, bool EmailSent);

/// <summary>
/// One audit pass (#480): list each configured vendor's models, compare with the configured model, record or resolve
/// findings, then send one digest of findings not yet notified. Never changes models. Runs are serialised per process by
/// a lock, and the digest is claimed with a conditional update so two instances cannot both send it.
/// </summary>
internal sealed class LlmModelAuditRunner(
    ApplicationDbContext db,
    ILlmVendorRegistry vendors,
    ILlmModelCatalogClient catalog,
    IEmailSender emailSender,
    TimeProvider timeProvider,
    ILogger<LlmModelAuditRunner> logger)
{
    private static readonly SemaphoreSlim RunLock = new(1, 1);

    public async Task<LlmModelAuditRunResult> RunAsync(CancellationToken cancellationToken)
    {
        await RunLock.WaitAsync(cancellationToken);
        try
        {
            return await RunCoreAsync(cancellationToken);
        }
        finally
        {
            RunLock.Release();
        }
    }

    private async Task<LlmModelAuditRunResult> RunCoreAsync(CancellationToken cancellationToken)
    {
        DateTime now = timeProvider.GetUtcNow().UtcDateTime;
        LlmProviderSettings settings = await LlmProviderSettingsStore.GetOrCreateAsync(db, cancellationToken);
        int newFindings = 0;
        int resolved = 0;

        foreach (string vendor in LlmVendors.All)
        {
            LlmVendorEndpoint endpoint = vendors.Get(vendor);
            if (!endpoint.IsConfigured || string.IsNullOrWhiteSpace(endpoint.BaseUrl))
            {
                logger.LogInformation("LlmModelAudit: skipped {Vendor} (no key or base URL configured)", vendor);
                continue;
            }

            string model = LlmProviderSettingsStore.ModelFor(settings, vendor);
            LlmCatalogResult result = await catalog.ListModelsAsync(endpoint, cancellationToken);
            if (result.Outcome != LlmCatalogOutcome.Ok)
            {
                // Check failed (auth, 5xx, timeout, oversize): says nothing about the model, so no finding and no change.
                continue;
            }

            List<LlmModelFinding> open = await db.LlmModelFindings
                .Where(f => f.Vendor == vendor && f.Status == LlmModelFindingStatus.Open)
                .ToListAsync(cancellationToken);
            bool present = result.Models.Contains(model);

            foreach (LlmModelFinding finding in open.Where(f => present || f.Model != model))
            {
                // The model is listed again, or an admin switched the vendor to another model: the old finding is done.
                finding.Status = LlmModelFindingStatus.Resolved;
                finding.ResolvedUtc = now;
                resolved++;
            }

            await db.SaveChangesAsync(cancellationToken);
            if (present)
            {
                continue;
            }

            LlmModelFinding? existing = open.FirstOrDefault(f => f.Model == model);
            if (existing is not null)
            {
                existing.LastSeenUtc = now;
                await db.SaveChangesAsync(cancellationToken);
                continue;
            }

            LlmModelFinding added = new()
            {
                Id = Guid.NewGuid(),
                Vendor = vendor,
                Model = model,
                Kind = LlmModelFindingKind.ModelMissing,
                Status = LlmModelFindingStatus.Open,
                FirstSeenUtc = now,
                LastSeenUtc = now
            };
            db.LlmModelFindings.Add(added);
            try
            {
                await db.SaveChangesAsync(cancellationToken);
                newFindings++;
                logger.LogWarning("LlmModelAudit: {Vendor} model {Model} is not in the vendor model list", vendor, model);
            }
            catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation })
            {
                // Another instance inserted the same open finding first (partial unique index): nothing new from this run.
                db.Entry(added).State = EntityState.Detached;
            }
        }

        bool emailSent = await SendDigestAsync(now, cancellationToken);
        return new LlmModelAuditRunResult(newFindings, resolved, emailSent);
    }

    private async Task<bool> SendDigestAsync(DateTime now, CancellationToken cancellationToken)
    {
        List<LlmModelFinding> pending = await db.LlmModelFindings
            .AsNoTracking()
            .Where(f => f.Status == LlmModelFindingStatus.Open && f.NotifiedUtc == null)
            .OrderBy(f => f.Vendor).ThenBy(f => f.Model)
            .ToListAsync(cancellationToken);
        if (pending.Count == 0)
        {
            return false;
        }

        List<Guid> ids = pending.Select(f => f.Id).ToList();
        int claimed = await db.LlmModelFindings
            .Where(f => ids.Contains(f.Id) && f.NotifiedUtc == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(f => f.NotifiedUtc, now), cancellationToken);
        if (claimed == 0)
        {
            return false;
        }

        StringBuilder body = new();
        body.AppendLine("These configured LLM models were not found in the vendor model list:");
        foreach (LlmModelFinding finding in pending)
        {
            body.AppendLine($"- {finding.Vendor}: {finding.Model} (first seen {finding.FirstSeenUtc:u})");
        }

        body.AppendLine();
        body.AppendLine("Change the model on the Admin > AI providers page. Nothing was changed automatically.");

        bool sent = await emailSender.SendToAdminAsync("Quizymode: LLM model missing from vendor list", body.ToString(), cancellationToken);
        if (!sent)
        {
            // Release the claim so the next run retries.
            await db.LlmModelFindings
                .Where(f => ids.Contains(f.Id) && f.NotifiedUtc == now)
                .ExecuteUpdateAsync(setters => setters.SetProperty(f => f.NotifiedUtc, (DateTime?)null), CancellationToken.None);
        }

        return sent;
    }
}
