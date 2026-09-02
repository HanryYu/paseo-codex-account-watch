import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_PLUGIN_SETTINGS,
  PluginSettingsPatchSchema,
  PluginSettingsSchema,
  type PluginSettings,
  type PluginSettingsPatch,
} from "./settings.shared";

export class SettingsStore {
  private writeTail = Promise.resolve();
  private readonly file: string;

  constructor(readonly root: string) {
    this.file = path.join(root, "settings.json");
  }

  async read(): Promise<PluginSettings> {
    try {
      return PluginSettingsSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return DEFAULT_PLUGIN_SETTINGS;
      throw new Error("Account plugin settings cannot be read.");
    }
  }

  async update(patch: PluginSettingsPatch): Promise<PluginSettings> {
    let result!: PluginSettings;
    const operation = this.writeTail.then(async () => {
      const parsed = PluginSettingsPatchSchema.parse(patch);
      result = PluginSettingsSchema.parse({
        ...(await this.read()),
        ...parsed,
      });
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const rootInfo = await lstat(this.root);
      if (
        !rootInfo.isDirectory() ||
        rootInfo.isSymbolicLink() ||
        (process.getuid && rootInfo.uid !== process.getuid())
      )
        throw new Error("Plugin settings must be owned by this user.");
      await chmod(this.root, 0o700);
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(result), { mode: 0o600 });
      await rename(temporary, this.file);
    });
    this.writeTail = operation.catch(() => {});
    await operation;
    return result;
  }
}
