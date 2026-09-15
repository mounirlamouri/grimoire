use super::models::*;
use crate::http::{self, HttpTimeouts};
use reqwest::Client;
use serde::de::DeserializeOwned;
use std::time::Duration;

const DEFAULT_GLOBAL_CONFIG_URL: &str = "https://api.mmoui.com/v3/globalconfig.json";
const ESO_GAME_ID: &str = "ESO";
/// Server name used in user-facing error messages.
const SERVER_NAME: &str = "ESOUI";

/// Returns the MMOUI global config URL. Honors the `GRIMOIRE_API_BASE_URL`
/// environment variable as an override, primarily for E2E tests that point
/// the app at a local mock server.
fn global_config_url() -> String {
    std::env::var("GRIMOIRE_API_BASE_URL")
        .unwrap_or_else(|_| DEFAULT_GLOBAL_CONFIG_URL.to_string())
}

pub struct EsoUiClient {
    client: Client,
    global_config_url: String,
    small_request_timeout: Duration,
    api_feeds: Option<ApiFeeds>,
}

impl EsoUiClient {
    /// Client for the MMOUI API (or the `GRIMOIRE_API_BASE_URL` override) with
    /// the default timeouts.
    pub fn new() -> Self {
        Self::with_config(global_config_url(), HttpTimeouts::default())
    }

    /// Client for an explicit global config URL and timeouts, so tests can use
    /// a local server and short timeouts without touching environment variables.
    pub fn with_config(global_config_url: String, timeouts: HttpTimeouts) -> Self {
        Self {
            client: http::build_client(timeouts),
            global_config_url,
            small_request_timeout: timeouts.small_request,
            api_feeds: None,
        }
    }

    /// Discover the MMOUI API feeds for ESO.
    pub async fn init(&mut self) -> Result<(), String> {
        let config: GlobalConfigResponse = self
            .get_json(&self.global_config_url, "global config", Some(self.small_request_timeout))
            .await?;

        let eso_entry = config
            .games
            .into_iter()
            .find(|g| g.game_id == ESO_GAME_ID)
            .ok_or("ESO not found in global config")?;

        let game_config: GameConfig = self
            .get_json(&eso_entry.game_config, "game config", Some(self.small_request_timeout))
            .await?;

        self.api_feeds = Some(game_config.api_feeds);
        Ok(())
    }

    /// GET `url` and parse the JSON body; `what` names the document in error
    /// messages. Pass `total_timeout` only for small documents: the file list
    /// can be tens of MB, so it relies on the client's read timeout alone.
    async fn get_json<T: DeserializeOwned>(
        &self,
        url: &str,
        what: &str,
        total_timeout: Option<Duration>,
    ) -> Result<T, String> {
        let mut request = self.client.get(url);
        if let Some(timeout) = total_timeout {
            request = request.timeout(timeout);
        }
        let fetch_error =
            |e: reqwest::Error| http::describe_error(&format!("Failed to fetch {}", what), SERVER_NAME, &e);
        let bytes = request
            .send()
            .await
            .map_err(fetch_error)?
            .bytes()
            .await
            .map_err(fetch_error)?;
        serde_json::from_slice(&bytes).map_err(|e| format!("Failed to parse {}: {}", what, e))
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
        self.get_json(&feeds.file_list, "file list", None).await
    }

    /// Fetch details for a specific addon by ID.
    pub async fn fetch_addon_details(
        &self,
        addon_id: &str,
    ) -> Result<Vec<AddonDetails>, String> {
        let feeds = self.feeds()?;
        let url = format!("{}{}.json", feeds.file_details, addon_id);
        self.get_json(&url, "addon details", Some(self.small_request_timeout))
            .await
    }

    /// Download an addon ZIP file and return the bytes. ZIPs can be large, so
    /// there is no total timeout, only the client's connect and read timeouts.
    pub async fn download_addon(&self, download_url: &str) -> Result<Vec<u8>, String> {
        let response = self
            .client
            .get(download_url)
            .send()
            .await
            .map_err(|e| http::describe_error("Download failed", SERVER_NAME, &e))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("Download failed with HTTP {}", status.as_u16()));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| http::describe_error("Failed to read download", SERVER_NAME, &e))?;
        Ok(bytes.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::test_server;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpStream;

    /// Upper bound for requests expected to fail on a short timeout. Reaching
    /// it means the client hung.
    const HANG_GUARD: Duration = Duration::from_secs(10);

    fn short_timeouts(read_ms: u64, small_request_ms: u64) -> HttpTimeouts {
        HttpTimeouts {
            connect: Duration::from_secs(5),
            read: Duration::from_millis(read_ms),
            small_request: Duration::from_millis(small_request_ms),
        }
    }

    fn client_for(base_url: &str, timeouts: HttpTimeouts) -> EsoUiClient {
        EsoUiClient::with_config(format!("{}/globalconfig.json", base_url), timeouts)
    }

    async fn no_hang<T>(fut: impl std::future::Future<Output = T>) -> T {
        tokio::time::timeout(HANG_GUARD, fut)
            .await
            .expect("request hung instead of timing out")
    }

    /// Answer the global and game config requests like MMOUI does. Returns the
    /// connection for any other path.
    async fn serve_configs(stream: TcpStream, path: &str) -> Option<TcpStream> {
        let base = test_server::base_url(&stream);
        let body = match path {
            "/globalconfig.json" => format!(
                r#"{{"GAMES":[{{"GameID":"ESO","GameConfig":"{}/gameconfig.json"}}]}}"#,
                base
            ),
            "/gameconfig.json" => format!(
                r#"{{"APIFeeds":{{"FileList":"{0}/filelist.json","FileDetails":"{0}/filedetails/","CategoryList":"{0}/categorylist.json"}}}}"#,
                base
            ),
            _ => return Some(stream),
        };
        test_server::respond(stream, 200, &body).await;
        None
    }

    #[tokio::test]
    async fn init_times_out_when_server_never_responds() {
        let base_url = test_server::spawn(|stream, _| test_server::stall(stream)).await;
        let mut client = client_for(&base_url, short_timeouts(200, 10_000));

        let err = no_hang(client.init()).await.unwrap_err();
        assert!(
            err.starts_with("Failed to fetch global config: the ESOUI server didn't respond in time"),
            "{}",
            err
        );
        assert!(!client.is_initialized());
    }

    #[tokio::test]
    async fn file_list_times_out_when_body_stalls() {
        let base_url = test_server::spawn(|stream, path| async move {
            if let Some(mut stream) = serve_configs(stream, &path).await {
                // Headers and the start of a large body, then nothing.
                test_server::write_head(&mut stream, 200, 10_000_000).await;
                let _ = stream.write_all(br#"[{"UID":"#).await;
                test_server::stall(stream).await;
            }
        })
        .await;
        let mut client = client_for(&base_url, short_timeouts(200, 10_000));
        no_hang(client.init()).await.unwrap();

        let err = no_hang(client.fetch_file_list()).await.unwrap_err();
        assert!(
            err.starts_with("Failed to fetch file list: the ESOUI server didn't respond in time"),
            "{}",
            err
        );
    }

    #[tokio::test]
    async fn download_times_out_when_body_stalls() {
        let base_url = test_server::spawn(|mut stream, _| async move {
            test_server::write_head(&mut stream, 200, 1_000_000).await;
            let _ = stream.write_all(&[0u8; 1024]).await;
            test_server::stall(stream).await;
        })
        .await;
        let client = client_for(&base_url, short_timeouts(200, 10_000));

        let err = no_hang(client.download_addon(&format!("{}/addon.zip", base_url)))
            .await
            .unwrap_err();
        assert!(
            err.starts_with("Failed to read download: the ESOUI server didn't respond in time"),
            "{}",
            err
        );
    }

    #[tokio::test]
    async fn small_requests_time_out_when_data_trickles() {
        // Sends a byte every 20ms: never idle long enough for the read timeout,
        // and would take 20s to finish without the total timeout.
        let base_url = test_server::spawn(|mut stream, _| async move {
            test_server::write_head(&mut stream, 200, 1_000).await;
            for _ in 0..1_000 {
                if stream.write_all(b" ").await.is_err() {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await;
        let mut client = client_for(&base_url, short_timeouts(5_000, 300));

        let err = no_hang(client.init()).await.unwrap_err();
        assert!(err.contains("didn't respond in time"), "{}", err);
    }

    #[tokio::test]
    async fn large_responses_have_no_total_timeout() {
        // The file list and downloads take ~800ms here, well past the 300ms
        // small-request timeout, but data keeps arriving so they succeed.
        const BODY: &[u8] = b"[        ]";
        let base_url = test_server::spawn(|stream, path| async move {
            if let Some(mut stream) = serve_configs(stream, &path).await {
                test_server::write_head(&mut stream, 200, BODY.len()).await;
                for byte in BODY {
                    tokio::time::sleep(Duration::from_millis(80)).await;
                    let _ = stream.write_all(&[*byte]).await;
                }
                let _ = stream.shutdown().await;
            }
        })
        .await;
        let mut client = client_for(&base_url, short_timeouts(5_000, 300));
        no_hang(client.init()).await.unwrap();

        let list = no_hang(client.fetch_file_list()).await.unwrap();
        assert!(list.is_empty());
        let bytes = no_hang(client.download_addon(&format!("{}/addon.zip", base_url)))
            .await
            .unwrap();
        assert_eq!(bytes, BODY);
    }

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
