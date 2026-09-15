import { describe, it, expect } from "vitest";
import { buildDependentsMap } from "./dependents";
import type { InstalledAddon } from "../types/addon";

function makeAddon(dirName: string, deps: string[] = [], optionalDeps: string[] = []): InstalledAddon {
  return {
    dir_name: dirName,
    title: `${dirName} Title`,
    author: "Author",
    version: "1.0",
    addon_version: null,
    api_versions: [],
    depends_on: deps.map((name) => ({ name, min_version: null })),
    optional_depends_on: optionalDeps.map((name) => ({ name, min_version: null })),
    is_library: false,
    description: "",
  };
}

function dirNames(addons: InstalledAddon[] | undefined): string[] | undefined {
  return addons?.map((a) => a.dir_name);
}

describe("buildDependentsMap", () => {
  it("has no dependents when nothing requires the addon", () => {
    const map = buildDependentsMap([makeAddon("LibA"), makeAddon("Standalone")]);
    expect(map.get("LibA")).toBeUndefined();
    expect(map.get("Standalone")).toBeUndefined();
  });

  it("returns an empty map for an empty addon list", () => {
    expect(buildDependentsMap([]).size).toBe(0);
  });

  it("lists every installed addon that requires the dependency", () => {
    const map = buildDependentsMap([
      makeAddon("LibA"),
      makeAddon("LibB", ["LibA"]),
      makeAddon("AddonOne", ["LibA"]),
      makeAddon("AddonTwo", ["LibB", "LibA"]),
      makeAddon("AddonThree", ["LibB"]),
    ]);
    expect(dirNames(map.get("LibA"))).toEqual(["LibB", "AddonOne", "AddonTwo"]);
    expect(dirNames(map.get("LibB"))).toEqual(["AddonTwo", "AddonThree"]);
    expect(map.get("AddonOne")).toBeUndefined();
  });

  it("ignores an addon that depends on itself", () => {
    const map = buildDependentsMap([makeAddon("Loopy", ["Loopy"]), makeAddon("Other", ["Loopy"])]);
    expect(dirNames(map.get("Loopy"))).toEqual(["Other"]);
  });

  it("does not count optional dependencies", () => {
    const map = buildDependentsMap([makeAddon("LibA"), makeAddon("Enhancer", [], ["LibA"])]);
    expect(map.get("LibA")).toBeUndefined();
  });

  it("matches dependency names exactly", () => {
    const map = buildDependentsMap([
      makeAddon("LibAddonMenu-2.0"),
      makeAddon("WrongCase", ["libaddonmenu-2.0"]),
      makeAddon("Prefix", ["LibAddonMenu"]),
      makeAddon("Exact", ["LibAddonMenu-2.0"]),
    ]);
    expect(dirNames(map.get("LibAddonMenu-2.0"))).toEqual(["Exact"]);
  });

  it("lists an addon once when it names the same dependency twice", () => {
    // e.g. both DependsOn and PCDependsOn list the library
    const map = buildDependentsMap([makeAddon("LibA"), makeAddon("Both", ["LibA", "LibA"])]);
    expect(dirNames(map.get("LibA"))).toEqual(["Both"]);
  });
});
