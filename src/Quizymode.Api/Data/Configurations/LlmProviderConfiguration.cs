using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Data.Configurations;

internal sealed class LlmProviderSettingsConfiguration : IEntityTypeConfiguration<LlmProviderSettings>
{
    public void Configure(EntityTypeBuilder<LlmProviderSettings> builder)
    {
        builder.ToTable("LlmProviderSettings");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();
        builder.Property(x => x.Models)
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null),
                v => JsonSerializer.Deserialize<Dictionary<string, string>>(v, (JsonSerializerOptions?)null) ?? new Dictionary<string, string>(),
                new ValueComparer<Dictionary<string, string>>(
                    (a, b) => a != null && b != null && a.Count == b.Count && !a.Except(b).Any(),
                    c => c.OrderBy(pair => pair.Key, StringComparer.Ordinal).Aggregate(0, (hash, pair) => HashCode.Combine(hash, pair.Key, pair.Value)),
                    c => new Dictionary<string, string>(c)))
            .IsRequired();
        builder.Property(x => x.RouteFree).IsRequired().HasMaxLength(100);
        builder.Property(x => x.RoutePremium).IsRequired().HasMaxLength(100);
        builder.Property(x => x.UpdatedUtc).IsRequired();
    }
}

internal sealed class LlmAttemptConfiguration : IEntityTypeConfiguration<LlmAttempt>
{
    public void Configure(EntityTypeBuilder<LlmAttempt> builder)
    {
        builder.ToTable("LlmAttempts");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Id).ValueGeneratedNever();
        builder.Property(x => x.Vendor).IsRequired().HasMaxLength(20);
        builder.Property(x => x.Model).IsRequired().HasMaxLength(100);
        builder.Property(x => x.Outcome).IsRequired();
        builder.Property(x => x.CreatedUtc).IsRequired();
        builder.HasIndex(x => x.CreatedUtc);
        builder.HasIndex(x => x.GenerationId);
    }
}
