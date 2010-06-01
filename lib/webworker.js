// WebWorkers implementation.
//
// The master and workers communite over a UNIX domain socket at
// 
//      /tmp/node-webworker-<master PID>.sock
//
// This socket is used as a full-duplex channel for exchanging messages.
// Messages are objects encoded using the MessagePack format. Each message
// being exchanged is wrapped in an array envelope, the first element of
// which indicates the type of message being sent. For example take the
// following message (expresed in JSON)
//
//      [999, {'foo' : 'bar'}]
//
// This represents a message of type 999 with an object payload.
//
// o Message Types
//
//      MSGTYPE_NOOP        No-op. The payload of this message is discarded.
//
//      MSGTYPE_HANDSHAKE   Handshake. The contents of this message is a
//                          single integer indicating the PID of the sending
//                          process. This is used to tie Worker instances in
//                          the master process with incoming connections.
//
//      MSGTYPE_USER        A user-specified message. All messages sent
//                          via the WebWorker API generate this type of
//                          message.

var assert = require('assert');
var child_process = require('child_process');
var net = require('net');
var path = require('path');
var sys = require('sys');
var wwutil = require('./webworker-utils');

// Path to our UNIX domain socket for communication with children
var SOCK_PATH = '/tmp/node-webworker-' + process.pid + '.sock';

// Instance of WorkerMaster.
//
// This is a per-process singleton available only to the master process, 
// and not to worker processes.
var master = null;

var WorkerMaster = function(path) {
    var self = this;

    // Map of PIDs to Worker objects
    workers = {};

    // Map of PIDs to Stream objects for communication
    workerStreams = {};

    // Add a new Worker instance for tracking.
    self.addWorker = function(pid, w) {
        workers[pid] = w;
    };

    // Send a message to a worker
    self.postMessage = function(pid, msg) {
        assert.ok(workerStreams[pid] && workers[pid],
                  'Unable to find worker for PID ' + pid);

        var ws = workerStreams[pid];

        ws.send([wwutil.MSGTYPE_USER, msg]);
    };

    // The primary message handling function for the master.
    //
    // This is only invoked after handshaking has occurred (this is how we
    // get the PID).
    var handleMessage = function(pid, msg, fd) {
        assert.ok(workers[pid], 'Unable to find worker for PID ' + pid);

        if (!wwutil.isValidMessage(msg)) {
            sys.debug('Received invalid message: ' + sys.inspect(msg));
            return;
        }

        switch (msg[0]) {
        case wwutil.MSGTYPE_NOOP:
            break;

        case wwutil.MSGTYPE_USER:
            var ww = workers[pid];

            if (ww.onmessage) {
                ww.onmessage(msg[1]);
            }

            break;

        default:
            sys.debug('Received unexpected message: ' + msg);
            break;
        }
    };
    
    // Create a server instance that listens for new connections and expects
    // a HANDSHAKE message. On receipt of a handshake message, establishes
    // the primary message handler, handleMessage().
    var srv = net.createServer(function(s) {
        var ms = new wwutil.MsgStream(s);

        ms.addListener('msg', function(m, fd) {
            if (!Array.isArray(m) ||
                m.length != 2 ||
                m[0] !== wwutil.MSGTYPE_HANDSHAKE || 
                typeof m[1] !== 'number') {
                sys.debug('Received malformed message: ' + sys.inspect(m));
                s.end();

                return;
            }

            var pid = m[1];
            if (!(pid in workers) || (pid in workerStreams)) {
                sys.debug('Invalid PID found in HANDSHAKE message.');
                s.end();
                return;
            }

            workerStreams[pid] = ms;

            // Remove the current listener
            ms.listeners('msg').shift();

            // Add the listener for the normal event loop
            ms.addListener('msg', function(m, fd) {
                handleMessage(pid, m, fd);
            });
        });
    });

    // Listen on the given path
    srv.listen(path);
};

// var w = new Worker('/path/to/foo.js');
var Worker = function(src) {
    var self = this;

    if (!master) {
        master = new WorkerMaster(SOCK_PATH);
    }

    // Send a message to the worker
    self.postMessage = function(msg) {
        master.postMessage(cp.pid, msg);
    };

    var cp = child_process.spawn(process.argv[0], [
        path.join(__dirname, '..', 'libexec', 'worker.js'),
        SOCK_PATH,
        src
    ]);

    cp.stdout.addListener('data', function(d) {
        sys.debug(cp.pid + '/stdout: ' + d);
    });
    cp.stderr.addListener('data', function(d) {
        sys.debug(cp.pid + '/stderr: ' + d);
    });
    cp.addListener('exit', function(code, signal) {
        sys.debug('child ' + cp.pid + ' exited with status ' + code);
    });

    master.addWorker(cp.pid, self);
};

exports.Worker = Worker;
