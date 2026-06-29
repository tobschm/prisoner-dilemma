# Gefangenen-Dilemma 🔒

Eine Echtzeit-Multiplayer-Website zum Durchspielen und Erlernen des Gefangenen-Dilemmas.

Alle, die den Link öffnen, treten einer gemeinsamen Session bei und warten in einer **Lobby**.
Der **Host** (der erste Spieler) startet das Spiel. Danach werden automatisch **zufällige Paare**
gebildet, die das Dilemma synchron durchspielen. Nach jeder Runde wird neu gepaart — insgesamt
**3 Runden**. Am Ende gibt es eine **Gesamt-Rangliste** nach Haftjahren (wenigste = beste Platzierung).

## Spielregeln (Haftjahre)

| | Komplize schweigt | Komplize verrät |
|---|---|---|
| **Du schweigst** | beide 2 Jahre | du 10, er 0 |
| **Du verrätst** | du 0, er 10 | beide 5 Jahre |

Bei ungerader Spielerzahl bekommt ein zufälliger Spieler ein **Freilos** (0 Jahre) und ist in der
nächsten Runde wieder dabei.

## Installation & Start

```bash
npm install
npm start
```

Dann im Browser öffnen: <http://localhost:3000>

Zum Testen mit mehreren Spielern einfach mehrere Tabs/Fenster (oder Geräte im selben Netzwerk)
öffnen. Über `PORT` lässt sich der Port anpassen, z. B. `PORT=8080 npm start`.

## Technik

- **Backend:** Node.js, Express, Socket.IO (`server.js`) — gesamter Spielzustand im Arbeitsspeicher.
- **Frontend:** Vanilla HTML/CSS/JS (`public/`), keine Frameworks.
