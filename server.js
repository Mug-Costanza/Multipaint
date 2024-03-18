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
let activeRooms = [];
const roomCanvases = {}; // Store canvas state for each room
const drawingStates = {};  // Declare drawingStates variable here
const chatMessages = {};
const activeUsers = {};

let isDrawing = false;

const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds

io.on('connection', (socket) => {
    
    activeUsers[socket.id] = Date.now();
    
    // Function to check and handle inactivity
    const checkInactivity = () => {
        const now = Date.now();
        const lastActivity = activeUsers[socket.id];
        if (now - lastActivity > INACTIVITY_TIMEOUT) {
            // User has been inactive for more than 10 minutes
            // Emit a message to the client about being kicked for being AFK
            socket.emit('kickedForAFK', { message: 'You have been kicked for being inactive.' });

            // Redirect the user to multipaint.net or the main menu
            socket.emit('redirect', { url: 'https://multipaint.net' }); // Change the URL as needed

            // Disconnect the socket
            socket.disconnect(true);
        }
    };
    
    socket.on('join', (data) => {
        const { room, username, color } = data;

        socket.join(room);

        users[socket.id] = { username, color, room };
        
        activeUsers[socket.id] = Date.now();

        if (!activeRooms.includes(room)) {
            activeRooms.push(room);
        }

        io.emit('activeRooms', { activeRooms });

        // Increment the user count for the joined room
        activeRooms[room] = (activeRooms[room] || 0) + 1;

        // Always send existing canvas data to the newly joined user
        if (roomCanvases[data.room]) {
            roomCanvases[data.room].forEach((item) => {
                io.to(socket.id).emit(item.type, item.data);
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
    
    // Modify the 'drawingStart' event handler
    socket.on('drawingStart', (data) => {
        const { room } = data;
        const user = users[socket.id];

        // Initialize a drawing path for the current user if it doesn't exist
        drawingStates[room] = drawingStates[room] || {};
        drawingStates[room][socket.id] = {
            drawing: true,
            path: [{ x: data.startX, y: data.startY }] // Start a new path
        };

        // Emit the drawing start event to all clients in the room
        io.to(room).emit('drawingStart', data);

        // Store drawing data in roomCanvases
        roomCanvases[room] = roomCanvases[room] || [];
        roomCanvases[room].push({ type: 'drawingStart', data });

        io.emit('activeRooms', { activeRooms });
    });

    // Modify the 'drawing' event handler
    socket.on('drawing', (data) => {
        const { room } = data;
        const user = users[socket.id];

        // Update the drawing path for the current user
        if (drawingStates[room] && drawingStates[room][socket.id] && drawingStates[room][socket.id].drawing) {
            drawingStates[room][socket.id].path.push({ x: data.x, y: data.y });
        }

        // Emit the drawing event to all clients in the room
        io.to(room).emit('drawing', data);

        // Store drawing data in roomCanvases
        roomCanvases[room] = roomCanvases[room] || [];
        roomCanvases[room].push({ type: 'drawing', data });

        io.emit('activeRooms', { activeRooms });
    });

    // Modify the 'drawingEnd' event handler
    socket.on('drawingEnd', (data) => {
        const { room } = data;
        const user = users[socket.id];

        // Clear the drawing path for the current user
        if (drawingStates[room] && drawingStates[room][socket.id]) {
            delete drawingStates[room][socket.id];
        }

        // Emit the drawing end event to all clients in the room
        io.to(room).emit('drawingEnd', data);

        // Store drawing data in roomCanvases
        roomCanvases[room] = roomCanvases[room] || [];
        roomCanvases[room].push({ type: 'drawingEnd', data });

        io.emit('activeRooms', { activeRooms });
    });
    
    // Modify the 'clearCanvas' event handler
    socket.on('clearCanvas', (data) => {
        // Clear the canvas state for the room
        roomCanvases[data.room] = [];
        io.to(data.room).emit('clearCanvas', data);
    });
    
    // Add this block to your existing server-side code
    socket.on('restoreCanvas', (data) => {
        const { room } = data;

        // Send existing canvas data to the user who requests to restore canvas
        if (roomCanvases[room]) {
            roomCanvases[room].forEach((item) => {
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
                // Proceed with the rest of your disconnect logic...
            if (activeRooms.includes(user.room)) {
                // Decrement the user count for the left room
                activeRooms[user.room] = (activeRooms[user.room] || 0) - 1;
                
                // Emit the updated user count to all clients in the room
                io.to(user.room).emit('activeUsersCount', { room: user.room, count: activeRooms[user.room] });
                
                // Remove the room from activeRooms if there are no users
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
        clearInterval(inactivityCheckInterval); // Clear the inactivity check interval
    });
    
    });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
