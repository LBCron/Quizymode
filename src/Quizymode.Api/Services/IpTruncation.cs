using System.Net;
using System.Net.Sockets;

namespace Quizymode.Api.Services;

/// <summary>
/// Truncates IP addresses for admin display: IPv4 to its /24, IPv6 to its /48. The raw address stays stored
/// on page views; only API responses use the truncated form.
/// </summary>
internal static class IpTruncation
{
    public static string Truncate(string? ipAddress)
    {
        if (string.IsNullOrWhiteSpace(ipAddress) || !IPAddress.TryParse(ipAddress.Trim(), out IPAddress? parsed))
        {
            return "unknown";
        }

        if (parsed.IsIPv4MappedToIPv6)
        {
            parsed = parsed.MapToIPv4();
        }

        byte[] bytes = parsed.GetAddressBytes();

        if (parsed.AddressFamily == AddressFamily.InterNetwork)
        {
            return $"{bytes[0]}.{bytes[1]}.{bytes[2]}.0/24";
        }

        byte[] network = new byte[16];
        Array.Copy(bytes, network, 6);

        return $"{new IPAddress(network)}/48";
    }
}
