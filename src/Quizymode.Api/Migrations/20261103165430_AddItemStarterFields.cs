using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Quizymode.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddItemStarterFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "StarterWorld",
                table: "Items",
                type: "character varying(24)",
                maxLength: 24,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WowLine",
                table: "Items",
                type: "character varying(140)",
                maxLength: 140,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "StarterWorld",
                table: "Items");

            migrationBuilder.DropColumn(
                name: "WowLine",
                table: "Items");
        }
    }
}
