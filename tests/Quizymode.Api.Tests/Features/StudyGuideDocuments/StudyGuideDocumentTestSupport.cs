using System.Net;
using System.Text;
using System.Text.Json;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Quizymode.Api.Data;
using Quizymode.Api.Features.StudyGuideDocuments;
using Quizymode.Api.Features.StudyGuideDocuments.Extraction;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Options;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;
using Drawing = DocumentFormat.OpenXml.Drawing;
using MsOptions = Microsoft.Extensions.Options.Options;
using Presentation = DocumentFormat.OpenXml.Presentation;
using Wordprocessing = DocumentFormat.OpenXml.Wordprocessing;

namespace Quizymode.Api.Tests.Features.StudyGuideDocuments;

/// <summary>Builds tiny PDF/DOCX/PPTX fixtures in code (no binary files in the repo).</summary>
internal static class StudyGuideFixtures
{
    public static byte[] Pdf(params string[][] pages)
    {
        using PdfDocumentBuilder builder = new();
        PdfDocumentBuilder.AddedFont font = builder.AddStandard14Font(Standard14Font.Helvetica);
        foreach (string[] lines in pages)
        {
            PdfPageBuilder page = builder.AddPage(PageSize.A4);
            double y = 800;
            foreach (string line in lines)
            {
                page.AddText(line, 10, new PdfPoint(40, y), font);
                y -= 16;
            }
        }

        return builder.Build();
    }

    /// <summary>Paragraphs prefixed with "# " become Heading1 paragraphs.</summary>
    public static byte[] Docx(params string[] paragraphs)
    {
        using MemoryStream stream = new();
        using (WordprocessingDocument document = WordprocessingDocument.Create(stream, WordprocessingDocumentType.Document))
        {
            MainDocumentPart main = document.AddMainDocumentPart();
            Wordprocessing.Body body = new();
            foreach (string paragraph in paragraphs)
            {
                bool heading = paragraph.StartsWith("# ", StringComparison.Ordinal);
                Wordprocessing.Paragraph element = new();
                if (heading)
                {
                    element.Append(new Wordprocessing.ParagraphProperties(new Wordprocessing.ParagraphStyleId { Val = "Heading1" }));
                }

                element.Append(new Wordprocessing.Run(new Wordprocessing.Text(heading ? paragraph[2..] : paragraph)));
                body.Append(element);
            }

            main.Document = new Wordprocessing.Document(body);
        }

        return stream.ToArray();
    }

    public static byte[] Pptx(params string[][] slides)
    {
        using MemoryStream stream = new();
        using (PresentationDocument document = PresentationDocument.Create(stream, PresentationDocumentType.Presentation))
        {
            PresentationPart presentationPart = document.AddPresentationPart();
            presentationPart.Presentation = new Presentation.Presentation();
            Presentation.SlideIdList slideIds = new();
            uint id = 256;
            foreach (string[] lines in slides)
            {
                SlidePart slidePart = presentationPart.AddNewPart<SlidePart>();
                Presentation.TextBody textBody = new(new Drawing.BodyProperties(), new Drawing.ListStyle());
                foreach (string line in lines)
                {
                    textBody.Append(new Drawing.Paragraph(new Drawing.Run(new Drawing.Text(line))));
                }

                slidePart.Slide = new Presentation.Slide(
                    new Presentation.CommonSlideData(new Presentation.ShapeTree(new Presentation.Shape(textBody))));
                slideIds.Append(new Presentation.SlideId { Id = id++, RelationshipId = presentationPart.GetIdOfPart(slidePart) });
            }

            presentationPart.Presentation.Append(slideIds);
        }

        return stream.ToArray();
    }

    /// <summary>A zip that is neither a Word nor a PowerPoint package.</summary>
    public static byte[] PlainZip()
    {
        using MemoryStream stream = new();
        using (System.IO.Compression.ZipArchive archive = new(stream, System.IO.Compression.ZipArchiveMode.Create, leaveOpen: true))
        {
            using StreamWriter writer = new(archive.CreateEntry("notes.txt").Open());
            writer.Write("hello");
        }

        return stream.ToArray();
    }
}

/// <summary>A controllable clock.</summary>
internal sealed class TestClock(DateTime utcNow) : TimeProvider
{
    public DateTime UtcNow { get; set; } = utcNow;

    public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(UtcNow, DateTimeKind.Utc));
}

/// <summary>Fake OpenAI-compatible vendors keyed by host; never touches the network.</summary>
internal sealed class FakeVendorHandler(Func<string, string, HttpResponseMessage> respond) : HttpMessageHandler
{
    public List<(string Vendor, HttpRequestMessage Request, string Body)> Requests { get; } = [];

    public IEnumerable<string> Vendors => Requests.Select(request => request.Vendor);

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        string body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
        string vendor = request.RequestUri!.Host switch
        {
            "api.deepseek.com" => LlmVendors.DeepSeek,
            "api.openai.com" => LlmVendors.OpenAI,
            "generativelanguage.googleapis.com" => LlmVendors.Gemini,
            _ => "unknown"
        };
        Requests.Add((vendor, request, body));
        return respond(vendor, body);
    }

    public static HttpResponseMessage Completion(string content, string finishReason = "stop") =>
        FakeDeepSeekHandler.Json(HttpStatusCode.OK, JsonSerializer.Serialize(new
        {
            id = "chatcmpl-test",
            choices = new object[] { new { index = 0, message = new { role = "assistant", content }, finish_reason = finishReason } },
            usage = new { prompt_tokens = 1200, completion_tokens = 800 }
        }));

    public static HttpResponseMessage Json(HttpStatusCode statusCode, string body) =>
        FakeDeepSeekHandler.Json(statusCode, body);

    public static HttpResponseMessage Status(HttpStatusCode statusCode) =>
        FakeDeepSeekHandler.Json(statusCode, "{\"error\":{\"message\":\"boom\",\"type\":\"api_error\"}}");
}

internal static class StudyGuideTestData
{
    public const string SectionText =
        "Paris is the capital and most populous city of France.\n\n" +
        "Berlin is the capital of Germany and its largest city by population.\n\n" +
        "Madrid is the capital of Spain and sits near the geographic center of the country.\n\n" +
        "Rome is the capital of Italy and was the center of the Roman Empire.";

    public static readonly (string Question, string Answer, string Quote)[] Facts =
    [
        ("What is the capital of France?", "Paris", "Paris is the capital and most populous city of France"),
        ("What is the capital of Germany?", "Berlin", "Berlin is the capital of Germany and its largest city"),
        ("What is the capital of Spain?", "Madrid", "Madrid is the capital of Spain and sits near the geographic center"),
        ("What is the capital of Italy?", "Rome", "Rome is the capital of Italy and was the center of the Roman Empire")
    ];

    /// <summary>Questions quoting the section verbatim, plus <paramref name="unsupported"/> questions with invented quotes.</summary>
    public static string QuestionsJson(int supported = 4, int unsupported = 0, int? page = null) =>
        JsonSerializer.Serialize(new
        {
            questions = Facts.Take(supported)
                .Select(fact => (object)new
                {
                    question = fact.Question,
                    correctAnswer = fact.Answer,
                    incorrectAnswers = new[] { "Lyon", "Vienna", "Lisbon" },
                    explanation = $"The guide says: {fact.Quote}.",
                    sourceQuote = fact.Quote,
                    page
                })
                .Concat(Enumerable.Range(1, unsupported).Select(i => (object)new
                {
                    question = $"Invented question {i}?",
                    correctAnswer = $"Invented {i}",
                    incorrectAnswers = new[] { "A", "B", "C" },
                    explanation = "Not in the guide.",
                    sourceQuote = $"this sentence number {i} never appears in the study guide",
                    page
                }))
                .ToList()
        });

    public static IConfiguration Keys(bool deepSeek = true, bool openAi = true, bool gemini = true) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["DeepSeek:ApiKey"] = deepSeek ? "deepseek-test-key" : "",
                ["OpenAI:ApiKey"] = openAi ? "openai-test-key" : "",
                ["Gemini:ApiKey"] = gemini ? "gemini-test-key" : ""
            })
            .Build();

    /// <summary>Moderation mock that blocks any value containing "badword".</summary>
    public static ITextModerationService Moderation()
    {
        Mock<ITextModerationService> moderation = new();
        moderation
            .Setup(x => x.Evaluate(It.IsAny<string?[]>()))
            .Returns((string?[] values) => values.Any(v => v is not null && v.Contains("badword", StringComparison.OrdinalIgnoreCase))
                ? new TextModerationResult(TextModerationOutcome.Blocked, "badword")
                : new TextModerationResult(TextModerationOutcome.Clean));
        return moderation.Object;
    }

    public static StudyGuideTextExtractor Extractor(StudyGuideDocumentOptions? options = null) =>
        new(MsOptions.Create(options ?? new StudyGuideDocumentOptions()));

    public static SectionGenerationProcessor Processor(
        ApplicationDbContext db,
        FakeVendorHandler handler,
        TimeProvider clock,
        IConfiguration? keys = null,
        StudyGuideGenerationOptions? options = null,
        ILogger<SectionGenerationProcessor>? logger = null) =>
        new(
            db,
            new OpenAiCompatibleChatClient(new HttpClient(handler), NullLogger<OpenAiCompatibleChatClient>.Instance),
            new LlmVendorRegistry(keys ?? Keys()),
            Moderation(),
            MsOptions.Create(options ?? new StudyGuideGenerationOptions()),
            clock,
            logger ?? NullLogger<SectionGenerationProcessor>.Instance);

    public static Mock<IUserContext> User(string userId)
    {
        Mock<IUserContext> user = new();
        user.Setup(x => x.UserId).Returns(userId);
        user.Setup(x => x.IsAuthenticated).Returns(true);
        user.Setup(x => x.IsAdmin).Returns(false);
        return user;
    }

    public static string Utf8(int bytes, char fill = 'a') => new(fill, bytes);

    public static byte[] Bytes(string text) => Encoding.UTF8.GetBytes(text);
}
