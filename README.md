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

Each worker context (i.e. the global context of a worker object) has a
non-standard `onclose()` handler which is invoked when a worker is being
closed. This is intended to allow applications to perform graceful shutdown
and is needed because the worker runtime does not maintain knowledge of all
outstanding events, etc that the Web Workers spec seems to expect.

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
