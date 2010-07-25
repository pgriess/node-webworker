// Launcher script for WebWorkers.
//
// Sets up context and runs a worker script. This is not intended to be
// invoked directly. Rather, it is invoked automatically when constructing a
// new Worker() object.
//
//      usage: node child.js [-S [<name>]] <sock> <script>
//
//      The <sock> parameter is the filesystem path to a UNIX domain socket
//      that is listening for connections. The <script> parameter is the
//      path to the JavaScript source to be executed as the body of the
//      worker.
//
//      Options:
//
//          -S [<name>]      Create a context appropriate for a shared
//                           worker with the given (optional) name rather
//                           than a dedicated worker

var assert = require('assert');
var events = require('events');
var fs = require('fs');
var net = require('net');
var path = require('path');
var script = process.binding('evals');
var sys = require('sys');
var wwutil = require('./util');
var WebSocketServer = require('./ws').WebSocketServer;

try {
    var WebSocket = require('websocket-client').WebSocket;
} catch (e) {
    throw new Error(
        'pgriess/node-websocket-client must be installed'
    );
}

var writeError = process.binding('stdio').writeError;

// Our parent process
//
// This class implements lifecycle management and messaging logic for the
// child process that we're in.
var ParentProcess = function(sock, src, shared) {
    events.EventEmitter.call(this);

    var self = this;
    var ws;
    var ms;

    // Message handling function for messages from the master
    var handleMessage = function(msg, fd) {
        if (!wwutil.isValidMessage(msg)) {
            wwutil.debug('Received invalid message: ' + sys.inspect(msg));
            return;
        }

        switch(msg[0]) {
        case wwutil.MSGTYPE_NOOP:
            break;

        case wwutil.MSGTYPE_CLOSE:
            self.emit('close');
            break;

        case wwutil.MSGTYPE_USER:
            self.emit('message', msg[1], fd);
            break;

        default:
            wwutil.debug('Received unexpected message: ' + sys.inspect(msg));
            break;
        }
    };

    self.start = function() { 
        ws = new WebSocket('ws+unix://' + sock);

        // Once we connect successfully, set up the rest of the world
        ws.addListener('open', function() {
            self.emit('open');
        });

        ms = new wwutil.MsgStream(ws);
        ms.addListener('msg', handleMessage);
    };

    self.close = function() {
        ws.close();
    };

    self.postMessage = function(msgType, msg, fd) {
        ms.send([
            msgType,
            msg
        ], fd);
    };
};
sys.inherits(ParentProcess, events.EventEmitter);

// Get the Script object to execute the worker payload
var createScript = function(loc) {
    switch (loc.protocol) {
    case 'file':
        return new script.Script(
            fs.readFileSync(loc.pathname),
            loc.href
        );

    default:
        throw new Error(
            'Cannot load script from unknown protocol \'' + 
                loc.protocol + '\''
        );
    }
};

// Create a global context in which our worker should execute
var createContext = function(loc, name, port) {
    var ctx = {};

    // Context elements required for node.js
    //
    // XXX: There must be a better way to do this. Instead, iterate
    //      over keys int he global object and copy them
    //      programmatically.
    ctx.global = ctx;
    ctx.process = process;
    ctx.require = require;
    ctx.__filename = loc.pathname;
    ctx.__dirname = path.dirname(loc.pathname);
    ctx.setTimeout = setTimeout;
    ctx.clearTimeout = clearTimeout;
    ctx.setInterval = setInterval;
    ctx.clearInterval = clearInterval;

    // Context elements required by the WebWorkers API spec
    if (name === undefined) {
        ctx.postMessage = function(msg, fd) {
            port.postMessage(msg, fd);
        };

        ctx.__defineSetter__('onmessage', function(v) {
            port.onmessage = v;
        });
        ctx.__defineGetter__('onmessage', function() {
            return port.onmessage;
        });
    } else {
        ctx.name = name;
    }
    ctx.self = ctx;
    ctx.location = loc;
    ctx.closing = false;
    ctx.close = function() {
        process.exit(0);
    };

    return ctx;
};

var argv = process.argv.slice(2);

var sharedName = undefined;
if (argv[0] === '-S') {
    sharedName = '';
    argv.shift();

    if (argv.length >= 3) {
        sharedName = argv.shift();
    }
}

if (argv.length != 2) {
    throw new Error('usage: node child.js [-S [<name>]] <sock> <script>');
}

var pp = new ParentProcess(argv[0], argv[1], sharedName !== undefined);
var loc = new wwutil.WorkerLocation(argv[1]);
var port = new wwutil.Port(pp, function(msg, fd) {
    pp.postMessage(wwutil.MSGTYPE_USER, msg, fd);
});
var ctx = createContext(loc, sharedName, port);

process.addListener('uncaughtException', (function() {
    var inErrorHandler = false;

    return function(e) {
        if (!inErrorHandler && ctx.onerror) {
            inErrorHandler = true;
            ctx.onerror(e);
            inErrorHandler = false;

            return;
        }

        // Don't bother setting inErrorHandler here, as we're already delivering
        // the event to the master anyway
        pp.postMessage(
            wwutil.MSGTYPE_ERROR,
            {
                message : wwutil.getErrorMessage(e),
                filename : wwutil.getErrorFilename(e),
                lineno : wwutil.getErrorLine(e)
            }
        );
    };
})());

pp.addListener('open', function() {
    createScript(loc).runInNewContext(ctx);

    // If we're a shared worker, queue a 'connect' event
    if (sharedName !== undefined) {
        process.nextTick(function() {
            var e = { ports : [port] };

            if (ctx.onconnect) {
                ctx.onconnect(e);
            }
        });
    }
});
pp.addListener('close', function() {
    // Close down the event sources that we know about
    pp.close();

    // Conform to the Web Workers API for termination
    ctx.closing = true;

    // Request that the worker perform any application-level shutdown
    process.nextTick(function() {
        if (ctx.onclose) {
            ctx.onclose();
        }
    });
});

pp.start();
