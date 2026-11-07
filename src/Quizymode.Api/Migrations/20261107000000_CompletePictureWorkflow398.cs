using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Quizymode.Api.Migrations
{
    /// <inheritdoc />
    public partial class CompletePictureWorkflow398 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DeleteAttempts",
                table: "MediaAssets",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeleteRetryAt",
                table: "MediaAssets",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PurgedAt",
                table: "MediaAssets",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CreateRequestHash",
                table: "Items",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CreateRequestId",
                table: "Items",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExplanationImageLongDescription",
                table: "Items",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "QuestionImageLongDescription",
                table: "Items",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "MediaAdvisoryJobs",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    ContentHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    OwnerUserId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Provider = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Model = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    PolicyVersion = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    ReservedCostUsd = table.Column<decimal>(type: "numeric(12,6)", precision: 12, scale: 6, nullable: false),
                    EstimatedCostUsd = table.Column<decimal>(type: "numeric(12,6)", precision: 12, scale: 6, nullable: true),
                    InputTokens = table.Column<int>(type: "integer", nullable: true),
                    OutputTokens = table.Column<int>(type: "integer", nullable: true),
                    State = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ResultJson = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MediaAdvisoryJobs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MediaControls",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    ReportSalt = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CleanupCursor = table.Column<string>(type: "character varying(4096)", maxLength: 4096, nullable: true),
                    UploadsEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    DeliveryEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    AdvisoryEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MediaControls", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MediaIngressAttempts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LeaseUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReservedBytes = table.Column<long>(type: "bigint", nullable: false),
                    ReceivedBytes = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MediaIngressAttempts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MediaReports",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    AssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    Slot = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Category = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    AbuseKey = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ResolvedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MediaReports", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MediaUploadAttempts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MediaUploadAttempts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MediaUploadClaims",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    OwnerUserId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SourceSha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    AssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LeaseUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    State = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MediaUploadClaims", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Items_CreatedBy_CreateRequestId",
                table: "Items",
                columns: new[] { "CreatedBy", "CreateRequestId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MediaAdvisoryJobs_CreatedAt",
                table: "MediaAdvisoryJobs",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_MediaAdvisoryJobs_ItemId_Revision",
                table: "MediaAdvisoryJobs",
                columns: new[] { "ItemId", "Revision" });

            migrationBuilder.CreateIndex(
                name: "IX_MediaIngressAttempts_CompletedAt_LeaseUntil",
                table: "MediaIngressAttempts",
                columns: new[] { "CompletedAt", "LeaseUntil" });

            migrationBuilder.CreateIndex(
                name: "IX_MediaIngressAttempts_OwnerUserId_CreatedAt",
                table: "MediaIngressAttempts",
                columns: new[] { "OwnerUserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_MediaReports_AbuseKey_CreatedAt",
                table: "MediaReports",
                columns: new[] { "AbuseKey", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_MediaReports_ResolvedAt_CreatedAt",
                table: "MediaReports",
                columns: new[] { "ResolvedAt", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_MediaUploadAttempts_OwnerUserId_CreatedAt",
                table: "MediaUploadAttempts",
                columns: new[] { "OwnerUserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_MediaUploadClaims_OwnerUserId_CreatedAt",
                table: "MediaUploadClaims",
                columns: new[] { "OwnerUserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_MediaUploadClaims_State_LeaseUntil",
                table: "MediaUploadClaims",
                columns: new[] { "State", "LeaseUntil" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MediaAdvisoryJobs");

            migrationBuilder.DropTable(
                name: "MediaControls");

            migrationBuilder.DropTable(
                name: "MediaIngressAttempts");

            migrationBuilder.DropTable(
                name: "MediaReports");

            migrationBuilder.DropTable(
                name: "MediaUploadAttempts");

            migrationBuilder.DropTable(
                name: "MediaUploadClaims");

            migrationBuilder.DropIndex(
                name: "IX_Items_CreatedBy_CreateRequestId",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "DeleteAttempts",
                table: "MediaAssets");

            migrationBuilder.DropColumn(
                name: "DeleteRetryAt",
                table: "MediaAssets");

            migrationBuilder.DropColumn(
                name: "PurgedAt",
                table: "MediaAssets");

            migrationBuilder.DropColumn(
                name: "CreateRequestHash",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "CreateRequestId",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "ExplanationImageLongDescription",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "QuestionImageLongDescription",
                table: "Items");
        }
    }
}
