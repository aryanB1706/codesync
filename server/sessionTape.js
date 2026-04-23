const roomTapes = {};

function recordEvent(roomId, event) {
    if (!roomTapes[roomId]) {
        roomTapes[roomId] = [];
    }

    const entry = {
        ...event,
        eventIndex: roomTapes[roomId].length,
        timestamp: Date.now(),
    };

    roomTapes[roomId].push(entry);
    return entry;
}

function getTape(roomId) {
    return roomTapes[roomId] || [];
}

function reconstructStateAt(roomId, targetIndex) {
    const tape = roomTapes[roomId] || [];
    const state = {};

    for (let i = 0; i <= targetIndex && i < tape.length; i += 1) {
        const event = tape[i];

        if (event.type === 'FILE_EDIT') {
            state[event.filePath] = event.fullContent;
        } else if (event.type === 'FILE_CREATE') {
            state[event.filePath] = event.fullContent || '';
        } else if (event.type === 'FILE_DELETE') {
            Object.keys(state).forEach((filePath) => {
                if (filePath === event.filePath || filePath.startsWith(`${event.filePath}/`)) {
                    delete state[filePath];
                }
            });
        }
    }

    return state;
}

function clearTape(roomId) {
    delete roomTapes[roomId];
}

module.exports = { recordEvent, getTape, reconstructStateAt, clearTape };
