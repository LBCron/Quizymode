using System.Net;
using System.Net.Mail;
using Microsoft.Extensions.Options;

namespace Quizymode.Api.Shared.Email;

internal interface IEmailSender
{
    /// <summary>True when every setting needed to send is present.</summary>
    bool IsConfigured { get; }

    /// <summary>Sends a plain-text email to the configured admin address. Returns false when not configured or the send failed; never throws.</summary>
    Task<bool> SendToAdminAsync(string subject, string body, CancellationToken cancellationToken);
}

/// <summary>Used when SMTP is not configured (dev, tests): sends nothing and reports failure so callers keep their work un-notified.</summary>
internal sealed class NoOpEmailSender(ILogger<NoOpEmailSender> logger) : IEmailSender
{
    public bool IsConfigured => false;

    public Task<bool> SendToAdminAsync(string subject, string body, CancellationToken cancellationToken)
    {
        logger.LogWarning("Email: not configured; notification not sent");
        return Task.FromResult(false);
    }
}

/// <summary>SMTP sender (SES SMTP endpoint, STARTTLS). Credentials and addresses are never logged.</summary>
internal sealed class SmtpEmailSender(IOptions<EmailOptions> options, ILogger<SmtpEmailSender> logger) : IEmailSender
{
    private const int SmtpTimeoutMilliseconds = 60_000;

    public bool IsConfigured => options.Value.IsComplete;

    public async Task<bool> SendToAdminAsync(string subject, string body, CancellationToken cancellationToken)
    {
        EmailOptions config = options.Value;
        if (!config.IsComplete)
        {
            logger.LogWarning("Email: SMTP settings are incomplete; notification not sent");
            return false;
        }

        try
        {
            using SmtpClient client = new(config.Smtp.Host, config.Smtp.Port)
            {
                EnableSsl = true,
                Credentials = new NetworkCredential(config.Smtp.UserName, config.Smtp.Password),
                Timeout = SmtpTimeoutMilliseconds
            };
            using MailMessage message = new(config.From!, config.AdminAddress!, subject, body);
            // SmtpClient.Timeout does not apply to SendMailAsync, so the bound is enforced here; shutdown still propagates.
            using CancellationTokenSource sendTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            sendTimeout.CancelAfter(SmtpTimeoutMilliseconds);
            await client.SendMailAsync(message, sendTimeout.Token);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            // A send timeout surfaces as OperationCanceledException without the caller token cancelled: a failed send, not shutdown.
            // Type only: the message can echo addresses or server banners.
            logger.LogWarning("Email: sending the notification email failed ({ExceptionType})", ex.GetType().Name);
            return false;
        }
    }
}
