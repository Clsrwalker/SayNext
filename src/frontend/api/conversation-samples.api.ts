const getApiUrl = () => window.location.origin;

export interface ConversationSample {
  id: number;
  userId: string;
  sessionId: string;
  timestamp: string;
  language: string | null;
  transcript: string;
  aiReply: string | null;
  actionType: string;
  reasoning: string | null;
  model: string | null;
  profileVersion: string | null;
  retrievedSampleIds: string[];
  natural: number | null;
  short: number | null;
  fitsXiang: number | null;
  tooOfficial: boolean | null;
  directlySayable: boolean | null;
  inventedInfo: boolean | null;
  idealReply: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSampleUpdate {
  natural?: number | null;
  short?: number | null;
  fitsXiang?: number | null;
  tooOfficial?: boolean | null;
  directlySayable?: boolean | null;
  inventedInfo?: boolean | null;
  idealReply?: string;
  notes?: string;
}

export const fetchConversationSamples = async (userId: string, limit = 20): Promise<ConversationSample[]> => {
  const response = await fetch(
    `${getApiUrl()}/api/conversation-samples?userId=${encodeURIComponent(userId)}&limit=${limit}`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch conversation samples");
  }

  const data = await response.json();
  return data.samples || [];
};

export const updateConversationSample = async (
  id: number,
  updates: ConversationSampleUpdate
): Promise<ConversationSample> => {
  const response = await fetch(`${getApiUrl()}/api/conversation-samples/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    throw new Error("Failed to update conversation sample");
  }

  const data = await response.json();
  return data.sample;
};
