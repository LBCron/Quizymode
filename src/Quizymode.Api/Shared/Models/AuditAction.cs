namespace Quizymode.Api.Shared.Models;

/// <summary>
/// Persisted as an int: never remove or reorder members. <see cref="LoginFailed"/> is no longer written (#235) and is
/// kept for historical rows and the audit-log filter.
/// </summary>
public enum AuditAction
{
    UserCreated,
    LoginSuccess,
    LoginFailed,
    Logout,
    CommentCreated,
    CommentDeleted,
    ItemCreated,
    ItemUpdated,
    ItemDeleted,
    IdeaCreated,
    IdeaUpdated,
    IdeaDeleted,
    IdeaApproved,
    IdeaRejected,
    IdeaStatusChanged,
    IdeaProfanityRejected,
    IdeaCommentCreated,
    IdeaCommentUpdated,
    IdeaCommentDeleted,
    UserInternalFlagChanged,
    DailyDigestTestSent
}

