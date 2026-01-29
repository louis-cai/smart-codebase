import type { PluginInput, Hooks } from "@opencode-ai/plugin";
import type { PluginConfig, ToolCallRecord } from "../types";
import { join } from "path";
import { 
  writeModuleSkill, 
  updateGlobalIndex,
  updateSkillIndex,
  getModulePath,
  toSkillName,
  type SkillContent,
  type IndexEntry
} from "../storage/knowledge-writer";
import { unwrapData, extractTextFromParts, withTimeout } from "../utils/sdk-helpers";
import { fileExists, readTextFile } from "../utils/fs-compat";
import { displayExtractionResult } from "../display/feedback";
import { preprocessSessionSummary } from "../preprocessing/session-summary";

type ToolExecuteAfterInput = Parameters<NonNullable<Hooks["tool.execute.after"]>>[0];
type ToolExecuteAfterOutput = Parameters<NonNullable<Hooks["tool.execute.after"]>>[1];
type EventInput = Parameters<NonNullable<Hooks["event"]>>[0];

const sessionDebounceTimers = new Map<string, NodeJS.Timeout>();
const sessionToolCalls = new Map<string, ToolCallRecord[]>();
const sessionExtractionInProgress = new Map<string, boolean>();
const sessionToastShown = new Map<string, boolean>();

function getToolCalls(sessionID: string): ToolCallRecord[] {
  if (!sessionToolCalls.has(sessionID)) {
    sessionToolCalls.set(sessionID, []);
  }
  return sessionToolCalls.get(sessionID)!;
}

function parseModelConfig(modelString?: string): { providerID: string; modelID: string } | undefined {
  if (!modelString) return undefined;
  const [providerID, ...rest] = modelString.split('/');
  const modelID = rest.join('/');
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export interface ExtractionResult {
  modulesUpdated: number;
  sectionsAdded: number;
  indexUpdated: boolean;
}

export async function extractKnowledge(
  ctx: PluginInput, 
  sessionID: string,
  config?: PluginConfig
): Promise<ExtractionResult> {
  if (sessionExtractionInProgress.get(sessionID)) {
    console.log(`[smart-codebase] Extraction already in progress for session ${sessionID}, skipping`);
    return { modulesUpdated: 0, sectionsAdded: 0, indexUpdated: false };
  }

  sessionExtractionInProgress.set(sessionID, true);

  let extractionSessionID: string | undefined;
  const result: ExtractionResult = { modulesUpdated: 0, sectionsAdded: 0, indexUpdated: false };

  try {
     const toolCalls = sessionToolCalls.get(sessionID);

     if (!toolCalls || toolCalls.length === 0) {
       console.log(`[smart-codebase] No tool calls tracked in session ${sessionID}, skipping extraction`);
       return result;
     }

      const modifiedFiles = new Set(toolCalls.map(tc => tc.target).filter((t): t is string => !!t));
      
      console.log(`[smart-codebase] Knowledge extraction triggered for session ${sessionID}`);
      console.log(`[smart-codebase] Tool calls tracked (${toolCalls.length}), files involved (${modifiedFiles.size}):`, Array.from(modifiedFiles));

     const preprocessed = await preprocessSessionSummary(ctx, sessionID, toolCalls, {
       maxTokens: config?.extractionMaxTokens,
     });
     console.log(`[smart-codebase] Pre-processed summary: ${preprocessed.totalTokens} tokens${preprocessed.truncated ? ' (truncated)' : ''}`);

     const createResult = await ctx.client.session.create({
       body: {
         title: 'Knowledge Extraction',
         parentID: sessionID,
       }
     });

     if (createResult.error) {
       console.error('[smart-codebase] Failed to create extraction session:', createResult.error);
       return result;
     }

     extractionSessionID = createResult.data.id;
     console.log(`[smart-codebase] Created extraction session: ${extractionSessionID}`);

     const primaryFile = Array.from(modifiedFiles)[0];
     const primaryModulePath = getModulePath(primaryFile, ctx.directory);
     
     const existingSkillPath = join(ctx.directory, primaryModulePath, '.knowledge', 'SKILL.md');
     let existingSkillContent = '';
     if (await fileExists(existingSkillPath)) {
       existingSkillContent = await readTextFile(existingSkillPath);
       console.log(`[smart-codebase] Found existing SKILL.md at ${existingSkillPath}, will merge`);
     }

     const existingSkillSection = existingSkillContent 
       ? `\nEXISTING SKILL.md (merge with this):\n\`\`\`markdown\n${existingSkillContent}\n\`\`\`\n`
       : '\nNo existing SKILL.md found. Create new.\n';

     const systemContext = `You are smart-codebase: a knowledge distillation agent that writes/updates a module-level SKILL.md.

PRIMARY SIGNAL - FULL CONVERSATION TRANSCRIPT (User + Assistant):
${preprocessed.conversation || '(No conversation transcript available)'}

SECONDARY SIGNALS (use to verify / add file paths / fill gaps; may be truncated):

FILES TOUCHED:
${preprocessed.modifiedFiles || '(none)'}

GIT DIFF:
${preprocessed.gitDiff || '(No git diff available)'}

TOOL CALLS (activity trail):
${preprocessed.toolCallsSummary || '(none)'}

SNIPPETS (from prior reads; partial):
${preprocessed.codeSnippets || '(none)'}
${existingSkillSection}
YOUR TASK:
Extract durable, project-specific knowledge that helps future AI sessions understand what was done, why, and how to work with it safely.

EXTRACTION GUIDELINES:
1. PRIORITIZE the conversation: the user's intent + the assistant's explanations are valuable knowledge
2. If the user mentions "I added/fixed/implemented X", focus on X even if phrased as a question
3. IGNORE incidental changes: Config files (.husky, .vscode, package.json) unless they're the main work
4. BE PRACTICAL: If there's real implementation knowledge (patterns, gotchas, decisions), extract it
5. DON'T be overly conservative: Code changes + user context = valuable knowledge

INCREMENTAL READING (TOOLS ARE ALLOWED):
- You MAY use tools to verify details or fill missing context
- Be surgical: do not read entire files
- Progressive disclosure:
  1) skim file list + diff headers to pick targets
  2) read file header/exports/types first (small read with offset/limit)
  3) grep/ast-grep for symbols/strings
  4) read narrow windows around definitions, expand only if needed
- Stop once you can write accurate SKILL.md knowledge

Common scenarios where you SHOULD extract:
- User says "I added X feature" → Extract knowledge about X (even if they're asking where they put it)
- User describes implementation details → Extract the patterns/decisions
- User fixed a bug and explains the cause → Extract the gotcha
- Assistant explained a design decision → Capture the reasoning

Skip extraction ONLY if:
- Pure config/tooling changes with no user context
- User just asked questions without describing any work
- Changes are truly trivial (typo fixes, formatting)

If existing SKILL.md provided, MERGE new knowledge intelligently:
- Preserve valuable existing content
- Update outdated information with new learnings
- Add new sections for new topics
- Improve descriptions if new context makes them clearer
- Remove redundant or contradictory content

OUTPUT FORMAT - Return JSON with COMPLETE merged content:
{
  "skill": {
    "modulePath": "src/invoice",
    "name": "invoice-processing",
    "description": "Handles invoice form validation and submission. Use when modifying invoice-related forms or validation logic.",
    "sections": [
      {
        "heading": "Form validation",
        "content": "Amount field uses Decimal type to avoid precision issues.\\nInvoice number format: INV-YYYYMMDD-XXXX"
      }
    ],
    "relatedFiles": ["src/invoice/form.tsx"]
  }
}

GUIDELINES:
- name: lowercase, hyphens only, max 64 chars (e.g., "invoice-processing")
- description: Third person, includes "Use when..." trigger. Max 200 chars.
- sections: COMPLETE list after merging. Include both existing and new sections.
- content: Use \\n for newlines. No verbose explanations. Concise, project-specific.
- relatedFiles: COMPLETE list after merging.

Return ONLY valid JSON. If no significant learnings: {"skill": null}`;

     const extractionPrompt = `Produce the merged SKILL JSON now. Use the conversation as primary signal; verify with diff/snippets as needed; use tools incrementally if required. Return ONLY valid JSON (no markdown fences).`;

    const model = parseModelConfig(config?.extractionModel);
    console.log(`[smart-codebase] Sending extraction prompt to AI...${model ? ` (model: ${config?.extractionModel})` : ''}`);
    const promptResult = await withTimeout(
      ctx.client.session.prompt({
        path: { id: extractionSessionID },
        body: {
          ...(model && { model }),
          system: systemContext,
          parts: [{ type: 'text', text: extractionPrompt }]
        }
      }),
      120000
    );

    const response = unwrapData(promptResult as any) as { parts: any[] };
    const text = extractTextFromParts(response.parts);
    console.log(`[smart-codebase] Received AI response (${text.length} chars)`);

    let extracted: { skill: any } | null = null;
    try {
      let cleanText = text.trim();
      if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      }
      extracted = JSON.parse(cleanText);
    } catch (error) {
      console.error('[smart-codebase] Failed to parse AI response as JSON:', error);
      return result;
    }

    if (!extracted?.skill) {
      console.log('[smart-codebase] No significant knowledge extracted');
      return result;
    }

    const s = extracted.skill;

    const skillContent: SkillContent = {
      metadata: {
        name: s.name || toSkillName(s.modulePath),
        description: s.description || `Handles ${s.modulePath} module. Use when working on related files.`
      },
      sections: (s.sections || []).map((sec: any) => ({
        heading: sec.heading,
        content: sec.content
      })),
      relatedFiles: s.relatedFiles || []
    };

    const skillPath = await writeModuleSkill(
      ctx.directory,
      s.modulePath || '.',
      skillContent
    );
    console.log(`[smart-codebase] Updated module skill: ${skillPath}`);
    result.modulesUpdated = 1;
    result.sectionsAdded = skillContent.sections.length;

    const indexEntry: IndexEntry = {
      name: skillContent.metadata.name,
      description: skillContent.metadata.description,
      location: `${s.modulePath || '.'}/.knowledge/SKILL.md`
    };

     await updateGlobalIndex(ctx.directory, indexEntry);
     console.log(`[smart-codebase] Updated global knowledge index`);
     
     await updateSkillIndex(ctx.directory, indexEntry);
     console.log(`[smart-codebase] Updated OpenCode skill index`);
     result.indexUpdated = true;

     sessionToolCalls.delete(sessionID);

     return result;
  } catch (error) {
    console.error(`[smart-codebase] Failed to extract knowledge for session ${sessionID}:`, error);
    return result;
  } finally {
    sessionExtractionInProgress.delete(sessionID);

    if (extractionSessionID) {
      try {
        await ctx.client.session.delete({
          path: { id: extractionSessionID }
        });
        console.log(`[smart-codebase] Cleaned up extraction session: ${extractionSessionID}`);
      } catch (error) {
        console.error(`[smart-codebase] Failed to cleanup extraction session:`, error);
      }
    }
  }
}

export function createKnowledgeExtractorHook(ctx: PluginInput, config?: PluginConfig) {
  const toolExecuteAfter = async (
    input: ToolExecuteAfterInput,
    output: ToolExecuteAfterOutput,
  ) => {
    const toolName = input.tool.toLowerCase();

    // Filter out config and tui operations
    if (toolName.startsWith('config.') || toolName.startsWith('tui.')) {
      return;
    }

    // Skip tracking for extraction sessions (child sessions)
    // Extraction sessions have parentID set
    try {
      const session = await ctx.client.session.get({ path: { id: input.sessionID } });
      if (session.data?.parentID) {
        return; // Don't track tool calls from extraction sessions
      }
    } catch (error) {
      console.error(`[smart-codebase] Failed to check session parentID:`, error);
      return;
    }

    try {
      const target = output.title as string | undefined;
      const toolCalls = getToolCalls(input.sessionID);
      
      const record: ToolCallRecord = {
        tool: toolName,
        target,
        timestamp: Date.now()
      };
      
      toolCalls.push(record);
      console.log(`[smart-codebase] Tracked tool call: ${toolName}${target ? ` on ${target}` : ''}`);
    } catch (error) {
      console.error(`[smart-codebase] Failed to track tool call:`, error);
    }
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined;
      if (!sessionID) return;

       if (config?.autoExtract === false) {
         // Check if we should show toast
         const toolCalls = sessionToolCalls.get(sessionID);
         if (toolCalls && toolCalls.length > 0 && !sessionToastShown.get(sessionID)) {
           await ctx.client.tui.showToast({
             body: {
               title: "smart-codebase",
               message: "可运行 /sc-extract 提取知识",
               variant: "info",
               duration: 8000,
             },
           }).catch(() => {});
           sessionToastShown.set(sessionID, true);
           console.log(`[smart-codebase] Toast notification triggered for session ${sessionID}`);
         }
         return;
       }

      const existingTimer = sessionDebounceTimers.get(sessionID);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const debounceMs = config?.debounceMs ?? 15000;
      const timer = setTimeout(async () => {
        const extractionResult = await extractKnowledge(ctx, sessionID, config);

        const message = displayExtractionResult(extractionResult);

        await ctx.client.tui.showToast({
          body: {
            title: "smart-codebase",
            message,
            variant: "success",
            duration: 5000,
          },
        }).catch(() => {});

        sessionDebounceTimers.delete(sessionID);
      }, debounceMs);

      sessionDebounceTimers.set(sessionID, timer);
      console.log(`[smart-codebase] Session ${sessionID} idle, extraction scheduled in ${debounceMs}ms`);
    }

     if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id) {
          const timer = sessionDebounceTimers.get(sessionInfo.id);
          if (timer) {
            clearTimeout(timer);
          }
          sessionDebounceTimers.delete(sessionInfo.id);
          sessionToolCalls.delete(sessionInfo.id);
          sessionToastShown.delete(sessionInfo.id);
          console.log(`[smart-codebase] Cleaned up session ${sessionInfo.id}`);
        }
      }
  };

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  };
}
