using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Quizymode.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddItemImageReview : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ExplanationImageAssetId",
                table: "Items",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExplanationImageAttribution",
                table: "Items",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ImageReviewState",
                table: "Items",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ImageRevision",
                table: "Items",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid>(
                name: "QuestionImageAssetId",
                table: "Items",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "QuestionImageAttribution",
                table: "Items",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ItemImageReviews",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    ContentHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    QuestionAssetId = table.Column<Guid>(type: "uuid", nullable: true),
                    QuestionSha256 = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    ExplanationAssetId = table.Column<Guid>(type: "uuid", nullable: true),
                    ExplanationSha256 = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    SubmittedBy = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SubmittedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Decision = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    DecidedBy = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    DecidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    PolicyVersion = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ItemImageReviews", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Items_ExplanationImageAssetId",
                table: "Items",
                column: "ExplanationImageAssetId");

            migrationBuilder.CreateIndex(
                name: "IX_Items_ImageReviewState",
                table: "Items",
                column: "ImageReviewState");

            migrationBuilder.CreateIndex(
                name: "IX_Items_QuestionImageAssetId",
                table: "Items",
                column: "QuestionImageAssetId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Items_ExplanationImage_Asset",
                table: "Items",
                sql: "(\"ExplanationImageAssetId\" IS NOT NULL AND \"ExplanationImageKey\" = 'media:' || replace(\"ExplanationImageAssetId\"::text, '-', '')) OR (\"ExplanationImageAssetId\" IS NULL AND (\"ExplanationImageKey\" IS NULL OR \"ExplanationImageKey\" NOT LIKE 'media:%'))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Items_ImageReviewState",
                table: "Items",
                sql: "\"ImageReviewState\" IS NULL OR \"ImageReviewState\" IN ('PendingReview', 'Approved', 'Rejected', 'Withdrawn')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Items_ImageReviewState_Assets",
                table: "Items",
                sql: "(\"ImageReviewState\" IS NULL) = (\"QuestionImageAssetId\" IS NULL AND \"ExplanationImageAssetId\" IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Items_QuestionImage_Asset",
                table: "Items",
                sql: "(\"QuestionImageAssetId\" IS NOT NULL AND \"QuestionImageKey\" = 'media:' || replace(\"QuestionImageAssetId\"::text, '-', '')) OR (\"QuestionImageAssetId\" IS NULL AND (\"QuestionImageKey\" IS NULL OR \"QuestionImageKey\" NOT LIKE 'media:%'))");

            migrationBuilder.CreateIndex(
                name: "IX_ItemImageReviews_ItemId_Revision",
                table: "ItemImageReviews",
                columns: new[] { "ItemId", "Revision" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Items_MediaAssets_ExplanationImageAssetId",
                table: "Items",
                column: "ExplanationImageAssetId",
                principalTable: "MediaAssets",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Items_MediaAssets_QuestionImageAssetId",
                table: "Items",
                column: "QuestionImageAssetId",
                principalTable: "MediaAssets",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Items_MediaAssets_ExplanationImageAssetId",
                table: "Items");

            migrationBuilder.DropForeignKey(
                name: "FK_Items_MediaAssets_QuestionImageAssetId",
                table: "Items");

            migrationBuilder.DropTable(
                name: "ItemImageReviews");

            migrationBuilder.DropIndex(
                name: "IX_Items_ExplanationImageAssetId",
                table: "Items");

            migrationBuilder.DropIndex(
                name: "IX_Items_ImageReviewState",
                table: "Items");

            migrationBuilder.DropIndex(
                name: "IX_Items_QuestionImageAssetId",
                table: "Items");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Items_ExplanationImage_Asset",
                table: "Items");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Items_ImageReviewState",
                table: "Items");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Items_ImageReviewState_Assets",
                table: "Items");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Items_QuestionImage_Asset",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "ExplanationImageAssetId",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "ExplanationImageAttribution",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "ImageReviewState",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "ImageRevision",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "QuestionImageAssetId",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "QuestionImageAttribution",
                table: "Items");
        }
    }
}
