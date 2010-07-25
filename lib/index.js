// WebWorkers implementation.
//
// The master and workers communite over a UNIX domain socket at the
// following location. Each worker gets its own dedicated socket.
// 
//      /tmp/node-webworker-<child PID>.sock
//
// This socket is used as the transport layer for a Web Sockets connection.
// The Web Sockets protocol itself provides framing. All messages being
// exchanged are JSON, with user data wrapped in an array envelope, the first
// element of which indicates the type of message being sent. For example
// take the following message
//
//      [999, {'foo' : 'bar'}]
//
// This represents a message of type 999 with an payload of the
// object {'foo' : 'bar'}
//
// o Message Types
//
//      MSGTYPE_NOOP        No-op. The payload of this message is discarded.
//
//      MSGTYPE_ERROR       An error has occurred. Used for bubbling up
//                          error events from the child process.
//
//      MSGTYPE_CLOSE       Graceful shut-down. Used to request that the
//                          child terminate gracefully.
//
//      MSGTYPE_USER        A user-specified message. All messages sent
//                          via the WebWorker API generate this type of
//                          message.

var assert = require('assert');
var child_process = require('child_process');
var events = require('events');
var fs = require('fs');
var net = require('net');
var netBinding = process.binding('net');
var path = require('path');
var sys = require('sys');
var wwutil = require('./util');
var WebSocketServer = require('./ws').Server;

try {
    var WebSocket = require('websocket-client').WebSocket;
} catch (e) {
    throw new Error(
        'pgriess/node-websocket-client must be installed'
    );
}

// Directory for our UNIX domain sockets
var SOCK_DIR_PATH = '/tmp/node-webworker-' + process.pid;

// The number of workers created so far
var numWorkersCreated = 0;

// Registry of shared workers
SHARED_WORKERS = {
    bySrc : {},
    byName : {}
};

// A child process
//
// This class implements basic lifecycle management for a web worker. It can
// be used for both shared and dedicated workers.
var WorkerProcess = function(src, opts) {
    events.EventEmitter.call(this);

    var self = this;
    opts = opts || {};

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

    // The path to our socket
    var sockPath = path.join(SOCK_DIR_PATH, numWorkersCreated++);

    // Server instance for our communication socket with the child process
    //
    // Doesn't begin listening until start() is called.
    var wsSrv = new WebSocketServer();
    wsSrv.addListener('connection', function(s) {
        assert.equal(stream, undefined);
        assert.equal(msgStream, undefined);

        stream = s._req.socket;
        msgStream = new wwutil.MsgStream(s);
        
        // Process any messages waiting to be sent
        msgQueue.forEach(function(m) {
            var fd = m.pop();
            msgStream.send(m, fd);
        });

        msgQueue = [];

        // Process incoming messages with handleMessage()
        msgStream.addListener('msg', handleMessage);
    });

    // The primary message handling function for the worker.
    //
    // This is only invoked after handshaking has occurred.
    var handleMessage = function(msg, fd) {
        if (!wwutil.isValidMessage(msg)) {
            wwutil.debug('Received invalid message: ' + sys.inspect(msg));
            return;
        }

        switch (msg[0]) {
        case wwutil.MSGTYPE_NOOP:
            break;

        case wwutil.MSGTYPE_ERROR:
            self.emit('err', msg[1]);
            break;

        case wwutil.MSGTYPE_USER:
            self.emit('message', msg[1], fd);
            break;

        default:
            wwutil.debug(
                'Received unexpected message: ' + sys.inspect(msg)
            );
            break;
        }
    };

    // Begin worker execution
    //
    // First fires up the UNIX socket server, then spawns the child process
    // and away we go.
    self.start = function() {
        wsSrv.addListener('listening', function() {
            var execPath = opts.path || process.execPath || process.argv[0];

            var args = [
                path.join(__dirname, 'child.js'),
                sockPath,
                'file://' + src
            ];

            // opts.childArgs arguments are passed to the 'child.js' script
            if (opts.childArgs) {
                if (Array.isArray(opts.childArgs)) {
                    for (var i = opts.childArgs.length - 1; i >= 0; i--) {
                        args.splice(1, 0, opts.childArgs[i]);
                    }
                } else {
                    args.splice(1, 0, opts.childArgs.toString());
                }
            }

            // opts.args arguments are passed to the NodeJS executable
            if (opts.args) {
                if (Array.isArray(opts.args)) {
                    for (var ii = opts.args.length - 1; ii >= 0; ii--) {
                        args.splice(0, 0, opts.args[ii]);
                    }
                } else {
                    args.splice(0, 0, opts.args.toString());
                }
            }

            cp = child_process.spawn(
                execPath,
                args,
                undefined,
                [0, 1, 2]
            );

            // Save off the PID of the child process, as this value gets
            // undefined once the process exits.
            pid = cp.pid;

            wwutil.debug(
                'Spawned process ' + pid + ' for worker \'' + src + '\': ' +
                execPath + ' ' + JSON.stringify(args)
            );

            cp.addListener('exit', function(code, signal) {
                wwutil.debug(
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
                    wwutil.debug(
                        'Process ' + pid + ' exited without completing handshaking'
                    );
                }

                wsSrv.close();

                self.emit('exit', code, signal);
            });
        });

        wsSrv.listen(sockPath);
    };

    // Post a message to the worker
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
    // 5 seconds. A value of 0 indicates infinite timeout.
    self.terminate = function(timeout) {
        assert.notEqual(pid, undefined);
        assert.ok(cp.pid == pid || !cp.pid);

        timeout = (timeout === undefined) ?  1000 : timeout;

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

        // Optionally set a timer to kill off the child process forcefully if
        // it has not shut down by itself.
        if (timeout > 0) {
            killTimeoutID = setTimeout(function() {
                // Clear our ID since we're now running
                killTimeoutID = undefined;

                if (!cp.pid) {
                    return;
                }

                wwutil.debug(
                    'Forcibily terminating worker process ' + pid + 
                        ' with SIGTERM'
                );

                cp.kill('SIGTERM');
            }, timeout);
        }
    };
};
sys.inherits(WorkerProcess, events.EventEmitter);

// Dedicated worker implementation
//
// Implements the external API for dedicated workers
var Worker = function(src, opts) {
    var self = this;

    // Create our worker pocess and its port
    var wp = new WorkerProcess(src, opts);
    var port = new wwutil.Port(wp, function(msg, fd) {
        wp.postMessage(wwutil.MSGTYPE_USER, msg, fd);
    });

    // Export our external API
    self.postMessage = function(msg, ports, fd) {
        if (!fd) {
            if (typeof ports === 'number') {
                fd = ports;
                ports = undefined;
            }
        }
        if (!ports) {
            ports = [port];
        }

        ports.forEach(function(p) {
            p.postMessage(msg, fd);
        });
    };

    self.terminate = function(timeout) {
        wp.terminate(timeout);
    };

    // Alias aspects of our port onto ourselves as per the W3C spec
    self.__defineGetter__('onmessage', function() {
        return port.onmessage;
    });
    self.__defineSetter__('onmessage', function(v) {
        port.onmessage = v;
    });
    self.__defineGetter__('onexit', function() {
        return port.onexit;
    });
    self.__defineSetter__('onexit', function(v) {
        port.onexit = v;
    });
    self.__defineGetter__('onerror', function() {
        return port.onerror;
    });
    self.__defineSetter__('onerror', function(v) {
        port.onerror = v;
    });

    // Start up the worker process
    wp.start();
};
exports.Worker = Worker;

// Shared worker implementation
//
// Implements the external API for shared workers. Also offers some API
// extensions like terminate(), name, and src.
var SharedWorker = function(src, name, opts) {
    var self = this;

    name = name || '';
    opts = opts || {};

    var wp = SHARED_WORKERS.bySrc[src] || SHARED_WORKERS.byName[name];
    if (wp) {
        if (wp.name !== name) {
            throw new Error(
                'Shared worker with src \'' + src + '\' already exists ' +
                    'with a different name: \'' + wp.name + '\''
            );
        }

        if (wp.src !== src) {
            throw new Error(
                'Shared worker with name \'' + name + '\' already exists ' +
                    'with a different src: \'' + wp.src + '\''
            );
        }
    } else {
        opts.childArgs = ['-S', name];

        wp = new WorkerProcess(src, opts);

        SHARED_WORKERS.bySrc[src] = wp;
        SHARED_WORKERS.byName[name] = wp;

        wp.start();
    }

    var port = new wwutil.Port(wp, function(msg, fd) {
        wp.postMessage(wwutil.MSGTYPE_USER, msg, fd);
    });

    // Export our external API
    self.port = port;

    self.terminate = function(timeout) {
        wp.terminate(timeout);
    };

    self.name = name;
    
    self.src = src;
};
exports.SharedWorker = SharedWorker;

// Perform any one-time initialization
fs.mkdirSync(SOCK_DIR_PATH, 0700);
