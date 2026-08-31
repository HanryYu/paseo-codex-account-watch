import type { PluginContext } from "@getpaseo/plugin";
import { MainSurface, contributeClient } from "./main.client";
import { statusRpc, setupRpc, reloadRpc } from "./api.shared";
import { getService, closeService } from "./service.server";

export default function contribute(plugin: PluginContext) {
  plugin.handle(statusRpc, (_, { paseo }) => getService().status(paseo));
  plugin.handle(setupRpc, ({ action }, { paseo }) =>
    getService().setup(paseo, action),
  );
  plugin.handle(reloadRpc, (input, { paseo }) =>
    getService().reload(paseo, input),
  );
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "accounts",
    title: "Codex accounts",
    icon: "UserRound",
    surface: "main",
  });
  plugin.addCommandCenterItem({
    id: "accounts",
    title: "Review Codex accounts",
    icon: "UserRound",
    context: "global",
    onSelect({ openSurface }) {
      openSurface("main");
    },
  });
  plugin.addClientSide(contributeClient);
  return () => {
    if (typeof closeService !== "undefined") closeService();
  };
}
