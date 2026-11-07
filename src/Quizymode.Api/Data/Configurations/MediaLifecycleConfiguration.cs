using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Quizymode.Api.Shared.Models;
namespace Quizymode.Api.Data.Configurations;
internal sealed class MediaUploadClaimConfiguration : IEntityTypeConfiguration<MediaUploadClaim>
{
    public void Configure(EntityTypeBuilder<MediaUploadClaim> b)
    {
        b.HasKey(x => x.Id); b.Property(x => x.Id).HasMaxLength(64);
        b.Property(x => x.OwnerUserId).HasMaxLength(200); b.Property(x => x.SourceSha256).HasMaxLength(64); b.Property(x => x.State).HasMaxLength(20);
        b.HasIndex(x => new { x.OwnerUserId, x.CreatedAt }); b.HasIndex(x => new { x.State, x.LeaseUntil });
    }
}
internal sealed class MediaReportConfiguration : IEntityTypeConfiguration<MediaReport>
{
    public void Configure(EntityTypeBuilder<MediaReport> b)
    {
        b.HasKey(x => x.Id); b.Property(x => x.AbuseKey).HasMaxLength(64); b.Property(x => x.Category).HasMaxLength(40); b.Property(x => x.Slot).HasMaxLength(20);
        b.HasIndex(x => new { x.AbuseKey, x.CreatedAt }); b.HasIndex(x => new { x.ResolvedAt, x.CreatedAt });
    }
}
internal sealed class MediaControlConfiguration : IEntityTypeConfiguration<MediaControl>
{
    public void Configure(EntityTypeBuilder<MediaControl> b) { b.HasKey(x => x.Id); b.Property(x => x.Id).ValueGeneratedNever(); b.Property(x => x.ReportSalt).HasMaxLength(64); b.Property(x => x.CleanupCursor).HasMaxLength(4096); }
}

internal sealed class MediaAdvisoryJobConfiguration : IEntityTypeConfiguration<MediaAdvisoryJob>
{
    public void Configure(EntityTypeBuilder<MediaAdvisoryJob> b)
    {
        b.HasKey(x => x.Id); b.Property(x => x.Id).HasMaxLength(64);
        b.Property(x => x.ContentHash).HasMaxLength(64); b.Property(x => x.OwnerUserId).HasMaxLength(200);
        b.Property(x => x.Provider).HasMaxLength(40); b.Property(x => x.Model).HasMaxLength(80); b.Property(x => x.PolicyVersion).HasMaxLength(40);
        b.Property(x => x.State).HasMaxLength(20); b.Property(x => x.FailureCode).HasMaxLength(40); b.Property(x => x.ResultJson).HasMaxLength(8000);
        b.Property(x => x.ReservedCostUsd).HasPrecision(12, 6); b.Property(x => x.EstimatedCostUsd).HasPrecision(12, 6);
        b.HasIndex(x => x.CreatedAt); b.HasIndex(x => new { x.ItemId, x.Revision });
    }
}

internal sealed class MediaUploadAttemptConfiguration : IEntityTypeConfiguration<MediaUploadAttempt>
{
    public void Configure(EntityTypeBuilder<MediaUploadAttempt> b) { b.HasKey(x => x.Id); b.Property(x => x.OwnerUserId).HasMaxLength(200); b.HasIndex(x => new { x.OwnerUserId, x.CreatedAt }); }
}

internal sealed class MediaIngressAttemptConfiguration : IEntityTypeConfiguration<MediaIngressAttempt>
{
    public void Configure(EntityTypeBuilder<MediaIngressAttempt> b)
    {
        b.HasKey(x => x.Id); b.Property(x => x.OwnerUserId).HasMaxLength(200);
        b.HasIndex(x => new { x.OwnerUserId, x.CreatedAt });
        b.HasIndex(x => new { x.CompletedAt, x.LeaseUntil });
    }
}
