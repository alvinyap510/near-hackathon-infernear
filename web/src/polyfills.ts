// The NEAR wallet libraries use Node's `Buffer` as a global when they sign a message; a browser
// has none, so signing with Meteor failed with "Buffer is not defined". This module is imported
// first, before anything that can load a wallet.
import { Buffer } from 'buffer';

const scope = globalThis as { Buffer?: typeof Buffer };
scope.Buffer ??= Buffer;
