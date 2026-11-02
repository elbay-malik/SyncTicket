// A real pair of updates, not a mock: applied in this order they leave a document that works and
// encodes, and whose encoded bytes throw when loaded into a fresh one. So a relay that saved it
// wrote a row it could not read back. Found by byte-mutating ordinary updates and reducing.
//
// Bytes on purpose rather than built with Yjs: no Yjs client would write the second one, and the
// first has to be the document it was reduced against. Either on its own is harmless, as the tests
// show. If `decodeSnapshot` stops calling the pair damaged, a Yjs change has closed this route and
// the tests need a new example, not a weaker assertion.

const fromHex = (hex: string): Uint8Array =>
	Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));

/** 194 bytes: an ordinary document from client 100, with a nested map, an array and some text. */
export const UNRELOADABLE_BASE = fromHex(
	'011064002701066973737565730272310128006400057469746c650177015428006400066c6162656c7301750277016177016228006400016f01760201787d01017975027d017d0227006400036172720008006404027d01770374776f8764060183640701092700640004746578740204006409016884640a02656c84640c026c6fc6640a640b01620474727565c6640c640d0162046e756c6c45640a077b2269223a317d2901066973737565730273640273647601046d657461760101617d0100'
);

/** 227 bytes, which apply cleanly on top of {@link UNRELOADABLE_BASE} and poison what it encodes to. */
export const UNRELOADABLE_UPDATE = fromHex(
	'0208c80100a864010177015528006400036e6577017d05c86406017701780102640600c6640a640f01630131c40104640f03616263c60107640f0163046e756c6c270106697373756573027232011164002701066973737565730272310121006400057469746c650121006400066c6162656c7301000361727200010064040188640501770374776f870a640601640701092700640004746578740204006409016884640a02656c84644c026c6fc6640a640b01620474727565c6640c640d0162046e756c6c45640a077b2269223a317d210106697373756573027364010105011201'
);
