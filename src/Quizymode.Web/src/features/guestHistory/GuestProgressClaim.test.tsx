import { beforeEach, describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { INTERESTS_QUERY_KEY } from "@/features/interests/useInterests";
import { GuestProgressClaim } from "./GuestProgressClaim";

const { mockClaim, mockAuth, mockClaimInterests, mockClaimPlans } = vi.hoisted(() => ({
  mockClaim: vi.fn(),
  mockClaimPlans: vi.fn(),
  mockAuth: vi.fn(),
  mockClaimInterests: vi.fn(),
}));
vi.mock("./claimGuestProgress", () => ({ claimGuestProgress: mockClaim }));
vi.mock("@/features/learningLoop/claimLocalInterests", () => ({ claimLocalInterests: mockClaimInterests }));
vi.mock("@/features/studyPlans/claimLocalStudyPlans", () => ({ claimLocalStudyPlans: mockClaimPlans }));

let queryClient: QueryClient;
const render = (ui: ReactElement) => rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
vi.mock("@/contexts/AuthContext", () => ({ useAuth: mockAuth }));

describe("GuestProgressClaim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient();
    mockClaimInterests.mockResolvedValue(false);
    mockClaimPlans.mockResolvedValue(false);
    mockAuth.mockReturnValue({ isAuthenticated: true, isLoading: false, userId: "user-1" });
  });

  it("does not claim for anonymous visitors", () => {
    mockAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    const { container } = render(<GuestProgressClaim />);
    expect(mockClaim).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("confirms saved results", async () => {
    mockClaim.mockResolvedValue({ status: "saved", saved: 2, skipped: 0 });
    render(<GuestProgressClaim />);
    expect(await screen.findByRole("status")).toHaveTextContent("Saved 2 quiz results from this browser to your account");
  });

  it("renders nothing when there is nothing to claim", async () => {
    mockClaim.mockResolvedValue({ status: "none" });
    const { container } = render(<GuestProgressClaim />);
    await waitFor(() => expect(mockClaim).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a retry after a failure", async () => {
    mockClaim.mockResolvedValueOnce({ status: "failed", pending: 1 });
    mockClaim.mockResolvedValueOnce({ status: "saved", saved: 1, skipped: 0 });
    render(<GuestProgressClaim />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    retry.click();
    expect(await screen.findByRole("status")).toHaveTextContent("Saved 1 quiz result from");
  });

  it("#382: a successful topics claim seeds the interests cache with the merged list and refetches it", async () => {
    mockClaim.mockResolvedValue({ status: "none" });
    mockClaimInterests.mockImplementation(async (onMerged: (merged: string[]) => void) => {
      onMerged(["history", "trivia"]);
      return true;
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render(<GuestProgressClaim />);

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["interests"] }));
    expect(queryClient.getQueryData(INTERESTS_QUERY_KEY("user-1"))).toEqual(["history", "trivia"]);
  });

  it("#382: a failed topics claim leaves the interests cache alone", async () => {
    mockClaim.mockResolvedValue({ status: "none" });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render(<GuestProgressClaim />);

    await waitFor(() => expect(mockClaimInterests).toHaveBeenCalledTimes(1));
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["interests"] });
    expect(queryClient.getQueryData(INTERESTS_QUERY_KEY("user-1"))).toBeUndefined();
  });

  it("#364: claims test-date plans in their own chain and refetches plans once both claims settle", async () => {
    let finishProgress: (value: unknown) => void = () => undefined;
    mockClaim.mockReturnValue(new Promise((resolve) => (finishProgress = resolve)));
    mockClaimInterests.mockRejectedValue(new Error("interests down"));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render(<GuestProgressClaim />);

    await waitFor(() => expect(mockClaimPlans).toHaveBeenCalledTimes(1));
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["study-plans"] });
    finishProgress({ status: "none" });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["study-plans"] }));
  });

  it("#364: a failing plans claim does not block the guest history claim result", async () => {
    mockClaim.mockResolvedValue({ status: "saved", saved: 1, skipped: 0 });
    mockClaimPlans.mockRejectedValue(new Error("down"));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render(<GuestProgressClaim />);

    expect(await screen.findByRole("status")).toHaveTextContent("Saved 1 quiz result from");
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["study-plans"] }));
  });

  it("#364: anonymous visitors do not claim plans", () => {
    mockAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    render(<GuestProgressClaim />);
    expect(mockClaimPlans).not.toHaveBeenCalled();
  });
});
