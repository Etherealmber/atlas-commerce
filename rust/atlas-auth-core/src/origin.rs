use crate::error::{AuthCoreError, Result};
use serde::{Deserialize, Serialize};
use url::Url;

/// Strict bare HTTPS server origin (e.g. `https://stock.afmarbre.com` or
/// `https://staging.example:8443`).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ServerOrigin(String);

impl ServerOrigin {
    pub fn parse(raw: &str) -> Result<Self> {
        let trimmed = raw.trim();
        let parsed = Url::parse(trimmed).map_err(|_| AuthCoreError::InvalidOrigin)?;
        if parsed.scheme() != "https" {
            return Err(AuthCoreError::InvalidOrigin);
        }
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(AuthCoreError::InvalidOrigin);
        }
        if parsed.query().is_some() || parsed.fragment().is_some() {
            return Err(AuthCoreError::InvalidOrigin);
        }
        if parsed.path() != "/" && !parsed.path().is_empty() {
            return Err(AuthCoreError::InvalidOrigin);
        }
        let host = parsed.host_str().ok_or(AuthCoreError::InvalidOrigin)?;
        if host.is_empty() {
            return Err(AuthCoreError::InvalidOrigin);
        }
        let origin = parsed.origin().ascii_serialization();
        if origin == "null" || origin.is_empty() {
            return Err(AuthCoreError::InvalidOrigin);
        }
        Ok(Self(origin))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn endpoint_url(&self, path: &str) -> Result<String> {
        if !path.starts_with('/') || path.contains('?') || path.contains('#') {
            return Err(AuthCoreError::InvalidTargetUrl);
        }
        Ok(format!("{}{}", self.0, path))
    }

    pub fn validate_challenge_url(&self, candidate: &str, expected_path: &str, expected_req_id: &str) -> Result<()> {
        let parsed = Url::parse(candidate).map_err(|_| AuthCoreError::ResponseMismatch)?;
        if parsed.scheme() != "https"
            || parsed.origin().ascii_serialization() != self.0
            || parsed.path() != expected_path
            || parsed.query().is_some()
        {
            return Err(AuthCoreError::ResponseMismatch);
        }
        let expected_frag = format!("request_id={}", expected_req_id);
        if parsed.fragment() != Some(expected_frag.as_str()) {
            return Err(AuthCoreError::ResponseMismatch);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_bare_https_and_custom_port() {
        assert_eq!(
            ServerOrigin::parse("https://stock.afmarbre.com").unwrap().as_str(),
            "https://stock.afmarbre.com"
        );
        assert_eq!(
            ServerOrigin::parse("https://stock.afmarbre.com:8443/").unwrap().as_str(),
            "https://stock.afmarbre.com:8443"
        );
    }

    #[test]
    fn rejects_non_https_paths_queries_and_userinfo() {
        assert!(ServerOrigin::parse("http://stock.afmarbre.com").is_err());
        assert!(ServerOrigin::parse("https://user@stock.afmarbre.com").is_err());
        assert!(ServerOrigin::parse("https://stock.afmarbre.com/login").is_err());
        assert!(ServerOrigin::parse("https://stock.afmarbre.com/?a=1").is_err());
        assert!(ServerOrigin::parse("https://stock.afmarbre.com/#frag").is_err());
    }
}
