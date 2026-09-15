//! Shared HTTP client setup. Every reqwest client Grimoire uses is built here so
//! no request can hang forever on a stalled connection.

use reqwest::Client;
use std::time::Duration;

/// Timeouts for Grimoire's HTTP requests.
///
/// Addon ZIPs and the catalog file list can be tens of MB and users may be on
/// slow connections, so clients get no total timeout. Instead, `connect` bounds
/// connection setup and `read` fails a request once no data has arrived for
/// that long; it resets on every chunk, so a slow but steady download still
/// completes. Small JSON requests additionally get the `small_request` total
/// timeout, set per request with `RequestBuilder::timeout`.
#[derive(Debug, Clone, Copy)]
pub struct HttpTimeouts {
    pub connect: Duration,
    pub read: Duration,
    pub small_request: Duration,
}

impl Default for HttpTimeouts {
    fn default() -> Self {
        Self {
            // DNS, TCP and TLS normally take well under a second; 15s leaves
            // room for high-latency links.
            connect: Duration::from_secs(15),
            // A working connection, even a slow one, delivers data far more
            // often than this. Also bounds the wait for response headers.
            read: Duration::from_secs(30),
            // Configs, addon details and pastes are a few KB, so a minute only
            // trips on a server that trickles data without ever finishing.
            small_request: Duration::from_secs(60),
        }
    }
}

/// Build a reqwest client with the connect and read timeouts applied.
pub fn build_client(timeouts: HttpTimeouts) -> Client {
    Client::builder()
        .connect_timeout(timeouts.connect)
        .read_timeout(timeouts.read)
        .build()
        // Only fails if the TLS backend can't be initialized, which
        // `Client::new()` treats as fatal too.
        .expect("failed to build HTTP client")
}

/// Format a request error for display. Timeouts get a plain explanation naming
/// the server instead of reqwest's generic "error sending request".
pub fn describe_error(action: &str, server: &str, err: &reqwest::Error) -> String {
    if err.is_timeout() {
        format!(
            "{}: the {} server didn't respond in time. Check your internet connection and try again.",
            action, server
        )
    } else {
        format!("{}: {}", action, err)
    }
}

/// Minimal HTTP/1.1 server for unit tests. Each connection is handed to a
/// handler after the request head is read, so tests control exactly what is
/// written back (or not written at all).
#[cfg(test)]
pub(crate) mod test_server {
    use std::future::Future;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};

    /// Start a server on a free local port and return its base URL, e.g.
    /// `http://127.0.0.1:50123`. `handler` receives the connection and the
    /// request path.
    pub async fn spawn<F, Fut>(handler: F) -> String
    where
        F: Fn(TcpStream, String) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let handler = Arc::new(handler);
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let handler = handler.clone();
                tokio::spawn(async move {
                    if let Some(path) = read_request_path(&mut stream).await {
                        handler(stream, path).await;
                    }
                });
            }
        });
        base_url
    }

    /// Base URL of the server a connection was accepted on, for handlers that
    /// return absolute URLs.
    pub fn base_url(stream: &TcpStream) -> String {
        format!("http://{}", stream.local_addr().unwrap())
    }

    /// Read the request head and return the path from the request line.
    async fn read_request_path(stream: &mut TcpStream) -> Option<String> {
        let mut head = Vec::new();
        let mut buf = [0u8; 1024];
        while !head.windows(4).any(|w| w == b"\r\n\r\n") {
            let n = stream.read(&mut buf).await.ok()?;
            if n == 0 {
                return None;
            }
            head.extend_from_slice(&buf[..n]);
        }
        let head = String::from_utf8_lossy(&head);
        head.split_whitespace().nth(1).map(str::to_string)
    }

    /// Write the status line and headers for a body of `content_length` bytes.
    pub async fn write_head(stream: &mut TcpStream, status: u16, content_length: usize) {
        let head = format!(
            "HTTP/1.1 {} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            status, content_length
        );
        let _ = stream.write_all(head.as_bytes()).await;
    }

    /// Write a complete response and close the connection.
    pub async fn respond(mut stream: TcpStream, status: u16, body: &str) {
        write_head(&mut stream, status, body.len()).await;
        let _ = stream.write_all(body.as_bytes()).await;
        let _ = stream.shutdown().await;
    }

    /// Keep the connection open without writing anything else.
    pub async fn stall(stream: TcpStream) {
        let _open = stream;
        std::future::pending::<()>().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_timeouts_keep_small_requests_bounded() {
        let t = HttpTimeouts::default();
        assert!(t.connect > Duration::ZERO);
        assert!(t.read > Duration::ZERO);
        // The total timeout for small requests must not cut them off before
        // the read timeout had a chance to report a stall.
        assert!(t.small_request >= t.read);
    }

    #[tokio::test]
    async fn describe_error_keeps_non_timeout_details() {
        let client = build_client(HttpTimeouts::default());
        let err = client.get("not a url").send().await.unwrap_err();
        assert!(!err.is_timeout());
        let msg = describe_error("Failed to fetch thing", "ESOUI", &err);
        assert!(msg.starts_with("Failed to fetch thing: "));
        assert!(!msg.contains("didn't respond in time"));
    }

    #[tokio::test]
    async fn describe_error_explains_timeouts() {
        let base_url = test_server::spawn(|stream, _| test_server::stall(stream)).await;
        let client = build_client(HttpTimeouts {
            connect: Duration::from_secs(5),
            read: Duration::from_millis(200),
            small_request: Duration::from_secs(5),
        });
        let err = client.get(&base_url).send().await.unwrap_err();
        assert!(err.is_timeout());
        assert_eq!(
            describe_error("Failed to upload", "paste.rs", &err),
            "Failed to upload: the paste.rs server didn't respond in time. \
             Check your internet connection and try again."
        );
    }
}
