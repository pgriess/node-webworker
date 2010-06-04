# Simple makefile is simple.

.PHONY: test

test:
	for f in `ls ./test/test-*.js` ; do \
		NODE_PATH=$$NODE_PATH:./lib node $$f ; \
	done
