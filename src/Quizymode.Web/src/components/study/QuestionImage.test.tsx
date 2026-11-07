import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuestionImage, STUCK_AFTER_MS } from "./QuestionImage";

vi.mock("@/media/curatedImages", () => ({
  resolveCuratedImage: (key: string) => (key === "curated:flags/fr" ? "/assets/m/fr.webp" : null),
}));

const image = { key: "curated:flags/fr", altText: "Three vertical bands: blue, white, red" };

describe("QuestionImage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing without an image", () => {
    const { container } = render(<QuestionImage image={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("uses the altText as the img alt, never shows it as a caption and sets no title", () => {
    render(<QuestionImage image={image} />);
    const img = screen.getByAltText(image.altText);
    expect(img).toHaveAttribute("src", "/assets/m/fr.webp");
    expect(img).not.toHaveAttribute("title");
    expect(img).toHaveAttribute("loading", "eager");
    expect(screen.queryByText(image.altText)).not.toBeInTheDocument();
  });

  it("keeps a static narrow-screen layout guard: reserved 3:2 box, fluid width, uncropped image, no fixed pixel widths", () => {
    // Static class check only: jsdom has no layout, so a real 375px / 200% zoom browser run is still required (#403 criterion 8).
    render(<QuestionImage image={image} />);
    const box = screen.getByTestId("question-image");
    expect(box.className).toMatch(/aspect-\[3\/2\]|aspect-3\/2/);
    expect(box.className).toContain("w-full");
    expect(box.className).not.toMatch(/(?:^|\s)(?:min-)?w-\[\d+px\]/);
    expect(box.parentElement?.className).toContain("max-w-md");
    expect(box.parentElement?.className).toContain("w-full");
    expect(screen.getByAltText(image.altText).className).toContain("object-contain");
  });

  it("is busy with a status message until the picture loads", () => {
    render(<QuestionImage image={image} />);
    expect(screen.getByTestId("question-image")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading picture");

    fireEvent.load(screen.getByAltText(image.altText));

    expect(screen.getByTestId("question-image")).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByText("Loading picture")).not.toBeInTheDocument();
  });

  it("shows an error with Retry when the picture fails, and Retry remounts the image and focuses the box", async () => {
    const user = userEvent.setup();
    render(<QuestionImage image={image} />);
    const first = screen.getByAltText(image.altText);
    fireEvent.error(first);

    expect(screen.getByText("Picture couldn't load")).toBeInTheDocument();
    expect(screen.queryByAltText(image.altText)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry loading picture" }));

    const second = screen.getByAltText(image.altText);
    expect(second).not.toBe(first);
    expect(second).toHaveAttribute("src", "/assets/m/fr.webp?r=1");
    expect(screen.getByTestId("question-image")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("question-image")).toHaveFocus();
  });

  it("explains an unknown key without a Retry button", () => {
    render(<QuestionImage image={{ key: "curated:flags/zz", altText: "Something" }} />);
    expect(screen.getByText("Picture isn't available")).toBeInTheDocument();
    expect(screen.queryByTestId("question-image-retry")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("never renders a hostile key as an image source", () => {
    render(<QuestionImage image={{ key: "https://evil/x.webp", altText: "Evil" }} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("Picture isn't available")).toBeInTheDocument();
  });

  it("renders thumbnails lazily and with icon-only errors", () => {
    render(<QuestionImage image={image} size="sm" />);
    const img = screen.getByAltText(image.altText);
    expect(img).toHaveAttribute("loading", "lazy");
    expect(screen.queryByText("Loading picture")).not.toBeInTheDocument();

    fireEvent.error(img);

    expect(screen.getByRole("img", { name: "Picture couldn't load" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers Enlarge only for a loaded lg picture, never for thumbnails", () => {
    const { rerender } = render(<QuestionImage image={image} />);
    expect(screen.queryByRole("button", { name: "Enlarge picture" })).not.toBeInTheDocument();
    fireEvent.load(screen.getByAltText(image.altText));
    const enlarge = screen.getByRole("button", { name: "Enlarge picture" });
    expect(enlarge).toHaveAttribute("aria-haspopup", "dialog");
    expect(enlarge).toHaveClass("h-11", "w-11");
    expect(enlarge.contains(screen.getByAltText(image.altText))).toBe(false);

    rerender(<QuestionImage image={image} size="sm" />);
    expect(screen.queryByRole("button", { name: "Enlarge picture" })).not.toBeInTheDocument();
  });

  it("mounts no dialog until Enlarge is used, then opens one with the alt text and returns focus on Escape and Close", async () => {
    const user = userEvent.setup();
    render(<QuestionImage image={image} />);
    fireEvent.load(screen.getByAltText(image.altText));
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    const enlarge = screen.getByRole("button", { name: "Enlarge picture" });
    await user.click(enlarge);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Picture");
    // Portalled to the body so a backdrop-filter ancestor cannot misplace it.
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(screen.getAllByAltText(image.altText)).toHaveLength(2);
    expect(screen.getAllByText(image.altText)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(enlarge).toHaveFocus();

    await user.click(enlarge);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(enlarge).toHaveFocus();
  });

  it("closes the zoom on a backdrop click but not on a click inside the panel, and keeps Tab inside", async () => {
    const user = userEvent.setup();
    render(<QuestionImage image={image} />);
    fireEvent.load(screen.getByAltText(image.altText));
    await user.click(screen.getByRole("button", { name: "Enlarge picture" }));
    const dialog = screen.getByRole("dialog");

    await user.click(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    await user.click(dialog.parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the zoom from a pointer click on the picture too", async () => {
    const user = userEvent.setup();
    render(<QuestionImage image={image} />);
    fireEvent.load(screen.getByAltText(image.altText));
    await user.click(screen.getByTestId("question-image"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("reports loading, loaded, error and unknown through onStatusChange", () => {
    const onStatusChange = vi.fn();
    const { unmount } = render(<QuestionImage image={image} onStatusChange={onStatusChange} />);
    expect(onStatusChange).toHaveBeenLastCalledWith("loading");
    fireEvent.load(screen.getByAltText(image.altText));
    expect(onStatusChange).toHaveBeenLastCalledWith("loaded");
    unmount();

    const failing = vi.fn();
    const second = render(<QuestionImage image={image} onStatusChange={failing} />);
    fireEvent.error(screen.getByAltText(image.altText));
    expect(failing).toHaveBeenLastCalledWith("error");
    second.unmount();

    const unknown = vi.fn();
    render(<QuestionImage image={{ key: "curated:flags/zz", altText: "x" }} onStatusChange={unknown} />);
    expect(unknown).toHaveBeenLastCalledWith("unknown");
  });

  it("offers Skip next to Retry on a failure, and Skip alone for an unknown key", async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    const { unmount } = render(<QuestionImage image={image} onSkip={onSkip} />);
    fireEvent.error(screen.getByAltText(image.altText));
    expect(screen.getByText(/Answers are off until the picture shows/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry loading picture" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip question (not scored)" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    unmount();

    render(<QuestionImage image={{ key: "curated:flags/zz", altText: "x" }} onSkip={onSkip} />);
    expect(screen.queryByRole("button", { name: "Retry loading picture" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip question (not scored)" })).toBeInTheDocument();
  });

  describe("stuck loading", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("turns into a retryable failure after the limit, restarts on Retry and recovers on a late load", () => {
      const onStatusChange = vi.fn();
      render(<QuestionImage image={image} onStatusChange={onStatusChange} onSkip={vi.fn()} />);

      act(() => {
        vi.advanceTimersByTime(STUCK_AFTER_MS - 1);
      });
      expect(onStatusChange).not.toHaveBeenCalledWith("stuck");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(onStatusChange).toHaveBeenLastCalledWith("stuck");
      expect(screen.getByText("Picture is taking too long to load")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Skip question (not scored)" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Retry loading picture" }));
      expect(onStatusChange).toHaveBeenLastCalledWith("loading");
      act(() => {
        vi.advanceTimersByTime(STUCK_AFTER_MS);
      });
      expect(onStatusChange).toHaveBeenLastCalledWith("stuck");

      fireEvent.load(screen.getByAltText(image.altText));
      expect(onStatusChange).toHaveBeenLastCalledWith("loaded");
      expect(screen.queryByText("Picture is taking too long to load")).not.toBeInTheDocument();
    });

    it("never times out an explanation picture", () => {
      render(<QuestionImage image={image} slot="explanation" />);
      act(() => {
        vi.advanceTimersByTime(STUCK_AFTER_MS * 3);
      });
      expect(screen.queryByText("Picture is taking too long to load")).not.toBeInTheDocument();
    });
  });

  it("renders the explanation slot under its own test id, with Retry but never Skip", async () => {
    const user = userEvent.setup();
    render(<QuestionImage image={image} slot="explanation" onSkip={vi.fn()} />);
    expect(screen.getByTestId("explanation-image")).toBeInTheDocument();
    expect(screen.queryByTestId("question-image")).not.toBeInTheDocument();
    fireEvent.error(screen.getByAltText(image.altText));
    expect(screen.queryByText(/Answers are off/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Skip question/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry loading picture" }));
    expect(screen.getByAltText(image.altText)).toBeInTheDocument();
  });
});
