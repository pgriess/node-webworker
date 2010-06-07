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
var wwutil = require('./webworker-util');

// Path to our UNIX domain socket for communication with children
var SOCK_PATH = '/tmp/node-webworker-' + process.pid + '.sock';

// Instance of WorkerMaster.
//
// This is a per-process singleton available only to the master process, 
// and not to worker processes.
var MASTER = null;

// Class to bootstrap workers via a single shared UNIX socket.
//
// XXX: The design would be cleaner if each worker had their own path so that
//      we didn't need a WorkerMaster or the MSG_HANDSHAKE message. I dislike
//      the filesystem clutter of that model, but its probably better.
var WorkerMaster = function(path) {
    var self = this;

    // Map of PIDs to WorkerImpl instances
    workers = {};

    // Add a new WorkerImpl instance for tracking
    self.addWorker = function(pid, w) {
        workers[pid] = w;
    };

    // Begin listening for new worker socket connections
    self.start = function() {
        srv.listen(path);
    };

    // Conditionally destroy the master if there are no outstanding
    // workers waiting for handshaking.
    //
    // This is used for shutdown to clear the pending events queue and
    // allow the process to terminate gracefully.
    self.maybeDestroy = function() {
        if (workers.length > 0) {
            return;
        }

        srv.close();
        MASTER = null;
    };

    // Create a server instance that listens for new connections and expects
    // a HANDSHAKE message. On receipt of a handshake message, finishes
    // initializing the WorkerImpl instance with setStream() and disengages
    // itself.
    var srv = net.createServer(function(s) {
        var ms = new wwutil.MsgStream(s);

        ms.addListener('msg', function(m, fd) {
            if (!wwutil.isValidMessage(m) ||
                m[0] !== wwutil.MSGTYPE_HANDSHAKE || 
                typeof m[1] !== 'number') {
                wwutil.debug(1,
                    'Received malformed message: ' + sys.inspect(m)
                );
                s.end();

                return;
            }

            var pid = m[1];
            if (!(pid in workers)) {
                wwutil.debug(1, 'Invalid PID found in HANDSHAKE message.');
                s.end();
                return;
            }

            // Remove the current listeners
            ms.removeAllListeners('msg');

            // Tell the worker what its streams are
            workers[pid].setStream(s, ms);

            // Stop tracking the worker
            delete workers[pid];
        });
    });

    self.start();
};

var WorkerImpl = function(w, src) {
    var self = this;

    // If no global master singleton exists, create it
    if (!MASTER) {
        MASTER = new WorkerMaster(SOCK_PATH);
    }

    // The Worker instance that we're doing work for
    var worker = w;

    // The timeout ID for killing off this worker if it is unresponsive to a
    // graceful shutdown request
    var killTimeoutID = undefined;
   
    // Process ID of child process running this worker
    //
    // This value persists even once the child process itself has
    // terminated; it is used as a key into datastructures managed by the
    // Master object.
    var pid = undefined;

    // Child process object
    //
    // This value is 'undefined' until the child process itself is spawned
    // and defined forever after.
    var cp = undefined;

    // The stream associated with this worker and wwutil.MsgStream that
    // wraps it.
    var stream = undefined;
    var msgStream = undefined;

    // Outbound message queue
    //
    // This queue is only written to when we don't yet have a stream to
    // talk to the worker. It contains [type, data, fd] tuples.
    var msgQueue = [];

    // Begin worker execution
    //
    // Spawns the child process and away we go.
    self.start = function() {
        cp = child_process.spawn(
            process.argv[0],
            [
                path.join(__dirname, 'webworker-child.js'),
                SOCK_PATH,
                'file://' + src
            ],
            undefined,
            [0, 1, 2]
        );

        // Save off the PID of the child process, as this value gets
        // undefined once the process exits.
        pid = cp.pid;

        wwutil.debug(1,
            'Spawned process ' + pid + ' for worker \'' + src + '\''
        );

        cp.addListener('exit', function(code, signal) {
            wwutil.debug(1,
                'Process ' + pid + ' for worker \'' + src + 
                    '\' exited with status ' + code +', signal ' + signal
            );

            // If we have an outstanding timeout for killing off this process,
            // abort it.
            if (killTimeoutID) {
                clearTimeout(killTimeoutID);
            }

            if (stream) {
                stream.destroy();
            } else {
                wwutil.debug(1,
                    'Process ' + pid + ' exited without completing handshaking'
                );
            }

            MASTER.maybeDestroy();
        });

        MASTER.addWorker(pid, self);
    };

    // Set the stream associated with this worker
    self.setStream = function(s, ms) {
        assert.equal(stream, undefined);
        assert.equal(msgStream, undefined);

        stream = s;
        msgStream = ms;

        // Process any messages waiting to be sent
        msgQueue.forEach(function(m) {
            var fd = m.pop();
            ms.send(m, fd);
        });

        msgQueue = [];

        ms.addListener('msg', handleMessage);
    };

    // The primary message handling function for the worker.
    //
    // This is only invoked after handshaking has occurred.
    var handleMessage = function(msg, fd) {
        if (!wwutil.isValidMessage(msg)) {
            wwutil.debug(1, 'Received invalid message: ' + sys.inspect(msg));
            return;
        }

        wwutil.debug(3,
            'Received message type=' + msg[0] + ', data=' + sys.inspect(msg[1])
        );

        switch (msg[0]) {
        case wwutil.MSGTYPE_NOOP:
            break;

        case wwutil.MSGTYPE_ERROR:
            if (worker.onerror) {
                worker.onerror(msg[1]);
            }
            break;

        case wwutil.MSGTYPE_USER:
            if (worker.onmessage) {
                e = { data : msg[1] };

                if (fd) {
                    e.fd = fd;
                }

                worker.onmessage(e);
            }
            break;

        default:
            wwutil.debug(1,
                'Received unexpected message: ' + sys.inspect(msg)
            );
            break;
        }
    };

    // Post a message of the given type
    self.postMessage = function(msgType, msg, fd) {
        assert.ok(msgQueue.length == 0 || !msgStream);

        var m = [msgType, msg];

        if (msgStream) {
            msgStream.send(m, fd);
        } else {
            m.push(fd);
            msgQueue.push(m);
        }
    };

    // Terminate the worker
    //
    // Takes a timeout value for forcibly killing off the worker if it does
    // not shut down gracefully on its own. By default, this timeout is
    // unlimited.
    self.terminate = function(timeout) {
        assert.notEqual(pid, undefined);
        assert.ok(cp.pid == pid || !cp.pid);

        // The child process is already shut down; no-op
        if (!cp.pid) {
            return;
        }

        // The termination process has already been initiated for this
        // process
        if (killTimeoutID) {
            return;
        }

        // Request graceful shutdown of the child process
        self.postMessage(wwutil.MSGTYPE_CLOSE);

        // Set a timer to kill off the child process forcefully if it has not
        // shut down by itself.
        killTimeoutID = setTimeout(function() {
            // Clear our ID since we're now running
            killTimeoutID = undefined;

            if (!cp.pid) {
                return;
            }

            wwutil.debug(1,
                'Forcibily terminating worker process ' + pid + 
                    ' with SIGTERM'
            );

            cp.kill('SIGTERM');
        }, timeout);
    };
};

// Implementation of the Worker API; externally visible to library users.
//
// This class delegates all of its implementation details to the WorkerImpl
// class, defined above. This is done to keep the external API neat, as we do
// not expose any implementation details.
var Worker = function(src) {
    var self = this;

    var impl = new WorkerImpl(this, src);

    self.postMessage = function(msg, fd) {
        impl.postMessage(wwutil.MSGTYPE_USER, msg, fd);
    };

    self.terminate = function() {
        impl.terminate(5000);
    };

    impl.start();
};

exports.Worker = Worker;
