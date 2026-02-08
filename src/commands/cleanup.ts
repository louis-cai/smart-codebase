import { tool } from "@opencode-ai/plugin";
import { join } from "path";
import { unlink } from "fs/promises";
import { findFiles, fileExists, readTextFile, writeTextFile } from "../utils/fs-compat";
import { loadConfig } from "../config";
import { getProjectRootDir } from "../utils/git";
import type { UsageMetadata, CleanupThresholds } from "../types";

interface EligibleSkill {
  name: string;
  path: string;
  ageDays: number;
  accessCount: number;
  inactiveDays: number;
}

interface SkillFrontmatter {
  name: string;
  description: string;
  usage?: UsageMetadata;
}

export const cleanupCommand = tool({
  description: "Clean up low-usage SKILL files",
  args: {
    confirm: tool.schema.boolean().optional().describe("Actually delete files (default is preview mode)"),
  },
  async execute(input, ctx) {
    const confirm = input.confirm ?? false;
    const projectRoot = ctx.directory;

    try {
      const config = loadConfig();
      const thresholds = config.cleanupThresholds || {
        minAgeDays: 60,
        minAccessCount: 5,
        maxInactiveDays: 60,
      };

      const eligible = await findEligibleSkills(projectRoot, thresholds);

      if (eligible.length === 0) {
        return "No skills eligible for cleanup.";
      }

      if (!confirm) {
        return formatPreviewResult(eligible);
      }

      return await performCleanup(projectRoot, eligible);
    } catch (error) {
      console.error('[smart-codebase] Cleanup command failed:', error);
      return `❌ Failed to cleanup: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

async function findEligibleSkills(
  projectRoot: string,
  thresholds: CleanupThresholds
): Promise<EligibleSkill[]> {
  const rootDir = await getProjectRootDir(projectRoot);
  const skillsDir = join(rootDir, '.opencode', 'skills');
  
  if (!(await fileExists(skillsDir))) {
    return [];
  }
  
  const pattern = ".opencode/skills/*/modules/*.md";
  const skillFiles = await findFiles(pattern, {
    cwd: rootDir,
    absolute: true,
  });

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const eligible: EligibleSkill[] = [];

  for (const skillPath of skillFiles) {
    try {
      const content = await readTextFile(skillPath);
      const frontmatter = extractFrontmatter(content);

      if (!frontmatter.usage) {
        continue;
      }

      const usage = frontmatter.usage;
      const createdAt = usage.created_at ? new Date(usage.created_at).getTime() : now;
      const lastAccessed = usage.last_accessed ? new Date(usage.last_accessed).getTime() : createdAt;
      const accessCount = usage.access_count ?? 0;

      const ageDays = Math.floor((now - createdAt) / DAY_MS);
      const inactiveDays = Math.floor((now - lastAccessed) / DAY_MS);

      const isEligible =
        ageDays >= thresholds.minAgeDays &&
        accessCount < thresholds.minAccessCount &&
        inactiveDays >= thresholds.maxInactiveDays;

      if (isEligible) {
        eligible.push({
          name: frontmatter.name,
          path: skillPath,
          ageDays,
          accessCount,
          inactiveDays,
        });
      }
    } catch (error) {
      console.error(`[cleanup] Failed to process ${skillPath}:`, error);
      continue;
    }
  }

  return eligible;
}

function extractFrontmatter(content: string): SkillFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { name: "unknown", description: "" };
  }

  const raw = match[1];
  const lines = raw.split('\n');
  const frontmatter: any = {};
  let currentKey: string | null = null;
  let nestedObject: any = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    if (indent === 0 && trimmed.includes(':')) {
      const [key, ...valueParts] = trimmed.split(':');
      const value = valueParts.join(':').trim();
      currentKey = key.trim();

      if (value) {
        frontmatter[currentKey] = value;
        nestedObject = null;
      } else {
        frontmatter[currentKey] = {};
        nestedObject = frontmatter[currentKey];
      }
    } else if (nestedObject && trimmed.includes(':')) {
      const [key, ...valueParts] = trimmed.split(':');
      const value = valueParts.join(':').trim();
      const nestedKey = key.trim();

      if (nestedKey === 'access_count') {
        nestedObject[nestedKey] = parseInt(value, 10) || 0;
      } else {
        nestedObject[nestedKey] = value;
      }
    }
  }

  return frontmatter as SkillFrontmatter;
}

function formatPreviewResult(eligible: EligibleSkill[]): string {
  const lines: string[] = [];
  
  lines.push(`Found ${eligible.length} skill${eligible.length !== 1 ? 's' : ''} eligible for cleanup:\n`);
  lines.push('| Skill | Age | Access Count | Last Access |');
  lines.push('|-------|-----|--------------|-------------|');
  
  for (const skill of eligible) {
    const lastAccess = skill.inactiveDays === 0 ? 'today' : `${skill.inactiveDays} days ago`;
    lines.push(`| ${skill.name} | ${skill.ageDays} days | ${skill.accessCount} | ${lastAccess} |`);
  }
  
  lines.push('');
  lines.push('Run with --confirm to delete these skills.');
  
  return lines.join('\n');
}

async function performCleanup(
  projectRoot: string,
  eligible: EligibleSkill[]
): Promise<string> {
  const deletedNames: string[] = [];

  for (const skill of eligible) {
    try {
      await unlink(skill.path);
      deletedNames.push(skill.name);
    } catch (error) {
      console.error(`[cleanup] Failed to delete ${skill.path}:`, error);
    }
  }

  await updateMainIndex(projectRoot, deletedNames);

  const lines: string[] = [];
  lines.push(`Deleted ${deletedNames.length} low-usage skill${deletedNames.length !== 1 ? 's' : ''}:`);
  for (const name of deletedNames) {
    lines.push(`- ${name}`);
  }
  lines.push('');
  lines.push('Updated main index.');
  
  return lines.join('\n');
}

async function updateMainIndex(projectRoot: string, deletedNames: string[]): Promise<void> {
  const rootDir = await getProjectRootDir(projectRoot);
  const skillsDir = join(rootDir, '.opencode', 'skills');
  
  if (!(await fileExists(skillsDir))) {
    return;
  }

  const projectDirs = await findFiles('*/SKILL.md', {
    cwd: skillsDir,
    absolute: false,
  });

  if (projectDirs.length === 0) {
    return;
  }

  const indexPath = join(skillsDir, projectDirs[0]);

  if (!(await fileExists(indexPath))) {
    return;
  }

  let content = await readTextFile(indexPath);

  for (const name of deletedNames) {
    const entryRegex = new RegExp(
      `### ${escapeRegex(name)}[\\s\\S]*?(?=\\n### |$)`,
      'g'
    );
    content = content.replace(entryRegex, '').replace(/\n{3,}/g, '\n\n');
  }

  await writeTextFile(indexPath, content.trim() + '\n');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
