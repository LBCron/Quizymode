import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCreateDocumentFormData, studyGuideDocumentsApi } from "./studyGuideDocuments";

const { mockGet, mockPost, mockPut } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPut: vi.fn(),
}));

vi.mock("./client", () => ({
  apiClient: {
    get: mockGet,
    post: mockPost,
    put: mockPut,
  },
}));

describe("studyGuideDocumentsApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("setPrimarySource calls PUT /study-guides/documents/{id}/primary-source", async () => {
    mockPut.mockResolvedValueOnce({ data: { id: "d1", isPrimarySource: true } });
    const result = await studyGuideDocumentsApi.setPrimarySource("d1", true);
    expect(mockPut).toHaveBeenCalledWith("/study-guides/documents/d1/primary-source", { isPrimarySource: true });
    expect(result.isPrimarySource).toBe(true);
  });

  it("getConfig calls GET /study-guides/documents/config", async () => {
    mockGet.mockResolvedValueOnce({ data: { enabled: true } });
    const result = await studyGuideDocumentsApi.getConfig();
    expect(mockGet).toHaveBeenCalledWith("/study-guides/documents/config");
    expect(result.enabled).toBe(true);
  });

  it("create posts multipart form data with a file and repeated keywords", async () => {
    mockPost.mockResolvedValueOnce({ data: { id: "d1", isDuplicate: false } });
    const file = new File(["%PDF"], "unit.pdf", { type: "application/pdf" });

    const result = await studyGuideDocumentsApi.create({
      file,
      title: " Unit 1 ",
      category: "science",
      navigationKeyword1: "biology",
      navigationKeyword2: "cells",
      keywords: ["exam", "unit-1"],
    });

    expect(result.id).toBe("d1");
    const [url, body, options] = mockPost.mock.calls[0];
    expect(url).toBe("/study-guides/documents");
    expect(options).toEqual({ headers: { "Content-Type": "multipart/form-data" } });
    const form = body as FormData;
    expect(form.get("file")).toBeInstanceOf(File);
    expect((form.get("file") as File).name).toBe("unit.pdf");
    expect(form.get("text")).toBeNull();
    expect(form.get("title")).toBe("Unit 1");
    expect(form.get("category")).toBe("science");
    expect(form.get("navigationKeyword1")).toBe("biology");
    expect(form.get("navigationKeyword2")).toBe("cells");
    expect(form.getAll("keywords")).toEqual(["exam", "unit-1"]);
  });

  it("buildCreateDocumentFormData sends pasted text without a file or blank title", () => {
    const form = buildCreateDocumentFormData({
      text: "notes",
      title: "  ",
      category: "science",
      navigationKeyword1: "biology",
      navigationKeyword2: "cells",
    });
    expect(form.get("file")).toBeNull();
    expect(form.get("text")).toBe("notes");
    expect(form.get("title")).toBeNull();
    expect(form.getAll("keywords")).toEqual([]);
  });

  it("list, get, generate and accept call the document endpoints", async () => {
    mockGet.mockResolvedValue({ data: {} });
    mockPost.mockResolvedValue({ data: {} });

    await studyGuideDocumentsApi.list();
    await studyGuideDocumentsApi.get("d 1");
    await studyGuideDocumentsApi.generate("d1", ["s1", "s2"]);
    await studyGuideDocumentsApi.accept("d1", [{ id: "c1" }, { id: "c2", question: "Edited?" }]);

    expect(mockGet).toHaveBeenCalledWith("/study-guides/documents");
    expect(mockGet).toHaveBeenCalledWith("/study-guides/documents/d%201");
    expect(mockPost).toHaveBeenCalledWith("/study-guides/documents/d1/generate", { sectionIds: ["s1", "s2"] });
    expect(mockPost).toHaveBeenCalledWith("/study-guides/documents/d1/accept", {
      candidates: [{ id: "c1" }, { id: "c2", question: "Edited?" }],
    });
  });

  it("accept sends publish only when true, alongside the collection name", async () => {
    mockPost.mockResolvedValue({ data: {} });

    await studyGuideDocumentsApi.accept("d1", [{ id: "c1" }], "Name", true);
    await studyGuideDocumentsApi.accept("d1", [{ id: "c1" }], undefined, false);

    expect(mockPost).toHaveBeenNthCalledWith(1, "/study-guides/documents/d1/accept", {
      candidates: [{ id: "c1" }],
      collectionName: "Name",
      publish: true,
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, "/study-guides/documents/d1/accept", {
      candidates: [{ id: "c1" }],
    });
  });
});
