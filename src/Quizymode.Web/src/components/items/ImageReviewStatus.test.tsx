import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ImageReviewStatus } from "./ImageReviewStatus";
import type { ItemImageReviewInfo } from "@/types/api";

function renderStatus(imageReview: ItemImageReviewInfo | null | undefined) {
  return render(
    <MemoryRouter>
      <ImageReviewStatus itemId="item-1" imageReview={imageReview} />
    </MemoryRouter>,
  );
}

describe("ImageReviewStatus", () => {
  it("renders nothing without a review state", () => {
    const { container } = renderStatus(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows pending, approved and withdrawn text", () => {
    const { unmount } = renderStatus({ state: "PendingReview", revision: 1 });
    expect(screen.getByText("Pictures: Pending review")).toBeInTheDocument();
    unmount();
    const second = renderStatus({ state: "Approved", revision: 1 });
    expect(screen.getByText("Pictures: Approved")).toBeInTheDocument();
    second.unmount();
    renderStatus({ state: "Withdrawn", revision: 1 });
    expect(screen.getByText("Pictures: Withdrawn")).toBeInTheDocument();
  });

  it("shows the rejection reason and an Edit to resubmit link", () => {
    renderStatus({ state: "Rejected", revision: 2, reason: "Unclear source" });
    expect(screen.getByText("Pictures: Rejected — Unclear source")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit to resubmit" })).toHaveAttribute("href", "/items/item-1/edit");
    // The full reason is not clamped and the link sits on its own line, outside the reason text.
    expect(screen.getByText("Pictures: Rejected — Unclear source").className).not.toContain("line-clamp");
    expect(screen.getByText("Pictures: Rejected — Unclear source")).not.toContainElement(screen.getByRole("link", { name: "Edit to resubmit" }));
  });

  it("omits the dash when a rejection has no reason", () => {
    renderStatus({ state: "Rejected", revision: 2, reason: null });
    expect(screen.getByText("Pictures: Rejected")).toBeInTheDocument();
  });
});
