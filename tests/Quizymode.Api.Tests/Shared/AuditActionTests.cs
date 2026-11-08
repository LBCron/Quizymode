using FluentAssertions;
using Quizymode.Api.Shared.Models;
using Xunit;

namespace Quizymode.Api.Tests.Shared;

/// <summary>
/// AuditAction is persisted as an int and filtered by name (<c>GetAuditLogs</c> parses names, and the admin
/// audit-log page mirrors them). Pin both so a reorder or removal fails loudly (#235 keeps LoginFailed for history).
/// </summary>
public sealed class AuditActionTests
{
    private static readonly (string Name, int Value)[] Expected =
    [
        ("UserCreated", 0),
        ("LoginSuccess", 1),
        ("LoginFailed", 2),
        ("Logout", 3),
        ("CommentCreated", 4),
        ("CommentDeleted", 5),
        ("ItemCreated", 6),
        ("ItemUpdated", 7),
        ("ItemDeleted", 8),
        ("IdeaCreated", 9),
        ("IdeaUpdated", 10),
        ("IdeaDeleted", 11),
        ("IdeaApproved", 12),
        ("IdeaRejected", 13),
        ("IdeaStatusChanged", 14),
        ("IdeaProfanityRejected", 15),
        ("IdeaCommentCreated", 16),
        ("IdeaCommentUpdated", 17),
        ("IdeaCommentDeleted", 18),
        ("UserInternalFlagChanged", 19),
        ("DailyDigestTestSent", 20)
    ];

    [Fact]
    public void AuditAction_PinsNamesAndPersistedIntegerValues()
    {
        Enum.GetNames<AuditAction>()
            .ToDictionary(name => name, name => (int)Enum.Parse<AuditAction>(name))
            .Should().BeEquivalentTo(Expected.ToDictionary(e => e.Name, e => e.Value));
    }
}
