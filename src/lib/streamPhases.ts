import type { StreamEvent } from './ship';
import {
  Compass,
  Boxes,
  Database,
  Globe,
  Scale,
  PenLine,
  ShieldCheck,
  CheckCircle2,
  Filter,
  type LucideIcon
} from 'lucide-react';

export type PhaseStatus = 'pending' | 'running' | 'done' | 'failed';

export type Phase = {
  id: 'route' | 'retrieve' | 'synthesize' | 'verify';
  name: string;
  status: PhaseStatus;
  events: StreamEvent[];
};

export type ActivityStepKind = 'route' | 'primitive' | 'sql' | 'web' | 'canlii' | 'summarize' | 'verify' | 'verify_check' | 'note';

export type ActivityStep = {
  id: string;
  kind: ActivityStepKind;
  parentId?: string;
  title: string;
  subtitle?: string;
  metadata?: string;
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  completedAt?: number;
};

export const KIND_ICONS: Record<ActivityStepKind, LucideIcon> = {
  route: Compass,
  primitive: Boxes,
  sql: Database,
  web: Globe,
  canlii: Scale,
  summarize: PenLine,
  verify: ShieldCheck,
  verify_check: CheckCircle2,
  note: Filter,
};

export function groupEventsIntoPhases(events: StreamEvent[]): Phase[] {
  const phases: Phase[] = [
    { id: 'route', name: 'Route', status: 'pending', events: [] },
    { id: 'retrieve', name: 'Retrieve', status: 'pending', events: [] },
    { id: 'synthesize', name: 'Synthesize', status: 'pending', events: [] },
    { id: 'verify', name: 'Verify', status: 'pending', events: [] },
  ];

  for (const event of events) {
    let targetPhaseId: Phase['id'] | null = null;
    if (['router_started', 'router_decision'].includes(event.name)) {
      targetPhaseId = 'route';
    } else if (
      [
        'phase_started',
        'primitive_started',
        'sql_query_started',
        'sql_query_completed',
        'primitive_completed',
        'web_search_started',
        'web_search_completed',
        'canlii_started',
        'canlii_completed',
        'refinement_filter_applied',
        'analytical_started',
        'concept_extraction_started',
        'concept_extraction_completed',
        'plan_generation_started',
        'plan_generation_completed',
        'sql_compiled',
        'sandbox_validation_started',
        'sandbox_validation_completed',
        'sandbox_execution_started',
        'sandbox_execution_completed',
        'analytical_completed',
      ].includes(event.name)
    ) {
      targetPhaseId = 'retrieve';
    } else if (['summarizer_started', 'summarizer_token', 'summarizer_completed'].includes(event.name)) {
      targetPhaseId = 'synthesize';
    } else if (['verifier_started', 'verifier_check', 'verifier_completed'].includes(event.name)) {
      targetPhaseId = 'verify';
    }

    if (targetPhaseId) {
      const phase = phases.find((p) => p.id === targetPhaseId);
      if (phase) {
        phase.events.push(event);
      }
    }
  }

  const hasError = events.some((e) => e.name === 'error');
  const hasFinal = events.some((e) => e.name === 'final_response');

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    if (phase.events.length > 0) {
      phase.status = 'running';

      // If we have a next phase with events, this phase must be done
      if (i < phases.length - 1 && phases[i + 1].events.length > 0) {
        phase.status = 'done';
      }
    }
  }

  if (hasFinal) {
    phases.forEach((p) => {
      if (p.events.length > 0) p.status = 'done';
    });
  } else if (hasError) {
    const runningPhase = phases.find((p) => p.status === 'running');
    if (runningPhase) runningPhase.status = 'failed';
  }

  return phases;
}

export function buildActivitySteps(events: StreamEvent[]): ActivityStep[] {
  const steps: ActivityStep[] = [];
  const primitiveMap = new Map<string, string>(); // primitive_name -> step.id

  for (const event of events) {
    switch (event.name) {
      case 'router_started':
        steps.push({
          id: 'route',
          kind: 'route',
          title: 'Routing your question',
          status: 'running',
          startedAt: Date.now(),
        });
        break;

      case 'router_decision': {
        const routeStep = steps.find(s => s.id === 'route');
        if (routeStep) {
          routeStep.title = `Routed via ${event.data.decision}`;
          routeStep.status = 'done';
          routeStep.completedAt = Date.now();
          routeStep.metadata = event.data.recipe_id || undefined;
        }
        break;
      }

      case 'turn_classifier_started':
        steps.push({
          id: 'turn-classifier',
          kind: 'route',
          title: 'Reading the question',
          status: 'running',
          startedAt: Date.now(),
        });
        break;

      case 'turn_classifier_decision': {
        const step = steps.find(s => s.id === 'turn-classifier');
        if (step) {
          step.title = `Question mode: ${event.data.mode.replace(/_/g, ' ')}`;
          step.subtitle = event.data.reasoning_one_line;
          step.status = 'done';
          step.completedAt = Date.now();
        }
        break;
      }

      case 'analytical_started':
        steps.push({
          id: 'analytical',
          kind: 'primitive',
          title: 'Planning a warehouse query',
          subtitle: event.data.question,
          status: 'running',
          startedAt: Date.now(),
        });
        break;

      case 'concept_extraction_started':
        steps.push({
          id: 'concept-extraction',
          kind: 'note',
          parentId: 'analytical',
          title: 'Matching question terms to data concepts',
          status: 'running',
          startedAt: Date.now(),
        });
        break;

      case 'concept_extraction_completed': {
        const step = steps.find(s => s.id === 'concept-extraction');
        if (step) {
          step.status = 'done';
          step.completedAt = Date.now();
          step.metadata = `${event.data.concepts.length} concept${event.data.concepts.length === 1 ? '' : 's'}`;
        }
        break;
      }

      case 'plan_generation_started':
        steps.push({
          id: 'plan-generation',
          kind: 'note',
          parentId: 'analytical',
          title: 'Choosing the query shape',
          status: 'running',
          startedAt: Date.now(),
        });
        break;

      case 'plan_generation_completed': {
        const step = steps.find(s => s.id === 'plan-generation');
        if (step) {
          step.status = 'done';
          step.completedAt = Date.now();
          step.subtitle = event.data.reasoning_one_line;
          step.metadata = event.data.template_id;
        }
        break;
      }

      case 'sql_compiled':
        steps.push({
          id: 'sql-compiled',
          kind: 'sql',
          parentId: 'analytical',
          title: `Compiled ${event.data.sql_query_name}`,
          metadata: `${event.data.length_chars.toLocaleString()} chars`,
          status: 'done',
          startedAt: Date.now(),
          completedAt: Date.now(),
        });
        break;

      case 'sandbox_validation_started':
        steps.push({
          id: 'sandbox-validation',
          kind: 'sql',
          parentId: 'analytical',
          title: 'Checking query safety',
          status: 'running',
          startedAt: Date.now(),
        });
        break;

      case 'sandbox_validation_completed': {
        const step = steps.find(s => s.id === 'sandbox-validation');
        if (step) {
          step.status = event.data.ok ? 'done' : 'failed';
          step.completedAt = Date.now();
          step.subtitle = event.data.reason ?? undefined;
        }
        break;
      }

      case 'sandbox_execution_started':
        steps.push({
          id: 'sandbox-execution',
          kind: 'sql',
          parentId: 'analytical',
          title: 'Running sandbox query',
          status: 'running',
          startedAt: Date.now(),
        });
        break;

      case 'sandbox_execution_completed': {
        const step = steps.find(s => s.id === 'sandbox-execution');
        if (step) {
          step.status = 'done';
          step.completedAt = Date.now();
          const secs = (event.data.timing_ms / 1000).toFixed(1);
          step.metadata = `${event.data.row_count.toLocaleString()} rows · ${secs}s`;
        }
        break;
      }

      case 'analytical_completed': {
        const step = steps.find(s => s.id === 'analytical');
        if (step) {
          step.status = 'done';
          step.completedAt = Date.now();
          const secs = (event.data.timing_ms / 1000).toFixed(1);
          step.metadata = `${event.data.row_count.toLocaleString()} rows · ${secs}s`;
        }
        break;
      }

      case 'primitive_started': {
        const id = `primitive-${event.data.primitive_name}-${steps.length}`;
        primitiveMap.set(event.data.primitive_name, id);

        // Humanize primitive name to Sentence case
        const name = event.data.primitive_name.replace(/_/g, ' ');
        const humanTitle = name.charAt(0).toUpperCase() + name.slice(1);

        // Format subtitle from top 2 args
        let subtitle = '';
        if (event.data.args_summary) {
          subtitle = Object.entries(event.data.args_summary)
            .slice(0, 2)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
        }

        steps.push({
          id,
          kind: 'primitive',
          title: humanTitle,
          subtitle,
          status: 'running',
          startedAt: Date.now(),
        });
        break;
      }

      case 'primitive_completed': {
        const id = primitiveMap.get(event.data.primitive_name);
        const step = steps.find(s => s.id === id);
        if (step) {
          step.status = 'done';
          step.completedAt = Date.now();
          const secs = (event.data.timing_ms / 1000).toFixed(1);
          step.metadata = `${event.data.row_count.toLocaleString()} rows · ${secs}s`;
        }
        break;
      }

      case 'sql_query_started': {
        const parentId = primitiveMap.get(event.data.primitive_name);
        steps.push({
          id: `sql-${event.data.query_name}-${steps.length}`,
          kind: 'sql',
          parentId,
          title: `Querying ${event.data.query_name}`,
          status: 'running',
          startedAt: Date.now(),
        });
        break;
      }

      case 'sql_query_completed': {
        const step = steps.find(s => s.kind === 'sql' && s.title.includes(event.data.query_name) && s.status === 'running');
        if (step) {
          step.status = 'done';
          step.completedAt = Date.now();
          const secs = (event.data.timing_ms / 1000).toFixed(1);
          step.metadata = `${event.data.row_count.toLocaleString()} rows · ${secs}s`;
        }
        break;
      }

      case 'web_search_started':
        steps.push({
          id: `web-${steps.length}`,
          kind: 'web',
          parentId: Array.from(primitiveMap.values()).pop(), // Attach to latest primitive
          title: 'Searching the web',
          subtitle: `"${event.data.query}"`,
          status: 'running',
          startedAt: Date.now(),
        });
        break;

      case 'web_search_completed': {
        const step = steps.find(s => s.kind === 'web' && s.status === 'running');
        if (step) {
          step.status = 'done';
          step.completedAt = Date.now();
        }
        break;
      }

      case 'canlii_started':
        steps.push({
          id: `canlii-${steps.length}`,
          kind: 'canlii',
          parentId: Array.from(primitiveMap.values()).pop(),
          title: `Searching CanLII for ${event.data.entity_name}`,
          subtitle: `"${event.data.query}"`,
          status: 'running',
          startedAt: Date.now(),
        });
        break;

      case 'canlii_completed': {
        const step = steps.find(s => s.kind === 'canlii' && s.status === 'running');
        if (step) {
          step.status = 'done';
          step.completedAt = Date.now();
        }
        break;
      }

      case 'summarizer_started':
        steps.push({
          id: 'summarize',
          kind: 'summarize',
          title: 'Drafting the answer',
          subtitle: event.data.prompt_token_estimate ? `~${event.data.prompt_token_estimate.toLocaleString()} input tokens` : undefined,
          status: 'running',
          startedAt: Date.now(),
        });
        break;

      case 'summarizer_completed': {
        const step = steps.find(s => s.id === 'summarize');
        if (step) {
          step.status = 'done';
          step.completedAt = Date.now();
        }
        break;
      }

      case 'verifier_started':
        steps.push({
          id: 'verify',
          kind: 'verify',
          title: 'Checking grounding',
          status: 'running',
          startedAt: Date.now(),
        });
        break;

      case 'verifier_check':
        steps.push({
          id: `verify-check-${steps.length}`,
          kind: 'verify_check',
          parentId: 'verify',
          title: event.data.check.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
          subtitle: event.data.details,
          status: 'done', // These are usually point-in-time
          startedAt: Date.now(),
        });
        break;

      case 'verifier_completed': {
        const step = steps.find(s => s.id === 'verify');
        if (step) {
          step.status = 'done';
          step.completedAt = Date.now();
        }
        break;
      }

      case 'refinement_filter_applied':
        steps.push({
          id: `note-${steps.length}`,
          kind: 'note',
          parentId: Array.from(primitiveMap.values()).pop(),
          title: `Refined ${event.data.before_count.toLocaleString()} → ${event.data.after_count.toLocaleString()} rows`,
          status: 'done',
          startedAt: Date.now(),
        });
        break;
    }
  }

  return steps;
}

export function formatLatestEvent(events: StreamEvent[]): string {
  const latest = events.filter((e) => e.name !== 'summarizer_token').at(-1);
  if (!latest) return 'Thinking…';

  switch (latest.name) {
    case 'router_started':
      return 'Routing';
    case 'router_decision':
      return 'Routing complete';
    case 'turn_classifier_started':
      return 'Reading question';
    case 'turn_classifier_decision':
      return `Selected ${latest.data.mode.replace(/_/g, ' ')}`;
    case 'phase_started':
      return `Started ${latest.data.phase.replace(/_/g, ' ')}`;
    case 'analytical_started':
      return 'Planning warehouse query';
    case 'concept_extraction_started':
      return 'Matching concepts';
    case 'concept_extraction_completed':
      return 'Concepts matched';
    case 'plan_generation_started':
      return 'Planning query';
    case 'plan_generation_completed':
      return 'Query plan ready';
    case 'sql_compiled':
      return 'SQL compiled';
    case 'sandbox_validation_started':
      return 'Checking SQL safety';
    case 'sandbox_validation_completed':
      return latest.data.ok ? 'SQL safety check passed' : 'SQL safety check failed';
    case 'sandbox_execution_started':
      return 'Running sandbox query';
    case 'sandbox_execution_completed':
      return 'Sandbox query complete';
    case 'analytical_completed':
      return 'Retrieved evidence';
    case 'primitive_started':
      return `Preparing ${latest.data.primitive_name.replace(/_/g, ' ')}`;
    case 'sql_query_started':
      return `Querying ${latest.data.query_name}`;
    case 'sql_query_completed':
      return `Queried ${latest.data.query_name}`;
    case 'primitive_completed':
      return `Finished ${latest.data.primitive_name.replace(/_/g, ' ')}`;
    case 'summarizer_started':
      return 'Drafting answer';
    case 'summarizer_completed':
      return 'Answer drafted';
    case 'verifier_started':
      return 'Verifying citations';
    case 'verifier_check':
      return 'Running verification checks';
    case 'verifier_completed':
      return 'Verification complete';
    case 'web_search_started':
      return `Searching the web`;
    case 'web_search_completed':
      return 'Web search complete';
    case 'canlii_started':
      return `Searching CanLII`;
    case 'canlii_completed':
      return 'CanLII search complete';
    case 'refinement_filter_applied':
      return 'Refining findings';
    case 'heartbeat':
      return 'Still working';
    case 'final_response':
      return 'Done';
    case 'error':
      return 'Error occurred';
    default:
      return 'Thinking…';
  }
}
