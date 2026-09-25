# Privacy Policy

This web app is built to keep your data on your device. This policy states exactly what it does with your data and what it does not.

## In short

The app collects nothing. There is no sign-in, no analytics, no telemetry, no tracking, no ads, no cookies and no third-party scripts. Nothing goes to the developer or to any manufacturer backend.

## What the app processes and where it stays

All of the following stays on your device and is never uploaded:

- The raw Bluetooth replies the scooter sends back.
- The localKey and srand you enter, and the session key derived from them. The localKey is only stored in the browser if your device allows it, so you do not have to retype it. It stays local and goes to no server.
- The settings you make (dpId, values, mode levels). They live in the open page and optionally in your browser's local storage.
- The on-screen log. It lives only in the open page during your session and is not uploaded. When you copy or save it, the Public log option (on by default) masks sensitive spans and long hex runs (localKey, serial, srand) first, so a log you share leaks nothing. Turn it off only for local debugging.

## The only network connection

The app opens a connection in exactly two cases, no other:

### 1. Loading the page

When you open or reload the page, your browser fetches the static files from the provider: `index.html`, `app.js`, `i18n.js`, `styles.css` and the icon. That is for example GitHub Pages. The provider sees your IP address and which file you requested. Those are the usual access logs every website has. It never sees scooter data, no localKey and no commands.

### 2. Bluetooth LE to the scooter

A local radio link to your scooter over Web Bluetooth. This is not an internet connection. Commands and replies run only between your browser and the scooter.

## Voice output

The auto boost can speak prompts. This uses your browser's or operating system's speech synthesis. Depending on the system this may run locally or at the system vendor. If you do not want that, set the voice guidance in the page to off.

## No developer or manufacturer backend

Nothing goes to the developer or to any manufacturer backend. There is no account and no server of this project that receives your data. By comparison, the original IO HAWK app signs you in and talks to the Tuya cloud. This app does none of that.

## Contact

For privacy questions contact the author (Laufbursche) on GitHub: https://github.com/Laufbursche42
