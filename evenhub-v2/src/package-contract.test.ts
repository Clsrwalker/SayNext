import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, test } from "vitest";

type EvenHubManifest = {
  package_id: string;
  name: string;
  version: string;
  entrypoint: string;
  min_sdk_version: string;
  permissions: Array<{
    name: string;
    desc: string;
    whitelist?: string[];
  }>;
};

type PackageJson = {
  name: string;
  version: string;
  dependencies: Record<string, string>;
};

const projectRoot = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(projectRoot, "app.json"), "utf8"),
) as EvenHubManifest;
const packageJson = JSON.parse(
  readFileSync(join(projectRoot, "package.json"), "utf8"),
) as PackageJson;
const indexHtml = readFileSync(join(projectRoot, "index.html"), "utf8");

describe("EvenHub package source contract", () => {
  test("keeps package identity, version, and SDK requirements aligned", () => {
    expect(manifest.package_id).toBe("com.xiangli.saynext.evenhub");
    expect(manifest.package_id).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/);
    expect(manifest.name).toBe("SayNext");
    expect(manifest.version).toBe(packageJson.version);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.min_sdk_version).toBe(
      packageJson.dependencies["@evenrealities/even_hub_sdk"],
    );
  });

  test("uses an existing project-local HTML entrypoint with the React root", () => {
    const entrypoint = normalize(join(projectRoot, manifest.entrypoint));
    expect(relative(projectRoot, entrypoint)).not.toMatch(/^\.\.(?:[\\/]|$)/);
    expect(dirname(entrypoint)).toBe(projectRoot);
    expect(existsSync(entrypoint)).toBe(true);
    expect(indexHtml).toContain('id="root"');
    expect(indexHtml).toContain('src="/src/main.tsx"');
  });

  test("declares unique network, phone mic, and G2 mic permissions", () => {
    const permissionNames = manifest.permissions.map((permission) => permission.name);
    expect(new Set(permissionNames).size).toBe(permissionNames.length);
    expect(permissionNames).toEqual(expect.arrayContaining([
      "network",
      "phone-microphone",
      "g2-microphone",
    ]));

    for (const permission of manifest.permissions) {
      expect(permission.desc.trim().length).toBeGreaterThan(0);
    }
  });

  test("allows both HTTPS and WSS access to the same production backend", () => {
    const network = manifest.permissions.find((permission) => permission.name === "network");
    expect(network).toBeDefined();
    const productionUrls = (network?.whitelist || [])
      .map((value) => new URL(value))
      .filter((url) => url.hostname !== "localhost");

    expect(productionUrls.map((url) => url.protocol)).toEqual(
      expect.arrayContaining(["https:", "wss:"]),
    );
    expect(new Set(productionUrls.map((url) => url.hostname))).toEqual(
      new Set(["saynext.167.172.153.109.sslip.io"]),
    );
  });
});
