// Utilies and other common gook shared between the WebWorker master and
// its constituent Workers.

var events = require('events');
var msgpack = require('msgpack');
var path = require('path');
var sys = require('sys');
var urllib = require('url');

// Symbolic names for our messages types
exports.MSGTYPE_NOOP = 0;
exports.MSGTYPE_HANDSHAKE = 1;
exports.MSGTYPE_ERROR = 2;
exports.MSGTYPE_CLOSE = 3;
exports.MSGTYPE_USER = 100;

// Some debugging functions
var debugLevel = ('NODE_DEBUG' in process.env) ?
    parseInt(process.env.NODE_DEBUG) : 0;
exports.debug = (debugLevel > 0) ?
    function(l, x) { if (l >= debugLevel) { sys.debug(x); } } :
    function() {};

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

// Implement the WorkerLocation interface described in
// http://www.whatwg.org/specs/web-workers/current-work/#dom-workerlocation-href
//
// XXX: None of these properties are readonly as required by the spec.
var WorkerLocation = function(url) {
    var u = urllib.parse(url);

    var portForProto = function(proto) {
        switch (proto) {
        case 'http':
            return 80;

        case 'https':
            return 443;

        case 'file':
            return undefined;

        default:
            sys.debug(
                'Unknown protocol \'' + proto + '\'; returning undefined'
            );
            return undefined;
        };
    };

    this.href = u.href;
    this.protocol = u.protocol.substring(0, u.protocol.length - 1);
    this.host = u.host;
    this.hostname = u.hostname;
    this.port = (u.port) ? u.port : portForProto(this.protocol);
    this.pathname = (u.pathname) ? path.normalize(u.pathname) : '/';
    this.search = (u.search) ? u.search : '';
    this.hash = (u.hash) ? u.hash : '';
};

exports.WorkerLocation = WorkerLocation;
