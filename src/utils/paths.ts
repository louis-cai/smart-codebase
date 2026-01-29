import * as os from "os";
import { join } from "path";

export function getOpenCodeConfigDir(): string {
  const home = os.homedir();
  return join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "opencode");
}
