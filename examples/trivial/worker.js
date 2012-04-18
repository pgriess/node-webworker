var worker = this;
worker.onmessage = function (message) {
    // echo
    worker.postMessage(message.data);
}

