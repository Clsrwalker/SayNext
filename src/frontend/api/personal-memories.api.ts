const getApiUrl = () => window.location.origin;

export type PersonalMemorySensitivity = "low" | "medium" | "high";
export type PersonalMemoryStatus = "active" | "disabled";

export interface PersonalMemory {
  id: number;
  userId: string;
  title: string;
  category: string;
  sensitivity: PersonalMemorySensitivity;
  content: string;
  usageRule: string;
  keywords: string[];
  status: PersonalMemoryStatus;
  source: string;
  sourceRef: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  contentLength: number;
}

export interface PersonalMemorySearchResult extends PersonalMemory {
  score: number;
  lexicalRank?: number;
  vectorRank?: number;
  keywordScore: number;
}

async function parseMemoryResponse(response: Response): Promise<PersonalMemory> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Personal memory request failed");
  }
  return data.memory;
}

export async function fetchPersonalMemories(userId: string, status = "all"): Promise<PersonalMemory[]> {
  const response = await fetch(
    `${getApiUrl()}/api/personal-memories?userId=${encodeURIComponent(userId)}&status=${encodeURIComponent(status)}`,
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to load personal memories");
  }
  return data.memories || [];
}

export async function createPersonalMemory(input: {
  userId: string;
  title: string;
  category: string;
  sensitivity: PersonalMemorySensitivity;
  content: string;
  usageRule?: string;
  keywords?: string[] | string;
  status?: PersonalMemoryStatus;
  source?: "manual" | "import" | "pipeline" | "knowledge";
  sourceRef?: string;
  upsertBySource?: boolean;
}): Promise<PersonalMemory> {
  const response = await fetch(`${getApiUrl()}/api/personal-memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseMemoryResponse(response);
}

export async function updatePersonalMemory(input: {
  userId: string;
  id: number;
  title?: string;
  category?: string;
  sensitivity?: PersonalMemorySensitivity;
  content?: string;
  usageRule?: string;
  keywords?: string[] | string;
  status?: PersonalMemoryStatus;
  sourceRef?: string;
}): Promise<PersonalMemory> {
  const { id, ...body } = input;
  const response = await fetch(`${getApiUrl()}/api/personal-memories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseMemoryResponse(response);
}

export async function deletePersonalMemory(userId: string, id: number): Promise<void> {
  const response = await fetch(`${getApiUrl()}/api/personal-memories/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to delete personal memory");
  }
}

export async function searchPersonalMemories(input: {
  userId: string;
  query: string;
  limit?: number;
}): Promise<PersonalMemorySearchResult[]> {
  const response = await fetch(`${getApiUrl()}/api/personal-memories/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Failed to search personal memories");
  }
  return data.memories || [];
}
