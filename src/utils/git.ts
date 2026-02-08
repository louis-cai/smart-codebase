import { exec } from 'child_process';
import { promisify } from 'util';
import { dirname, resolve } from 'path';
import { readFile, stat } from 'fs/promises';

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
    const { stdout: commonDirRaw } = await execAsync('git rev-parse --git-common-dir', { cwd });
    let commonDir = commonDirRaw.trim();
    
    if (commonDir) {
      if (!isAbsolute(commonDir)) {
        commonDir = resolve(cwd, commonDir);
      }
      
      // If commonDir ends in .git, assume parent is root
      if (commonDir.endsWith('.git')) {
        const parent = dirname(commonDir);
        // Usually safe to just return parent
        return parent;
      }
      
      // If it's a worktree, commonDir usually points to the main repo's .git dir
      // We want the directory containing that .git dir.
      // commonDir = /main/.git
      // dirname(commonDir) = /main
      // This is generally correct for worktrees.
      return dirname(commonDir);
    }
  } catch (e) {
    // Falls through to fallback
  }

  // 2. Fallback: Check for .git file manually (worktree file)
  // This helps when git environment might be confused or we want to double check logic
  try {
    const gitFile = resolve(cwd, '.git');
    const stats = await stat(gitFile).catch(() => null);
    
    if (stats && stats.isFile()) {
      const content = await readFile(gitFile, 'utf-8');
      const match = content.match(/^gitdir:\s*(.*)/m);
      if (match) {
        let gitDir = match[1].trim(); // e.g. /path/to/main/.git/worktrees/wt-name
        
        if (!isAbsolute(gitDir)) {
            gitDir = resolve(cwd, gitDir);
        }
        
        // Assume standard structure: <root>/.git/worktrees/<name>
        // We want <root>
        // Check if path contains .git/worktrees
        if (gitDir.includes('.git/worktrees/')) {
             // Split by .git/worktrees to find root
             const parts = gitDir.split('.git/worktrees/');
             if (parts.length > 0) {
                 return parts[0]; 
             }
        }
        
        // Fallback: try resolving 3 levels up if structure matches expectation
        const potentialRoot = resolve(gitDir, '../../..');
        // Just verify potentialRoot has a .git dir?
        const check = await stat(resolve(potentialRoot, '.git')).catch(() => null);
        if (check && check.isDirectory()) {
            return potentialRoot;
        }
      }
    }
  } catch (e) {
      // ignore
  }

  // 3. Last fallback: simple toplevel of current dir
  // NOTE: In a worktree without correct common-dir resolution, this returns Worktree Root!
  // This is the "failure mode" the user wants to avoid if possible.
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
    return path.startsWith('/') || /^[a-zA-Z]:/.test(path);
}
