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
