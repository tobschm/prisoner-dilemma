# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Was das ist

Echtzeit-Multiplayer-Website zum Durchspielen des Gefangenen-Dilemmas: gemeinsame Lobby, Host startet, automatische zufällige Paarbildung, 3 Runden, Gesamt-Rangliste.

## Stack & Architektur

- **Backend:** Node.js + Express + Socket.IO in `server.js` — enthält die *gesamte* Spiellogik und den State.
- **Frontend:** Vanilla HTML/CSS/JS in `public/` (`index.html`, `app.js`, `style.css`). Kein Framework, **kein Build-Schritt** — Dateien direkt bearbeiten, Server neu starten.

## Start

- `npm start` (= `node server.js`). Port über `PORT`-Env, Standard 3000.
- Zum Testen mehrere Browser-Tabs auf `http://localhost:3000` öffnen (jeder Tab = ein Spieler).

## Gotchas

- **Event-Vertrag synchron halten:** Die Kommunikation läuft über Socket.IO-Events. Wird ein Event (Name oder Payload) geändert, *immer* beide Seiten anpassen — `server.js` (`io`/`socket.emit` und `socket.on`) und `public/app.js` (`socket.on`/`socket.emit`).
- **In-Memory-Single-Session:** Der gesamte Spielzustand (`players`, `phase`, `currentRound`, `pairs`, `stats`) ist ein Singleton in `server.js`. Es gibt nur *eine* globale Session und *keine* Datenbank — ein Server-Neustart löscht alles.
