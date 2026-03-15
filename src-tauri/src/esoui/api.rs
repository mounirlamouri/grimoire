use super::models::*;
use reqwest::Client;

const GLOBAL_CONFIG_URL: &str = "https://api.mmoui.com/v3/globalconfig.json";
const ESO_GAME_ID: &str = "ESO";

pub struct EsoUiClient {
    client: Client,
    api_feeds: Option<ApiFeeds>,
}

impl EsoUiClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_feeds: None,
        }
    }

    /// Discover the MMOUI API feeds for ESO.
    pub async fn init(&mut self) -> Result<(), String> {
        let configs: Vec<GlobalConfig> = self
            .client
            .get(GLOBAL_CONFIG_URL)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch global config: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse global config: {}", e))?;

        let eso_config = configs
            .into_iter()
            .find(|c| c.game_id == ESO_GAME_ID)
            .ok_or("ESO not found in global config")?;

        let game_config: GameConfig = self
            .client
            .get(&eso_config.game_config)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch game config: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse game config: {}", e))?;

        self.api_feeds = Some(game_config.api_feeds);
        Ok(())
    }

    fn feeds(&self) -> Result<&ApiFeeds, String> {
        self.api_feeds.as_ref().ok_or("API not initialized. Call init() first.".to_string())
    }

    /// Fetch the full addon catalog.
    pub async fn fetch_file_list(&self) -> Result<Vec<AddonListItem>, String> {
        let feeds = self.feeds()?;
        let items: Vec<AddonListItem> = self
            .client
            .get(&feeds.file_list)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch file list: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse file list: {}", e))?;
        Ok(items)
    }

    /// Fetch details for a specific addon by ID.
    pub async fn fetch_addon_details(&self, addon_id: &str) -> Result<Vec<AddonDetails>, String> {
        let feeds = self.feeds()?;
        let url = format!("{}{}.json", feeds.file_details, addon_id);
        let details: Vec<AddonDetails> = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch addon details: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse addon details: {}", e))?;
        Ok(details)
    }

    /// Download an addon ZIP file and return the bytes.
    pub async fn download_addon(&self, download_url: &str) -> Result<Vec<u8>, String> {
        let bytes = self
            .client
            .get(download_url)
            .send()
            .await
            .map_err(|e| format!("Download failed: {}", e))?
            .bytes()
            .await
            .map_err(|e| format!("Failed to read download: {}", e))?;
        Ok(bytes.to_vec())
    }
}
