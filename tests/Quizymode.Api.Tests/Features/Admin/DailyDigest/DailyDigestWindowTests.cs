using FluentAssertions;
using Quizymode.Api.Features.Admin.DailyDigest;
using Xunit;

namespace Quizymode.Api.Tests.Features.Admin.DailyDigest;

/// <summary>#509 AC 1-3: Chicago-day windows, DST days, and due times. Pure time arithmetic, no database.</summary>
public sealed class DailyDigestWindowTests
{
    private static readonly TimeZoneInfo Chicago = DailyDigestWindow.TryFindZone("America/Chicago")!;
    private static readonly TimeOnly EightAm = new(8, 0);

    private static DateTime Utc(int year, int month, int day, int hour = 0, int minute = 0) =>
        new(year, month, day, hour, minute, 0, DateTimeKind.Utc);

    [Fact]
    public void ForDate_Cst_StartsAt0600Utc()
    {
        (DateTime start, DateTime end) = DailyDigestWindow.ForDate(new DateOnly(2026, 11, 6), Chicago);

        start.Should().Be(Utc(2026, 11, 6, 6));
        end.Should().Be(Utc(2026, 11, 7, 6));
    }

    [Fact]
    public void ForDate_Cdt_StartsAt0500Utc()
    {
        (DateTime start, DateTime end) = DailyDigestWindow.ForDate(new DateOnly(2026, 7, 15), Chicago);

        start.Should().Be(Utc(2026, 7, 15, 5));
        end.Should().Be(Utc(2026, 7, 16, 5));
    }

    [Fact]
    public void ForDate_FallBack_Is25Hours()
    {
        (DateTime start, DateTime end) = DailyDigestWindow.ForDate(new DateOnly(2026, 11, 1), Chicago);

        start.Should().Be(Utc(2026, 11, 1, 5));
        end.Should().Be(Utc(2026, 11, 2, 6));
        (end - start).Should().Be(TimeSpan.FromHours(25));
    }

    [Fact]
    public void ForDate_SpringForward_Is23Hours()
    {
        (DateTime start, DateTime end) = DailyDigestWindow.ForDate(new DateOnly(2027, 3, 14), Chicago);

        start.Should().Be(Utc(2027, 3, 14, 6));
        end.Should().Be(Utc(2027, 3, 15, 5));
        (end - start).Should().Be(TimeSpan.FromHours(23));
    }

    [Fact]
    public void DueUtc_Is0800LocalOnTheNextDay()
    {
        DailyDigestWindow.DueUtc(new DateOnly(2026, 11, 6), Chicago, EightAm).Should().Be(Utc(2026, 11, 7, 14));
        DailyDigestWindow.DueUtc(new DateOnly(2026, 7, 15), Chicago, EightAm).Should().Be(Utc(2026, 7, 16, 13));
    }

    [Fact]
    public void StaleUtc_IsTheFollowingDaysDueTime()
    {
        DailyDigestWindow.StaleUtc(new DateOnly(2026, 11, 6), Chicago, EightAm).Should().Be(Utc(2026, 11, 8, 14));
    }

    [Fact]
    public void DueReportDate_At0759Local_IsTheDayBeforeYesterday_AndAt0800Local_IsYesterday()
    {
        DailyDigestWindow.DueReportDate(Utc(2026, 11, 7, 13, 59), Chicago, EightAm).Should().Be(new DateOnly(2026, 11, 5));
        DailyDigestWindow.DueReportDate(Utc(2026, 11, 7, 14, 0), Chicago, EightAm).Should().Be(new DateOnly(2026, 11, 6));
        DailyDigestWindow.DueReportDate(Utc(2026, 11, 7, 20, 0), Chicago, EightAm).Should().Be(new DateOnly(2026, 11, 6));
    }

    [Fact]
    public void DueReportDate_AfterLocalMidnightBeforeSendTime_StillCoversTheUndeliveredDay()
    {
        // D = Nov 6. D+2 00:30 CST is Nov 8 06:30 UTC: D is still due. D+2 08:00 CST is Nov 8 14:00 UTC: D is stale, D+1 is due.
        DailyDigestWindow.DueReportDate(Utc(2026, 11, 8, 6, 30), Chicago, EightAm).Should().Be(new DateOnly(2026, 11, 6));
        DailyDigestWindow.DueReportDate(Utc(2026, 11, 8, 13, 59), Chicago, EightAm).Should().Be(new DateOnly(2026, 11, 6));
        DailyDigestWindow.DueReportDate(Utc(2026, 11, 8, 14, 0), Chicago, EightAm).Should().Be(new DateOnly(2026, 11, 7));
    }

    [Fact]
    public void LocalDate_UsesTheZone_NotUtc()
    {
        // 05:30 UTC on Nov 8 is 23:30 CST on Nov 7.
        DailyDigestWindow.LocalDate(Utc(2026, 11, 8, 5, 30), Chicago).Should().Be(new DateOnly(2026, 11, 7));
    }

    [Fact]
    public void NextDueUtc_IsTheNextEightAmAfterNow()
    {
        DailyDigestWindow.NextDueUtc(Utc(2026, 11, 7, 14, 0), Chicago, EightAm).Should().Be(Utc(2026, 11, 8, 14));
        DailyDigestWindow.NextDueUtc(Utc(2026, 11, 7, 13, 0), Chicago, EightAm).Should().Be(Utc(2026, 11, 7, 14));
    }

    [Fact]
    public void TryFindZone_UnknownId_ReturnsNull()
    {
        DailyDigestWindow.TryFindZone("Mars/Olympus").Should().BeNull();
        DailyDigestWindow.TryFindZone("").Should().BeNull();
    }

    [Theory]
    [InlineData("08:00", true)]
    [InlineData("8:00", false)]
    [InlineData("25:00", false)]
    [InlineData("", false)]
    public void TryParseSendAt_AcceptsOnlyHHmm(string text, bool valid)
    {
        DailyDigestWindow.TryParseSendAt(text, out _).Should().Be(valid);
    }
}
