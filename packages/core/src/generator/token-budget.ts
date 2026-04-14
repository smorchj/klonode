/**
 * Token estimation and budget enforcement.
 * Uses a simple word-based approximation (1 token ≈ 0.75 words for English).
 */

export function estimateTokens(text: string): number {
  // Rough estimation: ~4 chars per token for English/code
  return Math.ceil(text.length / 4);
}

export function enforceTokenBudget(text: string, maxTokens: number): string {
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) return text;

  // Trim from the end, preserving complete lines
  const lines = text.split('\n');
  let result = '';
  let tokens = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line + '\n');
    if (tokens + lineTokens > maxTokens) break;
    result += line + '\n';
    tokens += lineTokens;
  }

  return result.trimEnd();
}

export function enforceLineLimit(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n');
}
