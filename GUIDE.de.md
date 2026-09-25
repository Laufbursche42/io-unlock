# Anleitung

Diese Seite redet per Web Bluetooth mit jedem IO-HAWK-E-Scooter der über die Tuya-App (com.iohawk.smart) läuft. Sie ist ein allgemeines Werkzeug: wähle dein Modell dann verbinde. Sie ist eine Machbarkeitsstudie und bleibt ehrlich dabei was heute schon geht und was noch das reale Gerät braucht.

## Was du brauchst

- Einen IO HAWK der sich über die Tuya-App verbindet. Legacy 1.0 hat kein Bluetooth und ist nicht verbindbar; Legacy 2.0 hat Bluetooth nur am BMS.
- Einen Browser mit Web Bluetooth: Chrome oder Edge auf Android oder Desktop, auf dem iPhone die App Bluefy.
- Den geräteindividuellen localKey deines Scooters (aus der Tuya-Cloud) und die numerischen dpIds der Funktionen die du nutzen willst (aus dem Cloud-Schema oder einem BLE-Mitschnitt). Beides steht unten.

## Die ehrliche Lage in einem Absatz

Das Bluetooth-Protokoll ist vollständig verstanden und in dieser Seite umgesetzt. Jedes IO-HAWK-Modell das sich verbindet spricht dasselbe generische Tuya-ddzxc-Datenpunkt-Protokoll (DP) - der Modell-Auswähler legt nur fest welche Felder gezeigt und beschriftet werden, er erfindet nie eine Zahl. Zwei Dinge stehen nicht im App-Paket sind pro Gerät verschieden und kommen aus der Tuya-Cloud: der localKey und die numerischen dpIds (welche Zahl für speed_limit_e, mode, battery_percentage und so weiter steht) samt Wertebereich und Skalierung. Solange du beides nicht lieferst zeigt die Seite die vollständige modellbezogene Oberfläche - aber jeder Schreibvorgang und jede Telemetrie-Skalierung bleibt mit genanntem Grund ausgegraut.

## Schritt 1: Modell wählen

Nutze das Modell-Dropdown oben.

- **Auto / Generischer IO HAWK (Tuya)** - die Wahrheit. Zeigt die vollständige belegte DP-Menge (alle Telemetrie, alle Einstellungen, alle erweiterten), alles gesperrt bis bestätigt.
- **IO HAWK Elite X 2.0** - die generische Menge plus Boost-Sequenzer und der Elite-X2-Boost-Trick am Ende dieser Anleitung.
- **IO HAWK Legacy 2.0 (nur BMS)** - Bluetooth nur am BMS; nur Akku-Telemetrie kann erscheinen, Verbinden ist deaktiviert.
- **IO HAWK Legacy 1.0 (kein Bluetooth)** - nicht verbindbar; der Eintrag ist da damit klar ist warum.

## Schritt 2: Verbinden

1. Scooter einschalten.
2. Auf Verbinden tippen deinen Scooter aus der Liste wählen. Die Seite filtert auf den Tuya-Dienst 0x1910 und den alternativen SIG-Dienst 0xfd50 (die App nutzt je Gerät den einen oder den anderen).
3. Nach dem Verbinden erscheinen im Log die rohen Notifications vom Gerät. Darin steckt der srand (6 Byte) den die Seite für den Sitzungsschlüssel braucht.

## Schritt 3: Schlüssel eintragen

1. Trage den localKey deines Scooters ein (16 Zeichen oder als Hex).
2. Trage den srand ein den du aus der Device-Info-Notification im Log abliest.
3. Die Seite zeigt daraufhin secretKey5 = MD5(localKey verkettet mit srand). Das ist der DP-Kanal-Schlüssel.

### Woher kommt der localKey

Der localKey wird beim Erst-Pairing an dein Tuya-Konto vergeben und liegt in der Cloud. Er reist nie über Bluetooth, deshalb kann man ihn nicht aus einem BLE-Mitschnitt lesen. Ein Auslesen aus der App scheidet praktisch aus: die IO-HAWK-App verbietet das Backup (allowBackup ist aus) und ihr Datenbestand ist verschlüsselt. Ein Mitschnitt des Cloud-Verkehrs scheitert am Zertifikats-Pinning.

Der verlässliche Weg ist die Tuya-IoT-Plattform genau wie es die Home-Assistant- beziehungsweise localtuya-Szene macht:

1. Gehe auf iot.tuya.com und lege ein kostenloses Entwicklerkonto an.
2. Erstelle unter Cloud ein Projekt. Als Data Center Central Europe wählen wenn dein Konto in der EU liegt.
3. Öffne im Projekt den Reiter Devices, dann Link Tuya App Account, dann Add App Account. Es erscheint ein QR-Code.
4. Scanne den QR-Code mit der App in der dein Scooter gekoppelt ist. In der App findest du den Scanner meist unter Profil beziehungsweise Ich, oben rechts das kleine Scan-Symbol.
5. Nach dem Verknüpfen taucht der Scooter unter Devices auf. Notiere seine Device-ID.
6. Gehe zu Cloud, dann API Explorer, dann Device Control, dann Query Device Details beziehungsweise Query Devices in Home. Rufe die Device-Details mit der Device-ID ab. In der Antwort steht das Feld local_key. Das ist dein localKey.

Wenn sich das IO-HAWK-Konto nicht direkt verknüpfen lässt gibt es einen zweiten Anlauf: den Scooter zusätzlich in der generischen App Smart Life von Tuya koppeln und dann in Schritt 4 den QR-Code mit Smart Life scannen. Ob dein Modell das mitmacht zeigt der Versuch am Gerät.

Der localKey ist ein Geheimnis deines Geräts, gib ihn nicht weiter. Er bleibt gleich solange die Kopplung besteht. Löschst du das Gerät aus dem Konto und koppelst neu bekommt es einen neuen localKey.

## Schritt 4: Geräteschema laden (dpIds)

Die numerische dpId einer Funktion steht nicht in der App und ist in keinem Modell fest verdrahtet - sie liegt im Tuya-Cloud-Produktschema. Trage im Feld Geräteschema als JSON ein was du kennst, code auf dpId, zum Beispiel:

```
{ "speed_limit_e": 104, "mode": 108, "battery_percentage": 106 }
```

Mit der langen Form kannst du je Eintrag auch den Wire-Typ und die Protokollversion setzen:

```
{ "mode": { "dpId": 108, "type": "enum", "pv": 3 } }
```

Jede Zeile deren dpId du einträgst schaltet frei (sobald auch die Schlüssel drin sind). Zeilen ohne dpId bleiben ausgegraut mit dem Abzeichen "Schema nötig". Die dpIds findest du entweder im Tuya-Cloud-Produktschema oder indem du die Einstellung einmal in der originalen App änderst und den BLE-Verkehr mitschneidest (schalte im Log die Diagnose an dann siehst du jeden decodierten DP-Eintrag mit seiner dpId).

## Schritt 5: Telemetrie, Einstellungen und erweiterte Einstellungen

- **Live-Werte** werden aus dem DP-Bericht gefüllt sobald eine passende dpId im Schema steht. Werte erscheinen roh mit dem Abzeichen "unbestätigt" weil Skalierung und Einheit cloud-seitig und hier nicht bestätigt sind.
- **Einstellungen** und **Erweiterte Einstellungen** zeigen je DP eine beschriftete Zeile. Jede Zeile ist ausgegraut bis ihre dpId im Schema steht und die Sitzung bereit ist (localKey plus srand plus verbunden). Riskante Schreibvorgänge (Tempolimit, Schlösser, Boost) fragen zusätzlich nach.
- **Roh-DP schreiben** ist die Notluke: du lieferst die dpId selbst, deshalb geht sie schon unter dem Sitzungs-Gate allein. Stelle den Modus auf Vorschau um den Frame nur zu rechnen und zu loggen; Scharf sendet ihn wirklich.

Ehrlicher Vorbehalt: es ist am Gerät noch nicht bestätigt ob der DP-Kanal secretKey5 allein akzeptiert oder den nativen Sitzungsschlüssel-Weg erzwingt. Ein korrekt gebauter scharfer Frame kann vom Gerät trotzdem abgelehnt werden. Das ist kein Fehler des Werkzeugs.

## Schritt 6: Boost-Sequenzer (Elite X 2.0 und generisch)

Der Boost ist ein Timing-Verhalten der Controller-Firmware das über schnelles Umschalten der Fahrmodi ausgelöst wird. Am Bedienteil macht man das mit den +/- Tasten. Diese Seite kann die Rolle der Tasten übernehmen und den Fahrmodus-DP per BLE schalten. Das Gas gibt und hält weiter der Fahrer, das kann keine Software.

So löst der Auto-Boost das Zwei-Hände-Problem:

1. Trage die Modus-dpId und die Werte für Mode 1, Mode 2 und Mode 3 ein.
2. Stell dich bereit und lass die Sprachansage an.
3. Tippe einmal auf Auto-Boost mit Ansage. Danach fasst du die Seite nicht mehr an.
4. Folge nur der Stimme: sie sagt wann du das Gas loslassen und wann du Vollgas halten sollst. Die Modus-Wechsel macht die Seite selbst, auch die Sichern-Sequenz.

Ob ein Modus-Wechsel per BLE im Controller denselben Effekt hat wie die physische Taste ist noch nicht am Gerät bestätigt. Das ist der eine Test der die Sache endgültig klärt.

### Der Elite-X-2.0-Tastentrick (ohne App, ohne Schlüssel)

Für den reinen Boost brauchst du weder den localKey noch eine dpId: der Trick am Bedienteil läuft nur mit den Tasten.

Hinweis zu neueren Batches: bei später produzierten 2.0-Chargen greift der Trick nicht mehr. Klappt er bei dir nicht hast du mit hoher Wahrscheinlichkeit ein neueres Display verbaut.

Teil 1, Schub auslösen:

1. Im Modus 3 mit Vollgas rollen, also die geregelten 22 km/h.
2. Den Gasgriff komplett loslassen.
3. Zwei Mal Minus tippen, dadurch wechselt der Scooter in Modus 1.
4. Sofort wieder voll aufziehen und das Gas gedrückt halten.
5. Zwei Mal Plus tippen um zurück in Modus 3 zu gelangen.

Jetzt schiebt der Elite X kurz über die 22-km/h-Marke, höchstens rund zehn Sekunden. Wiederholt man die Abfolge klettert die Geschwindigkeit im Dualmodus weiter.

Teil 2, Zustand festhalten:

1. Den Schub weiterlaufen lassen und das Gas dabei halten.
2. Einmal Minus und einmal Plus tippen. Dadurch verwirft der Controller seinen internen Zehn-Sekunden-Zähler. Von da an bestimmst du das Tempo direkt über den Gasgriff.

Verhalten: sobald du den Gasgriff einmal ganz loslässt oder bremst fällt der Controller auf die zugelassenen Werte zurück. Es bleibt nichts dauerhaft gespeichert. Beim Festhalten kann die Geschwindigkeit an einer festen Obergrenze hängen bleiben zum Beispiel bei etwa 30 km/h; vermutlich entscheidet der genaue Zeitpunkt der +/- Eingaben in welche Stufe man einrastet.

## Diagnose und Selbsttest

- Öffentliches Log (an per Voreinstellung) maskiert sensible Stellen und lange Hex-Ketten (localKey, Seriennummer, srand) vor dem Kopieren oder Speichern, damit ein geteiltes Log nichts verrät.
- Diagnose zeigt jeden decodierten Frame (zusammengesetzt, Kontrollbyte, seq/cmd/flag, je DP dpId/Typ/Wert) und zapft zusätzliche Notify-Kanäle an. Genau dieser Mitschnitt ist es den du brauchst um die modell-spezifischen dpIds zu lernen.
- Diagnose: alle Geräte listet die GATT-Dienste eines beliebig gewählten Geräts, für Geräte die sonst nicht auftauchen.
- Selbsttest prüft die Krypto-Bausteine gegen bekannte Testvektoren. Muss grün sein.
- Log kopieren beziehungsweise Log speichern gibt dir den ganzen Mitschnitt zum Behalten oder Schicken.

## Recht und Sicherheit

Nur am eigenen Fahrzeug auf privatem Gelände. Das Anheben der Geschwindigkeit hebt die Drossel auf, die ABE erlischt und der Betrieb auf öffentlichen Wegen ist dann nicht erlaubt. Wer ein verändertes Fahrzeug im öffentlichen Verkehr fährt begeht mit hoher Wahrscheinlichkeit Straftaten (Fahren ohne die nötige Fahrerlaubnis sowie einen Verstoß gegen das Pflichtversicherungsgesetz). Der Boost ist eine Live-Aktion während der Fahrt mit hohem Sturzrisiko. Alles auf eigenes Risiko.
