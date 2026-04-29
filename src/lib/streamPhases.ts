import type { StreamEvent } from './ship';

export type PhaseStatus = 'pending' | 'running' | 'done' | 'failed';

export type Phase = {
  id: 'route' | 'retrieve' | 'synthesize' | 'verify';
  name: string;
  status: PhaseStatus;
  events: StreamEvent[];
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

  let hasError = events.some((e) => e.name === 'error');
  let hasFinal = events.some((e) => e.name === 'final_response');

  let anyRunning = false;
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

export function formatLatestEvent(events: StreamEvent[]): string {
  const latest = events.filter((e) => e.name !== 'summarizer_token').at(-1);
  if (!latest) return 'Thinking…';
  
  switch (latest.name) {
    case 'router_started':
      return 'Routing';
    case 'router_decision':
      return 'Routing complete';
    case 'phase_started':
      return `Started ${latest.data.phase.replace(/_/g, ' ')}`;
    case 'primitive_started':
      return `Preparing ${latest.data.primitive_name}`;
    case 'sql_query_started':
      return `Querying ${latest.data.query_name}`;
    case 'sql_query_completed':
      return `Queried ${latest.data.query_name}`;
    case 'primitive_completed':
      return `Finished ${latest.data.primitive_name}`;
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
      return `Searching the web for '${latest.data.query}'`;
    case 'web_search_completed':
      return 'Web search complete';
    case 'canlii_started':
      return `Searching CanLII for '${latest.data.entity_name}'`;
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
