# Simple makefile is simple. See README.md.

INSTALL_DIR ?= /opt/local/share/node

.PHONY: test install

install:
	install -m 755 -d $(INSTALL_DIR)
	install -m 444 lib/webworker.js lib/webworker-utils.js \
		lib/webworker-child.js $(INSTALL_DIR)

test:
	for f in `ls ./test/test-*.js` ; do \
		NODE_PATH=$$NODE_PATH:./lib node $$f ; \
	done
