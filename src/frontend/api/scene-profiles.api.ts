const getApiUrl = () => window.location.origin;

export interface SceneProfile {
  id: number;
  userId: string;
  builtinKey: string;
  name: string;
  prompt: string;
  isActive: boolean;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
  promptLength: number;
}

async function parseProfileResponse(response: Response): Promise<SceneProfile> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Scene profile request failed');
  }
  return data.profile;
}

export async function fetchSceneProfiles(userId: string): Promise<SceneProfile[]> {
  const response = await fetch(`${getApiUrl()}/api/scene-profiles?userId=${encodeURIComponent(userId)}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load scene profiles');
  }
  return data.profiles || [];
}

export async function fetchSceneProfile(userId: string, id: number): Promise<SceneProfile> {
  const response = await fetch(`${getApiUrl()}/api/scene-profiles/${id}?userId=${encodeURIComponent(userId)}`);
  return parseProfileResponse(response);
}

export async function createSceneProfile(input: {
  userId: string;
  name: string;
  prompt: string;
  isActive?: boolean;
}): Promise<SceneProfile> {
  const response = await fetch(`${getApiUrl()}/api/scene-profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseProfileResponse(response);
}

export async function updateSceneProfile(input: {
  userId: string;
  id: number;
  name?: string;
  prompt?: string;
  isActive?: boolean;
  resetDefault?: boolean;
}): Promise<SceneProfile> {
  const { id, ...body } = input;
  const response = await fetch(`${getApiUrl()}/api/scene-profiles/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseProfileResponse(response);
}

export async function deleteSceneProfile(userId: string, id: number): Promise<void> {
  const response = await fetch(`${getApiUrl()}/api/scene-profiles/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete scene profile');
  }
}
