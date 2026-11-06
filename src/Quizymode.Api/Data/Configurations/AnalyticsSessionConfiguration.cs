using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Data.Configurations;

internal sealed class AnalyticsSessionConfiguration : IEntityTypeConfiguration<AnalyticsSession>
{
    public void Configure(EntityTypeBuilder<AnalyticsSession> builder)
    {
        builder.ToTable("AnalyticsSessions");

        builder.HasKey(analyticsSession => analyticsSession.Id);

        builder.Property(analyticsSession => analyticsSession.Id)
            .HasDefaultValueSql("gen_random_uuid()");

        builder.Property(analyticsSession => analyticsSession.SessionId)
            .IsRequired()
            .HasMaxLength(128);

        builder.Property(analyticsSession => analyticsSession.VisitorId)
            .HasMaxLength(64);

        builder.Property(analyticsSession => analyticsSession.UserId);

        builder.Property(analyticsSession => analyticsSession.FirstSeenUtc)
            .IsRequired();

        builder.Property(analyticsSession => analyticsSession.LandingPath)
            .IsRequired()
            .HasMaxLength(2048);

        builder.Property(analyticsSession => analyticsSession.LandingQuery)
            .IsRequired()
            .HasDefaultValue(string.Empty)
            .HasMaxLength(2048);

        builder.Property(analyticsSession => analyticsSession.ReferrerHost)
            .HasMaxLength(255);

        builder.Property(analyticsSession => analyticsSession.UtmSource)
            .HasMaxLength(100);

        builder.Property(analyticsSession => analyticsSession.UtmMedium)
            .HasMaxLength(100);

        builder.Property(analyticsSession => analyticsSession.UtmCampaign)
            .HasMaxLength(100);

        builder.Property(analyticsSession => analyticsSession.UtmContent)
            .HasMaxLength(100);

        builder.Property(analyticsSession => analyticsSession.UtmTerm)
            .HasMaxLength(100);

        builder.Property(analyticsSession => analyticsSession.ClickIdPlatform)
            .HasMaxLength(32);

        builder.Property(analyticsSession => analyticsSession.Channel)
            .IsRequired()
            .HasMaxLength(16);

        builder.Property(analyticsSession => analyticsSession.DeviceClass)
            .IsRequired()
            .HasMaxLength(16);

        builder.Property(analyticsSession => analyticsSession.Country)
            .HasMaxLength(8);

        builder.Property(analyticsSession => analyticsSession.Region)
            .HasMaxLength(100);

        builder.Property(analyticsSession => analyticsSession.City)
            .HasMaxLength(100);

        builder.Property(analyticsSession => analyticsSession.AppVersion)
            .HasMaxLength(32);

        builder.Property(analyticsSession => analyticsSession.CreatedUtc)
            .IsRequired();

        builder.HasIndex(analyticsSession => analyticsSession.SessionId)
            .IsUnique();

        builder.HasIndex(analyticsSession => analyticsSession.VisitorId);
        builder.HasIndex(analyticsSession => analyticsSession.UserId);
        builder.HasIndex(analyticsSession => analyticsSession.Channel);
        builder.HasIndex(analyticsSession => analyticsSession.FirstSeenUtc);
        builder.HasIndex(analyticsSession => new { analyticsSession.VisitorId, analyticsSession.FirstSeenUtc });
    }
}
