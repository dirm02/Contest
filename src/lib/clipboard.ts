import type { AnswerResponse } from './ship';

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy text', error);
    return false;
  }
}

export function generateMarkdownReport(response: AnswerResponse): string {
  const text: string[] = [];
  text.push(`# ${response.summary.headline}`);
  text.push('');

  for (const p of response.summary.paragraphs) {
    text.push(p.text);
    text.push('');
  }

  if (response.summary.caveats.length > 0) {
    text.push('### Caveats');
    for (const c of response.summary.caveats) {
      text.push(`- ${c}`);
    }
    text.push('');
  }

  text.push('---');
  text.push(`Run ID: \`${response.recipe_run_id}\``);
  text.push(`Latency: ${(response.latency_ms / 1000).toFixed(1)}s`);
  return text.join('\n');
}
