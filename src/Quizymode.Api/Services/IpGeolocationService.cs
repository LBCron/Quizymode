using System.Collections.Concurrent;
using System.Net;
using System.Text.Json;

namespace Quizymode.Api.Services;

internal sealed class IpGeolocationService : IIpGeolocationService
{
    private static readonly HashSet<string> LoopbackAddresses = new(StringComparer.OrdinalIgnoreCase)
    {
        "::1", "127.0.0.1", "0:0:0:0:0:0:0:1", "localhost"
    };

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<IpGeolocationService> _logger;
    private readonly ConcurrentDictionary<string, IpLocation?> _cache = new(StringComparer.OrdinalIgnoreCase);

    public IpGeolocationService(IHttpClientFactory httpClientFactory, ILogger<IpGeolocationService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public async Task<string?> GetCountryAsync(string ipAddress, CancellationToken cancellationToken = default)
    {
        IpLocation? location = await GetLocationAsync(ipAddress, cancellationToken);
        return location?.Country;
    }

    public async Task<IpLocation?> GetLocationAsync(string ipAddress, CancellationToken cancellationToken = default)
    {
        IpLocation local = new("Local", null, null);

        if (string.IsNullOrWhiteSpace(ipAddress) || ipAddress == "unknown")
            return null;

        if (LoopbackAddresses.Contains(ipAddress))
            return local;

        // Private/link-local ranges → Local
        if (IPAddress.TryParse(ipAddress, out IPAddress? parsed) && IsPrivate(parsed))
            return local;

        if (_cache.TryGetValue(ipAddress, out IpLocation? cached))
            return cached;

        try
        {
            HttpClient client = _httpClientFactory.CreateClient("ipgeolocation");
            HttpResponseMessage response = await client.GetAsync(
                $"https://ipinfo.io/{Uri.EscapeDataString(ipAddress)}/json",
                cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _cache[ipAddress] = null;
                return null;
            }

            string json = await response.Content.ReadAsStringAsync(cancellationToken);
            using JsonDocument doc = JsonDocument.Parse(json);
            JsonElement root = doc.RootElement;

            // ipinfo returns { "bogon": true } for private/reserved ranges
            if (root.TryGetProperty("bogon", out JsonElement bogon) && bogon.GetBoolean())
            {
                _cache[ipAddress] = local;
                return local;
            }

            IpLocation location = ParseLocation(root);
            _cache[ipAddress] = location;
            return location;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "IP geolocation lookup failed for {IpAddress}", ipAddress);
            _cache[ipAddress] = null;
            return null;
        }
    }

    /// <summary>Reads country, region and city from an ipinfo response; blank values become null and are length-capped.</summary>
    internal static IpLocation ParseLocation(JsonElement root)
    {
        return new IpLocation(
            ReadString(root, "country", 8),
            ReadString(root, "region", 100),
            ReadString(root, "city", 100));
    }

    private static string? ReadString(JsonElement root, string name, int maxLength)
    {
        if (!root.TryGetProperty(name, out JsonElement element) || element.ValueKind != JsonValueKind.String)
            return null;

        string? value = element.GetString()?.Trim();
        if (string.IsNullOrEmpty(value))
            return null;

        return value.Length > maxLength ? value[..maxLength] : value;
    }

    private static bool IsPrivate(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6)
            ip = ip.MapToIPv4();

        byte[] bytes = ip.GetAddressBytes();

        if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        {
            // 10.x.x.x
            if (bytes[0] == 10) return true;
            // 172.16.x.x – 172.31.x.x
            if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) return true;
            // 192.168.x.x
            if (bytes[0] == 192 && bytes[1] == 168) return true;
            // 169.254.x.x (link-local)
            if (bytes[0] == 169 && bytes[1] == 254) return true;
        }

        if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
        {
            // fc00::/7 (unique local)
            if ((bytes[0] & 0xFE) == 0xFC) return true;
            // fe80::/10 (link-local)
            if (bytes[0] == 0xFE && (bytes[1] & 0xC0) == 0x80) return true;
        }

        return false;
    }
}
