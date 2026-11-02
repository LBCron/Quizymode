import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { installMemoryLocalStorage } from "@/test/memoryStorage";
import { renderWithProviders } from "@/features/learningLoop/learningLoopTestUtils";
import { studyPlansApi, type StudyPlanDto } from "@/api/studyPlans";
import { StudyPlanDialog, type StudyPlanDialogResult } from "./StudyPlanDialog";
import { readLocalStudyPlans } from "./localStudyPlans";
import type { CollectionPlan } from "./useStudyPlans";
import { addLocalDays } from "./studyPlanSteps";

const auth = vi.hoisted(() => ({ value: { isAuthenticated: false, isLoading: false, userId: null as string | null } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/api/studyPlans", () => ({ studyPlansApi: { list: vi.fn(), upsert: vi.fn(), remove: vi.fn() } }));

const COLLECTION_ID = "00000000-0000-4000-8000-000000000001";
const today = new Date();
const day = (offset: number) => addLocalDays(today, offset);

function dto(testDate: string): StudyPlanDto {
  return {
    collectionId: COLLECTION_ID,
    available: true,
    collectionName: "Spanish basics",
    itemCount: 10,
    testDate,
    createdAt: today.toISOString(),
    firstLearnAt: null,
    lastActivityAt: null,
  };
}

function httpError(status: number, title?: string): AxiosError {
  return new AxiosError("failed", "ERR", undefined, undefined, { status, data: { title } } as AxiosResponse);
}

const existingPlan = (testDate: string): CollectionPlan => ({
  collectionId: COLLECTION_ID,
  testDate,
  createdAt: today.toISOString(),
  itemCount: 10,
  firstLearnAt: null,
  lastActivityAt: null,
});

function Harness({
  plan = null,
  loading = false,
  onResult,
}: {
  plan?: CollectionPlan | null;
  loading?: boolean;
  onResult?: (result?: StudyPlanDialogResult) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open plan</button>
      {open && (
        <StudyPlanDialog
          collectionId={COLLECTION_ID}
          collectionName="Spanish basics"
          plan={plan}
          loading={loading}
          onClose={(result) => {
            setOpen(false);
            onResult?.(result);
          }}
        />
      )}
    </>
  );
}

function openDialog() {
  const opener = screen.getByRole("button", { name: "Open plan" });
  opener.focus();
  fireEvent.click(opener);
  return screen.getByRole("dialog", { name: "Plan for a test" });
}
const dateInput = () => screen.getByLabelText("Test date") as HTMLInputElement;
const setDate = (value: string) => fireEvent.change(dateInput(), { target: { value } });

describe("StudyPlanDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    installMemoryLocalStorage();
    auth.value = { isAuthenticated: false, isLoading: false, userId: null };
    vi.mocked(studyPlansApi.list).mockResolvedValue([]);
    vi.mocked(studyPlansApi.upsert).mockImplementation(async (_id, testDate) => dto(testDate));
    vi.mocked(studyPlansApi.remove).mockResolvedValue(undefined);
  });

  it("focuses the date input, limits it to the next 30 days and shows the collection", () => {
    renderWithProviders(<Harness />);
    const dialog = openDialog();

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Spanish basics")).toBeInTheDocument();
    expect(dateInput()).toHaveFocus();
    expect(dateInput()).toHaveAttribute("min", day(0));
    expect(dateInput()).toHaveAttribute("max", day(30));
    expect(screen.getByText("Up to 30 days from today.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove plan" })).not.toBeInTheDocument();
    expect(screen.getByText("Choose a date to see your plan.")).toBeInTheDocument();
  });

  it("closes on Escape, on the backdrop and on Cancel, returning focus to the opener", () => {
    renderWithProviders(<Harness />);
    const opener = screen.getByRole("button", { name: "Open plan" });

    openDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    const dialog = openDialog();
    fireEvent.click(dialog.parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("keeps Tab inside the dialog", () => {
    renderWithProviders(<Harness />);
    openDialog();
    const save = screen.getByRole("button", { name: "Save plan" });
    setDate(day(5));
    save.focus();

    fireEvent.keyDown(window, { key: "Tab" });

    expect(dateInput()).toHaveFocus();
  });

  it("shows the forecast for the chosen date", () => {
    renderWithProviders(<Harness />);
    openDialog();

    setDate(day(0));
    expect(screen.getByText("Today: Test day")).toBeInTheDocument();

    setDate(day(3));
    expect(screen.getByText("Today: Learn")).toBeInTheDocument();
    expect(screen.getByText(/: Review$/)).toBeInTheDocument();
    expect(screen.getByText(/: Timed practice test$/)).toBeInTheDocument();
    expect(screen.getByText(/: Test day$/)).toBeInTheDocument();
  });

  it("collapses rest days and lists at most the Today row, one rest line and the last 7 days", () => {
    renderWithProviders(<Harness />);
    openDialog();

    setDate(day(30));

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent("Today: Learn");
    expect(rows[1]).toHaveTextContent(/^Rest until /);
  });

  it.each([
    [-1, "That date has already passed. Choose today or later."],
    [31, "Choose a date within the next 30 days."],
    [null, "Choose a test date."],
  ])("rejects day offset %s with copy, aria-invalid and no API call", async (offset, message) => {
    renderWithProviders(<Harness />);
    openDialog();

    if (offset === null) setDate(day(2));
    setDate(offset === null ? "" : day(offset));

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(dateInput()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();
    fireEvent.submit(dateInput().closest("form")!);
    expect(studyPlansApi.upsert).not.toHaveBeenCalled();
  });

  it("does not show a validation error before the first interaction", () => {
    renderWithProviders(<Harness />);
    openDialog();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();
  });

  it("signed in: saves through the API, closes and reports the date", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    const onResult = vi.fn();
    renderWithProviders(<Harness onResult={onResult} />);
    openDialog();

    expect(screen.queryByText(/Saved in this browser only/)).not.toBeInTheDocument();
    setDate(day(5));
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ kind: "saved", testDate: day(5) }));
    expect(studyPlansApi.upsert).toHaveBeenCalledWith(COLLECTION_ID, day(5));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("guest: shows the browser-only note and saves locally without calling the API", async () => {
    const onResult = vi.fn();
    renderWithProviders(<Harness onResult={onResult} />);
    openDialog();

    expect(screen.getByText("Saved in this browser only. Sign in to keep your plan on all your devices.")).toBeInTheDocument();
    setDate(day(4));
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ kind: "saved", testDate: day(4) }));
    expect(studyPlansApi.upsert).not.toHaveBeenCalled();
    expect(readLocalStudyPlans()).toMatchObject([{ collectionId: COLLECTION_ID, testDate: day(4) }]);
  });

  it("prefills an existing plan and offers Remove plan, which deletes it", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    const onResult = vi.fn();
    renderWithProviders(<Harness plan={existingPlan(day(6))} onResult={onResult} />);
    openDialog();

    expect(dateInput()).toHaveValue(day(6));
    fireEvent.click(screen.getByRole("button", { name: "Remove plan" }));

    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ kind: "removed" }));
    expect(studyPlansApi.remove).toHaveBeenCalledWith(COLLECTION_ID);
  });

  it("shows the server's cap, missing-collection and network errors while keeping the dialog open and the date", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    const onResult = vi.fn();
    renderWithProviders(<Harness onResult={onResult} />);
    openDialog();
    setDate(day(5));
    const save = () => fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    vi.mocked(studyPlansApi.upsert).mockRejectedValueOnce(httpError(400, "StudyPlans.LimitReached"));
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("You can plan up to 5 tests at a time. Remove a plan from another collection first.");

    vi.mocked(studyPlansApi.upsert).mockRejectedValueOnce(httpError(404));
    save();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("This collection is no longer available, so a plan can't be saved."),
    );

    vi.mocked(studyPlansApi.upsert).mockRejectedValueOnce(new AxiosError("Network Error", "ERR_NETWORK"));
    save();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Your plan could not be saved. Check your connection and try again."),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(dateInput()).toHaveValue(day(5));
    expect(onResult).not.toHaveBeenCalled();
  });

  it("shows a removal failure and keeps the plan", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    vi.mocked(studyPlansApi.remove).mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));
    renderWithProviders(<Harness plan={existingPlan(day(6))} />);
    openDialog();

    fireEvent.click(screen.getByRole("button", { name: "Remove plan" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your plan could not be removed. Try again.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("guest cap: a sixth local plan is refused with the cap message", async () => {
    window.localStorage.setItem(
      "quizymode.study-plans.v1",
      JSON.stringify({
        version: 1,
        plans: [1, 2, 3, 4, 5].map((n) => ({
          collectionId: `00000000-0000-4000-8000-00000000010${n}`,
          testDate: day(n + 1),
          createdAt: today.toISOString(),
        })),
      }),
    );
    renderWithProviders(<Harness />);
    openDialog();

    setDate(day(5));
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You can plan up to 5 tests at a time.");
  });

  it("disables the form while saving", async () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    let finish: (value: StudyPlanDto) => void = () => undefined;
    vi.mocked(studyPlansApi.upsert).mockReturnValue(new Promise<StudyPlanDto>((resolve) => (finish = resolve)));
    renderWithProviders(<Harness />);
    openDialog();
    setDate(day(5));

    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));

    const saving = await screen.findByRole("button", { name: "Saving…" });
    expect(saving).toBeDisabled();
    expect(dateInput()).toBeDisabled();
    finish(dto(day(5)));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("signed in with an unknown plan: shows a loading state with Save disabled, then the input", () => {
    auth.value = { isAuthenticated: true, isLoading: false, userId: "user-1" };
    renderWithProviders(<Harness loading />);

    openDialog();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your plan…");
    expect(screen.queryByLabelText("Test date")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });
});
