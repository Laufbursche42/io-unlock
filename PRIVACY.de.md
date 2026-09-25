# Datenschutzerklärung

Diese Webanwendung ist darauf gebaut, deine Daten auf deinem Gerät zu halten. Diese Erklärung sagt genau, was sie mit deinen Daten tut und was nicht.

## Kurz gefasst

Die Anwendung sammelt nichts. Es gibt keine Anmeldung, keine Statistik, keine Telemetrie, keine Verfolgung, keine Werbung, keine Cookies und keine Skripte von Dritten. Nichts geht an den Entwickler oder an ein Backend eines Herstellers.

## Welche Daten die Anwendung verarbeitet und wo sie bleiben

Alles Folgende bleibt auf deinem Gerät und wird nirgendwohin hochgeladen:

- Die rohen Bluetooth-Antworten, die der Scooter zurückschickt.
- Der localKey und der srand, die du eingibst, sowie der daraus abgeleitete Sitzungsschlüssel. Der localKey wird nur dann im Browser gespeichert, wenn dein Gerät das erlaubt, damit du ihn nicht jedes Mal neu eintippen musst. Er bleibt lokal und geht an keinen Server.
- Die Einstellungen, die du triffst (dpId, Werte, Modus-Stufen). Sie leben in der offenen Seite und optional im lokalen Speicher deines Browsers.
- Das Protokoll auf dem Bildschirm. Es lebt nur in der offenen Seite während deiner Sitzung, wird nicht hochgeladen. Beim Kopieren oder Speichern maskiert die Option Öffentliches Log (an per Voreinstellung) zuerst sensible Stellen und lange Hex-Ketten (localKey, Seriennummer, srand), damit ein geteiltes Log nichts verrät. Schalte sie nur zum lokalen Debuggen aus.

## Die einzige Netzverbindung

Die Anwendung baut in genau zwei Fällen eine Verbindung auf, in keinem anderen:

### 1. Laden der Seite

Wenn du die Seite öffnest oder neu lädst, holt dein Browser die statischen Dateien vom Anbieter, also `index.html`, `app.js`, `i18n.js`, `styles.css` und das Symbol. Das ist zum Beispiel GitHub Pages. Der Anbieter sieht dabei deine IP-Adresse und welche Datei du abgerufen hast. Das sind die üblichen Zugriffsprotokolle, die jede Website hat. Er sieht nie Daten des Scooters, keinen localKey und keine Kommandos.

### 2. Bluetooth LE zum Scooter

Eine lokale Funkverbindung zu deinem Scooter über Web Bluetooth. Das ist keine Internetverbindung. Die Kommandos und die Antworten laufen ausschließlich zwischen deinem Browser und dem Scooter.

## Sprachausgabe

Der Auto-Boost kann Ansagen sprechen. Das nutzt die Sprachausgabe deines Browsers beziehungsweise Betriebssystems. Je nach System kann diese Sprachausgabe lokal oder beim Systemanbieter erfolgen. Wenn du das nicht willst, stelle die Sprachansage in der Seite auf Aus.

## Kein Backend des Entwicklers oder des Herstellers

Nichts geht an den Entwickler oder an ein Backend eines Herstellers. Es gibt kein Konto und keinen Server dieses Projekts, der deine Daten annimmt. Zum Vergleich: die Original-App des IO HAWK meldet dich an und spricht mit der Tuya-Cloud. Diese Anwendung tut nichts davon.

## Kontakt

Bei Fragen zum Datenschutz wende dich an den Autor (Laufbursche) auf GitHub: https://github.com/Laufbursche42
