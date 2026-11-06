using System.Net;
using System.Net.Mail;
using Microsoft.Extensions.Options;

namespace Quizymode.Api.Features.LlmModelAudit;

internal interface IEmailSender
{
    /// <summary>Sends a plain-text email to the configured admin address. Returns false when not configured or the send failed; never throws.</summary>
    Task<bool> SendToAdminAsync(string subject, string body, CancellationToken cancellationToken);
}

/// <summary>Used when SMTP is not configured (dev, tests): sends nothing and reports failure so findings stay un-notified.</summary>
internal sealed class NoOpEmailSender(ILogger<NoOpEmailSender> logger) : IEmailSender
{
    public Task<bool> SendToAdminAsync(string subject, string body, CancellationToken cancellationToken)
    {
        logger.LogWarning("LlmModelAudit: email is not configured; notification not sent");
        return Task.FromResult(false);
    }
}

/// <summary>SMTP sender (SES SMTP endpoint, STARTTLS). Credentials and addresses are never logged.</summary>
internal sealed class SmtpEmailSender(IOptions<LlmModelAuditOptions> options, ILogger<SmtpEmailSender> logger) : IEmailSender
{
    public async Task<bool> SendToAdminAsync(string subject, string body, CancellationToken cancellationToken)
    {
        LlmModelAuditOptions config = options.Value;
        if (string.IsNullOrWhiteSpace(config.Smtp.Host)
            || string.IsNullOrWhiteSpace(config.Smtp.UserName)
            || string.IsNullOrWhiteSpace(config.Smtp.Password)
            || string.IsNullOrWhiteSpace(config.From)
            || string.IsNullOrWhiteSpace(config.AdminAddress))
        {
            logger.LogWarning("LlmModelAudit: SMTP settings are incomplete; notification not sent");
            return false;
        }

        try
        {
            using SmtpClient client = new(config.Smtp.Host, config.Smtp.Port)
            {
                EnableSsl = true,
                Credentials = new NetworkCredential(config.Smtp.UserName, config.Smtp.Password),
                Timeout = 15_000
            };
            using MailMessage message = new(config.From, config.AdminAddress, subject, body);
            await client.SendMailAsync(message, cancellationToken);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Type only: the message can echo addresses or server banners.
            logger.LogWarning("LlmModelAudit: sending the notification email failed ({ExceptionType})", ex.GetType().Name);
            return false;
        }
    }
}
