import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/features/learningLoop/learningLoopTestUtils";
import { StudyPlanTodayCard } from "./StudyPlanTodayCard";
import type { PlanView } from "./useStudyPlans";
import { addLocalDays } from "./studyPlanSteps";

const ID = "00000000-0000-4000-8000-000000000001";
const originalTz = process.env.TZ;

// 09:00 on Mon Nov 2, 2026 in Auckland (already Nov 1 in UTC).
let now: Date;
const day = (offset: number) => addLocalDays(now, offset);
const earlier = () => new Date(2026, 10, 1, 10).toISOString();
const today = () => new Date(2026, 10, 2, 8).toISOString();

function plan(overrides: Partial<PlanView> = {}): PlanView {
  return {
    collectionId: ID,
    available: true,
    collectionName: "Spanish basics",
    itemCount: 20,
    testDate: day(5),
    createdAt: new Date(2026, 10, 1).toISOString(),
    firstLearnAt: null,
    lastActivityAt: null,
    ...overrides,
  };
}

function renderCard(view: PlanView, { isGuest = false, onRemove = vi.fn() } = {}) {
  return renderWithProviders(<StudyPlanTodayCard plan={view} isGuest={isGuest} onRemove={onRemove} now={now} />);
}

describe("StudyPlanTodayCard", () => {
  beforeEach(() => {
    process.env.TZ = "Pacific/Auckland";
    now = new Date(2026, 10, 2, 9);
  });
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("learn step: names the collection and countdown, estimates minutes and links to Learn", () => {
    renderCard(plan({ itemCount: 10 }));

    const link = screen.getByRole("link", { name: /Learn the basics/ });
    expect(link).toHaveAttribute("href", `/learn/collections/${ID}/spanish+basics`);
    expect(link).toHaveTextContent("Spanish basics · Test in 5 days");
    expect(link).toHaveTextContent("About 5 min. Go through the new questions.");
    expect(link).toHaveTextContent("Learn");
  });

  it("review step: signed-in copy mentions the Review queue, guest copy does not", () => {
    const learned = plan({ firstLearnAt: earlier(), lastActivityAt: earlier() });
    const { unmount } = renderCard(learned);
    const link = screen.getByRole("link", { name: /Practice quiz/ });
    expect(link).toHaveAttribute("href", `/quiz/collections/${ID}/spanish+basics`);
    expect(link).toHaveTextContent("About 7 min. Misses go to your Review queue.");
    unmount();

    renderCard(learned, { isGuest: true });
    expect(screen.getByRole("link", { name: /Practice quiz/ })).toHaveTextContent("About 7 min. Quiz yourself on the full set.");
  });

  it("practice test day before: opens Test mode and offers Learn first only when not learned", () => {
    const { unmount } = renderCard(plan({ testDate: day(1) }));
    expect(screen.getByRole("link", { name: /Timed practice test/ })).toHaveAttribute("href", `/quiz/collections/${ID}/spanish+basics?mode=test`);
    expect(screen.getByRole("link", { name: /Timed practice test/ })).toHaveTextContent("Test tomorrow");
    expect(screen.getByRole("link", { name: "Learn first: Spanish basics" })).toHaveAttribute("href", `/learn/collections/${ID}/spanish+basics`);
    unmount();

    renderCard(plan({ testDate: day(1), firstLearnAt: earlier() }));
    expect(screen.queryByRole("link", { name: /Learn first/ })).not.toBeInTheDocument();
  });

  it("never nests links: the secondary pill is a sibling of the primary link", () => {
    const { container } = renderCard(plan({ testDate: day(1) }));

    expect(container.querySelectorAll("a a")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(2);
  });

  it("test day: Good luck, a warm up pill and no done state even after activity", () => {
    renderCard(plan({ testDate: day(0), firstLearnAt: earlier(), lastActivityAt: today() }));

    expect(screen.getByText("Test day. Good luck!")).toBeInTheDocument();
    expect(screen.getByText(/Test today/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Warm up: Spanish basics" })).toHaveAttribute("href", `/explore/collections/${ID}/spanish+basics`);
    expect(screen.queryByText(/Done for today/)).not.toBeInTheDocument();
  });

  it("rest day: names the next step and offers Review anyway, which does not mark the day done", () => {
    renderCard(plan({ testDate: day(10), firstLearnAt: earlier(), lastActivityAt: today() }));

    expect(screen.getByText("Rest day")).toBeInTheDocument();
    expect(screen.getByText(/^Next step: .+\. Nothing to do today\.$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review anyway: Spanish basics" })).toHaveAttribute("href", `/quiz/collections/${ID}/spanish+basics`);
    expect(screen.queryByText(/Done for today/)).not.toBeInTheDocument();
  });

  it("done today: shows what comes tomorrow and Practice again to today's step", () => {
    renderCard(plan({ testDate: day(2), firstLearnAt: earlier(), lastActivityAt: today() }));

    expect(screen.getByText("Done for today ✓")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow: Timed practice test.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Practice again: Spanish basics" })).toHaveAttribute("href", `/quiz/collections/${ID}/spanish+basics`);
  });

  it("a Learn run just before local midnight does not make today done", () => {
    now = new Date(2026, 10, 3, 0, 10);
    renderCard(plan({ testDate: day(4), firstLearnAt: new Date(2026, 10, 2, 23, 50).toISOString(), lastActivityAt: new Date(2026, 10, 2, 23, 50).toISOString() }));

    expect(screen.queryByText(/Done for today/)).not.toBeInTheDocument();
    expect(screen.getByText("Practice quiz")).toBeInTheDocument();
  });

  it("empty collection: says so and links to the collection", () => {
    renderCard(plan({ itemCount: 0 }));

    const link = screen.getByRole("link", { name: /Nothing to study yet/ });
    expect(link).toHaveAttribute("href", `/collections/${ID}/spanish+basics`);
    expect(link).toHaveTextContent("This collection has no questions yet.");
  });

  it("estimates at least one minute", () => {
    renderCard(plan({ itemCount: 1 }));

    expect(screen.getByRole("link", { name: /Learn the basics/ })).toHaveTextContent("About 1 min.");
  });

  it("unavailable collection: names no collection and offers Remove plan", () => {
    const onRemove = vi.fn();
    renderCard(plan({ available: false, collectionName: null, itemCount: 0 }), { onRemove });

    expect(screen.getByText(/Unknown collection · Test in 5 days/)).toBeInTheDocument();
    expect(screen.getByText("This collection is no longer available.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove test plan for this collection" }));
    expect(onRemove).toHaveBeenCalledWith(ID);
  });

  it("renders nothing once the test date has passed", () => {
    const { container } = renderCard(plan({ testDate: day(-1) }));

    expect(container).toBeEmptyDOMElement();
  });

  it("counts down to a date more than a week out with the weekday and date", () => {
    renderCard(plan({ testDate: day(12) }));

    expect(within(screen.getByRole("link", { name: /Learn the basics/ })).getByText(/Test on \w+, \w+ 14/)).toBeInTheDocument();
  });
});
