import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminAiProvidersPage from "./AdminAiProvidersPage";
import { adminLlmProvidersApi, type LlmProvidersResponse } from "@/api/adminLlmProviders";

const mockUseAuth = vi.fn();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/api/adminLlmProviders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/adminLlmProviders")>();
  return {
    ...actual,
    adminLlmProvidersApi: { get: vi.fn(), update: vi.fn(), getAttempts: vi.fn(), getUsage: vi.fn() },
  };
});

const settings: LlmProvidersResponse = {
  vendors: [
    { vendor: "OpenRouter", keyConfigured: true, model: "google/gemma-4-31b-it:free" },
    { vendor: "OpenAI", keyConfigured: false, model: "gpt-5-nano" },
    { vendor: "Gemini", keyConfigured: true, model: "gemini-3.5-flash-lite" },
    { vendor: "Groq", keyConfigured: false, model: "openai/gpt-oss-120b" },
    { vendor: "Cerebras", keyConfigured: false, model: "gpt-oss-120b" },
  ],
  routes: { free: ["Gemini", "OpenAI", "OpenRouter"], premium: ["OpenRouter", "OpenAI", "Gemini"] },
  monthlySectionBudget: 1000,
  monthlySectionsUsed: 250,
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/admin/ai-providers"]}>
        <Routes>
          <Route path="/admin/ai-providers" element={<AdminAiProvidersPage />} />
          <Route path="/" element={<div data-testid="home">Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function routeItems(label: string): string[] {
  const section = screen.getByRole("region", { name: label });
  return within(section)
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

describe("AdminAiProvidersPage", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isAdmin: true });
    vi.mocked(adminLlmProvidersApi.get).mockResolvedValue(settings);
    vi.mocked(adminLlmProvidersApi.update).mockImplementation(async (request) => ({
      ...settings,
      vendors: settings.vendors.map((vendor) => ({
        ...vendor,
        model: request.vendors.find((entry) => entry.vendor === vendor.vendor)?.model ?? vendor.model,
      })),
      routes: request.routes,
    }));
    vi.mocked(adminLlmProvidersApi.getAttempts).mockResolvedValue({
      attempts: [
        {
          createdUtc: "2026-10-17T10:00:00Z",
          vendor: "Gemini",
          model: "gemini-3.5-flash-lite",
          outcome: "LowQuoteYield",
          inputTokens: 1200,
          outputTokens: 800,
          durationMs: 4200,
          httpStatus: 200,
        },
        {
          createdUtc: "2026-10-17T09:00:00Z",
          vendor: "OpenAI",
          model: "gpt-5-nano",
          outcome: "AuthError",
          inputTokens: null,
          outputTokens: null,
          durationMs: 150,
          httpStatus: 401,
        },
        {
          createdUtc: "2026-10-17T08:00:00Z",
          vendor: "OpenRouter",
          model: "google/gemma-4-31b-it:free",
          outcome: "Timeout",
          inputTokens: null,
          outputTokens: null,
          durationMs: 60000,
          httpStatus: null,
        },
      ],
    });
    vi.mocked(adminLlmProvidersApi.getUsage).mockResolvedValue({
      days: 30,
      sinceUtc: "2026-09-20T00:00:00Z",
      rows: [],
      topUsers: [],
    });
  });

  it("shows the HTTP status column and a readable label for auth errors", async () => {
    renderPage();

    expect(await screen.findByText("Auth error (check key)")).toBeInTheDocument();
    expect(screen.queryByText("AuthError")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "HTTP" })).toBeInTheDocument();
    expect(screen.getByText("401")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    // The timed-out attempt has no HTTP status.
    const timeoutRow = screen.getByText("Timeout").closest("tr");
    expect(within(timeoutRow as HTMLElement).getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("does not warn when every route has a keyed vendor", async () => {
    renderPage();
    await screen.findByLabelText("Model for OpenRouter");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns when the saved route has no keyed vendor, and follows the saved state only", async () => {
    vi.mocked(adminLlmProvidersApi.get).mockResolvedValue({
      ...settings,
      routes: { free: ["OpenAI"], premium: ["OpenRouter", "Gemini"] },
    });
    renderPage();
    await screen.findByLabelText("Model for OpenRouter");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No vendor in this route has a key; generation for free users is off.");
    expect(within(screen.getByRole("region", { name: "Free route" })).getByRole("alert")).toBe(alert);

    // Unsaved edits do not toggle the alert: emptying the premium route only shows the existing line.
    fireEvent.click(screen.getByRole("button", { name: "Remove OpenRouter from Premium route" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Gemini from Premium route" }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByText("No vendors in this route.")).toBeInTheDocument();
  });

  it("updates the warning after saving a route with no keyed vendor", async () => {
    renderPage();
    await screen.findByLabelText("Model for OpenRouter");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove OpenRouter from Premium route" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Gemini from Premium route" }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText("AI provider settings saved.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("generation for premium users is off");
  });

  it("redirects non-admins", () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isAdmin: false });
    renderPage();
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });

  it("shows key badges as text, models, budget and recent attempts", async () => {
    renderPage();

    expect(await screen.findByLabelText("Model for OpenRouter")).toHaveValue("google/gemma-4-31b-it:free");
    expect(screen.getAllByText("Key configured")).toHaveLength(2);
    expect(screen.getAllByText("No key")).toHaveLength(3);
    expect(screen.getByText(/250 of 1,000 sections generated this month/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /monthly section budget/i })).toHaveAttribute("aria-valuenow", "25");
    expect(await screen.findByText("LowQuoteYield")).toBeInTheDocument();
    expect(screen.getByText("1200 / 800")).toBeInTheDocument();
  });

  it("keeps the layout classes that prevent horizontal overflow on narrow screens (#245)", async () => {
    renderPage();
    const modelInput = await screen.findByLabelText("Model for OpenRouter");

    expect(modelInput.closest("table")?.parentElement).toHaveClass("overflow-x-auto");

    const routing = screen.getByRole("heading", { name: "Routing" }).nextElementSibling;
    expect(routing).toHaveClass("grid-cols-1");

    const routeItem = within(screen.getByRole("region", { name: /free/i })).getAllByRole("listitem")[0];
    expect(routeItem).toHaveClass("flex-wrap");
  });

  it("reorders routes with keyboard-operable buttons and saves", async () => {
    renderPage();
    await screen.findByLabelText("Model for OpenRouter");

    expect(routeItems("Free route")[0]).toMatch(/Gemini/);
    const moveUp = screen.getByRole("button", { name: "Move OpenAI up in Free route" });
    moveUp.focus();
    fireEvent.click(moveUp);
    expect(routeItems("Free route")[0]).toMatch(/OpenAI/);
    expect(screen.getByRole("button", { name: "Move OpenAI up in Free route" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove OpenRouter from Premium route" }));
    fireEvent.change(screen.getByLabelText("Model for OpenAI"), { target: { value: " gpt-5-mini " } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(adminLlmProvidersApi.update).toHaveBeenCalledWith({
        vendors: [
          { vendor: "Gemini", model: "gemini-3.5-flash-lite" },
          { vendor: "Groq", model: "openai/gpt-oss-120b" },
          { vendor: "Cerebras", model: "gpt-oss-120b" },
          { vendor: "OpenRouter", model: "google/gemma-4-31b-it:free" },
          { vendor: "OpenAI", model: "gpt-5-mini" },
        ],
        routes: { free: ["OpenAI", "Gemini", "OpenRouter"], premium: ["OpenAI", "Gemini"] },
      })
    );
    expect(await screen.findByText("AI provider settings saved.")).toBeInTheDocument();
  });

  it("shows a cooldown note for a rate-limited vendor", async () => {
    vi.mocked(adminLlmProvidersApi.get).mockResolvedValue({
      ...settings,
      vendors: settings.vendors.map((vendor) => ({
        ...vendor,
        coolingDownUntilUtc: vendor.vendor === "Gemini" ? new Date(Date.now() + 60_000).toISOString() : null,
      })),
    });
    renderPage();
    await screen.findByLabelText("Model for OpenRouter");

    expect(screen.getByText(/Cooling down until/)).toBeInTheDocument();
    expect(screen.getAllByText(/Cooling down until/)).toHaveLength(1);
  });

  it("expires each cooldown in an open tab and ignores already expired timestamps", async () => {
    const now = Date.now();
    vi.mocked(adminLlmProvidersApi.get).mockResolvedValue({
      ...settings,
      vendors: settings.vendors.map((vendor) => ({
        ...vendor,
        coolingDownUntilUtc: new Date(now + (vendor.vendor === "Gemini" ? 1000 : vendor.vendor === "Groq" ? 2000 : -1000)).toISOString(),
      })),
    });
    vi.useFakeTimers({ now });
    renderPage();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getAllByText(/Cooling down until/)).toHaveLength(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getAllByText(/Cooling down until/)).toHaveLength(1);
    expect(within(screen.getByLabelText("Model for Groq").closest("tr")!).getByText(/Cooling down until/)).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.queryByText(/Cooling down until/)).not.toBeInTheDocument();
  });

  it("refreshes extended cooldowns without losing unsaved models or routes, even after a refresh fails", async () => {
    const now = Date.now();
    const response = (seconds: number): LlmProvidersResponse => ({
      ...settings,
      vendors: settings.vendors.map((vendor) => ({
        ...vendor,
        coolingDownUntilUtc: vendor.vendor === "Gemini" ? new Date(now + seconds * 1000).toISOString() : null,
      })),
    });
    vi.mocked(adminLlmProvidersApi.get)
      .mockResolvedValueOnce(response(20))
      .mockResolvedValueOnce(response(45))
      .mockRejectedValueOnce(new Error("Temporary outage"))
      .mockResolvedValue(response(45));
    vi.useFakeTimers({ now });
    renderPage();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.change(screen.getByLabelText("Model for Gemini"), { target: { value: "unsaved-model" } });
    fireEvent.click(screen.getByRole("button", { name: "Move OpenAI up in Free route" }));

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(adminLlmProvidersApi.get).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(adminLlmProvidersApi.get).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/Cooling down until/)).toBeInTheDocument();
    expect(screen.getByLabelText("Model for Gemini")).toHaveValue("unsaved-model");
    expect(routeItems("Free route")[0]).toMatch(/OpenAI/);

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.queryByText(/Cooling down until/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Model for Gemini")).toHaveValue("unsaved-model");
    expect(routeItems("Free route")[0]).toMatch(/OpenAI/);
  });

  it("can add a removed vendor back to a route", async () => {
    renderPage();
    await screen.findByLabelText("Model for OpenRouter");

    fireEvent.click(screen.getByRole("button", { name: "Remove Gemini from Free route" }));
    fireEvent.change(screen.getByLabelText("Add vendor to Free route"), { target: { value: "Gemini" } });
    fireEvent.click(within(screen.getByRole("region", { name: "Free route" })).getByRole("button", { name: "Add" }));

    expect(routeItems("Free route").at(-1)).toMatch(/Gemini/);
  });

  it("validates models and empty routes before saving", async () => {
    renderPage();
    await screen.findByLabelText("Model for OpenRouter");

    fireEvent.change(screen.getByLabelText("Model for Gemini"), { target: { value: "bad model!" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText(/Gemini: Model may contain only/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Model for Gemini"), { target: { value: "gemini-2.5-flash" } });
    for (const vendor of ["OpenRouter", "OpenAI", "Gemini"]) {
      fireEvent.click(screen.getByRole("button", { name: `Remove ${vendor} from Premium route` }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText(/premium route needs at least one vendor/i)).toBeInTheDocument();
    expect(adminLlmProvidersApi.update).not.toHaveBeenCalled();
  });
});
