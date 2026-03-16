use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct GlobalConfigResponse {
    #[serde(rename = "GAMES")]
    pub games: Vec<GameEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct GameEntry {
    #[serde(rename = "GameID")]
    pub game_id: String,
    pub game_config: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct GameConfig {
    #[serde(rename = "APIFeeds")]
    pub api_feeds: ApiFeeds,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ApiFeeds {
    pub file_list: String,
    pub file_details: String,
    pub category_list: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct AddonListItem {
    #[serde(rename = "UID")]
    pub uid: String,
    #[serde(rename = "UIName")]
    pub ui_name: String,
    #[serde(rename = "UIVersion")]
    pub ui_version: Option<String>,
    #[serde(rename = "UIDate")]
    pub ui_date: Option<serde_json::Value>,
    #[serde(rename = "UIDownloadTotal")]
    pub ui_download_total: Option<String>,
    #[serde(rename = "UIFavoriteTotal")]
    pub ui_favorite_total: Option<String>,
    #[serde(rename = "UIDir")]
    pub ui_dir: Option<Vec<String>>,
    #[serde(rename = "UICATID")]
    pub ui_cat_id: Option<String>,
    #[serde(rename = "UIDownload")]
    pub ui_download: Option<String>,
    #[serde(rename = "UIAuthorName")]
    pub ui_author_name: Option<String>,
    #[serde(rename = "UIFileInfoURL")]
    pub ui_file_info_url: Option<String>,
    #[serde(rename = "UIDownloadMonthly")]
    pub ui_download_monthly: Option<String>,
    #[serde(rename = "UICompatibility")]
    pub ui_compatibility: Option<serde_json::Value>,
    #[serde(rename = "UISiblings")]
    pub ui_siblings: Option<serde_json::Value>,
    #[serde(rename = "UIDonationLink")]
    pub ui_donation_link: Option<serde_json::Value>,
    #[serde(rename = "UIIMG_Thumbs")]
    pub ui_img_thumbs: Option<Vec<String>>,
    #[serde(rename = "UIIMGs")]
    pub ui_imgs: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct AddonUpdate {
    pub dir_name: String,
    pub title: String,
    pub installed_version: String,
    pub latest_version: String,
    pub uid: String,
    pub download_url: Option<String>,
    /// True when we already installed the latest from ESOUI but the
    /// manifest version doesn't match the catalog version (addon author
    /// uses a different numbering scheme on ESOUI vs the manifest).
    pub version_mismatch: bool,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct AddonDetails {
    #[serde(rename = "UID")]
    pub uid: String,
    #[serde(rename = "UIName")]
    pub ui_name: String,
    #[serde(rename = "UIVersion")]
    pub ui_version: Option<String>,
    #[serde(rename = "UIAuthorName")]
    pub ui_author_name: Option<String>,
    #[serde(rename = "UIDescription")]
    pub ui_description: Option<String>,
    #[serde(rename = "UIDownload")]
    pub ui_download: Option<String>,
    #[serde(rename = "UIDir")]
    pub ui_dir: Option<String>,
    #[serde(rename = "UIDownloadTotal")]
    pub ui_download_total: Option<String>,
}
