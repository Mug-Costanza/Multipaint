const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'build')));

app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get('/:room', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.get('/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const users = {};
let activeRooms = {};
const roomCanvases = {};
const drawingStates = {};
const chatMessages = {};
const activeUsers = {};
const roomUserActions = {};
const userRedoStacks = {};
const cursors = {};
const userDrawingHistory = {};
const userUndoStacks = {};

const INACTIVITY_TIMEOUT = 10 * 60 * 1000;

io.on('connection', (socket) => {
    activeUsers[socket.id] = Date.now();
    
    io.emit('activeRooms', { activeRooms });

    const checkInactivity = () => {
        const now = Date.now();
        const lastActivity = activeUsers[socket.id];
        if (now - lastActivity > INACTIVITY_TIMEOUT) {
            socket.emit('kickedForAFK', { message: 'You have been kicked for being inactive.' });
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

            if (!userRedoStacks[socket.id]) {
                userRedoStacks[socket.id] = [];  // Ensure redo stack is initialized
            }

            if (!userUndoStacks[socket.id]) {
                userUndoStacks[socket.id] = [];  // Ensure undo stack is initialized
            }

            activeUsers[socket.id] = Date.now();

            if (!activeRooms[room]) {
                activeRooms[room] = {
                    isPrivate: true,
                    count: 0
                };
            }

            activeRooms[room].count++;

            if (!roomCanvases[room]) {
                roomCanvases[room] = [];
            }

            if (roomCanvases[room]) {
                roomCanvases[room].forEach(item => {
                    socket.emit(item.type, { ...item.data, userId: item.userId });
                });
            }

            if (chatMessages[data.room]) {
                chatMessages[data.room].forEach((message) => {
                    io.to(socket.id).emit('message', message);
                });
            }

            if (!drawingStates[data.room]) {
                drawingStates[data.room] = {};
            }

            drawingStates[data.room][socket.id] = {
                drawing: false,
                lastX: 0,
                lastY: 0,
            };

            io.in(room).emit('activeUsersCount', { room, count: activeRooms[room].count });

            io.to(data.room).emit('message', {
                username: 'System',
                color: 'white',
                message: `<span style="color: ${color}">${username}</span> has joined the room!`,
            });

            const systemMessage = {
                username: 'System',
                color: 'white',
                message: `<span style="color: ${color}">${username}</span> has joined the room!`,
            };

            chatMessages[data.room] = chatMessages[data.room] || [];
            chatMessages[data.room].push(systemMessage);

            socket.emit('updatePrivacy', { isPrivate: activeRooms[room].isPrivate });
        });
    
    socket.on('message', (data) => {
        io.to(data.room).emit('message', data);
        io.emit('activeRooms', { activeRooms });
        
        chatMessages[data.room] = chatMessages[data.room] || [];
        chatMessages[data.room].push(data);
        
        activeUsers[socket.id] = Date.now();
    });
    
    const inactivityCheckInterval = setInterval(checkInactivity, 1000);

    socket.on('drawingStart', (data) => {
            const { room, startX, startY, color, mode } = data;

            if (!userDrawingHistory[socket.id]) {
                userDrawingHistory[socket.id] = [];
                userUndoStacks[socket.id] = [];
                userRedoStacks[socket.id] = [];
            }

            if (!roomCanvases[room]) {
                roomCanvases[room] = [];
            }

            const action = { userId: socket.id, type: 'drawingStart', data: { startX, startY, mode, color } };
            roomCanvases[room].push(action);
            userDrawingHistory[socket.id].push([action]); // Initialize a new action array

            // Clear redo stack on new action
            userRedoStacks[socket.id] = [];

            if (!drawingStates[room]) {
                drawingStates[room] = {};
            }

            drawingStates[room][socket.id] = { drawing: true, path: [{ x: startX, y: startY }], mode };

            io.to(room).emit('drawingStart', { userId: socket.id, startX, startY, mode, color });
        });

    socket.on('drawing', (data) => {
        const { room, x, y, color, mode } = data;

        if (!drawingStates[room] || !drawingStates[room][socket.id]) {
            return;
        }

        if (!roomCanvases[room]) {
            roomCanvases[room] = [];
        }

        drawingStates[room][socket.id].path.push({ x, y });

        const action = { userId: socket.id, type: 'drawing', data: { x, y, color, mode } };
        roomCanvases[room].push(action);
        userDrawingHistory[socket.id][userDrawingHistory[socket.id].length - 1].push(action); // Add to the current action

        io.to(room).emit('drawing', { userId: socket.id, x, y, color, mode });
    });

    socket.on('drawingEnd', (data) => {
        const { room } = data;

        if (!drawingStates[room] || !drawingStates[room][socket.id]) {
            return;
        }

        if (!roomCanvases[room]) {
            roomCanvases[room] = [];
        }

        drawingStates[room][socket.id].drawing = false;

        const action = { userId: socket.id, type: 'drawingEnd' };
        roomCanvases[room].push(action);
        userDrawingHistory[socket.id][userDrawingHistory[socket.id].length - 1].push(action); // Add to the current action

        io.to(room).emit('drawingEnd', { userId: socket.id });

        // Push the complete action to the undo stack
        userUndoStacks[socket.id] = userUndoStacks[socket.id] || [];
        userUndoStacks[socket.id].push(userDrawingHistory[socket.id].pop());
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

    socket.on('undo', (data) => {
           const user = users[socket.id];
           const room = user.room;

           if (userUndoStacks[socket.id] && userUndoStacks[socket.id].length > 0) {
               const actions = userUndoStacks[socket.id].pop();
               userRedoStacks[socket.id] = userRedoStacks[socket.id] || [];
               userRedoStacks[socket.id].push(actions);

               // Remove the actions from the room canvas
               actions.forEach(action => {
                   const index = roomCanvases[room].indexOf(action);
                   if (index !== -1) {
                       roomCanvases[room].splice(index, 1);
                   }
               });

               // Broadcast the new canvas state to the room
               io.to(room).emit('updateCanvas', { drawingHistory: roomCanvases[room] });
           }
       });

       socket.on('redo', (data) => {
           const user = users[socket.id];
           const room = user.room;

           if (userRedoStacks[socket.id] && userRedoStacks[socket.id].length > 0) {
               const actions = userRedoStacks[socket.id].pop();
               userUndoStacks[socket.id] = userUndoStacks[socket.id] || [];
               userUndoStacks[socket.id].push(actions);

               // Add the actions back to the room canvas
               actions.forEach(action => {
                   roomCanvases[room].push(action);
               });

               // Broadcast the new canvas state to the room
               io.to(room).emit('updateCanvas', { drawingHistory: roomCanvases[room] });
           }
       });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});


