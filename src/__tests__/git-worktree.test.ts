import { test, expect } from "bun:test";
import { join, basename } from "path";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { getProjectSkillName } from "../storage/knowledge-writer";

const execAsync = promisify(exec);

test("getProjectSkillName() returns consistent name in git worktree", async () => {
  // 1. Create a parent directory for the test
  const testRoot = await mkdtemp(join(tmpdir(), "sc-worktree-test-"));
  
  // 2. Create the main repo
  const mainRepoPath = join(testRoot, "main-repo");
  await mkdir(mainRepoPath);
  
  try {
    // 3. Initialize git repo and commit
    await execAsync("git init", { cwd: mainRepoPath });
    // Configure user for commit
    await execAsync("git config user.email 'test@example.com'", { cwd: mainRepoPath });
    await execAsync("git config user.name 'Test User'", { cwd: mainRepoPath });
    
    // Create a dummy file and commit
    await execAsync("touch README.md", { cwd: mainRepoPath });
    await execAsync("git add README.md", { cwd: mainRepoPath });
    await execAsync("git commit -m 'Initial commit'", { cwd: mainRepoPath });
    
    // 4. Create a worktree
    const worktreePath = join(testRoot, "worktree-repo");
    await execAsync(`git worktree add ${worktreePath}`, { cwd: mainRepoPath });
    
    // Verify paths are different
    expect(mainRepoPath).not.toBe(worktreePath);
    
    // 5. Get skill name for main repo
    const mainRepoSkillName = await getProjectSkillName(mainRepoPath);
    expect(mainRepoSkillName).toBe("main-repo");
    
    // 6. Get skill name for worktree
    // BEFORE FIX: This would return "worktree-repo"
    // AFTER FIX: This should return "main-repo" (or whatever logic we decided for git root)
    const worktreeSkillName = await getProjectSkillName(worktreePath);
    
    expect(worktreeSkillName).toBe("main-repo");
    expect(worktreeSkillName).toBe(mainRepoSkillName);
    
  } finally {
    // Cleanup
    await rm(testRoot, { recursive: true, force: true });
  }
});
