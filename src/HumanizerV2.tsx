import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, ChevronDown, Search, HelpCircle, Check, AlertTriangle, RotateCcw, Eye } from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CHAT_URL = `${SUPABASE_URL}/functions/v1/chat`;
const MODELS_URL = `${SUPABASE_URL}/functions/v1/models`;

const DEFAULT_MODELS = [
  'google/gemini-3.5-flash',
  'anthropic/claude-sonnet-4.6',
  'openai/gpt-5.4-mini',
];

const V2_STORAGE_KEY = 'humanizer_v2_session';

interface ModelInfo {
  id: string;
  name: string;
}

interface JudgeVerdict {
  verdict: 'human' | 'ai';
  explanation: string;
}

interface StepEntry {
  type: 'generation' | 'judgment' | 'rewrite';
  model: string;
  content: string;
  round: number;
  detail?: string;
}

interface V2Session {
  models: [string, string, string];
  input: string;
  output: string;
  temperature: number;
  topP: number;
}

function loadV2Session(): Partial<V2Session> {
  try {
    const raw = localStorage.getItem(V2_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveV2Session(state: V2Session) {
  try {
    localStorage.setItem(V2_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function ModelDropdown({
  models,
  modelsLoading,
  selectedModel,
  onSelect,
  label,
}: {
  models: ModelInfo[];
  modelsLoading: boolean;
  selectedModel: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  const filtered = models.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.id.toLowerCase().includes(search.toLowerCase())
  );

  const selectedLabel = models.find(m => m.id === selectedModel)?.name ?? selectedModel;

  return (
    <div className="relative" ref={ref}>
      <label className="text-xs text-neutral-400 mb-1 block">{label}</label>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-750 transition-colors text-xs text-neutral-200 border border-neutral-700"
      >
        <span className="truncate flex-1 text-left">{modelsLoading ? 'Loading...' : selectedLabel}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-72 rounded-xl bg-neutral-800 border border-neutral-700 shadow-2xl z-50 overflow-hidden">
          <div className="p-2 border-b border-neutral-700">
            <div className="flex items-center gap-2 bg-neutral-900 rounded-lg px-3 py-1.5">
              <Search size={12} className="text-neutral-500 shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                className="bg-transparent outline-none text-xs text-neutral-200 placeholder-neutral-500 w-full"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-neutral-500">No models found</div>
            ) : (
              filtered.map(m => (
                <button
                  key={m.id}
                  onClick={() => { onSelect(m.id); setOpen(false); setSearch(''); }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-neutral-700 ${selectedModel === m.id ? 'text-sky-400 bg-neutral-700/50' : 'text-neutral-300'}`}
                >
                  <span className="block truncate">{m.name}</span>
                  {m.name !== m.id && <span className="block text-[10px] text-neutral-500 truncate">{m.id}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="text-neutral-600 hover:text-neutral-400 transition-colors"
      >
        <HelpCircle size={12} />
      </button>
      {show && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-lg bg-neutral-700 text-xs text-neutral-200 w-52 text-center shadow-xl pointer-events-none">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-neutral-700 rotate-45 -mt-1" />
        </div>
      )}
    </div>
  );
}

async function chatCompletion(
  model: string,
  messages: { role: string; content: string }[],
  temperature: number,
  topP: number,
): Promise<string> {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ model, messages, temperature, top_p: topP }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Request failed: ${res.status}`);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from model');
  return content;
}

function parseJudgment(raw: string): JudgeVerdict {
  const lower = raw.toLowerCase();
  const verdictMatch = lower.match(/\*?\*?verdict\*?\*?\s*:\s*(human|ai)/);
  if (verdictMatch) {
    const verdict = verdictMatch[1] as 'human' | 'ai';
    const explanationMatch = raw.match(/\*?\*?explanation\*?\*?\s*:\s*([\s\S]*)/i);
    return { verdict, explanation: explanationMatch?.[1]?.trim() || raw };
  }
  if (lower.includes('human')) return { verdict: 'human', explanation: raw };
  return { verdict: 'ai', explanation: raw };
}

const MAX_ROUNDS = 6;

export default function HumanizerV2() {
  const saved = useRef(loadV2Session());
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [selectedModels, setSelectedModels] = useState<[string, string, string]>(
    (saved.current.models as [string, string, string]) || [DEFAULT_MODELS[0], DEFAULT_MODELS[1], DEFAULT_MODELS[2]]
  );
  const [input, setInput] = useState(saved.current.input || '');
  const [output, setOutput] = useState(saved.current.output || '');
  const [temperature, setTemperature] = useState(saved.current.temperature ?? 0.9);
  const [topP, setTopP] = useState(saved.current.topP ?? 0.95);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [steps, setSteps] = useState<StepEntry[]>([]);
  const [currentStep, setCurrentStep] = useState('');
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stepsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveV2Session({
      models: selectedModels,
      input,
      output,
      temperature,
      topP,
    });
  }, [selectedModels, input, output, temperature, topP]);

  useEffect(() => {
    async function fetchModels() {
      try {
        const res = await fetch(MODELS_URL, {
          headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        });
        const data = await res.json();
        if (data?.data) {
          const sorted = data.data
            .map((m: { id: string; name?: string }) => ({ id: m.id, name: m.name || m.id }))
            .sort((a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name));
          setAllModels(sorted);
        }
      } catch {} finally {
        setModelsLoading(false);
      }
    }
    fetchModels();
  }, []);

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps, currentStep]);

  function updateModel(index: number, id: string) {
    setSelectedModels(prev => {
      const next = [...prev] as [string, string, string];
      next[index] = id;
      return next;
    });
  }

  function getModelShort(id: string): string {
    return allModels.find(m => m.id === id)?.name || id.split('/').pop() || id;
  }

  function toggleStep(index: number) {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function generate() {
    const text = input.trim();
    if (!text || loading) return;

    setLoading(true);
    setError('');
    setOutput('');
    setSteps([]);
    setExpandedSteps(new Set());

    const [writerModel, judgeAModel, judgeBModel] = selectedModels;

    try {
      setCurrentStep(`Model 1 (${getModelShort(writerModel)}) generating response...`);

      const writerSystemPrompt = `You are a regular person writing a response on a social media platform or forum. Write naturally as a human would — casual, with your own voice. Do not use markdown formatting. Do not identify yourself as AI. Just respond to the user's message as if you were a real person posting online.`;

      let currentResponse = await chatCompletion(
        writerModel,
        [
          { role: 'system', content: writerSystemPrompt },
          { role: 'user', content: text },
        ],
        temperature,
        topP,
      );

      const newSteps: StepEntry[] = [{
        type: 'generation',
        model: writerModel,
        content: currentResponse,
        round: 0,
      }];
      setSteps([...newSteps]);

      const judgeModels = [judgeAModel, judgeBModel];
      const lastHotSeatRound: [number, number] = [-1, -1];
      let finalResponse = currentResponse;

      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const judgePrompt = `You are evaluating whether the following text was written by a human or generated by AI. The text is supposedly from a regular web user posting on a forum or social media — not from a book, newspaper, or professional publication.

Analyze the text carefully for signs of AI generation: overly polished language, formulaic structure, excessive hedging, bullet points, unnatural consistency in tone, marketing-speak, or lack of genuine personality.

Respond in EXACTLY this format:
Verdict: human
Explanation: <your reasoning>

OR

Verdict: ai
Explanation: <your reasoning>

Text to evaluate:
"""
${currentResponse}
"""`;

        const verdicts: JudgeVerdict[] = [];

        for (let j = 0; j < 2; j++) {
          setCurrentStep(`Round ${round}: Judge ${j + 1} (${getModelShort(judgeModels[j])}) evaluating...`);
          const raw = await chatCompletion(
            judgeModels[j],
            [{ role: 'system', content: 'You are a Turing test judge. Your job is to determine if text was written by a human or AI.' }, { role: 'user', content: judgePrompt }],
            0.3,
            0.9,
          );
          const verdict = parseJudgment(raw);
          verdicts.push(verdict);

          newSteps.push({
            type: 'judgment',
            model: judgeModels[j],
            content: verdict.explanation,
            round,
            detail: verdict.verdict === 'human' ? 'HUMAN' : 'AI',
          });
          setSteps([...newSteps]);
        }

        const bothHuman = verdicts[0].verdict === 'human' && verdicts[1].verdict === 'human';
        if (bothHuman) {
          finalResponse = currentResponse;
          break;
        }

        let hotSeatJudgeIndex: number;

        const aiJudgeIndices = verdicts
          .map((v, i) => v.verdict === 'ai' ? i : -1)
          .filter(i => i >= 0);

        if (aiJudgeIndices.length === 1) {
          hotSeatJudgeIndex = aiJudgeIndices[0];
        } else {
          if (lastHotSeatRound[0] <= lastHotSeatRound[1]) {
            hotSeatJudgeIndex = 0;
          } else {
            hotSeatJudgeIndex = 1;
          }
        }

        const hotSeatModel = judgeModels[hotSeatJudgeIndex];
        lastHotSeatRound[hotSeatJudgeIndex] = round;

        setCurrentStep(`Round ${round}: ${getModelShort(hotSeatModel)} rewriting (hot seat)...`);

        const rewritePrompt = `You previously judged the following text as AI-generated. Here was your assessment:

"${verdicts[hotSeatJudgeIndex].explanation}"

Now rewrite the text so it genuinely reads as if a real person wrote it on a forum or social media. Make it sound natural and human — with personality, imperfections, and a casual voice. Do not use markdown. Return ONLY the rewritten text.

Original text:
"""
${currentResponse}
"""`;

        currentResponse = await chatCompletion(
          hotSeatModel,
          [
            { role: 'system', content: 'You are rewriting text to sound more naturally human. Write as a real person would on social media or a forum.' },
            { role: 'user', content: rewritePrompt },
          ],
          temperature,
          topP,
        );

        newSteps.push({
          type: 'rewrite',
          model: hotSeatModel,
          content: currentResponse,
          round,
          detail: `Judge ${hotSeatJudgeIndex + 1} took the hot seat`,
        });
        setSteps([...newSteps]);
        finalResponse = currentResponse;

        if (round === MAX_ROUNDS) break;
      }

      setOutput(finalResponse);
      setCurrentStep('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setCurrentStep('');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      generate();
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 300) + 'px';
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden p-6">
        <div className="flex-1 flex flex-col gap-4 max-w-3xl mx-auto w-full">
          {/* Input */}
          <div className="flex flex-col">
            <label className="text-xs font-medium text-neutral-400 mb-2">Input</label>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={autoResize}
              onKeyDown={handleKeyDown}
              placeholder="Enter text or prompt to humanize..."
              className="w-full min-h-[100px] bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-neutral-100 placeholder-neutral-600 resize-none outline-none focus:border-sky-500/50 transition-colors leading-relaxed"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={generate}
              disabled={!input.trim() || loading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:bg-neutral-800 disabled:text-neutral-600 disabled:cursor-not-allowed text-sm font-medium transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Generate
            </button>
            {output && !loading && (
              <button
                onClick={generate}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-300 transition-colors border border-neutral-700"
              >
                <RotateCcw size={14} />
                Regenerate
              </button>
            )}
          </div>

          {error && (
            <div className="bg-red-950/50 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Process Steps */}
          {steps.length > 0 && (
            <div className="flex flex-col">
              <label className="text-xs font-medium text-neutral-400 mb-2">Process</label>
              <div className="space-y-1.5 bg-neutral-900 border border-neutral-800 rounded-xl p-3 max-h-[350px] overflow-y-auto">
                {steps.map((step, i) => (
                  <div key={i} className="rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleStep(i)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-neutral-800/80 transition-colors rounded-lg"
                    >
                      {step.type === 'generation' && (
                        <Send size={12} className="text-sky-400 shrink-0" />
                      )}
                      {step.type === 'judgment' && (
                        step.detail === 'HUMAN'
                          ? <Check size={12} className="text-emerald-400 shrink-0" />
                          : <AlertTriangle size={12} className="text-amber-400 shrink-0" />
                      )}
                      {step.type === 'rewrite' && (
                        <RotateCcw size={12} className="text-violet-400 shrink-0" />
                      )}
                      <span className="text-[11px] text-neutral-300 flex-1">
                        {step.type === 'generation' && `Initial generation`}
                        {step.type === 'judgment' && `Round ${step.round} — Judge verdict: ${step.detail}`}
                        {step.type === 'rewrite' && `Round ${step.round} — Rewrite (${step.detail})`}
                      </span>
                      <span className="text-[10px] text-neutral-500 font-mono shrink-0">
                        {getModelShort(step.model)}
                      </span>
                      <Eye size={10} className={`shrink-0 transition-colors ${expandedSteps.has(i) ? 'text-sky-400' : 'text-neutral-600'}`} />
                    </button>
                    {expandedSteps.has(i) && (
                      <div className="px-3 pb-2 pt-1 ml-5">
                        <p className="text-[11px] text-neutral-400 leading-relaxed whitespace-pre-wrap">
                          {step.content}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
                {currentStep && (
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Loader2 size={12} className="animate-spin text-sky-400 shrink-0" />
                    <span className="text-[11px] text-neutral-400">{currentStep}</span>
                  </div>
                )}
                <div ref={stepsEndRef} />
              </div>
            </div>
          )}

          {/* Output */}
          <div className="flex flex-col flex-1 min-h-0">
            <label className="text-xs font-medium text-neutral-400 mb-2">Output</label>
            <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 overflow-y-auto min-h-[120px]">
              {loading && !output ? (
                <div className="flex items-center gap-2 text-neutral-500 text-sm">
                  <Loader2 size={14} className="animate-spin" />
                  Processing...
                </div>
              ) : output ? (
                <p className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap">{output}</p>
              ) : (
                <p className="text-sm text-neutral-600">Output will appear here...</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Settings panel */}
      <div className="w-72 shrink-0 border-l border-neutral-800 bg-neutral-900 overflow-y-auto">
        <div className="p-4 space-y-5">
          <h2 className="font-semibold text-sm text-neutral-100">Settings</h2>

          <ModelDropdown
            models={allModels}
            modelsLoading={modelsLoading}
            selectedModel={selectedModels[0]}
            onSelect={(id) => updateModel(0, id)}
            label="Model 1 (Writer)"
          />
          <ModelDropdown
            models={allModels}
            modelsLoading={modelsLoading}
            selectedModel={selectedModels[1]}
            onSelect={(id) => updateModel(1, id)}
            label="Model 2 (Judge A)"
          />
          <ModelDropdown
            models={allModels}
            modelsLoading={modelsLoading}
            selectedModel={selectedModels[2]}
            onSelect={(id) => updateModel(2, id)}
            label="Model 3 (Judge B)"
          />

          <div className="border-t border-neutral-800" />

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <h3 className="text-xs font-medium text-neutral-200">Temperature</h3>
              <Tooltip text="Controls randomness. Higher values produce more creative, varied output." />
              <span className="ml-auto text-[10px] font-mono text-neutral-400">{temperature.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0} max={2} step={0.01}
              value={temperature}
              onChange={e => setTemperature(Number(e.target.value))}
              className="w-full h-1 bg-neutral-700 rounded-full appearance-none cursor-pointer accent-sky-500"
            />
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <h3 className="text-xs font-medium text-neutral-200">Top P</h3>
              <Tooltip text="Nucleus sampling threshold. Lower values make output more focused and deterministic." />
              <span className="ml-auto text-[10px] font-mono text-neutral-400">{topP.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0} max={1} step={0.01}
              value={topP}
              onChange={e => setTopP(Number(e.target.value))}
              className="w-full h-1 bg-neutral-700 rounded-full appearance-none cursor-pointer accent-sky-500"
            />
          </div>

          <div className="border-t border-neutral-800" />

          <div className="space-y-2">
            <h3 className="text-xs font-medium text-neutral-200">How it works</h3>
            <div className="space-y-1.5 text-[11px] text-neutral-400 leading-relaxed">
              <p>1. Model 1 generates a response to your prompt.</p>
              <p>2. Models 2 and 3 judge if it reads as human or AI.</p>
              <p>3. If both say human, the output is final.</p>
              <p>4. If one says AI, that judge rewrites it to sound human.</p>
              <p>5. If both say AI, the one least recently in the hot seat rewrites.</p>
              <p>6. Repeats up to {MAX_ROUNDS} rounds.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
