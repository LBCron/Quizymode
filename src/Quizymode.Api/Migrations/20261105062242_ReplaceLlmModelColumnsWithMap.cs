using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Quizymode.Api.Migrations
{
    /// <summary>
    /// #464: replaces the per-vendor model columns with a vendor→model JSON map and retires DeepSeek. The OpenAI model is
    /// carried over; the Gemini model is carried over unless it is a retired 2.x model, which becomes gemini-3.5-flash-lite;
    /// Groq, Cerebras and OpenRouter get their defaults. A route still equal to the old default becomes the new default;
    /// a customized route only loses DeepSeek (or falls back to the new default if nothing is left).
    /// </summary>
    public partial class ReplaceLlmModelColumnsWithMap : Migration
    {
        internal const string OldRouteFree = "Gemini,OpenAI,DeepSeek";
        internal const string OldRoutePremium = "DeepSeek,OpenAI,Gemini";
        internal const string NewRouteFree = "Gemini,Groq,Cerebras,OpenRouter,OpenAI";
        internal const string NewRoutePremium = "OpenAI,Gemini,Cerebras,Groq,OpenRouter";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Models",
                table: "LlmProviderSettings",
                type: "jsonb",
                nullable: false,
                defaultValue: "{}");

            migrationBuilder.Sql("""
                UPDATE "LlmProviderSettings"
                SET "Models" = jsonb_build_object(
                    'Gemini', CASE WHEN "GeminiModel" = '' OR "GeminiModel" LIKE 'gemini-2.%' THEN 'gemini-3.5-flash-lite' ELSE "GeminiModel" END,
                    'Groq', 'openai/gpt-oss-120b',
                    'Cerebras', 'gpt-oss-120b',
                    'OpenRouter', 'google/gemma-4-31b-it:free',
                    'OpenAI', CASE WHEN "OpenAiModel" = '' THEN 'gpt-5-nano' ELSE "OpenAiModel" END);
                """);

            migrationBuilder.Sql($"""
                UPDATE "LlmProviderSettings"
                SET "RouteFree" = CASE
                        WHEN "RouteFree" = '{OldRouteFree}' THEN '{NewRouteFree}'
                        ELSE COALESCE(NULLIF(array_to_string(array_remove(string_to_array("RouteFree", ','), 'DeepSeek'), ','), ''), '{NewRouteFree}')
                    END,
                    "RoutePremium" = CASE
                        WHEN "RoutePremium" = '{OldRoutePremium}' THEN '{NewRoutePremium}'
                        ELSE COALESCE(NULLIF(array_to_string(array_remove(string_to_array("RoutePremium", ','), 'DeepSeek'), ','), ''), '{NewRoutePremium}')
                    END;
                """);

            migrationBuilder.DropColumn(name: "DeepSeekModel", table: "LlmProviderSettings");
            migrationBuilder.DropColumn(name: "GeminiModel", table: "LlmProviderSettings");
            migrationBuilder.DropColumn(name: "OpenAiModel", table: "LlmProviderSettings");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DeepSeekModel",
                table: "LlmProviderSettings",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "deepseek-flash");

            migrationBuilder.AddColumn<string>(
                name: "GeminiModel",
                table: "LlmProviderSettings",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "OpenAiModel",
                table: "LlmProviderSettings",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.Sql("""
                UPDATE "LlmProviderSettings"
                SET "GeminiModel" = COALESCE("Models" ->> 'Gemini', 'gemini-3.5-flash-lite'),
                    "OpenAiModel" = COALESCE("Models" ->> 'OpenAI', 'gpt-5-nano');
                """);

            migrationBuilder.DropColumn(name: "Models", table: "LlmProviderSettings");
        }
    }
}
