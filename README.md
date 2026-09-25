# Laufbursche IO HAWK Tool (io-unlock)

A single-page Web Bluetooth tool for any IO HAWK e-scooter that runs on the Tuya app (`com.iohawk.smart`). Pick your model, connect, and see the model's telemetry, settings and advanced settings. It speaks the Tuya BLE secure protocol and runs entirely in your browser. Nothing is sent to any server.

This is a feasibility study, not a finished product. It is honest about what already works from static analysis and what still needs a real device or the Tuya cloud to finish. Every IO HAWK model that connects uses the same generic Tuya `ddzxc` data-point protocol; the model selector only scopes which fields are shown and labeled - it never invents a dpId, range or scaling.

## What it does

- Model selector: Auto / Generic IO HAWK, Elite X 2.0, Legacy 2.0 (BMS only), Legacy 1.0 (no Bluetooth). Each profile decides which telemetry/settings/advanced fields are shown and whether connect is offered.
- Connect to the Tuya BLE service `0x1910` (write `0x2b11`, notify `0x2b10`) or the alternate SIG profile `0xfd50`, and decode notifications: reassemble packets, verify CRC, and (with the session key) parse DP report entries.
- Derive the DP session key `secretKey5 = MD5(localKey || srand)` from the per-device localKey and the srand the device sends.
- Per-model telemetry tiles, settings rows and advanced settings rows, built from the proven Tuya `ddzxc` DP code set. Values and writes stay greyed with a stated reason until you supply the per-device dpId (device schema) and the session keys.
- Device schema box: paste `{ "code": dpId }` (or the long form with type/pv) to unlock the matching rows. Nothing is hardcoded per model.
- Write raw DP escape hatch (you supply the dpId), boost sequencer for Elite X 2.0 and generic, and a self-test of the crypto building blocks (MD5, AES-128, CRC16-MODBUS, varint, DP encoder).
- Full lb-tool-web-style protocol log: public-log anonymizer (on by default), diagnostics raw-frame decode, copy/clear/save.

## What it cannot do without the device or cloud

The static analysis proves the protocol, but these facts are cloud-provisioned or device-only and are gated, never invented:

1. The per-device **localKey** (Tuya cloud, first pairing).
2. The numeric **dpId**, enum **range** and **scaling** of every DP (Tuya cloud product schema).
3. Whether the DP channel accepts `secretKey5` alone or forces the native session-key path (device-only).
4. Whether a mode change over BLE triggers the same controller boost as the physical +/- buttons (device-only).

## Run it

Web Bluetooth needs a secure context (localhost or https); `file://` will not work.

```
cd io-unlock
py -3 -m http.server 8000
```

Then open `http://localhost:8000` in Chrome or Edge (desktop or Android). On iPhone use the Bluefy app.

## Files

- `index.html`, `app.js`, `i18n.js`, `styles.css` - the app (self-contained, strict CSP, no third-party code).
- `GUIDE.*.md`, `LICENSE*.md`, `PRIVACY*.md`, `TRADEMARKS*.md` - documentation.
- `scripts/` - `security-scan.py` (XSS/secret/structure scan) and `check-i18n.js` (de/en key parity).
- `.githooks/`, `.github/workflows/` - pre-commit/pre-push gates and CI (security scan + CodeQL).

## License

PolyForm Noncommercial 1.0.0 plus additional terms. See [LICENSE.md](LICENSE.md). Free for private research and tinkering, not for commercial use.

## Legal

Only on your own vehicle on private ground. Raising the top speed removes the throttle limit, the road approval (ABE) lapses and riding on public roads is then not allowed. Everything at your own risk.
