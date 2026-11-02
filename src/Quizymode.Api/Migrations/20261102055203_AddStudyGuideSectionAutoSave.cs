using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Quizymode.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddStudyGuideSectionAutoSave : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AutoSave",
                table: "StudyGuideSections",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AutoSaveAttempts",
                table: "StudyGuideSections",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AutoSave",
                table: "StudyGuideSections");

            migrationBuilder.DropColumn(
                name: "AutoSaveAttempts",
                table: "StudyGuideSections");
        }
    }
}
