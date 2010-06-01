// Utilies and other common gook shared between the WebWorker master and
// its constituent Workers.

var events = require('events');
var msgpack = require('msgpack');
var sys = require('sys');

// Symbolic names for our messages types
exports.MSGTYPE_NOOP = 0;
exports.MSGTYPE_HANDSHAKE = 1;
exports.MSGTYPE_USER = 100;

// Is the given message well-formed?
exports.isValidMessage = function(msg) {
    return (Array.isArray(msg) && msg.length == 2);
}

// A simple messaging stream.
//
// This class is constructed around an existing stream net.Stream. This class
// emits 'msg' events when a message is received. Each emitted 'msg' event
// may come with a second 'fd' parameter if the message was sent with  file
// descriptor. A sent file descriptor is guaranteed to be received with the
// message with which it was sent.
//
// Sending messages is done with the send() method.
var MsgStream = function(s) {
    var self = this;

    events.EventEmitter.call(self);

    // Sequence numbers for outgoing and incoming FDs
    var fds_seqno_sent = 0;
    var fds_seqno_recvd = 0;

    // Collections of messages waiting for FDs and vice-versa. These
    // are keyed by FD seqno.
    var msg_waiting_for_fd = {};
    var fd_waiting_for_msg = {};

    // Our msgpack.Stream instance which we're interfacing with, as it will
    // manage framing for us
    var mpStream = new msgpack.Stream(s);

    // Send the given JavaSript object. If 'fd' is provided, it is sent as a
    // file descriptor along with the message.
    self.send = function(v, fd) {
        mpStream.send(
            [(fd != undefined) ? ++fds_seqno_sent : 0, v],
            undefined,
            fd
        );
    };

    mpStream.addListener('msg', function(msg_arr) {
        var fd = undefined;

        var fd_seq = msg_arr[0];
        var msg = msg_arr[1];

        // If our message has an associated file descriptor that we
        // have not yet received, queue it for later delivery.
        if (fd_seq) {
            if (!(fd = fd_waiting_for_msg[fd_seq])) {
                msg_waiting_for_fd[fd_seq] = msg;
                return;
            }

            delete fd_waiting_for_msg[fd_seq];
        }

        // We're complete; emit
        self.emit('msg', msg, fd);
    });

    s.addListener('fd', function(fd) {
        // Look for a message that's waiting for our arrival. If we don't
        // have one, enqueu the received FD for later delivery.
        var msg = msg_waiting_for_fd[++fds_seqno_recvd];
        if (!msg) {
            fd_waiting_for_msg[fds_seqno_recvd] = fd;
            return;
        }

        // There was a message waiting for us; emit
        delete msg_waiting_for_fd[fds_seqno_recvd];
        self.emit('msg', msg, fd);
    });
};

sys.inherits(MsgStream, events.EventEmitter);
exports.MsgStream = MsgStream;
