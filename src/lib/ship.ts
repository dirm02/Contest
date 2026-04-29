const DEFAULT_SHIP_API_BASE_URL = 'http://127.0.0.1:8765';

export type Citation = {
  finding_index: number | null;
  sql_query_name: string | null;
  url: string | null;
  /** When the cited finding lives in a prior run, this is set. */
  source_run_id: string | null;
};

export type SummaryParagraph = {
  text: string;
  citations: Citation[];
};

export type Summary = {
  headline: string;
  paragraphs: SummaryParagraph[];
  caveats: string[];
};

export type Verification = {
  status: 'pass' | 'failed';
  failures: string[];
  checks: {
    paragraphs: number;
    cited_findings: number;
    cited_sql: number;
    numbers: number;
    canonical_entities_seen: number;
    canonical_entities_verified_in_text: number;
    web_urls_checked: number;
    total_latency_ms: number;
    latency_budget_ms: number;
  };
};

export type Operation =
  | { kind: 'recipe_run';  recipe_id: string;  run_id: string;  description: string; row_count: number; timing_ms: number }
  | { kind: 'filter';      source_run_id: string; description: string; before_count: number; after_count: number; predicate: string }
  | { kind: 'project';     source_run_id: string; description: string; columns: string[] }
  | { kind: 'sort';        source_run_id: string; description: string; sort_by: { column: string; dir: 'asc' | 'desc' }[] }
  | { kind: 'slice';       source_run_id: string; description: string; offset: number; limit: number }
  | { kind: 'aggregate';   source_run_id: string; description: string; group_by: string[]; aggregations: { column: string; fn: string; alias: string }[] }
  | { kind: 'join';        left_run_id: string; right_run_id: string; description: string; keys: string[]; how: 'inner' | 'left' | 'outer' }
  | { kind: 'union';       source_run_ids: string[]; description: string }
  | { kind: 'intersect';   source_run_ids: string[]; description: string }
  | { kind: 'compare';     baseline_run_id: string; comparison_run_id: string; description: string }
  | { kind: 'commentary';  source_run_ids: string[]; description: string };

export type AnswerDiff = {
  baseline_run_id: string;
  rows_added: number;
  rows_removed: number;
  rows_changed: number;
  columns_added: string[];
  columns_removed: string[];
};

export type AnswerResponse = {
  type: 'answer';
  message_id: string;
  /**
   * The mode of this turn.
   *  - 'fresh'        – ran a brand-new recipe, no prior context used
   *  - 'refined'      – applied operations to a single prior run
   *  - 'composed'     – combined multiple prior and/or new runs
   *  - 'conversational' – no SQL ran; commentary on prior runs only
   */
  mode: 'fresh' | 'refined' | 'composed' | 'conversational';

  /** The primary run produced by this turn. Null in `conversational` mode. */
  recipe_run_id: string | null;

  /** Backwards-compat: the most recent single source run, if any. */
  based_on_run_id: string | null;

  /** Every prior run this answer reads from (memory recall). Ordered most-recent-first. */
  source_run_ids: string[];

  /** The operations applied this turn, in order. Each is a step in the lineage. */
  operations: Operation[];

  /** Diff against the most recent prior run, if applicable. Null when not meaningful. */
  diff: AnswerDiff | null;

  summary: Summary;
  findings_preview: Record<string, unknown>[];
  verification: Verification;
  latency_ms: number;
};

export type ClarificationResponse = {
  type: 'clarification_needed';
  message_id: string;
  headline: string;
  reason: string;
  suggested_narrowings: string[];
  example_refinements: string[];
  proceed_phrase: string;
};

export type NewConversationResponse = {
  type: 'needs_new_conversation';
  message_id: string;
  reason: string;
  suggested_starter: string;
  current_conversation_topic: string;
};

export type NotAnswerableResponse = {
  type: 'not_answerable';
  message_id: string;
  message: string;
};

export type AssistantResponse =
  | AnswerResponse
  | ClarificationResponse
  | NewConversationResponse
  | NotAnswerableResponse;

export type ShipConversationSummary = {
  conversation_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
};

export type ShipConversationMessage = {
  message_id: string;
  role: 'user' | 'assistant' | string;
  content: unknown;
  created_at: string;
  response?: AssistantResponse | null;
  assistant_response?: AssistantResponse | null;
  metadata?: Record<string, unknown> | null;
};

export type ShipConversationRecipeRun = {
  run_id: string;
  recipe_id: string;
  params: Record<string, unknown>;
  latency_ms: number;
  created_at: string;
};

export type MemoryEntry = {
  run_id: string;
  recipe_id: string | null; // null for derived (refinement) runs
  derived_from_run_id: string | null;
  description: string;       // short human label, e.g. "AB sole-source ≥$250K, FY2023"
  params_summary: string;    // human-friendly param recap
  row_count: number;
  created_at: string;
  pinned: boolean;
};

export type ShipConversation = {
  conversation_id: string;
  title: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
  messages: ShipConversationMessage[];
  recipe_runs: ShipConversationRecipeRun[];

  /** NEW — runs currently held in conversation memory and addressable by id. */
  memory: MemoryEntry[];
};

export type SqlLogEntry = {
  query_name?: string;
  sql_query_name?: string;
  sql?: string;
  query?: string;
  row_count?: number;
  timing_ms?: number;
  rows?: Record<string, unknown>[];
} & Record<string, unknown>;

export type RecipeRun = {
  run_id: string;
  recipe_id: string;
  params: Record<string, unknown>;
  findings: Record<string, unknown>[];
  sql_log: SqlLogEntry[];
  summary: Summary | Record<string, unknown>;
  verification: Verification | Record<string, unknown>;
  latency_ms: number;
  created_at: string;
};

export type RecipeParamSpec = {
  name?: string;
  type?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
} & Record<string, unknown>;

export type RecipeSpec = {
  recipe_id: string;
  description: string;
  examples: string[];
  params: RecipeParamSpec[] | Record<string, unknown>;
  requires_specificity: boolean;
};

export type StreamEvent =
  | { name: 'router_started'; data: Record<string, never> }
  | { name: 'router_decision'; data: { decision: string; recipe_id: string | null; reasoning_one_line: string } }
  | { name: 'phase_started'; data: { phase: string } }
  | { name: 'primitive_started'; data: { primitive_name: string; args_summary: Record<string, unknown> } }
  | { name: 'sql_query_started'; data: { primitive_name: string; query_name: string } }
  | { name: 'sql_query_completed'; data: { primitive_name: string; query_name: string; row_count: number; timing_ms: number } }
  | { name: 'primitive_completed'; data: { primitive_name: string; row_count: number; caveats: string[]; timing_ms: number } }
  | { name: 'summarizer_started'; data: { prompt_token_estimate: number } }
  | { name: 'summarizer_token'; data: { text: string } }
  | { name: 'summarizer_completed'; data: { prompt_tokens: number; completion_tokens: number } }
  | { name: 'verifier_started'; data: Record<string, never> }
  | { name: 'verifier_check'; data: { check: string; status: 'pass' | 'fail'; details: string } }
  | { name: 'verifier_completed'; data: { status: string; failures: string[]; latency_ms: number } }
  | { name: 'web_search_started'; data: { primitive_name: string; query: string } }
  | { name: 'web_search_completed'; data: { primitive_name: string; query: string; result_count: number; timing_ms: number } }
  | { name: 'canlii_started'; data: { entity_name: string; query: string } }
  | { name: 'canlii_completed'; data: { entity_name: string; case_count: number; timing_ms: number } }
  | { name: 'refinement_filter_applied'; data: { filter: Record<string, unknown>; before_count: number; after_count: number } }
  | { name: 'heartbeat'; data: { elapsed_ms: number } }
  | { name: 'final_response'; data: AssistantResponse }
  | { name: 'error'; data: { message: string; retryable: boolean } }
  | { name: 'turn_classifier_started';  data: Record<string, never> }
  | { name: 'turn_classifier_decision'; data: { mode: AnswerResponse['mode'] | 'analytical_query' | 'clarify' | 'new_conversation' | 'not_answerable'; reasoning_one_line: string; referenced_run_ids: string[] } }
  | { name: 'memory_recall';            data: { run_ids: string[]; reason: string } }
  | { name: 'refinement_started';       data: { kind: Operation['kind']; source_run_id: string; description: string } }
  | { name: 'refinement_completed';     data: { kind: Operation['kind']; source_run_id: string; before_count: number; after_count: number; timing_ms: number } }
  | { name: 'composition_started';      data: { kind: 'join' | 'union' | 'intersect' | 'compare'; source_run_ids: string[]; description: string } }
  | { name: 'composition_completed';    data: { kind: 'join' | 'union' | 'intersect' | 'compare'; source_run_ids: string[]; output_count: number; timing_ms: number } }
  | { name: 'diff_computed';            data: AnswerDiff }
  | { name: 'analytical_started';       data: { question: string } }
  | { name: 'concept_extraction_started'; data: Record<string, never> }
  | { name: 'concept_extraction_completed'; data: { concepts: Record<string, unknown>[] } }
  | { name: 'plan_generation_started';  data: Record<string, never> }
  | { name: 'plan_generation_completed'; data: { template_id: string; primary_table: string; joins_count: number; filters_count: number; reasoning_one_line: string } }
  | { name: 'sql_compiled';             data: { sql_query_name: string; query_hash: string; length_chars: number } }
  | { name: 'sandbox_validation_started'; data: Record<string, never> }
  | { name: 'sandbox_validation_completed'; data: { ok: boolean; reason: string | null } }
  | { name: 'sandbox_execution_started'; data: Record<string, never> }
  | { name: 'sandbox_execution_completed'; data: { row_count: number; timing_ms: number; columns: string[] } }
  | { name: 'analytical_completed';     data: { run_id: string; row_count: number; timing_ms: number } };


export type StreamEventName = StreamEvent['name'];

function shipApiBaseUrl(): string {
  const env = import.meta.env.VITE_SHIP_API_BASE_URL as string | undefined;
  return (env?.trim() || DEFAULT_SHIP_API_BASE_URL).replace(/\/+$/, '');
}

function shipUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${shipApiBaseUrl()}${normalizedPath}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

export function isAssistantResponse(value: unknown): value is AssistantResponse {
  if (!isRecord(value) || !isString(value.type) || !isString(value.message_id)) return false;

  if (value.type === 'answer') {
    return (
      isString(value.recipe_run_id) &&
      (value.based_on_run_id === null || isString(value.based_on_run_id)) &&
      isRecord(value.summary) &&
      isRecordArray(value.findings_preview) &&
      isRecord(value.verification) &&
      isNumber(value.latency_ms)
    );
  }

  if (value.type === 'clarification_needed') {
    return (
      isString(value.headline) &&
      isString(value.reason) &&
      isStringArray(value.suggested_narrowings) &&
      isStringArray(value.example_refinements) &&
      isString(value.proceed_phrase)
    );
  }

  if (value.type === 'needs_new_conversation') {
    return (
      isString(value.reason) &&
      isString(value.suggested_starter) &&
      isString(value.current_conversation_topic)
    );
  }

  if (value.type === 'not_answerable') {
    return isString(value.message);
  }

  return false;
}

export function responseFromHistoryMessage(message: ShipConversationMessage): AssistantResponse | null {
  if (isAssistantResponse(message.response)) return message.response;
  if (isAssistantResponse(message.assistant_response)) return message.assistant_response;
  if (isAssistantResponse(message.content)) return message.content;
  if (isRecord(message.metadata)) {
    if (isAssistantResponse(message.metadata.response)) return message.metadata.response;
    if (isAssistantResponse(message.metadata.assistant_response)) return message.metadata.assistant_response;
  }
  if (typeof message.content === 'string') {
    try {
      const parsed = JSON.parse(message.content) as unknown;
      if (isAssistantResponse(parsed)) return parsed;
    } catch {
      // Plain-text assistant history is rendered as not_answerable-style copy by the view.
    }
  }
  return null;
}

export function messageContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (isRecord(content)) {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.message === 'string') return content.message;
    if (typeof content.content === 'string') return content.content;
    if (isAssistantResponse(content)) {
      if (content.type === 'answer') return content.summary.headline;
      if (content.type === 'clarification_needed') return content.headline;
      if (content.type === 'needs_new_conversation') return content.reason;
      return content.message;
    }
  }
  if (content == null) return '';
  return JSON.stringify(content);
}

async function parseError(response: Response): Promise<string> {
  let detail = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as unknown;
    if (isRecord(body)) {
      const error = body.error ?? body.detail ?? body.message;
      if (isString(error)) detail = error;
    }
  } catch {
    try {
      const text = await response.text();
      if (text.trim()) detail = text.trim();
    } catch {
      // Keep the HTTP status fallback.
    }
  }
  return detail;
}

async function shipJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(shipUrl(path), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body == null ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function createConversation(title?: string | null) {
  return shipJson<ShipConversationSummary>('/conversations', {
    method: 'POST',
    body: JSON.stringify(title ? { title } : {}),
  });
}

export function listConversations() {
  return shipJson<{ conversations: ShipConversationSummary[] }>('/conversations');
}

export function getConversation(conversationId: string) {
  return shipJson<ShipConversation>(`/conversations/${encodeURIComponent(conversationId)}`);
}

export function sendMessageSync(conversationId: string, content: string) {
  return shipJson<AssistantResponse>(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export function getRecipeRun(runId: string) {
  return shipJson<RecipeRun>(`/recipe_runs/${encodeURIComponent(runId)}`);
}

export function getCatalog() {
  return shipJson<{ recipes: RecipeSpec[] }>('/catalog');
}

export function deleteConversation(conversationId: string) {
  return shipJson<void>(`/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
  });
}

export function getHealthz() {
  return shipJson<{ status: string }>('/healthz');
}

export function pinRun(conversationId: string, runId: string) {
  return shipJson<void>(`/conversations/${encodeURIComponent(conversationId)}/memory/${encodeURIComponent(runId)}/pin`, {
    method: 'POST',
  });
}

export function unpinRun(conversationId: string, runId: string) {
  return shipJson<void>(`/conversations/${encodeURIComponent(conversationId)}/memory/${encodeURIComponent(runId)}/pin`, {
    method: 'DELETE',
  });
}

export function forgetRun(conversationId: string, runId: string) {
  return shipJson<void>(`/conversations/${encodeURIComponent(conversationId)}/memory/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
  });
}


function isStreamEvent(name: string, data: unknown): data is StreamEvent['data'] {
  if (!isRecord(data)) return false;

  switch (name) {
    case 'router_started':
    case 'verifier_started':
    case 'turn_classifier_started':
    case 'concept_extraction_started':
    case 'plan_generation_started':
    case 'sandbox_validation_started':
    case 'sandbox_execution_started':
      return true;
    case 'router_decision':
      return isString(data.decision) && (data.recipe_id === null || isString(data.recipe_id)) && isString(data.reasoning_one_line);
    case 'phase_started':
      return isString(data.phase);
    case 'primitive_started':
      return isString(data.primitive_name) && isRecord(data.args_summary);
    case 'sql_query_started':
      return isString(data.primitive_name) && isString(data.query_name);
    case 'sql_query_completed':
      return isString(data.primitive_name) && isString(data.query_name) && isNumber(data.row_count) && isNumber(data.timing_ms);
    case 'primitive_completed':
      return isString(data.primitive_name) && isNumber(data.row_count) && isStringArray(data.caveats) && isNumber(data.timing_ms);
    case 'summarizer_started':
      return isNumber(data.prompt_token_estimate);
    case 'summarizer_token':
      return isString(data.text);
    case 'summarizer_completed':
      return isNumber(data.prompt_tokens) && isNumber(data.completion_tokens);
    case 'verifier_check':
      return isString(data.check) && (data.status === 'pass' || data.status === 'fail') && isString(data.details);
    case 'verifier_completed':
      return isString(data.status) && isStringArray(data.failures) && isNumber(data.latency_ms);
    case 'web_search_started':
      return isString(data.primitive_name) && isString(data.query);
    case 'web_search_completed':
      return isString(data.primitive_name) && isString(data.query) && isNumber(data.result_count) && isNumber(data.timing_ms);
    case 'canlii_started':
      return isString(data.entity_name) && isString(data.query);
    case 'canlii_completed':
      return isString(data.entity_name) && isNumber(data.case_count) && isNumber(data.timing_ms);
    case 'refinement_filter_applied':
      return isRecord(data.filter) && isNumber(data.before_count) && isNumber(data.after_count);
    case 'heartbeat':
      return isNumber(data.elapsed_ms);
    case 'final_response':
      return isAssistantResponse(data);
    case 'error':
      return isString(data.message) && typeof data.retryable === 'boolean';
    case 'turn_classifier_decision':
      return isString(data.mode) && isString(data.reasoning_one_line) && isStringArray(data.referenced_run_ids);
    case 'memory_recall':
      return isStringArray(data.run_ids) && isString(data.reason);
    case 'refinement_started':
      return isString(data.kind) && isString(data.source_run_id) && isString(data.description);
    case 'refinement_completed':
      return isString(data.kind) && isString(data.source_run_id) && isNumber(data.before_count) && isNumber(data.after_count) && isNumber(data.timing_ms);
    case 'composition_started':
      return isString(data.kind) && isStringArray(data.source_run_ids) && isString(data.description);
    case 'composition_completed':
      return isString(data.kind) && isStringArray(data.source_run_ids) && isNumber(data.output_count) && isNumber(data.timing_ms);
    case 'diff_computed':
      return isString(data.baseline_run_id) && isNumber(data.rows_added) && isNumber(data.rows_removed) && isNumber(data.rows_changed) && isStringArray(data.columns_added) && isStringArray(data.columns_removed);
    case 'analytical_started':
      return isString(data.question);
    case 'concept_extraction_completed':
      return Array.isArray(data.concepts) && data.concepts.every(isRecord);
    case 'plan_generation_completed':
      return isString(data.template_id) && isString(data.primary_table) && isNumber(data.joins_count) && isNumber(data.filters_count) && isString(data.reasoning_one_line);
    case 'sql_compiled':
      return isString(data.sql_query_name) && isString(data.query_hash) && isNumber(data.length_chars);
    case 'sandbox_validation_completed':
      return typeof data.ok === 'boolean' && (data.reason === null || isString(data.reason));
    case 'sandbox_execution_completed':
      return isNumber(data.row_count) && isNumber(data.timing_ms) && isStringArray(data.columns);
    case 'analytical_completed':
      return isString(data.run_id) && isNumber(data.row_count) && isNumber(data.timing_ms);
    default:
      return true;
  }
}

function unwrapStreamPayload(name: string, data: unknown): { name: string; data: unknown } {
  if (isRecord(data) && typeof data.event === 'string' && 'data' in data) {
    if (data.event !== name) {
      console.warn('[ship] Stream event name mismatch', { envelopeName: name, payloadName: data.event });
    }
    return { name: data.event, data: data.data };
  }
  return { name, data };
}

function toStreamEvent(name: string, data: unknown): StreamEvent | null {
  const payload = unwrapStreamPayload(name, data);
  if (!isStreamEvent(payload.name, payload.data)) {
    console.warn('[ship] Ignoring malformed stream event', { name: payload.name, data: payload.data });
    return null;
  }

  return { name: payload.name as StreamEventName, data: payload.data } as StreamEvent;
}

function parseEventBlock(block: string): { name: string; dataText: string } | null {
  const lines = block.split(/\r?\n/);
  const eventLine = lines.find((line) => line.startsWith('event:'));
  const dataLines = lines.filter((line) => line.startsWith('data:'));
  const name = eventLine?.replace(/^event:\s?/, '').trim();
  const dataText = dataLines.map((line) => line.replace(/^data:\s?/, '')).join('\n');
  return name && dataText ? { name, dataText } : null;
}

export async function streamMessage(
  conversationId: string,
  content: string,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    shipUrl(`/conversations/${encodeURIComponent(conversationId)}/messages?stream=true`),
    {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
      signal,
    },
  );

  if (!response.ok || !response.body) {
    throw new Error(response.ok ? 'Streaming response did not include a body.' : await parseError(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        const parsedBlock = parseEventBlock(block);
        if (!parsedBlock) continue;

        try {
          const payload = JSON.parse(parsedBlock.dataText) as unknown;
          const event = toStreamEvent(parsedBlock.name, payload);
          if (event) onEvent(event);
        } catch (error) {
          console.warn('[ship] Ignoring malformed stream JSON', { block, error });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
