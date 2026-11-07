import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mediaApi, type ImageSlotInput } from "@/api/media";
import { ImageSlotEditor } from "./ImageSlotEditor";
vi.mock("@/api/media", () => ({ mediaApi: { upload: vi.fn(), preview: vi.fn() }, mediaUploadErrorMessage: () => "Connection failed. Retry." }));
function Harness() {
  const [value, setValue] = useState<{ question: string; rationale?: string; image?: ImageSlotInput }>({ question: "Original" }); const [busy, setBusy] = useState(false);
  return <><label>Question text<input value={value.question} onChange={e => setValue({ ...value, question: e.target.value })} /></label><label>Rationale<input value={value.rationale ?? ""} onChange={e => setValue({ ...value, rationale: e.target.value })} /></label><ImageSlotEditor label="Question picture" value={value.image} onChange={image => setValue({ ...value, image })} onBusy={setBusy} /><button disabled={busy}>Save</button><output>{value.image?.assetId}</output></>;
}
describe("Normalized authoring state", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:normalized"), revokeObjectURL: vi.fn() }); });
  it("keeps edits made during upload and previews only normalized server bytes", async () => {
    let finish!: (value: Awaited<ReturnType<typeof mediaApi.upload>>) => void;
    vi.mocked(mediaApi.upload).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const normalized = new Blob(["normalized"], { type: "image/webp" }); vi.mocked(mediaApi.preview).mockResolvedValue(normalized);
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole("checkbox")); await user.upload(screen.getByLabelText(/Add picture/), new File(["source"], "private-name.png", { type: "image/png" }));
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    const question = screen.getByLabelText("Question text"); await user.clear(question); await user.type(question, "Edited while uploading"); await user.type(screen.getByLabelText("Rationale"), "Reason edited during upload");
    await act(async () => finish({ id: "asset-1", state: "Ready", width: 100, height: 50, bytes: 42, sha256: "hash" }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledWith(normalized));
    expect(question).toHaveValue("Edited while uploading"); expect(screen.getByLabelText("Rationale")).toHaveValue("Reason edited during upload"); expect(screen.getByText("asset-1")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("private-name.png");
  });
  it("requires Retry or Cancel after failure, preserving form text", async () => {
    vi.mocked(mediaApi.upload).mockRejectedValue(new Error("offline")); const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole("checkbox")); await user.upload(screen.getByLabelText(/Add picture/), new File(["source"], "image.png", { type: "image/png" }));
    await screen.findByText("Connection failed. Retry."); expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel upload" })); expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(); expect(screen.getByLabelText("Question text")).toHaveValue("Original");
  });
  it("explains answer-free alt text once a picture is attached", async () => {
    vi.mocked(mediaApi.upload).mockResolvedValue({ id: "asset-1", state: "Ready", width: 10, height: 10, bytes: 10, sha256: "h" });
    vi.mocked(mediaApi.preview).mockResolvedValue(new Blob(["x"]));
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole("checkbox")); await user.upload(screen.getByLabelText(/Add picture/), new File(["s"], "a.png", { type: "image/png" }));
    const help = await screen.findByText(/Describe the visible evidence, such as colors, pattern and labels, without giving the answer\. Do not name the country/);
    expect(screen.getByLabelText(/Short description/)).toHaveAccessibleDescription(help.textContent ?? "");
  });
  it("labels the picker Add picture when empty and Replace after upload, swapping the asset", async () => {
    vi.mocked(mediaApi.upload).mockResolvedValueOnce({ id: "asset-1", state: "Ready", width: 10, height: 10, bytes: 10, sha256: "h" }).mockResolvedValueOnce({ id: "asset-2", state: "Ready", width: 10, height: 10, bytes: 10, sha256: "h2" });
    vi.mocked(mediaApi.preview).mockResolvedValue(new Blob(["x"]));
    const user = userEvent.setup(); render(<Harness />);
    expect(screen.queryByText(/Choose or replace/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox")); await user.upload(screen.getByLabelText("Add picture (question picture)"), new File(["s"], "a.png", { type: "image/png" }));
    expect(await screen.findByText("asset-1")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Short description/), "Three bands");
    await user.upload(screen.getByLabelText("Replace (question picture)"), new File(["t"], "b.png", { type: "image/png" }));
    expect(await screen.findByText("asset-2")).toBeInTheDocument();
    expect(screen.getByLabelText(/Short description/)).toHaveValue("Three bands");
    expect(screen.queryByLabelText(/^Add picture/)).not.toBeInTheDocument();
  });
  it("removes a picture after confirmation and goes back to Add picture", async () => {
    vi.mocked(mediaApi.upload).mockResolvedValue({ id: "asset-1", state: "Ready", width: 10, height: 10, bytes: 10, sha256: "h" });
    vi.mocked(mediaApi.preview).mockResolvedValue(new Blob(["x"]));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole("checkbox")); await user.upload(screen.getByLabelText(/Add picture/), new File(["s"], "a.png", { type: "image/png" }));
    await user.click(await screen.findByRole("button", { name: "Remove picture" }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Remove picture" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Add picture/)).toBeInTheDocument();
    confirm.mockRestore();
  });
  it("keeps the picture when removal is declined", async () => {
    vi.mocked(mediaApi.upload).mockResolvedValue({ id: "asset-1", state: "Ready", width: 10, height: 10, bytes: 10, sha256: "h" });
    vi.mocked(mediaApi.preview).mockResolvedValue(new Blob(["x"]));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole("checkbox")); await user.upload(screen.getByLabelText(/Add picture/), new File(["s"], "a.png", { type: "image/png" }));
    await user.click(await screen.findByRole("button", { name: "Remove picture" }));
    expect(screen.getByText("asset-1")).toBeInTheDocument();
    confirm.mockRestore();
  });
  it("keeps the question and explanation slots independent", async () => {
    vi.mocked(mediaApi.upload).mockImplementation(async file => ({ id: `asset-${(file as File).name}`, state: "Ready", width: 10, height: 10, bytes: 10, sha256: "h" }));
    vi.mocked(mediaApi.preview).mockResolvedValue(new Blob(["x"]));
    function Two() {
      const [q, setQ] = useState<ImageSlotInput>(); const [e, setE] = useState<ImageSlotInput>();
      return <><ImageSlotEditor label="Question picture" value={q} onChange={setQ} onBusy={() => {}} /><ImageSlotEditor label="Explanation picture" value={e} onChange={setE} onBusy={() => {}} /><output data-testid="state">{`${q?.assetId ?? "-"}|${e?.assetId ?? "-"}`}</output></>;
    }
    const user = userEvent.setup(); render(<Two />);
    const question = screen.getByRole("group", { name: /Question picture/ }); const explanation = screen.getByRole("group", { name: /Explanation picture/ });
    await user.click(within(question).getByRole("checkbox")); await user.upload(within(question).getByLabelText(/Add picture/), new File(["s"], "q", { type: "image/png" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("asset-q|-"));
    await user.click(within(explanation).getByRole("checkbox")); await user.upload(within(explanation).getByLabelText(/Add picture/), new File(["s"], "e", { type: "image/png" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("asset-q|asset-e"));
    expect(within(question).getByLabelText(/^Replace/)).toBeInTheDocument(); expect(within(explanation).getByLabelText(/^Replace/)).toBeInTheDocument();
  });
});
