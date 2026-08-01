// Bundles the CLI and the MCP server into the two publishable packages under
// packages/.
//
// Our own source is bundled in; the real dependencies stay external so they
// install normally from the package manifests. @napi-rs/canvas in particular
// MUST stay external — it is a native module, and pdf.js resolves its own copy
// at runtime to populate globalThis.Path2D. Bundling a second copy in would
// reintroduce the cross-instance Path2D failure that src/platform/node.ts
// exists to avoid.
import { build } from "esbuild";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const all = { ...pkg.dependencies, ...pkg.devDependencies };

const EXTERNAL = ["pdfjs-dist", "pdf-lib", "@napi-rs/canvas", "@modelcontextprotocol/sdk", "zod"];

const TARGETS = [
  { pkgDir: "blackout", entry: "src/agent/cli.ts", outfile: "dist/cli.mjs" },
  { pkgDir: "blackout-mcp", entry: "src/agent/mcp.ts", outfile: "dist/mcp.mjs" },
];

for (const t of TARGETS) {
  const outdir = join(root, "packages", t.pkgDir, "dist");
  const manifestPath = join(root, "packages", t.pkgDir, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  await build({
    entryPoints: [join(root, t.entry)],
    outfile: join(root, "packages", t.pkgDir, t.outfile),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: EXTERNAL,
    banner: { js: "#!/usr/bin/env node" },
    // Single source of truth for the version the binary reports. The MCP
    // handshake and `blackout --version` both read this, so neither can
    // disagree with the package that ships them.
    define: { __BLACKOUT_VERSION__: JSON.stringify(manifest.version) },
    logLevel: "warning",
  });

  // Keep each manifest's dependency ranges identical to what was actually
  // built and tested here, rather than letting them drift by hand.
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    if (!all[dep]) throw new Error(`${t.pkgDir} depends on ${dep}, which the repo does not install`);
    manifest.dependencies[dep] = all[dep];
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // The MCP registry publishes from server.json, npm from package.json. When
  // those disagree the registry advertises a version of a package that does
  // not exist — fail the build rather than discover it after publishing.
  const serverJsonPath = join(root, "packages", t.pkgDir, "server.json");
  if (existsSync(serverJsonPath)) {
    const server = JSON.parse(await readFile(serverJsonPath, "utf8"));
    const pkgVersions = (server.packages ?? []).map((p) => p.version);
    const mismatched = [server.version, ...pkgVersions].filter((v) => v !== manifest.version);
    if (mismatched.length) {
      throw new Error(
        `${t.pkgDir}: server.json declares ${[...new Set(mismatched)].join(", ")} ` +
          `but package.json is ${manifest.version} — bump both before publishing.`,
      );
    }
  }

  console.log(`built packages/${t.pkgDir}/${t.outfile} (v${manifest.version})`);
}
