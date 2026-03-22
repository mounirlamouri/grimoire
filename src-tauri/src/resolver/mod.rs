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

#[cfg(test)]
mod tests {
    use super::*;

    fn dep(name: &str) -> Dependency {
        Dependency { name: name.to_string(), min_version: None }
    }

    fn installed(names: &[&str]) -> HashSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn test_no_missing_deps() {
        let deps = vec![dep("LibA"), dep("LibB")];
        let installed = installed(&["LibA", "LibB"]);
        assert!(find_missing_dependencies(&deps, &installed).is_empty());
    }

    #[test]
    fn test_all_missing_deps() {
        let deps = vec![dep("LibA"), dep("LibB")];
        let installed = installed(&[]);
        let missing = find_missing_dependencies(&deps, &installed);
        assert_eq!(missing.len(), 2);
    }

    #[test]
    fn test_some_missing() {
        let deps = vec![dep("LibA"), dep("LibB"), dep("LibC")];
        let installed = installed(&["LibB"]);
        let missing = find_missing_dependencies(&deps, &installed);
        assert_eq!(missing.len(), 2);
        assert_eq!(missing[0].name, "LibA");
        assert_eq!(missing[1].name, "LibC");
    }

    #[test]
    fn test_empty_deps() {
        let installed = installed(&["LibA"]);
        assert!(find_missing_dependencies(&[], &installed).is_empty());
    }

    #[test]
    fn test_empty_installed() {
        let deps = vec![dep("LibA")];
        let missing = find_missing_dependencies(&deps, &HashSet::new());
        assert_eq!(missing.len(), 1);
    }
}
