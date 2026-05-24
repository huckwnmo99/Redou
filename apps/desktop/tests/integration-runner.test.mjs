import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDisposableSupabaseConfig,
  getDisposableSupabasePorts,
  getDisposableSupabaseStartExcludes,
} from "../scripts/run-golden-path-supabase.mjs";

describe("golden-path Supabase runner helpers", () => {
  it("builds a disposable config on non-development ports", () => {
    const ports = getDisposableSupabasePorts(55420);
    const config = buildDisposableSupabaseConfig({
      sourceConfig: [
        'project_id = "Supabase_Redou"',
        "[api]",
        "port = 55321",
        "[db]",
        "shadow_port = 55320",
        "[auth]",
        'site_url = "http://127.0.0.1:4173"',
        "[edge_runtime]",
        "inspector_port = 8084",
        "[auth.external.google]",
        "enabled = true",
        'client_id = "env(GOOGLE_OAUTH_CLIENT_ID)"',
        'secret = "env(GOOGLE_OAUTH_CLIENT_SECRET)"',
      ].join("\n"),
      projectId: "redou_test_golden_path",
      ports,
    });

    assert.match(config, /project_id = "redou_test_golden_path"/);
    assert.match(config, /port = 55421/);
    assert.match(config, /shadow_port = 55420/);
    assert.match(config, /site_url = "http:\/\/127\.0\.0\.1:55421"/);
    assert.match(config, /inspector_port = 55428/);
    assert.match(config, /\[auth\.external\.google\]\nenabled = false\nclient_id = ""\nsecret = ""/);
    assert.doesNotMatch(config, /5532[0-9]/);
    assert.doesNotMatch(config, /8084/);
    assert.doesNotMatch(config, /GOOGLE_OAUTH/);
  });

  it("keeps auth available so status can expose service-role credentials", () => {
    const excludedServices = getDisposableSupabaseStartExcludes().split(",");

    assert.ok(!excludedServices.includes("gotrue"));
    assert.ok(excludedServices.includes("studio"));
  });
});
