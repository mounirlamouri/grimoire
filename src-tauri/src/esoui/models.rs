use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct GlobalConfig {
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
#[serde(rename_all = "PascalCase")]
pub struct AddonListItem {
    #[serde(rename = "UID")]
    pub uid: String,
    #[serde(rename = "UIName")]
    pub ui_name: String,
    #[serde(rename = "UIVersion")]
    pub ui_version: Option<String>,
    #[serde(rename = "UIDate")]
    pub ui_date: Option<String>,
    #[serde(rename = "UIDownloadTotal")]
    pub ui_download_total: Option<String>,
    #[serde(rename = "UIFavoriteTotal")]
    pub ui_favorite_total: Option<String>,
    #[serde(rename = "UIDir")]
    pub ui_dir: Option<String>,
    #[serde(rename = "UICATID")]
    pub ui_cat_id: Option<String>,
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
