import { apiClient } from "./client";

/** GET /users/me/topic-activity (#385): the signed-in user's own L1 topic roll-up of the last 30 days. */
export interface TopicActivityTopic {
  path: string;
  runs: number;
  lastCompletedAt: string;
}

export interface TopicActivityResponse {
  windowDays: number;
  topics: TopicActivityTopic[];
}

export const topicActivityApi = {
  get: async (): Promise<TopicActivityResponse> => {
    const response = await apiClient.get<TopicActivityResponse>("/users/me/topic-activity");
    return response.data;
  },
};
