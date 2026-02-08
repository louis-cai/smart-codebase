import { join, dirname } from 'path';
import { mkdir } from 'fs/promises';
import { fileExists, readTextFile, writeTextFile, sleep, removeFile } from '../utils/fs-compat';
import { getProjectRootDir } from '../utils/git';

interface UsageMetadata {
  created_at?: string;
  last_updated?: string;
  access_count?: number;
  last_accessed?: string;
}

interface SkillFrontmatter {
  name: string;
  description: string;
  usage?: UsageMetadata;
  [key: string]: any;
}

export function shouldTrackPath(filePath: string, projectRoot: string): boolean {
  const pattern = /\.opencode\/skills\/[^\/]+\/modules\/[^\/]+\.md$/;
  return pattern.test(filePath);
}

export async function trackSkillAccess(skillPath: string, projectRoot: string): Promise<void> {
  try {
    if (!(await fileExists(skillPath))) {
      return;
    }

    const lockFile = join(dirname(skillPath), '.usage-lock');
    const lock = await acquireLock(lockFile, 5000);

    try {
      const content = await readTextFile(skillPath);
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      
      if (!frontmatterMatch) {
        return;
      }

      const frontmatterRaw = frontmatterMatch[1];
      const frontmatter = parseFrontmatter(frontmatterRaw);
      
      if (!frontmatter.usage) {
        frontmatter.usage = {};
      }

      frontmatter.usage.access_count = (frontmatter.usage.access_count || 0) + 1;
      frontmatter.usage.last_accessed = new Date().toISOString();

      const bodyContent = content.slice(frontmatterMatch[0].length).trim();
      const updatedContent = formatSkillWithFrontmatter(frontmatter, bodyContent);
      
      await writeTextFile(skillPath, updatedContent);
    } finally {
      await releaseLock(lock);
    }
  } catch (error) {
    console.error(`[usage-tracker] Failed to track access for ${skillPath}:`, error);
  }
}

function parseFrontmatter(raw: string): SkillFrontmatter {
  const lines = raw.split('\n');
  const frontmatter: any = {};
  let currentKey: string | null = null;
  let currentIndent = 0;
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
        currentIndent = indent;
      }
    } else if (indent > currentIndent && nestedObject && trimmed.includes(':')) {
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

function formatSkillWithFrontmatter(frontmatter: SkillFrontmatter, body: string): string {
  const lines: string[] = ['---'];
  
  lines.push(`name: ${frontmatter.name}`);
  lines.push(`description: ${frontmatter.description}`);
  
  if (frontmatter.usage) {
    lines.push('usage:');
    if (frontmatter.usage.created_at) {
      lines.push(`  created_at: ${frontmatter.usage.created_at}`);
    }
    if (frontmatter.usage.last_updated) {
      lines.push(`  last_updated: ${frontmatter.usage.last_updated}`);
    }
    if (frontmatter.usage.access_count !== undefined) {
      lines.push(`  access_count: ${frontmatter.usage.access_count}`);
    }
    if (frontmatter.usage.last_accessed) {
      lines.push(`  last_accessed: ${frontmatter.usage.last_accessed}`);
    }
  }
  
  lines.push('---');
  lines.push('');
  lines.push(body);
  
  return lines.join('\n');
}

async function acquireLock(lockFile: string, timeoutMs: number): Promise<{ file: string }> {
  const startTime = Date.now();
  const dir = dirname(lockFile);

  await mkdir(dir, { recursive: true });

  while (true) {
    const lockExists = await fileExists(lockFile);
    
    if (lockExists) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Failed to acquire lock on ${lockFile} within ${timeoutMs}ms`);
      }
      await sleep(50);
      continue;
    }
    
    try {
      await writeTextFile(lockFile, process.pid.toString());
      
      await sleep(10);
      
      const stillExists = await fileExists(lockFile);
      if (stillExists) {
        const lockContent = await readTextFile(lockFile);
        if (lockContent === process.pid.toString()) {
          return { file: lockFile };
        }
      }
      
      await sleep(50);
    } catch (error: any) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Failed to acquire lock on ${lockFile} within ${timeoutMs}ms`);
      }
      await sleep(50);
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
