using System.Globalization;

namespace Quizymode.Api.Features.Admin.DailyDigest;

/// <summary>Local-calendar-day arithmetic for the digest (#509): half-open UTC windows, due and stale times.</summary>
internal static class DailyDigestWindow
{
    /// <summary>Resolves an IANA (or Windows) zone id; null when unknown. No fixed-offset fallback on purpose.</summary>
    internal static TimeZoneInfo? TryFindZone(string? id)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(id.Trim());
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return null;
        }
    }

    internal static bool TryParseSendAt(string? text, out TimeOnly sendAt) =>
        TimeOnly.TryParseExact(text?.Trim(), "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out sendAt);

    /// <summary>The half-open UTC window <c>[start, end)</c> of one local calendar day.</summary>
    internal static (DateTime StartUtc, DateTime EndUtc) ForDate(DateOnly date, TimeZoneInfo zone) =>
        (LocalToUtc(date, TimeOnly.MinValue, zone), LocalToUtc(date.AddDays(1), TimeOnly.MinValue, zone));

    /// <summary>When the digest for <paramref name="reportDate"/> becomes due: the next local day at <paramref name="sendAt"/>.</summary>
    internal static DateTime DueUtc(DateOnly reportDate, TimeZoneInfo zone, TimeOnly sendAt) =>
        LocalToUtc(reportDate.AddDays(1), sendAt, zone);

    /// <summary>When the digest for <paramref name="reportDate"/> goes stale: the next day's due time.</summary>
    internal static DateTime StaleUtc(DateOnly reportDate, TimeZoneInfo zone, TimeOnly sendAt) =>
        DueUtc(reportDate.AddDays(1), zone, sendAt);

    internal static DateOnly LocalDate(DateTime utc, TimeZoneInfo zone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone));

    /// <summary>
    /// The report date that is due now: the most recent local day whose due time has passed and whose stale time has not.
    /// Between local midnight and the send time that is the day before yesterday, so no gap exists; null when none.
    /// </summary>
    internal static DateOnly? DueReportDate(DateTime nowUtc, TimeZoneInfo zone, TimeOnly sendAt)
    {
        DateOnly yesterday = LocalDate(nowUtc, zone).AddDays(-1);
        for (int back = 0; back < 2; back++)
        {
            DateOnly candidate = yesterday.AddDays(-back);
            if (nowUtc >= DueUtc(candidate, zone, sendAt) && nowUtc < StaleUtc(candidate, zone, sendAt))
            {
                return candidate;
            }
        }

        return null;
    }

    /// <summary>The next moment a digest becomes due, strictly after <paramref name="nowUtc"/>.</summary>
    internal static DateTime NextDueUtc(DateTime nowUtc, TimeZoneInfo zone, TimeOnly sendAt)
    {
        DateOnly candidate = LocalDate(nowUtc, zone).AddDays(-1);
        for (int i = 0; i < 4; i++)
        {
            DateTime due = DueUtc(candidate, zone, sendAt);
            if (due > nowUtc)
            {
                return due;
            }

            candidate = candidate.AddDays(1);
        }

        return DueUtc(candidate, zone, sendAt);
    }

    private static DateTime LocalToUtc(DateOnly date, TimeOnly time, TimeZoneInfo zone)
    {
        DateTime local = DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(local))
        {
            local = local.AddHours(1);
        }

        return TimeZoneInfo.ConvertTimeToUtc(local, zone);
    }
}
