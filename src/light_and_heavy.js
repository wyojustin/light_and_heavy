// light_and_heavy.js v3.10.2
console.log("light_and_heavy.js loaded");

// === Constants & Global Variables ===
const COLORS = {
  1: { light: "#ffff99", heavy: "#ffff00" },
  2: { light: "#ff5050", heavy: "#ff0000" }
};

let secret = "";
const moveNumber = 1;
const clientId = "client_" + Math.random().toString(16).substr(2, 8);
console.log("Generated clientId:", clientId);
let myNonce = "nonce_" + Math.random().toString(16).substr(2, 8);
console.log("Generated myNonce:", myNonce);

let mqttConnected = false, challengeReceived = false, myChallengePosted = false;
let playerRole = null, turn = 1, gameMoveNumber = 1, lastLoser = null;

// Initial checker counts:
const INITIAL_LIGHT = 11;
const INITIAL_HEAVY = 10;

// === Helper Functions ===
function computeHMAC(message) {
  return CryptoJS.HmacSHA256(message, secret).toString();
}

// Clear challenge by publishing an empty retained message.
function clearChallenge() {
  const msg = new Paho.MQTT.Message("");
  msg.destinationName = "light_and_heavy/challenge";
  msg.retained = true;
  mqttClient.send(msg);
  console.log("Cleared challenge message.");
}

// === MQTT Setup & Handshake ===
const mqttClient = new Paho.MQTT.Client("mqtt.eclipseprojects.io", 443, "/mqtt", clientId);
mqttClient.onMessageArrived = onMessageArrived;

// Add this new function to clear the challenge accepted topic.
function clearChallengeAccepted() {
  const msg = new Paho.MQTT.Message("");
  msg.destinationName = "light_and_heavy/challenge_accepted";
  msg.retained = true;
  mqttClient.send(msg);
  console.log("Cleared challenge accepted message.");
}

// Combine clearing both handshake topics.
function clearHandshakeTopics() {
  clearChallenge();
  clearChallengeAccepted();
}


function onConnect() {
  mqttConnected = true;
  console.log("MQTT connected as", clientId);
  
  // Subscribe to handshake topics.
  mqttClient.subscribe("light_and_heavy/challenge");
  mqttClient.subscribe("light_and_heavy/challenge_accepted");
  mqttClient.subscribe("light_and_heavy/move");
  
  // Immediately clear any stale retained messages.
  clearChallenge();          // clears light_and_heavy/challenge
  clearChallengeAccepted();  // clears light_and_heavy/challenge_accepted
  
  // Wait one second for the broker to propagate the clear messages.
  setTimeout(() => {
    // Now send a new challenge message.
    myNonce = "nonce_" + Math.random().toString(16).substr(2, 8);
    const msgObj = {
      move: moveNumber,
      nonce: myNonce,
      hmac: computeHMAC(moveNumber + myNonce),
      clientId
    };
    const payload = JSON.stringify(msgObj);
    const msg = new Paho.MQTT.Message(payload);
    msg.destinationName = "light_and_heavy/challenge";
    msg.retained = true;
    mqttClient.send(msg);
    myChallengePosted = true;
    console.log("Posted challenge:", payload);
    
    // Set a retry timer in case no valid handshake occurs within 3 seconds.
    setTimeout(() => {
      if (!challengeReceived) {
        myNonce = "nonce_" + Math.random().toString(16).substr(2, 8);
        console.log("Resending challenge with new nonce:", myNonce);
        const msgObj = {
          move: moveNumber,
          nonce: myNonce,
          hmac: computeHMAC(moveNumber + myNonce),
          clientId
        };
        const payload = JSON.stringify(msgObj);
        const msg = new Paho.MQTT.Message(payload);
        msg.destinationName = "light_and_heavy/challenge";
        msg.retained = true;
        mqttClient.send(msg);
        myChallengePosted = true;
        console.log("Posted challenge:", payload);
      }
    }, 3000);
  }, 1000);
}

function onMessageArrived(message) {
  console.log("MQTT message on", message.destinationName, ":", message.payloadString);
  
  // Guard: skip processing if the payload is empty or only whitespace.
  if (message.payloadString.trim() === "") {
    console.log("Empty message received on", message.destinationName, "- ignoring.");
    return;
  }
  
  let msgObj;
  try {
    msgObj = JSON.parse(message.payloadString);
  } catch (e) {
    console.log("Invalid JSON:", e);
    return;
  }
  
  if (message.destinationName === "light_and_heavy/challenge") {
    if (gameOver) {
      document.querySelector("#winOverlay button").innerText = "Accept Challenge";
      return;
    }
    if (msgObj.nonce === myNonce) {
      console.log("Ignoring own challenge message.");
      return;
    }
    if (msgObj.move === moveNumber && msgObj.hmac === computeHMAC(moveNumber + msgObj.nonce)) {
      challengeReceived = true;
      console.log("Received valid challenge from", msgObj.clientId);
      if (msgObj.clientId !== clientId && playerRole === null) {
        playerRole = (clientId < msgObj.clientId) ? 1 : 2;
      }
      if (msgObj.clientId !== clientId && playerRole === 2) {
        const acceptObj = { move: moveNumber, nonce: myNonce, hmac: computeHMAC(moveNumber + myNonce), clientId };
        const payload = JSON.stringify(acceptObj);
        const msg = new Paho.MQTT.Message(payload);
        msg.destinationName = "light_and_heavy/challenge_accepted";
        msg.retained = true;
        mqttClient.send(msg);
        console.log("Published challenge accepted:", payload);
      }
      clearChallenge(); // Handshake complete, clear challenge.
    } else {
      console.log("Received invalid challenge or for a different move.");
    }
  } else if (message.destinationName === "light_and_heavy/challenge_accepted") {
    if (gameOver) return;
    if (msgObj.move === moveNumber && msgObj.hmac === computeHMAC(moveNumber + msgObj.nonce)) {
      console.log("Received valid challenge accepted from", msgObj.clientId);
      challengeReceived = true; // Mark handshake as complete.
      if (myChallengePosted && msgObj.clientId !== clientId && playerRole === null) {
        playerRole = (clientId < msgObj.clientId) ? 1 : 2;
      }
    }
  } else if (message.destinationName === "light_and_heavy/move") {
    if (msgObj.clientId === clientId) return;
    if (msgObj.move === gameMoveNumber &&
        msgObj.hmac === computeHMAC(msgObj.move + msgObj.col + msgObj.type + msgObj.nonce + msgObj.color)) {
      console.log("Processing remote move:", msgObj);
      processRemoteMove(msgObj);
    } else {
      console.log("Received invalid move message.");
    }
  }
}


function onMessageArrived_xx(message) {
  console.log("MQTT message on", message.destinationName, ":", message.payloadString);
  
  // Guard: skip processing if the payload is empty or only whitespace.
  if (message.payloadString.trim() === "") {
    console.log("Empty message received on", message.destinationName, "- ignoring.");
    return;
  }
  
  let msgObj;
  try {
    msgObj = JSON.parse(message.payloadString);
  } catch (e) {
    console.log("Invalid JSON:", e);
    return;
  }
  
  if (message.destinationName === "light_and_heavy/challenge") {
    if (gameOver) {
      document.querySelector("#winOverlay button").innerText = "Accept Challenge";
      return;
    }
    if (msgObj.nonce === myNonce) {
      console.log("Ignoring own challenge message.");
      return;
    }
    if (msgObj.move === moveNumber && msgObj.hmac === computeHMAC(moveNumber + msgObj.nonce)) {
      challengeReceived = true;
      console.log("Received valid challenge from", msgObj.clientId);
      if (msgObj.clientId !== clientId && playerRole === null) {
        playerRole = (clientId < msgObj.clientId) ? 1 : 2;
      }
      if (msgObj.clientId !== clientId && playerRole === 2) {
        const acceptObj = { move: moveNumber, nonce: myNonce, hmac: computeHMAC(moveNumber + myNonce), clientId };
        const payload = JSON.stringify(acceptObj);
        const msg = new Paho.MQTT.Message(payload);
        msg.destinationName = "light_and_heavy/challenge_accepted";
        msg.retained = true;
        mqttClient.send(msg);
        console.log("Published challenge accepted:", payload);
      }
      clearChallenge(); // Handshake complete, clear challenge.
    } else {
      console.log("Received invalid challenge or for a different move.");
    }
  } else if (message.destinationName === "light_and_heavy/challenge_accepted") {
    if (gameOver) return;
    if (msgObj.move === moveNumber && msgObj.hmac === computeHMAC(moveNumber + msgObj.nonce)) {
      console.log("Received valid challenge accepted from", msgObj.clientId);
      if (myChallengePosted && msgObj.clientId !== clientId && playerRole === null) {
        playerRole = (clientId < msgObj.clientId) ? 1 : 2;
      }
    }
  } else if (message.destinationName === "light_and_heavy/move") {
    if (msgObj.clientId === clientId) return;
    if (msgObj.move === gameMoveNumber &&
        msgObj.hmac === computeHMAC(msgObj.move + msgObj.col + msgObj.type + msgObj.nonce + msgObj.color)) {
      console.log("Processing remote move:", msgObj);
      processRemoteMove(msgObj);
    } else {
      console.log("Received invalid move message.");
    }
  }
}

function onMessageArrivedold(message) {
  console.log("MQTT message on", message.destinationName, ":", message.payloadString);
  let msgObj;
  try { msgObj = JSON.parse(message.payloadString); } catch (e) { console.log("Invalid JSON:", e); return; }
  
  if (message.destinationName === "light_and_heavy/challenge") {
    if (gameOver) { document.querySelector("#winOverlay button").innerText = "Accept Challenge"; return; }
    if (msgObj.nonce === myNonce) { console.log("Ignoring own challenge message."); return; }
    if (msgObj.move === moveNumber && msgObj.hmac === computeHMAC(moveNumber + msgObj.nonce)) {
      challengeReceived = true;
      console.log("Received valid challenge from", msgObj.clientId);
      if (msgObj.clientId !== clientId && playerRole === null)
        playerRole = (clientId < msgObj.clientId) ? 1 : 2;
      if (msgObj.clientId !== clientId && playerRole === 2) {
        const acceptObj = { move: moveNumber, nonce: myNonce, hmac: computeHMAC(moveNumber + myNonce), clientId };
        const payload = JSON.stringify(acceptObj);
        const msg = new Paho.MQTT.Message(payload);
        msg.destinationName = "light_and_heavy/challenge_accepted";
        msg.retained = true;
        mqttClient.send(msg);
        console.log("Published challenge accepted:", payload);
      }
      clearChallenge(); // Handshake complete, clear challenge.
    } else { console.log("Received invalid challenge or for a different move."); }
  } else if (message.destinationName === "light_and_heavy/challenge_accepted") {
    if (gameOver) return;
    if (msgObj.move === moveNumber && msgObj.hmac === computeHMAC(moveNumber + msgObj.nonce)) {
      console.log("Received valid challenge accepted from", msgObj.clientId);
      if (myChallengePosted && msgObj.clientId !== clientId && playerRole === null)
        playerRole = (clientId < msgObj.clientId) ? 1 : 2;
    }
  } else if (message.destinationName === "light_and_heavy/move") {
    if (msgObj.clientId === clientId) return;
    if (msgObj.move === gameMoveNumber &&
        msgObj.hmac === computeHMAC(msgObj.move + msgObj.col + msgObj.type + msgObj.nonce + msgObj.color)) {
      console.log("Processing remote move:", msgObj);
      processRemoteMove(msgObj);
    } else { console.log("Received invalid move message."); }
  }
}

function startMQTT(retryCount) {
  retryCount = retryCount || 0;
  if (!mqttConnected) {
    console.log("Starting MQTT connection with secret:", secret);
    mqttClient.connect({
      onSuccess: onConnect,
      onFailure: function(error) {
        console.error("MQTT connection failed:", error.errorMessage);
        if (retryCount < 3) {
          setTimeout(() => { startMQTT(retryCount + 1); }, 2000);
        } else {
          alert("Unable to connect after multiple attempts. Please check your connection.");
        }
      },
      useSSL: true
    });
  } else { console.log("MQTT is already connected."); }
}

// === Game Setup & Rendering ===
const ROWS = 6, COLS = 7;
let boardState = Array.from({ length: ROWS }, () => Array(COLS).fill('.'));
let gameOver = false, lastWinData = null;
let isDragging = false, draggingChecker = null, draggingPlayer = null;
let currentMoveType = null, offsetX = 0, offsetY = 0;
let draggedPieceColor = null, draggedPieceChar = null, activePushDown = {};

function createPlayerStacks(player) {
  let containerLight = document.getElementById(player === 1 ? 'player1-light' : 'player2-light');
  let containerHeavy = document.getElementById(player === 1 ? 'player1-heavy' : 'player2-heavy');
  containerLight.innerHTML = '<div class="label">Light</div>';
  containerHeavy.innerHTML = '<div class="label">Heavy</div>';
  let lightCount = INITIAL_LIGHT;
  let heavyCount = INITIAL_HEAVY;
  for (let i = 0; i < lightCount; i++) {
    let checker = document.createElement('div');
    checker.classList.add('checker','stack-checker');
    checker.style.backgroundColor = (player === 1 ? COLORS[1].light : COLORS[2].light);
    checker.setAttribute('data-player', player);
    checker.setAttribute('data-move-type', 'light');
    checker.addEventListener('mousedown', handleMouseDown);
    containerLight.appendChild(checker);
  }
  for (let i = 0; i < heavyCount; i++) {
    let checker = document.createElement('div');
    checker.classList.add('checker','stack-checker');
    checker.style.backgroundColor = (player === 1 ? COLORS[1].heavy : COLORS[2].heavy);
    checker.setAttribute('data-player', player);
    checker.setAttribute('data-move-type', 'heavy');
    checker.addEventListener('mousedown', handleMouseDown);
    containerHeavy.appendChild(checker);
  }
}

function updatePlayerStacks() {
  let p1LightPlayed = 0, p1HeavyPlayed = 0, p2LightPlayed = 0, p2HeavyPlayed = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let cell = boardState[r][c];
      if (cell === 'y') p1LightPlayed++;
      if (cell === 'Y') p1HeavyPlayed++;
      if (cell === 'r') p2LightPlayed++;
      if (cell === 'R') p2HeavyPlayed++;
    }
  }
  const p1LightRemaining = INITIAL_LIGHT - p1LightPlayed;
  const p1HeavyRemaining = INITIAL_HEAVY - p1HeavyPlayed;
  const p2LightRemaining = INITIAL_LIGHT - p2LightPlayed;
  const p2HeavyRemaining = INITIAL_HEAVY - p2HeavyPlayed;
  
  let p1LightContainer = document.getElementById('player1-light');
  let p1HeavyContainer = document.getElementById('player1-heavy');
  p1LightContainer.innerHTML = '<div class="label">Light</div>';
  p1HeavyContainer.innerHTML = '<div class="label">Heavy</div>';
  for (let i = 0; i < p1LightRemaining; i++) {
    let checker = document.createElement('div');
    checker.classList.add('checker', 'stack-checker');
    checker.style.backgroundColor = COLORS[1].light;
    checker.setAttribute('data-player', 1);
    checker.setAttribute('data-move-type', 'light');
    checker.addEventListener('mousedown', handleMouseDown);
    p1LightContainer.appendChild(checker);
  }
  for (let i = 0; i < p1HeavyRemaining; i++) {
    let checker = document.createElement('div');
    checker.classList.add('checker', 'stack-checker');
    checker.style.backgroundColor = COLORS[1].heavy;
    checker.setAttribute('data-player', 1);
    checker.setAttribute('data-move-type', 'heavy');
    checker.addEventListener('mousedown', handleMouseDown);
    p1HeavyContainer.appendChild(checker);
  }
  
  let p2LightContainer = document.getElementById('player2-light');
  let p2HeavyContainer = document.getElementById('player2-heavy');
  p2LightContainer.innerHTML = '<div class="label">Light</div>';
  p2HeavyContainer.innerHTML = '<div class="label">Heavy</div>';
  for (let i = 0; i < p2LightRemaining; i++) {
    let checker = document.createElement('div');
    checker.classList.add('checker', 'stack-checker');
    checker.style.backgroundColor = COLORS[2].light;
    checker.setAttribute('data-player', 2);
    checker.setAttribute('data-move-type', 'light');
    checker.addEventListener('mousedown', handleMouseDown);
    p2LightContainer.appendChild(checker);
  }
  for (let i = 0; i < p2HeavyRemaining; i++) {
    let checker = document.createElement('div');
    checker.classList.add('checker', 'stack-checker');
    checker.style.backgroundColor = COLORS[2].heavy;
    checker.setAttribute('data-player', 2);
    checker.setAttribute('data-move-type', 'heavy');
    checker.addEventListener('mousedown', handleMouseDown);
    p2HeavyContainer.appendChild(checker);
  }
}

function createBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let cell = document.createElement('div');
      cell.classList.add('cell');
      cell.setAttribute('data-row', r);
      cell.setAttribute('data-col', c);
      board.appendChild(cell);
    }
  }
  redrawBoard();
}

function createDropZones() {
  document.querySelectorAll('.drop-zone').forEach(z => z.remove());
  const board = document.getElementById('board');
  const boardRect = board.getBoundingClientRect();
  const boardContainer = document.getElementById('board-container');
  const containerRect = boardContainer.getBoundingClientRect();
  const boardLeft = boardRect.left - containerRect.left;
  for (let c = 0; c < COLS; c++) {
    let dz = document.createElement('div');
    dz.classList.add('drop-zone');
    dz.setAttribute('data-col', c);
    dz.style.width = '70px';
    dz.style.height = '70px';
    dz.style.left = (boardLeft + 10 + c * 80) + 'px';
    dz.style.top = (-90) + 'px';
    boardContainer.appendChild(dz);
  }
}

function updateDropZones() {
  document.querySelectorAll('.drop-zone').forEach(function(dz) {
    let c = parseInt(dz.getAttribute('data-col'));
    dz.classList.toggle('disabled', countPiecesInColumn(c) >= ROWS);
  });
}

function updateDraggableStacks() {
  document.getElementById('turnIndicator').innerText = (turn === playerRole) ? "Your turn." : "Waiting for opponent.";
  if (playerRole === 1) {
    document.getElementById('player1-light').classList.toggle('disabled', turn !== 1);
    document.getElementById('player1-heavy').classList.toggle('disabled', turn !== 1);
    document.getElementById('player2-light').classList.add('disabled');
    document.getElementById('player2-heavy').classList.add('disabled');
  } else {
    document.getElementById('player2-light').classList.toggle('disabled', turn !== 2);
    document.getElementById('player2-heavy').classList.toggle('disabled', turn !== 2);
    document.getElementById('player1-light').classList.add('disabled');
    document.getElementById('player1-heavy').classList.add('disabled');
  }
  updateDropZones();
  updatePlayerStacks();
}

// === Drag-and-Drop Handlers ===
function handleMouseDown(e) {
  if (gameOver || this !== this.parentElement.querySelector('.checker') || playerRole !== turn) return;
  e.preventDefault();
  draggingPlayer = playerRole;
  currentMoveType = this.getAttribute('data-move-type');
  draggedPieceColor = (playerRole === 1)
    ? (currentMoveType === 'heavy' ? COLORS[1].heavy : COLORS[1].light)
    : (currentMoveType === 'heavy' ? COLORS[2].heavy : COLORS[2].light);
  draggedPieceChar = (currentMoveType === 'heavy')
    ? (playerRole === 1 ? 'Y' : 'R')
    : (playerRole === 1 ? 'y' : 'r');
  const origRect = this.getBoundingClientRect();
  const containerRect = document.getElementById('board-container').getBoundingClientRect();
  offsetX = e.clientX - origRect.left;
  offsetY = e.clientY - origRect.top;
  this.parentNode.removeChild(this);
  draggingChecker = document.createElement('div');
  draggingChecker.classList.add('dragging-checker');
  draggingChecker.style.width = '70px';
  draggingChecker.style.height = '70px';
  draggingChecker.style.border = '2px solid black';
  draggingChecker.style.borderRadius = '50%';
  draggingChecker.style.backgroundColor = draggedPieceColor;
  draggingChecker.style.left = (origRect.left - containerRect.left) + 'px';
  draggingChecker.style.top = (origRect.top - containerRect.top) + 'px';
  draggingChecker.style.zIndex = "3";
  document.getElementById('board-container').appendChild(draggingChecker);
  isDragging = true;
}

document.addEventListener('mousemove', function(e) {
  if (!isDragging || !draggingChecker) return;
  const containerRect = document.getElementById('board-container').getBoundingClientRect();
  draggingChecker.style.left = (e.clientX - containerRect.left - offsetX) + 'px';
  draggingChecker.style.top = (e.clientY - containerRect.top - offsetY) + 'px';
  draggingChecker.style.zIndex = "3";
  
  document.querySelectorAll('.drop-zone').forEach(function(dz) {
    const dzRect = dz.getBoundingClientRect();
    dz.classList.toggle('active', e.clientX >= dzRect.left && e.clientX <= dzRect.right &&
                                  e.clientY >= dzRect.top && e.clientY <= dzRect.bottom);
  });
});

document.addEventListener('mouseup', function(e) {
  if (!isDragging || !draggingChecker) return;
  isDragging = false;
  const containerRect = document.getElementById('board-container').getBoundingClientRect();
  document.querySelectorAll('.drop-zone').forEach(dz => dz.classList.remove('active'));
  let validDZ = Array.from(document.querySelectorAll('.drop-zone')).find(dz => {
    const rect = dz.getBoundingClientRect();
    return (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom);
  });
  if (!validDZ) { returnToStack(); return; }
  const col = parseInt(validDZ.getAttribute('data-col'));
  let targetRow = -1;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (boardState[r][col] === '.') { targetRow = r; break; }
  }
  if (targetRow === -1) { returnToStack(); return; }
  
  targetRow = (currentMoveType === 'heavy') ? placeHeavyPiece(col, draggedPieceChar) : placeLightPiece(col, draggedPieceChar);
  if (targetRow === null) { returnToStack(); return; }
  
  const boardRect = document.getElementById('board').getBoundingClientRect();
  const boardLeft = boardRect.left - containerRect.left;
  const boardTop = boardRect.top - containerRect.top;
  const finalLeft = boardLeft + 10 + col * 80;
  const finalTop = boardTop + 10 + targetRow * 80;
  
  draggingChecker.style.transition = 'none';
  draggingChecker.style.left = finalLeft + 'px';
  draggingChecker.style.top = finalTop + 'px';
  
  const cell = document.querySelector(`.cell[data-row="${targetRow}"][data-col="${col}"]`);
  if (cell) { cell.style.backgroundColor = draggedPieceColor; }
  if (draggingChecker) { draggingChecker.remove(); draggingChecker = null; }
  redrawBoard();
  publishMove(col, currentMoveType);
  updatePlayerStacks();
  let winData = checkWin();
  if (winData) { endGame(winData); }
  else { turn = (turn === 1) ? 2 : 1; updateDraggableStacks(); gameMoveNumber++; }
  draggingPlayer = null;
});

function returnToStack() {
  const player = draggingPlayer;
  let targetStack = document.getElementById(player === 1 ? (currentMoveType === 'heavy' ? 'player1-heavy' : 'player1-light')
                                                    : (currentMoveType === 'heavy' ? 'player2-heavy' : 'player2-light'));
  const labelElem = targetStack.querySelector('.label');
  const containerRect = document.getElementById('board-container').getBoundingClientRect();
  const stackRect = targetStack.getBoundingClientRect();
  const finalLeft = stackRect.left - containerRect.left;
  const finalTop = stackRect.top - containerRect.top;
  draggingChecker.style.transition = 'none';
  draggingChecker.style.left = finalLeft + 'px';
  draggingChecker.style.top = finalTop + 'px';
  draggingChecker.addEventListener('transitionend', function() {
    if (draggingChecker) { draggingChecker.remove(); draggingChecker = null; }
    let newChecker = document.createElement('div');
    newChecker.classList.add('checker', 'stack-checker');
    newChecker.style.backgroundColor = draggedPieceColor;
    newChecker.setAttribute('data-player', player);
    newChecker.setAttribute('data-move-type', currentMoveType);
    newChecker.addEventListener('mousedown', handleMouseDown);
    if (labelElem && labelElem.nextSibling) { targetStack.insertBefore(newChecker, labelElem.nextSibling); }
    else { targetStack.appendChild(newChecker); }
    updatePlayerStacks();
  }, { once: true });
  setTimeout(() => { if (draggingChecker) { draggingChecker.remove(); draggingChecker = null; } }, 100);
  draggingPlayer = null;
}

// === Board & Cell Helpers ===
function countPiecesInColumn(col) {
  let count = 0;
  for (let r = 0; r < ROWS; r++) { if (boardState[r][col] !== '.') count++; }
  return count;
}

function countHeavyInColumn(col) {
  let count = 0;
  for (let r = 0; r < ROWS; r++) {
    let cell = boardState[r][col];
    if (cell === 'Y' || cell === 'R') count++;
  }
  return count;
}

function placeHeavyPiece(col, piece) {
  let n = countPiecesInColumn(col);
  if (n >= ROWS) return null;
  let target = ROWS - n - 1;
  let lightBlock = [];
  for (let r = 0; r < ROWS; r++) {
    if (boardState[r][col] !== '.' && boardState[r][col] === boardState[r][col].toLowerCase()) { lightBlock.push(boardState[r][col]); }
    else { break; }
  }
  if (lightBlock.length > 0) {
    for (let r = 0; r < lightBlock.length; r++) { boardState[r][col] = '.'; }
    boardState[target][col] = piece;
    for (let j = 0; j < lightBlock.length; j++) {
      let newRow = target + 1 + j;
      if (newRow < ROWS) boardState[newRow][col] = lightBlock[j];
    }
    let finalRows = [];
    for (let i = 0; i < lightBlock.length; i++) {
      let newRow = target + 1 + i;
      if (newRow < ROWS) finalRows.push(newRow);
    }
    activePushDown[col] = finalRows;
    activePushDown[col].forEach(row => {
      let cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
      if (cell) cell.style.backgroundColor = 'transparent';
    });
    animatePushDown(col, lightBlock, target);
  } else {
    boardState[target][col] = piece;
  }
  return target;
}

function placeLightPiece(col, piece) {
  let heavyCount = countHeavyInColumn(col);
  let maxLightRow = ROWS - heavyCount - 1;
  if (boardState[0][col] === '.') { boardState[0][col] = piece; return 0; }
  else if (boardState[0][col].toLowerCase() === boardState[0][col]) {
    let lightBlock = [];
    for (let r = 0; r <= maxLightRow; r++) {
      if (boardState[r][col] !== '.' && boardState[r][col].toLowerCase() === boardState[r][col]) { lightBlock.push(boardState[r][col]); }
      else { break; }
    }
    if (lightBlock.length > maxLightRow + 1) return null;
    for (let i = lightBlock.length - 1; i >= 0; i--) { boardState[i+1][col] = lightBlock[i]; }
    boardState[0][col] = piece;
    return 0;
  }
  return null;
}

function animatePushDown(col, lightBlock, target) {
  const boardRect = document.getElementById('board').getBoundingClientRect();
  const containerRect = document.getElementById('board-container').getBoundingClientRect();
  const boardLeft = boardRect.left - containerRect.left;
  const boardTop = boardRect.top - containerRect.top;
  for (let i = 0; i < lightBlock.length; i++) {
    const tempPiece = document.createElement('div');
    tempPiece.classList.add('dragging-checker');
    tempPiece.style.width = '70px';
    tempPiece.style.height = '70px';
    tempPiece.style.border = '2px solid black';
    tempPiece.style.borderRadius = '50%';
    tempPiece.style.backgroundColor = (lightBlock[i].toLowerCase() === 'y') ? COLORS[1].light : COLORS[2].light;
    tempPiece.style.position = 'absolute';
    let initLeft = boardLeft + 10 + col * 80;
    let initTop = boardTop + 10 + i * 80;
    tempPiece.style.left = initLeft + 'px';
    tempPiece.style.top = initTop + 'px';
    tempPiece.style.transition = 'top 0.5s ease-out';
    document.getElementById('board-container').appendChild(tempPiece);
    tempPiece.getBoundingClientRect();
    let finalTop = boardTop + 10 + (target + 1 + i) * 80;
    setTimeout(() => { tempPiece.style.top = finalTop + 'px'; }, 0);
    setTimeout(() => { tempPiece.remove(); }, 600);
  }
  setTimeout(() => { delete activePushDown[col]; redrawBoard(); }, 600);
}

function redrawBoard() {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      let cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
      if (cell) {
        if (activePushDown[col] && activePushDown[col].includes(row)) {
          cell.style.backgroundColor = 'transparent';
        } else {
          if (boardState[row][col] === '.') { cell.style.backgroundColor = 'white'; }
          else if (boardState[row][col] === 'y') { cell.style.backgroundColor = COLORS[1].light; }
          else if (boardState[row][col] === 'Y') { cell.style.backgroundColor = COLORS[1].heavy; }
          else if (boardState[row][col] === 'r') { cell.style.backgroundColor = COLORS[2].light; }
          else if (boardState[row][col] === 'R') { cell.style.backgroundColor = COLORS[2].heavy; }
        }
      }
    }
  }
}

function checkWin() {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      let piece = boardState[row][col];
      if (piece === '.') continue;
      let norm = piece.toLowerCase();
      if (col <= COLS - 4) {
        if (
          boardState[row][col+1].toLowerCase() === norm &&
          boardState[row][col+2].toLowerCase() === norm &&
          boardState[row][col+3].toLowerCase() === norm
        ) { return { player: (norm === 'y') ? 1 : 2, winningCells: [[row,col],[row,col+1],[row,col+2],[row,col+3]] }; }
      }
      if (row <= ROWS - 4) {
        if (
          boardState[row+1][col].toLowerCase() === norm &&
          boardState[row+2][col].toLowerCase() === norm &&
          boardState[row+3][col].toLowerCase() === norm
        ) { return { player: (norm === 'y') ? 1 : 2, winningCells: [[row,col],[row+1,col],[row+2,col],[row+3,col]] }; }
      }
      if (row <= ROWS - 4 && col <= COLS - 4) {
        if (
          boardState[row+1][col+1].toLowerCase() === norm &&
          boardState[row+2][col+2].toLowerCase() === norm &&
          boardState[row+3][col+3].toLowerCase() === norm
        ) { return { player: (norm === 'y') ? 1 : 2, winningCells: [[row,col],[row+1,col+1],[row+2,col+2],[row+3,col+3]] }; }
      }
      if (row <= ROWS - 4 && col >= 3) {
        if (
          boardState[row+1][col-1].toLowerCase() === norm &&
          boardState[row+2][col-2].toLowerCase() === norm &&
          boardState[row+3][col-3].toLowerCase() === norm
        ) { return { player: (norm === 'y') ? 1 : 2, winningCells: [[row,col],[row+1,col-1],[row+2,col-2],[row+3,col-3]] }; }
      }
    }
  }
  return null;
}

function endGame(winData) {
  gameOver = true;
  console.log("Game over. Player", winData.player, "wins!");
  winData.winningCells.forEach(coord => {
    let cell = document.querySelector(`.cell[data-row="${coord[0]}"][data-col="${coord[1]}"]`);
    if (cell) cell.classList.add('win');
  });
  let winMsg = (winData.player === playerRole) ? "You win." : "You lose.";
  document.getElementById("winMessage").innerText = winMsg;
  document.getElementById("winOverlay").style.display = "flex";
  lastLoser = (winData.player === playerRole) ? (3 - playerRole) : playerRole;
}

function publishMove(col, moveType) {
  let moveNonce = "moveNonce_" + Math.random().toString(16).substr(2, 8);
  let myColor = (turn === 1)
    ? (moveType === "heavy" ? COLORS[1].heavy : COLORS[1].light)
    : (moveType === "heavy" ? COLORS[2].heavy : COLORS[2].light);
  const msgObj = {
    move: gameMoveNumber,
    col: col,
    type: moveType,
    color: myColor,
    nonce: moveNonce,
    hmac: computeHMAC(gameMoveNumber + col + moveType + moveNonce + myColor),
    clientId: clientId
  };
  const payload = JSON.stringify(msgObj);
  const msg = new Paho.MQTT.Message(payload);
  msg.destinationName = "light_and_heavy/move";
  mqttClient.send(msg);
  console.log("Published move:", payload);
}

function processRemoteMove(msgObj) {
  let col = msgObj.col, moveType = msgObj.type, oppColor = msgObj.color;
  let targetRow = -1;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (boardState[r][col] === '.') { targetRow = r; break; }
  }
  if (targetRow === -1) return;
  let oppPiece = (moveType === 'heavy')
    ? ((oppColor === COLORS[1].light || oppColor === COLORS[1].heavy) ? 'Y' : 'R')
    : ((oppColor === COLORS[1].light || oppColor === COLORS[1].heavy) ? 'y' : 'r');
  targetRow = (moveType === 'heavy') ? placeHeavyPiece(col, oppPiece) : placeLightPiece(col, oppPiece);
  redrawBoard();
  let opponent = (playerRole === 1) ? 2 : 1;
  updatePlayerStacks();
  let winData = checkWin();
  if (winData) { endGame(winData); return; }
  turn = (turn === 1) ? 2 : 1;
  updateDraggableStacks();
  gameMoveNumber++;
  console.log("Remote move processed. New gameMoveNumber:", gameMoveNumber);
}

function checkNegotiationComplete() {
  if (playerRole !== null) { console.log("Negotiation complete. I am Player", playerRole); updateDraggableStacks(); }
  else { setTimeout(checkNegotiationComplete, 500); }
}
checkNegotiationComplete();

// === Initialization ===
createPlayerStacks(1);
createPlayerStacks(2);
createBoard();
createDropZones();

document.getElementById("setSecretBtn").addEventListener("click", function(){
  secret = document.getElementById("secretInput").value;
  if (secret === "") { alert("Please enter a shared secret."); return; }
  console.log("Shared secret set to:", secret);
  if (mqttConnected) {
    mqttClient.disconnect();
    mqttConnected = false;
    console.log("Disconnected previous MQTT connection.");
  }
  startMQTT();
});

function resetGame() {
  gameOver = false;
  boardState = Array.from({ length: ROWS }, () => Array(COLS).fill('.'));
  gameMoveNumber = 1;
  turn = (lastLoser !== null) ? lastLoser : 1;
  document.getElementById("winOverlay").style.display = "none";
  document.querySelector("#winOverlay button").innerText = "Play Again";
  createBoard();
  createDropZones();
  updatePlayerStacks();
  updateDraggableStacks();
  console.log("Game reset.");
  challengeReceived = false;
  myChallengePosted = false;
  myNonce = "nonce_" + Math.random().toString(16).substr(2, 8);
  console.log("New nonce generated:", myNonce);
  const msgObj = { move: moveNumber, nonce: myNonce, hmac: computeHMAC(moveNumber + myNonce), clientId };
  const payload = JSON.stringify(msgObj);
  const msg = new Paho.MQTT.Message(payload);
  msg.destinationName = "light_and_heavy/challenge";
  msg.retained = true;
  mqttClient.send(msg);
  console.log("Sent new challenge message:", payload);
}
window.resetGame = resetGame;

// End of light_and_heavy.js v3.10.2
