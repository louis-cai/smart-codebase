import { tool } from "@opencode-ai/plugin";
import { extractKnowledge } from "../hooks/knowledge-extractor";
import { displayExtractionResult } from "../display/feedback";
import { getPluginInput } from "../plugin-context";
import { loadConfig } from "../config";

export const extractCommand = tool({
  description: "Manually trigger knowledge extraction from codebase",
  args: {},
  async execute(_input, ctx) {
    try {
      const pluginInput = getPluginInput();
      const config = loadConfig();
      const result = await extractKnowledge(pluginInput, ctx.sessionID, config);
      
      return displayExtractionResult(result);
    } catch (error) {
      console.error('[smart-codebase] Extract command failed:', error);
      return `❌ Extraction failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});
