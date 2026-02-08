import { mkdir } from 'fs/promises';
import { join, dirname, relative, resolve, isAbsolute, basename } from 'path';
import { fileExists, readTextFile, writeTextFile, sleep, removeFile } from '../utils/fs-compat';
import { getGitRoot, getProjectRootDir } from '../utils/git';

export interface SkillMetadata {
  name: string;
  description: string;
}

export interface SkillContent {
  metadata: SkillMetadata;
  sections: SkillSection[];
  relatedFiles?: string[];
}

export interface SkillSection {
  heading: string;
  content: string;
}

export interface IndexEntry {
  name: string;
  description: string;
  location: string;
}

export async function writeModuleSkill(
  projectRoot: string,
  modulePath: string,
  skill: SkillContent
): Promise<string> {
  const rootDir = await getProjectRootDir(projectRoot);
  const projectName = await getProjectSkillName(projectRoot);
  const skillName = toSkillName(modulePath);
  const skillDir = join(rootDir, '.opencode', 'skills', projectName, 'modules');
  const skillPath = join(skillDir, `${skillName}.md`);
  const lockFile = join(skillDir, '.lock');

  await mkdir(skillDir, { recursive: true });

  const lock = await acquireLock(lockFile, 5000);

  try {
    let existingContent = '';
    if (await fileExists(skillPath)) {
      existingContent = await readTextFile(skillPath);
    }

    const content = formatSkillContent(skill, existingContent);
    await writeTextFile(skillPath, content);
    return skillPath;
  } finally {
    await releaseLock(lock);
  }
}

function formatSkillContent(skill: SkillContent, existingContent?: string): string {
  const lines: string[] = [];

  let createdAt = new Date().toISOString();
  const lastUpdated = new Date().toISOString();

  if (existingContent) {
    const createdMatch = existingContent.match(/created_at:\s*([^\s]+)/);
    if (createdMatch) {
      createdAt = createdMatch[1];
    }
  }

  lines.push('---');
  lines.push(`name: ${skill.metadata.name}`);
  lines.push(`description: ${skill.metadata.description}`);
  lines.push('usage:');
  lines.push(`  created_at: ${createdAt}`);
  lines.push(`  last_updated: ${lastUpdated}`);
  lines.push('---');
  lines.push('');

  for (const section of skill.sections) {
    lines.push(`## ${section.heading}`);
    lines.push('');
    lines.push(section.content);
    lines.push('');
  }

  if (skill.relatedFiles && skill.relatedFiles.length > 0) {
    lines.push('## Related files');
    lines.push('');
    for (const file of skill.relatedFiles) {
      lines.push(`- \`${file}\``);
    }
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}

export async function updateGlobalIndex(
  projectRoot: string,
  entry: IndexEntry
): Promise<void> {
  const rootDir = await getProjectRootDir(projectRoot);
  const knowledgeDir = join(rootDir, '.knowledge');
  const indexPath = join(knowledgeDir, 'KNOWLEDGE.md');
  const lockFile = join(rootDir, '.knowledge.lock');

  await mkdir(knowledgeDir, { recursive: true });

  const lock = await acquireLock(lockFile, 5000);

  try {
    let content = '';
    if (await fileExists(indexPath)) {
      content = await readTextFile(indexPath);
    }

    if (!content.includes('# Project Knowledge')) {
      content = `# Project Knowledge

> Project knowledge index. Read this first to understand available domain knowledge, then read relevant module SKILLs as needed.

`;
    }

    const entryMarker = `### ${entry.name}`;
    if (content.includes(entryMarker)) {
      const entryRegex = new RegExp(
        `### ${escapeRegex(entry.name)}[\\s\\S]*?(?=\\n### |$)`,
        'g'
      );
      content = content.replace(entryRegex, formatIndexEntry(entry));
    } else {
      content = content.trimEnd() + '\n\n' + formatIndexEntry(entry);
    }

    await writeTextFile(indexPath, content);
  } finally {
    await releaseLock(lock);
  }
}

function formatIndexEntry(entry: IndexEntry): string {
  return `### ${entry.name}
${entry.description}
- **Location**: \`${entry.location}\`
`;
}

export function toSkillName(modulePath: string): string {
  if (modulePath === '.') return 'project-root';
  
  return modulePath
    .replace(/[\/\\]/g, '-')
    .replace(/[^a-z0-9-]/gi, '')
    .toLowerCase()
    .slice(0, 64);
}

export async function getProjectSkillName(projectRoot: string): Promise<string> {
  const rootDir = await getProjectRootDir(projectRoot);
  
  // Try to find config file first
  const configPaths = [
    join(rootDir, '.opencode', 'smart-codebase.json'),
    join(rootDir, '.opencode', 'smart-codebase.jsonc'),
  ];

  for (const configPath of configPaths) {
    if (await fileExists(configPath)) {
      try {
        const content = await readTextFile(configPath);
        // Simple JSON parse (ignoring potential comments in jsonc for now)
        // A more robust approach would be to strip comments, but for now let's try simple
        const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
        const config = JSON.parse(cleanContent);
        if (config.projectName || config.name) {
          return sanitizeSkillName(config.projectName || config.name);
        }
      } catch (e) {
        console.error(`[smart-codebase] Failed to parse config at ${configPath}:`, e);
      }
    }
  }

  const gitRoot = await getGitRoot(projectRoot);
  const folderName = basename(gitRoot || projectRoot);
  return sanitizeSkillName(folderName);
}

function sanitizeSkillName(name: string): string {
  return name
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 64) || 'project';
}

export async function updateSkillIndex(
  projectRoot: string,
  entry: IndexEntry
): Promise<void> {
  const rootDir = await getProjectRootDir(projectRoot);
  const skillName = await getProjectSkillName(projectRoot);
  const skillDir = join(rootDir, '.opencode', 'skills', skillName);
  const skillPath = join(skillDir, 'SKILL.md');
  const lockFile = join(skillDir, '.lock');

  await mkdir(skillDir, { recursive: true });

  const lock = await acquireLock(lockFile, 5000);

  try {
    let content = '';
    if (await fileExists(skillPath)) {
      content = await readTextFile(skillPath);
    }

    if (!content.startsWith('---')) {
      content = `---
name: ${skillName}-conventions
description: Development conventions and patterns for ${basename(projectRoot)} project
---

# Project Knowledge

> Project knowledge index. Read this first to understand available domain knowledge, then read relevant module SKILLs as needed.

`;
    }

    const entryMarker = `### ${entry.name}`;
    if (content.includes(entryMarker)) {
      const entryRegex = new RegExp(
        `### ${escapeRegex(entry.name)}[\\s\\S]*?(?=\\n### |$)`,
        'g'
      );
      content = content.replace(entryRegex, formatIndexEntry(entry));
    } else {
      content = content.trimEnd() + '\n\n' + formatIndexEntry(entry);
    }

    await writeTextFile(skillPath, content);
  } finally {
    await releaseLock(lock);
  }
}

// Directories that should not be treated as modules
const EXCLUDED_DIRS = [
  // Version control
  '.git', '.svn', '.hg',
  // Dependencies
  'node_modules', 'bower_components', 'jspm_packages', 'vendor',
  // Build outputs
  'dist', 'build', 'out', 'output', '.output',
  // Framework build directories
  '.next', '.nuxt', '.vuepress', '.docusaurus', '.svelte-kit',
  // Test coverage
  'coverage', '.nyc_output',
  // IDE/Editor config
  '.vscode', '.idea', '.eclipse', '.settings',
  // Git hooks
  '.husky',
  // Temporary/cache
  'tmp', 'temp', '.cache', '.parcel-cache', '.turbo',
  // Package manager
  '.pnpm', '.yarn', '.npm',
];

export function getModulePath(filePath: string, projectRoot: string): string {
  const absolutePath = isAbsolute(filePath) 
    ? filePath 
    : resolve(projectRoot, filePath);
  
  const relativePath = relative(projectRoot, dirname(absolutePath));
  const parts = relativePath.split(/[/\\]/).filter(p => p && p !== '.');

  if (parts.length === 0) return '.';
  
  if (parts.length >= 1 && EXCLUDED_DIRS.includes(parts[0])) {
    return '.';
  }

  if (parts.length === 1) return parts[0];

  return parts.slice(0, 2).join('/');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function acquireLock(lockFile: string, timeoutMs: number): Promise<{ file: string }> {
  const startTime = Date.now();
  const dir = dirname(lockFile);

  await mkdir(dir, { recursive: true });

  while (true) {
    try {
      if (await fileExists(lockFile)) {
        throw { code: 'EEXIST' };
      }
      await writeTextFile(lockFile, process.pid.toString());
      return { file: lockFile };
    } catch (error: any) {
      if (error.code === 'EEXIST') {
        if (Date.now() - startTime > timeoutMs) {
          throw new Error(`Failed to acquire lock on ${lockFile} within ${timeoutMs}ms`);
        }
        await sleep(50);
        continue;
      }
      throw error;
    }
  }
}

async function releaseLock(lock: { file: string }): Promise<void> {
  try {
    if (await fileExists(lock.file)) {
      await removeFile(lock.file);
    }
  } catch (error) {
    console.error(`Failed to release lock ${lock.file}:`, error);
  }
}
