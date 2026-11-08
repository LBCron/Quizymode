using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Quizymode.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDailyDigestRuns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DailyDigestRuns",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false, defaultValue: "Scheduled"),
                    ReportDate = table.Column<DateOnly>(type: "date", nullable: false),
                    TimeZone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    WindowStartUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    WindowEndUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    InterruptedResendUsed = table.Column<bool>(type: "boolean", nullable: false),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: false),
                    LeaseUntilUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    NextAttemptUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ComputedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SentUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SummaryJson = table.Column<string>(type: "jsonb", nullable: true),
                    RequestedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyDigestRuns", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DailyDigestRuns_CreatedUtc",
                table: "DailyDigestRuns",
                column: "CreatedUtc");

            migrationBuilder.CreateIndex(
                name: "IX_DailyDigestRuns_ReportDate_Scheduled",
                table: "DailyDigestRuns",
                column: "ReportDate",
                unique: true,
                filter: "\"Kind\" = 'Scheduled'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DailyDigestRuns");
        }
    }
}
