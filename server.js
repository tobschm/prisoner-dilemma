// Gefangenen-Dilemma — Echtzeit-Multiplayer-Server
// Express liefert die statischen Dateien aus, Socket.IO übernimmt die Echtzeit-Synchronisation.
// Der gesamte Spielzustand liegt im Arbeitsspeicher (eine einzige globale Session).

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Spielzustand (Singleton, In-Memory)
// ---------------------------------------------------------------------------

const TOTAL_ROUNDS = 3;
const NEXT_ROUND_SECONDS = 5; // Countdown auf dem Ergebnis-Screen bis zur nächsten Runde

const players = new Map(); // socketId -> { id, name, isHost, totalYears, connected }
let phase = 'lobby';       // 'lobby' | 'playing' | 'result' | 'finished'
let currentRound = 0;      // 1..TOTAL_ROUNDS
let pairs = [];            // { a, b, choiceA, choiceB, bye, done }  (bye: b === null)
let advanceTimer = null;   // setTimeout-Handle für den Auto-Advance

// Kumulative Entscheidungs-Statistik über alle Paar-Runden des aktuellen Spiels.
let stats = { bb: 0, ss: 0, mixed: 0 }; // beide verraten / beide schweigen / gemischt

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function connectedPlayers() {
  return [...players.values()].filter((p) => p.connected);
}

function lobbyPlayerList() {
  return connectedPlayers().map((p) => ({ name: p.name, isHost: p.isHost }));
}

// Fisher-Yates-Shuffle (in-place auf einer Kopie)
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function currentHost() {
  return [...players.values()].find((p) => p.connected && p.isHost) || null;
}

// Stellt sicher, dass genau ein verbundener Spieler Host ist.
function ensureHost() {
  const connected = connectedPlayers();
  if (connected.length === 0) return;
  if (!connected.some((p) => p.isHost)) {
    connected[0].isHost = true;
  }
}

function broadcastLobby() {
  for (const p of players.values()) {
    if (!p.connected) continue;
    io.to(p.id).emit('lobbyUpdate', {
      players: lobbyPlayerList(),
      youAreHost: p.isHost,
      phase,
    });
  }
}

// Haftjahre gemäß Payoff-Matrix. choice ∈ {'silent', 'betray'}
// Rückgabe aus Sicht des ersten Arguments (eigene Jahre).
function yearsFor(myChoice, partnerChoice) {
  if (myChoice === 'silent' && partnerChoice === 'silent') return 2;
  if (myChoice === 'silent' && partnerChoice === 'betray') return 10;
  if (myChoice === 'betray' && partnerChoice === 'silent') return 0;
  return 5; // beide verraten
}

function pairOf(socketId) {
  return pairs.find((pr) => pr.a === socketId || pr.b === socketId);
}

// ---------------------------------------------------------------------------
// Rundensteuerung
// ---------------------------------------------------------------------------

function startRound(n) {
  if (advanceTimer) {
    clearTimeout(advanceTimer);
    advanceTimer = null;
  }

  currentRound = n;
  phase = 'playing';

  // Zu Beginn eines Spiels die kumulative Statistik zurücksetzen.
  if (n === 1) stats = { bb: 0, ss: 0, mixed: 0 };

  const order = shuffle(connectedPlayers().map((p) => p.id));
  pairs = [];

  for (let i = 0; i < order.length; i += 2) {
    if (i + 1 < order.length) {
      pairs.push({ a: order[i], b: order[i + 1], choiceA: null, choiceB: null, bye: false, done: false });
    } else {
      // Übrig gebliebener Spieler bekommt ein Freilos.
      pairs.push({ a: order[i], b: null, choiceA: null, choiceB: null, bye: true, done: true });
    }
  }

  for (const pr of pairs) {
    if (pr.bye) {
      io.to(pr.a).emit('byeRound', { round: currentRound, totalRounds: TOTAL_ROUNDS });
    } else {
      const nameA = players.get(pr.a).name;
      const nameB = players.get(pr.b).name;
      io.to(pr.a).emit('roundStart', { round: currentRound, totalRounds: TOTAL_ROUNDS, partnerName: nameB });
      io.to(pr.b).emit('roundStart', { round: currentRound, totalRounds: TOTAL_ROUNDS, partnerName: nameA });
    }
  }

  // Falls die Runde bereits komplett aus Freilosen besteht (z.B. nur 1 Spieler), direkt prüfen.
  maybeFinishRound();
}

// Wertet ein Paar aus, sobald beide gewählt haben, und schickt beiden das Ergebnis.
function resolvePair(pr) {
  if (pr.done || pr.bye) return;
  if (pr.choiceA === null || pr.choiceB === null) return;

  const pa = players.get(pr.a);
  const pb = players.get(pr.b);
  const yearsA = yearsFor(pr.choiceA, pr.choiceB);
  const yearsB = yearsFor(pr.choiceB, pr.choiceA);

  if (pa) pa.totalYears += yearsA;
  if (pb) pb.totalYears += yearsB;
  pr.done = true;

  // Entscheidungs-Statistik aktualisieren.
  if (pr.choiceA === 'betray' && pr.choiceB === 'betray') stats.bb++;
  else if (pr.choiceA === 'silent' && pr.choiceB === 'silent') stats.ss++;
  else stats.mixed++;

  if (pa && pa.connected) {
    io.to(pr.a).emit('roundResult', {
      round: currentRound,
      yourChoice: pr.choiceA,
      partnerChoice: pr.choiceB,
      yourYears: yearsA,
      partnerYears: yearsB,
      partnerName: pb ? pb.name : '—',
      nextInSeconds: NEXT_ROUND_SECONDS,
    });
  }
  if (pb && pb.connected) {
    io.to(pr.b).emit('roundResult', {
      round: currentRound,
      yourChoice: pr.choiceB,
      partnerChoice: pr.choiceA,
      yourYears: yearsB,
      partnerYears: yearsA,
      partnerName: pa ? pa.name : '—',
      nextInSeconds: NEXT_ROUND_SECONDS,
    });
  }
}

// Prüft, ob alle Paare fertig sind, und plant ggf. den Auto-Advance.
function maybeFinishRound() {
  if (phase !== 'playing') return;
  if (pairs.length === 0) return;
  if (!pairs.every((pr) => pr.done)) return;

  phase = 'result';

  if (advanceTimer) clearTimeout(advanceTimer);
  advanceTimer = setTimeout(() => {
    advanceTimer = null;
    if (currentRound >= TOTAL_ROUNDS) {
      endGame();
    } else {
      startRound(currentRound + 1);
    }
  }, NEXT_ROUND_SECONDS * 1000);
}

function endGame() {
  phase = 'finished';
  const leaderboard = [...players.values()]
    .filter((p) => p.connected)
    .map((p) => ({ name: p.name, totalYears: p.totalYears }))
    .sort((x, y) => x.totalYears - y.totalYears);

  io.emit('gameOver', { leaderboard, stats: { ...stats } });
}

function resetToLobby() {
  if (advanceTimer) {
    clearTimeout(advanceTimer);
    advanceTimer = null;
  }
  phase = 'lobby';
  currentRound = 0;
  pairs = [];
  stats = { bb: 0, ss: 0, mixed: 0 };
  for (const p of players.values()) {
    p.totalYears = 0;
  }
  ensureHost();
  broadcastLobby();
}

// ---------------------------------------------------------------------------
// Socket.IO-Verbindungen
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  socket.on('join', ({ name }) => {
    const cleanName = String(name || '').trim().slice(0, 30) || 'Anonym';
    const isFirst = connectedPlayers().length === 0;

    players.set(socket.id, {
      id: socket.id,
      name: cleanName,
      isHost: isFirst,
      totalYears: 0,
      connected: true,
    });

    ensureHost();

    // Spieler, die mitten im laufenden Spiel beitreten, warten bis zum nächsten Spiel.
    if (phase !== 'lobby') {
      socket.emit('waiting', { phase });
    }
    broadcastLobby();
  });

  socket.on('startGame', () => {
    const p = players.get(socket.id);
    if (!p || !p.isHost) return;
    if (phase !== 'lobby') return;
    if (connectedPlayers().length < 2) {
      socket.emit('errorMsg', { message: 'Mindestens 2 Spieler werden zum Starten benötigt.' });
      return;
    }
    startRound(1);
  });

  socket.on('makeChoice', ({ choice }) => {
    if (phase !== 'playing') return;
    if (choice !== 'silent' && choice !== 'betray') return;

    const pr = pairOf(socket.id);
    if (!pr || pr.bye || pr.done) return;

    if (pr.a === socket.id) {
      if (pr.choiceA !== null) return; // Wahl bereits getroffen
      pr.choiceA = choice;
    } else {
      if (pr.choiceB !== null) return;
      pr.choiceB = choice;
    }

    resolvePair(pr);
    maybeFinishRound();
  });

  socket.on('newGame', () => {
    const p = players.get(socket.id);
    if (!p || !p.isHost) return;
    if (phase !== 'finished') return;
    resetToLobby();
  });

  // Host bricht ein laufendes Spiel ab: alle zurück in die Lobby, neues Spiel möglich.
  socket.on('abortGame', () => {
    const p = players.get(socket.id);
    if (!p || !p.isHost) return;
    if (phase === 'lobby') return; // nichts abzubrechen
    resetToLobby();
    io.emit('gameAborted');
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    if (!p) return;
    p.connected = false;
    const wasHost = p.isHost;
    p.isHost = false;

    if (phase === 'playing') {
      // Paar des getrennten Spielers auflösen, damit der Partner nicht hängenbleibt.
      const pr = pairOf(socket.id);
      if (pr && !pr.bye && !pr.done) {
        const partnerId = pr.a === socket.id ? pr.b : pr.a;
        const partner = players.get(partnerId);
        pr.done = true;
        if (partner && partner.connected) {
          // Partner erhält ein Freilos (0 Jahre) für diese Runde.
          io.to(partnerId).emit('roundResult', {
            round: currentRound,
            yourChoice: pr.a === partnerId ? pr.choiceA : pr.choiceB,
            partnerChoice: null,
            yourYears: 0,
            partnerYears: 0,
            partnerName: p.name,
            nextInSeconds: NEXT_ROUND_SECONDS,
            partnerLeft: true,
          });
        }
      }
    }

    players.delete(socket.id);
    ensureHost();

    if (phase === 'lobby' || phase === 'finished') {
      broadcastLobby();
    } else if (phase === 'playing') {
      maybeFinishRound();
    }

    // Wenn niemand mehr verbunden ist, alles zurücksetzen.
    if (connectedPlayers().length === 0) {
      if (advanceTimer) {
        clearTimeout(advanceTimer);
        advanceTimer = null;
      }
      phase = 'lobby';
      currentRound = 0;
      pairs = [];
    } else if (wasHost && (phase === 'lobby' || phase === 'finished')) {
      broadcastLobby();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Gefangenen-Dilemma läuft auf http://localhost:${PORT}`);
});
