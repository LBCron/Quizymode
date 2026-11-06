using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Data.Configurations;

internal sealed class SectionGenerationConfiguration : IEntityTypeConfiguration<SectionGeneration>
{
    public void Configure(EntityTypeBuilder<SectionGeneration> builder)
    {
        builder.ToTable("SectionGenerations");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();
        builder.Property(x => x.TextSha256).IsRequired().HasMaxLength(64);
        builder.Property(x => x.Mode).IsRequired().HasMaxLength(30);
        builder.Property(x => x.Status).IsRequired();
        builder.Property(x => x.Tier).IsRequired();
        builder.Property(x => x.NotBeforeUtc).IsRequired();
        builder.Property(x => x.Vendor).HasMaxLength(20);
        builder.Property(x => x.Model).HasMaxLength(100);
        builder.Property(x => x.Error).HasMaxLength(500);
        builder.Property(x => x.CreatedUtc).IsRequired();
        builder.Property(x => x.QueuedUtc).IsRequired();
        builder.HasIndex(x => new { x.TextSha256, x.Mode, x.PromptVersion }).IsUnique();
        builder.HasIndex(x => new { x.Status, x.NotBeforeUtc });
        builder.HasIndex(x => x.QueuedUtc);
        builder.HasMany(x => x.Candidates)
            .WithOne()
            .HasForeignKey(x => x.GenerationId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class GenerationCandidateConfiguration : IEntityTypeConfiguration<GenerationCandidate>
{
    public void Configure(EntityTypeBuilder<GenerationCandidate> builder)
    {
        builder.ToTable("GenerationCandidates");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();
        builder.Property(x => x.Question).IsRequired().HasMaxLength(1000);
        builder.Property(x => x.CorrectAnswer).IsRequired().HasMaxLength(500);
        builder.Property(x => x.IncorrectAnswersJson).IsRequired().HasMaxLength(4000);
        builder.Property(x => x.IncorrectAnswerRationaleJson).IsRequired().HasMaxLength(2000);
        builder.Property(x => x.Explanation).IsRequired().HasMaxLength(4000);
        builder.Property(x => x.SourceQuote).IsRequired().HasMaxLength(1000);
        builder.HasIndex(x => new { x.GenerationId, x.Index }).IsUnique();
    }
}
