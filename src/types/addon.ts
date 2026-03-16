export interface Dependency {
  name: string;
  min_version: number | null;
}

export interface InstalledAddon {
  dir_name: string;
  title: string;
  author: string;
  version: string;
  addon_version: number | null;
  api_versions: number[];
  depends_on: Dependency[];
  optional_depends_on: Dependency[];
  is_library: boolean;
  description: string;
}

export interface AddonUpdate {
  dir_name: string;
  title: string;
  installed_version: string;
  latest_version: string;
  uid: string;
  download_url: string | null;
  version_mismatch: boolean;
}

export interface InstallResult {
  installed_dirs: string[];
  auto_installed_deps: AutoInstalledDep[];
  missing_deps: string[];
  failed_deps: FailedDep[];
}

export interface AutoInstalledDep {
  dir_name: string;
  name: string;
}

export interface FailedDep {
  dir_name: string;
  error: string;
}

export interface CatalogAddon {
  uid: string;
  name: string;
  version: string | null;
  downloads: number;
  favorites: number;
  downloads_monthly: number;
  directories: string | null;
  category_id: string | null;
  author: string | null;
  download_url: string | null;
  file_info_url: string | null;
  is_library: boolean;
}

export interface CatalogStatus {
  addon_count: number;
  last_sync: string | null;
}

export interface SyncProgress {
  stage: string;
  detail: string;
  progress: number;
}
