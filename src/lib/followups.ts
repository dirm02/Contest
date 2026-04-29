import type { AnswerResponse } from './ship';

export function generateFollowups(response: AnswerResponse): string[] {
  const followups: string[] = [];
  const pText = response.summary.paragraphs.map((p) => p.text).join(' ');

  // Extract capitalized noun phrases as a heuristic for entities
  const entityMatches = pText.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/g) || [];
  const entities = Array.from(new Set(entityMatches)).filter(
    (e) => e.length > 4 && !['The', 'This', 'Show', 'Are', 'What', 'Who'].includes(e.split(' ')[0])
  );

  if (entities.length > 0) {
    const entity = entities[0];
    followups.push(`What other public funds did ${entity} receive?`);
    followups.push(`Show governance links for ${entity}`);
    if (followups.length < 3) {
      followups.push(`Are there adverse media signals around ${entity}?`);
    }
  }

  // Procurement recipes heuristic
  if (response.recipe_run_id.includes('procurement') || pText.toLowerCase().includes('contract')) {
    if (!followups.includes('Compare with last 5 fiscal years')) {
      followups.push('Compare with last 5 fiscal years');
      followups.push('Show the top 5 vendors in this category');
    }
  }

  // Generic fallback options
  if (followups.length < 2) {
    followups.push('Summarize the key takeaways');
  }

  // Always include an evidence option
  if (!followups.includes('Show me the supporting SQL')) {
    followups.push('Show me the supporting SQL');
  }

  return followups.slice(0, 4);
}
