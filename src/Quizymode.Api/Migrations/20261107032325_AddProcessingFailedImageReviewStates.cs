using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Quizymode.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddProcessingFailedImageReviewStates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Items_ImageReviewState",
                table: "Items");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Items_ImageReviewState",
                table: "Items",
                sql: "\"ImageReviewState\" IS NULL OR \"ImageReviewState\" IN ('PendingReview', 'Approved', 'Rejected', 'Withdrawn', 'Processing', 'Failed')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Items_ImageReviewState",
                table: "Items");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Items_ImageReviewState",
                table: "Items",
                sql: "\"ImageReviewState\" IS NULL OR \"ImageReviewState\" IN ('PendingReview', 'Approved', 'Rejected', 'Withdrawn')");
        }
    }
}
