using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Data.Configurations;

internal sealed class StudyGuideDocumentConfiguration : IEntityTypeConfiguration<StudyGuideDocument>
{
    public void Configure(EntityTypeBuilder<StudyGuideDocument> builder)
    {
        builder.ToTable("StudyGuideDocuments");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();
        builder.Property(x => x.UserId).IsRequired().HasMaxLength(100);
        builder.Property(x => x.Title).IsRequired().HasMaxLength(200);
        builder.Property(x => x.FileType).IsRequired().HasMaxLength(10);
        builder.Property(x => x.FileSha256).IsRequired().HasMaxLength(64);
        builder.Property(x => x.TextSha256).IsRequired().HasMaxLength(64);
        builder.Property(x => x.CategoryName).IsRequired().HasMaxLength(200);
        builder.Property(x => x.NavigationKeyword1).IsRequired().HasMaxLength(30);
        builder.Property(x => x.NavigationKeyword2).IsRequired().HasMaxLength(30);
        builder.Property(x => x.KeywordsJson).HasMaxLength(2000);
        builder.Property(x => x.IsPrimarySource).IsRequired().HasDefaultValue(false);
        builder.Property(x => x.CreatedUtc).IsRequired();
        builder.Property(x => x.LastActivityUtc).IsRequired();
        builder.Property(x => x.ExpiresUtc).IsRequired();
        builder.HasIndex(x => new { x.UserId, x.TextSha256 }).IsUnique();
        builder.HasIndex(x => x.ExpiresUtc);
        builder.HasMany(x => x.Sections)
            .WithOne()
            .HasForeignKey(x => x.DocumentId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class StudyGuideSectionConfiguration : IEntityTypeConfiguration<StudyGuideSection>
{
    public void Configure(EntityTypeBuilder<StudyGuideSection> builder)
    {
        builder.ToTable("StudyGuideSections");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();
        builder.Property(x => x.Label).IsRequired().HasMaxLength(200);
        builder.Property(x => x.TextSha256).IsRequired().HasMaxLength(64);
        builder.HasIndex(x => new { x.DocumentId, x.Index }).IsUnique();
        builder.HasIndex(x => x.GenerationId);
    }
}

internal sealed class StudyGuideQuotaChargeConfiguration : IEntityTypeConfiguration<StudyGuideQuotaCharge>
{
    public void Configure(EntityTypeBuilder<StudyGuideQuotaCharge> builder)
    {
        builder.ToTable("StudyGuideQuotaCharges");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();
        builder.Property(x => x.UserId).IsRequired().HasMaxLength(100);
        builder.Property(x => x.ChargedUtc).IsRequired();
        builder.HasIndex(x => new { x.UserId, x.ChargedUtc });
        builder.HasIndex(x => x.GenerationId);
        builder.HasIndex(x => x.SectionId);
    }
}

internal sealed class StudyGuideAcceptedCandidateConfiguration : IEntityTypeConfiguration<StudyGuideAcceptedCandidate>
{
    public void Configure(EntityTypeBuilder<StudyGuideAcceptedCandidate> builder)
    {
        builder.ToTable("StudyGuideAcceptedCandidates");
        builder.HasKey(x => new { x.DocumentId, x.CandidateId });
        builder.Property(x => x.AcceptedUtc).IsRequired();
        builder.HasOne<StudyGuideDocument>()
            .WithMany()
            .HasForeignKey(x => x.DocumentId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
