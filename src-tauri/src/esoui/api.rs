use super::models::*;
use reqwest::Client;

const DEFAULT_GLOBAL_CONFIG_URL: &str = "https://api.mmoui.com/v3/globalconfig.json";
const ESO_GAME_ID: &str = "ESO";

/// Returns the MMOUI global config URL. Honors the `GRIMOIRE_API_BASE_URL`
/// environment variable as an override, primarily for E2E tests that point
/// the app at a local mock server.
fn global_config_url() -> String {
    std::env::var("GRIMOIRE_API_BASE_URL")
        .unwrap_or_else(|_| DEFAULT_GLOBAL_CONFIG_URL.to_string())
}

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
        let config: GlobalConfigResponse = self
            .client
            .get(global_config_url())
            .send()
            .await
            .map_err(|e| format!("Failed to fetch global config: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse global config: {}", e))?;

        let eso_entry = config
            .games
            .into_iter()
            .find(|g| g.game_id == ESO_GAME_ID)
            .ok_or("ESO not found in global config")?;

        let game_config: GameConfig = self
            .client
            .get(&eso_entry.game_config)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch game config: {}", e))?
            .json()
            .await
            .map_err(|e| format!("Failed to parse game config: {}", e))?;

        self.api_feeds = Some(game_config.api_feeds);
        Ok(())
    }

    pub fn is_initialized(&self) -> bool {
        self.api_feeds.is_some()
    }

    fn feeds(&self) -> Result<&ApiFeeds, String> {
        self.api_feeds
            .as_ref()
            .ok_or("API not initialized. Call init() first.".to_string())
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
    pub async fn fetch_addon_details(
        &self,
        addon_id: &str,
    ) -> Result<Vec<AddonDetails>, String> {
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
        let response = self
            .client
            .get(download_url)
            .send()
            .await
            .map_err(|e| format!("Download failed: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("Download failed with HTTP {}", status.as_u16()));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read download: {}", e))?;
        Ok(bytes.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_client_not_initialized() {
        let client = EsoUiClient::new();
        assert!(client.api_feeds.is_none());
    }

    #[test]
    fn client_is_not_initialized_before_init() {
        let client = EsoUiClient::new();
        assert!(!client.is_initialized());
    }

    #[test]
    fn test_global_config_url_env_override() {
        // SAFETY: `set_var` / `remove_var` are unsafe in recent Rust (multi-thread races).
        // This test intentionally uses a unique env var name + resets it, and relies on
        // cargo running tests single-threaded-per-process for env-var-sensitive code paths
        // to be reliable. In practice tests here don't clash because no other test reads
        // GRIMOIRE_API_BASE_URL.
        let key = "GRIMOIRE_API_BASE_URL";
        // Save any existing value so we restore it after the test.
        let previous = std::env::var(key).ok();

        unsafe { std::env::set_var(key, "http://localhost:12345/globalconfig.json"); }
        assert_eq!(
            global_config_url(),
            "http://localhost:12345/globalconfig.json"
        );

        unsafe { std::env::remove_var(key); }
        assert_eq!(global_config_url(), DEFAULT_GLOBAL_CONFIG_URL);

        // Restore any previous value so we don't leak into other tests.
        if let Some(val) = previous {
            unsafe { std::env::set_var(key, val); }
        }
    }

    #[tokio::test]
    async fn test_fetch_without_init_fails() {
        let client = EsoUiClient::new();
        let result = client.fetch_file_list().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[tokio::test]
    async fn test_fetch_details_without_init_fails() {
        let client = EsoUiClient::new();
        let result = client.fetch_addon_details("123").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not initialized"));
    }

    #[ignore] // Requires network — run with: cargo test -- --ignored
    #[tokio::test]
    async fn test_init_real_api() {
        let mut client = EsoUiClient::new();
        client.init().await.unwrap();
        assert!(client.api_feeds.is_some());

        let feeds = client.feeds().unwrap();
        assert!(!feeds.file_list.is_empty());
        assert!(!feeds.file_details.is_empty());
    }

    #[ignore] // Requires network — run with: cargo test -- --ignored
    #[tokio::test]
    async fn test_fetch_file_list_real() {
        let mut client = EsoUiClient::new();
        client.init().await.unwrap();

        let list = client.fetch_file_list().await.unwrap();
        assert!(!list.is_empty(), "Catalog should have addons");
        // Spot check first entry has required fields
        assert!(!list[0].uid.is_empty());
        assert!(!list[0].ui_name.is_empty());
    }
}
