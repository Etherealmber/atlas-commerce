//! Offline Windows WebAuthn assertion laboratory, NOT an authentication client.
//! No HTTP, no session issuance, no logging and no fallback. API/ABI and real
//! authenticators MUST be validated on Windows before integrating this module.

/// Windows supplies the signature in WebAuthn ES256 DER form. The binary fields
/// are kept in memory; an integrating transport would base64url-encode them.
pub struct LabAssertion {
    pub client_data_json: Vec<u8>,
    pub authenticator_data: Vec<u8>,
    pub signature_der: Vec<u8>,
    pub credential_id: Vec<u8>,
    pub user_handle: Vec<u8>,
}

/// Only an administrator-configured, previously trusted origin/RP tuple can
/// be passed here. This narrow lab supports RP equal to the origin hostname,
/// not parent-domain RP IDs. It does not prove native application association.
pub fn client_data(origin: &str, rp_id: &str, challenge: &str) -> Result<Vec<u8>, &'static str> {
    if challenge.len() != 43 || !challenge.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') {
        return Err("invalid challenge");
    }
    let authority = origin.strip_prefix("https://").ok_or("invalid origin")?;
    if rp_id.is_empty() || rp_id.len() > 253 || !rp_id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'.' || c == b'-') {
        return Err("invalid rp");
    }
    let (host, port) = match authority.split_once(':') {
        Some((host, port)) => (host, Some(port)), None => (authority, None),
    };
    if host != rp_id || host.starts_with('.') || host.ends_with('.') || host.contains("..") {
        return Err("origin and rp mismatch");
    }
    if let Some(port) = port {
        let n: u16 = port.parse().map_err(|_| "invalid port")?;
        if n == 0 || n == 443 || n.to_string() != port { return Err("invalid port"); }
    }
    // The character checks above make JSON quoting unambiguous.
    Ok(format!("{{\"type\":\"webauthn.get\",\"challenge\":\"{}\",\"origin\":\"{}\",\"crossOrigin\":false}}", challenge, origin).into_bytes())
}

#[cfg(windows)]
mod native {
    use super::{client_data, LabAssertion};
    use std::{ffi::c_void, ptr, slice};

    // Stable version-1 prefixes from Microsoft webauthn.h. Never interpret
    // newer-version suffixes. These definitions have NOT been ABI-tested here.
    #[repr(C)] struct ClientData { version: u32, len: u32, json: *const u8, algorithm: *const u16 }
    #[repr(C)] struct Credential { version: u32, len: u32, id: *const u8, kind: *const u16 }
    #[repr(C)] struct Credentials { count: u32, entries: *const Credential }
    #[repr(C)] struct Extensions { count: u32, entries: *const c_void }
    #[repr(C)] struct OptionsV1 { version: u32, timeout_ms: u32, credentials: Credentials, extensions: Extensions, attachment: u32, user_verification: u32, flags: u32 }
    #[repr(C)] struct AssertionV1 { version: u32, auth_len: u32, auth: *const u8, sig_len: u32, sig: *const u8, credential: Credential, user_len: u32, user: *const u8 }
    #[link(name = "webauthn")]
    extern "system" {
        fn WebAuthNAuthenticatorGetAssertion(hwnd: *mut c_void, rp: *const u16, data: *const ClientData, options: *const OptionsV1, result: *mut *mut AssertionV1) -> i32;
        fn WebAuthNFreeAssertion(value: *mut AssertionV1);
    }
    struct Owned(*mut AssertionV1);
    impl Drop for Owned { fn drop(&mut self) { unsafe { WebAuthNFreeAssertion(self.0) } } }
    unsafe fn copy(p: *const u8, len: u32, required: bool) -> Result<Vec<u8>, &'static str> {
        if len == 0 { return if required { Err("invalid native response") } else { Ok(Vec::new()) }; }
        if p.is_null() || len > 65536 { return Err("invalid native response"); }
        Ok(slice::from_raw_parts(p, len as usize).to_vec())
    }

    /// Caller must provide a valid Windows HWND owned by this process, and a
    /// server-authenticated policy tuple/challenge. Blocking OS UI; no logging.
    /// Passing null or an invalid HWND is unsupported.
    pub unsafe fn get_assertion(hwnd: *mut c_void, origin: &str, rp_id: &str, challenge: &str) -> Result<LabAssertion, &'static str> {
        if hwnd.is_null() { return Err("invalid window"); }
        let json = client_data(origin, rp_id, challenge)?;
        let rp: Vec<u16> = rp_id.encode_utf16().chain(Some(0)).collect();
        let alg: Vec<u16> = "SHA-256".encode_utf16().chain(Some(0)).collect();
        let data = ClientData { version: 1, len: json.len() as u32, json: json.as_ptr(), algorithm: alg.as_ptr() };
        // Discoverable credentials, any attachment (Hello or FIDO2); UV required.
        let options = OptionsV1 { version: 1, timeout_ms: 60_000, credentials: Credentials { count: 0, entries: ptr::null() }, extensions: Extensions { count: 0, entries: ptr::null() }, attachment: 0, user_verification: 1, flags: 0 };
        let mut result = ptr::null_mut();
        let hr = WebAuthNAuthenticatorGetAssertion(hwnd, rp.as_ptr(), &data, &options, &mut result);
        if hr < 0 || result.is_null() { if !result.is_null() { WebAuthNFreeAssertion(result); } return Err("assertion unavailable or cancelled"); }
        let owned = Owned(result);
        let value = &*owned.0;
        if value.version < 1 || value.credential.version != 1 { return Err("invalid native response"); }
        Ok(LabAssertion { client_data_json: json, authenticator_data: copy(value.auth, value.auth_len, true)?, signature_der: copy(value.sig, value.sig_len, true)?, credential_id: copy(value.credential.id, value.credential.len, true)?, user_handle: copy(value.user, value.user_len, false)? })
    }
}
#[cfg(windows)] pub use native::get_assertion;

#[cfg(test)]
mod tests {
    use super::client_data;
    #[test] fn exact_https_origin_and_rp() {
        let c = "A".repeat(43);
        assert!(client_data("https://example.test:8443", "example.test", &c).is_ok());
        for o in ["http://example.test", "https://evil.test", "https://example.test/path", "https://example.test:443", "https://example.test:8443?x=y"] {
            assert!(client_data(o, "example.test", &c).is_err());
        }
        assert!(client_data("https://example.test", "example.test", "short").is_err());
    }
}
