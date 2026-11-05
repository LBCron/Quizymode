using System.Net;
using System.Text;
using System.Text.Json;

namespace Quizymode.Api.Tests.Features.StudyGuideDocuments;

/// <summary>Fake HTTP handler for an OpenAI-compatible chat completions API; never touches the network.</summary>
internal sealed class FakeChatHandler(Func<HttpRequestMessage, string, HttpResponseMessage> respond) : HttpMessageHandler
{
    public List<(HttpRequestMessage Request, string Body)> Requests { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        string body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
        Requests.Add((request, body));
        return respond(request, body);
    }

    public static FakeChatHandler ReturningText(string text, string finishReason = "stop") =>
        new((_, _) => Json(HttpStatusCode.OK, CompletionBody(text, finishReason)));

    public static FakeChatHandler ReturningStatus(HttpStatusCode statusCode) =>
        new((_, _) => Json(statusCode, "{\"error\":{\"message\":\"boom\",\"type\":\"api_error\",\"code\":\"x\"}}"));

    public static string CompletionBody(string text, string finishReason = "stop") =>
        JsonSerializer.Serialize(new
        {
            id = "chatcmpl-test",
            @object = "chat.completion",
            model = "test-model",
            choices = new object[]
            {
                new
                {
                    index = 0,
                    message = new { role = "assistant", content = text },
                    finish_reason = finishReason
                }
            }
        });

    public static HttpResponseMessage Json(HttpStatusCode statusCode, string body) =>
        new(statusCode) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
}

