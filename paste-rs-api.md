# paste.rs API Reference

Reference for integrating paste.rs into Grimoire's addon list export/import feature.

## Why paste.rs

Chosen after evaluating multiple paste services (2026-04-04):

- **No authentication** — no API keys, no accounts, no credentials to ship or manage
- **No captcha** — works fully programmatically from a desktop app
- **No ads** — clean experience when users open paste URLs in a browser
- **Trivial API** — single POST with raw body, returns URL
- **Free** — no paid tier required

Rejected alternatives:
- **dpaste.org** — discontinued
- **pastebin.com** — requires API key, captcha on free tier, 20 pastes/day limit, ads
- **ix.io** — offline ("taking a break")
- **hastebin.com** — redirects to Toptal, returns 403
- **rentry.co** — requires CSRF token dance (2 requests to create)
- **dpaste.com** — requires bearer token from registered account
- **paste.c-net.org** — viable runner-up (no auth, 180-day expiry refreshed on access, UUID URLs), but more complex API

## Endpoints

### Create a paste

```
POST https://paste.rs/
Content-Type: text/plain

<raw body content>
```

**Response**:
- `201 Created` — full upload succeeded. Body contains the paste URL (e.g., `https://paste.rs/AbCd`)
- `206 Partial` — content exceeded size limit, partially uploaded
- Other status codes indicate errors

### Retrieve a paste

```
GET https://paste.rs/<id>
```

Returns raw plain text of the paste.

Adding a file extension changes behavior:
- `GET https://paste.rs/<id>.md` — renders Markdown as HTML
- `GET https://paste.rs/<id>.rs` — syntax-highlighted HTML
- `GET https://paste.rs/<id>.json` — returned with `application/json` Content-Type
- Unknown extensions — returned as plain text

For Grimoire, always use the extensionless URL to get raw text for parsing.

### Delete a paste

```
DELETE https://paste.rs/<id>
```

Removes the paste.

### Web form

A browser-based form is available at `https://paste.rs/web` for manual use.

## Rate Limiting

The documentation states pasting is "heavily rate limited" but does not specify exact thresholds. For Grimoire this should be fine — users export/import addon lists infrequently.

## Undocumented Details

- **Max paste size**: Not documented, reported to work up to ~1 MB. Addon lists will be well under this.
- **Expiration**: Not documented. Pastes appear to persist indefinitely.
- **Authentication**: None. Pastes are unlisted — the URL is the only access control.

## Grimoire Integration Notes

### Export flow
1. Collect installed addon list (names, UIDs, versions)
2. Serialize to a simple text/JSON format
3. `POST https://paste.rs/` with the serialized body
4. Parse the returned URL from the 201 response body
5. Show URL to user (copyable) or generate a short share code from the paste ID

### Import flow
1. User pastes a paste.rs URL or share code
2. Extract paste ID from URL
3. `GET https://paste.rs/<id>` to fetch the addon list
4. Parse the response and present addons for installation
5. Use existing install/dependency resolution logic

### Rust implementation sketch (reqwest)

```rust
// Export
let body = serialize_addon_list(&addons);
let response = client.post("https://paste.rs/")
    .body(body)
    .send()
    .await?;

match response.status().as_u16() {
    201 => {
        let url = response.text().await?.trim().to_string();
        Ok(url)
    }
    206 => Err("Addon list too large for paste service".into()),
    status => Err(format!("Paste service error: HTTP {}", status).into()),
}

// Import
let response = client.get(format!("https://paste.rs/{}", paste_id))
    .send()
    .await?;
let addon_list = response.text().await?;
let addons = parse_addon_list(&addon_list)?;
```
