`node-webworkers` is an experimental implementation of the [Web Workers
API](http://www.whatwg.org/specs/web-workers/current-work/) for
[node.js](http://nodejs.org).

### Example

#### Master source

    var sys = require('sys');
    var Worker = require('webworker').Worker;
    
    var w = new Worker('foo.js');
    
    w.onmessage = function(e) {
        sys.debug('Received mesage: ' + sys.inspect(e));
        w.terminate();
    };
    
    w.postMessage({ foo : 'bar' });

#### Worker source

    onmessage = function(e) {
        postMessage({ test : 'this is a test' });
    };
    
    onclose = function() {
        sys.debug('Worker shuttting down.');
    };

### API

Supported API methods are

   * `postMessage(e)` in both workers and the parent; messages are in the
     parent if this is invoked before the child is fully initialized
   * `onmessage(e)` in both workers and the parent
   * `onerror(e)`in both workers and the parent
   * `terminate()` in the parent

In addition, some nonstandard APIs are provided

   * `onclose()` in the worker (allows for graceful shutdown)
   * The `postMessage()` method takes an additional optional file descriptor parameter, which
     will be sent with the message. This descriptor will be passed to
     `onmessage` handlers as an optional `fd` field. Handlers receiving
     messages posted without file descriptors will not see an `fd` field. Both
     the parent and child can send file descriptors using this mechanism.
   * `Worker.onexit(code, signal)` in the master, which is invoked on the
     master `Worker` object when the worker process exits.
   * The `Worker` constructor takes an additional optional object argument,
     `opts`, which is used as a dictionary of options with the following keys
      * `args` : A string or array of strings to pass to the `node` executable before the filename to invoke. This can be used to request that the worker start up in debug mode (e.g. `{ 'args' : '--debug-brk' }`).

### Installation

This package requires [node-msgpack](http://github.com/pgriess/node-msgpack).

Installation is done using `make` on the `install` target. The `INSTALL_DIR`
variable defines the directory to which JavaScript files will be installed and
defaults to `/opt/local/share/node`.

For example, to install to /foo/bar

    % sudo make install INSTALL_DIR=/foo/bar
    install -m 755 -d /foo/bar
    install -m 444 lib/webworker.js lib/webworker-utils.js \
                lib/webworker-child.js /foo/bar
    % find /foo/bar
    /foo/bar
    /foo/bar/webworker-child.js
    /foo/bar/webworker-utils.js
    /foo/bar/webworker.js
