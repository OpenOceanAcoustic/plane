/** Public browser HTTP seam: an axios transport represents the API. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
const require = createRequire(new URL("../../../packages/services/package.json", import.meta.url));
const ts = require("typescript");
const { default: axios } = await import(new URL("./index.js", pathToFileURL(require.resolve("axios/package.json"))));
const directory = await mkdtemp(fileURLToPath(new URL("../../../packages/services/.session-test-", import.meta.url)));
global.window = Object.assign(new EventTarget(), { location: { origin: "https://lab.example.org" } });
try {
  const source = await readFile(
    new URL("../../../packages/services/src/session-protection.ts", import.meta.url),
    "utf8"
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  await writeFile(`${directory}/client.mjs`, compiled);
  const { installSessionProtection } = await import(pathToFileURL(`${directory}/client.mjs`));
  let challenges = 0;
  let writes = [];
  let failureCode;
  axios.defaults.adapter = async (config) => {
    if (config.url.endsWith("/auth/get-csrf-token/")) {
      challenges++;
      return { data: { csrf_token: `token-${challenges}` }, status: 200, headers: {}, config };
    }
    writes.push(config);
    if (failureCode) {
      const code = failureCode;
      failureCode = undefined;
      throw new axios.AxiosError("denied", "ERR_BAD_REQUEST", config, undefined, {
        data: { code },
        status: 403,
        headers: {},
        config,
      });
    }
    return { data: {}, status: 200, headers: {}, config };
  };
  const client = axios.create({ baseURL: "https://lab.example.org", withCredentials: true });
  installSessionProtection(client, "https://lab.example.org");
  await Promise.all([client.post("/api/write/", {}), client.patch("/api/write/", {})]);
  assert.equal(challenges, 1, "parallel writes share one challenge");
  assert.equal(writes[0].headers.get("X-CSRFToken"), "token-1");
  await client.post("https://object-store.example.org/signed-upload/", {});
  assert.equal(writes.at(-1).headers.get("X-CSRFToken"), undefined, "no CSRF token sent to external uploads");
  const before = writes.length;
  failureCode = "CSRF_FAILED";
  await client.post("/api/write/", {});
  assert.equal(challenges, 2);
  assert.equal(writes.length, before + 2, "explicit CSRF failure retries once");
  failureCode = "PERMISSION_DENIED";
  await assert.rejects(client.post("/api/write/", {}));
  assert.equal(challenges, 2, "permission denial does not renew CSRF");
  window.dispatchEvent(new Event("lab-session-changed"));
  await client.post("/api/write/", {});
  assert.equal(challenges, 3, "login/logout clears the old challenge");
  let prompts = 0;
  window.addEventListener("lab-admin-reauthenticate", (event) => {
    prompts++;
    event.detail.resolve();
  });
  failureCode = "ADMIN_REAUTH_REQUIRED";
  await client.post("/api/instances/configuration/", {});
  assert.equal(prompts, 1);
  console.log("session client: 6 public HTTP contracts passed");
} finally {
  await rm(directory, { recursive: true, force: true });
}
