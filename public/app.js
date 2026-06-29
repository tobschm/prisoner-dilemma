// Client-Logik: hält die Socket.IO-Verbindung, blendet Screens je nach Server-Event
// ein/aus und sendet die Aktionen des Spielers.

const socket = io();

let youAreHost = false;
let countdownTimer = null;

// --- Screen-Steuerung -------------------------------------------------------

const screens = {
  join: document.getElementById('screen-join'),
  lobby: document.getElementById('screen-lobby'),
  waiting: document.getElementById('screen-waiting'),
  play: document.getElementById('screen-play'),
  bye: document.getElementById('screen-bye'),
  result: document.getElementById('screen-result'),
  over: document.getElementById('screen-over'),
};

// Screens, auf denen der Host das Spiel abbrechen darf (ein laufendes Spiel).
const abortableScreens = ['play', 'bye', 'result', 'over'];
const abortBtn = document.getElementById('abort-btn');

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('hidden', key !== name);
  }
  // Abbrechen-Button nur dem Host während eines laufenden Spiels zeigen.
  const showAbort = youAreHost && abortableScreens.includes(name);
  abortBtn.classList.toggle('hidden', !showAbort);
}

abortBtn.addEventListener('click', () => {
  if (confirm('Das Spiel wirklich für alle abbrechen? Alle kehren in die Lobby zurück.')) {
    socket.emit('abortGame');
  }
});

function choiceLabel(choice) {
  if (choice === 'silent') return '🤐 Stillschweigen';
  if (choice === 'betray') return '🗣️ Verraten';
  return '—';
}

function yearsLabel(years) {
  return years === 1 ? '1 Jahr Haft' : `${years} Jahre Haft`;
}

// Baut eine 2x2-ASCII-Tabelle aus den kumulativen Entscheidungs-Statistiken.
// Belegung: (Verraten,Verraten)=bb, (Schweigen,Schweigen)=ss, gemischt=mixed (beide Gegenfelder).
function buildDilemmaTable(stats) {
  const s = stats || { bb: 0, ss: 0, mixed: 0 };
  const colLabels = ['Verraten', 'Stillschweigen'];
  const rowLabels = ['Verraten', 'Stillschweigen'];
  const cells = [
    [s.bb, s.mixed], // Zeile Verraten
    [s.mixed, s.ss], // Zeile Stillschweigen
  ];

  const labelW = Math.max(...rowLabels.map((r) => r.length));
  const colW = colLabels.map((c) => c.length);

  const center = (val, w) => {
    const str = String(val);
    const total = Math.max(0, w - str.length);
    const left = Math.floor(total / 2);
    return ' '.repeat(left) + str + ' '.repeat(total - left);
  };
  const padRight = (str, w) => str + ' '.repeat(Math.max(0, w - str.length));

  const sep = '-'.repeat(labelW + 2) + '+' + colW.map((w) => '-'.repeat(w + 2) + '+').join('');
  const lines = [];

  const header = colLabels.map((c, i) => ' ' + center(c, colW[i]) + ' ').join('|');
  lines.push(' '.repeat(labelW + 2) + '|' + header + '|');
  lines.push(sep);
  rowLabels.forEach((r, ri) => {
    const data = cells[ri].map((v, ci) => ' ' + center(v, colW[ci]) + ' ').join('|');
    lines.push(' ' + padRight(r, labelW) + ' |' + data + '|');
    lines.push(sep);
  });
  return lines.join('\n');
}

function renderDilemmaTable(stats) {
  const el = document.getElementById('dilemma-table');
  if (el) el.textContent = buildDilemmaTable(stats);
}

// --- Beitreten --------------------------------------------------------------

const joinForm = document.getElementById('join-form');
const nameInput = document.getElementById('name-input');

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  socket.emit('join', { name });
  showScreen('lobby');
});

// --- Lobby ------------------------------------------------------------------

const playerList = document.getElementById('player-list');
const hostControls = document.getElementById('host-controls');
const waitingHost = document.getElementById('waiting-host');
const startBtn = document.getElementById('start-btn');
const startHint = document.getElementById('start-hint');

startBtn.addEventListener('click', () => {
  socket.emit('startGame');
});

socket.on('lobbyUpdate', ({ players, youAreHost: isHost, phase }) => {
  youAreHost = isHost;

  // Wenn wir in der Lobby- oder Endphase sind und nicht spielen, passenden Screen zeigen.
  if (phase === 'lobby') {
    playerList.innerHTML = '';
    for (const p of players) {
      const li = document.createElement('li');
      li.textContent = p.name + (p.isHost ? ' 👑 (Host)' : '');
      playerList.appendChild(li);
    }

    hostControls.classList.toggle('hidden', !isHost);
    waitingHost.classList.toggle('hidden', isHost);

    const enough = players.length >= 2;
    startBtn.disabled = !enough;
    startHint.textContent = enough ? '' : 'Mindestens 2 Spieler werden benötigt.';

    // Nur auf den Lobby-Screen wechseln, wenn wir nicht gerade in einem Spiel-Screen sind.
    const activeGameScreens = ['play', 'bye', 'result'];
    const onGameScreen = activeGameScreens.some((n) => !screens[n].classList.contains('hidden'));
    if (!onGameScreen) showScreen('lobby');
  }
});

socket.on('waiting', () => {
  showScreen('waiting');
});

// Host hat das Spiel abgebrochen: alle zwangsweise zurück in die Lobby.
socket.on('gameAborted', () => {
  clearCountdown();
  setChoiceButtonsEnabled(true);
  waitingPartner.classList.add('hidden');
  showScreen('lobby');
});

socket.on('errorMsg', ({ message }) => {
  alert(message);
});

// --- Spiel (Entscheidung) ---------------------------------------------------

const playRound = document.getElementById('play-round');
const partnerNameEl = document.getElementById('partner-name');
const btnBetray = document.getElementById('btn-betray');
const btnSilent = document.getElementById('btn-silent');
const waitingPartner = document.getElementById('waiting-partner');

function setChoiceButtonsEnabled(enabled) {
  btnBetray.disabled = !enabled;
  btnSilent.disabled = !enabled;
}

btnBetray.addEventListener('click', () => makeChoice('betray'));
btnSilent.addEventListener('click', () => makeChoice('silent'));

function makeChoice(choice) {
  socket.emit('makeChoice', { choice });
  setChoiceButtonsEnabled(false);
  waitingPartner.classList.remove('hidden');
}

socket.on('roundStart', ({ round, totalRounds, partnerName }) => {
  clearCountdown();
  playRound.textContent = `Runde ${round} / ${totalRounds}`;
  partnerNameEl.textContent = partnerName;
  setChoiceButtonsEnabled(true);
  waitingPartner.classList.add('hidden');
  showScreen('play');
});

// --- Freilos ----------------------------------------------------------------

const byeRound = document.getElementById('bye-round');

socket.on('byeRound', ({ round, totalRounds }) => {
  clearCountdown();
  byeRound.textContent = `Runde ${round} / ${totalRounds}`;
  showScreen('bye');
});

// --- Ergebnis ---------------------------------------------------------------

const resultRound = document.getElementById('result-round');
const resultHeadline = document.getElementById('result-headline');
const yourChoiceEl = document.getElementById('your-choice');
const yourYearsEl = document.getElementById('your-years');
const partnerChoiceEl = document.getElementById('partner-choice');
const partnerYearsEl = document.getElementById('partner-years');
const partnerLabel = document.getElementById('partner-label');
const resultExplain = document.getElementById('result-explain');
const nextCountdown = document.getElementById('next-countdown');

function explanationFor(yourChoice, partnerChoice, partnerLeft) {
  if (partnerLeft) {
    return 'Dein Mitspieler hat die Verbindung verloren — du erhältst diese Runde ein Freilos (0 Jahre).';
  }
  if (yourChoice === 'silent' && partnerChoice === 'silent') {
    return 'Beide habt ihr geschwiegen — die Polizei kann euch nur wenig nachweisen. Je 2 Jahre.';
  }
  if (yourChoice === 'betray' && partnerChoice === 'betray') {
    return 'Beide habt ihr den anderen verraten — je 5 Jahre Haft.';
  }
  if (yourChoice === 'betray' && partnerChoice === 'silent') {
    return 'Du hast verraten, dein Komplize schwieg — du bleibst straffrei, er bekommt 10 Jahre.';
  }
  return 'Du hast geschwiegen, dein Komplize hat dich verraten — du bekommst 10 Jahre, er bleibt straffrei.';
}

socket.on('roundResult', (data) => {
  const { round, yourChoice, partnerChoice, yourYears, partnerYears, partnerName, nextInSeconds, partnerLeft } = data;

  resultRound.textContent = `Runde ${round} — Ergebnis`;
  resultHeadline.textContent = yourYears < partnerYears ? '😎 Glück gehabt' : yourYears > partnerYears ? '😰 Schlecht gelaufen' : '🤝 Gleichstand';

  yourChoiceEl.textContent = choiceLabel(yourChoice);
  yourYearsEl.textContent = yearsLabel(yourYears);
  partnerLabel.textContent = partnerName || 'Komplize';
  partnerChoiceEl.textContent = choiceLabel(partnerChoice);
  partnerYearsEl.textContent = partnerChoice === null ? '—' : yearsLabel(partnerYears);

  resultExplain.textContent = explanationFor(yourChoice, partnerChoice, partnerLeft);

  showScreen('result');
  startCountdown(nextInSeconds);
});

function startCountdown(seconds) {
  clearCountdown();
  let remaining = seconds;
  const render = () => {
    nextCountdown.textContent = `Nächste Runde in ${remaining}…`;
  };
  render();
  countdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearCountdown();
      nextCountdown.textContent = 'Es geht weiter…';
      return;
    }
    render();
  }, 1000);
}

function clearCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

// --- Game Over --------------------------------------------------------------

const leaderboard = document.getElementById('leaderboard');
const overHostControls = document.getElementById('over-host-controls');
const overWaitingHost = document.getElementById('over-waiting-host');
const newgameBtn = document.getElementById('newgame-btn');

newgameBtn.addEventListener('click', () => {
  socket.emit('newGame');
});

socket.on('gameOver', ({ leaderboard: board, stats }) => {
  clearCountdown();
  leaderboard.innerHTML = '';
  board.forEach((entry, i) => {
    const li = document.createElement('li');
    const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
    li.innerHTML = `<span>${medal}${entry.name}</span><span class="lb-years">${yearsLabel(entry.totalYears)}</span>`;
    leaderboard.appendChild(li);
  });

  renderDilemmaTable(stats);

  overHostControls.classList.toggle('hidden', !youAreHost);
  overWaitingHost.classList.toggle('hidden', youAreHost);
  showScreen('over');
});
