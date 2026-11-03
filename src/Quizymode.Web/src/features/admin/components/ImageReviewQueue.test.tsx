import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type AxiosResponse } from "axios";
import { ImageReviewQueue, PICTURE_POLICY_URL } from "./ImageReviewQueue";

const { mockAdminApi } = vi.hoisted(() => ({
  mockAdminApi: {
    getImageReviewQueue: vi.fn(),
    setImageReview: vi.fn(),
    fetchItemImageBlob: vi.fn(),
  },
}));

vi.mock("@/api/admin", () => ({ adminApi: mockAdminApi }));

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    category: "geography",
    isPrivate: false,
    readyForReview: false,
    question: "Which flag is this?",
    correctAnswer: "France",
    incorrectAnswers: ["Italy"],
    explanation: "",
    createdBy: "user-1",
    questionImage: { key: "media:abc", altText: "Three vertical bands", attribution: "Photo by A" },
    explanationImage: null,
    imageReview: {
      state: "PendingReview",
      revision: 4,
      submittedBy: "user-1",
      submittedByDisplay: "owner@example.com",
      submittedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    },
    ageSeconds: 7200,
    ...overrides,
  };
}

function queue(items: unknown[], oldest: string | null = new Date(Date.now() - 2 * 3600 * 1000).toISOString()) {
  return { items, totalCount: items.length, page: 1, pageSize: 25, totalPages: 1, oldestSubmittedAt: oldest };
}

function problem(status: number, title: string) {
  return new AxiosError("fail", "ERR", undefined, undefined, {
    status,
    data: { title },
  } as AxiosResponse);
}

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ImageReviewQueue />
    </QueryClientProvider>,
  );
}

describe("ImageReviewQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminApi.fetchItemImageBlob.mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
    URL.createObjectURL = vi.fn(() => "blob:test-url");
    URL.revokeObjectURL = vi.fn();
  });

  it("shows the header with count, oldest age, policy link and the not-publish note", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row()]));
    renderQueue();

    expect(await screen.findByText("1 picture submission waiting for review")).toBeInTheDocument();
    expect(screen.getByText("Oldest submitted 2 hours ago")).toBeInTheDocument();
    const policy = screen.getByRole("link", { name: /picture policy/i });
    expect(policy).toHaveAttribute("href", PICTURE_POLICY_URL);
    expect(policy).toHaveAttribute("target", "_blank");
    expect(policy).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByText(/does not publish the item/i)).toBeInTheDocument();
  });

  it("renders the card details: alt, attribution, intent, submitter and revision", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row()]));
    renderQueue();

    expect(await screen.findByText("Which flag is this?")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Enlarge question picture" })).toBeInTheDocument();
    expect(screen.getByText("Alt text: Three vertical bands")).toBeInTheDocument();
    expect(screen.getByText("Attribution: Photo by A")).toBeInTheDocument();
    expect(screen.getByText("No explanation picture")).toBeInTheDocument();
    expect(screen.getByText(/Item visibility: Public\. Approving these pictures only clears the pictures/)).toBeInTheDocument();
    expect(screen.getByText(/Submitted by owner@example\.com/)).toBeInTheDocument();
    expect(screen.getByText("Picture revision 4")).toBeInTheDocument();
    expect(mockAdminApi.fetchItemImageBlob).toHaveBeenCalledWith("item-1", "question");
  });

  it("uses the private intent line for private items, even when ready for review", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row({ isPrivate: true, readyForReview: true })]));
    renderQueue();

    expect(await screen.findByText(/Item visibility: Private\. Approving these pictures does not make this item public\./)).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([], null));
    renderQueue();

    expect(await screen.findByText("No pictures waiting for review")).toBeInTheDocument();
  });

  it("shows an error with retry when the queue fails to load", async () => {
    mockAdminApi.getImageReviewQueue.mockRejectedValue(new Error("boom"));
    renderQueue();

    expect(await screen.findByText("Failed to load the picture review queue")).toBeInTheDocument();
  });

  it("keeps Reject disabled until a reason is typed, then sends the trimmed reason bound to the revision", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row()]));
    mockAdminApi.setImageReview.mockResolvedValue({ id: "item-1", imageReview: {} });
    renderQueue();

    const reject = await screen.findByRole("button", { name: "Reject pictures" });
    expect(reject).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason for rejection/i), "   Blurry   ");
    expect(reject).toBeEnabled();
    expect(screen.getByText("12/500")).toBeInTheDocument();

    await userEvent.click(reject);

    await waitFor(() =>
      expect(mockAdminApi.setImageReview).toHaveBeenCalledWith("item-1", {
        decision: "reject",
        expectedRevision: 4,
        reason: "Blurry",
      }),
    );
  });

  it("approves without a reason and announces the result", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row()]));
    mockAdminApi.setImageReview.mockResolvedValue({ id: "item-1", imageReview: {} });
    renderQueue();

    await screen.findByRole("button", { name: "Enlarge question picture" });
    await userEvent.click(screen.getByRole("button", { name: "Approve pictures" }));

    await waitFor(() =>
      expect(mockAdminApi.setImageReview).toHaveBeenCalledWith("item-1", {
        decision: "approve",
        expectedRevision: 4,
        reason: undefined,
      }),
    );
    expect(await screen.findByText("Pictures approved.")).toBeInTheDocument();
  });

  it("on a 409 stale conflict shows the reload message, disables actions and refetches on Reload", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row()]));
    mockAdminApi.setImageReview.mockRejectedValue(problem(409, "Item.ImageReviewStale"));
    renderQueue();

    await screen.findByRole("button", { name: "Enlarge question picture" });
    await userEvent.click(screen.getByRole("button", { name: "Approve pictures" }));

    expect(await screen.findByText("This item changed — reload")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve pictures" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject pictures" })).toBeDisabled();
    expect(screen.getByLabelText(/reason for rejection/i)).toBeDisabled();
    await waitFor(() => expect(mockAdminApi.getImageReviewQueue.mock.calls.length).toBeGreaterThan(1));

    const before = mockAdminApi.getImageReviewQueue.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(mockAdminApi.getImageReviewQueue.mock.calls.length).toBeGreaterThan(before));
  });

  it("treats a 404 on the decision like a stale item", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row()]));
    mockAdminApi.setImageReview.mockRejectedValue(problem(404, "Item.NotFound"));
    renderQueue();

    await screen.findByRole("button", { name: "Enlarge question picture" });
    await userEvent.click(screen.getByRole("button", { name: "Approve pictures" }));

    expect(await screen.findByText("This item changed — reload")).toBeInTheDocument();
  });

  it("explains an unavailable picture on approve and keeps Reject usable", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row()]));
    mockAdminApi.setImageReview.mockRejectedValue(problem(409, "Item.ImageAssetUnavailable"));
    renderQueue();

    await screen.findByRole("button", { name: "Enlarge question picture" });
    await userEvent.click(screen.getByRole("button", { name: "Approve pictures" }));

    expect(await screen.findByText("A picture is no longer available; it can't be approved.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/reason for rejection/i), "Gone");
    expect(screen.getByRole("button", { name: "Reject pictures" })).toBeEnabled();
  });

  it("shows a retryable message for other failures and keeps the typed reason", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row()]));
    mockAdminApi.setImageReview.mockRejectedValue(new Error("network"));
    renderQueue();

    await userEvent.type(await screen.findByLabelText(/reason for rejection/i), "Blurry");
    await userEvent.click(screen.getByRole("button", { name: "Reject pictures" }));

    expect(await screen.findByText("Could not save your decision. Try again.")).toBeInTheDocument();
    expect(screen.getByLabelText(/reason for rejection/i)).toHaveValue("Blurry");
  });

  it("flags a picture that failed to load and lets the reviewer retry it", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row()]));
    mockAdminApi.fetchItemImageBlob.mockRejectedValueOnce(new Error("404"));
    renderQueue();

    expect(await screen.findByText("Picture could not be loaded")).toBeInTheDocument();
    expect(await screen.findByText("Picture not loaded; reload it before deciding.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("button", { name: "Enlarge question picture" })).toBeInTheDocument();
    expect(screen.queryByText("Picture not loaded; reload it before deciding.")).not.toBeInTheDocument();
  });

  it("disables Approve while a picture is loading or failed, but keeps Reject usable", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row()]));
    let resolveBlob: (blob: Blob) => void = () => {};
    mockAdminApi.fetchItemImageBlob.mockReturnValueOnce(new Promise<Blob>((resolve) => (resolveBlob = resolve)));
    renderQueue();

    const approve = await screen.findByRole("button", { name: "Approve pictures" });
    expect(approve).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason for rejection/i), "Nope");
    expect(screen.getByRole("button", { name: "Reject pictures" })).toBeEnabled();

    resolveBlob(new Blob(["x"]));
    await waitFor(() => expect(approve).toBeEnabled());
  });

  it("keeps Approve disabled when a picture failed to load", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row()]));
    mockAdminApi.fetchItemImageBlob.mockRejectedValueOnce(new Error("404"));
    renderQueue();

    await screen.findByText("Picture could not be loaded");
    expect(screen.getByRole("button", { name: "Approve pictures" })).toBeDisabled();
  });

  it("moves focus to the next card's first button after a decision", async () => {
    const second = row({ id: "item-2", question: "Second?" });
    mockAdminApi.getImageReviewQueue
      .mockResolvedValueOnce(queue([row(), second]))
      .mockResolvedValue(queue([second]));
    mockAdminApi.setImageReview.mockResolvedValue({ id: "item-1", imageReview: {} });
    renderQueue();

    await screen.findAllByRole("button", { name: "Enlarge question picture" });
    await userEvent.click(screen.getAllByRole("button", { name: "Approve pictures" })[0]);

    await waitFor(() => expect(screen.queryByText("Which flag is this?")).not.toBeInTheDocument());
    await waitFor(() => {
      const card = document.querySelector('[data-card-id="item-2"]') as HTMLElement;
      expect(card.contains(document.activeElement)).toBe(true);
    });
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });

  it("moves focus to the Pictures tab when the last card is decided", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValueOnce(queue([row()])).mockResolvedValue(queue([], null));
    mockAdminApi.setImageReview.mockResolvedValue({ id: "item-1", imageReview: {} });
    const tab = document.createElement("button");
    tab.id = "review-board-tab-pictures";
    document.body.appendChild(tab);
    renderQueue();

    await screen.findByRole("button", { name: "Enlarge question picture" });
    await userEvent.click(screen.getByRole("button", { name: "Approve pictures" }));

    await waitFor(() => expect(tab).toHaveFocus());
    tab.remove();
  });

  it("notes when only the first page is shown", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue({ ...queue([row()]), totalCount: 40 });
    renderQueue();

    expect(await screen.findByText(/Showing the oldest 1 of 40/)).toBeInTheDocument();
    expect(screen.getByText("40 picture submissions waiting for review")).toBeInTheDocument();
  });

  it("opens the zoom dialog in-page, traps focus on Close, and closes with Escape returning focus", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row()]));
    renderQueue();

    const thumbnail = await screen.findByRole("button", { name: "Enlarge question picture" });
    await userEvent.click(thumbnail);

    const dialog = await screen.findByRole("dialog", { name: "Question picture" });
    const close = screen.getByRole("button", { name: "Close picture" });
    expect(dialog).toContainElement(close);
    await waitFor(() => expect(close).toHaveFocus());
    expect(dialog).toHaveTextContent("Alt text: Three vertical bands");
    expect(dialog).toHaveTextContent("Attribution: Photo by A");

    await userEvent.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(thumbnail).toHaveFocus();
  });

  it("revokes blob URLs when the card goes away", async () => {
    mockAdminApi.getImageReviewQueue.mockResolvedValue(queue([row()]));
    const { unmount } = renderQueue();
    await screen.findByRole("button", { name: "Enlarge question picture" });

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });
});
