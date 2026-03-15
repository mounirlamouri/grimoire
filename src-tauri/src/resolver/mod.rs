use crate::addon::manifest::Dependency;
use std::collections::HashSet;

/// Given a list of dependencies and a set of already-installed directory names,
/// return the dependencies that are missing.
pub fn find_missing_dependencies(
    depends_on: &[Dependency],
    installed_dirs: &HashSet<String>,
) -> Vec<Dependency> {
    depends_on
        .iter()
        .filter(|dep| !installed_dirs.contains(&dep.name))
        .cloned()
        .collect()
}
