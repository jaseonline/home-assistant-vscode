import * as assert from "assert";
import * as path from "path";
import { HomeAssistantConfiguration } from "../../language-service/src/haConfig/haConfig";

const ws = path.resolve("/ha-workspace");

/** In-memory FileAccessor over a flat list of absolute file paths. */
class MemoryFileAccessor {
  public listings: { folder: string; maxDepth: number }[] = [];

  constructor(private files: string[]) {}

  async getFilesInFolder(subFolder: string, ignoreDirs: string[] = [], maxDepth = Infinity): Promise<string[]> {
    const folder = path.isAbsolute(subFolder) ? subFolder : path.join(ws, subFolder);
    this.listings.push({ folder, maxDepth });
    return this.files.filter((f) => {
      const rel = path.relative(folder, f);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return false;
      }
      const dirs = rel.split(path.sep).slice(0, -1);
      return dirs.length <= maxDepth && !dirs.some((d) => ignoreDirs.includes(d));
    });
  }

  async getFileContents(): Promise<string> {
    return "";
  }
}

const rootFilesOf = async (files: string[]) => {
  const accessor = new MemoryFileAccessor(files.map((f) => path.join(ws, f)));
  const config = new HomeAssistantConfiguration(accessor as any);
  const roots: string[] = await (config as any).getRootFiles();
  return {
    roots: roots.map((r) => path.relative(ws, r)).sort(),
    subFolder: (config as any).subFolder as string,
    accessor,
  };
};

suite("Root config discovery", () => {
  test("finds root files and HA config folders without walking the whole tree", async () => {
    const { roots, subFolder, accessor } = await rootFilesOf([
      "configuration.yaml",
      "automations.yaml",
      path.join("blueprints", "automation", "me", "motion.yaml"),
      path.join("blueprints", "automation", "me", "README.md"),
      path.join("custom_components", "icons", "data", "a.svg"),
      path.join("multiscrape", "page.html"),
    ]);

    assert.deepStrictEqual(roots, [
      "automations.yaml",
      path.join("blueprints", "automation", "me", "motion.yaml"),
      "configuration.yaml",
    ]);
    assert.strictEqual(subFolder, ws);

    const fullWalksOfRoot = accessor.listings.filter((l) => l.folder === ws && l.maxDepth !== 0);
    assert.strictEqual(fullWalksOfRoot.length, 0, "the workspace root must only be listed one level deep");
  });

  test("falls back to a (filtered) walk when the config lives in a subfolder", async () => {
    const { roots, subFolder } = await rootFilesOf([
      path.join("config", "configuration.yaml"),
      path.join("custom_components", "x", "configuration.yaml"),
    ]);

    assert.deepStrictEqual(roots, [path.join("config", "configuration.yaml")]);
    assert.strictEqual(subFolder, path.join(ws, "config"));
  });
});
