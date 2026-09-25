# Guide

This page talks over Web Bluetooth to any IO HAWK e-scooter that runs on the Tuya app (`com.iohawk.smart`). It is a general tool: pick your model, then connect. It is a feasibility study and stays honest about what already works and what still needs the real device.

## What you need

- An IO HAWK that connects through the Tuya app. Legacy 1.0 has no Bluetooth and cannot connect; Legacy 2.0 has Bluetooth only on the BMS.
- A browser with Web Bluetooth: Chrome or Edge on Android or desktop, or the Bluefy app on iPhone.
- Your scooter's per-device localKey (from the Tuya cloud) and the numeric dpIds of the functions you want to use (from the cloud schema or a BLE capture). Both are explained below.

## The honest situation in one paragraph

The Bluetooth protocol is fully understood and implemented in this page. Every IO HAWK model that connects speaks the same generic Tuya `ddzxc` data-point (DP) protocol - the model selector only scopes which fields are shown and labeled, it never invents a number. Two things are not in the app package, differ per device and come from the Tuya cloud: the localKey and the numeric dpIds (which number stands for `speed_limit_e`, `mode`, `battery_percentage` and so on), plus each value's range and scaling. Until you supply both, the page shows the complete, model-scoped surface but every write and every telemetry scaling stays greyed out with a stated reason.

## Step 1: Pick your model

Use the Model dropdown at the top.

- **Auto / Generic IO HAWK (Tuya)** - the truth. Shows the complete proven DP set (all telemetry, all settings, all advanced), everything gated until confirmed.
- **IO HAWK Elite X 2.0** - the generic set plus the boost sequencer and the Elite X2 boost trick documented at the end of this guide.
- **IO HAWK Legacy 2.0 (BMS only)** - Bluetooth only on the BMS; only battery telemetry may appear, connect is disabled.
- **IO HAWK Legacy 1.0 (no Bluetooth)** - not connectable; the entry exists so it is clear why.

## Step 2: Connect

1. Turn the scooter on.
2. Tap Connect, pick your scooter from the list. The page filters on the Tuya service `0x1910` and the alternate SIG service `0xfd50` (the app uses one or the other per device).
3. After connecting, the raw notifications from the device appear in the log. They contain the `srand` (6 bytes) the page needs for the session key.

## Step 3: Enter the keys

1. Enter your scooter's localKey (16 chars or as hex).
2. Enter the `srand` you read from the device-info notification in the log.
3. The page then shows `secretKey5 = MD5(localKey concatenated with srand)`. This is the DP-channel key.

### Where the localKey comes from

The localKey is assigned at first pairing to your Tuya account and lives in the cloud. It never travels over Bluetooth, so you cannot read it from a BLE capture. Reading it from the app is not practical: the IO HAWK app forbids backup (allowBackup is off) and its data store is encrypted. Capturing the cloud traffic fails on certificate pinning.

The reliable route is the Tuya IoT platform, the same one the Home Assistant and localtuya community use:

1. Go to iot.tuya.com and create a free developer account.
2. Under Cloud create a project. Pick Central Europe as the data center if your account is in the EU.
3. In the project open the Devices tab, then Link Tuya App Account, then Add App Account. A QR code appears.
4. Scan the QR code with the app your scooter is paired in. In the app the scanner is usually under Profile or Me, top right the little scan icon.
5. After linking, the scooter shows up under Devices. Note its device id.
6. Go to Cloud, then API Explorer, then Device Control, then Query Device Details or Query Devices in Home. Fetch the device details by device id. The response contains the field local_key. That is your localKey.

If the IO HAWK account cannot be linked directly, try a second route: also pair the scooter in Tuya's generic Smart Life app and scan the QR in step 4 with Smart Life. Whether your model allows that is something only the test on the device shows.

The localKey is a secret of your device; do not share it. It stays the same as long as the pairing exists. If you delete the device from the account and pair again, it gets a new localKey.

## Step 4: Load the device schema (dpIds)

The numeric dpId of a function is not in the app and is hardcoded in no model - it lives in the Tuya cloud product schema. Enter what you know in the Device schema box as JSON, mapping code to dpId, for example:

```
{ "speed_limit_e": 104, "mode": 108, "battery_percentage": 106 }
```

The long form lets you also set the wire type and protocol version per entry:

```
{ "mode": { "dpId": 108, "type": "enum", "pv": 3 } }
```

Every row whose dpId you enter unlocks (once the keys are also in). Rows without a dpId stay greyed with a "schema needed" badge. You find dpIds either in the Tuya cloud product schema, or by changing the setting once in the original app and capturing the BLE traffic (turn on Diagnostics in the log to see every decoded DP entry with its dpId).

## Step 5: Telemetry, settings and advanced settings

- **Live values** are filled from the DP report once a matching dpId is in the schema. Values are shown raw with an "unconfirmed" badge, because the scaling and unit are cloud-side and not confirmed here.
- **Settings** and **Advanced settings** show one labeled row per DP. Each row is greyed until its dpId is in the schema and the session is ready (localKey + srand + connected). Risky writes (speed limit, locks, boost) ask for an extra confirmation.
- **Write raw DP** is the escape hatch: you supply the dpId yourself, so it works under the session gate alone. Set the mode to Preview to only compute and log the frame; Armed actually sends it.

Honest caveat: it is not yet confirmed on a device whether the DP channel accepts `secretKey5` alone or forces the native session-key path. A correctly built, armed frame may still be rejected by the device. That is not a bug in the tool.

## Step 6: Boost sequencer (Elite X 2.0 and generic)

The boost is a timing behaviour of the controller firmware, triggered by quickly switching the ride modes. On the control panel you do this with the +/- buttons. This page can take over the role of the buttons and switch the ride-mode DP over BLE. The rider still gives and holds the throttle, no software can do that.

How auto boost solves the two-hands problem:

1. Enter the mode dpId and the values for Mode 1, Mode 2 and Mode 3.
2. Get ready, keep voice guidance on.
3. Tap Auto boost with voice once. After that you do not touch the page again.
4. Just follow the voice: it tells you when to release and when to hold full throttle. The page does the mode changes itself, including the secure sequence.

Whether a mode change over BLE has the same effect in the controller as the physical button is not yet confirmed on the device. That is the one test that settles it.

### The Elite X 2.0 button trick (no app, no key)

For the boost alone you do not need the localKey or a dpId: the trick on the control panel works with buttons only.

Note on newer batches: on later produced 2.0 batches the trick no longer works. If it does not work for you, you most likely have a newer display fitted.

Part 1, set off the surge:

1. Cruise in mode 3 at full throttle, the regulated 22 km/h.
2. Let go of the throttle completely.
3. Tap minus twice, which drops the scooter into mode 1.
4. Immediately pull full throttle again and keep it held.
5. Tap plus twice to get back to mode 3.

The Elite X now pushes past the 22 km/h mark for a moment, around ten seconds at most. Repeat and the speed keeps climbing in dual mode.

Part 2, lock the state in:

1. Let the surge keep running and hold the throttle.
2. Tap minus once and plus once. This makes the controller drop its internal ten second counter. From then on you set the pace directly with the throttle.

Behaviour: the moment you fully release the throttle once or brake, the controller falls back to the approved values. Nothing stays stored permanently. While holding the state the speed can stick at a fixed cap, for instance around 30 km/h; the exact timing of the +/- inputs probably decides which step you lock into.

## Diagnostics and self-test

- Public log (on by default) masks sensitive spans and long hex runs (localKey, serial, srand) before you copy or save, so a shared log leaks nothing.
- Diagnostics shows every decoded frame (reassembled, control byte, seq/cmd/flag, per-DP dpId/type/value) and taps extra notify channels. This is exactly the capture you need to learn the per-model dpIds.
- Diagnostics: all devices lists the GATT services of any picked device, for devices that otherwise do not show up.
- Self-test checks the crypto building blocks against known test vectors. It must be green.
- Copy log / Save log give you the whole capture to keep or send.

## Legal and safety

Only on your own vehicle on private ground. Raising the speed removes the throttle limit, the road approval (ABE) lapses and riding on public roads is then not allowed. Riding a modified scooter in public traffic very likely constitutes criminal offences (driving without the required licence and a breach of the compulsory insurance act). The boost is a live action while riding with a high risk of falling. Everything at your own risk.
