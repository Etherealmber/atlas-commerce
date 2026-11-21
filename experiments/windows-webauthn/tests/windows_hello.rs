//! Manual smoke test, never a login. Use a disposable test RP with a pre-existing
//! discoverable credential and a console window. No assertion is printed/saved.
#![cfg(windows)]
use std::ffi::c_void;
#[link(name = "kernel32")]
extern "system" { fn GetConsoleWindow() -> *mut c_void; }

#[test]
#[ignore = "manual only: requires real Windows, a test RP and a discoverable test credential"]
fn native_assertion_smoke() {
    let origin = std::env::var("ATLAS_LAB_ORIGIN").expect("test origin required");
    let rp = std::env::var("ATLAS_LAB_RP_ID").expect("test RP required");
    // A fixed fake challenge is acceptable ONLY for this local, non-networked
    // smoke test. A server protocol MUST use fresh CSPRNG challenges.
    let challenge = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    let hwnd = unsafe { GetConsoleWindow() };
    assert!(!hwnd.is_null(), "launch from a console with a window");
    let assertion = unsafe { atlas_windows_webauthn_lab::get_assertion(hwnd, &origin, &rp, challenge) }
        .unwrap_or_else(|_| panic!("native assertion failed or cancelled"));
    assert!(!assertion.credential_id.is_empty());
    assert!(assertion.authenticator_data.len() >= 37);
    assert!(!assertion.signature_der.is_empty());
    // Intentionally no print, network call, account login, or file output.
}
