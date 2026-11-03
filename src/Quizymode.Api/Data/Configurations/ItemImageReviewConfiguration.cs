using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Data.Configurations;

internal sealed class ItemImageReviewConfiguration : IEntityTypeConfiguration<ItemImageReview>
{
    public void Configure(EntityTypeBuilder<ItemImageReview> builder)
    {
        builder.ToTable("ItemImageReviews");

        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();

        builder.Property(x => x.ContentHash).IsRequired().HasMaxLength(64).IsFixedLength();
        builder.Property(x => x.QuestionSha256).HasMaxLength(64).IsFixedLength();
        builder.Property(x => x.ExplanationSha256).HasMaxLength(64).IsFixedLength();
        builder.Property(x => x.SubmittedBy).IsRequired().HasMaxLength(100);
        builder.Property(x => x.SubmittedAt).IsRequired();
        builder.Property(x => x.Decision).HasMaxLength(20);
        builder.Property(x => x.DecidedBy).HasMaxLength(100);
        builder.Property(x => x.Reason).HasMaxLength(500);
        builder.Property(x => x.PolicyVersion).HasMaxLength(20);

        builder.HasIndex(x => new { x.ItemId, x.Revision }).IsUnique();
    }
}
