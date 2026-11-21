# Mobile web browser compatibility

The mobile web shell is a browser application, not the Android app. Its role
authorization must be enforced server-side; UI visibility is not authorization.
Known server authorization findings remain unresolved. Android-specific features and exact screen parity are not
implied by matching navigation or colors.

## Theme and layout

The saved light/dark/system preference controls the page, browser controls and
browser theme color. System mode follows `prefers-color-scheme` changes; legacy
`MediaQueryList.addListener` is supported where the newer event API is absent.
The dock and scanner sheet account for safe-area insets; the agent composer
stays above the dock. The mobile shell uses explicit state rather than `:has()`
for its scanner dialog and agent layout, and has a `100vh` fallback where
`100dvh` is unsupported. Reduced-motion preferences are respected.

The scanner uses bundled same-origin decoders and manual/image fallback. The
server CSP permits `wasm-unsafe-eval` for the WebAssembly barcode decoder but
**does not** enable JavaScript `unsafe-eval`. Some older browsers may not
recognize that CSP token or support the camera/WASM APIs; camera use also
requires HTTPS (or localhost), permission, and a suitable device. Test both
camera and fallback methods on each actual device before relying on them.

## Verification and remaining work

Local automated checks cover theme synchronization, legacy media listeners,
dialog keyboard handling, CSS parsing, and CSP. Chromium was checked with
mocked API data at 320px and 390px, in light and dark modes. These checks are
not a substitute for real iOS Safari/WebKit, Firefox, camera hardware, keyboard
and safe-area testing. Those engines/devices were not available in the local
sandbox; cross-browser compatibility and Android feature parity are therefore
not yet fully verified. Existing server authorization findings remain separate
from these UI changes.

Suggested device checks: switch all three themes and change the OS theme; rotate
the device; test focus and the virtual keyboard, safe-area insets, scrolling,
menus and dialogs; test a real barcode via camera, image and manual entry;
verify behavior offline, after refresh and after returning from background.

The owner/admin mobile balance uses the same monthly finance, period breakdown
and statement endpoints as Android. It presents movements, accounts and
reports in a compact layout; the complete existing web balance remains
available from the Reports tab. Secretary access remains on the existing web
balance because the Android-style finance endpoints are owner/admin only.
The quick menu links to the other existing mobile tools and to the PC shell;
this does not grant any additional server-side permissions or mean that every
PC feature has a dedicated mobile screen.

The mobile sign-in shell is visually inspired by Android but uses the web
password, OTP, passkey and anti-abuse flow unchanged. Android-only saved-account
and device-unlock behavior is not claimed by the browser. The inventory scanner
keeps the camera off until started, provides image and manual alternatives, and
does not send apparent authentication URLs to the product lookup. Its web
stock-change workflow still follows the existing approval rules, not Android's
native behavior.

Phone theme changes use standard CSS color transitions rather than relying on
the View Transitions API. Transitions are enabled only under
`prefers-reduced-motion: no-preference`; see
https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion.
Real-device Safari, Firefox and camera testing is still required.
