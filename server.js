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
let activeRooms = {};
const roomCanvases = {}; // Store canvas state for each room
const drawingStates = {};  // Declare drawingStates variable here
const chatMessages = {};
const activeUsers = {};
let roomUserActions = {}; // { room: { userId: [actions] } }
let userRedoStacks = {}; // { room: { userId: [redoActions] } }
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

        // Initialize room details if not already done
        if (!activeRooms[room]) {
            activeRooms[room] = {
                isPrivate: true, // Initialize the privacy setting as false by default
                count: 0 // Initialize user count
                // You can add more room details here as needed
            };
        }

        // Increment the user count for the joined room
        activeRooms[room].count++;

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
    
    // 'drawingStart' event handler modification
    socket.on('drawingStart', (data) => {
        const { room, startX, startY, color, mode } = data; // Include 'mode' to distinguish between drawing and erasing

        if (!drawingStates[room]) {
            drawingStates[room] = {};
        }
        
        if (!roomCanvases[room]) {
            roomCanvases[room] = [];
        }
        
        // Ensure the room and user structures are initialized
        if (!roomUserActions[room]) {
            roomUserActions[room] = {};
        }
        
        if (!roomUserActions[room][socket.id]) {
            roomUserActions[room][socket.id] = [];
        }
        
        roomCanvases[room].push({ userId: socket.id, type: 'drawingStart', data: { startX, startY, mode }}); // Include mode in saved data
        
        drawingStates[room][socket.id] = { drawing: true, path: [{ x: startX, y: startY }], mode }; // Track mode state
        
        roomUserActions[room][socket.id].push({
            type: 'drawing',
            data: { startX, startY, color, mode }
        });

        
        // Emit the 'drawingStart' event with user identifier and mode
        io.to(room).emit('drawingStart', { userId: socket.id, startX, startY, mode });
    });
    
    socket.on('drawing', (data) => {
        const { room, x, y, color, mode } = data;

        if (mode === 'erase') {
            if (!roomCanvases[room]) {
                roomCanvases[room] = [];
            }

            if (!roomUserActions[room]) {
                roomUserActions[room] = {};
            }
            
            if (!roomUserActions[room][socket.id]) {
                roomUserActions[room][socket.id] = [];
            }
            
            roomUserActions[room][socket.id].push({
                type: 'drawing',
                data: { x, y, color, mode }
            });
            
            // Save the erasing action
            roomCanvases[room].push({ type: 'drawing', data: { x, y, color, mode } });

            // Emit erasing data to all clients in the room including the one who performed the erase
            io.in(room).emit('drawing', { userId: socket.id, x, y, color, mode });
        } else {
            
            if (!roomCanvases[room]) {
                roomCanvases[room] = [];
            }
            
            if (!roomUserActions[room][socket.id]) {
                roomUserActions[room][socket.id] = {};
            }
            
            if (!roomUserActions[room][socket.id]) {
                roomUserActions[room][socket.id] = [];
            }
            
            roomUserActions[room][socket.id].push({
                type: 'drawing',
                data: { x, y, color, mode }
            });
            
            //roomCanvases[room].push({ userId: socket.id, type: 'drawing', data: { x, y, color, mode }}); // Save the drawing action
            //roomUserActions[room].push({ ...data, type: 'drawing' });
            userRedoStacks[room] = [];
            
            // Save the drawing or erasing action
            roomCanvases[room].push({ type: 'drawing', data: { x, y, color, mode } });
            
            // Emit to all clients in the room including the drawer
            io.in(room).emit('drawing', { userId: socket.id, x, y, color, mode });
        }
    });

    socket.on('drawingEnd', (data) => {
        const { room } = data;
        
        if (drawingStates[room] && drawingStates[room][socket.id]) {
            delete drawingStates[room][socket.id];
        }
        
        if (!roomCanvases[room]) {
            roomCanvases[room] = [];
        }
        
        if (roomUserActions[room] && roomUserActions[room][socket.id]) {
            roomUserActions[room][socket.id].push({
                type: 'drawingEnd'
            });
        }
        
        roomCanvases[room].push({ userId: socket.id, type: 'drawingEnd' });

        // Emit the 'drawingEnd' event with user identifier
        io.to(room).emit('drawingEnd', { userId: socket.id });
    });

    // 'clearCanvas' event handler (for completeness, though not directly related to multi-user drawing logic)
    socket.on('clearCanvas', (data) => {
        const { room } = data;
        roomCanvases[room] = []; // Clear stored canvas data for the room
        io.to(room).emit('clearCanvas'); // Notify all clients in the room to clear their canvases
    });
    
    socket.on('undo', function(data) {
        const { room, userId } = data;
        if (roomUserActions[room][userId] && roomUserActions[room][userId].length > 0) {
            const actionToUndo = roomUserActions[room][userId].pop();
            userRedoStacks[room][userId].push(actionToUndo);
            io.to(room).emit('undoAction', { userId, action: actionToUndo });
        }
    });

    socket.on('redo', (data) => {
        const { room, userId } = data;
        if (userRedoStacks[room][userId].length > 0) {
            const action = userRedoStacks[room][userId].pop();
            roomUserActions[room][userId].push(action); // Re-add the action to the main history
            socket.to(room).emit('redoAction', { userId, action }); // Broadcast redo action to other clients
            redrawCanvasOnServer(room); // Optional: Maintain server-side state consistency
        }
    });
    
    socket.on('cursorMove', (data) => {
        const user = users[socket.id];
        if(user) {
            // Emit cursor movement event to all users except the sender (local user)
            socket.broadcast.to(user.room).emit('cursorMove', { userId: socket.id, position: data.position, color: user.color });
        }
    });
    
    socket.on('restoreCanvas', (data) => {
        const { room } = data;
        if (roomCanvases[room]) {
            roomCanvases[room].forEach((userDrawing) => {
                userDrawing.actions.forEach((action) => {
                    socket.emit(action.type, action.data);
                });
            });
        }
    });

    socket.on('activeRooms', function(data) {
        activeRooms = data.activeRooms; // Update the local activeRooms object based on server data
    });

    socket.on('activeRoomsUpdate', function(rooms) {
        // Update UI with active rooms
        updateActiveRoomList(rooms);
    });
    
    socket.on('noAvailableRooms', function(data) {
        alert(data.message);  // Alert the user that no rooms are available for joining
    });
    
    socket.on('privacyToggle', (data) => {
        const { room, isPrivate } = data;
        if (activeRooms[room]) {
            activeRooms[room].isPrivate = isPrivate;
            io.in(room).emit('updatePrivacy', { isPrivate });
            io.emit('activeRooms', { activeRooms }); // Optionally update all clients about the change
        }
    });

    socket.on('joinRandomRoom', () => {
        // Ensure we are filtering correctly based on room details
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
            delete drawingStates[user.room][socket.id]; // Clean up user's drawing state
            if (activeRooms[user.room]) {
                // Decrement the user count for the left room
                activeRooms[user.room].count--;

                // Emit the updated user count to all clients in the room
                io.to(user.room).emit('activeUsersCount', { room: user.room, count: activeRooms[user.room].count });

                // Emit the 'userLeave' event to all clients in the room to remove the cursor
                io.to(user.room).emit('userLeave', { userId: socket.id });

                if (activeRooms[user.room].count <= 0) {
                    // Remove the room if no users are left
                    delete activeRooms[user.room];
                    roomCanvases[user.room] = [];
                    chatMessages[user.room] = [];
                } else {
                    // Emit a system message if users are still in the room
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

            // Update the active rooms list for all clients
            io.emit('activeRooms', { activeRooms });

            // Remove the user's cursor element if it exists
            if (cursors[socket.id]) {
                cursors[socket.id].remove(); // Remove cursor element from the DOM
                delete cursors[socket.id]; // Remove cursor element reference from the cursors object
            }

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
