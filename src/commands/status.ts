import { tool } from "@opencode-ai/plugin";
import { join } from "path";
import type { KnowledgeStats } from "../types";
import { fileExists, findFiles, readTextFile } from "../utils/fs-compat";
import { loadConfig } from "../config";
import { getProjectRootDir, getGitRoot } from "../utils/git";
import { getProjectSkillName } from "../storage/knowledge-writer";

export const statusCommand = tool({
  description: "Display smart-codebase knowledge base status",
  args: {},
  async execute(_input, ctx) {
    try {
      const stats = await getKnowledgeStats(ctx.directory);
      const usageStats = await getUsageStats(ctx.directory);
      const projectName = await getProjectSkillName(ctx.directory);
      const projectRoot = await getProjectRootDir(ctx.directory);
      const gitRoot = await getGitRoot(ctx.directory);

      const indexStatus = stats.hasGlobalIndex ? '✅ exists' : '❌ not created';
      const moduleList = stats.modules.length > 0 
        ? stats.modules.map(m => `  - ${m}`).join('\n')
        : '  (none)';
      
      let output = `📚 smart-codebase Knowledge Status (v0.3.8-dev)
-----------------------------------
Project Name: ${projectName}
Project Root: ${projectRoot}
Git Root:     ${gitRoot || '(not found)'}
-----------------------------------

Global index (.knowledge/KNOWLEDGE.md): ${indexStatus}
Module count: ${stats.moduleCount}

Modules with knowledge:
${moduleList}`;
      
      if (usageStats.totalSkills > 0) {
        output += `

📊 Usage Statistics:
Total SKILLs: ${usageStats.totalSkills}
Total accesses: ${usageStats.totalAccesses}
Low-frequency SKILLs (< ${usageStats.minAccessThreshold} accesses): ${usageStats.lowFrequencyCount}

Usage breakdown:
  - High usage (≥10 accesses): ${usageStats.highUsageCount} SKILLs
  - Medium usage (5-10): ${usageStats.mediumUsageCount} SKILLs
  - Low usage (<5): ${usageStats.lowUsageCount} SKILLs`;
      } else {
        output += `

📊 Usage Statistics:
Total SKILLs: 0
Total accesses: 0
Low-frequency SKILLs (< ${usageStats.minAccessThreshold} accesses): 0

Usage breakdown:
  - High usage (≥10 accesses): 0 SKILLs
  - Medium usage (5-10): 0 SKILLs
  - Low usage (<5): 0 SKILLs`;
      }
      
      return output;
      
    } catch (error) {
      console.error('[smart-codebase] Status command failed:', error);
      return `❌ Failed to get status: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

async function getKnowledgeStats(projectRoot: string): Promise<KnowledgeStats> {
  const rootDir = await getProjectRootDir(projectRoot);
  const indexPath = join(rootDir, '.knowledge', 'KNOWLEDGE.md');
  const hasGlobalIndex = await fileExists(indexPath);
  
  const skillFiles = await findFiles('**/.knowledge/SKILL.md', {
    cwd: rootDir,
    absolute: false,
  });
  
  const modules = skillFiles.map(f => f.replace('/.knowledge/SKILL.md', ''));
  
  return {
    hasGlobalIndex,
    moduleCount: modules.length,
    modules,
  };
}

interface UsageStats {
  totalSkills: number;
  totalAccesses: number;
  lowFrequencyCount: number;
  minAccessThreshold: number;
  highUsageCount: number;
  mediumUsageCount: number;
  lowUsageCount: number;
}

async function getUsageStats(projectRoot: string): Promise<UsageStats> {
  const config = loadConfig();
  const minAccessThreshold = config.cleanupThresholds?.minAccessCount || 5;
  
  const rootDir = await getProjectRootDir(projectRoot);
  const skillsDir = join(rootDir, '.opencode', 'skills');
  
  if (!(await fileExists(skillsDir))) {
    return {
      totalSkills: 0,
      totalAccesses: 0,
      lowFrequencyCount: 0,
      minAccessThreshold,
      highUsageCount: 0,
      mediumUsageCount: 0,
      lowUsageCount: 0,
    };
  }
  
  const moduleSkills = await findFiles('*/modules/*.md', {
    cwd: skillsDir,
    absolute: true,
  });
  
  let totalAccesses = 0;
  let lowFrequencyCount = 0;
  let highUsageCount = 0;
  let mediumUsageCount = 0;
  let lowUsageCount = 0;
  
  for (const skillPath of moduleSkills) {
    try {
      const content = await readTextFile(skillPath);
      const accessCount = extractAccessCount(content);
      
      totalAccesses += accessCount;
      
      if (accessCount < minAccessThreshold) {
        lowFrequencyCount++;
      }
      
      if (accessCount >= 10) {
        highUsageCount++;
      } else if (accessCount >= 5) {
        mediumUsageCount++;
      } else {
        lowUsageCount++;
      }
    } catch (error) {
      continue;
    }
  }
  
  return {
    totalSkills: moduleSkills.length,
    totalAccesses,
    lowFrequencyCount,
    minAccessThreshold,
    highUsageCount,
    mediumUsageCount,
    lowUsageCount,
  };
}

function extractAccessCount(content: string): number {
  const match = content.match(/access_count:\s*(\d+)/);
  if (!match) return 0;
  return parseInt(match[1], 10);
}

