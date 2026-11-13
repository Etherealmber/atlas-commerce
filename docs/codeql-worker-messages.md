# CodeQL review: Quagga worker messages

Alerts #47 and #48 identify `self.onmessage` in the vendored Quagga and Quagga2 unminified bundles. These handlers are inside `workerInterface`, serialized into a blob and instantiated as a **dedicated Worker** by the scanner. Its creator holds the Worker handle and sends the `init`, `process` and reader commands. This is not a `window.postMessage` listener open to arbitrary cross-origin windows; a different window cannot send to the dedicated worker without a transferred communication capability.

Worker message events do not provide a reliable web-origin authentication signal like cross-window `postMessage`. Adding an `event.origin` check here could reject legitimate messages and break barcode scanning, including the unminified fallback in `src/lib/barcodeScan.ts`. The minified bundles contain the same upstream worker protocol. Same-origin script compromise remains outside this boundary: code already executing in the page can access its own worker and camera privileges.

The review recommendation is to evaluate these two library alerts as potential false positives in GitHub Code Scanning, not to suppress them in source or pretend that a check was performed. Reassess if the vendored library changes to a shared/service worker or exposes worker ports to other contexts. No GitHub alert was dismissed by this change.
