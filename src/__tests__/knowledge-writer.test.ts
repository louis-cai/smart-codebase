import { test, expect } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { fileExists, readTextFile } from "../utils/fs-compat";
import {
  writeModuleSkill,
  updateSkillIndex,
  toSkillName,
  getProjectSkillName,
  type SkillContent,
  type IndexEntry,
} from "../storage/knowledge-writer";

/**
 * TDD RED PHASE - Tests for New Storage Structure
 * 
 * These tests define the expected behavior for the refactored storage system:
 * 1. Module skills write to .opencode/skills/<project>/modules/<skill-name>.md
 * 2. Frontmatter includes usage metadata (created_at, last_updated)
 * 3. Index entries reference correct module paths
 */

test("writeModuleSkill() writes to new path structure", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "test-knowledge-"));
  const modulePath = "src/auth";
  const skillName = toSkillName(modulePath);

  try {
    const skill: SkillContent = {
      metadata: {
        name: skillName,
        description: "Authentication module patterns",
      },
      sections: [
        {
          heading: "Session Management",
          content: "Use JWT tokens with 15min expiry",
        },
      ],
    };

    const skillPath = await writeModuleSkill(tmpDir, modulePath, skill);

    // Expected path: .opencode/skills/<project>/modules/<skill-name>.md
    const expectedPath = join(
      tmpDir,
      ".opencode",
      "skills",
      await getProjectSkillName(tmpDir),
      "modules",
      `${skillName}.md`
    );

    expect(skillPath).toBe(expectedPath);
    expect(await fileExists(expectedPath)).toBe(true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("writeModuleSkill() includes usage metadata in frontmatter", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "test-knowledge-"));
  const modulePath = "src/api";
  const skillName = toSkillName(modulePath);

  try {
    const skill: SkillContent = {
      metadata: {
        name: skillName,
        description: "API patterns",
      },
      sections: [
        {
          heading: "REST Design",
          content: "Use RESTful endpoints",
        },
      ],
    };

    const skillPath = await writeModuleSkill(tmpDir, modulePath, skill);
    const content = await readTextFile(skillPath);

    // Verify frontmatter contains usage metadata
    expect(content).toContain("usage:");
    expect(content).toContain("created_at:");
    expect(content).toContain("last_updated:");

    // Extract and verify ISO 8601 timestamp format
    const createdMatch = content.match(/created_at:\s*([^\s]+)/);
    const updatedMatch = content.match(/last_updated:\s*([^\s]+)/);

    expect(createdMatch).not.toBeNull();
    expect(updatedMatch).not.toBeNull();

    if (createdMatch && updatedMatch) {
      const createdAt = createdMatch[1];
      const lastUpdated = updatedMatch[1];

      // Verify ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(iso8601Regex.test(createdAt)).toBe(true);
      expect(iso8601Regex.test(lastUpdated)).toBe(true);

      // Verify timestamps are valid dates
      expect(new Date(createdAt).toString()).not.toBe("Invalid Date");
      expect(new Date(lastUpdated).toString()).not.toBe("Invalid Date");
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("module name conversion: src/auth -> src-auth.md", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "test-knowledge-"));
  const modulePath = "src/auth";

  try {
    const skill: SkillContent = {
      metadata: {
        name: toSkillName(modulePath),
        description: "Test",
      },
      sections: [],
    };

    const skillPath = await writeModuleSkill(tmpDir, modulePath, skill);

    // Verify filename is src-auth.md
    expect(skillPath).toContain("src-auth.md");
    expect(await fileExists(skillPath)).toBe(true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("updateSkillIndex() creates correct entry location for module skills", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "test-knowledge-"));
  const projectName = await getProjectSkillName(tmpDir);
  const modulePath = "src/payments";
  const skillName = toSkillName(modulePath); // "src-payments"

  try {
    const entry: IndexEntry = {
      name: skillName,
      description: "Payment processing patterns",
      location: `modules/${skillName}.md`, // Relative path from SKILL.md
    };

    await updateSkillIndex(tmpDir, entry);

    const indexPath = join(tmpDir, ".opencode", "skills", projectName, "SKILL.md");
    expect(await fileExists(indexPath)).toBe(true);

    const content = await readTextFile(indexPath);

    // Verify entry exists
    expect(content).toContain(`### ${skillName}`);
    expect(content).toContain("Payment processing patterns");

    // Verify location points to modules/<skill-name>.md
    expect(content).toContain(`**Location**: \`modules/${skillName}.md\``);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("lock mechanism still works with new path structure", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "test-knowledge-"));
  const modulePath = "src/utils";

  try {
    const skill: SkillContent = {
      metadata: {
        name: toSkillName(modulePath),
        description: "Utility patterns",
      },
      sections: [],
    };

    // Write skill twice - lock should prevent race conditions
    const [path1, path2] = await Promise.all([
      writeModuleSkill(tmpDir, modulePath, skill),
      writeModuleSkill(tmpDir, modulePath, skill),
    ]);

    // Both should succeed and return same path
    expect(path1).toBe(path2);
    expect(await fileExists(path1)).toBe(true);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("frontmatter structure validation", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "test-knowledge-"));
  const modulePath = "src/core";
  const skillName = toSkillName(modulePath);

  try {
    const skill: SkillContent = {
      metadata: {
        name: skillName,
        description: "Core module patterns",
      },
      sections: [
        {
          heading: "Architecture",
          content: "Use layered architecture",
        },
      ],
    };

    const skillPath = await writeModuleSkill(tmpDir, modulePath, skill);
    const content = await readTextFile(skillPath);

    // Verify frontmatter structure:
    // ---
    // name: src-core
    // description: Core module patterns
    // usage:
    //   created_at: 2026-01-29T12:58:55.736Z
    //   last_updated: 2026-01-29T12:58:55.736Z
    // ---

    const lines = content.split("\n");
    expect(lines[0]).toBe("---");

    // Find the closing --- index
    const closingIndex = lines.indexOf("---", 1);
    expect(closingIndex).toBeGreaterThan(0);

    const frontmatter = lines.slice(1, closingIndex).join("\n");

    // Verify name field
    expect(frontmatter).toContain(`name: ${skillName}`);

    // Verify description field
    expect(frontmatter).toContain("description: Core module patterns");

    // Verify usage nested structure
    expect(frontmatter).toContain("usage:");
    expect(frontmatter).toMatch(/\s{2}created_at:\s*\d{4}-/); // Indented with 2 spaces
    expect(frontmatter).toMatch(/\s{2}last_updated:\s*\d{4}-/); // Indented with 2 spaces
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("writeModuleSkill() updates last_updated on subsequent writes", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "test-knowledge-"));
  const modulePath = "src/db";
  const skillName = toSkillName(modulePath);

  try {
    const skill: SkillContent = {
      metadata: {
        name: skillName,
        description: "Database patterns",
      },
      sections: [
        {
          heading: "Queries",
          content: "Use prepared statements",
        },
      ],
    };

    // Write first time
    const skillPath1 = await writeModuleSkill(tmpDir, modulePath, skill);
    const content1 = await readTextFile(skillPath1);
    const created1Match = content1.match(/created_at:\s*([^\s]+)/);
    const updated1Match = content1.match(/last_updated:\s*([^\s]+)/);

    expect(created1Match).not.toBeNull();
    expect(updated1Match).not.toBeNull();

    // Wait 10ms to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Update skill content
    skill.sections[0].content = "Use prepared statements and connection pooling";

    // Write second time
    const skillPath2 = await writeModuleSkill(tmpDir, modulePath, skill);
    const content2 = await readTextFile(skillPath2);
    const created2Match = content2.match(/created_at:\s*([^\s]+)/);
    const updated2Match = content2.match(/last_updated:\s*([^\s]+)/);

    expect(created2Match).not.toBeNull();
    expect(updated2Match).not.toBeNull();

    if (
      created1Match &&
      updated1Match &&
      created2Match &&
      updated2Match
    ) {
      const created1 = created1Match[1];
      const updated1 = updated1Match[1];
      const created2 = created2Match[1];
      const updated2 = updated2Match[1];

      // created_at should remain the same
      expect(created2).toBe(created1);

      // last_updated should be newer
      expect(new Date(updated2).getTime()).toBeGreaterThan(
        new Date(updated1).getTime()
      );
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
