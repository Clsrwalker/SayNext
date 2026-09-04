import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.SAYNEXT_DB_PATH = join(mkdtempSync(join(tmpdir(), 'saynext-transport-audit-')), 'isolated.sqlite');
process.env.DATA_LOGGING_ENABLED = 'true';
process.env.EVENHUB_DEFAULT_USER_ID = 'audit-isolated-default';
process.env.EVENHUB_V2_ALLOW_QUERY_USER_ID = 'false';
process.env.EVENHUB_V2_RELAY_TOKEN = 'audit-non-secret-placeholder';
const { api } = await import('../src/server/routes/routes');
const { AppServer } = await import('@mentra/sdk');
const { EvenHubV2Runtime } = await import('../src/server/evenhub-v2/runtime');
const { EvenHubV2Store } = await import('../src/server/evenhub-v2/store');
const { createEvenHubV2ClientMessage: msg } = await import('../src/server/evenhub-v2/protocol');
const { evenHubV2WebSocket, tryUpgradeEvenHubV2WebSocket } = await import('../src/server/evenhub-v2/ws');
const app = new AppServer({ packageName:'audit.transport.local', apiKey:'audit-placeholder', cookieSecret:'audit-placeholder', publicDir:false });
app.route('/api', api);
const bootstrap = await app.request('/api/evenhub/v2/bootstrap', {headers:{Origin:'https://untrusted.example'}});
const settings = await app.request('/api/evenhub/v2/settings', { method:'PATCH', headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'}, body:JSON.stringify({language:'chinese'}) });
const wsRejected = tryUpgradeEvenHubV2WebSocket(new Request('http://localhost/api/evenhub/v2/ws?sessionId=audit'), { upgrade:()=>true });
const result:any = { unauthenticatedBootstrap:bootstrap.status, unauthenticatedSettingsWriteWithRelayTokenConfigured:settings.status, corsOrigin:bootstrap.headers.get('access-control-allow-origin'), websocketWithoutToken:wsRejected?.status };
function makeRuntime() {
  const store = new EvenHubV2Store(':memory:');
  const sent:any[] = [];
  const lifecycle = {closed:0, providerEnded:0};
  const runtime = new EvenHubV2Runtime({userId:'audit',clientSessionId:'session',send:m=>sent.push(m),store,summaryRunner:{queueSummary:()=>undefined,enqueue:()=>undefined},sttAdapterFactory:()=>({provider:'audit',start:async()=>{},pushAudio:()=>{},stop:async()=>{},close:()=>{lifecycle.closed++;}}),autoCueGenerator:{generate:async()=>{throw new Error('Unexpected external work');},startSession:async()=>({providerConversationId:'fake-provider',promptVersion:'v1',interviewGuideVersion:'v1'}),endSession:async()=>{lifecycle.providerEnded++;}},contextAdapter:{build:async()=>({contextSnapshot:'',memoryUsedIds:[],interviewAnswerCardIds:[],answerPolicyCardIds:[],prenoteUsedIds:[]})},cueOpportunityRouter:null,debounceMs:60000,finalFlushTimeoutMs:0});
  return {runtime,store,sent,lifecycle};
}
{
 const {runtime,store,lifecycle}=makeRuntime();
 await runtime.handleClientMessage(msg('conversation_start',{}));
 const id=runtime.activeConversationId!;
 await Promise.resolve();
 await runtime.close();
 result.afterRuntimeClose={status:store.getConversation(id)?.status,endedAt:store.getConversation(id)?.endedAt,summary:store.getSummary(id),...lifecycle};
 store.close();
}
{
 const {runtime,store}=makeRuntime();
 await runtime.handleClientMessage(msg('conversation_start',{}));
 const id=runtime.activeConversationId!;
 runtime.detachClient();
 await runtime.handleClientMessage(msg('debug_transcript',{text:'This transcript arrived during the connection gap.',isFinal:true}));
 const recovered:any[]=[];
 runtime.attachClient(m=>recovered.push(m),'new');
 runtime.handleOpen();
 result.reconnectReplay={storedTranscriptCount:store.getConversationDetail(id)?.transcript.length,receivedMessageTypes:recovered.map(m=>m.type)};
 await runtime.close(); store.close();
}
{
 const {runtime,store}=makeRuntime();
 await runtime.handleClientMessage(msg('conversation_start',{}));
 const id=runtime.activeConversationId!;
 runtime.attachClient(()=>{},'new-connection');
 const staleWs:any={data:{kind:'evenhub-v2',userId:'audit',clientSessionId:'session',connId:'old-connection',runtime},send:()=>{},close:()=>{}};
 evenHubV2WebSocket.message(staleWs,JSON.stringify(msg('conversation_end',{}, {conversationId:'different-conversation'})));
 await new Promise(r=>setTimeout(r,30));
 result.staleSocketWithWrongConversationId={status:store.getConversation(id)?.status};
 await runtime.close(); store.close();
}
{
 const {runtime,store}=makeRuntime();
 await runtime.handleClientMessage(msg('conversation_start',{}));
 const id=runtime.activeConversationId!;
 const deleted=store.deleteConversation('audit',id);
 let error='';
 try { await runtime.handleClientMessage(msg('debug_transcript',{text:'A final transcript after an active conversation was deleted.',isFinal:true})); } catch(e) { error=String(e); }
 result.deleteActiveConversation={deleted,runtimeStatus:runtime.snapshot.conversationStatus,error};
 await runtime.close(); store.close();
}
console.log('AUDIT_RESULT='+JSON.stringify(result));
process.exit(0);
