# Simple makefile is simple. See README.md.

INSTALL_PREFIX ?= /opt/local

.PHONY: test install

install: test
	install -m 755 -d \
		$(INSTALL_PREFIX)/lib/node $(INSTALL_PREFIX)/libexec/node
	install -m 444 lib/webworker.js lib/webworker-utils.js \
		$(INSTALL_PREFIX)/lib/node
	install -m 444 libexec/worker.js $(INSTALL_PREFIX)/libexec/node

test:
	for f in `ls ./test/test-*.js` ; do \
		NODE_PATH=$$NODE_PATH:./lib/node node $$f ; \
	done
