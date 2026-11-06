using System.Net;
using System.Text.Json;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;

namespace Quizymode.Api.Features.LlmModelAudit;

internal enum LlmCatalogOutcome
{
    Ok,
    Failed
}

internal sealed record LlmCatalogResult(LlmCatalogOutcome Outcome, IReadOnlySet<string> Models);

internal interface ILlmModelCatalogClient
{
    Task<LlmCatalogResult> ListModelsAsync(LlmVendorEndpoint endpoint, CancellationToken cancellationToken);
}

/// <summary>
/// GET {BaseUrl}/models with the vendor key in a header (never in the URL). No generation, no token spend. Bounded:
/// 15 s timeout (set on the HttpClient), 1 MB body, 5000 entries. Logs vendor and a short reason only, never bodies or keys.
/// </summary>
internal sealed class HttpLlmModelCatalogClient(HttpClient httpClient, ILogger<HttpLlmModelCatalogClient> logger) : ILlmModelCatalogClient
{
    public const int MaxBodyBytes = 1_048_576;
    public const int MaxModels = 5000;

    public async Task<LlmCatalogResult> ListModelsAsync(LlmVendorEndpoint endpoint, CancellationToken cancellationToken)
    {
        try
        {
            using HttpRequestMessage request = new(HttpMethod.Get, endpoint.BaseUrl.TrimEnd('/') + "/models");
            if (string.Equals(endpoint.Vendor, LlmVendors.Gemini, StringComparison.OrdinalIgnoreCase))
            {
                request.Headers.TryAddWithoutValidation("x-goog-api-key", endpoint.ApiKey);
            }
            else
            {
                request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + endpoint.ApiKey);
            }

            using HttpResponseMessage response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (response.StatusCode != HttpStatusCode.OK)
            {
                return Failed(endpoint.Vendor, $"HTTP {(int)response.StatusCode}");
            }

            if (response.Content.Headers.ContentLength > MaxBodyBytes)
            {
                return Failed(endpoint.Vendor, "response too large");
            }

            await using Stream stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using MemoryStream buffer = new();
            byte[] chunk = new byte[16 * 1024];
            int read;
            while ((read = await stream.ReadAsync(chunk, cancellationToken)) > 0)
            {
                if (buffer.Length + read > MaxBodyBytes)
                {
                    return Failed(endpoint.Vendor, "response too large");
                }

                buffer.Write(chunk, 0, read);
            }

            return Parse(endpoint.Vendor, buffer.ToArray());
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Failed(endpoint.Vendor, "timeout");
        }
        catch (HttpRequestException)
        {
            return Failed(endpoint.Vendor, "network error");
        }
    }

    private LlmCatalogResult Parse(string vendor, byte[] body)
    {
        try
        {
            using JsonDocument document = JsonDocument.Parse(body);
            HashSet<string> models = new(StringComparer.Ordinal);
            foreach (string arrayName in new[] { "data", "models" })
            {
                if (document.RootElement.ValueKind != JsonValueKind.Object
                    || !document.RootElement.TryGetProperty(arrayName, out JsonElement array)
                    || array.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                foreach (JsonElement item in array.EnumerateArray())
                {
                    string? id = ReadString(item, "id") ?? ReadString(item, "name");
                    if (string.IsNullOrWhiteSpace(id))
                    {
                        continue;
                    }

                    id = id.Trim();
                    models.Add(id.StartsWith("models/", StringComparison.Ordinal) ? id["models/".Length..] : id);
                    if (models.Count >= MaxModels)
                    {
                        break;
                    }
                }
            }

            return new LlmCatalogResult(LlmCatalogOutcome.Ok, models);
        }
        catch (JsonException)
        {
            return Failed(vendor, "invalid response");
        }
    }

    private static string? ReadString(JsonElement item, string name) =>
        item.ValueKind == JsonValueKind.Object && item.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private LlmCatalogResult Failed(string vendor, string reason)
    {
        logger.LogWarning("LlmModelAudit: model list check failed for {Vendor}: {Reason}", vendor, reason);
        return new LlmCatalogResult(LlmCatalogOutcome.Failed, new HashSet<string>());
    }
}
