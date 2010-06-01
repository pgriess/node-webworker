var sys = require('sys');

onmessage = function(msg) {
    sys.debug('Received message: ' + sys.inspect(msg) + ' from master');

    postMessage('Come in here!'.split(' '));
    close();
};

sys.debug('Running with location=' + sys.inspect(self.location));
