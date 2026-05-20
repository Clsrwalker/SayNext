import type { ImmediateRule, ImmediateRuleContext } from "./immediate-rule-registry";

function asksCloudProjectExperience({ normalized }: ImmediateRuleContext): boolean {
  return /\b(cloud|aws)\b/i.test(normalized)
    && /\b(project|projects|experience|architecture)\b/i.test(normalized)
    && /\b(what|which|tell me|explain|describe|talk about|do you have|should i use|should i talk|your|my)\b/i.test(normalized)
    && !/\b(general concept|definition|what is a cloud project|what does cloud project mean)\b/i.test(normalized);
}

function asksProgrammingLanguageExperience({ normalized }: ImmediateRuleContext): boolean {
  return (
    /\b(programming|program|coding|technical)\b/i.test(normalized)
    && (
      /\b(langu|language|languages)\b/i.test(normalized)
      || /\b(experience|experiment|experiments|worked|used|use|comfortable|know)\b/i.test(normalized)
    )
    && /\b(what|which|do you|have you|you have|mean|with|use|used|know|comfortable)\b/i.test(normalized)
    && !/\b(natural language|second language|spoken language|human language|english|german|japanese|learn another language|exact wording|intended meaning|confirm)\b/i.test(normalized)
  ) || (
    /\b(tech stack|technical stack)\b/i.test(normalized)
    && /\b(you|your|experience|use|comfortable|worked)\b/i.test(normalized)
  );
}

export const PROJECT_PROFILE_IMMEDIATE_RULES: ImmediateRule[] = [
  {
    id: "immediate:supported-saynext-technical-tradeoff",
    priority: 470,
    category: "career_pitch",
    include: [/\btechnical trade[-\s]?off\b/i, /\b(made|you made|your)\b/i],
    output: "One real trade-off I made in Hybrid Search Memory Assistant was between richer context and lower latency. I wanted the model to see enough transcript, memory, and scene context, but too much input made responses slower, so I used retrieval and gating to include only the most relevant parts.",
    reasoning: "Immediate supported SayNext technical trade-off answer",
  },
  {
    id: "immediate:end-to-end-ownership-example",
    priority: 465,
    category: "career_pitch",
    include: [/\b(end[-\s]?to[-\s]?end ownership|owned end[-\s]?to[-\s]?end|owned a feature end[-\s]?to[-\s]?end|feature end[-\s]?to[-\s]?end|handled end[-\s]?to[-\s]?end|ownership well)\b/i, /\b(example|time|share|project|handled)\b/i],
    output: "One good example is Hybrid Search Memory Assistant. I worked through the whole loop: transcript input, memory retrieval, prompt routing, response quality, and testing noisy real conversation cases until the flow became more reliable.",
    reasoning: "Immediate end-to-end ownership example answer",
  },
  {
    id: "immediate:debugging-process",
    priority: 460,
    category: "tech_process",
    include: [/\b(bug|debug|debugging|flaky|broken)\b/i, /\b(how should i|how should we|what should i|what should we|where it is|debug it|approach)\b/i],
    output: "I would not guess first. I would reproduce it, isolate the failing layer, check logs or raw inputs and outputs, then test one small hypothesis at a time.",
    reasoning: "Immediate debugging process response",
    confidence: 0.88,
  },
  {
    id: "immediate:honest-uncertainty",
    priority: 455,
    category: "casual",
    include: [/\b(what should i say|how should i answer|what do i say)\b/i, /\b(don'?t know|do not know|not know|not sure|not enough|uncertain)\b/i],
    output: "I'm not fully sure yet, but my current understanding is this. I would rather verify the key detail first before giving a final answer.",
    reasoning: "Immediate honest uncertainty response",
    confidence: 0.88,
  },
  {
    id: "immediate:supported-hard-bug-interview",
    priority: 450,
    category: "career_pitch",
    when: ({ normalized }) => /\b(hardest|hard|difficult|tricky)\b/i.test(normalized)
      && /\b(bug|issue|problem|fix|fixed|debug)\b/i.test(normalized)
      && (
        /\b(hardest bug|hard bug|difficult bug|tricky bug|debugging bug|debug)\b/i.test(normalized)
        || (/\b(fix|fixed)\b/i.test(normalized) && /\b(tell me|your|example|time you|you had|you fixed|faced|handled|solved)\b/i.test(normalized))
        || (/\b(issue|problem)\b/i.test(normalized) && /\b(tell me|your|example|time you|you had|faced|handled|solved)\b/i.test(normalized) && /\b(project|work|app|system|code|software)\b/i.test(normalized))
      ),
    output: "One tricky bug was in Hybrid Search Memory Assistant, where live transcripts and old suggestions could get out of sync or overwrite newer turns. I reproduced the ASR flow, added stale-response and echo checks, then verified it by replaying the same noisy transcript cases before and after the fix.",
    reasoning: "Immediate supported hard-bug interview answer",
  },
  {
    id: "immediate:mobile-app-experience",
    priority: 445,
    category: "career_pitch",
    include: [/\bmobile\s+app\s+experience\b/i],
    output: "My strongest mobile-related experience is from Hybrid Search Memory Assistant and DalParkAid. Hybrid Search Memory Assistant focuses on live transcripts, memory retrieval, scene profiles, prenotes, and local/travel modes. DalParkAid was a React Native parking app project, so I can talk about both AI-assisted mobile UX and normal app workflow.",
    reasoning: "Immediate supported mobile app experience answer",
  },
  {
    id: "immediate:joblens-user-value",
    priority: 440,
    category: "career_pitch",
    include: [/\b(joblens|job lens)\b/i, /\b(user value|actual value|not just|novelty|outcomes?|why does it matter)\b/i],
    output: "The user value is not the AWS stack itself. JobLens is useful if it helps users get clearer job or resume matches faster, with results they can act on; the cloud architecture only matters if it keeps that flow reliable, private, and measurable.",
    reasoning: "Immediate JobLens user-value answer",
    confidence: 0.92,
  },
  {
    id: "immediate:cloud-project-name-confirmation",
    priority: 435,
    category: "career_pitch",
    when: (context) => asksCloudProjectExperience(context) && /\b(confirm|name|correct|which one|project name)\b/i.test(context.normalized),
    output: "For cloud projects, the names I should use are JobLens AI and ElderAlbum. Hybrid Search Memory Assistant is more of my AI memory and retrieval project, not my main cloud example.",
    reasoning: "Immediate cloud project name confirmation",
    confidence: 0.92,
  },
  {
    id: "immediate:joblens-realtime-scoring-scope",
    priority: 430,
    category: "tech_process",
    include: [/\b(joblens|job lens|job matching|resume matching|job platform)\b/i, /\b(real[-\s]?time|stream|streaming|websocket|web socket|resume scoring|scoring|without (?:changing|redesigning)|redesign|add)\b/i],
    output: "Probably yes, but I would not redesign the backend first. I would keep the current API path, add scoring as a separate async job, store status in DynamoDB, and only add WebSockets if polling is too slow for the user experience.",
    reasoning: "Immediate JobLens real-time scoring scope answer",
    confidence: 0.92,
  },
  {
    id: "immediate:aws-over-azure-project-scope",
    priority: 427,
    category: "career_pitch",
    include: [/\b(aws|migrating to aws|migration)\b/i, /\bazure\b/i, /\b(project scope|changed your mind|why|frame)\b/i],
    output: "I would not say Azure was wrong. I would frame it as AWS fitting the project scope better, especially for serverless pieces like S3, API Gateway, Lambda, and DynamoDB.",
    reasoning: "Immediate AWS over Azure project-scope framing",
    confidence: 0.9,
  },
  {
    id: "immediate:cloud-project-selection",
    priority: 425,
    category: "career_pitch",
    when: asksCloudProjectExperience,
    output: "For cloud projects, I would talk about JobLens AI first: a React frontend on S3, API Gateway, FastAPI on Lambda, DynamoDB for structured data, and S3 for file storage. ElderAlbum is another AWS serverless example with Lambda, API Gateway, DynamoDB, and S3.",
    reasoning: "Immediate cloud project selection answer",
    confidence: 0.93,
  },
  {
    id: "immediate:programming-language-experience",
    priority: 420,
    category: "career_pitch",
    when: asksProgrammingLanguageExperience,
    output: "I've used quite a few languages through school and projects, including C++, Java, Python, C#, JavaScript, and TypeScript. Right now I'm most comfortable with JavaScript and TypeScript, especially with React, React Native, web frontend work, APIs, and databases. C++ and Java are things I learned and used a bit before, but they are more rusty now.",
    reasoning: "Immediate supported programming language experience answer",
    confidence: 0.92,
  },
  {
    id: "immediate:elderalbum-lambda-tag-pipeline",
    priority: 418,
    category: "tech_process",
    include: [/\b(elderalbum|elder album|older album)\b/i, /\b(lambda|trigger|workflow|tag|tags|index|metadata|show up|automatic)\b/i],
    output: "For ElderAlbum, I would explain it as an upload pipeline: photos go to S3, that upload triggers Lambda, Lambda writes metadata or tags to the database, and the UI shows those tags for grouping or search.",
    reasoning: "Immediate ElderAlbum Lambda tag pipeline response",
    confidence: 0.9,
  },
  {
    id: "immediate:elderalbum-metadata-access",
    priority: 416,
    category: "tech_process",
    include: [/\b(elderalbum|elder album|older album|photo metadata|photo album)\b/i, /\b(metadata|ips?|access|who can access|log|logs?)\b/i],
    output: "I would separate photo metadata from access logs. Metadata should be limited to what the app needs, IP logs should be access-controlled and retained briefly, and only authorized users or admins should access them.",
    reasoning: "Immediate ElderAlbum metadata access response",
    confidence: 0.9,
  },
  {
    id: "immediate:elderalbum-privacy-boundary",
    priority: 414,
    category: "risk_boundary",
    include: [/\b(elderalbum|elder album|older album)\b/i, /\b(photo privacy|privacy|private|links? leaking|access)\b/i],
    output: "For ElderAlbum privacy, I would keep the answer cautious: photos should stay private by default, access should be scoped, and sharing links should expire or be revocable.",
    reasoning: "Immediate ElderAlbum privacy cautious response",
    confidence: 0.9,
  },
  {
    id: "immediate:dalparkaid-naming-clarification",
    priority: 412,
    category: "career_pitch",
    include: [/\b(nickname|call it|project name)\b/i, /\b(dalparkaid|dal\s*park\s*aid|dell\s*parking\s*aid|parking aid|parking app)\b/i],
    output: "I would keep the project name as DalParkAid. If I need a casual nickname, I would say it is a parking helper for Dalhousie, but I would not overbrand it.",
    reasoning: "Immediate DalParkAid naming clarification",
    confidence: 0.88,
  },
  {
    id: "immediate:dalparkaid-spelling-clarification",
    priority: 410,
    category: "asr_correction",
    include: [
      /\b(spelled|spelling|same as|verification|verify|different|like\s+dell|dell)\b/i,
      /\b(dalparkaid|dal\s*park\s*aid|dell\s*parking\s*aid|parking aid)\b/i,
      /\b(spelled|spelling|same as|verification|verify|different|project name|called|mean|you mean|is it|dalparkaid|dal\s*park\s*aid)\b/i,
    ],
    output: "No, those are different. My name is spelled Xiang. The project name is DalParkAid, like Dal plus Park Aid.",
    reasoning: "Immediate DalParkAid spelling clarification",
    confidence: 0.9,
  },
  {
    id: "immediate:dalparkaid-shipping-boundary",
    priority: 408,
    category: "career_pitch",
    include: [/\b(dell\s*parking\s*aid|dal\s*park\s*aid|dalparkaid|parking aid)\b/i, /\b(what exactly are you shipping|shipping|when|deadline)\b/i],
    output: "I do not mind small surprises, but if you mean DalParkAid, that is a student parking-helper project, not a production product I am shipping. I would only give a date if there is a real project deadline.",
    reasoning: "Immediate DalParkAid shipping boundary",
    confidence: 0.9,
  },
  {
    id: "immediate:dalparkaid-pricing-boundary",
    priority: 406,
    category: "risk_boundary",
    include: [/\b(dell\s*parking\s*aid|dal\s*park\s*aid|dalparkaid|parking aid)\b/i, /\b(germany|charge|fee|per month|monthly|subscription|cost)\b/i],
    output: "DalParkAid was a Dalhousie student parking project, not a paid app in Germany. I would not claim a monthly fee; if someone asks pricing, I would say there was no real billing model to discuss.",
    reasoning: "Immediate DalParkAid pricing boundary",
    confidence: 0.9,
  },
  {
    id: "immediate:dalparkaid-insurance-boundary",
    priority: 404,
    category: "risk_boundary",
    include: [/\b(react native parking|dalparkaid|dal\s*park\s*aid|dell\s*parking\s*aid|parking project|parking app)\b/i, /\b(insurance claim|insurance claims|claim|legal|official record)\b/i],
    output: "I would not use DalParkAid for insurance claims. It is better framed as a campus parking planning app; anything legal or insurance-related needs official records.",
    reasoning: "Immediate DalParkAid insurance boundary response",
    confidence: 0.9,
  },
  {
    id: "immediate:dalparkaid-prediction-confidence",
    priority: 402,
    category: "career_pitch",
    include: [/\b(react native parking|dalparkaid|dal\s*park\s*aid|dell\s*parking\s*aid|parking project|parking app)\b/i, /\b(numbers?|score|baseline|tier|prediction|reliable|how reliable|availability|junction|payment)\b/i],
    output: "I would describe DalParkAid as a rough parking availability helper, not an exact prediction system. I would avoid giving fake scores unless the project actually defines those numbers.",
    reasoning: "Immediate DalParkAid prediction confidence boundary",
    confidence: 0.9,
  },
  {
    id: "immediate:dalparkaid-data-plan-privacy",
    priority: 400,
    category: "risk_boundary",
    include: [/\b(dell\s*parking\s*aid|dal\s*park\s*aid|dalparkaid|parking aid|parking app)\b/i, /\b(data plan|location history|aggregate counts?|stored?|store|privacy|data)\b/i],
    output: "For DalParkAid, I would frame the data plan as aggregate parking signals, not personal location history. The safer answer is lot-level counts or reports, limited storage, and no tracking of individual routes unless clearly required.",
    reasoning: "Immediate DalParkAid data-plan privacy answer",
    confidence: 0.9,
  },
  {
    id: "immediate:parking-aid-support-pressure",
    priority: 398,
    category: "career_pitch",
    include: [/\b(dell\s*parking\s*aid|dal\s*park\s*aid|dalparkaid|parking aid)\b/i, /\b(tickets?|piling up|support|harmless|exhausting)\b/i],
    output: "Yeah, that is the exhausting part: the app sounds harmless, but support tickets pile up when users are stressed. I would focus on triage, clear status messages, and fixing the biggest repeated complaint first.",
    reasoning: "Immediate parking-aid support-pressure answer",
    confidence: 0.88,
  },
  {
    id: "immediate:grounded-dalparkaid-interview",
    priority: 396,
    category: "career_pitch",
    include: [/\b(react native parking|dalparkaid|dal\s*park\s*aid|dell\s*parking\s*aid|parking project|parking app)\b/i],
    output: "DalParkAid was a React Native parking app for Dalhousie. It estimated campus parking availability using timetable, weather, and crowd-report context, then showed lot status with simple map markers.",
    reasoning: "Immediate grounded DalParkAid interview response",
    confidence: 0.92,
  },
];
