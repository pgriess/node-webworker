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
//      0               No-op. The payload of this message is discarded.
//
//      1               Handshake. The contents of this message is a
//                      single integer indicating the PID of the sending
//                      process. This is used to tie Worker instances in the
//                      master process with incoming connections.

var assert = require('assert');
var child_process = require('child_process');
var msgpack = require('msgpack');
var net = require('net');
var path = require('path');
var sys = require('sys');

// Path to our UNIX domain socket for communication with children
var SOCK_PATH = '/tmp/node-webworker-' + process.pid + '.sock';

// Symbolic names for our messages types
var MSGTYPE_NOOP = 0;
var MSGTYPE_HANDSHAKE = 1;

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

    // The primary message handling function for the master.
    //
    // This is only invoked after handshaking has occurred (this is how we
    // get the PID).
    var handleMessage = function(pid, msg) {
        assert.ok(workers[pid], 'Unable to find worker for PID ' + pid);

        var ww = workers[pid];

        if (ww.onmessage) {
            ww.onmessage(msg);
        }
    };
    
    // Create a server instance that listens for new connections and expects
    // a HANDSHAKE message. On receipt of a handshake message, establishes
    // the primary message handler, handleMessage().
    var srv = net.createServer(function(s) {
        var ms = new msgpack.Stream(s);

        ms.addListener('msg', function(m) {
            if (!Array.isArray(m) ||
                m.length != 2 ||
                m[0] !== MSGTYPE_HANDSHAKE || 
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
            ms.addListener('msg', function(m) {
                handleMessage(pid, m);
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

    master.addWorker(cp.pid, self);
};

exports.Worker = Worker;
