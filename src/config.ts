import * as fs from "fs";
import { join } from "path";
import * as os from "os";
import type { PluginConfig } from "./types";

const CONFIG_FILE_NAMES = ["smart-codebase.jsonc", "smart-codebase.json"];

const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  debounceMs: 15000,
  autoExtract: true,
  autoInject: true,
  disabledCommands: [],
};

function getOpenCodeConfigDir(): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "opencode");
  }
  return join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "opencode");
}

function stripJsonComments(jsonString: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  
  while (i < jsonString.length) {
    const char = jsonString[i];
    const nextChar = jsonString[i + 1];
    
    if (char === '"' && (i === 0 || jsonString[i - 1] !== '\\')) {
      inString = !inString;
      result += char;
      i++;
      continue;
    }
    
    if (!inString) {
      if (char === '/' && nextChar === '/') {
        while (i < jsonString.length && jsonString[i] !== '\n') {
          i++;
        }
        continue;
      }
      if (char === '/' && nextChar === '*') {
        i += 2;
        while (i < jsonString.length - 1 && !(jsonString[i] === '*' && jsonString[i + 1] === '/')) {
          i++;
        }
        i += 2;
        continue;
      }
    }
    
    result += char;
    i++;
  }
  
  return result;
}

export function loadConfig(projectRoot: string): PluginConfig {
  const configDir = getOpenCodeConfigDir();
  
  for (const fileName of CONFIG_FILE_NAMES) {
    const configPath = join(configDir, fileName);
    
    if (!fs.existsSync(configPath)) {
      continue;
    }
    
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const cleanJson = stripJsonComments(content);
      const userConfig = JSON.parse(cleanJson) as Partial<PluginConfig>;
      const merged = { ...DEFAULT_CONFIG, ...userConfig };
      console.log(`[smart-codebase] Loaded config from ${configPath}:`, JSON.stringify(merged));
      return merged;
    } catch (error) {
      console.error(`[smart-codebase] Failed to parse ${fileName}:`, error);
      return DEFAULT_CONFIG;
    }
  }
  
  console.log(`[smart-codebase] No config file found, using defaults`);
  return DEFAULT_CONFIG;
}
