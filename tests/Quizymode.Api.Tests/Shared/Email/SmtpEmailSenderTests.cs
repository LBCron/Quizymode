using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Quizymode.Api.Shared.Email;
using Xunit;

namespace Quizymode.Api.Tests.Shared.Email;

public sealed class SmtpEmailSenderTests
{
    private static EmailOptions Complete() => new()
    {
        From = "from@example.test",
        AdminAddress = "admin@example.test",
        Smtp = { Host = "smtp.example.test", UserName = "u", Password = "p" }
    };

    [Fact]
    public void IsConfigured_TrueOnlyWhenEverySettingIsPresent()
    {
        new SmtpEmailSender(Options.Create(Complete()), NullLogger<SmtpEmailSender>.Instance).IsConfigured.Should().BeTrue();

        EmailOptions missing = Complete();
        missing.Smtp.Password = " ";
        new SmtpEmailSender(Options.Create(missing), NullLogger<SmtpEmailSender>.Instance).IsConfigured.Should().BeFalse();
    }

    [Fact]
    public async Task Send_WhenIncomplete_ReturnsFalseWithoutThrowing()
    {
        EmailOptions missing = Complete();
        missing.AdminAddress = null;
        SmtpEmailSender sender = new(Options.Create(missing), NullLogger<SmtpEmailSender>.Instance);

        (await sender.SendToAdminAsync("s", "b", CancellationToken.None)).Should().BeFalse();
    }

    [Fact]
    public async Task NoOp_IsNotConfiguredAndReturnsFalse()
    {
        NoOpEmailSender sender = new(NullLogger<NoOpEmailSender>.Instance);

        sender.IsConfigured.Should().BeFalse();
        (await sender.SendToAdminAsync("s", "b", CancellationToken.None)).Should().BeFalse();
    }
}
