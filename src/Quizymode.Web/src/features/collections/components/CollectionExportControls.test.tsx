import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollectionExportControls } from "./CollectionExportControls";
import * as exportFormats from "../utils/exportFormats";
import type { ExportableItem } from "../utils/exportFormats";

const picture = { key: "curated:flags/fr", altText: "Three bands" };
const diagram = { key: "curated:diagrams/x", altText: "A diagram" };

const text = (question: string): ExportableItem => ({ question, correctAnswer: "A", incorrectAnswers: ["B"], explanation: "E" });
const flag = (question: string): ExportableItem => ({ ...text(question), questionImage: picture });
const diagramOnly = (question: string): ExportableItem => ({ ...text(question), explanationImage: diagram });

function renderControls(items: ExportableItem[]) {
  return render(
    <CollectionExportControls items={items} collectionName="Mixed" hideAnswers={false} onHideAnswersChange={vi.fn()} />,
  );
}

describe("CollectionExportControls picture choice (#403)", () => {
  let download: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    download = vi.spyOn(exportFormats, "downloadTextFile").mockImplementation(() => undefined);
  });

  it("requires acknowledgement when only explanation pictures would be lost", async () => {
    const user = userEvent.setup();
    renderControls([text("one"), diagramOnly("two")]);

    await user.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: /I understand pictures/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Download CSV" }));
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("asks first when picture questions exist: default skips them and exports the rest", async () => {
    const user = userEvent.setup();
    renderControls([text("plain one"), flag("flag one"), flag("flag two")]);

    await user.click(screen.getByRole("button", { name: "Download TSV" }));

    const dialog = screen.getByRole("dialog", { name: "Some questions have pictures" });
    expect(download).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/2 of 3 questions include a picture/)).toBeInTheDocument();
    expect(within(dialog).getByRole("radiogroup", { name: "Export options" })).toBeInTheDocument();
    const skip = within(dialog).getByRole("radio", { name: /Skip 2 picture questions/ });
    expect(skip).toBeChecked();
    expect(skip).toHaveFocus();
    expect(within(dialog).getByText("Export the other 1 question.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Download TSV" }));

    expect(download).toHaveBeenCalledTimes(1);
    const content = download.mock.calls[0][1] as string;
    expect(content).toContain("plain one");
    expect(content).not.toContain("flag one");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Downloaded 1 question. 2 picture questions skipped.");
  });

  it("gates the text-only export behind the acknowledgement checkbox", async () => {
    const user = userEvent.setup();
    renderControls([text("plain one"), flag("flag one")]);
    await user.click(screen.getByRole("button", { name: "Download CSV" }));
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("radio", { name: /Export text only/ }));
    const primary = within(dialog).getByRole("button", { name: "Download CSV" });
    expect(primary).toBeDisabled();
    expect(within(dialog).getByText("Tick the box to continue.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("checkbox", { name: /pictures won't be in this file/ }));
    expect(primary).toBeEnabled();
    await user.click(primary);

    expect((download.mock.calls[0][1] as string)).toContain("flag one");
    expect(screen.getByRole("status")).toHaveTextContent("Downloaded 2 questions as text only.");
  });

  it("explains when every question has a picture and skipping would export nothing", async () => {
    const user = userEvent.setup();
    renderControls([flag("flag one"), flag("flag two")]);
    await user.click(screen.getByRole("button", { name: "Quizlet text" }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByRole("button", { name: "Download Quizlet text" })).toBeDisabled();
    expect(within(dialog).getByText(/Every question here has a picture, so there is nothing to export as text/)).toBeInTheDocument();
  });

  it("mentions explanation pictures when some items also have them", async () => {
    const user = userEvent.setup();
    renderControls([flag("flag one"), diagramOnly("diagram one"), text("plain")]);
    await user.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(screen.getByText(/Explanation pictures are not included either\./)).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 questions include a picture/)).toBeInTheDocument();
  });

  it("returns focus to the invoking button on Cancel and Escape without downloading", async () => {
    const user = userEvent.setup();
    renderControls([flag("flag one"), text("plain")]);
    const invoke = screen.getByRole("button", { name: "Download CSV" });

    await user.click(invoke);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invoke).toHaveFocus();

    await user.click(invoke);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invoke).toHaveFocus();
    expect(download).not.toHaveBeenCalled();
  });

  it("never asks for Print", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderControls([flag("flag one")]);
    await user.click(screen.getByRole("button", { name: "Print" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(print).toHaveBeenCalled();
  });
});
