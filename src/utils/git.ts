import { exec } from 'child_process';
import { promisify } from 'util';
import { dirname } from 'path';

const execAsync = promisify(exec);

/**
 * Get the root directory of the git repository
 * @param cwd - Current working directory to start search from
 * @returns Absolute path to git root, or null if not in a git repo
 */
export async function getGitRoot(cwd: string): Promise<string | null> {
  try {
    // try to get the common dir first (works for worktrees)
    try {
        const { stdout: commonDir } = await execAsync('git rev-parse --git-common-dir', { cwd });
        if (commonDir.trim()) {
            // If we are in a worktree, --show-toplevel gives the worktree root.
            // But usually we want the "project name" to be consistent.
            // However, the user said "if in work tree, it causes work tree skill to be separate".
            // So they likely want the MAIN repo name.
            
            // Actually, `git rev-parse --show-toplevel` returns the root of the WORKTREE.
            // If the user wants the skill name to be consistent across worktrees,
            // we should probably use the basename of the MAIN repo directory,
            // OR use a specific configuration.
            
            // Let's check `git rev-parse --show-superproject-working-tree`? No.
            
            // If use `git rev-parse --git-common-dir`, it returns the path to `.git` dir of the main repo.
            // e.g. `/path/to/main/.git`
            // So dirname(commonDir) would be the main repo root?
            // Wait, commonDir might be relative.
             const { stdout: absoluteCommonDir } = await execAsync('git rev-parse --path-format=absolute --git-common-dir', { cwd });
             // The common dir is usually .git/worktrees/... or just .git
             // Actually, for worktrees, the main git dir is referenced in .git file.
             // `git rev-parse --git-common-dir` returns the shared .git directory.
             // If we are in main repo, it returns `.git`.
             // If we are in worktree, it returns `/path/to/main/.git`.
             
             // So if we take the dirname of the absolute common dir, we usually get the main project root.
             // UNLESS it is a bare repo?
             
             // Let's try `git rev-parse --show-toplevel` first.
             // Only if the user specifically complained about worktrees...
             // "if it is in work tree, it leads to work tree skill being separate"
             // This implies `basename(cwd)` was returning `worktree-name`.
             // But `git rev-parse --show-toplevel` returns `/path/to/worktree`.
             // So `basename` of that is still `worktree-name`.
             
             // WE WANT THE MAIN REPO NAME.
             // use `git rev-parse --git-dir`? 
             // in worktree: `/path/to/main/.git/worktrees/my-worktree`
             // in main: `.git`
             
             // use `git rev-parse --git-common-dir`?
             // in worktree: `/path/to/main/.git`
             // in main: `.git`
             // BUT `git rev-parse --path-format=absolute --git-common-dir` gives absolute path.
             
             return dirname((await execAsync('git rev-parse --path-format=absolute --git-common-dir', { cwd })).stdout.trim());
        }
    } catch {
        // fallback
    }

    const { stdout } = await execAsync('git rev-parse --show-toplevel', { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}
