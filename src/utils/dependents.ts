import type { InstalledAddon } from "../types/addon";

/**
 * Maps each dependency dir_name to the installed addons that require it via
 * `DependsOn`/`PCDependsOn`, i.e. the addons that stop loading if it is
 * uninstalled. Optional dependencies don't block loading and are ignored, as
 * are addons that list themselves.
 */
export function buildDependentsMap(addons: InstalledAddon[]): Map<string, InstalledAddon[]> {
  const map = new Map<string, InstalledAddon[]>();
  for (const addon of addons) {
    // DependsOn and PCDependsOn are merged as-is, so a name can appear twice.
    const names = new Set(addon.depends_on.map((d) => d.name));
    for (const name of names) {
      if (name === addon.dir_name) continue;
      const dependents = map.get(name);
      if (dependents) {
        dependents.push(addon);
      } else {
        map.set(name, [addon]);
      }
    }
  }
  return map;
}
