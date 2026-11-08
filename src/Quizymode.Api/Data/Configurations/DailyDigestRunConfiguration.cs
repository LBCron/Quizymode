using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Data.Configurations;

internal sealed class DailyDigestRunConfiguration : IEntityTypeConfiguration<DailyDigestRun>
{
    public void Configure(EntityTypeBuilder<DailyDigestRun> builder)
    {
        builder.ToTable("DailyDigestRuns");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();
        builder.Property(x => x.Kind).IsRequired().HasMaxLength(16).HasDefaultValue(DailyDigestRunKind.Scheduled);
        builder.Property(x => x.ReportDate).IsRequired().HasColumnType("date");
        builder.Property(x => x.TimeZone).IsRequired().HasMaxLength(64);
        builder.Property(x => x.WindowStartUtc).IsRequired();
        builder.Property(x => x.WindowEndUtc).IsRequired();
        builder.Property(x => x.Status).IsRequired().HasMaxLength(16);
        builder.Property(x => x.LastError).HasMaxLength(64);
        builder.Property(x => x.SummaryJson).HasColumnType("jsonb");
        builder.Property(x => x.CreatedUtc).IsRequired();

        // One scheduled digest per local day; ad hoc rows are labelled history and may repeat.
        builder.HasIndex(x => x.ReportDate)
            .IsUnique()
            .HasDatabaseName("IX_DailyDigestRuns_ReportDate_Scheduled")
            .HasFilter("\"Kind\" = 'Scheduled'");
        builder.HasIndex(x => x.CreatedUtc);
    }
}
