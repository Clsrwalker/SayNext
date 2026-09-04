import { api } from "../../routes/routes";
import { conversationLogger } from "../../data/conversation-logger";
import { evenHubV2Store } from "../../evenhub-v2/store";

const userId = process.env.EVENHUB_DEFAULT_USER_ID || "route-integration-user";

async function readResponse(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}

const invalidSettingsResponse = await api.request("/evenhub/v2/settings", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: "{invalid-json",
});

const settingsResponse = await api.request("/evenhub/v2/settings", {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    settings: {
      language: "chinese",
      cueDurationMs: "forever",
      autoPopup: false,
      showAiCue: false,
      showTranscript: true,
    },
  }),
});
const settings = await readResponse(settingsResponse);

const prenoteResponse = await api.request("/evenhub/v2/prenotes", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "Route integration note",
    text: "Use the verified project details from this prepared note.",
    selected: true,
  }),
});
const prenote = await readResponse(prenoteResponse);

const bootstrapResponse = await api.request("/evenhub/v2/bootstrap");
const bootstrap = await readResponse(bootstrapResponse);

const conversationId = "route-integration-conversation";
const otherConversationId = "other-user-conversation";
const code = [
  "function add(a: number, b: number): number {",
  "  return a + b;",
  "}",
].join("\n");

evenHubV2Store.createConversation({
  id: conversationId,
  userId,
  clientSessionId: "route-client",
  title: "Route integration conversation",
  startedAt: "2026-07-25T00:00:00.000Z",
  settings: {
    language: "chinese",
    cueDurationMs: "forever",
    autoPopup: false,
    showAiCue: false,
    showTranscript: true,
  },
  usedPrenote: {
    ids: [String(prenote.prenote.id)],
    text: prenote.prenote.text,
  },
});
evenHubV2Store.addTranscriptLine({
  id: "route-line-1",
  conversationId,
  userId,
  lineIndex: 0,
  text: "Please implement a small add function.",
  receivedAt: "2026-07-25T00:00:01.000Z",
  source: "assemblyai",
});
evenHubV2Store.createAutoCueAttempt({
  id: "route-attempt-1",
  conversationId,
  userId,
  requestId: "route-request-1",
  status: "created",
  inputHash: "route-hash-1",
  inputWindow: "Please implement a small add function.",
  sourceTranscriptLineIds: ["route-line-1"],
  promptContextSnapshot: "",
});
evenHubV2Store.createCue({
  id: "route-cue-1",
  conversationId,
  userId,
  attemptId: "route-attempt-1",
  category: "code",
  title: "Add two numbers",
  g2Title: "Add numbers",
  preview: code,
  output: code,
  language: "typescript",
  code,
  explanation: "",
  sourceTranscriptLineIds: ["route-line-1"],
  createdAt: "2026-07-25T00:00:02.000Z",
});
evenHubV2Store.createConversation({
  id: otherConversationId,
  userId: "another-user",
  clientSessionId: "other-client",
  title: "Private conversation",
  startedAt: "2026-07-25T00:00:00.000Z",
  settings: {
    language: "english",
    cueDurationMs: 10000,
    autoPopup: true,
    showAiCue: true,
    showTranscript: true,
  },
  usedPrenote: { ids: [], text: "" },
});

const updatePrenoteResponse = await api.request(`/evenhub/v2/prenotes/${prenote.prenote.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "Updated route note",
    text: "Use the updated project details after this edit.",
    selected: false,
  }),
});
const updatedPrenote = await readResponse(updatePrenoteResponse);

const selectPrenoteResponse = await api.request(`/evenhub/v2/prenotes/${prenote.prenote.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ selected: true }),
});
const selectedPrenote = await readResponse(selectPrenoteResponse);

const updatedBootstrapResponse = await api.request("/evenhub/v2/bootstrap");
const updatedBootstrap = await readResponse(updatedBootstrapResponse);

const otherPrenote = conversationLogger.createPrenote({
  userId: "another-user",
  title: "Private prenote",
  sourceText: "Private text",
});
if (!otherPrenote) throw new Error("Could not create ownership-test prenote");
conversationLogger.updatePrenoteProcessing(otherPrenote.id, {
  status: "ready",
  runtimeContext: "Private text",
  model: "manual",
});
const forbiddenPrenoteUpdateResponse = await api.request(`/evenhub/v2/prenotes/${otherPrenote.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "Do not overwrite" }),
});
const forbiddenPrenoteDeleteResponse = await api.request(`/evenhub/v2/prenotes/${otherPrenote.id}`, {
  method: "DELETE",
});

const detailResponse = await api.request(`/evenhub/v2/conversations/${conversationId}`);
const detail = await readResponse(detailResponse);
const forbiddenDetailResponse = await api.request(`/evenhub/v2/conversations/${otherConversationId}`);
const deletePrenoteResponse = await api.request(`/evenhub/v2/prenotes/${prenote.prenote.id}`, {
  method: "DELETE",
});
const deletedPrenote = await readResponse(deletePrenoteResponse);
const bootstrapAfterPrenoteDeleteResponse = await api.request("/evenhub/v2/bootstrap");
const bootstrapAfterPrenoteDelete = await readResponse(bootstrapAfterPrenoteDeleteResponse);
const deleteResponse = await api.request(`/evenhub/v2/conversations/${conversationId}`, {
  method: "DELETE",
});
const deleted = await readResponse(deleteResponse);
const missingAfterDeleteResponse = await api.request(`/evenhub/v2/conversations/${conversationId}`);
const corsResponse = await api.request("/evenhub/v2/bootstrap", {
  method: "OPTIONS",
  headers: { Origin: "https://evenhub.local" },
});

await Bun.write(Bun.stdout, `${JSON.stringify({
  invalidSettingsStatus: invalidSettingsResponse.status,
  settingsStatus: settingsResponse.status,
  settings,
  prenoteStatus: prenoteResponse.status,
  prenote,
  bootstrapStatus: bootstrapResponse.status,
  bootstrap,
  updatePrenoteStatus: updatePrenoteResponse.status,
  updatedPrenote,
  selectPrenoteStatus: selectPrenoteResponse.status,
  selectedPrenote,
  updatedBootstrapStatus: updatedBootstrapResponse.status,
  updatedBootstrap,
  forbiddenPrenoteUpdateStatus: forbiddenPrenoteUpdateResponse.status,
  forbiddenPrenoteDeleteStatus: forbiddenPrenoteDeleteResponse.status,
  deletePrenoteStatus: deletePrenoteResponse.status,
  deletedPrenote,
  bootstrapAfterPrenoteDeleteStatus: bootstrapAfterPrenoteDeleteResponse.status,
  bootstrapAfterPrenoteDelete,
  detailStatus: detailResponse.status,
  detail,
  forbiddenDetailStatus: forbiddenDetailResponse.status,
  deleteStatus: deleteResponse.status,
  deleted,
  missingAfterDeleteStatus: missingAfterDeleteResponse.status,
  corsStatus: corsResponse.status,
  corsOrigin: corsResponse.headers.get("Access-Control-Allow-Origin"),
})}\n`);
process.exit(0);
