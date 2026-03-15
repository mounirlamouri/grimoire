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
