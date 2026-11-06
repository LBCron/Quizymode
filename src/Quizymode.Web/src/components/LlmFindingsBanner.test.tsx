import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import LlmFindingsBanner from "./LlmFindingsBanner";

const getModelFindings = vi.hoisted(() => vi.fn());

vi.mock("@/api/adminLlmProviders", () => ({
  adminLlmProvidersApi: { getModelFindings },
}));

function renderBanner(isAdmin: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LlmFindingsBanner isAdmin={isAdmin} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("LlmFindingsBanner", () => {
  beforeEach(() => {
    getModelFindings.mockReset();
  });

  it("shows open findings with a link to the AI providers page for an admin", async () => {
    getModelFindings.mockResolvedValue({
      findings: [
        { id: "1", vendor: "OpenAI", model: "gpt-5-nano", kind: "ModelMissing", firstSeenUtc: "", lastSeenUtc: "" },
      ],
    });
    renderBanner(true);

    expect(await screen.findByRole("alert")).toHaveTextContent("OpenAI");
    expect(screen.getByText("gpt-5-nano")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open AI providers" })).toHaveAttribute("href", "/admin/ai-providers");
  });

  it("is hidden when there are no findings", async () => {
    getModelFindings.mockResolvedValue({ findings: [] });
    renderBanner(true);

    await waitFor(() => expect(getModelFindings).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("is hidden and makes no request for a non-admin", () => {
    renderBanner(false);

    expect(getModelFindings).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
