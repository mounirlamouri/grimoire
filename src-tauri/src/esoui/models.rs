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

// Mirrors the MMOUI API response — fields kept for schema completeness.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct ApiFeeds {
    pub file_list: String,
    pub file_details: String,
    pub category_list: String,
}

// Mirrors the MMOUI API response — fields kept for schema completeness.
#[allow(dead_code)]
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
}

// Mirrors the MMOUI API response — fields kept for schema completeness.
#[allow(dead_code)]
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
    #[serde(rename = "UIDate")]
    pub ui_date: Option<serde_json::Value>,
    #[serde(rename = "UICompatibility")]
    pub ui_compatibility: Option<serde_json::Value>,
    #[serde(rename = "UIDonationLink")]
    pub ui_donation_link: Option<serde_json::Value>,
    #[serde(rename = "UIIMG_Thumbs")]
    pub ui_img_thumbs: Option<Vec<String>>,
    #[serde(rename = "UIIMGs")]
    pub ui_imgs: Option<Vec<String>>,
    #[serde(rename = "UISiblings")]
    pub ui_siblings: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_global_config() {
        let json = r#"{
            "GAMES": [
                { "GameID": "ESO", "GameConfig": "https://example.com/eso.json" },
                { "GameID": "WOW", "GameConfig": "https://example.com/wow.json" }
            ]
        }"#;

        let config: GlobalConfigResponse = serde_json::from_str(json).unwrap();
        assert_eq!(config.games.len(), 2);
        assert_eq!(config.games[0].game_id, "ESO");
        assert_eq!(config.games[0].game_config, "https://example.com/eso.json");
    }

    #[test]
    fn test_deserialize_game_config() {
        let json = r#"{
            "APIFeeds": {
                "FileList": "https://example.com/filelist.json",
                "FileDetails": "https://example.com/details/",
                "CategoryList": "https://example.com/categories.json"
            }
        }"#;

        let config: GameConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.api_feeds.file_list, "https://example.com/filelist.json");
        assert_eq!(config.api_feeds.file_details, "https://example.com/details/");
    }

    #[test]
    fn test_deserialize_addon_list_item_full() {
        let json = r#"{
            "UID": "123",
            "UIName": "Test Addon",
            "UIVersion": "2.0 r41",
            "UIDate": 1700000000000,
            "UIDownloadTotal": "50000",
            "UIFavoriteTotal": "100",
            "UIDir": ["TestAddon", "TestAddonLib"],
            "UICATID": "53",
            "UIDownload": "https://example.com/test.zip",
            "UIAuthorName": "TestAuthor",
            "UIFileInfoURL": "https://example.com/info",
            "UIDownloadMonthly": "1000",
            "UICompatibility": [{"version": "101047", "name": "U43"}],
            "UISiblings": null,
            "UIDonationLink": null,
            "UIIMG_Thumbs": ["https://example.com/thumb.png"],
            "UIIMGs": ["https://example.com/full.png"]
        }"#;

        let item: AddonListItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.uid, "123");
        assert_eq!(item.ui_name, "Test Addon");
        assert_eq!(item.ui_version, Some("2.0 r41".to_string()));
        assert_eq!(item.ui_dir, Some(vec!["TestAddon".to_string(), "TestAddonLib".to_string()]));
        assert_eq!(item.ui_cat_id, Some("53".to_string()));
        assert_eq!(item.ui_author_name, Some("TestAuthor".to_string()));
        assert_eq!(item.ui_download_monthly, Some("1000".to_string()));
    }

    #[test]
    fn test_deserialize_addon_list_item_nulls() {
        let json = r#"{
            "UID": "456",
            "UIName": "Minimal Addon",
            "UIVersion": null,
            "UIDate": null,
            "UIDownloadTotal": null,
            "UIFavoriteTotal": null,
            "UIDir": null,
            "UICATID": null,
            "UIDownload": null,
            "UIAuthorName": null,
            "UIFileInfoURL": null,
            "UIDownloadMonthly": null,
            "UICompatibility": null,
            "UISiblings": null,
            "UIDonationLink": null,
            "UIIMG_Thumbs": null,
            "UIIMGs": null
        }"#;

        let item: AddonListItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.uid, "456");
        assert_eq!(item.ui_name, "Minimal Addon");
        assert_eq!(item.ui_version, None);
        assert_eq!(item.ui_dir, None);
        assert_eq!(item.ui_download, None);
    }

    #[test]
    fn test_ui_date_as_number() {
        let json = r#"{
            "UID": "1",
            "UIName": "A",
            "UIDate": 1700000000000,
            "UIDownloadTotal": null, "UIFavoriteTotal": null,
            "UIVersion": null, "UIDir": null, "UICATID": null,
            "UIDownload": null, "UIAuthorName": null, "UIFileInfoURL": null,
            "UIDownloadMonthly": null, "UICompatibility": null,
            "UISiblings": null, "UIDonationLink": null,
            "UIIMG_Thumbs": null, "UIIMGs": null
        }"#;

        let item: AddonListItem = serde_json::from_str(json).unwrap();
        assert!(item.ui_date.is_some());
        assert!(item.ui_date.unwrap().is_number());
    }

    #[test]
    fn test_deserialize_addon_details() {
        let json = r#"[{
            "UID": "789",
            "UIName": "Detail Addon",
            "UIVersion": "3.0",
            "UIAuthorName": "DetailAuthor",
            "UIDescription": "A detailed description",
            "UIDownload": "https://example.com/detail.zip",
            "UIDir": "DetailAddon",
            "UIDownloadTotal": "25000"
        }]"#;

        let details: Vec<AddonDetails> = serde_json::from_str(json).unwrap();
        assert_eq!(details.len(), 1);
        assert_eq!(details[0].uid, "789");
        assert_eq!(details[0].ui_name, "Detail Addon");
        assert_eq!(details[0].ui_version, Some("3.0".to_string()));
        assert_eq!(details[0].ui_dir, Some("DetailAddon".to_string()));
    }

    /// Realistic payload that mirrors the per-addon ESOUI FileDetails response,
    /// exercising every metadata field added for the card-expand feature.
    /// UIDate arrives as a number (ms), UIDonationLink as a bare string,
    /// UICompatibility/UISiblings as arrays, and UIIMG_Thumbs/UIIMGs as string arrays.
    #[test]
    fn test_deserialize_addon_details_with_metadata_fields() {
        let json = r#"[{
            "UID": "100",
            "UIName": "Full Metadata",
            "UIVersion": "1.2.3",
            "UIAuthorName": "Author",
            "UIDescription": "Desc with [b]bbcode[/b]",
            "UIDownload": "https://example.com/a.zip",
            "UIDir": "FullMeta",
            "UIDownloadTotal": "1000",
            "UIDate": 1700000000000,
            "UICompatibility": [
                { "version": "101047", "name": "U43 Update" },
                { "version": "101046", "name": "U42 Update" }
            ],
            "UIDonationLink": "https://donate.example.com/author",
            "UIIMG_Thumbs": ["https://cdn.example.com/t1.png", "https://cdn.example.com/t2.png"],
            "UIIMGs": ["https://cdn.example.com/full1.png", "https://cdn.example.com/full2.png"],
            "UISiblings": [{ "UID": "101", "UIName": "Sibling Addon" }]
        }]"#;

        let details: Vec<AddonDetails> = serde_json::from_str(json).unwrap();
        assert_eq!(details.len(), 1);
        let d = &details[0];

        // UIDate comes through as a Value::Number and exposes as_i64
        assert_eq!(d.ui_date.as_ref().and_then(|v| v.as_i64()), Some(1700000000000));

        // UICompatibility is an array of objects — preserved as Value
        let compat = d.ui_compatibility.as_ref().expect("compatibility present");
        assert!(compat.is_array());
        assert_eq!(compat.as_array().unwrap().len(), 2);

        // UIDonationLink arrives as a bare string on real API responses
        assert_eq!(
            d.ui_donation_link.as_ref().and_then(|v| v.as_str()),
            Some("https://donate.example.com/author")
        );

        assert_eq!(d.ui_img_thumbs.as_ref().map(|v| v.len()), Some(2));
        assert_eq!(d.ui_imgs.as_ref().map(|v| v.len()), Some(2));
        assert!(d.ui_siblings.as_ref().map(|v| v.is_array()).unwrap_or(false));
    }

    /// UIDonationLink frequently arrives as null — verify the Option<Value>
    /// deserializes as None rather than panicking.
    #[test]
    fn test_deserialize_addon_details_null_optional_metadata() {
        let json = r#"[{
            "UID": "200",
            "UIName": "Sparse",
            "UIVersion": null,
            "UIAuthorName": null,
            "UIDescription": null,
            "UIDownload": null,
            "UIDir": null,
            "UIDownloadTotal": null,
            "UIDate": null,
            "UICompatibility": null,
            "UIDonationLink": null,
            "UIIMG_Thumbs": null,
            "UIIMGs": null,
            "UISiblings": null
        }]"#;

        let details: Vec<AddonDetails> = serde_json::from_str(json).unwrap();
        let d = &details[0];
        assert_eq!(d.uid, "200");
        assert!(d.ui_date.is_none());
        assert!(d.ui_compatibility.is_none());
        assert!(d.ui_donation_link.is_none());
        assert!(d.ui_img_thumbs.is_none());
        assert!(d.ui_imgs.is_none());
        assert!(d.ui_siblings.is_none());
    }
}
