import type { Context } from "hono";
import { conversationLogger, type SceneProfileRecord } from "../data/conversation-logger";

function serializeSceneProfile(profile: SceneProfileRecord) {
  return {
    id: profile.id,
    userId: profile.userId,
    builtinKey: profile.builtinKey,
    name: profile.name,
    prompt: profile.prompt,
    isActive: profile.isActive,
    isBuiltin: profile.isBuiltin,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    promptLength: profile.prompt.length,
  };
}

function getUserId(c: Context): string {
  return String(c.req.query("userId") || "").trim();
}

async function readJsonBody(c: Context): Promise<Record<string, any> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return null;
  }
}

export const listSceneProfiles = (c: Context) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const profiles = conversationLogger.listSceneProfiles(userId).map(serializeSceneProfile);
  return c.json({ profiles });
};

export const getSceneProfile = (c: Context) => {
  const userId = getUserId(c);
  const id = Number(c.req.param("id"));
  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid scene profile id" }, 400);

  const profile = conversationLogger.getSceneProfile(userId, id);
  if (!profile) return c.json({ error: "Scene profile not found" }, 404);

  return c.json({ profile: serializeSceneProfile(profile) });
};

export const createSceneProfile = async (c: Context) => {
  const body = await readJsonBody(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const userId = String(body.userId || "").trim();
  const name = String(body.name || "").trim();
  const prompt = String(body.prompt || "").trim();

  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!prompt) return c.json({ error: "Prompt is required" }, 400);

  const profile = conversationLogger.createSceneProfile({
    userId,
    name: name || "Custom Scene",
    prompt,
    isActive: body.isActive === true,
  });

  if (!profile) return c.json({ error: "Scene profile storage is disabled" }, 503);
  return c.json({ profile: serializeSceneProfile(profile) }, 201);
};

export const updateSceneProfile = async (c: Context) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "Invalid scene profile id" }, 400);

  const body = await readJsonBody(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const userId = String(body.userId || "").trim();
  if (!userId) return c.json({ error: "userId is required" }, 400);

  const profile = conversationLogger.getSceneProfile(userId, id);
  if (!profile) return c.json({ error: "Scene profile not found" }, 404);

  if (body.resetDefault === true) {
    const reset = conversationLogger.resetBuiltinSceneProfile(userId, id);
    if (!reset) return c.json({ error: "Only built-in scene profiles can be reset" }, 400);
    return c.json({ profile: serializeSceneProfile(reset) });
  }

  const updated = conversationLogger.updateSceneProfile(userId, id, {
    name: typeof body.name === "string" ? body.name : undefined,
    prompt: typeof body.prompt === "string" ? body.prompt : undefined,
    isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
  });

  if (!updated) return c.json({ error: "Scene profile not found" }, 404);
  return c.json({ profile: serializeSceneProfile(updated) });
};

export const deleteSceneProfile = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const body = (await readJsonBody(c)) ?? {};
  const userId = String(body.userId || c.req.query("userId") || "").trim();

  if (!userId) return c.json({ error: "userId is required" }, 400);
  if (!Number.isFinite(id)) return c.json({ error: "Invalid scene profile id" }, 400);

  const profile = conversationLogger.getSceneProfile(userId, id);
  if (!profile) return c.json({ error: "Scene profile not found" }, 404);
  if (profile.isBuiltin) return c.json({ error: "Built-in scene profiles cannot be deleted" }, 400);

  const deleted = conversationLogger.deleteSceneProfile(userId, id);
  if (!deleted) return c.json({ error: "Scene profile not found" }, 404);

  return c.json({ ok: true });
};
