namespace Quizymode.Api.Services;

public interface IIpGeolocationService
{
    /// <summary>
    /// Returns a country code (e.g. "US", "PL") for the given IP address,
    /// "Local" for loopback/private addresses, or null when unknown.
    /// Results are cached in-process for the application lifetime.
    /// </summary>
    Task<string?> GetCountryAsync(string ipAddress, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns country, region and city for the IP address (approximate; the client-sent address can be spoofed),
    /// or null when unknown. Region and city are null for loopback/private addresses.
    /// </summary>
    Task<IpLocation?> GetLocationAsync(string ipAddress, CancellationToken cancellationToken = default);
}

/// <summary>Approximate location resolved from an IP address.</summary>
public sealed record IpLocation(string? Country, string? Region, string? City);
