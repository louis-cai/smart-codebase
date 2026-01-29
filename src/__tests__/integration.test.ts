import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeModuleSkill, getProjectSkillName } from "../storage/knowledge-writer";
import { trackSkillAccess } from "../storage/usage-tracker";
import { cleanupCommand } from "../commands/cleanup";
import { statusCommand } from "../commands/status";
import { readTextFile, writeTextFile } from "../utils/fs-compat";
import { mkdir } from "node:fs/promises";

function createMockContext(tmpDir: string): any {
  return {
    directory: tmpDir,
    worktree: tmpDir,
    sessionID: "test-session",
    messageID: "test-message",
    agent: "test-agent",
    abort: new AbortController().signal,
    metadata: () => {},
  };
}

/**
 * Integration Tests - Full Workflow Coverage
 * 
 * These tests verify the complete SKILL lifecycle:
 * 1. Write SKILL → Read SKILL → Verify access_count incremented
 * 2. Multiple reads → Verify incremental access counting
 * 3. Write old low-usage SKILL → Cleanup preview → Verify in list
 * 4. Write multiple SKILLs → Call status → Verify statistics displayed
 */

test("integration: write SKILL → read (track) → verify access_count = 1", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sc-integration-"));
  
  try {
    const skillData = {
      metadata: {
        name: "src-auth",
        description: "Authentication patterns",
      },
      sections: [
        {
          heading: "JWT",
          content: "Use JWT tokens with 15min expiry",
        }
      ],
    };
    
    await writeModuleSkill(tmpDir, "src/auth", skillData);
    
    // Get the actual path where the skill was written
    const projectName = getProjectSkillName(tmpDir);
    const skillPath = join(tmpDir, ".opencode", "skills", projectName, "modules", "src-auth.md");
    
    // Simulate read by calling trackSkillAccess
    await trackSkillAccess(skillPath, tmpDir);
    
    // Verify access_count = 1
    const content = await readTextFile(skillPath);
    expect(content).toContain("access_count: 1");
    expect(content).toContain("last_accessed:");
    
    // Verify created_at and last_updated are present
    expect(content).toContain("created_at:");
    expect(content).toContain("last_updated:");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("integration: write SKILL → read 3 times → verify access_count = 3", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sc-integration-"));
  
  try {
    const skillData = {
      metadata: {
        name: "src-api",
        description: "API patterns",
      },
      sections: [
        {
          heading: "REST",
          content: "Use RESTful design",
        }
      ],
    };
    
    await writeModuleSkill(tmpDir, "src/api", skillData);
    
    // Get the actual path
    const projectName = getProjectSkillName(tmpDir);
    const skillPath = join(tmpDir, ".opencode", "skills", projectName, "modules", "src-api.md");
    
    // Simulate 3 reads
    await trackSkillAccess(skillPath, tmpDir);
    await trackSkillAccess(skillPath, tmpDir);
    await trackSkillAccess(skillPath, tmpDir);
    
    // Verify access_count = 3
    const content = await readTextFile(skillPath);
    expect(content).toContain("access_count: 3");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("integration: write old low-usage SKILL → cleanup preview → verify in list", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sc-integration-"));
  
  try {
    // Create project structure
    const projectName = getProjectSkillName(tmpDir);
    const modulesDir = join(tmpDir, ".opencode", "skills", projectName, "modules");
    await mkdir(modulesDir, { recursive: true });
    
    // Create old, low-usage skill (eligible for cleanup)
    // Age: 95 days, Access: 2, Inactive: 95 days (meets all cleanup criteria)
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    const oldDate = new Date(now - 95 * DAY_MS).toISOString();
    
    const skillPath = join(modulesDir, "src-legacy.md");
    await writeTextFile(skillPath, `---
name: src-legacy
description: Legacy module
usage:
  created_at: ${oldDate}
  last_accessed: ${oldDate}
  access_count: 2
  last_updated: ${oldDate}
---

# Legacy Module
Old patterns here
`);
    
    // Execute cleanup preview
    const ctx = createMockContext(tmpDir);
    const result = await cleanupCommand.execute({}, ctx);
    
    // Verify skill appears in preview list
    expect(result).toContain("src-legacy");
    expect(result).toContain("Run with --confirm to delete");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("integration: write multiple SKILLs with varying usage → status → verify stats", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sc-integration-"));
  
  try {
    const projectName = getProjectSkillName(tmpDir);
    const modulesDir = join(tmpDir, ".opencode", "skills", projectName, "modules");
    await mkdir(modulesDir, { recursive: true });
    
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    
    // Create 3 skills with different access patterns
    // High usage: 15 accesses
    await writeTextFile(join(modulesDir, "src-high.md"), `---
name: src-high
description: High usage module
usage:
  created_at: ${new Date(now - 30 * DAY_MS).toISOString()}
  last_accessed: ${new Date().toISOString()}
  access_count: 15
  last_updated: ${new Date().toISOString()}
---

# High Usage Module
`);
    
    // Medium usage: 7 accesses
    await writeTextFile(join(modulesDir, "src-medium.md"), `---
name: src-medium
description: Medium usage module
usage:
  created_at: ${new Date(now - 20 * DAY_MS).toISOString()}
  last_accessed: ${new Date().toISOString()}
  access_count: 7
  last_updated: ${new Date().toISOString()}
---

# Medium Usage Module
`);
    
    // Low usage: 2 accesses (< 5 threshold)
    await writeTextFile(join(modulesDir, "src-low.md"), `---
name: src-low
description: Low usage module
usage:
  created_at: ${new Date(now - 10 * DAY_MS).toISOString()}
  last_accessed: ${new Date().toISOString()}
  access_count: 2
  last_updated: ${new Date().toISOString()}
---

# Low Usage Module
`);
    
    // Execute status command
    const ctx = createMockContext(tmpDir);
    const result = await statusCommand.execute({}, ctx);
    
    // Verify usage statistics are displayed
    expect(result).toContain("Usage Statistics");
    expect(result).toContain("Total SKILLs: 3");
    expect(result).toContain("Total accesses: 24"); // 15 + 7 + 2
    expect(result).toContain("Low-frequency SKILLs"); // Should show count
    
    // Verify breakdown by usage level
    expect(result).toContain("High usage");
    expect(result).toContain("Medium usage");
    expect(result).toContain("Low usage");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("integration: status command handles empty skills directory gracefully", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sc-integration-"));
  
  try {
    // Create empty project structure (no skills)
    const projectName = getProjectSkillName(tmpDir);
    const modulesDir = join(tmpDir, ".opencode", "skills", projectName, "modules");
    await mkdir(modulesDir, { recursive: true });
    
    // Execute status command
    const ctx = createMockContext(tmpDir);
    const result = await statusCommand.execute({}, ctx);
    
    // Should not crash, should show 0 counts
    expect(result).toBeDefined();
    expect(result).toContain("Total SKILLs: 0");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("integration: status command counts only module skills (not main index)", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "sc-integration-"));
  
  try {
    const projectName = getProjectSkillName(tmpDir);
    const skillsDir = join(tmpDir, ".opencode", "skills", projectName);
    const modulesDir = join(skillsDir, "modules");
    await mkdir(modulesDir, { recursive: true });
    
    // Create main index (should NOT be counted)
    await writeTextFile(join(skillsDir, "SKILL.md"), `---
name: project-conventions
description: Project conventions
---

# Main Index
`);
    
    // Create module skill (should be counted)
    await writeTextFile(join(modulesDir, "src-utils.md"), `---
name: src-utils
description: Utilities
usage:
  created_at: ${new Date().toISOString()}
  last_accessed: ${new Date().toISOString()}
  access_count: 5
  last_updated: ${new Date().toISOString()}
---

# Utils
`);
    
    // Execute status command
    const ctx = createMockContext(tmpDir);
    const result = await statusCommand.execute({}, ctx);
    
    // Should count only 1 skill (the module skill, not the main index)
    expect(result).toContain("Total SKILLs: 1");
    expect(result).toContain("Total accesses: 5");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
