namespace Quizymode.Api.Features.Users;

/// <summary>
/// The one place that decides which Terms of Service and Privacy Policy versions are current (#222). Bumping a version
/// here makes every signed-in user who has not accepted it see the acceptance prompt at their next sign-in. The legal
/// pages' effective dates and the signup form's queued versions (<c>policyAcceptanceStorage.ts</c>) must match these;
/// <c>CurrentPolicyVersionsTests</c> fails the build when the SPA constants drift.
/// </summary>
public static class CurrentPolicyVersions
{
    public const string TermsOfService = "2026-03-29";
    public const string PrivacyPolicy = "2026-11-05";

    public static IReadOnlyList<(string PolicyType, string Version)> All { get; } =
    [
        (RecordPolicyAcceptances.PolicyTypes.TermsOfService, TermsOfService),
        (RecordPolicyAcceptances.PolicyTypes.PrivacyPolicy, PrivacyPolicy)
    ];
}
