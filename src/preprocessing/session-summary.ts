import type { PluginInput } from "@opencode-ai/plugin";
import type { ToolCallRecord, PreprocessedSummary } from "../types";

const BINARY_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip', '.tar', '.gz'];
const DEFAULT_MAX_TOKENS = 8000;
const MAX_SNIPPET_LINES = 200;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isBinaryFile(filePath: string): boolean {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  return BINARY_EXTENSIONS.includes(ext);
}

function extractTextFromMessageParts(parts: any[] | undefined): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p: any) => p?.type === 'text' && typeof p?.text === 'string')
    .map((p: any) => p.text)
    .join('\n')
    .trim();
}

function getMessageRole(msg: any): string | undefined {
  return msg?.role ?? msg?.info?.role;
}

function getMessageCreatedTime(msg: any): number | undefined {
  const t = msg?.time?.created ?? msg?.info?.time?.created;
  return typeof t === 'number' ? t : undefined;
}

async function fetchConversation(ctx: PluginInput, sessionID: string): Promise<string> {
  const messagesResult = await ctx.client.session.messages({
    path: { id: sessionID }
  });

  if (messagesResult.error) {
    console.error('[smart-codebase] Failed to fetch messages:', messagesResult.error);
    return '';
  }

  const messages = messagesResult.data;
  const transcriptLines: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg: any = (messages as any)[i];
    const role = getMessageRole(msg);
    if (role !== 'user' && role !== 'assistant') continue;

    const text = extractTextFromMessageParts(msg?.parts);
    if (!text) continue;

    const created = getMessageCreatedTime(msg);
    const when = created ? ` @ ${new Date(created).toISOString()}` : '';
    const who = role === 'assistant' ? 'Assistant' : 'User';
    transcriptLines.push(`[${i + 1}] ${who}${when}\n${text}`);
  }

  return transcriptLines.join('\n\n');
}

async function getGitDiff(ctx: PluginInput): Promise<string> {
  try {
    const { execSync } = await import('child_process');
    return execSync('git diff HEAD', {
      cwd: ctx.directory,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    console.error('[smart-codebase] Failed to get git diff:', error);
    return `Failed to get git diff: ${error}`;
  }
}

function formatToolCallsSummary(toolCalls: ToolCallRecord[]): string {
  return toolCalls
    .map(tc => {
      const timestamp = new Date(tc.timestamp).toISOString();
      const target = tc.target ? ` on ${tc.target}` : '';
      return `[${timestamp}] ${tc.tool}${target}`;
    })
    .join('\n');
}

async function extractCodeSnippets(ctx: PluginInput, toolCalls: ToolCallRecord[]): Promise<string> {
  const readToolCalls = toolCalls.filter(tc => tc.tool === 'read' && tc.target && !isBinaryFile(tc.target));
  
  if (readToolCalls.length === 0) {
    return '';
  }

  const snippets: string[] = [];
  
  for (const tc of readToolCalls) {
    if (!tc.target) continue;
    
    try {
      const { readFileSync } = await import('fs');
      const { join } = await import('path');
      const filePath = join(ctx.directory, tc.target);
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').slice(0, MAX_SNIPPET_LINES);
      const snippet = `\n--- ${tc.target} (first ${MAX_SNIPPET_LINES} lines) ---\n${lines.join('\n')}`;
      snippets.push(snippet);
    } catch (error) {
      continue;
    }
  }
  
  return snippets.join('\n\n');
}

type Section = { name: string; content: string; importance: number };

function truncateSections(
  sections: Section[],
  maxTokens: number
): { sections: Section[]; truncated: boolean; originalTokens: number } {
  let totalTokens = sections.reduce((sum, s) => sum + estimateTokens(s.content), 0);
  const originalTokens = totalTokens;
  
  if (totalTokens <= maxTokens) {
    return { sections, truncated: false, originalTokens };
  }

  const originalOrder = sections.map(s => s.name);
  const byName = new Map(sections.map(s => [s.name, { ...s }]));
  const working: Section[] = sections.map(s => ({ ...s }));

  while (totalTokens > maxTokens && working.length > 0) {
    working.sort((a, b) => a.importance - b.importance);
    const victim = working[0];
    const tokensToRemove = totalTokens - maxTokens;
    const sectionTokens = estimateTokens(victim.content);
    
    if (sectionTokens <= tokensToRemove) {
      byName.set(victim.name, { ...victim, content: '' });
      totalTokens -= sectionTokens;
      working.shift();
    } else {
      const targetLength = Math.floor((sectionTokens - tokensToRemove) * 4);
      const truncatedContent = victim.content.substring(0, targetLength) + '\n... [truncated]';
      byName.set(victim.name, { ...victim, content: truncatedContent });
      totalTokens = maxTokens;
      break;
    }
  }

  const finalSections = originalOrder.map((name) => byName.get(name)!).filter(Boolean);
  return { sections: finalSections, truncated: true, originalTokens };
}

export async function preprocessSessionSummary(
  ctx: PluginInput,
  sessionID: string,
  toolCalls: ToolCallRecord[],
  options?: { maxTokens?: number }
): Promise<PreprocessedSummary> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const conversationContent = await fetchConversation(ctx, sessionID);

  const modifiedFiles = new Set(
    toolCalls
      .map(tc => tc.target)
      .filter((t): t is string => !!t && !isBinaryFile(t))
  );

  const diffContent = modifiedFiles.size > 0 ? await getGitDiff(ctx) : '';

  const modifiedFilesContent = Array.from(modifiedFiles)
    .slice(0, 20)
    .map(f => `- ${f}`)
    .join('\n');

  const toolCallsContent = formatToolCallsSummary(toolCalls);
  const snippetsContent = await extractCodeSnippets(ctx, toolCalls);

  const sections: Section[] = [
    { name: 'Conversation', content: conversationContent, importance: 100 },
    { name: 'Diff', content: diffContent, importance: 80 },
    { name: 'ToolCalls', content: toolCallsContent, importance: 60 },
    { name: 'Snippets', content: snippetsContent, importance: 40 }
  ];

  const { sections: truncatedSections, truncated, originalTokens } = truncateSections(sections, maxTokens);

  const finalConversation = truncatedSections.find(s => s.name === 'Conversation')?.content || '';
  const finalDiff = truncatedSections.find(s => s.name === 'Diff')?.content || '';
  const finalToolCalls = truncatedSections.find(s => s.name === 'ToolCalls')?.content || '';
  const finalSnippets = truncatedSections.find(s => s.name === 'Snippets')?.content || '';

  const conversationTokens = estimateTokens(finalConversation);
  const diffTokens = estimateTokens(finalDiff);
  const toolCallTokens = estimateTokens(finalToolCalls);
  const snippetTokens = estimateTokens(finalSnippets);
  const totalTokens = conversationTokens + diffTokens + toolCallTokens + snippetTokens;

  console.log(`[smart-codebase] Pre-processed summary: ~${totalTokens} tokens`);
  console.log(`[smart-codebase] Sections: Conversation=${conversationTokens}, Diff=${diffTokens}, ToolCalls=${toolCallTokens}, Snippets=${snippetTokens}`);

  if (truncated) {
    console.log(`[smart-codebase] Truncated to ${maxTokens} tokens (original: ${originalTokens})`);
  }

  return {
    conversation: finalConversation,
    modifiedFiles: modifiedFilesContent,
    gitDiff: finalDiff,
    toolCallsSummary: finalToolCalls,
    codeSnippets: finalSnippets,
    totalTokens,
    truncated
  };
}
