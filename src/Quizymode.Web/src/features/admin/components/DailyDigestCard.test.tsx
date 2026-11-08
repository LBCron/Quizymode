import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DailyDigestCard from "./DailyDigestCard";
import { formatInZone, toLocalInput, validateWindow } from "./digestFormatting";
import type { DailyDigestRun, DailyDigestRuns } from "@/api/adminDailyDigest";

const { mockApi } = vi.hoisted(() => ({
  mockApi: { getRuns: vi.fn(), getPreview: vi.fn(), sendTest: vi.fn(), sendNow: vi.fn() },
}));

vi.mock("@/api/adminDailyDigest", () => ({ dailyDigestApi: mockApi }));

function axiosError(status: number, extra: { headers?: Record<string, string>; data?: unknown } = {}) {
  return Object.assign(new Error(`status ${status}`), {
    isAxiosError: true,
    response: { status, headers: extra.headers ?? {}, data: extra.data ?? {} },
  });
}

function run(overrides: Partial<DailyDigestRun> = {}): DailyDigestRun {
  return {
    id: "r1",
    kind: "Scheduled",
    reportDate: "2026-11-06",
    status: "Sent",
    attempts: 1,
    windowStartUtc: "2026-11-06T06:00:00Z",
    windowEndUtc: "2026-11-07T06:00:00Z",
    sentUtc: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    lastError: null,
    nextAttemptUtc: null,
    createdUtc: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    ...overrides,
  };
}

function runs(overrides: Partial<DailyDigestRuns> = {}): DailyDigestRuns {
  return {
    enabled: true,
    disabledReason: null,
    emailConfigured: true,
    timeZone: "America/Chicago",
    nextDueUtc: "2026-11-08T14:00:00Z",
    lastTestSentUtc: null,
    runs: [run()],
    ...overrides,
  };
}

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <DailyDigestCard />
    </QueryClientProvider>
  );
}

describe("DailyDigestCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a spinner while loading", () => {
    mockApi.getRuns.mockReturnValue(new Promise(() => undefined));
    renderCard();
    expect(screen.getByRole("heading", { name: "Daily digest" })).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("shows an error with retry when the status request fails", async () => {
    mockApi.getRuns.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(runs());
    renderCard();
    expect(await screen.findByText("Failed to load daily digest status.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findAllByText("Sent")).length).toBeGreaterThan(0);
  });

  it("says the digest is off, with only the reason when there is one", async () => {
    mockApi.getRuns.mockResolvedValue(runs({ enabled: false, runs: [] }));
    const { unmount } = renderCard();
    expect(await screen.findByText("Daily digest is turned off.")).toBeInTheDocument();
    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument();
    unmount();

    mockApi.getRuns.mockResolvedValue(runs({ enabled: false, disabledReason: "InvalidTimeZone", runs: [] }));
    renderCard();
    expect(await screen.findByText("Reason: InvalidTimeZone")).toBeInTheDocument();
  });

  it("flags unconfigured email and disables the test button", async () => {
    mockApi.getRuns.mockResolvedValue(runs({ emailConfigured: false, runs: [] }));
    renderCard();
    expect(await screen.findByText(/Email is not configured, so digests cannot be sent/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Send test email" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-describedby", "daily-digest-test-hint");
  });

  it("explains that no digest was sent yet and when the first is due, in the digest zone", async () => {
    mockApi.getRuns.mockResolvedValue(runs({ runs: [] }));
    renderCard();
    expect(await screen.findByText(/No digest has been sent yet\. The first one is due Nov 8, 2026, 8:00 AM CST\./)).toBeInTheDocument();
  });

  it("shows the last sent digest and the next due time in America/Chicago", async () => {
    mockApi.getRuns.mockResolvedValue(runs({ runs: [run({ sentUtc: "2026-11-07T14:00:30Z" })] }));
    renderCard();
    expect((await screen.findAllByText("Sent")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Nov 8, 2026, 8:00 AM CST/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Nov 7, 2026, 8:00 AM CST/).length).toBeGreaterThan(0);
  });

  it("shows a failed digest with its reason, attempts and next retry", async () => {
    mockApi.getRuns.mockResolvedValue(
      runs({
        runs: [run({ status: "Failed", lastError: "SmtpError", attempts: 2, sentUtc: null, nextAttemptUtc: "2026-11-07T16:00:00Z" })],
      })
    );
    renderCard();
    expect((await screen.findAllByText("Failed")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("SmtpError").length).toBeGreaterThan(0);
    expect(screen.getByText(/2 of 4/)).toBeInTheDocument();
    expect(screen.getByText(/next retry/)).toBeInTheDocument();
  });

  it("shows a NotConfigured failure as Not configured", async () => {
    mockApi.getRuns.mockResolvedValue(runs({ runs: [run({ status: "Failed", lastError: "NotConfigured", attempts: 0, sentUtc: null })] }));
    renderCard();
    expect((await screen.findAllByText("Not configured")).length).toBeGreaterThan(0);
  });

  it("shows a missed digest", async () => {
    mockApi.getRuns.mockResolvedValue(runs({ runs: [run({ status: "Missed", sentUtc: null })] }));
    renderCard();
    expect((await screen.findAllByText("Missed")).length).toBeGreaterThan(0);
    expect(screen.getByText("The digest for 2026-11-06 was not sent.")).toBeInTheDocument();
  });

  it("warns when nothing was sent in the last 26 hours", async () => {
    mockApi.getRuns.mockResolvedValue(
      runs({ runs: [run({ sentUtc: new Date(Date.now() - 30 * 3600 * 1000).toISOString() })] })
    );
    renderCard();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No digest sent in the last 26 hours.");
  });

  it("does not warn after a recent send", async () => {
    mockApi.getRuns.mockResolvedValue(runs());
    renderCard();
    await screen.findAllByText("Sent");
    expect(screen.queryByText(/No digest sent in the last 26 hours/)).not.toBeInTheDocument();
  });

  it("previews the digest text in a pre block and can close it", async () => {
    mockApi.getRuns.mockResolvedValue(runs());
    mockApi.getPreview.mockResolvedValue({
      reportDate: "2026-11-06",
      windowStartUtc: "",
      windowEndUtc: "",
      subject: "Quizymode daily - Fri Nov 6",
      textBody: "VISITS  yesterday\n  Sessions 4",
    });
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: "Preview" }));
    const pre = await screen.findByLabelText("Digest preview text");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toContain("Sessions 4");
    expect(screen.getByText("Subject: Quizymode daily - Fri Nov 6")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByLabelText("Digest preview text")).not.toBeInTheDocument();
  });

  it("shows a friendly message when the preview is rejected", async () => {
    mockApi.getRuns.mockResolvedValue(runs());
    mockApi.getPreview.mockRejectedValue(axiosError(400));
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: "Preview" }));
    expect(await screen.findByText("That day cannot be previewed.")).toBeInTheDocument();
  });

  it("sends a test and then keeps the button disabled with a countdown", async () => {
    mockApi.getRuns.mockResolvedValue(runs());
    mockApi.sendTest.mockResolvedValue({ subject: "[TEST] x" });
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: "Send test email" }));
    expect(await screen.findByText("Test email sent to the configured admin address.")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /Test sent\. Try again in (5:00|4:5\d)/ });
    expect(button).toBeDisabled();
  });

  it("starts the cooldown on 429 using Retry-After", async () => {
    mockApi.getRuns.mockResolvedValue(runs());
    mockApi.sendTest.mockRejectedValue(axiosError(429, { headers: { "retry-after": "120" } }));
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: "Send test email" }));
    expect(await screen.findByText("A test email was sent recently. Try again in 2 minutes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again in 2:0/ })).toBeDisabled();
  });

  it("explains a 503 from the test send", async () => {
    mockApi.getRuns.mockResolvedValue(runs());
    mockApi.sendTest.mockRejectedValue(axiosError(503));
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: "Send test email" }));
    expect(await screen.findByText("Email is not configured on the server, so no test could be sent.")).toBeInTheDocument();
  });

  it("derives the test cooldown from the server after a refresh", async () => {
    mockApi.getRuns.mockResolvedValue(runs({ lastTestSentUtc: new Date(Date.now() - 60 * 1000).toISOString() }));
    renderCard();
    expect(await screen.findByRole("button", { name: /Test sent\. Try again in [34]:/ })).toBeDisabled();
  });

  it("lists recent runs with Not configured shown for NotConfigured errors", async () => {
    mockApi.getRuns.mockResolvedValue(
      runs({
        runs: [
          run({ id: "a", status: "Failed", lastError: "NotConfigured", attempts: 0, sentUtc: null }),
          run({ id: "b", kind: "AdHoc", reportDate: "2026-11-05" }),
        ],
      })
    );
    renderCard();
    await screen.findByText("Recent runs");
    const table = screen.getByRole("table");
    expect(within(table).getByText("Ad hoc")).toBeInTheDocument();
    expect(within(table).getAllByText("Not configured").length).toBeGreaterThan(0);
  });

  describe("Send digest now", () => {
    it("defaults to exactly the last 24 hours ending when the page opened", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 10, 7, 9, 30, 15, 500));
      mockApi.getRuns.mockResolvedValue(runs());
      mockApi.sendNow.mockResolvedValue({ id: "x", status: "Sent", windowStartUtc: "", windowEndUtc: "" });
      renderCard();
      const fromInput = (await screen.findByLabelText("From")) as HTMLInputElement;
      const toInput = screen.getByLabelText("To") as HTMLInputElement;
      expect(fromInput.value).toMatch(/^2026-11-06T09:30:15/);
      expect(toInput.value).toMatch(/^2026-11-07T09:30:15/);

      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Send digest now" }));

      await waitFor(() => expect(mockApi.sendNow).toHaveBeenCalledTimes(1));
      const [fromIso, toIso] = mockApi.sendNow.mock.calls[0] as [string, string];
      expect(new Date(toIso).getTime() - new Date(fromIso).getTime()).toBe(24 * 3600 * 1000);
      expect(new Date(toIso).getTime()).toBe(new Date(2026, 10, 7, 9, 30, 15).getTime());
      expect(await screen.findByText("Digest sent to the configured admin address.")).toBeInTheDocument();
    });

    it("rejects invalid windows in the UI without calling the API", async () => {
      mockApi.getRuns.mockResolvedValue(runs());
      renderCard();
      const user = userEvent.setup();
      const fromInput = await screen.findByLabelText("From");
      const toInput = screen.getByLabelText("To");
      const submit = screen.getByRole("button", { name: "Send digest now" });

      await user.clear(fromInput);
      await user.type(fromInput, toLocalInput(new Date(Date.now() + 3600 * 1000)));
      await user.click(submit);
      expect(await screen.findByText("From must be before To.")).toBeInTheDocument();

      await user.clear(fromInput);
      await user.type(fromInput, toLocalInput(new Date(Date.now() - 2 * 3600 * 1000)));
      await user.clear(toInput);
      await user.type(toInput, toLocalInput(new Date(Date.now() + 3 * 3600 * 1000)));
      await user.click(submit);
      expect(await screen.findByText("To must not be in the future.")).toBeInTheDocument();

      await user.clear(fromInput);
      await user.type(fromInput, toLocalInput(new Date(Date.now() - 40 * 24 * 3600 * 1000)));
      await user.clear(toInput);
      await user.type(toInput, toLocalInput(new Date(Date.now() - 3600 * 1000)));
      await user.click(submit);
      expect(await screen.findByText("The window can be at most 31 days.")).toBeInTheDocument();
      expect(mockApi.sendNow).not.toHaveBeenCalled();
    });

    it("shows the rate-limit and not-configured answers from the API", async () => {
      mockApi.getRuns.mockResolvedValue(runs());
      mockApi.sendNow.mockRejectedValueOnce(axiosError(429)).mockRejectedValueOnce(axiosError(503));
      renderCard();
      const submit = await screen.findByRole("button", { name: "Send digest now" });
      await userEvent.click(submit);
      expect(await screen.findByText("A digest was sent a moment ago. Please wait a minute before sending another.")).toBeInTheDocument();
      await userEvent.click(submit);
      expect(await screen.findByText("Email is not configured on the server, so nothing was sent.")).toBeInTheDocument();
    });

    it("shows the API detail for a rejected window", async () => {
      mockApi.getRuns.mockResolvedValue(runs());
      mockApi.sendNow.mockRejectedValue(axiosError(400, { data: { detail: "The window can be at most 31 days." } }));
      renderCard();
      await userEvent.click(await screen.findByRole("button", { name: "Send digest now" }));
      expect(await screen.findByText("The window can be at most 31 days.")).toBeInTheDocument();
    });
  });
});

describe("DailyDigestCard helpers", () => {
  it("validateWindow mirrors the API rules", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    const hour = 3600 * 1000;
    expect(validateWindow(new Date(now.getTime() - 2 * hour), new Date(now.getTime() - hour), now)).toBeNull();
    expect(validateWindow(new Date(now.getTime() - hour), new Date(now.getTime() - 2 * hour), now)).toBe("From must be before To.");
    expect(validateWindow(new Date(now.getTime() - hour), new Date(now.getTime() + hour), now)).toBe("To must not be in the future.");
    expect(validateWindow(new Date(now.getTime() - 32 * 24 * hour), now, now)).toBe("The window can be at most 31 days.");
    expect(validateWindow(new Date(now.getTime() - 31 * 24 * hour), now, now)).toBeNull();
    expect(validateWindow(new Date(NaN), now, now)).toBe("Enter both a From and a To time.");
  });

  it("formatInZone uses the given zone and shows its label", () => {
    expect(formatInZone("2026-11-07T14:00:00Z", "America/Chicago")).toBe("Nov 7, 2026, 8:00 AM CST");
    expect(formatInZone("2026-07-16T13:00:00Z", "America/Chicago")).toBe("Jul 16, 2026, 8:00 AM CDT");
  });
});
