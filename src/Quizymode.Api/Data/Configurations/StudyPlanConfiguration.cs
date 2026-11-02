using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Data.Configurations;

internal sealed class StudyPlanConfiguration : IEntityTypeConfiguration<StudyPlan>
{
    public void Configure(EntityTypeBuilder<StudyPlan> builder)
    {
        builder.ToTable("StudyPlans");
        builder.HasKey(x => new { x.UserId, x.CollectionId });
        builder.Property(x => x.UserId).IsRequired().HasMaxLength(100);
        builder.HasIndex(x => x.CollectionId);
    }
}
