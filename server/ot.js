const MAX_OPERATION_LOG = 1000;

const rooms = {};

const cloneOperation = (operation) => ({
    ...operation,
    index: Number(operation.index) || 0,
    length: Number(operation.length) || 0,
});

const getInsertLength = (operation) => (operation.text || '').length;
const getDeleteLength = (operation) => operation.length || (operation.text || '').length;

const getFileState = (roomId, fileName, initialText = '') => {
    if (!rooms[roomId]) rooms[roomId] = {};
    if (!rooms[roomId][fileName]) {
        rooms[roomId][fileName] = {
            text: initialText || '',
            revisionCounter: 0,
            operationsLog: [],
        };
    }
    return rooms[roomId][fileName];
};

const getRoomSnapshot = (roomId) => {
    const room = rooms[roomId] || {};
    return Object.entries(room).reduce((snapshot, [fileName, fileState]) => {
        snapshot[fileName] = {
            text: fileState.text,
            revision: fileState.revisionCounter,
        };
        return snapshot;
    }, {});
};

const setFileText = (roomId, fileName, text = '') => {
    const fileState = getFileState(roomId, fileName, text);
    fileState.text = text || '';
    fileState.revisionCounter += 1;
    fileState.operationsLog = [];
    return fileState;
};

const deleteFileState = (roomId, fileNameOrFolder) => {
    if (!rooms[roomId]) return;
    Object.keys(rooms[roomId]).forEach((fileName) => {
        if (fileName === fileNameOrFolder || fileName.startsWith(`${fileNameOrFolder}/`)) {
            delete rooms[roomId][fileName];
        }
    });
};

const compareTieBreaker = (incoming, applied) => {
    const incomingKey = `${incoming.clientId || ''}:${incoming.operationId || ''}`;
    const appliedKey = `${applied.clientId || ''}:${applied.operationId || ''}`;
    if (incomingKey === appliedKey) return 0;
    return incomingKey < appliedKey ? -1 : 1;
};

const transformPositionAgainstDelete = (position, deleteOperation) => {
    const deleteStart = deleteOperation.index;
    const deleteEnd = deleteStart + getDeleteLength(deleteOperation);

    if (position <= deleteStart) return position;
    if (position >= deleteEnd) return position - (deleteEnd - deleteStart);
    return deleteStart;
};

const transformOperation = (incomingOperation, appliedOperation) => {
    const incoming = cloneOperation(incomingOperation);
    const applied = cloneOperation(appliedOperation);

    if (incoming.noop) return incoming;

    if (incoming.type === 'insert' && applied.type === 'insert') {
        const appliedLength = getInsertLength(applied);
        const appliedWinsTie = incoming.index === applied.index && compareTieBreaker(incoming, applied) > 0;
        if (applied.index < incoming.index || appliedWinsTie) {
            incoming.index += appliedLength;
        }
        return incoming;
    }

    if (incoming.type === 'insert' && applied.type === 'delete') {
        incoming.index = transformPositionAgainstDelete(incoming.index, applied);
        return incoming;
    }

    if (incoming.type === 'delete' && applied.type === 'insert') {
        const appliedLength = getInsertLength(applied);
        if (applied.index <= incoming.index) {
            incoming.index += appliedLength;
        } else if (applied.index < incoming.index + getDeleteLength(incoming)) {
            incoming.length += appliedLength;
        }
        return incoming;
    }

    if (incoming.type === 'delete' && applied.type === 'delete') {
        const start = incoming.index;
        const end = incoming.index + getDeleteLength(incoming);
        const nextStart = transformPositionAgainstDelete(start, applied);
        const nextEnd = transformPositionAgainstDelete(end, applied);

        incoming.index = nextStart;
        incoming.length = Math.max(0, nextEnd - nextStart);
        incoming.noop = incoming.length === 0;
        return incoming;
    }

    return incoming;
};

const transformAgainstAll = (operation, appliedOperations) => {
    return appliedOperations.reduce(
        (transformed, appliedOperation) => transformOperation(transformed, appliedOperation),
        cloneOperation(operation)
    );
};

const applyOperationToText = (text, operation) => {
    const safeIndex = Math.max(0, Math.min(operation.index, text.length));

    if (operation.noop) return text;

    if (operation.type === 'insert') {
        return `${text.slice(0, safeIndex)}${operation.text || ''}${text.slice(safeIndex)}`;
    }

    if (operation.type === 'delete') {
        const deleteLength = Math.max(0, getDeleteLength(operation));
        return `${text.slice(0, safeIndex)}${text.slice(safeIndex + deleteLength)}`;
    }

    return text;
};

const applyServerOperation = ({ roomId, fileName, operation, lastKnownRevision = 0, initialText = '' }) => {
    const fileState = getFileState(roomId, fileName, initialText);
    const revision = Math.max(0, Number(lastKnownRevision) || 0);
    const operationsSinceRevision = fileState.operationsLog.filter(
        (loggedOperation) => loggedOperation.revision > revision
    );
    const transformedOperation = transformAgainstAll(operation, operationsSinceRevision);

    fileState.text = applyOperationToText(fileState.text, transformedOperation);
    fileState.revisionCounter += 1;

    const committedOperation = {
        ...transformedOperation,
        revision: fileState.revisionCounter,
        serverTimestamp: Date.now(),
    };

    fileState.operationsLog.push(committedOperation);
    if (fileState.operationsLog.length > MAX_OPERATION_LOG) {
        fileState.operationsLog = fileState.operationsLog.slice(-MAX_OPERATION_LOG);
    }

    return {
        operation: committedOperation,
        text: fileState.text,
        revision: fileState.revisionCounter,
    };
};

module.exports = {
    applyOperationToText,
    applyServerOperation,
    deleteFileState,
    getFileState,
    getRoomSnapshot,
    setFileText,
    transformAgainstAll,
    transformOperation,
};
