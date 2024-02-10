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

let isDrawing = false;

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        const { room, username, color } = data;

        socket.join(room);

        users[socket.id] = { username, color, room };

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

        // Initialize drawing state for the room
        if (!drawingStates[room]) {
            drawingStates[room] = {
                drawing: false,
                lastX: 0,
                lastY: 0,
            };
        }

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
    });
    
    socket.on('drawingStart', (data) => {
            if (!drawingStates[data.room] || !drawingStates[data.room].drawing) {
                drawingStates[data.room] = {
                    drawing: true,
                    lastX: data.startX,
                    lastY: data.startY,
                };
            
            // Store drawing data in roomCanvases including start color
            roomCanvases[data.room] = roomCanvases[data.room] || [];
            roomCanvases[data.room].push({ type: 'drawingStart', data });
            
            io.to(data.room).emit('drawingStart', data);
            
            io.emit('activeRooms', { activeRooms });
        }
    });

    socket.on('drawing', (data) => {
        if (drawingStates[data.room] && drawingStates[data.room].drawing) {
            drawingStates[data.room] = {
                drawing: true,
                lastX: data.x,
                lastY: data.y,
            };
            io.to(data.room).emit('drawing', data);

            // Store drawing data in roomCanvases
            roomCanvases[data.room] = roomCanvases[data.room] || [];
            roomCanvases[data.room].push({ type: 'drawing', data });

            // Send existing canvas data to the user who starts drawing
            if (roomCanvases[data.room]) {
                io.to(socket.id).emit('restoreCanvas', { canvasData: roomCanvases[data.room] });
            }
        }

        io.emit('activeRooms', { activeRooms });
    });

    socket.on('drawingEnd', (data) => {
        if (drawingStates[data.room] && drawingStates[data.room].drawing) {
            drawingStates[data.room].drawing = false;
            io.to(data.room).emit('drawingEnd', data);

            // Store drawing data in roomCanvases
            roomCanvases[data.room] = roomCanvases[data.room] || [];
            roomCanvases[data.room].push({ type: 'drawingEnd', data });

            // Clear the drawing data for the specific user and room
            drawingStates[data.room] = {
                drawing: false,
                lastX: 0,
                lastY: 0,
            };
        }

        // Always send existing canvas data to the newly joined user
        if (roomCanvases[data.room]) {
            roomCanvases[data.room].forEach((item) => {
                io.to(socket.id).emit(item.type, item.data);
            });
        }

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
        if (user) {
            if (activeRooms.includes(user.room)) {
                // Decrement the user count for the left room
                activeRooms[user.room] = (activeRooms[user.room] || 0) - 1;

                // Emit the updated user count to all clients in the room
                io.to(user.room).emit('activeUsersCount', { room: user.room, count: activeRooms[user.room] });

                // Remove the room from activeRooms if there are no users
                if (activeRooms[user.room] <= 0) {
                    activeRooms = activeRooms.filter(room => room !== user.room);

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
    });
    
    });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
