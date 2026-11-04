using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Quizymode.Api.Shared.Models;
using System.Text.Json;

namespace Quizymode.Api.Data.Configurations;

internal sealed class ItemConfiguration : IEntityTypeConfiguration<Item>
{
    public void Configure(EntityTypeBuilder<Item> builder)
    {
        builder.ToTable("Items");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Id)
            .HasDefaultValueSql("gen_random_uuid()");

        builder.Property(x => x.IsRepoManaged)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(x => x.IsPrivate)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(x => x.Question)
            .IsRequired()
            .HasMaxLength(1000);

        builder.Property(x => x.QuestionSpeech)
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null!),
                v => JsonSerializer.Deserialize<ItemSpeechSupport>(v, (JsonSerializerOptions?)null!),
                new Microsoft.EntityFrameworkCore.ChangeTracking.ValueComparer<ItemSpeechSupport?>(
                    (left, right) => SpeechSupportEquals(left, right),
                    value => SpeechSupportHash(value),
                    value => CloneSpeechSupport(value)))
            .IsRequired(false);

        builder.Property(x => x.CorrectAnswer)
            .IsRequired()
            .HasMaxLength(500);

        builder.Property(x => x.CorrectAnswerSpeech)
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null!),
                v => JsonSerializer.Deserialize<ItemSpeechSupport>(v, (JsonSerializerOptions?)null!),
                new Microsoft.EntityFrameworkCore.ChangeTracking.ValueComparer<ItemSpeechSupport?>(
                    (left, right) => SpeechSupportEquals(left, right),
                    value => SpeechSupportHash(value),
                    value => CloneSpeechSupport(value)))
            .IsRequired(false);

        // Map List<string> to JSONB column
        // EF Core with Npgsql requires explicit conversion for JSONB
        builder.Property(x => x.IncorrectAnswers)
            .HasColumnType("jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null!),
                v => JsonSerializer.Deserialize<List<string>>(v, (JsonSerializerOptions?)null!) ?? new List<string>(),
                new Microsoft.EntityFrameworkCore.ChangeTracking.ValueComparer<List<string>>(
                    (c1, c2) => c1 != null && c2 != null && c1.SequenceEqual(c2),
                    c => c.Aggregate(0, (a, v) => HashCode.Combine(a, v.GetHashCode())),
                    c => c.ToList()))
            .IsRequired();

        builder.Property(x => x.IncorrectAnswerSpeech)
            .HasColumnType("jsonb")
            .HasDefaultValueSql("'{}'::jsonb")
            .HasConversion(
                v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null!),
                v => JsonSerializer.Deserialize<Dictionary<int, ItemSpeechSupport>>(v, (JsonSerializerOptions?)null!) ?? new Dictionary<int, ItemSpeechSupport>(),
                new Microsoft.EntityFrameworkCore.ChangeTracking.ValueComparer<Dictionary<int, ItemSpeechSupport>>(
                    (left, right) => SpeechSupportDictionaryEquals(left, right),
                    value => SpeechSupportDictionaryHash(value),
                    value => CloneSpeechSupportDictionary(value)))
            .IsRequired();

        builder.Property(x => x.Explanation)
            .HasMaxLength(4000);

        builder.Property(x => x.FuzzySignature)
            .HasMaxLength(64);

        builder.Property(x => x.FuzzyBucket)
            .IsRequired();

        builder.Property(x => x.CreatedBy)
            .IsRequired()
            .HasMaxLength(100);

        builder.Property(x => x.CreatedAt)
            .IsRequired();

        builder.Property(x => x.UpdatedAt)
            .IsRequired(false);

        builder.Property(x => x.ReadyForReview)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(x => x.Source)
            .HasMaxLength(1000);

        builder.Property(x => x.GroupLabel)
            .HasMaxLength(30);

        builder.Property(x => x.QuestionImageKey)
            .HasMaxLength(100);

        builder.Property(x => x.QuestionImageAlt)
            .HasMaxLength(300);

        builder.Property(x => x.StarterWorld)
            .HasMaxLength(24);

        builder.Property(x => x.WowLine)
            .HasMaxLength(140);

        builder.Property(x => x.ExplanationImageKey)
            .HasMaxLength(100);

        builder.Property(x => x.ExplanationImageAlt)
            .HasMaxLength(300);

        // Uploaded pictures and their review state (#400, AC 3.25)
        builder.Property(x => x.QuestionImageAttribution)
            .HasMaxLength(300);

        builder.Property(x => x.ExplanationImageAttribution)
            .HasMaxLength(300);

        builder.Property(x => x.ImageReviewState)
            .HasConversion<string>()
            .HasMaxLength(20);

        builder.Property(x => x.ImageRevision)
            .IsRequired()
            .HasDefaultValue(0);

        builder.HasOne<MediaAsset>()
            .WithMany()
            .HasForeignKey(x => x.QuestionImageAssetId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne<MediaAsset>()
            .WithMany()
            .HasForeignKey(x => x.ExplanationImageAssetId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.QuestionImageAssetId);
        builder.HasIndex(x => x.ExplanationImageAssetId);
        builder.HasIndex(x => x.ImageReviewState);

        builder.Property(x => x.CategoryId)
            .IsRequired(false);

        builder.Property(x => x.UploadId)
            .IsRequired(false);

        builder.Property(x => x.FactualRisk)
            .HasPrecision(5, 4)
            .IsRequired(false);

        builder.Property(x => x.ReviewComments)
            .HasMaxLength(500)
            .IsRequired(false);

        // Foreign key relationship to Category
        builder.Property(x => x.NavigationKeywordId1).IsRequired(false);
        builder.Property(x => x.NavigationKeywordId2).IsRequired(false);

        builder.HasOne(x => x.Category)
            .WithMany(c => c.Items)
            .HasForeignKey(x => x.CategoryId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasOne(x => x.NavigationKeyword1)
            .WithMany()
            .HasForeignKey(x => x.NavigationKeywordId1)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasOne(x => x.NavigationKeyword2)
            .WithMany()
            .HasForeignKey(x => x.NavigationKeywordId2)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(x => x.NavigationKeywordId1);
        builder.HasIndex(x => x.NavigationKeywordId2);

        builder.HasIndex(x => x.UploadId);

        // Add check constraint for incorrect answers array length (0-4 items)
        builder.ToTable(t => t.HasCheckConstraint(
            "CK_Items_IncorrectAnswers_Length",
            "jsonb_array_length(\"IncorrectAnswers\"::jsonb) >= 0 AND jsonb_array_length(\"IncorrectAnswers\"::jsonb) <= 4"));

        // A question picture key and its alt text are stored together or not at all (#407)
        builder.ToTable(t => t.HasCheckConstraint(
            "CK_Items_QuestionImage_Alt",
            "(\"QuestionImageKey\" IS NULL) = (\"QuestionImageAlt\" IS NULL)"));

        // An explanation picture key and its alt text are stored together or not at all (#403)
        builder.ToTable(t => t.HasCheckConstraint(
            "CK_Items_ExplanationImage_Alt",
            "(\"ExplanationImageKey\" IS NULL) = (\"ExplanationImageAlt\" IS NULL)"));

        // An uploaded picture's key is exactly media:{assetId:N}, and a curated/absent key never uses the media: prefix (#400)
        builder.ToTable(t => t.HasCheckConstraint(
            "CK_Items_QuestionImage_Asset",
            "(\"QuestionImageAssetId\" IS NOT NULL AND \"QuestionImageKey\" = 'media:' || replace(\"QuestionImageAssetId\"::text, '-', '')) " +
            "OR (\"QuestionImageAssetId\" IS NULL AND (\"QuestionImageKey\" IS NULL OR \"QuestionImageKey\" NOT LIKE 'media:%'))"));

        builder.ToTable(t => t.HasCheckConstraint(
            "CK_Items_ExplanationImage_Asset",
            "(\"ExplanationImageAssetId\" IS NOT NULL AND \"ExplanationImageKey\" = 'media:' || replace(\"ExplanationImageAssetId\"::text, '-', '')) " +
            "OR (\"ExplanationImageAssetId\" IS NULL AND (\"ExplanationImageKey\" IS NULL OR \"ExplanationImageKey\" NOT LIKE 'media:%'))"));

        builder.ToTable(t => t.HasCheckConstraint(
            "CK_Items_ImageReviewState",
            "\"ImageReviewState\" IS NULL OR \"ImageReviewState\" IN ('PendingReview', 'Approved', 'Rejected', 'Withdrawn')"));

        // A review state exists exactly when at least one picture slot holds an upload (#400)
        builder.ToTable(t => t.HasCheckConstraint(
            "CK_Items_ImageReviewState_Assets",
            "(\"ImageReviewState\" IS NULL) = (\"QuestionImageAssetId\" IS NULL AND \"ExplanationImageAssetId\" IS NULL)"));

        // Indexes for common queries
        builder.HasIndex(x => x.FuzzyBucket);
        builder.HasIndex(x => x.CreatedAt);
        builder.HasIndex(x => x.CategoryId);
        
        // Composite indexes for category queries with visibility filtering
        builder.HasIndex(x => new { x.CategoryId, x.IsPrivate });
        builder.HasIndex(x => new { x.IsPrivate, x.CreatedBy });
        builder.HasIndex(x => x.IsRepoManaged);
    }

    private static bool SpeechSupportEquals(ItemSpeechSupport? left, ItemSpeechSupport? right)
    {
        if (left is null || right is null)
        {
            return left is null && right is null;
        }

        return string.Equals(left.Pronunciation, right.Pronunciation, StringComparison.Ordinal)
            && string.Equals(left.LanguageCode, right.LanguageCode, StringComparison.OrdinalIgnoreCase);
    }

    private static int SpeechSupportHash(ItemSpeechSupport? value)
    {
        if (value is null)
        {
            return 0;
        }

        int pronunciationHash = value.Pronunciation is null
            ? 0
            : value.Pronunciation.GetHashCode(StringComparison.Ordinal);
        int languageHash = value.LanguageCode is null
            ? 0
            : value.LanguageCode.ToUpperInvariant().GetHashCode(StringComparison.Ordinal);

        return HashCode.Combine(pronunciationHash, languageHash);
    }

    private static ItemSpeechSupport? CloneSpeechSupport(ItemSpeechSupport? value)
    {
        if (value is null)
        {
            return null;
        }

        return new ItemSpeechSupport
        {
            Pronunciation = value.Pronunciation,
            LanguageCode = value.LanguageCode
        };
    }

    private static bool SpeechSupportDictionaryEquals(
        Dictionary<int, ItemSpeechSupport>? left,
        Dictionary<int, ItemSpeechSupport>? right)
    {
        if (left is null || right is null)
        {
            return left is null && right is null;
        }

        if (left.Count != right.Count)
        {
            return false;
        }

        foreach ((int key, ItemSpeechSupport value) in left)
        {
            if (!right.TryGetValue(key, out ItemSpeechSupport? rightValue))
            {
                return false;
            }

            if (!SpeechSupportEquals(value, rightValue))
            {
                return false;
            }
        }

        return true;
    }

    private static int SpeechSupportDictionaryHash(Dictionary<int, ItemSpeechSupport>? value)
    {
        if (value is null)
        {
            return 0;
        }

        int hash = 0;
        foreach ((int key, ItemSpeechSupport support) in value.OrderBy(pair => pair.Key))
        {
            hash = HashCode.Combine(hash, key, SpeechSupportHash(support));
        }

        return hash;
    }

    private static Dictionary<int, ItemSpeechSupport> CloneSpeechSupportDictionary(
        Dictionary<int, ItemSpeechSupport> value)
    {
        return value.ToDictionary(
            pair => pair.Key,
            pair => CloneSpeechSupport(pair.Value)!);
    }
}
