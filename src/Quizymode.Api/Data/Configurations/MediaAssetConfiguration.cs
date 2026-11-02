using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Data.Configurations;

internal sealed class MediaAssetConfiguration : IEntityTypeConfiguration<MediaAsset>
{
    public void Configure(EntityTypeBuilder<MediaAsset> builder)
    {
        builder.ToTable("MediaAssets", table =>
        {
            table.HasCheckConstraint(
                "CK_MediaAssets_State",
                "\"State\" IN ('Processing', 'Ready', 'Failed')");
            table.HasCheckConstraint(
                "CK_MediaAssets_Ready_Complete",
                "\"State\" <> 'Ready' OR (\"ObjectKey\" IS NOT NULL AND \"Sha256\" <> '' AND \"Width\" > 0 AND \"Height\" > 0 AND \"Bytes\" > 0)");
            table.HasCheckConstraint(
                "CK_MediaAssets_Failed_Code",
                "\"State\" <> 'Failed' OR \"FailureCode\" IS NOT NULL");
            table.HasCheckConstraint(
                "CK_MediaAssets_Bytes_Max",
                "\"Bytes\" <= 102400");
        });

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();
        builder.Property(x => x.OwnerUserId).IsRequired().HasMaxLength(100);
        builder.Property(x => x.State).HasConversion<string>().IsRequired().HasMaxLength(20);
        builder.Property(x => x.ObjectKey).HasMaxLength(200);
        builder.Property(x => x.Sha256).IsRequired().HasMaxLength(64).IsFixedLength();
        builder.Property(x => x.Format).IsRequired().HasMaxLength(10);
        builder.Property(x => x.SourceFormat).IsRequired().HasMaxLength(10);
        builder.Property(x => x.FailureCode).HasMaxLength(50);
        builder.Property(x => x.CreatedAt).IsRequired();
        builder.Property(x => x.UpdatedAt).IsRequired();

        builder.HasIndex(x => x.ObjectKey).IsUnique();
        builder.HasIndex(x => new { x.OwnerUserId, x.CreatedAt });
        builder.HasIndex(x => new { x.State, x.UpdatedAt });
    }
}
