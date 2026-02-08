import { exec } from 'child_process';
import { promisify } from 'util';
import { dirname, resolve, join, basename, isAbsolute as pathIsAbsolute } from 'path';
import { readFile, stat } from 'fs/promises';
import { fileExists } from './fs-compat';

const execAsync = promisify(exec);

/**
 * Get the root directory of the git repository.
 * In a worktree, this DOES ITS BEST to return the MAIN project root, not the worktree root.
 * This ensures that skills and knowledge are centralized.
 * 
 * @param cwd - Current working directory to start search from
 * @returns Absolute path to git root, or null if not in a git repo
 */
export async function getGitRoot(cwd: string): Promise<string | null> {
  const tryResolve = async (dir: string) => {
    try {
      const { stdout: toplevel } = await execAsync('git rev-parse --show-toplevel', { cwd: dir });
      return toplevel.trim();
    } catch {
      return null;
    }
  };

  try {
    // 1. Try to find the common git directory (works for worktrees since Git 2.5+)
    // In a worktree, this points to the main repo's .git directory.
    const { stdout: commonDirRaw } = await execAsync('git rev-parse --git-common-dir', { cwd });
    let commonDir = commonDirRaw.trim();
    
    if (commonDir) {
      if (!isAbsolute(commonDir)) {
        commonDir = resolve(cwd, commonDir);
      }
      
      // If commonDir is a path to .git, the parent is the project root.
      // E.g. /path/to/main/.git -> /path/to/main
      // E.g. /path/to/main (if it's a bare repo, but we usually expect non-bare)
      if (basename(commonDir) === '.git') {
        return dirname(commonDir);
      }
      
      // If it's a worktree, commonDir usually points to the main repo's .git dir or the main root itself
      // depending on git version and state. 
      // If commonDir exists and contains a 'config' file, it's likely the .git dir.
      const configExists = await fileExists(join(commonDir, 'config'));
      if (configExists) {
        return dirname(commonDir);
      }

      return commonDir;
    }
  } catch (e) {
    // Falls through
  }

  try {
    // 2. Use 'git worktree list' as secondary method.
    const { stdout: wtList } = await execAsync('git worktree list --porcelain', { cwd });
    const match = wtList.match(/^worktree\s+(.+)$/m);
    if (match) {
      return match[1].trim();
    }
  } catch (e) {
    // Falls through
  }

  // 3. Fallback: Check for .git file manually (worktree file)
  try {
    const gitFile = resolve(cwd, '.git');
    const stats = await stat(gitFile).catch(() => null);
    
    if (stats && stats.isFile()) {
      const content = await readFile(gitFile, 'utf-8');
      const match = content.match(/^gitdir:\s*(.*)/m);
      if (match) {
        let gitDir = match[1].trim(); 
        
        if (!isAbsolute(gitDir)) {
            gitDir = resolve(cwd, gitDir);
        }
        
        if (gitDir.includes('.git/worktrees/')) {
             const parts = gitDir.split('.git/worktrees/');
             if (parts.length > 0) {
                 return parts[0]; 
             }
        }
        
        const potentialRoot = resolve(gitDir, '../../..');
        const check = await stat(resolve(potentialRoot, '.git')).catch(() => null);
        if (check && check.isDirectory()) {
            return potentialRoot;
        }
      }
    }
  } catch (e) {
      // ignore
  }

  // 4. Last fallback: simple toplevel of current dir
  return await tryResolve(cwd);
}

/**
 * Get the project root directory. Prefers git root if available, otherwise uses the provided directory.
 */
export async function getProjectRootDir(dir: string): Promise<string> {
    const gitRoot = await getGitRoot(dir);
    return gitRoot || dir;
}

function isAbsolute(path: string): boolean {
    return pathIsAbsolute(path) || path.startsWith('/') || /^[a-zA-Z]:/.test(path);
}
