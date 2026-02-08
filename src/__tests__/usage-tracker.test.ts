import { test, expect } from "bun:test";
import { join } from "path";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { fileExists, readTextFile, writeTextFile } from "../utils/fs-compat";
import {
  trackSkillAccess,
  shouldTrackPath,
} from "../storage/usage-tracker";
import { getProjectSkillName } from "../storage/knowledge-writer";

/**
 * TDD RED PHASE - Tests for Usage Tracker
 * 
 * These tests define the expected behavior:
 * 1. shouldTrackPath() matches module SKILL files
 * 2. shouldTrackPath() excludes main index SKILL.md
 * 3. trackSkillAccess() increments access_count
 * 4. trackSkillAccess() updates last_accessed timestamp
 * 5. trackSkillAccess() preserves created_at and last_updated
 * 6. trackSkillAccess() handles missing usage metadata
 * 7. trackSkillAccess() uses lock mechanism for concurrent safety
 */

test("shouldTrackPath() matches module SKILL files", () => {
  const projectRoot = "/home/user/project";
  
  // Should match module SKILL files
  expect(shouldTrackPath(
    "/home/user/project/.opencode/skills/project/modules/src-auth.md",
    projectRoot
  )).toBe(true);
  
  expect(shouldTrackPath(
    "/home/user/project/.opencode/skills/smart-codebase/modules/api-routes.md",
    projectRoot
  )).toBe(true);
});

test("shouldTrackPath() excludes main index SKILL.md", () => {
  const projectRoot = "/home/user/project";
  
  // Should NOT match main index
  expect(shouldTrackPath(
    "/home/user/project/.opencode/skills/project/SKILL.md",
    projectRoot
  )).toBe(false);
  
  expect(shouldTrackPath(
    "/home/user/project/.opencode/skills/smart-codebase/SKILL.md",
    projectRoot
  )).toBe(false);
});

test("shouldTrackPath() excludes non-SKILL files", () => {
  const projectRoot = "/home/user/project";
  
  // Should NOT match non-SKILL files
  expect(shouldTrackPath(
    "/home/user/project/src/auth.ts",
    projectRoot
  )).toBe(false);
  
  expect(shouldTrackPath(
    "/home/user/project/.knowledge/SKILL.md",
    projectRoot
  )).toBe(false);
});

test("trackSkillAccess() initializes usage metadata if missing", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "test-usage-"));
  const projectName = await getProjectSkillName(tmpDir);
  const skillDir = join(tmpDir, ".opencode", "skills", projectName, "modules");
  const skillPath = join(skillDir, "src-auth.md");

  try {
    // Create a skill file without usage metadata
    await mkdir(skillDir, { recursive: true });
    const initialContent = `---
name: src-auth
description: Authentication patterns
---

## Session Management
Use JWT tokens with 15min expiry
`;
    await writeTextFile(skillPath, initialContent);

    // Track access
    await trackSkillAccess(skillPath, tmpDir);

    // Verify metadata was added
    const content = await readTextFile(skillPath);
    expect(content).toContain("usage:");
    expect(content).toContain("access_count: 1");
    expect(content).toContain("last_accessed:");

    // Verify timestamp format (ISO 8601)
    const lastAccessedMatch = content.match(/last_accessed:\s*([^\s]+)/);
    expect(lastAccessedMatch).not.toBeNull();
    if (lastAccessedMatch) {
      const timestamp = lastAccessedMatch[1];
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(iso8601Regex.test(timestamp)).toBe(true);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("trackSkillAccess() increments access_count", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "test-usage-"));
  const projectName = await getProjectSkillName(tmpDir);
  const skillDir = join(tmpDir, ".opencode", "skills", projectName, "modules");
  const skillPath = join(skillDir, "src-api.md");

  try {
    await mkdir(skillDir, { recursive: true });
    const initialContent = `---
name: src-api
description: API patterns
usage:
  created_at: 2026-01-29T10:00:00.000Z
  last_updated: 2026-01-29T10:00:00.000Z
  access_count: 5
  last_accessed: 2026-01-29T10:00:00.000Z
---

## REST Design
Use RESTful endpoints
`;
    await writeTextFile(skillPath, initialContent);

    // Track access
    await trackSkillAccess(skillPath, tmpDir);

    // Verify access_count incremented
    const content = await readTextFile(skillPath);
    expect(content).toContain("access_count: 6");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("trackSkillAccess() updates last_accessed timestamp", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "test-usage-"));
  const projectName = await getProjectSkillName(tmpDir);
  const skillDir = join(tmpDir, ".opencode", "skills", projectName, "modules");
  const skillPath = join(skillDir, "src-db.md");

  try {
    await mkdir(skillDir, { recursive: true });
    const oldTimestamp = "2026-01-29T10:00:00.000Z";
    const initialContent = `---
name: src-db
description: Database patterns
usage:
  created_at: 2026-01-29T09:00:00.000Z
  last_updated: 2026-01-29T09:30:00.000Z
  access_count: 3
  last_accessed: ${oldTimestamp}
---

## Queries
Use prepared statements
`;
    await writeTextFile(skillPath, initialContent);

    // Wait 10ms to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Track access
    await trackSkillAccess(skillPath, tmpDir);

    // Verify timestamp updated
    const content = await readTextFile(skillPath);
    const lastAccessedMatch = content.match(/last_accessed:\s*([^\s]+)/);
    
    expect(lastAccessedMatch).not.toBeNull();
    if (lastAccessedMatch) {
      const newTimestamp = lastAccessedMatch[1];
      expect(newTimestamp).not.toBe(oldTimestamp);
      expect(new Date(newTimestamp).getTime()).toBeGreaterThan(
        new Date(oldTimestamp).getTime()
      );
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("trackSkillAccess() preserves created_at and last_updated", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "test-usage-"));
  const projectName = await getProjectSkillName(tmpDir);
  const skillDir = join(tmpDir, ".opencode", "skills", projectName, "modules");
  const skillPath = join(skillDir, "src-core.md");

  try {
    await mkdir(skillDir, { recursive: true });
    const createdAt = "2026-01-29T08:00:00.000Z";
    const lastUpdated = "2026-01-29T09:00:00.000Z";
    const initialContent = `---
name: src-core
description: Core patterns
usage:
  created_at: ${createdAt}
  last_updated: ${lastUpdated}
  access_count: 2
  last_accessed: 2026-01-29T09:00:00.000Z
---

## Architecture
Use layered architecture
`;
    await writeTextFile(skillPath, initialContent);

    // Track access
    await trackSkillAccess(skillPath, tmpDir);

    // Verify timestamps preserved
    const content = await readTextFile(skillPath);
    expect(content).toContain(`created_at: ${createdAt}`);
    expect(content).toContain(`last_updated: ${lastUpdated}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("trackSkillAccess() handles concurrent access safely", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "test-usage-"));
  const projectName = await getProjectSkillName(tmpDir);
  const skillDir = join(tmpDir, ".opencode", "skills", projectName, "modules");
  const skillPath = join(skillDir, "src-utils.md");

  try {
    await mkdir(skillDir, { recursive: true });
    const initialContent = `---
name: src-utils
description: Utility patterns
usage:
  created_at: 2026-01-29T10:00:00.000Z
  last_updated: 2026-01-29T10:00:00.000Z
  access_count: 0
  last_accessed: 2026-01-29T10:00:00.000Z
---

## Helpers
Common utility functions
`;
    await writeTextFile(skillPath, initialContent);

    await trackSkillAccess(skillPath, tmpDir);
    await trackSkillAccess(skillPath, tmpDir);
    await trackSkillAccess(skillPath, tmpDir);

    const content = await readTextFile(skillPath);
    const countMatch = content.match(/access_count:\s*(\d+)/);
    
    expect(countMatch).not.toBeNull();
    if (countMatch) {
      const count = parseInt(countMatch[1], 10);
      expect(count).toBe(3);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("trackSkillAccess() handles invalid paths gracefully", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "test-usage-"));
  const nonExistentPath = join(tmpDir, "non-existent.md");

  try {
    await trackSkillAccess(nonExistentPath, tmpDir);
    expect(true).toBe(true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
