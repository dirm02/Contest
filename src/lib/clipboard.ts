import type { AnswerResponse } from './ship';

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch (error) {
    console.error('Failed to copy text', error);
    return false;
  }
}

export function copyText(text: string): Promise<boolean> {
  return copyToClipboard(text);
}

export function copyAnswerAsMarkdown(response: AnswerResponse): Promise<boolean> {
  return copyToClipboard(generateMarkdownReport(response));
}

export function generateMarkdownReport(response: AnswerResponse): string {
  const text: string[] = [];
  text.push(`# ${response.summary.headline}`);
  text.push('');

  for (const p of response.summary.paragraphs) {
    text.push(p.text);
    text.push('');
  }

  if (response.findings_preview.length > 0) {
    text.push('### Findings Preview');
    for (const [index, finding] of response.findings_preview.entries()) {
      text.push(`${index + 1}. ${JSON.stringify(finding)}`);
    }
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
  if (response.based_on_run_id) {
    text.push(`Based on Run ID: \`${response.based_on_run_id}\``);
  }
  text.push(`Latency: ${(response.latency_ms / 1000).toFixed(1)}s`);
  return text.join('\n');
}
