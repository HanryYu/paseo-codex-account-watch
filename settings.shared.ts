import { z } from "zod";

export const PluginLanguageSchema = z.enum(["auto", "en", "zh-CN"]);
export type PluginLanguage = z.infer<typeof PluginLanguageSchema>;

export const PluginSettingsSchema = z.object({
  version: z.literal(1),
  language: PluginLanguageSchema,
  showAccountPill: z.boolean(),
  showSetupPill: z.boolean(),
});
export type PluginSettings = z.infer<typeof PluginSettingsSchema>;

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  version: 1,
  language: "auto",
  showAccountPill: true,
  showSetupPill: true,
};

export const PluginSettingsPatchSchema = PluginSettingsSchema.pick({
  language: true,
  showAccountPill: true,
  showSetupPill: true,
}).partial();
export type PluginSettingsPatch = z.infer<typeof PluginSettingsPatchSchema>;
