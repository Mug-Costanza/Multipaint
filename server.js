const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(bodyParser.json());

// Serve static files from the 'build' directory
app.use(express.static(path.join(__dirname, 'build')));

// Add the privacy route before the catch-all route ('*')
app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

// The '/:room' route
app.get('/:room', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Catch-all route for other routes, serve the 'index.html' file
app.get('/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const users = {};
let activeRooms = {};
const roomCanvases = {}; // Store canvas state for each room
const drawingStates = {}; // Declare drawingStates variable here
const chatMessages = {};
const activeUsers = {};
const roomUserActions = {}; // { room: { userId: [actions] } }
const userRedoStacks = {}; // { room: { userId: [redoActions] } }
const cursors = {};

let isDrawing = false;

const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds

io.on('connection', (socket) => {
    activeUsers[socket.id] = Date.now();
    
    io.emit('activeRooms', { activeRooms });
    
    // Function to check and handle inactivity
    const checkInactivity = () => {
        const now = Date.now();
        const lastActivity = activeUsers[socket.id];
        if (now - lastActivity > INACTIVITY_TIMEOUT) {
            // User has been inactive for more than 10 minutes
            // Emit a message to the client about being kicked for being AFK
            socket.emit('kickedForAFK', { message: 'You have been kicked for being inactive.' });

            // Disconnect the socket
            socket.disconnect(true);
        }
    };
    
    socket.on('join', (data) => {
        const { room, userId, username, color } = data;

        socket.join(room);

        users[socket.id] = { username, color, room };

        if (!roomUserActions[room]) {
            roomUserActions[room] = {};
        }

        if (!roomUserActions[room][userId]) {
            roomUserActions[room][userId] = [];
        }

        if (!userRedoStacks[room]) {
            userRedoStacks[room] = {};
        }

        if (!userRedoStacks[room][userId]) {
            userRedoStacks[room][userId] = [];
        }

        activeUsers[socket.id] = Date.now();

        // Initialize room details if not already done
        if (!activeRooms[room]) {
            activeRooms[room] = {
                isPrivate: true, // Initialize the privacy setting as false by default
                count: 0 // Initialize user count
            };
        }

        // Increment the user count for the joined room
        activeRooms[room].count++;

        // Send existing canvas data to the newly joined user
        if (roomCanvases[room]) {
            roomCanvases[room].forEach(item => {
                socket.emit(item.type, { ...item.data, userId: item.userId });
            });
        }

        // Always send previous chat messages to the newly joined user
        if (chatMessages[data.room]) {
            chatMessages[data.room].forEach((message) => {
                io.to(socket.id).emit('message', message);
            });
        }

        // Initialize drawing state for the user in the room
        if (!drawingStates[data.room]) {
            drawingStates[data.room] = {};
        }

        drawingStates[data.room][socket.id] = {
            drawing: false,
            lastX: 0,
            lastY: 0,
        };

        // Emit the updated user count to all clients in the room
        io.in(room).emit('activeUsersCount', { room, count: activeRooms[room].count });

        io.to(data.room).emit('message', {
            username: 'System',
            color: 'white',
            message: `<span style="color: ${color}">${username}</span> has joined the room!`,
        });

        // Store the system message for future users
        const systemMessage = {
            username: 'System',
            color: 'white',
            message: `<span style="color: ${color}">${username}</span> has joined the room!`,
        };

        chatMessages[data.room] = chatMessages[data.room] || [];
        chatMessages[data.room].push(systemMessage);

        // Emit the privacy setting only to the newly joined user
        socket.emit('updatePrivacy', { isPrivate: activeRooms[room].isPrivate });
    });
    
    socket.on('message', (data) => {
        io.to(data.room).emit('message', data);
        io.emit('activeRooms', { activeRooms });
        
        // Store chat messages for each room
        chatMessages[data.room] = chatMessages[data.room] || [];
        chatMessages[data.room].push(data);
        
        // Update user's last activity timestamp when they send a message
        activeUsers[socket.id] = Date.now();
    });
    
    const inactivityCheckInterval = setInterval(checkInactivity, 1000); // Check every second
    
    socket.on('drawingStart', (data) => {
        const { room, startX, startY, color, mode } = data;

        if (!drawingStates[room]) {
            drawingStates[room] = {};
        }

        if (!roomCanvases[room]) {
            roomCanvases[room] = [];
        }

        roomCanvases[room].push({ userId: socket.id, type: 'drawingStart', data: { startX, startY, mode, color } });

        drawingStates[room][socket.id] = { drawing: true, path: [{ x: startX, y: startY }], mode };

        io.to(room).emit('drawingStart', { userId: socket.id, startX, startY, mode, color });
    });

    socket.on('drawing', (data) => {
        const { room, x, y, color, mode } = data;

        if (!drawingStates[room] || !drawingStates[room][socket.id]) {
            return;
        }

        drawingStates[room][socket.id].path.push({ x, y });

        if (!roomCanvases[room]) {
            roomCanvases[room] = [];
        }

        roomCanvases[room].push({ userId: socket.id, type: 'drawing', data: { x, y, color, mode } });

        io.to(room).emit('drawing', { userId: socket.id, x, y, color, mode });
    });

    socket.on('drawingEnd', (data) => {
        const { room } = data;

        if (!drawingStates[room] || !drawingStates[room][socket.id]) {
            return;
        }

        drawingStates[room][socket.id].drawing = false;

        if (!roomCanvases[room]) {
            roomCanvases[room] = [];
        }

        roomCanvases[room].push({ userId: socket.id, type: 'drawingEnd' });

        io.to(room).emit('drawingEnd', { userId: socket.id });
    });

    socket.on('clearCanvas', (data) => {
        const { room } = data;
        roomCanvases[room] = [];
        io.to(room).emit('clearCanvas');
    });
    
    socket.on('cursorMove', (data) => {
        const user = users[socket.id];
        if(user) {
            socket.broadcast.to(user.room).emit('cursorMove', { userId: socket.id, position: data.position, color: user.color });
        }
    });
    
    socket.on('restoreCanvas', (data) => {
        const { room } = data;
        if (roomCanvases[room]) {
            roomCanvases[room].forEach((userDrawing) => {
                socket.emit(userDrawing.type, userDrawing.data);
            });
        }
    });

    socket.on('activeRooms', function(data) {
        activeRooms = data.activeRooms;
    });

    socket.on('activeRoomsUpdate', function(rooms) {
        updateActiveRoomList(rooms);
    });
    
    socket.on('noAvailableRooms', function(data) {
        alert(data.message);
    });
    
    socket.on('privacyToggle', (data) => {
        const { room, isPrivate } = data;
        if (activeRooms[room]) {
            activeRooms[room].isPrivate = isPrivate;
            io.in(room).emit('updatePrivacy', { isPrivate });
            io.emit('activeRooms', { activeRooms });
        }
    });

    socket.on('joinRandomRoom', () => {
        const publicRooms = Object.keys(activeRooms).filter(roomName => !activeRooms[roomName].isPrivate && activeRooms[roomName].count > 0);

        if (publicRooms.length > 0) {
            const randomRoomName = publicRooms[Math.floor(Math.random() * publicRooms.length)];
            socket.join(randomRoomName);
            socket.emit('joinRoom', { room: randomRoomName });
        } else {
            socket.emit('noAvailableRooms', { message: "No available public rooms. Try creating a new one or wait for public rooms to become available." });
        }
    });

    socket.on('updateDrawingHistory', (drawingHistory) => {
        const { room } = users[socket.id];
        roomUserActions[room][socket.id] = drawingHistory;
        io.to(room).emit('drawingHistory', drawingHistory);
    });
    
    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user && drawingStates[user.room]) {
            delete drawingStates[user.room][socket.id];
            if (activeRooms[user.room]) {
                activeRooms[user.room].count--;

                io.to(user.room).emit('activeUsersCount', { room: user.room, count: activeRooms[user.room].count });

                io.to(user.room).emit('userLeave', { userId: socket.id });

                if (activeRooms[user.room].count <= 0) {
                    delete activeRooms[user.room];
                    roomCanvases[user.room] = [];
                    chatMessages[user.room] = [];
                } else {
                    io.to(user.room).emit('message', {
                        username: 'System',
                        color: 'white',
                        message: `<span style="color: ${user.color}">${user.username}</span> has left the room.`,
                    });

                    const systemMessage = {
                        username: 'System',
                        color: 'white',
                        message: `<span style="color: ${user.color}">${user.username}</span> has left the room.`,
                    };

                    chatMessages[user.room] = chatMessages[user.room] || [];
                    chatMessages[user.room].push(systemMessage);
                }
            }

            io.emit('activeRooms', { activeRooms });

            if (cursors[socket.id]) {
                cursors[socket.id].remove();
                delete cursors[socket.id];
            }

            delete users[socket.id];
        }

        delete activeUsers[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

