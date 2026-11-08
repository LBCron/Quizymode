namespace Quizymode.Api.Shared.Email;

/// <summary>Configuration section <c>Email</c> (shared by the LLM audit and the daily digest). The SMTP password comes only from environment or secret config.</summary>
internal sealed class EmailOptions
{
    public const string SectionName = "Email";

    public string? AdminAddress { get; set; }

    public string? From { get; set; }

    public SmtpOptions Smtp { get; set; } = new();

    internal sealed class SmtpOptions
    {
        public string? Host { get; set; }

        public int Port { get; set; } = 587;

        public string? UserName { get; set; }

        public string? Password { get; set; }
    }

    /// <summary>True when every setting needed to send is present.</summary>
    public bool IsComplete =>
        !string.IsNullOrWhiteSpace(Smtp.Host)
        && !string.IsNullOrWhiteSpace(Smtp.UserName)
        && !string.IsNullOrWhiteSpace(Smtp.Password)
        && !string.IsNullOrWhiteSpace(From)
        && !string.IsNullOrWhiteSpace(AdminAddress);
}
