import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, ChevronDown, Loader2, Search, RefreshCw, HelpCircle, FileText, X } from 'lucide-react';

const DEFAULT_MODEL = 'google/gemini-3-flash-preview';
const DEFAULT_QUIRKS_MODEL = 'x-ai/grok-4.20';
const DEFAULT_ADJUSTMENTS_MODEL = 'openai/gpt-5.4-mini';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CHAT_URL = `${SUPABASE_URL}/functions/v1/chat`;
const MODELS_URL = `${SUPABASE_URL}/functions/v1/models`;

interface ModelInfo {
  id: string;
  name: string;
}

interface LayerLogEntry {
  layer: string;
  model: string;
  output: string;
  params: Record<string, unknown>;
}

interface Quirk {
  id: string;
  label: string;
  description: string;
  instruction: (n: number) => string;
}

interface Adjustment {
  id: string;
  label: string;
  description: string;
  instruction: string;
}

const ADJUSTMENT_DEFINITIONS: Adjustment[] = [
  {
    id: 'reduce_ly_adverbs',
    label: 'Reduce "ly" Adverbs',
    description: 'Removes or substitutes adverbs ending in "ly" with alternative wording',
    instruction: 'Find every adverb ending in "ly" — especially filler adverbs like "basically", "actually", "really", "literally", "honestly", "simply", "totally", "absolutely", "completely", "definitely", "certainly", "essentially", "generally", "usually", "probably" — and remove them outright or replace them with a stronger verb or more precise phrasing. Filler adverbs that add no meaning must be deleted, not reworded. Do not add new content — only rework or delete existing adverb usage.',
  },
  {
    id: 'reduce_adjectivation',
    label: 'Reduce Adjectivation',
    description: 'Reduces excess adjectives and removes double adjectivation entirely',
    instruction: 'Reduce excessive adjective usage. Remove all instances of double adjectivation (two adjectives modifying the same noun) by keeping only the stronger one or rephrasing. Where single adjectives add no real meaning, remove them. Also remove or rephrase marketing cliches and buzzwords (e.g. "cutting-edge", "next-generation", "best-in-class", "seamless experience", "leverage", "synergy", "game-changer", "revolutionary", "creamy", "tangy"). Prefer the word people would actually say in casual conversation.',
  },
  {
    id: 'remove_formal_nomenclature',
    label: 'Remove Formal Nomenclature',
    description: 'Reduces long marketing names or official terms to commonly used forms and removes marketing cliches',
    instruction: 'Replace long marketing names, official nomenclature, and branded terms with their common everyday equivalents. For example, use "phone" instead of "smartphone device", "app" instead of "application", "car" instead of "vehicle", "pringles" instead of "pringles original crisps".',
  },
  {
    id: 'simplify',
    label: 'Simplify',
    description: 'Replaces unusual or uncommon words with their most common alternatives',
    instruction: 'Replace unusual, quirky or uncommon words or expressions with their most common and broadly used alternatives. For example, use "kids" instead of "little ones", "the others" instead of "the cheap stuff", "show" instead of "demonstrate", "start" instead of "commence", "end" instead of "terminate", "buy" instead of "procure". Also remove any details about personal life and excessive explanations — if a point is already clear, do not elaborate further or restate it. Keep the meaning intact but always prefer the simplest, most everyday word and the most concise expression.',
  },
  {
    id: 'pacing',
    label: 'Pacing',
    description: 'Makes a few sentences noticeably shorter for rhythm and variety',
    instruction: 'Pick 2-3 sentences scattered throughout the text and make them noticeably shorter — ideally under 6 words each. These should feel punchy and intentional, creating rhythm breaks. Do not shorten every sentence, only a few. Do not remove important information; instead condense or split where needed. Leave the rest of the text unchanged.',
  },
];

function samplePoisson(lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

const QUIRK_DEFINITIONS: Quirk[] = [
  {
    id: 'colloquialism',
    label: 'Colloquialism',
    description: 'Introduces informal language and slang substitutions into the text',
    instruction: (n) => `Introduce about ${n} colloquialisms or informal/slang substitutions. Replace formal phrasing with casual equivalents naturally.`,
  },
  {
    id: 'vulgarity',
    label: 'Vulgarity',
    description: 'Introduces substitutions that may appear vulgar, if applicable',
    instruction: (n) => `Introduce up to ${n} vulgar word substitutions (e.g. shit, crap, fuck) if they fit naturally. Make them feel like natural speech.`,
  },
  {
    id: 'typos',
    label: 'Typos',
    description: 'Introduces realistic typographical errors (transposed letters, missed keys, etc)',
    instruction: (n) => `Introduce about ${n} realistic typos (transposed letters, missed keys, double letters, etc). They should look like genuine human typing mistakes.`,
  },
  {
    id: 'punctuation',
    label: 'Punctuation',
    description: 'Introduces punctuation errors and inconsistencies (missing commas, extra periods, etc)',
    instruction: (n) => `Introduce about ${n} punctuation errors or inconsistencies (missing commas, extra periods, inconsistent semicolons/dashes, missing apostrophes, etc).`,
  },
  {
    id: 'capitalization',
    label: 'Capitalization',
    description: 'Introduces capitalization errors and inconsistencies',
    instruction: (n) => `Introduce about ${n} capitalization errors. These should occur at the start of sentences (forgetting to capitalize the first letter) or in places where it feels natural and human — like a proper noun left lowercase or an acronym not capitalized. Do not place capitalization errors in random or unnatural positions.`,
  },
  {
    id: 'grammar_errors',
    label: 'Grammar Errors',
    description: 'Introduces grammatical mistakes (wrong tense, subject-verb disagreement, missing articles, etc)',
    instruction: (n) => `Introduce about ${n} grammatical errors (wrong verb tense, subject-verb disagreement, missing or wrong articles, dangling modifiers, run-on sentences, etc). They should feel like natural mistakes a non-native or hurried speaker would make.`,
  },
];

function Tooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="text-neutral-600 hover:text-neutral-400 transition-colors"
      >
        <HelpCircle size={12} />
      </button>
      {show && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-lg bg-neutral-700 text-xs text-neutral-200 w-48 text-center shadow-xl pointer-events-none">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-neutral-700 rotate-45 -mt-1" />
        </div>
      )}
    </div>
  );
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

const STORAGE_KEY = 'humanizer_session';

interface SessionState {
  selectedModel: string;
  quirksModel: string;
  adjustmentsModel: string;
  input: string;
  output: string;
  lengthUnit: string;
  lengthMin: number;
  lengthMax: number;
  temperature: number;
  topP: number;
  quirkLambdas: Record<string, number>;
  adjustments: Record<string, boolean>;
  personalities: string[];
  moods: string[];
  platforms: string[];
}

function loadSession(): Partial<SessionState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveSession(state: SessionState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function App() {
  const saved = useRef(loadSession());
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState(saved.current.selectedModel || DEFAULT_MODEL);
  const [quirksModel, setQuirksModel] = useState(saved.current.quirksModel || DEFAULT_QUIRKS_MODEL);
  const [input, setInput] = useState(saved.current.input || '');
  const [output, setOutput] = useState(saved.current.output || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lengthUnit, setLengthUnit] = useState<'short sentences' | 'sentences' | 'short paragraphs' | 'paragraphs' | 'pages'>(
    (saved.current.lengthUnit as any) || 'sentences'
  );
  const [lengthMin, setLengthMin] = useState(saved.current.lengthMin ?? 2);
  const [lengthMax, setLengthMax] = useState(saved.current.lengthMax ?? 5);
  const [temperature, setTemperature] = useState(saved.current.temperature ?? 0.9);
  const [topP, setTopP] = useState(saved.current.topP ?? 0.95);
  const [quirkLambdas, setQuirkLambdas] = useState<Record<string, number>>(saved.current.quirkLambdas || {
    colloquialism: 0,
    vulgarity: 0.25,
    typos: 2,
    punctuation: 3,
    capitalization: 2,
    grammar_errors: 1,
  });
  const [adjustmentsModel, setAdjustmentsModel] = useState(saved.current.adjustmentsModel || DEFAULT_ADJUSTMENTS_MODEL);
  const [adjustments, setAdjustments] = useState<Record<string, boolean>>(saved.current.adjustments || {
    reduce_ly_adverbs: true,
    reduce_adjectivation: true,
    remove_formal_nomenclature: true,
    simplify: true,
  });
  const [personalities, setPersonalities] = useState<string[]>(saved.current.personalities || ['young student', 'busy mom', 'retired woman']);
  const [moods, setMoods] = useState<string[]>(saved.current.moods || ['happy', 'tired', 'lazy', 'grumpy', 'relaxed']);
  const [platforms, setPlatforms] = useState<string[]>(saved.current.platforms || ['reddit', 'instagram', 'facebook']);
  const [newPersonality, setNewPersonality] = useState('');
  const [newMood, setNewMood] = useState('');
  const [newPlatform, setNewPlatform] = useState('');
  const [lastRequest, setLastRequest] = useState<{ input: string } | null>(null);
  const [layerLog, setLayerLog] = useState<LayerLogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    saveSession({
      selectedModel, quirksModel, adjustmentsModel,
      input, output, lengthUnit, lengthMin, lengthMax,
      temperature, topP, quirkLambdas, adjustments,
      personalities, moods, platforms,
    });
  }, [selectedModel, quirksModel, adjustmentsModel, input, output, lengthUnit, lengthMin, lengthMax, temperature, topP, quirkLambdas, adjustments, personalities, moods, platforms]);

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
          setModels(sorted);
        }
      } catch {
        // silently fail
      } finally {
        setModelsLoading(false);
      }
    }
    fetchModels();
  }, []);

  const COMMON_SUBSTITUTIONS: [RegExp, string][] = [
    [/[\u2018\u2019\u201A\u201B\u2032\u2035`\u0060\u00B4]/g, "'"],
    [/[\u201C\u201D\u201E\u201F\u2033\u2036\u00AB\u00BB]/g, '"'],
    [/[\u2014\u2013]/g, ' - '],
    [/;/g, ','],
  ];

  function applyCommonSubstitutions(text: string): string {
    let result = text;
    for (const [pattern, replacement] of COMMON_SUBSTITUTIONS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  function getTargetLengthInstruction(): string {
    const amount = Math.floor(Math.random() * (lengthMax - lengthMin + 1)) + lengthMin;
    return `${amount} ${lengthUnit}`;
  }

  function getActiveAdjustments(): Adjustment[] {
    return ADJUSTMENT_DEFINITIONS.filter(def => adjustments[def.id]);
  }

  function sampleQuirks(): { def: Quirk; n: number }[] {
    const sampled: { def: Quirk; n: number }[] = [];
    for (const def of QUIRK_DEFINITIONS) {
      const lambda = quirkLambdas[def.id] ?? 0;
      const n = samplePoisson(lambda);
      if (n > 0) sampled.push({ def, n });
    }
    return sampled;
  }

  async function runPostProcess(text: string, instruction: string, model: string, temp: number, top_p: number): Promise<string> {
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a text post-processor. You will receive a text and must apply the following modification to it. Return ONLY the modified text with no explanation, preamble, or wrapping.\n\n' + instruction },
          { role: 'user', content: text },
        ],
        temperature: temp,
        top_p,
      }),
    });
    const data = await res.json();
    if (res.ok && data.choices?.[0]?.message?.content) {
      return data.choices[0].message.content;
    }
    return text;
  }

  async function generate(text?: string) {
    const inputText = text ?? input.trim();
    if (!inputText || loading) return;

    setLoading(true);
    setError('');
    setOutput('');
    setLayerLog([]);
    setLastRequest({ input: inputText });

    const targetLength = getTargetLengthInstruction();
    const activeAdjustments = getActiveAdjustments();
    const sampledQuirks = sampleQuirks();
    const log: LayerLogEntry[] = [];

    const personality = personalities.length > 0
      ? personalities[Math.floor(Math.random() * personalities.length)]
      : 'helpful assistant';
    const mood = moods.length > 0
      ? moods[Math.floor(Math.random() * moods.length)]
      : null;
    const platform = platforms.length > 0
      ? platforms[Math.floor(Math.random() * platforms.length)]
      : null;

    const systemParts = [
      `You are a ${personality}.${mood ? ` You are feeling ${mood}.` : ''}${platform ? ` You are writing for ${platform}.` : ''} Write your response in about ${targetLength}. Do not share unnecessary details about your privete life or routine.`,
    ];

    const systemMessage = {
      role: 'system',
      content: systemParts.join('\n\n'),
    };

    try {
      // Step 1: Generate base response
      const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [systemMessage, { role: 'user', content: inputText }],
          temperature,
          top_p: topP,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Request failed: ${res.status}`);

      let reply = data.choices?.[0]?.message?.content ?? '';

      log.push({
        layer: 'Generation',
        model: selectedModel,
        output: reply,
        params: { temperature, top_p: topP, target_length: targetLength, personality, mood, platform },
      });

      // Step 2: Apply each adjustment individually (before quirks)
      for (const adj of activeAdjustments) {
        reply = await runPostProcess(reply, adj.instruction, adjustmentsModel, 0.3, 0.9);
        log.push({
          layer: `Adjustment: ${adj.label}`,
          model: adjustmentsModel,
          output: reply,
          params: { temperature: 0.3, top_p: 0.9 },
        });
      }

      // Step 3: Apply each quirk individually
      for (const { def, n } of sampledQuirks) {
        const instruction = def.instruction(n);
        reply = await runPostProcess(reply, instruction, quirksModel, 0.8, 0.95);
        log.push({
          layer: `Quirk: ${def.label}`,
          model: quirksModel,
          output: reply,
          params: { lambda: quirkLambdas[def.id], sampled_n: n, temperature: 0.8, top_p: 0.95 },
        });
      }

      // Step 4: Apply common substitutions (non-LLM)
      reply = applyCommonSubstitutions(reply);
      log.push({
        layer: 'Common Substitutions',
        model: '(hardcoded)',
        output: reply,
        params: {},
      });

      setLayerLog(log);
      setOutput(reply);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  function regenerate() {
    if (lastRequest) {
      generate(lastRequest.input);
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
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-neutral-800 px-6 py-3 flex items-center shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-sky-500 flex items-center justify-center">
            <Sparkles size={14} className="text-white" />
          </div>
          <span className="font-semibold text-base tracking-tight">Humanizer</span>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Content area */}
        <div className="flex-1 flex flex-col overflow-hidden p-6">
          <div className="flex-1 flex flex-col gap-4 max-w-3xl mx-auto w-full">
            {/* Input */}
            <div className="flex flex-col flex-1 min-h-0">
              <label className="text-xs font-medium text-neutral-400 mb-2">Input</label>
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={autoResize}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter text or prompt to humanize..."
                  className="w-full h-full min-h-[120px] bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm text-neutral-100 placeholder-neutral-600 resize-none outline-none focus:border-sky-500/50 transition-colors leading-relaxed"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => generate()}
                disabled={!input.trim() || loading}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:bg-neutral-800 disabled:text-neutral-600 disabled:cursor-not-allowed text-sm font-medium transition-colors"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Generate
              </button>
              {lastRequest && (
                <button
                  onClick={regenerate}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm text-neutral-300 transition-colors border border-neutral-700"
                >
                  <RefreshCw size={14} />
                  Regenerate
                </button>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-950/50 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {/* Output */}
            <div className="flex flex-col flex-1 min-h-0">
              <div className="flex items-center gap-2 mb-2">
                <label className="text-xs font-medium text-neutral-400">Output</label>
                {layerLog.length > 0 && (
                  <button
                    onClick={() => setShowLog(true)}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-400 hover:text-neutral-200 transition-colors border border-neutral-700"
                  >
                    <FileText size={11} />
                    Layer Log
                  </button>
                )}
              </div>
              <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 overflow-y-auto min-h-[120px]">
                {loading ? (
                  <div className="flex items-center gap-2 text-neutral-500 text-sm">
                    <Loader2 size={14} className="animate-spin" />
                    Generating...
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

        {/* Settings panel - always visible */}
        <div className="w-72 shrink-0 border-l border-neutral-800 bg-neutral-900 overflow-y-auto">
          <div className="p-4 space-y-5">
            <h2 className="font-semibold text-sm text-neutral-100">Settings</h2>

            {/* Generation Model */}
            <ModelDropdown
              models={models}
              modelsLoading={modelsLoading}
              selectedModel={selectedModel}
              onSelect={setSelectedModel}
              label="Generation Model"
            />

            {/* Quirks Model */}
            <ModelDropdown
              models={models}
              modelsLoading={modelsLoading}
              selectedModel={quirksModel}
              onSelect={setQuirksModel}
              label="Quirks Model"
            />

            {/* Adjustments Model */}
            <ModelDropdown
              models={models}
              modelsLoading={modelsLoading}
              selectedModel={adjustmentsModel}
              onSelect={setAdjustmentsModel}
              label="Adjustments Model"
            />

            <div className="border-t border-neutral-800" />

            {/* Target Length */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <h3 className="text-xs font-medium text-neutral-200">Target Length</h3>
                <Tooltip text="Controls the desired output length. Select a unit and amount (1-5)." />
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {(['short sentences', 'sentences', 'short paragraphs', 'paragraphs', 'pages'] as const).map(unit => (
                    <button
                      key={unit}
                      onClick={() => setLengthUnit(unit)}
                      className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${
                        lengthUnit === unit
                          ? 'bg-sky-500/20 border-sky-500/50 text-sky-300'
                          : 'border-neutral-700 text-neutral-400 hover:border-neutral-600 hover:text-neutral-300'
                      }`}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-neutral-500">Min</span>
                    <span className="text-[10px] font-mono text-neutral-400">{lengthMin}</span>
                  </div>
                  <input
                    type="range"
                    min={1} max={5} step={1}
                    value={lengthMin}
                    onChange={e => setLengthMin(Math.min(Number(e.target.value), lengthMax))}
                    className="w-full h-1 bg-neutral-700 rounded-full appearance-none cursor-pointer accent-sky-500"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-neutral-500">Max</span>
                    <span className="text-[10px] font-mono text-neutral-400">{lengthMax}</span>
                  </div>
                  <input
                    type="range"
                    min={1} max={5} step={1}
                    value={lengthMax}
                    onChange={e => setLengthMax(Math.max(Number(e.target.value), lengthMin))}
                    className="w-full h-1 bg-neutral-700 rounded-full appearance-none cursor-pointer accent-sky-500"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-neutral-800" />

            {/* Personalities */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <h3 className="text-xs font-medium text-neutral-200">Personalities</h3>
                <Tooltip text="One personality is randomly selected each generation to shape the voice of the response." />
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {personalities.map((p, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-neutral-800 border border-neutral-700 text-[11px] text-neutral-300">
                    {p}
                    <button
                      onClick={() => setPersonalities(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-neutral-500 hover:text-red-400 transition-colors"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newPersonality}
                  onChange={e => setNewPersonality(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newPersonality.trim()) {
                      setPersonalities(prev => [...prev, newPersonality.trim()]);
                      setNewPersonality('');
                    }
                  }}
                  placeholder="Add personality..."
                  className="flex-1 bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 text-[11px] text-neutral-200 placeholder-neutral-600 outline-none focus:border-sky-500/50"
                />
                <button
                  onClick={() => {
                    if (newPersonality.trim()) {
                      setPersonalities(prev => [...prev, newPersonality.trim()]);
                      setNewPersonality('');
                    }
                  }}
                  className="px-2 py-1 rounded-md bg-neutral-700 hover:bg-neutral-600 text-[11px] text-neutral-300 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Moods */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <h3 className="text-xs font-medium text-neutral-200">Moods</h3>
                <Tooltip text="One mood is randomly selected each generation to set the emotional tone." />
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {moods.map((m, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-neutral-800 border border-neutral-700 text-[11px] text-neutral-300">
                    {m}
                    <button
                      onClick={() => setMoods(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-neutral-500 hover:text-red-400 transition-colors"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newMood}
                  onChange={e => setNewMood(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newMood.trim()) {
                      setMoods(prev => [...prev, newMood.trim()]);
                      setNewMood('');
                    }
                  }}
                  placeholder="Add mood..."
                  className="flex-1 bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 text-[11px] text-neutral-200 placeholder-neutral-600 outline-none focus:border-sky-500/50"
                />
                <button
                  onClick={() => {
                    if (newMood.trim()) {
                      setMoods(prev => [...prev, newMood.trim()]);
                      setNewMood('');
                    }
                  }}
                  className="px-2 py-1 rounded-md bg-neutral-700 hover:bg-neutral-600 text-[11px] text-neutral-300 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="border-t border-neutral-800" />

            {/* Platforms */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <h3 className="text-xs font-medium text-neutral-200">Platforms</h3>
                <Tooltip text="One platform is randomly selected each generation to shape the writing style for that medium." />
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {platforms.map((p, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-neutral-800 border border-neutral-700 text-[11px] text-neutral-300">
                    {p}
                    <button
                      onClick={() => setPlatforms(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-neutral-500 hover:text-red-400 transition-colors"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newPlatform}
                  onChange={e => setNewPlatform(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newPlatform.trim()) {
                      setPlatforms(prev => [...prev, newPlatform.trim()]);
                      setNewPlatform('');
                    }
                  }}
                  placeholder="Add platform..."
                  className="flex-1 bg-neutral-800 border border-neutral-700 rounded-md px-2 py-1 text-[11px] text-neutral-200 placeholder-neutral-600 outline-none focus:border-sky-500/50"
                />
                <button
                  onClick={() => {
                    if (newPlatform.trim()) {
                      setPlatforms(prev => [...prev, newPlatform.trim()]);
                      setNewPlatform('');
                    }
                  }}
                  className="px-2 py-1 rounded-md bg-neutral-700 hover:bg-neutral-600 text-[11px] text-neutral-300 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="border-t border-neutral-800" />

            {/* Temperature */}
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

            {/* Top P */}
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

            {/* Adjustments */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <h3 className="text-xs font-medium text-neutral-200">Adjustments</h3>
                <Tooltip text="On/off text adjustments applied before quirks. These clean up and normalize the generated text." />
              </div>
              <div className="space-y-2.5">
                {ADJUSTMENT_DEFINITIONS.map(def => (
                  <label key={def.id} className="flex items-center gap-2.5 cursor-pointer group">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={adjustments[def.id]}
                        onChange={e => setAdjustments(prev => ({ ...prev, [def.id]: e.target.checked }))}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 rounded-full bg-neutral-700 peer-checked:bg-sky-600 transition-colors" />
                      <div className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-neutral-400 peer-checked:bg-white peer-checked:translate-x-4 transition-all" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-neutral-300 group-hover:text-neutral-100 transition-colors">{def.label}</span>
                      <Tooltip text={def.description} />
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t border-neutral-800" />

            {/* Quirks */}
            <div>
              <div className="flex items-center gap-1.5 mb-3">
                <h3 className="text-xs font-medium text-neutral-200">Quirks</h3>
                <Tooltip text="Each quirk uses a Poisson distribution (lambda) to randomly determine how many instances to introduce. Set to 0 to disable." />
              </div>
              <div className="space-y-4">
                {QUIRK_DEFINITIONS.map(def => (
                  <div key={def.id}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[11px] text-neutral-300">{def.label}</span>
                      <Tooltip text={def.description} />
                      <span className="ml-auto text-[10px] font-mono text-neutral-500">
                        {quirkLambdas[def.id].toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0} max={10} step={0.25}
                      value={quirkLambdas[def.id]}
                      onChange={e => setQuirkLambdas(prev => ({ ...prev, [def.id]: Number(e.target.value) }))}
                      className="w-full h-1 bg-neutral-700 rounded-full appearance-none cursor-pointer accent-sky-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Layer Log Modal */}
      {showLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
              <h3 className="font-semibold text-sm text-neutral-100">Layer Log</h3>
              <button
                onClick={() => setShowLog(false)}
                className="text-neutral-500 hover:text-neutral-200 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {layerLog.map((entry, i) => (
                <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-neutral-800/50 border-b border-neutral-800">
                    <span className="text-xs font-medium text-neutral-200">{entry.layer}</span>
                    <span className="text-[10px] text-neutral-500 font-mono">{entry.model}</span>
                  </div>
                  <div className="px-4 py-2.5 border-b border-neutral-800/50">
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(entry.params).map(([key, value]) => (
                        <span key={key} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-neutral-800 text-neutral-400">
                          <span className="text-neutral-500">{key}:</span>
                          <span className="font-mono text-neutral-300">
                            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs text-neutral-300 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">{entry.output}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
