import { describe, test, expect } from "bun:test";
import { toSkillName, getProjectSkillName } from "../storage/knowledge-writer";

describe("IndexEntry location construction", () => {
  test("module path should use modules/ directory with skill name", () => {
    const modulePath = "src/auth";
    const skillName = toSkillName(modulePath);
    const location = `modules/${skillName}.md`;
    
    expect(location).toBe("modules/src-auth.md");
    expect(location).not.toContain("/.knowledge/");
  });
  
  test("nested module path should flatten to skill name", () => {
    const modulePath = "src/main/services/config";
    const skillName = toSkillName(modulePath);
    const location = `modules/${skillName}.md`;
    
    expect(location).toBe("modules/src-main-services-config.md");
  });
  
  test("root module should use absolute path to main SKILL.md", async () => {
    const projectRoot = "/home/user/myproject";
    const projectName = await getProjectSkillName(projectRoot);
    const location = `.opencode/skills/${projectName}/SKILL.md`;
    
    expect(location).toBe(".opencode/skills/myproject/SKILL.md");
  });
  
  test("location should start with modules/ prefix", () => {
    const modulePath = "src/api";
    const skillName = toSkillName(modulePath);
    const location = `modules/${skillName}.md`;
    
    expect(location.startsWith("modules/")).toBe(true);
    expect(location.endsWith(".md")).toBe(true);
  });
  
  test("regression: should NOT use old .knowledge path", () => {
    const modulePath = "src/payments";
    const skillName = toSkillName(modulePath);
    
    const oldLocation = `${modulePath}/.knowledge/SKILL.md`;
    const newLocation = `modules/${skillName}.md`;
    
    expect(newLocation).not.toBe(oldLocation);
    expect(newLocation).toBe("modules/src-payments.md");
  });
});
