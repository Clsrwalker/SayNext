const getApiUrl = () => window.location.origin;

export interface PrenoteFileSummary {
  id: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  error: string;
  extractedTextLength: number;
  createdAt: string;
}

export interface Prenote {
  id: number;
  userId: string;
  title: string;
  description: string;
  status: string;
  isActive: boolean;
  sourceTextLength: number;
  extractedTextLength: number;
  runtimeContextLength: number;
  error: string;
  createdAt: string;
  updatedAt: string;
  files: PrenoteFileSummary[];
}

export async function fetchPrenotes(userId: string): Promise<Prenote[]> {
  const response = await fetch(`${getApiUrl()}/api/prenotes?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) throw new Error("Failed to fetch prenotes");
  const data = await response.json();
  return data.prenotes || [];
}

export async function createPrenote(input: {
  userId: string;
  title: string;
  description?: string;
  sourceText?: string;
  files?: FileList | File[];
  setActive?: boolean;
}): Promise<Prenote> {
  const formData = new FormData();
  formData.append("userId", input.userId);
  formData.append("title", input.title);
  formData.append("description", input.description || "");
  formData.append("sourceText", input.sourceText || "");
  formData.append("setActive", String(input.setActive ?? true));

  for (const file of Array.from(input.files || [])) {
    formData.append("files", file);
  }

  const response = await fetch(`${getApiUrl()}/api/prenotes`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to create prenote");
  }

  const data = await response.json();
  return data.prenote;
}

export async function setActivePrenote(userId: string, id: number, active = true): Promise<Prenote | null> {
  const response = await fetch(`${getApiUrl()}/api/prenotes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, active }),
  });

  if (!response.ok) throw new Error("Failed to update prenote");
  const data = await response.json();
  return data.prenote;
}

export async function deletePrenote(userId: string, id: number): Promise<void> {
  const response = await fetch(`${getApiUrl()}/api/prenotes/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) throw new Error("Failed to delete prenote");
}
