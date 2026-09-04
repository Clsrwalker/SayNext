process.env.SAYNEXT_DB_PATH = ':memory:';
const { EvenHubV2Runtime } = await import('D:/SayNext/src/server/evenhub-v2/runtime.ts');
const { EvenHubV2Store } = await import('D:/SayNext/src/server/evenhub-v2/store.ts');
const { createEvenHubV2ClientMessage: msg } = await import('D:/SayNext/src/server/evenhub-v2/protocol.ts');
const { generateOpenAiJson } = await import('D:/SayNext/src/server/local-llm/openai-json-client.ts');
const { LightweightEvenHubV2ContextAdapter } = await import('D:/SayNext/src/server/evenhub-v2/context-adapter.ts');
const { buildAutoCuePrompt } = await import('D:/SayNext/src/server/evenhub-v2/auto-cue-generator.ts');
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const context={async build(input:any){return {contextSnapshot:input.triggerWindow,memoryUsedIds:[],interviewAnswerCardIds:[],answerPolicyCardIds:[],prenoteUsedIds:[]};}};
const answer={data:{category:'concept',confidence:0.95,title:'Old question answer',g2Title:'Old answer',preview:'This answer belongs only to the first conversation.',fullAnswer:'This answer belongs only to the first conversation.',output:'This answer belongs only to the first conversation.',language:'',code:'',explanation:'',reason:'complete question'},rawText:'{}',model:'fake'};
async function lifecycleProbe(restartBeforeResult:boolean){
 const store=new EvenHubV2Store(':memory:'); let finish!:Function; let calls=0;
 const generator={async generate(){calls++;return new Promise(r=>finish=r);}};
 const events:any[]=[];
 const runtime=new EvenHubV2Runtime({userId:'audit-user',send:m=>events.push(m),store,autoCueGenerator:generator as any,contextAdapter:context,summaryRunner:{queueSummary(){},enqueue(){}},sttAdapterFactory:()=>null,cueOpportunityRouter:null,debounceMs:60000,finalFlushTimeoutMs:0});
 await runtime.handleClientMessage(msg('conversation_start',{})); const firstId=runtime.activeConversationId;
 await runtime.handleClientMessage(msg('debug_transcript',{text:'Please answer the first question'}));
 const job=runtime.flushCueBufferNow(); await sleep(0);
 await runtime.handleClientMessage(msg('conversation_end',{}));
 if(restartBeforeResult) await runtime.handleClientMessage(msg('conversation_start',{}));
 finish(answer); await job;
 if(!restartBeforeResult) await runtime.handleClientMessage(msg('conversation_start',{}));
 const secondId=runtime.activeConversationId;
 await runtime.handleClientMessage(msg('debug_transcript',{text:'Please answer the second question'})); await runtime.flushCueBufferNow();
 const result={restartBeforeResult,calls,firstCueCount:store.listCues(firstId!).length,secondCues:store.listCues(secondId!).map(x=>({output:x.output,attemptConversation:store.getAutoCueAttempt(x.attemptId)?.conversationId})),pendingJobStillPresent:!!(runtime as any).currentAutoJob};
 await runtime.close();return result;
}
console.log('LIFECYCLE',JSON.stringify(await lifecycleProbe(false)));
console.log('CROSS_SESSION',JSON.stringify(await lifecycleProbe(true)));
let responseSignal:AbortSignal|undefined; let releaseBody!:Function;
const pendingJson=generateOpenAiJson({apiKey:'test',timeoutMs:10,prompt:'test',fetchImpl:async(_u,init)=>{responseSignal=init?.signal as AbortSignal;return {ok:true,json:()=>new Promise(r=>releaseBody=r)} as any;}});
await sleep(35); console.log('BODY_TIMEOUT',JSON.stringify({timeoutMs:10,elapsedMs:35,aborted:responseSignal?.aborted}));
releaseBody({output_text:'{"ok":true}'}); await pendingJson;
const input={userId:'audit-user',conversationId:'probe',currentQuestion:'What is our deployment code?',triggerWindow:'What is our deployment code?',recentTranscript:'',selectedPrenoteIds:['pn-proof'],selectedPrenoteText:'DEPLOYMENT_UNIQUE_SENTINEL',settings:{language:'english',autoPopup:true}};
const adapter=new LightweightEvenHubV2ContextAdapter({memoryRouter:null,memoryRetriever:{async search(){return[];}},interviewCards:[],answerPolicyCards:[]});
const snapshot=await adapter.build(input as any);
console.log('PRENOTE',JSON.stringify({declaredUsed:snapshot.prenoteUsedIds,contextIncludesPrenote:snapshot.contextSnapshot.includes(input.selectedPrenoteText),statelessPromptIncludesPrenote:buildAutoCuePrompt({...input,contextSnapshot:snapshot.contextSnapshot,speculative:true} as any).includes(input.selectedPrenoteText)}));


const {DeepgramEvenHubSttAdapter}=await import('D:/SayNext/src/server/evenhub/stt.ts');
const nativeWs=globalThis.WebSocket;
class FakeWs{
 static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;static instances:FakeWs[]=[];
 readyState=0;binaryType='';onopen:any;onclose:any;onerror:any;onmessage:any;sent:any[]=[];
 constructor(public url:string){FakeWs.instances.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen?.();});}
 send(x:any){this.sent.push(x);}close(){this.readyState=3;this.onclose?.({code:1006,reason:'lost'});}
}
globalThis.WebSocket=FakeWs as any;
delete process.env.EVENHUB_STT_LANGUAGE;
let dgAdapter:any;
const dgRuntime=new EvenHubV2Runtime({userId:'audit-user',send:()=>{},store:new EvenHubV2Store(':memory:'),autoCueGenerator:{async generate(){return answer;}},contextAdapter:context,summaryRunner:{queueSummary(){},enqueue(){}},sttAdapterFactory:cb=>{dgAdapter=new DeepgramEvenHubSttAdapter('fake',cb);return dgAdapter;},cueOpportunityRouter:null});
await dgRuntime.handleClientMessage(msg('conversation_start',{settings:{language:'chinese'}}));
await dgRuntime.handleClientMessage(msg('audio_start',{}));
const dgUrl=new URL(FakeWs.instances[0].url);FakeWs.instances[0].close();
for(let i=0;i<4;i++)dgRuntime.handleAudioChunk(new Uint8Array(3200));
await dgRuntime.handleClientMessage(msg('audio_start',{}));
console.log('DEEPGRAM_CLOSE',JSON.stringify({configuredLanguage:'chinese',wireLanguage:dgUrl.searchParams.get('language'),runtimeStatus:dgRuntime.snapshot.audioStatus,socketCount:FakeWs.instances.length,queuedBytes:dgAdapter.queue.reduce((n:number,x:Uint8Array)=>n+x.length,0)}));
await dgRuntime.close();globalThis.WebSocket=nativeWs;
async function duplicateQueueProbe(){
 let finish!:Function;let calls=0;
 const rt=new EvenHubV2Runtime({userId:'audit-user',send:()=>{},store:new EvenHubV2Store(':memory:'),autoCueGenerator:{async generate(){calls++;if(calls===1)return new Promise(r=>finish=r);return answer;}} as any,contextAdapter:context,summaryRunner:{queueSummary(){},enqueue(){}},sttAdapterFactory:()=>null,cueOpportunityRouter:null,debounceMs:0,partialCommitMs:0});
 await rt.handleClientMessage(msg('conversation_start',{}));
 await rt.handleClientMessage(msg('debug_transcript',{text:'What is batch normalization?'}));await sleep(0);
 await rt.handleClientMessage(msg('debug_transcript',{text:'What is batch normalization?',isFinal:false}));
 await rt.handleClientMessage(msg('debug_transcript',{text:'What is batch normalization?'}));
 await rt.handleClientMessage(msg('debug_transcript',{text:'How do we deploy this application?'}));
 finish(answer);await sleep(5);
 console.log('DUPLICATE_QUEUE',JSON.stringify({calls,queuedQuestions:(rt as any).candidateBuffer.map((x:any)=>x.line.text),activeJobPresent:!!(rt as any).currentAutoJob}));await rt.close();
}
await duplicateQueueProbe();
const {EvenHubV2SummaryRunner}=await import('D:/SayNext/src/server/evenhub-v2/summary-runner.ts');
const sumStore=new EvenHubV2Store(':memory:');const sumNow=new Date().toISOString();
sumStore.createConversation({id:'summary-probe',userId:'audit-user',clientSessionId:'audit',title:'Summary probe',startedAt:sumNow,settings:{language:'english',cueDurationMs:10000,autoPopup:true,showAiCue:true,showTranscript:true},usedPrenote:{ids:[],text:''}});
sumStore.queueSummary({id:'sum-probe',conversationId:'summary-probe',userId:'audit-user',queuedAt:sumNow});
sumStore.claimQueuedSummary('summary-probe',sumNow);
const restartedRunner=new EvenHubV2SummaryRunner({store:sumStore,staleRunningMs:10,generator:{async generate(){throw new Error('should be recovered');}}});
restartedRunner.recoverQueuedAndStale(new Date(sumNow).getTime());await sleep(25);
console.log('SUMMARY_RESTART',JSON.stringify({staleRunningMs:10,elapsedAfterRestartMs:25,status:sumStore.getSummary('summary-probe')?.status}));
