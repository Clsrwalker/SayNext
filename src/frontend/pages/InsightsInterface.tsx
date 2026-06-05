import { useState, useEffect, useRef, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
// @ts-ignore - Bun bundler doesn't resolve `export { X as default }` re-exports correctly
import LottieImport from 'lottie-react';
const Lottie: typeof LottieImport = (LottieImport as any)?.default ?? LottieImport;
import Markdown from 'react-markdown';
// @ts-ignore - JSON import
import MentraLogoAnimation from '../../public/figma-parth-assets/anim/Mentralogo2.json';
// @ts-ignore - PNG import
import MergeLogo from '../../public/assets/icons/merge_logo.png';
import Settings from './Settings';
import SampleReview from './SampleReview';
import PrenoteManager from './PrenoteManager';
import TranscriptExport from './TranscriptExport';
import SceneProfileManager from './SceneProfileManager';
import PersonalMemoryManager from './PersonalMemoryManager';
import MemoryReview from './MemoryReview';
import Header from '../components/Header';
import BottomHeader from '../components/BottomHeader';
import { useTheme } from '../App';
import {
  advanceTeleprompt,
  cancelTeleprompt,
  displayInsightForReading,
  pauseForReading,
  resumeAutomatic,
  rewindTeleprompt,
  runManualAction,
} from '../api/settings.api';

interface Insight {
  id: string;
  text: string;
  timestamp: string;
  agentType?: string;
  reasoning?: string;
  sourceText?: string;
}

interface InsightsInterfaceProps {
  userId: string;
}

type TelepromptUiState = {
  status: 'pending' | 'ready';
  currentIndex: number;
  total: number;
};

type ManualUiSummary = {
  transcriptCount: number;
  answerLabel: string;
  pendingLabel: string;
  hasAnswer: boolean;
};

const THINKING_WORDS = [
  'doodling',
  'vibing',
  'cooking',
  'pondering',
  'brewing',
  'crafting',
  'dreaming',
  'computing',
  'processing',
  'brainstorming',
  'conjuring',
  'imagining',
];

function hashInsightText(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeInsightId(insight: Insight): Insight {
  const fallback = `${insight.timestamp || new Date().toISOString()}-${hashInsightText(insight.text || '')}`;
  return {
    ...insight,
    id: insight.id || fallback,
  };
}

function dedupeInsightsById(items: Insight[]): Insight[] {
  const seen = new Map<string, string>();
  const output: Insight[] = [];

  for (const rawItem of items) {
    const item = normalizeInsightId(rawItem);
    const existingText = seen.get(item.id);

    if (existingText === item.text) {
      continue;
    }

    if (existingText !== undefined) {
      const fallbackId = `${item.id}-${hashInsightText(item.text || '')}`;
      if (seen.has(fallbackId)) continue;
      seen.set(fallbackId, item.text);
      output.push({ ...item, id: fallbackId });
      continue;
    }

    seen.set(item.id, item.text);
    output.push(item);
  }

  return output;
}

function appendManualAnswerHistory(history: Insight[], next: Insight): Insight[] {
  const text = String(next.text || '').trim();
  if (!text) return history;

  const withoutDuplicate = history.filter((item) => {
    return item.id !== next.id && String(item.text || '').trim() !== text;
  });
  return dedupeInsightsById([...withoutDuplicate, { ...next, text }]).slice(-30);
}

function manualInsightFromAnswer(answer: any, fallbackPrefix = 'manual-answer'): Insight | null {
  const text = manualAnswerTextFromPayload(answer);
  if (!text) return null;
  const answerId = String(answer?.answerId || '').trim();
  const answerGroupId = String(answer?.answerGroupId || '').trim();
  return {
    id: answerId || answerGroupId || `${fallbackPrefix}-${Date.now()}-${hashInsightText(text)}`,
    text,
    timestamp: new Date().toISOString(),
    agentType: 'Manual',
    reasoning: 'manual_answer',
    sourceText: String(answer?.sourceText || '').trim() || undefined,
  };
}

function summarizeManualState(state: any): ManualUiSummary {
  const currentAnswer = state?.currentAnswer;
  const pageIndex = Number(currentAnswer?.pageIndex ?? 0);
  const totalPages = Number(currentAnswer?.totalPages ?? 0);
  return {
    transcriptCount: Number(state?.transcriptCount ?? 0),
    answerLabel: currentAnswer ? (totalPages > 1 ? `${pageIndex + 1}/${totalPages}` : 'Ready') : 'None',
    pendingLabel: state?.pending?.kind ? String(state.pending.kind) : 'None',
    hasAnswer: Boolean(currentAnswer),
  };
}

function manualAnswerTextFromPayload(answer: any): string {
  return String(answer?.output || answer?.text || '').trim();
}

function compactManualSourceText(text?: string, maxChars = 1600): string {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3).trim()}...`;
}

function answerLooksCodeLike(text: string): boolean {
  return /(^|\n)\s*(class|def|function|return|if|for|while|#|\/\/|public|private|const|let|var)\b/.test(text)
    || /(^|\n)\s{2,}\S/.test(text)
    || /[{};]\s*(\n|$)/.test(text);
}

function manualAnswerTextClass(text: string, compact = false): string {
  const length = String(text || '').length;
  if (answerLooksCodeLike(text)) return compact ? 'text-[12px] leading-[1.4] font-mono' : 'text-[13px] leading-[1.45] font-mono';
  if (length > 1600) return compact ? 'text-[12px] leading-[1.42]' : 'text-[13px] leading-[1.45]';
  if (length > 900) return compact ? 'text-[13px] leading-[1.45]' : 'text-[14px] leading-[1.5]';
  return compact ? 'text-[14px] leading-[1.5]' : 'text-[16px] leading-[1.55]';
}

function ManualAnswerCard({
  answer,
  sourceText,
  title,
  subtitle,
  pinned = false,
}: {
  answer: string;
  sourceText?: string;
  title: string;
  subtitle: string;
  pinned?: boolean;
}) {
  const compactSource = compactManualSourceText(sourceText);
  const answerText = String(answer || '').trim();
  const maxAnswerHeight = pinned ? '44vh' : '30vh';

  return (
    <motion.section
      key={title + subtitle + hashInsightText(answerText)}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`${pinned ? 'rounded-[24px]' : 'rounded-[20px]'} border shadow-sm overflow-hidden w-full max-w-full`}
      style={{
        backgroundColor: 'var(--primary-foreground)',
        borderColor: 'var(--border)',
      }}
    >
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 border-b min-w-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-muted-foreground">{title}</div>
          <div className="text-[16px] font-bold truncate" style={{ color: 'var(--secondary-foreground)' }}>
            {subtitle}
          </div>
        </div>
        <span
          className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
          style={{
            color: 'var(--secondary-foreground)',
            borderColor: 'var(--border)',
          }}
        >
          Scroll
        </span>
      </div>

      {compactSource && (
        <div className="px-4 pt-3">
          <div className="rounded-[14px] border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Question</div>
            <div
              className="max-h-[22vh] overflow-y-auto text-[12px] sm:text-[13px] leading-[1.35] text-muted-foreground whitespace-pre-wrap"
              style={{
                overflowWrap: 'anywhere',
                wordBreak: 'break-word',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {compactSource}
            </div>
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Answer</div>
        <div
          className={`overflow-y-auto whitespace-pre-wrap ${manualAnswerTextClass(answerText, !pinned)}`}
          style={{
            maxHeight: maxAnswerHeight,
            color: 'var(--secondary-foreground)',
            scrollbarWidth: 'thin',
            overscrollBehaviorY: 'contain',
            WebkitOverflowScrolling: 'touch',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
        >
          {answerText}
        </div>
      </div>
    </motion.section>
  );
}

function manualStatusMessage(status: string): string {
  if (status === 'no_new_speech') {
    return 'No new speech captured yet. Wait for the speech count to increase, then press Generate again.';
  }
  if (status === 'no_current_answer') {
    return 'No answer yet. Say something first, then press Generate.';
  }
  if (status === 'noop') {
    return 'No page change.';
  }
  return `Manual action returned ${status}.`;
}

/**
 * Memoized insight bubble component
 */
const InsightBubble = memo(function InsightBubble({
  insight,
  isNew,
  isPausedForReading,
  onSelect,
}: {
  insight: Insight;
  isNew: boolean;
  isPausedForReading: boolean;
  onSelect: (insight: Insight) => void;
}) {
  return (
    <motion.div
      key={insight.id}
      role={isPausedForReading ? 'button' : undefined}
      tabIndex={isPausedForReading ? 0 : undefined}
      onClick={() => {
        if (isPausedForReading) onSelect(insight);
      }}
      onKeyDown={(event) => {
        if (isPausedForReading && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onSelect(insight);
        }
      }}
      initial={isNew ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex flex-col gap-2 items-start ${isPausedForReading ? 'cursor-pointer active:opacity-70' : ''}`}
    >
      {/* Avatar */}
      <div className="flex items-center gap-2 flex-row">
        <div className="ml-[8px]">
          <img src={MergeLogo} alt="Mentra" className="w-[40px] h-[40px]" />
        </div>
      </div>

      {/* Insight Content */}
      <div className="flex flex-col items-start">
        <div
          className="leading-relaxed whitespace-pre-line pt-[8px] pb-[8px] pr-[16px] pl-0 rounded-[16px] inline-block max-w-[85vw] sm:max-w-lg text-[16px] bg-transparent font-medium *:text-[var(--secondary-foreground)]"
          style={{
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            color: 'var(--secondary-foreground)',
          }}
        >
          <Markdown
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              strong: ({ children }) => <strong className="font-bold">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
              ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
              li: ({ children }) => <li className="mb-1">{children}</li>,
              code: ({ children, className }) => {
                const isBlock = className?.includes('language-');
                return isBlock ? (
                  <pre className="bg-[var(--primary-foreground)] rounded-lg p-3 my-2 overflow-x-auto">
                    <code className="text-[14px] font-mono">{children}</code>
                  </pre>
                ) : (
                  <code className="bg-[var(--primary-foreground)] rounded px-1.5 py-0.5 text-[14px] font-mono">
                    {children}
                  </code>
                );
              },
              h1: ({ children }) => <h1 className="text-xl font-bold mb-2">{children}</h1>,
              h2: ({ children }) => <h2 className="text-lg font-bold mb-2">{children}</h2>,
              h3: ({ children }) => <h3 className="text-base font-bold mb-1">{children}</h3>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-[var(--muted-foreground)] pl-3 italic my-2">
                  {children}
                </blockquote>
              ),
            }}
          >
            {insight.text}
          </Markdown>
        </div>
        <div className="text-[12px] ml-[15px] mt-1.5 text-left w-full text-muted-foreground">
          {new Date(insight.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </motion.div>
  );
});

/**
 * InsightsInterface — Main webview showing a scrollable list of insights via SSE
 * Modeled after New-Mentra-AI's ChatInterface but adapted for insight cards
 */
function InsightsInterface({ userId }: InsightsInterfaceProps) {
  const { isDarkMode, toggleTheme } = useTheme();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [hasConnectedBefore, setHasConnectedBefore] = useState(() => {
    return sessionStorage.getItem('merge-session-connected') === 'true';
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPausedForReading, setIsPausedForReading] = useState(false);
  const [telepromptState, setTelepromptState] = useState<TelepromptUiState | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState('Connecting');
  const [statusDetail, setStatusDetail] = useState('Waiting for the Mentra session.');
  const [manualSummary, setManualSummary] = useState<ManualUiSummary>({
    transcriptCount: 0,
    answerLabel: 'None',
    pendingLabel: 'None',
    hasAnswer: false,
  });
  const [manualAnswerText, setManualAnswerText] = useState('');
  const [manualAnswerSourceText, setManualAnswerSourceText] = useState('');
  const [manualAnswerHistory, setManualAnswerHistory] = useState<Insight[]>([]);
  const [thinkingWord, setThinkingWord] = useState(() =>
    THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)]
  );
  // Track which insight IDs have been rendered to avoid re-animating old ones
  const renderedIdsRef = useRef<Set<string>>(new Set());
  const [sessionActive, setSessionActive] = useState<boolean | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [currentPage, setCurrentPage] = useState<'insights' | 'settings' | 'sampleReview' | 'prenotes' | 'sceneProfiles' | 'transcriptExport' | 'personalMemory' | 'memoryReview'>('insights');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  // Track whether next scroll should be instant (history load) vs smooth (live insight)
  const scrollInstantRef = useRef(false);

  const clearRealtimeScreen = () => {
    setInsights([]);
    setIsProcessing(false);
    setIsPausedForReading(false);
    setTelepromptState(null);
    setRuntimeStatus('Ready');
    setStatusDetail('Screen cleared. Listening continues if glasses are connected.');
    setManualSummary({ transcriptCount: 0, answerLabel: 'None', pendingLabel: 'None', hasAnswer: false });
    setManualAnswerText('');
    setManualAnswerSourceText('');
    setManualAnswerHistory([]);
    setIsLoadingHistory(false);
    setHasConnectedBefore(false);
    renderedIdsRef.current.clear();
    sessionStorage.removeItem('merge-session-connected');
  };

  const applyManualState = (state: any) => {
    if (!state) return;
    setManualSummary(summarizeManualState(state));
  };

  // Scroll to bottom of insights
  const scrollToBottom = (instant?: boolean) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: instant ? 'instant' : 'smooth' });
    });
  };

  useEffect(() => {
    if (insights.length > 0) {
      scrollToBottom(scrollInstantRef.current);
      scrollInstantRef.current = false;
    }
  }, [insights]);

  useEffect(() => {
    if (currentPage === 'insights' && insights.length > 0) {
      scrollToBottom(true);
    }
  }, [currentPage]);

  // Set up SSE connection for real-time insight updates (with auto-reconnect)
  useEffect(() => {
    if (!userId) return;

    let reconnectAttempts = 0;
    const MAX_RECONNECT_DELAY = 30000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const sseUrl = `/api/insight-stream?userId=${encodeURIComponent(userId)}`;
      const eventSource = new EventSource(sseUrl);
      sseRef.current = eventSource;

      eventSource.onopen = () => {
        reconnectAttempts = 0;
        setRuntimeStatus('Connected');
        setStatusDetail('Live status stream connected.');
        setIsLoadingHistory(true);
        sessionStorage.setItem('merge-session-connected', 'true');
        setHasConnectedBefore(true);
      };

      eventSource.onmessage = (event) => {
        if (!event.data || event.data.trim() === '') return;

        try {
          const data = JSON.parse(event.data);

          if (data.type === 'insight') {
            // New insight from the agent pipeline
            const randomWord = THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)];
            setThinkingWord(randomWord);
            setIsProcessing(false);
            setRuntimeStatus('Answer ready');
            const isManualInsight = String(data.agentType || '').toLowerCase() === 'manual';
            setStatusDetail(isManualInsight ? 'Answer is pinned on display.' : 'New display cue received.');

            if (isManualInsight) {
              const manualInsight = {
                id: data.id || `${data.timestamp || new Date().toISOString()}-${hashInsightText(data.text || '')}`,
                text: String(data.text || '').trim(),
                timestamp: data.timestamp || new Date().toISOString(),
                agentType: 'Manual',
                reasoning: data.reasoning || 'manual_answer',
                sourceText: String(data.sourceText || '').trim() || undefined,
              };
              setManualAnswerText(manualInsight.text);
              setManualAnswerSourceText(manualInsight.sourceText || '');
              setManualAnswerHistory((prev) => appendManualAnswerHistory(prev, manualInsight));
              return;
            }

            const nextInsight = {
              id: data.id || Date.now().toString(),
              text: data.text,
              timestamp: data.timestamp || new Date().toISOString(),
              agentType: data.agentType,
              reasoning: data.reasoning,
            };
            setInsights((prev) => dedupeInsightsById([...prev, nextInsight]));
          } else if (data.type === 'processing') {
            const randomWord = THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)];
            setThinkingWord(randomWord);
            setIsProcessing(true);
            setRuntimeStatus('Generating');
            setStatusDetail('SayNext is generating a cue.');
          } else if (data.type === 'processing_done') {
            setIsProcessing(false);
            const reason = String(data.reason || '');
            if (reason === 'manual_ok') setRuntimeStatus('Answer ready');
            else if (reason.includes('manual_transcript_committed')) setRuntimeStatus('Speech captured');
            else if (reason.includes('manual_busy')) setRuntimeStatus('Generating');
            else if (reason.includes('manual_no_') || reason.includes('manual_clear_')) setRuntimeStatus('Listening');
            setStatusDetail(reason.includes('manual_busy')
              ? 'A previous answer is still generating. Wait a moment or try again after it finishes.'
              : data.reason ? `Last event: ${data.reason}` : 'Processing finished.');
          } else if (data.type === 'manual_pause') {
            setIsPausedForReading(Boolean(data.paused));
            setIsProcessing(false);
            setRuntimeStatus(data.paused ? 'Paused' : 'Listening');
            setStatusDetail(data.paused ? 'Pinned answer stays on display.' : 'Listening resumed.');
          } else if (data.type === 'teleprompt') {
            setIsProcessing(false);
            setRuntimeStatus(data.status === 'ready' ? 'Teleprompt ready' : 'Preparing teleprompt');
            setStatusDetail(data.status === 'ready' ? 'Use Next or Back to page the script.' : 'Building a longer script.');
            const currentIndex = Number(data.currentIndex ?? 0);
            const total = Number(data.total ?? 0);
            const isFinished = data.status === 'ready' && total > 0 && currentIndex >= total;
            setTelepromptState(isFinished ? null : {
              status: data.status === 'ready' ? 'ready' : 'pending',
              currentIndex,
              total,
            });
            const telepromptInsight = {
              id: 'teleprompt-live',
              text: data.text,
              timestamp: new Date().toISOString(),
              agentType: 'Teleprompt',
              reasoning: 'Live teleprompt',
            };
            setInsights((prev) => dedupeInsightsById([
              ...prev.filter((insight) => insight.id !== 'teleprompt-live'),
              telepromptInsight,
            ]));
          } else if (data.type === 'teleprompt_cancelled') {
            setIsProcessing(false);
            setTelepromptState(null);
            setRuntimeStatus('Listening');
            setStatusDetail('Teleprompt cancelled.');
            setInsights((prev) => prev.filter((insight) => insight.id !== 'teleprompt-live'));
          } else if (data.type === 'connected') {
            setRuntimeStatus('Connected');
            setStatusDetail('Connected to the live event stream.');
            setIsLoadingHistory(true);
          } else if (data.type === 'history') {
            // Instant scroll, no animation — mark all IDs as already rendered
            scrollInstantRef.current = true;
            const rawHistory = data.insights || [];
            const manualHistory = dedupeInsightsById(rawHistory
              .filter((ins: any) => String(ins.agentType || '').toLowerCase() === 'manual')
              .map((ins: any) => ({
                id: ins.id,
                text: String(ins.text || '').trim(),
                timestamp: ins.timestamp,
                agentType: ins.agentType || 'Manual',
                reasoning: ins.reasoning || 'manual_answer',
                sourceText: String(ins.sourceText || '').trim() || undefined,
              }))
              .filter((ins: Insight) => ins.text));
            const latestManual = manualHistory.at(-1);
            if (latestManual?.text) {
              setManualAnswerText(String(latestManual.text).trim());
              setManualAnswerSourceText(String(latestManual.sourceText || '').trim());
              setManualSummary((current) => ({ ...current, hasAnswer: true, answerLabel: 'Ready' }));
            }
            setManualAnswerHistory(manualHistory.slice(-30));
            const historyInsights = dedupeInsightsById(rawHistory
              .filter((ins: any) => String(ins.agentType || '').toLowerCase() !== 'manual')
              .map((ins: any) => ({
                id: ins.id,
                text: ins.text,
                timestamp: ins.timestamp,
                agentType: ins.agentType,
                reasoning: ins.reasoning,
              })));
            for (const ins of historyInsights) {
              renderedIdsRef.current.add(ins.id);
            }
            setInsights(historyInsights);
            setIsLoadingHistory(false);
          } else if (data.type === 'session_started') {
            setSessionActive(true);
            setRuntimeStatus('Listening');
            setStatusDetail('Glasses session started.');
          } else if (data.type === 'session_reconnecting') {
            setSessionActive(false);
            setIsProcessing(false);
            setRuntimeStatus('Disconnected');
            setStatusDetail('Glasses disconnected. Reconnecting...');
          } else if (data.type === 'session_reconnected') {
            setSessionActive(true);
            setRuntimeStatus('Listening');
            setStatusDetail('Glasses reconnected.');
          } else if (data.type === 'session_ended') {
            setSessionActive(false);
            setIsProcessing(false);
            setTelepromptState(null);
            setRuntimeStatus('Disconnected');
            setStatusDetail('Session ended.');
            setInsights([]);
            setManualAnswerText('');
            setManualAnswerSourceText('');
            setManualAnswerHistory([]);
            renderedIdsRef.current.clear();
            setHasConnectedBefore(false);
            sessionStorage.removeItem('merge-session-connected');
          } else if (data.type === 'session_reset') {
            clearRealtimeScreen();
          } else if (data.type === 'session_heartbeat') {
            setSessionActive(data.active);
            setIsLoadingHistory(false);
            if (!data.active) {
              setIsProcessing(false);
              setTelepromptState(null);
              setRuntimeStatus('Disconnected');
              setStatusDetail('Waiting for glasses connection.');
            }
          } else if (data.type === 'manual_status') {
            applyManualState(data.state);
            setRuntimeStatus(data.reason === 'transcript_committed' ? 'Speech captured' : 'Listening');
            setStatusDetail(data.reason ? `Manual state: ${data.reason}` : 'Manual state updated.');
          } else if (data.type === 'manual_generating') {
            applyManualState(data.state);
            setIsProcessing(true);
            setRuntimeStatus('Generating');
            setStatusDetail(data.kind === 'regenerate' ? 'Regenerating current answer.' : 'Generating from new speech.');
          } else if (data.type === 'manual_answer') {
            applyManualState(data.state);
            setIsProcessing(false);
            setRuntimeStatus('Answer ready');
            setStatusDetail('Answer is pinned on display.');
            const manualInsight = manualInsightFromAnswer(data.answer, 'manual-answer-sse');
            const answerText = manualInsight?.text || manualAnswerTextFromPayload(data.answer);
            setManualAnswerText(answerText);
            setManualAnswerSourceText(manualInsight?.sourceText || String(data.answer?.sourceText || '').trim());
            if (manualInsight) {
              setManualAnswerHistory((prev) => appendManualAnswerHistory(prev, manualInsight));
            }
          } else if (data.type === 'manual_page') {
            applyManualState(data.state);
            setRuntimeStatus('Answer ready');
            setStatusDetail('Answer is pinned on display.');
            setManualAnswerText(manualAnswerTextFromPayload(data.answer));
            setManualAnswerSourceText(String(data.answer?.sourceText || '').trim());
          } else if (data.type === 'manual_cleared') {
            applyManualState(data.state);
            setIsProcessing(false);
            setRuntimeStatus('Listening');
            setStatusDetail('Display cleared. Listening continues.');
            setManualAnswerText('');
            setManualAnswerSourceText('');
          } else if (data.type === 'manual_error') {
            applyManualState(data.state);
            setIsProcessing(false);
            setRuntimeStatus('Error');
            setStatusDetail(data.error || 'Manual generation failed.');
          } else if (data.type === 'manual_gesture_ignored') {
            setStatusDetail(data.reason === 'manual_answer_is_single_scroll_box'
              ? 'Use the phone answer box to scroll the full response.'
              : 'Long press ignored by SayNext; it may be reserved by the glasses system.');
          } else if (data.type === 'manual_gesture_pending') {
            setStatusDetail('Tap received. Waiting briefly for a second tap; single tap will generate.');
          } else if (data.type === 'manual_gesture') {
            setStatusDetail(`Gesture: ${data.gesture}`);
          }
        } catch (error) {
          console.error('[InsightsInterface] Error parsing SSE message:', error);
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        setSessionActive(false);
        setIsProcessing(false);
        setRuntimeStatus('Disconnected');
        setStatusDetail('Live status stream disconnected.');
        const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
        reconnectAttempts++;
        console.log(`[InsightsInterface] SSE disconnected, reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        if (!sseRef.current || sseRef.current.readyState === EventSource.CLOSED) {
          connect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    connect();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      sseRef.current?.close();
    };
  }, [userId]);

  const handlePauseToggle = async () => {
    if (!userId) return;

    try {
      if (isPausedForReading) {
        await resumeAutomatic(userId);
        setIsPausedForReading(false);
      } else {
        await pauseForReading(userId);
        setIsPausedForReading(true);
        setIsProcessing(false);
      }
    } catch (error) {
      console.error('[InsightsInterface] Failed to update pause state:', error);
    }
  };

  const handleInsightSelect = async (insight: Insight) => {
    if (!userId || !isPausedForReading) return;

    try {
      await displayInsightForReading(userId, insight.text);
      setIsPausedForReading(true);
      setIsProcessing(false);
    } catch (error) {
      console.error('[InsightsInterface] Failed to display selected insight:', error);
    }
  };

  const handleTelepromptNext = async () => {
    if (!userId || !telepromptState || telepromptState.status !== 'ready') return;

    try {
      await advanceTeleprompt(userId);
      setIsProcessing(false);
    } catch (error) {
      console.error('[InsightsInterface] Failed to advance teleprompt:', error);
    }
  };

  const handleTelepromptBack = async () => {
    if (!userId || !telepromptState || telepromptState.status !== 'ready' || telepromptState.currentIndex <= 0) return;

    try {
      await rewindTeleprompt(userId);
      setIsProcessing(false);
    } catch (error) {
      console.error('[InsightsInterface] Failed to rewind teleprompt:', error);
    }
  };

  const handleTelepromptCancel = async () => {
    if (!userId || !telepromptState) return;

    try {
      await cancelTeleprompt(userId);
      setTelepromptState(null);
      setInsights((prev) => prev.filter((insight) => insight.id !== 'teleprompt-live'));
      setIsProcessing(false);
    } catch (error) {
      console.error('[InsightsInterface] Failed to cancel teleprompt:', error);
    }
  };

  const handleManualAction = async (action: 'generate' | 'regenerate' | 'clear') => {
    if (!userId) return;

    try {
      if (action === 'generate' || action === 'regenerate') {
        setIsProcessing(true);
        setRuntimeStatus(action === 'regenerate' ? 'Regenerating' : 'Generating');
        setStatusDetail(action === 'regenerate' ? 'Requesting another answer.' : 'Generating from captured speech.');
      } else {
        setRuntimeStatus('Clearing');
        setStatusDetail('Clearing pinned display.');
      }
      const result = await runManualAction(userId, action);
      applyManualState(result.state);
      if (result.status !== 'busy') {
        setIsProcessing(false);
      }
      if (result.status === 'ok' && result.answer) {
        setRuntimeStatus('Answer ready');
        setStatusDetail('Answer is pinned on display.');
        const manualInsight = manualInsightFromAnswer(result.answer, 'manual-answer-action');
        const answerText = manualInsight?.text || manualAnswerTextFromPayload(result.answer);
        setManualAnswerText(answerText);
        setManualAnswerSourceText(manualInsight?.sourceText || String(result.answer?.sourceText || '').trim());
        if (manualInsight) {
          setManualAnswerHistory((prev) => appendManualAnswerHistory(prev, manualInsight));
        }
      } else if (result.status === 'cleared') {
        setRuntimeStatus('Listening');
        setStatusDetail('Display cleared. Listening continues.');
        setManualAnswerText('');
        setManualAnswerSourceText('');
        setInsights([]);
        renderedIdsRef.current.clear();
      } else if (result.status === 'busy') {
        setRuntimeStatus('Generating');
        setStatusDetail('A generation is already running.');
      } else {
        setRuntimeStatus('Listening');
        setStatusDetail(result.error || manualStatusMessage(result.status));
      }
    } catch (error) {
      setIsProcessing(false);
      setRuntimeStatus('Error');
      setStatusDetail(error instanceof Error ? error.message : String(error));
    }
  };

  const canAdvanceTeleprompt = telepromptState?.status === 'ready';
  const canRewindTeleprompt = canAdvanceTeleprompt && (telepromptState?.currentIndex ?? 0) > 0;
  const statusTone = sessionActive === false || runtimeStatus === 'Disconnected'
    ? 'bg-red-500/10 text-red-500 border-red-500/20'
    : isProcessing || runtimeStatus.includes('Generating') || runtimeStatus.includes('Regenerating') || runtimeStatus.includes('Preparing') || runtimeStatus === 'Clearing'
      ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
      : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
  const previousManualAnswers = manualAnswerHistory
    .filter((answer) => String(answer.text || '').trim() && String(answer.text || '').trim() !== manualAnswerText.trim())
    .slice()
    .reverse();
  const hasVisibleMessages = Boolean(manualAnswerText) || previousManualAnswers.length > 0 || insights.length > 0;
  const showManualControls = sessionActive !== false || hasVisibleMessages || hasConnectedBefore;

  // Render Settings page if on settings
  if (currentPage === 'settings') {
    return (
      <Settings
        onBack={() => setCurrentPage('insights')}
        onOpenSampleReview={() => setCurrentPage('sampleReview')}
        onOpenPrenotes={() => setCurrentPage('prenotes')}
        onOpenSceneProfiles={() => setCurrentPage('sceneProfiles')}
        onOpenTranscriptExport={() => setCurrentPage('transcriptExport')}
        onOpenPersonalMemory={() => setCurrentPage('personalMemory')}
        onOpenMemoryReview={() => setCurrentPage('memoryReview')}
        onResetCurrentSession={() => {
          clearRealtimeScreen();
          setCurrentPage('insights');
        }}
        isDarkMode={isDarkMode}
        onToggleDarkMode={toggleTheme}
        userId={userId}
      />
    );
  }

  if (currentPage === 'prenotes') {
    return (
      <PrenoteManager
        userId={userId}
        onBack={() => setCurrentPage('settings')}
      />
    );
  }

  if (currentPage === 'personalMemory') {
    return (
      <PersonalMemoryManager
        userId={userId}
        onBack={() => setCurrentPage('settings')}
      />
    );
  }

  if (currentPage === 'memoryReview') {
    return (
      <MemoryReview
        userId={userId}
        onBack={() => setCurrentPage('settings')}
      />
    );
  }

  if (currentPage === 'sceneProfiles') {
    return (
      <SceneProfileManager
        userId={userId}
        onBack={() => setCurrentPage('settings')}
      />
    );
  }

  if (currentPage === 'sampleReview') {
    return (
      <SampleReview
        userId={userId}
        onBack={() => setCurrentPage('settings')}
      />
    );
  }

  if (currentPage === 'transcriptExport') {
    return (
      <TranscriptExport
        userId={userId}
        onBack={() => setCurrentPage('settings')}
      />
    );
  }

  return (
    <div
      className="h-screen flex overflow-hidden"
      style={{ backgroundColor: 'var(--background)' }}
    >
      {/* Session disconnected banner — fixed on top of everything */}
      <AnimatePresence>
        {sessionActive === false && (
          <motion.div
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 px-4 py-2 bg-red-500/15 backdrop-blur-sm border-b border-red-500/20"
          >
            <svg className="w-3.5 h-3.5 text-red-400 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-25" />
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
            </svg>
            <span className="text-red-400 text-xs font-medium">Disconnected — attempting to reconnect</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div
        className="flex-1 flex flex-col relative"
        style={{ backgroundColor: 'var(--background)' }}
      >
        {/* Header */}
        <Header onSettingsClick={() => setCurrentPage('settings')} />

        <section className="px-4 pb-3 relative z-20">
          <div
            className="rounded-[28px] border px-4 py-3 shadow-sm"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--primary-foreground) 92%, transparent)',
              borderColor: 'var(--border)',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[12px] font-semibold ${statusTone}`}>
                    {runtimeStatus}
                  </span>
                  {isPausedForReading && (
                    <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[12px] font-semibold text-muted-foreground">
                      Paused
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[14px] leading-snug text-muted-foreground">
                  {statusDetail}
                </p>
              </div>
              <div className="text-right text-[12px] text-muted-foreground shrink-0">
                <div>{sessionActive === false ? 'Offline' : 'Session'}</div>
                <div className="font-semibold" style={{ color: 'var(--secondary-foreground)' }}>
                  {sessionActive === false ? 'Waiting' : 'Active'}
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-[18px] px-3 py-2" style={{ backgroundColor: 'var(--background)' }}>
                <div className="text-[11px] text-muted-foreground">Speech</div>
                <div className="text-[16px] font-bold" style={{ color: 'var(--secondary-foreground)' }}>
                  {manualSummary.transcriptCount}
                </div>
              </div>
              <div className="rounded-[18px] px-3 py-2" style={{ backgroundColor: 'var(--background)' }}>
                <div className="text-[11px] text-muted-foreground">Answer</div>
                <div className="text-[16px] font-bold" style={{ color: 'var(--secondary-foreground)' }}>
                  {manualSummary.answerLabel}
                </div>
              </div>
              <div className="rounded-[18px] px-3 py-2" style={{ backgroundColor: 'var(--background)' }}>
                <div className="text-[11px] text-muted-foreground">Pending</div>
                <div className="text-[16px] font-bold truncate" style={{ color: 'var(--secondary-foreground)' }}>
                  {manualSummary.pendingLabel}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Main Content Area */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto relative"
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            overscrollBehaviorY: 'contain',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {/* Empty States: Welcome / Disconnected / Loading */}
          <AnimatePresence mode="wait">
            {isLoadingHistory && !hasVisibleMessages && (
              <motion.div
                key="loading-screen"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 flex flex-col items-center justify-center px-6 z-10"
              >
                <div className="flex flex-col items-center gap-3 -mt-[80px]">
                  <svg className="w-6 h-6 text-muted-foreground animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-25" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                  </svg>
                  <span className="text-[14px] text-muted-foreground font-medium">Loading insights...</span>
                </div>
              </motion.div>
            )}
            {!isLoadingHistory && !hasVisibleMessages && sessionActive === false && (
              <motion.div
                key="disconnected-screen"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 flex flex-col items-center justify-center px-6 z-10"
              >
                <div className="flex flex-col items-center -mt-[80px]">
                  <Lottie
                    animationData={MentraLogoAnimation}
                    loop={true}
                    autoplay={true}
                    className="w-[150px] h-[150px] mb-[10px]"
                  />
                  <h1 className="text-[20px] font-semibold" style={{ color: 'var(--secondary-foreground)' }}>
                    Waiting for connection...
                  </h1>
                </div>
              </motion.div>
            )}
            {!isLoadingHistory && !hasVisibleMessages && sessionActive !== false && !isProcessing && (
              <motion.div
                key="welcome-screen"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="absolute inset-0 flex flex-col items-center justify-center px-6 z-10"
              >
                <div className="flex flex-col items-center -mt-[80px]">
                  <motion.div
                    initial={{ y: '5vh' }}
                    animate={{ y: 0 }}
                    transition={{
                      duration: 0.7,
                      ease: [0.25, 0.1, 0.25, 1],
                      delay: 0.3,
                    }}
                    className="mb-[10px]"
                  >
                    <Lottie
                      animationData={MentraLogoAnimation}
                      loop={true}
                      autoplay={true}
                      className="w-[150px] h-[150px]"
                    />
                  </motion.div>
                  <h1 className="text-[20px] sm:text-4xl md:text-5xl lg:text-6xl font-semibold flex gap-[4px] justify-center">
                    {['Listening', 'for', 'conversations...'].map((word, index) => (
                      <motion.span
                        key={index}
                        initial={{ opacity: 0, filter: 'blur(10px)' }}
                        animate={{ opacity: 1, filter: 'blur(0px)' }}
                        transition={{
                          duration: 0.5,
                          ease: [0.25, 0.1, 0.25, 1],
                          delay: 0.7 + index * 0.15,
                        }}
                        style={{ color: 'var(--secondary-foreground)' }}
                      >
                        {word}
                      </motion.span>
                    ))}
                  </h1>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.6,
                      ease: [0.25, 0.1, 0.25, 1],
                      delay: 1.15,
                    }}
                    className="text-[14px] text-muted-foreground mt-[8px]"
                  >
                    Insights will appear as you talk.
                  </motion.div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Insight List */}
          {(hasVisibleMessages || isProcessing) && (
            <motion.div
              initial={hasConnectedBefore ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: hasConnectedBefore ? 0 : 0.5, ease: 'easeOut' }}
              className="px-3 sm:px-[24px] py-4 sm:py-6 pb-[210px] relative z-20 min-w-0 overflow-x-hidden"
            >
              <div className="w-full max-w-3xl mx-auto space-y-5 sm:space-y-6 min-w-0">
                {manualAnswerText && (
                  <ManualAnswerCard
                    answer={manualAnswerText}
                    sourceText={manualAnswerSourceText}
                    title="Pinned answer"
                    subtitle="Latest response"
                    pinned
                  />
                )}

                {previousManualAnswers.length > 0 && (
                  <section className="space-y-3">
                    <div className="px-1 text-[13px] font-semibold text-muted-foreground">
                      Previous answers
                    </div>
                    {previousManualAnswers.map((answer) => (
                      <ManualAnswerCard
                        key={answer.id}
                        answer={answer.text}
                        sourceText={answer.sourceText}
                        title={new Date(answer.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        subtitle="Previous answer"
                      />
                    ))}
                  </section>
                )}

                {insights.map((insight) => {
                  const isNew = !renderedIdsRef.current.has(insight.id);
                  if (isNew) renderedIdsRef.current.add(insight.id);
                  return (
                    <InsightBubble
                      key={insight.id}
                      insight={insight}
                      isNew={isNew}
                      isPausedForReading={isPausedForReading}
                      onSelect={handleInsightSelect}
                    />
                  );
                })}

                {/* Processing Indicator */}
                {isProcessing && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2"
                  >
                    <div className="flex-shrink-0">
                      <img src={MergeLogo} alt="Mentra" className="w-[40px] h-[40px]" />
                    </div>
                    <motion.div
                      className="text-sm text-muted-foreground italic"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                    >
                      {`${thinkingWord}...`.split('').map((char, index) => (
                        <motion.span
                          key={index}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: index * 0.05 }}
                        >
                          {char}
                        </motion.span>
                      ))}
                    </motion.div>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </motion.div>
          )}
        </div>

        {/* Manual Controls */}
        {showManualControls && (
          <div className="fixed left-0 right-0 bottom-0 z-[240] px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 backdrop-blur-[8px]"
            style={{ backgroundColor: 'color-mix(in srgb, var(--background) 88%, transparent)' }}
          >
            {telepromptState ? (
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={handleTelepromptNext}
                  disabled={!canAdvanceTeleprompt}
                  className="col-span-3 min-h-[92px] px-6 rounded-[24px] text-[30px] font-bold shadow-sm transition active:scale-[0.99] disabled:opacity-55 disabled:active:scale-100"
                  style={{
                    backgroundColor: 'var(--secondary-foreground)',
                    color: 'var(--primary-foreground)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {canAdvanceTeleprompt ? `Next ${telepromptState.currentIndex + 1}/${telepromptState.total}` : 'Preparing'}
                </button>
                <button
                  onClick={handleTelepromptBack}
                  disabled={!canRewindTeleprompt}
                  className="min-h-[58px] px-2 rounded-[18px] text-[18px] font-bold shadow-sm transition active:scale-[0.99] disabled:opacity-45 disabled:active:scale-100"
                  style={{
                    backgroundColor: 'var(--primary-foreground)',
                    color: 'var(--secondary-foreground)',
                    border: '1px solid var(--border)',
                  }}
                >
                  Back
                </button>
                <button
                  onClick={handlePauseToggle}
                  className="min-h-[58px] px-2 rounded-[18px] text-[18px] font-bold shadow-sm transition active:scale-[0.99]"
                  style={{
                    backgroundColor: isPausedForReading ? 'var(--secondary-foreground)' : 'var(--primary-foreground)',
                    color: isPausedForReading ? 'var(--primary-foreground)' : 'var(--secondary-foreground)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {isPausedForReading ? 'Continue' : 'Pause'}
                </button>
                <button
                  onClick={handleTelepromptCancel}
                  className="min-h-[58px] px-2 rounded-[18px] text-[18px] font-bold shadow-sm transition active:scale-[0.99]"
                  style={{
                    backgroundColor: 'var(--primary-foreground)',
                    color: '#b91c1c',
                    border: '1px solid var(--border)',
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={handlePauseToggle}
                  className="min-h-[64px] px-2 rounded-[20px] text-[18px] font-bold shadow-sm transition active:scale-[0.99]"
                  style={{
                    backgroundColor: isPausedForReading ? 'var(--secondary-foreground)' : 'var(--primary-foreground)',
                    color: isPausedForReading ? 'var(--primary-foreground)' : 'var(--secondary-foreground)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {isPausedForReading ? 'Continue' : 'Pause'}
                </button>
                <button
                  onClick={() => handleManualAction('generate')}
                  className="col-span-2 min-h-[64px] px-4 rounded-[20px] text-[22px] font-bold shadow-sm transition active:scale-[0.99]"
                  style={{
                    backgroundColor: 'var(--secondary-foreground)',
                    color: 'var(--primary-foreground)',
                    border: '1px solid var(--border)',
                  }}
                >
                  Generate
                </button>
                <button
                  onClick={() => handleManualAction('clear')}
                  className="col-span-3 min-h-[54px] px-2 rounded-[18px] text-[18px] font-bold shadow-sm transition active:scale-[0.99]"
                  style={{
                    backgroundColor: 'var(--primary-foreground)',
                    color: 'var(--secondary-foreground)',
                    border: '1px solid var(--border)',
                  }}
                >
                  Clear display
                </button>
              </div>
            )}
          </div>
        )}

        {/* Bottom Header */}
        <BottomHeader isVisible={hasVisibleMessages} />
      </div>
    </div>
  );
}

export default InsightsInterface;
