import { apiClient } from "./client";
import type {
  ItemsResponse,
  RandomItemsResponse,
  ItemResponse,
  CreateItemRequest,
  UpdateItemRequest,
} from "@/types/api";

export interface SeedExportItem {
  itemId: string;
  category: string;
  navigationKeyword1?: string;
  navigationKeyword2?: string;
  question: string;
  correctAnswer: string;
  incorrectAnswers: string[];
  explanation: string;
  keywords: string[];
  source?: string;
}

export interface UploadToCollectionResponse {
  collectionId: string;
  name: string;
  itemCount: number;
}

export const itemsApi = {
  getAll: async (
    category?: string,
    isPrivate?: boolean,
    keywords?: string[],
    collectionId?: string,
    isRandom?: boolean,
    page: number = 1,
    pageSize: number = 10,
    options?: {
      navigationKeywords?: string[];
      excludeQuestionPictures?: boolean;
    }
  ): Promise<ItemsResponse> => {
    const params: Record<string, string | number | boolean> = {
      page,
      pageSize,
    };
    if (category) params.category = category;
    if (options?.excludeQuestionPictures) params.excludeQuestionPictures = true;
    if (isPrivate !== undefined) params.isPrivate = isPrivate;
    if (keywords && keywords.length > 0) params.keywords = keywords.join(",");
    if (options?.navigationKeywords && options.navigationKeywords.length > 0) {
      params.nav = options.navigationKeywords.join(",");
    }
    if (collectionId) params.collectionId = collectionId;
    if (isRandom !== undefined) params.isRandom = isRandom;
    const response = await apiClient.get<ItemsResponse>("/items", { params });
    return response.data;
  },

  getById: async (id: string): Promise<ItemResponse> => {
    const response = await apiClient.get<ItemResponse>(`/items/${id}`);
    return response.data;
  },

  getRandom: async (
    category?: string,
    count: number = 10,
    keywords?: string[],
    options?: {
      navigationKeywords?: string[];
      excludeQuestionPictures?: boolean;
    }
  ): Promise<RandomItemsResponse> => {
    const params: Record<string, string | number | boolean> = {
      isRandom: true,
      pageSize: count,
    };
    if (category) params.category = category;
    if (options?.excludeQuestionPictures) params.excludeQuestionPictures = true;
    if (keywords && keywords.length > 0) params.keywords = keywords.join(",");
    if (options?.navigationKeywords && options.navigationKeywords.length > 0) {
      params.nav = options.navigationKeywords.join(",");
    }
    const response = await apiClient.get<ItemsResponse>("/items", {
      params,
    });
    return { items: response.data.items };
  },

  create: async (data: CreateItemRequest): Promise<ItemResponse> => {
    const response = await apiClient.post<ItemResponse>("/items", data);
    return response.data;
  },

  update: async (
    id: string,
    data: UpdateItemRequest
  ): Promise<ItemResponse> => {
    const response = await apiClient.put<ItemResponse>(`/items/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/items/${id}`);
  },

  /** Upload JSON items into a new collection. Requires category, keyword1, keyword2, keywords; inputText is the raw JSON for duplicate detection. Non-admin: private only. */
  uploadToCollection: async (data: {
    category: string;
    keyword1: string;
    keyword2: string | null;
    keywords: { name: string; isPrivate: boolean }[];
    items: Omit<CreateItemRequest, "category" | "navigationKeyword1" | "navigationKeyword2">[];
    inputText: string;
    /** Optional collection name (trimmed, max 200); omitted means a generated name. */
    collectionName?: string;
  }): Promise<UploadToCollectionResponse> => {
    const response = await apiClient.post<UploadToCollectionResponse>(
      "/items/upload-to-collection",
      data
    );
    return response.data;
  },

  setVisibility: async (
    id: string,
    isPrivate: boolean
  ): Promise<ItemResponse> => {
    const response = await apiClient.put<ItemResponse>(
      `/items/${id}/visibility`,
      { isPrivate }
    );
    return response.data;
  },

  exportItems: async (
    category: string,
    navigationKeywords: string[]
  ): Promise<SeedExportItem[]> => {
    const params: Record<string, string> = { category };
    if (navigationKeywords.length > 0) {
      params.nav = navigationKeywords.join(",");
    }
    const response = await apiClient.get<SeedExportItem[]>("/items/export", { params });
    return response.data;
  },
};
