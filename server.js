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
})

// The '/:room' route
app.get('/:room', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Catch-all route for other routes, serve the 'index.html' file
app.get('/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const users = {};
let activeRooms = [];
const roomCanvases = {}; // Store canvas state for each room
const drawingStates = {};  // Declare drawingStates variable here
const chatMessages = {};
const activeUsers = {};
let roomUserActions = {}; // { room: { userId: [actions] } }
let userRedoStacks = {}; // { room: { userId: [redoActions] } }

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

            // Redirect the user to multipaint.net or the main menu
            // socket.emit('redirect', { url: 'https://multipaint.net' }); // Change the URL as needed

            // Disconnect the socket
            socket.disconnect(true);
        }
    };
    
    socket.on('join', (data) => {
        const { room, userId, username, color } = data;

        socket.join(room);

        users[socket.id] = { username, color, room };
        
        // Initialize if not already done
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

        if (!activeRooms.includes(room)) {
            activeRooms.push(room);
        }
        
        if (!drawingStates[data.room]) {
            drawingStates[data.room] = {};
        }
        
        drawingStates[data.room][socket.id] = { drawing: false, lastX: null, lastY: null };

        io.emit('activeRooms', { activeRooms });

        // Increment the user count for the joined room
        activeRooms[room] = (activeRooms[room] || 0) + 1;

        // Send existing canvas data to the newly joined user
        if (roomCanvases[room]) {
            roomCanvases[room].forEach(item => {
                // Emit the action to only the newly joined socket
                socket.emit(item.type, item.data);
            });
        }

        // Always send previous chat messages to the newly joined user
        if (chatMessages[data.room]) {
            chatMessages[data.room].forEach((message) => {
                io.to(socket.id).emit('message', message); // Send previous messages to the joining user
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
        io.in(room).emit('activeUsersCount', { room, count: activeRooms[room] });

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
    
    // 'drawingStart' event handler modification
    socket.on('drawingStart', (data) => {
        const { room, startX, startY } = data;

        // Ensure the drawing state is correctly initialized for the user and room
        if (!drawingStates[room]) {
            drawingStates[room] = {};
        }
        
        if (!roomCanvases[room]) {
            roomCanvases[room] = [];
        }
        
        roomCanvases[room].push({ userId: socket.id, type: 'drawingStart', data: { startX, startY }});
        
        drawingStates[room][socket.id] = { drawing: true, path: [{ x: startX, y: startY }] };

        // Emit the 'drawingStart' event with user identifier
        io.to(room).emit('drawingStart', { userId: socket.id, startX, startY });
    });

    socket.on('drawing', (data) => {
        const { room, userId, x, y, color } = data;

        if (!roomCanvases[room]) {
            roomCanvases[room] = [];
        }
        
        // Save the drawing action for the user
                if (!roomUserActions[room][userId]) {
                    roomUserActions[room][userId] = [];
                }

        // Append new drawing action to the room's canvas state
        roomCanvases[room].push({ userId: socket.id, type: 'drawing', data: { x, y, color }});
        roomUserActions[room][userId].push(data);
        userRedoStacks[room][userId] = [];
        
        io.emit('activeRooms', { activeRooms });

        // Emit the 'drawing' event with user identifier and drawing data
        io.to(room).emit('drawing', { userId: socket.id, x, y, color });
    });

    // 'drawingEnd' event handler modification
    socket.on('drawingEnd', (data) => {
        const { room } = data;
        
        // Clear the user's drawing state
        if (drawingStates[room] && drawingStates[room][socket.id]) {
            delete drawingStates[room][socket.id];
        }
        
        if (!roomCanvases[room]) {
            roomCanvases[room] = [];
        }
        
        roomCanvases[room].push({ userId: socket.id, type: 'drawingEnd', data: {  }});

        drawingStates[room][socket.id] = { drawing: false };
        
        // Emit the 'drawingEnd' event with user identifier
        io.to(room).emit('drawingEnd', {  });
    });

    // 'clearCanvas' event handler (for completeness, though not directly related to multi-user drawing logic)
    socket.on('clearCanvas', (data) => {
        const { room } = data;
        roomCanvases[room] = []; // Clear stored canvas data for the room
        io.to(room).emit('clearCanvas'); // Notify all clients in the room to clear their canvases
    });
    
    socket.on('undo', (data) => {
        const { room, userId } = data;
        if (roomUserActions[room] && roomUserActions[room][userId] && roomUserActions[room][userId].length > 0) {
            // Pop the last action for the user
            const actionToUndo = roomUserActions[room][userId].pop();
            // Add it to the redo stack
            if (!userRedoStacks[room][userId]) userRedoStacks[room][userId] = [];
            userRedoStacks[room][userId].push(actionToUndo);
            // Emit an event to all clients to undo the action visually
            io.in(room).emit('undoAction', { userId, actionToUndo });
        }
    });

    socket.on('redo', (data) => {
        const { room, userId } = data;

                if (userRedoStacks[room] && userRedoStacks[room][userId] && userRedoStacks[room][userId].length > 0) {
                    // Remove the last action from the redo stack and add it back to the actions for the user
                    const action = userRedoStacks[room][userId].pop();
                    roomUserActions[room][userId].push(action);

                    // Emit an event to all clients to update their canvas accordingly
                    io.in(room).emit('redo', { userId, action });
                }
    });
    
    socket.on('cursorMove', (data) => {
        const user = users[socket.id];
        if(user) {
            io.to(user.room).emit('cursorMove', { userId: socket.id, position: data.position, color: user.color });
        }
    });
    
    socket.on('restoreCanvas', (data) => {
        const { room } = data;
        // Ensure roomCanvases[room] is initialized and not undefined
        if (roomCanvases[room] && roomCanvases[room].length > 0) {
            roomCanvases[room].forEach((item) => {
                // Emit each drawing action to the requesting socket
                io.to(socket.id).emit(item.type, item.data);
            });
        }
    });

    socket.on('activeRooms', function (data) {
        activeRooms = data.activeRooms;
        console.log('Updated active rooms:', activeRooms);
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user && drawingStates[user.room]) {
            delete drawingStates[user.room][socket.id]; // Clean up user's drawing state
            if (activeRooms.includes(user.room)) {
                // Decrement the user count for the left room
                activeRooms[user.room] = (activeRooms[user.room] || 0) - 1;
                
                // Emit the updated user count to all clients in the room
                io.to(user.room).emit('activeUsersCount', { room: user.room, count: activeRooms[user.room] });
                
                // Emit the 'userLeave' event to all clients in the room to remove the cursor
                io.to(user.room).emit('userLeave', { userId: socket.id });
                
                if (activeRooms[user.room] <= 0) {
                    activeRooms = activeRooms.filter((room) => room !== user.room);
                    
                    roomCanvases[user.room] = [];
                    chatMessages[user.room] = [];
                } else {
                    // Check if user.room is defined before emitting the message
                    if (user.room) {
                        io.to(user.room).emit('message', {
                        username: 'System',
                        color: 'white',
                        message: `<span style="color: ${user.color}">${user.username}</span> has left the room.`,
                        });
                        
                        // Store the system message for future users
                        const systemMessage = {
                        username: 'System',
                        color: 'white',
                        message: `<span style="color: ${user.color}">${user.username}</span> has left the room.`,
                        };
                        
                        chatMessages[user.room] = chatMessages[user.room] || [];
                        chatMessages[user.room].push(systemMessage);
                    }
                }
            }
            
            io.emit('activeRooms', { activeRooms });
            
            delete users[socket.id];
        }
        
        // Remove the user from the activeUsers object upon disconnection
        delete activeUsers[socket.id];
        // No need to clear inactivityCheckInterval here because it is cleared when the socket disconnects
    });
    
    });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
