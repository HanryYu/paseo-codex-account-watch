import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLocale, translate } from "./i18n.client";

test("uses the plugin override before the host locale and falls back safely", () => {
  assert.equal(resolveLocale("zh-CN", "en"), "zh-CN");
  assert.equal(resolveLocale("en", "zh-CN"), "en");
  assert.equal(resolveLocale("auto", "zh-Hans-CN"), "zh-CN");
  assert.equal(resolveLocale("auto", "ja-JP"), "en");
});

test("renders translated messages with named values", () => {
  assert.equal(
    translate("en", "accountRenamed", { name: "Work" }),
    "Account renamed to Work.",
  );
  assert.equal(translate("zh-CN", "readyCount", { count: 5 }), "5 个已就绪");
});
