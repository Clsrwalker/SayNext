import { conversationLogger } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";
const builtinKey = process.argv[3] || "daily_chat";

const profile = conversationLogger
  .listSceneProfiles(userId)
  .find((item) => item.builtinKey === builtinKey);

if (!profile) {
  console.error(`Builtin scene profile was not found: user=${userId} builtinKey=${builtinKey}`);
  process.exit(1);
}

const reset = conversationLogger.resetBuiltinSceneProfile(userId, profile.id);
if (!reset) {
  console.error(`Failed to reset builtin scene profile: user=${userId} builtinKey=${builtinKey}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  userId,
  id: reset.id,
  name: reset.name,
  builtinKey: reset.builtinKey,
  isActive: reset.isActive,
  promptLength: reset.prompt.length,
}, null, 2));
