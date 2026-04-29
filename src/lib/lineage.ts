import type { AnswerResponse, Operation, ShipConversation } from './ship';

export function getRunNumber(runId: string | null, conversation: ShipConversation | null): number | null {
  if (!runId || !conversation) return null;
  const index = conversation.recipe_runs.findIndex((r) => r.run_id === runId);
  return index >= 0 ? index + 1 : null;
}

export function formatOperationDescription(op: Operation): string {
  switch (op.kind) {
    case 'recipe_run':
      return op.description;
    case 'filter':
      return `Filtered: ${op.description}`;
    case 'sort':
      return `Sorted: ${op.description}`;
    case 'project':
      return `Columns: ${op.description}`;
    case 'slice':
      return `Slice: ${op.description}`;
    case 'aggregate':
      return `Aggregated: ${op.description}`;
    case 'join':
      return `Joined: ${op.description}`;
    case 'union':
      return `Combined: ${op.description}`;
    case 'intersect':
      return `Intersected: ${op.description}`;
    case 'compare':
      return `Compared: ${op.description}`;
    case 'commentary':
      return op.description;
    default:
      return (op as any).description || 'Operation';
  }
}

export function getOperationSymbol(kind: Operation['kind']): string {
  switch (kind) {
    case 'join': return '⋈';
    case 'union': return '∪';
    case 'intersect': return '∩';
    case 'compare': return '↔';
    default: return '→';
  }
}

export function getRefinementIntent(text: string): 'refine' | 'compose' | 'commentary' | 'fresh' {
  const t = text.toLowerCase();
  if (t.startsWith('/') || /^(filter|sort|show|top|group|drill|limit)/.test(t)) return 'refine';
  if (/(combine|join|merge|compare)/.test(t)) return 'compose';
  if (/(why|explain|tell|elaborate|reason)/.test(t)) return 'commentary';
  return 'fresh';
}

export function deriveSuggestedRefinements(_response: AnswerResponse): string[] {
  // This logic is mostly in followups.ts already, but we can extend it here if needed
  // as per the §5.4 requirements which are more specific about date/numeric/categorical.
  return []; // Placeholder if we want to move logic here
}
