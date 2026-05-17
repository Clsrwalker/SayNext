import { conversationLogger } from "../src/server/data/conversation-logger";

const userId = process.argv[2] || "li2897283405@gmail.com";

const dailyChat = conversationLogger
  .listSceneProfiles(userId)
  .find((profile) => profile.builtinKey === "daily_chat");

if (!dailyChat) {
  console.error(`Daily Chat builtin scene profile was not found for user: ${userId}`);
  process.exit(1);
}

const reset = conversationLogger.resetBuiltinSceneProfile(userId, dailyChat.id);
if (!reset) {
  console.error(`Failed to reset Daily Chat scene profile for user: ${userId}`);
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
