const userSocketMap = {}; // Ab isme { username, location } store hoga
const roomLocks = {};     // Structure: { roomId: { "src/App.js": { socketId, username } } }

const getAllConnectedClients = (io, roomId) => {
    return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
        (socketId) => {
            return {
                socketId,
                username: userSocketMap[socketId]?.username,
                location: userSocketMap[socketId]?.location, // Naya feature
            };
        }
    );
};

module.exports = (io, socket) => {
    console.log('User Connected', socket.id);

    // Join Room (Updated with Location)
    socket.on('join', ({ roomId, username, location }) => {
        userSocketMap[socket.id] = { username, location };
        socket.join(roomId);

        // Room ke liye lock object initialize karo agar nahi hai
        if (!roomLocks[roomId]) {
            roomLocks[roomId] = {};
        }

        const clients = getAllConnectedClients(io, roomId);
        
        // Sabko naya user list aur current locks bhejo
        io.in(roomId).emit('joined', {
            clients,
            username,
            socketId: socket.id,
            locks: roomLocks[roomId] // Naya user aate hi usko pata chale kaunsi file locked hai
        });
    });

    // === NEW: FILE LOCKING MECHANISM ===
    socket.on('lock_file', ({ roomId, fileName }) => {
        if (!roomLocks[roomId]) roomLocks[roomId] = {};

        const existingLock = fileName ? roomLocks[roomId][fileName] : null;
        if (existingLock && existingLock.socketId !== socket.id) {
            socket.emit('lock_denied', { fileName, lock: existingLock });
            socket.emit('locks_updated', roomLocks[roomId]);
            return;
        }

        // 1. User ki purani koi file lock thi toh use hata do (ek time pe ek hi file edit hogi)
        for (const file in roomLocks[roomId]) {
            if (roomLocks[roomId][file].socketId === socket.id) {
                delete roomLocks[roomId][file];
            }
        }

        // 2. Nayi file ko lock karo (Agar usne koi file select ki hai)
        if (fileName) {
            roomLocks[roomId][fileName] = { 
                socketId: socket.id, 
                username: userSocketMap[socket.id]?.username 
            };
        }

        // 3. Sabko batao ki locks update ho gaye hain
        io.in(roomId).emit('locks_updated', roomLocks[roomId]);
    });

    // Code Sync
    socket.on('code_change', ({ roomId, code, fileName }) => {
        const fileLock = roomLocks[roomId]?.[fileName];
        if (fileLock && fileLock.socketId !== socket.id) {
            socket.emit('lock_denied', { fileName, lock: fileLock });
            socket.emit('locks_updated', roomLocks[roomId]);
            return;
        }

        socket.in(roomId).emit('code_change', { code, fileName }); 
    });

    // File Creation
    socket.on('file_created', ({ roomId, fileName, language, value }) => {
        socket.in(roomId).emit('file_created', { fileName, language, value });
    });

    // File Deletion
    socket.on('file_deleted', ({ roomId, id }) => {
        // Agar deleted file locked thi, toh uska lock bhi hatao
        if (roomLocks[roomId]) {
            Object.keys(roomLocks[roomId]).forEach(file => {
                if (file === id || file.startsWith(id + '/')) {
                    delete roomLocks[roomId][file];
                }
            });
            io.in(roomId).emit('locks_updated', roomLocks[roomId]);
        }
        socket.in(roomId).emit('file_deleted', { id }); 
    });

    // Disconnect
    socket.on('disconnecting', () => {
        const rooms = [...socket.rooms];
        
        rooms.forEach((roomId) => {
            // Room se is user ke saare locks hata do (Auto-Unlock)
            if (roomLocks[roomId]) {
                for (const file in roomLocks[roomId]) {
                    if (roomLocks[roomId][file].socketId === socket.id) {
                        delete roomLocks[roomId][file];
                    }
                }
                // Updated locks sabko bhej do
                io.in(roomId).emit('locks_updated', roomLocks[roomId]);
            }

            socket.in(roomId).emit('disconnected', {
                socketId: socket.id,
                username: userSocketMap[socket.id]?.username,
            });
        });

        delete userSocketMap[socket.id];
        socket.leave();
    });
};
