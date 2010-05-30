// Utilies and other common gook shared between the WebWorker master and
// its constituent Workers.

// Symbolic names for our messages types
exports.MSGTYPE_NOOP = 0;
exports.MSGTYPE_HANDSHAKE = 1;
exports.MSGTYPE_USER = 100;

// Is the given message well-formed?
exports.isValidMessage = function(msg) {
    return (Array.isArray(msg) && msg.length == 2);
}
