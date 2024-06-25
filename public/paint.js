const socket = io();

const room = window.location.pathname.slice(1);
let username = '';
let color = '';
let activeRooms = {};
let activeRoomsVar = [];
let lastPositions = {};
let drawingHistory = [];
let redoStack = [];
let cursors = {};
let userRedoStacks = {};  // Store redo stacks for each user

userRedoStacks[socket.id] = userRedoStacks[socket.id] || [];

let lastServerX, lastServerY;

function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;`;
}

function getCookie(name) {
    const keyValue = document.cookie.match(`(^|;) ?${name}=([^;]*)(;|$)`);
    return keyValue ? keyValue[2] : null;
}

function joinRoom() {
    const roomCode = $('#roomCode').val().trim();
    if (roomCode) {
        window.location.href = `/${roomCode}`;
    }
}

function handleKeyUp(event) {
    if (event.key === 'Enter') {
        joinRoom();
    }
}

const roomCodeInUrl = window.location.pathname.slice(1);
if (roomCodeInUrl) {
    $('#content').show();
    $('#landing').hide();
    $('#toggleChatButton').hide();
    $("#undoButton").hide();
    $("#redoButton").hide();
    $("#modeButtons").hide();
    $('#m').hide();
    $('#m-button').hide();
    $('#clearCanvasButton').hide();
    $('#publicToggle').hide();
    $('#publicToggleLabel').hide();
    $('#infoIcon').hide();
    document.title = roomCodeInUrl;

    $('body').css('background-color', '#121212');

    const savedUsername = getCookie('username');
    const savedColor = getCookie('color');

    if (savedUsername) {
        $('#username').val(savedUsername === "Guest" ? "" : savedUsername);
    }

    if (savedColor) {
        $('#color').val(savedColor);
    }
} else {
    $('#landing').show();
    $('#content').hide();
    $("#canvas").hide();
    $("#modeButtons").hide();

    $('body').css('background-color', '#121212');
    $("#publicToggle").hide();
    $("#publicToggleLabel").hide();
    $("#infoIcon").hide();
}

const enableMessageInput = () => {
    $('#form').prop('disabled', false);
    $('form button').prop('disabled', false);
};

const restoreCanvas = () => {
    socket.emit('restoreCanvas', { ctx });
};

const updateSettings = () => {
    username = $('#username').val() || 'Guest';
    color = $('#color').val() || '#ffffff';

    setCookie('username', username, 365);
    setCookie('color', color, 365);

    socket.emit('join', { room, username, color });

    restoreCanvas();

    $('#settings').hide();
    $('#canvas').show();
    $('#modeButtons').show();
    $('#toggleChatButton').show();
    $('#undoButton').show();
    $('#redoButton').show();
    $('#m').show();
    $('#m-button').show();
    $('#clearCanvasButton').show();
    $('#publicToggle').show();
    $('#publicToggleLabel').show();
    $('#infoIcon').show();
    
    document.getElementById('undoButton').classList.add('non-drawing-button');
    document.getElementById('redoButton').classList.add('non-drawing-button');
    document.getElementById('toggleChatButton').classList.add('non-drawing-button');
    document.getElementById('drawButton').classList.add('non-drawing-button');
    document.getElementById('scrollButton').classList.add('non-drawing-button');
    document.getElementById('eraseButton').classList.add('non-drawing-button');

    // Ensure the canvas does not receive drawing events when clicking on these buttons
    document.querySelectorAll('.non-drawing-button').forEach(button => {
        button.addEventListener('mousedown', event => {
            event.stopPropagation();
        });
        button.addEventListener('touchstart', event => {
            event.stopPropagation();
        });
    });

    $('#messages').width("400px");
    $('#messages').css('padding', '10px');

    $('body').css('background-color', '#0d0d0d');

    enableMessageInput();
};

const sendMessage = (messageType, data) => {
    socket.emit(messageType, { room, username, color, ...data });

    $('#m').val('');
};

$('form').submit(function () {
    sendMessage('message', { message: $('#m').val().trim() });
    return false;
});

$('#username').on('keyup', function (event) {
    if (event.key === 'Enter') {
        updateSettings();
    }
});

socket.on('message', function (data) {
    const message = `<span style="color: ${data.color}">${data.username}:</span> ${data.message}`;
    appendMessage(message);
});

let canvas, ctx, drawing, lastX, lastY;

$(document).ready(function () {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    canvas.width = 2500;
    canvas.height = 1600;

    drawing = false;
    lastX = 0;
    lastY = 0;

    const chatbox = document.getElementById('messages');
    chatbox.style.pointerEvents = 'none';

    chatbox.addEventListener('mouseenter', function() {
        chatbox.style.pointerEvents = 'none';
    });

    chatbox.addEventListener('mouseleave', function() {
        chatbox.style.pointerEvents = 'none';
    });

    chatbox.addEventListener('scroll', function(event) {
        chatbox.style.pointerEvents = 'auto';
    });

    canvas.addEventListener('mousedown', function(event) {
        chatbox.style.pointerEvents = 'none';
    });

    document.addEventListener('mousedown', function(event) {
        if (isInsideCanvas(event.clientX, event.clientY)) {
            startDrawing(event);
        }
    });

    document.addEventListener('mousemove', function(event) {
        if (isInsideCanvas(event.clientX, event.clientY) && drawing) {
            draw(event);
        }
    });

    document.addEventListener('mouseup', function(event) {
        stopDrawing(event);
    });
    canvas.addEventListener('mouseout', stopDrawing);

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    canvas.addEventListener('mousemove', (event) => {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        socket.emit('cursorMove', { room, userId: socket.id, position: { x, y } });
    });

    toggleChat();
});

function isInsideCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
    );
}

function setDrawingActive(isActive) {
    canvas.style.pointerEvents = isActive ? 'auto' : 'none';
}

let mode = 'draw';

function startDrawing(e) {
    if (mode === 'scroll') {
        canvas.style.cursor = 'grabbing';
        lastX = e.clientX;
        lastY = e.clientY;
        return;
    }
    if (mode !== 'draw' && mode !== 'erase') return;
    const rect = canvas.getBoundingClientRect();
    drawing = true;
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;

    currentLine = [];
    currentLine.push({ x: lastX, y: lastY });

    socket.emit('drawingStart', { room, startX: lastX, startY: lastY, userId: socket.id, mode });
}

function draw(e) {
    if (mode === 'scroll') {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        canvas.scrollLeft -= dx;
        canvas.scrollTop -= dy;
        lastX = e.clientX;
        lastY = e.clientY;
        return;
    }
    if (!drawing) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = mode === 'erase' ? 10 : 2;
    ctx.stroke();

    currentLine.push({ x, y });

    lastX = x;
    lastY = y;

    socket.emit('drawing', { room, x, y, color, mode });
}

function stopDrawing() {
    if (mode === 'scroll') {
        canvas.style.cursor = 'grab';
        return;
    }
    if (mode !== 'draw' && mode !== 'erase') return;
    if (!drawing) return;
    drawing = false;

    drawingHistory.push({
        line: currentLine,
        color: color,
        mode: mode
    });

    socket.emit('drawingEnd', { room, userId: socket.id });

    currentLine = [];
}

let touchStartX, touchStartY;

function handleTouchStart(e) {
    if (mode !== 'draw' && mode !== 'erase') return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    drawing = true;
    lastX = touch.clientX - rect.left;
    lastY = touch.clientY - rect.top;

    socket.emit('drawingStart', { room, startX: lastX, startY: lastY, userId: socket.id, mode });

    lastPositions[socket.id] = { x: lastX, y: lastY };
}

function handleTouchMove(e) {
    if (!drawing) return;
    if (mode !== 'draw' && mode !== 'erase') return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = mode === 'erase' ? 10 : 2;
    ctx.stroke();

    lastX = x;
    lastY = y;

    socket.emit('drawing', { room, x, y, color, mode });
}

function handleTouchEnd(e) {
    if (!drawing) return;
    if (mode !== 'draw' && mode !== 'erase') return;
    e.preventDefault();
    drawing = false;

    socket.emit('drawingEnd', { room, userId: socket.id });
    lastPositions[socket.id] = null;
}

function handleGlobalTouchStart(e) {
    if (isInsideCanvas(e.touches[0].clientX, e.touches[0].clientY)) {
        handleTouchStart(e);
        e.preventDefault();
        e.stopPropagation();
    }
}

function handleGlobalTouchMove(e) {
    if (drawing && isInsideCanvas(e.touches[0].clientX, e.touches[0].clientY)) {
        handleTouchMove(e);
        e.preventDefault();
    }
}

function handleGlobalTouchEnd(e) {
    if (drawing) {
        handleTouchEnd(e);
        e.preventDefault();
    }
}

function continueDrawingAtCanvasEdgeTouch(touch) {
    const rect = canvas.getBoundingClientRect();
    let x = touch.clientX - rect.left;
    let y = touch.clientY - rect.top;

    x = Math.min(Math.max(x, 0), rect.width);
    y = Math.min(Math.max(y, 0), rect.height);
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const user in drawingHistory) {
        delete drawingHistory[user];
    }

    sendMessage('clearCanvas', {});
}

function appendMessage(message) {
    const newMessage = $('<li>').html(message);
    const messagesContainer = $('#messages');

    messagesContainer.append(newMessage);

    messagesContainer.scrollTop(messagesContainer.prop('scrollHeight'));
}

let userDrawingHistories = {};

function drawFromServer(data) {
    const userId = data.userId;

    if (!userDrawingHistories[userId]) {
        userDrawingHistories[userId] = [];
    }

    const userHistory = userDrawingHistories[userId];

    if (data.isStart) {
        userHistory.push([{ x: data.x, y: data.y }]);
    } else {
        if (userHistory.length === 0) {
            userHistory.push([{ x: data.x, y: data.y }]);
        } else {
            if (data.isEnd) {
                userHistory[userHistory.length - 1].push({ x: data.x, y: data.y });
            } else {
                userHistory[userHistory.length - 1].push({ x: data.x, y: data.y });

                const lastPoint = userHistory[userHistory.length - 1].slice(-2);
                ctx.beginPath();
                ctx.moveTo(lastPoint[0].x, lastPoint[0].y);
                ctx.lineTo(lastPoint[1].x, lastPoint[1].y);
                ctx.strokeStyle = data.color;
                ctx.lineWidth = data.mode === 'erase' ? 10 : 2;
                ctx.stroke();
            }
        }
    }
}

socket.on('drawingStart', (data) => {
    drawingHistory.push({
        line: [{ x: data.startX, y: data.startY }],
        color: data.color,
        mode: data.mode,
        userId: data.userId
    });
    const { userId, startX, startY, mode, color } = data;

    if (!userDrawingHistories[userId]) {
        userDrawingHistories[userId] = [];
    }

    userDrawingHistories[userId].push([{ x: startX, y: startY, mode, color }]);

    lastPositions[userId] = { x: startX, y: startY };
});

socket.on('drawing', (data) => {
    const currentLine = drawingHistory[drawingHistory.length - 1].line;
    currentLine.push({ x: data.x, y: data.y });

    const { userId, x, y, color, mode } = data;

    if (!userDrawingHistories[userId]) {
        userDrawingHistories[userId] = [];
    }

    userDrawingHistories[userId][userDrawingHistories[userId].length - 1].push({ x, y, mode, color });

    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    const lastPoint = userDrawingHistories[userId][userDrawingHistories[userId].length - 1].slice(-2);
    ctx.beginPath();
    ctx.moveTo(lastPoint[0].x, lastPoint[0].y);
    ctx.lineTo(lastPoint[1].x, lastPoint[1].y);
    ctx.strokeStyle = color;
    ctx.lineWidth = mode === 'erase' ? 10 : 2;
    ctx.stroke();

    lastPositions[userId] = { x, y };
});

socket.on('drawingEnd', (data) => {
    const { userId } = data;

    if (!userDrawingHistories[userId]) {
        userDrawingHistories[userId] = [];
    }

    userDrawingHistories[userId].push([]);

    delete lastPositions[userId];
});

socket.on('clearCanvas', function () {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

socket.on('userJoin', function (data) {
    activeRooms[data.room] = (activeRooms[data.room] || 0) + 1;

    io.to(data.room).emit('activeUsersCount', { room: data.room, count: activeRooms[data.room] });

    const currentTime = new Date().getTime();
    if (currentTime > mostRecentUserJoinTimestamp) {
        mostRecentUserJoinTimestamp = currentTime;
        mostRecentUser = data.username;
        isLeastRecentUser = true;
    } else {
        isLeastRecentUser = false;
    }

    if (activeRooms[data.room] === 1) {
        isFirstUser = true;
        io.to(data.room).emit('message', {
            username: 'System',
            color: '#ffffff',
            message: `${data.username} is the first user in the room.`
        });
    }
});

socket.on('userLeave', function (data) {
    if (activeRooms[data.room] > 0) {
        activeRooms[data.room]--;

        io.to(data.room).emit('activeUsersCount', { room: data.room, count: activeRooms[data.room] });

        if (data.username === mostRecentUser) {
            let earliestJoinTimestamp = Infinity;
            let newFirstUser = '';
            for (const [user, joinTime] of Object.entries(activeUsers)) {
                if (joinTime < earliestJoinTimestamp) {
                    earliestJoinTimestamp = joinTime;
                    newFirstUser = user;
                }
            }

            const cursor = document.getElementById(`cursor-${data.userId}`);

            if (cursor) {
                cursor.parentNode.removeChild(cursor);
            }

            firstUserJoinTimestamp = earliestJoinTimestamp;
            firstUser = newFirstUser;

            console.log(`The first person to join the room is now: ${firstUser}`);
        }
    }

    if (activeRooms[data.room] === 0) {
        firstUserJoinTimestamp = 0;
        firstUser = '';

        console.log('No users left in the room.');
    }
});

socket.on('activeRooms', function (data) {
    activeRooms = data.activeRooms;
    activeRoomsVar = activeRooms;
});

socket.on('connection', function (socket) {
    socket.on('activeUsersCount', function (data) {
        io.to(socket.id).emit('activeUsersCount', { room: data.room, count: activeRooms[data.room] });
    });
});

function getActiveRooms() {
    const activeRoomList = Object.keys(activeRooms).filter((room) => activeRooms[room] > 0);
    return activeRoomList;
}

function joinRandomRoom() {
    const publicRooms = Object.keys(activeRooms).filter(roomName => !activeRooms[roomName].isPrivate && activeRooms[roomName].count > 0);

    if (publicRooms.length > 0) {
        const randomRoomIndex = Math.floor(Math.random() * publicRooms.length);
        const randomRoomName = publicRooms[randomRoomIndex];

        console.log('Random Room:', randomRoomName);

        window.location.href = `/${randomRoomName}`;

        socket.emit('joinRandomRoom', { room: randomRoomName });
    } else {
        alert("No available public rooms. Try creating a new one or wait for public rooms to become available.");
    }
}

const saveCanvasImage = () => {
    const canvas = document.getElementById('canvas');
    const dataUrl = canvas.toDataURL();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'image.png';
    a.click();
};

function generateAndJoinRoom() {
    const generatedRoomCode = generateRandomRoomCode();
    window.location.href = `/${generatedRoomCode}`;
}

function generateRandomRoomCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const codeLength = 6;
    let roomCode = '';

    do {
        roomCode = '';
        for (let i = 0; i < codeLength; i++) {
            const randomIndex = Math.floor(Math.random() * characters.length);
            roomCode += characters.charAt(randomIndex);
        }
    } while (activeRooms.hasOwnProperty(roomCode));

    return roomCode;
}

socket.on('activeUsersCount', function (data) {
    updateActiveUsersCount(data.count);
});

socket.on('noAvailableRooms', function(data) {
    alert(data.message);
});

function updateActiveUsersCount(count) {
    const activeUsersCountElement = $('#activeUsersCount');
    activeUsersCountElement.text(`Active Users: ${count}`);
}

function toggleChat() {
    const messages = document.getElementById('messages');
    const toggleChatButton = document.getElementById('toggleChatButton');

    if (messages.style.display === 'none' || messages.style.display === '') {
        messages.style.display = 'block';
        toggleChatButton.style.marginTop = '35vh';
        toggleChatButton.textContent = 'Close Chat';
    } else {
        messages.style.display = 'none';
        toggleChatButton.style.marginTop = '5vh';
        toggleChatButton.textContent = 'Open Chat';
    }
}

function showChat() {
    const content = document.getElementById('content');
    const button = document.getElementById('toggleChatButton');

    $('#m').show();

    button.textContent = 'Close Chat';
}

function hideChat() {
    const content = document.getElementById('content');
    const button = document.getElementById('toggleChatButton');

    $('#m').hide();
}

document.querySelector('.canvas-container').addEventListener('mousedown', function(e) {
    if (mode === 'draw' || mode === 'erase') {
        e.preventDefault();
        draw(e.touches[0]);
    }

    if (mode !== 'scroll') return;
    const container = this;
    let startX = e.pageX - container.offsetLeft;
    let startY = e.pageY - container.offsetTop;
    let scrollLeft = container.scrollLeft;
    let scrollTop = container.scrollTop;

    function onMouseMove(e) {
        const dx = e.pageX - container.offsetLeft - startX;
        const dy = e.pageY - container.offsetTop - startY;
        container.scrollLeft = scrollLeft - dx;
        container.scrollTop = scrollTop - dy;
    }

    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
},  { passive: false });

document.querySelector('.canvas-container').addEventListener('touchstart', function(e) {
    if (mode !== 'scroll') return;
    e.preventDefault();

    const container = this;
    const touchStartX = e.touches[0].pageX - container.offsetLeft;
    const touchStartY = e.touches[0].pageY - container.offsetTop;
    let scrollLeft = container.scrollLeft;
    let scrollTop = container.scrollTop;

    function onTouchMove(e) {
        e.preventDefault();
        const touchX = e.touches[0].pageX - container.offsetLeft;
        const touchY = e.touches[0].pageY - container.offsetTop;
        const dx = touchX - touchStartX;
        const dy = touchY - touchStartY;
        container.scrollLeft = scrollLeft - dx;
        container.scrollTop = scrollTop - dy;
    }

    function onTouchEnd() {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
    }

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: false });
}, { passive: false });

document.getElementById('canvas').addEventListener('wheel', function(e) {
    if (mode !== 'zoom') return;
    e.preventDefault();
    const scaleAmount = e.deltaY * -0.01;
});

// Listen for keyboard shortcuts
document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'z') {
        event.preventDefault();
        undo();
    }

    if (event.ctrlKey && event.key === 'y') {
        event.preventDefault();
        redo();
    }
});

// Clear canvas event
socket.on('clearCanvas', function () {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawingHistory = [];
});

function setMode(newMode) {
    console.log("Setting mode to:", newMode);
    mode = newMode;

    if (mode === 'draw') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineWidth = 2;
        canvas.style.cursor = 'crosshair';
    } else if (mode === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = 10;
        canvas.style.cursor = 'crosshair';
    } else if (mode === 'scroll') {
        canvas.style.cursor = 'grab';
    }

    document.querySelectorAll('.mode-button').forEach(button => {
        button.classList.remove('active');
    });
    document.getElementById(newMode + 'Button').classList.add('active');
}

$('#publicToggle').on('change', function() {
    const isPrivate = $(this).is(':checked');
    socket.emit('privacyToggle', { room, isPrivate });
});

socket.on('updatePrivacy', function(data) {
    const { isPrivate } = data;
    $('#publicToggle').prop('checked', isPrivate);
});

document.getElementById('drawButton').addEventListener('click', () => setMode('draw'));
document.getElementById('scrollButton').addEventListener('click', () => setMode('scroll'));
document.getElementById('eraseButton').addEventListener('click', () => setMode('erase'));
document.getElementById('donateButton').addEventListener('click', () => window.location.href = 'https://www.buymeacoffee.com/multipaint');
document.getElementById('privacyButton').addEventListener('click', () => window.location.href = '/privacy');
document.getElementById('joinRoomButton').addEventListener('click', joinRoom);

document.getElementById('generateRoomButton').addEventListener('click', generateAndJoinRoom);
document.getElementById('joinRandomRoomButton').addEventListener('click', joinRandomRoom);
document.getElementById('updateSettingsButton').addEventListener('click', updateSettings);
document.getElementById('toggleChatButton').addEventListener('click', toggleChat);
document.getElementById('clearCanvasButton').addEventListener('click', clearCanvas);
document.getElementById('saveCanvasButton').addEventListener('click', saveCanvasImage);
document.getElementById('backToMenuButton').addEventListener('click', () => window.location.href = '/');

function undo() {
    socket.emit('undo');
}

function redo() {
    socket.emit('redo');
}

document.getElementById('undoButton').addEventListener('click', (event) => {
    event.preventDefault();
    undo();
});

document.getElementById('redoButton').addEventListener('click', (event) => {
    event.preventDefault();
    redo();
});

socket.on('undo', (data) => {
    drawingHistory = Array.isArray(data.drawingHistory) ? data.drawingHistory : [];
    redrawCanvas(drawingHistory);
});

socket.on('redo', (data) => {
    drawingHistory = Array.isArray(data.drawingHistory) ? data.drawingHistory : [];
    redrawCanvas(drawingHistory);
});

socket.on('updateCanvas', (data) => {
    redrawCanvas(data.drawingHistory);
});

function redrawCanvas(drawingHistory) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawingHistory.forEach(action => {
        if (action.type === 'drawingStart') {
            ctx.beginPath();
            ctx.moveTo(action.data.startX, action.data.startY);
        } else if (action.type === 'drawing') {
            ctx.lineTo(action.data.x, action.data.y);
            ctx.strokeStyle = action.data.color;
            ctx.lineWidth = action.data.mode === 'erase' ? 10 : 2;
            ctx.globalCompositeOperation = action.data.mode === 'erase' ? 'destination-out' : 'source-over';
            ctx.stroke();
        } else if (action.type === 'drawingEnd') {
            ctx.closePath();
        }
    });
}

// Add the following code to disable drawing when mode or undo/redo buttons are pressed
const modeButtons = document.querySelectorAll('.mode-button');
const actionButtons = document.querySelectorAll('#undoButton, #redoButton');

modeButtons.forEach(button => {
    button.addEventListener('mousedown', (event) => {
        setDrawingActive(false);
    });

    button.addEventListener('mouseup', (event) => {
        setDrawingActive(true);
    });
});

actionButtons.forEach(button => {
    button.addEventListener('mousedown', (event) => {
        setDrawingActive(false);
    });

    button.addEventListener('mouseup', (event) => {
        setDrawingActive(true);
    });
});
