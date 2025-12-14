import type { IpfsLike } from "./ipfsAdapter";
import { NoopIpfs } from "./nopAdapter";

export type DhtBlock = {
  headCid: string; // may be ""
  prevCid?: string;

  // include these so `headSig` can be verified anywhere
  merkleRoot?: string;
  pulse?: number;

  ipns?: string; // self-certifying name (optional)
  headSig?: string; // base64url(sig over headCid||merkleRoot||pulse)
  pubKeyJwk?: JsonWebKey;
  peersHint?: string[]; // optional bootstrap multiaddrs
};

export async function buildDhtBlock(opts: {
  ipfs?: IpfsLike; // optional -> defaults to NoopIpfs (sovereign/offline)
  packedLedgerBytes: Uint8Array;
  prevCid?: string;
  sign?: (msg: Uint8Array) => Promise<Uint8Array>;
  pubKeyJwk?: JsonWebKey;
  merkleRoot: string;
  pulse: number;
}): Promise<DhtBlock> {
  const {
    ipfs = NoopIpfs,
    packedLedgerBytes,
    prevCid,
    sign,
    pubKeyJwk,
    merkleRoot,
    pulse,
  } = opts;

  const { headCid } = await ipfs
    .publish(packedLedgerBytes)
    .catch((): { headCid: string } => ({ headCid: "" }));

  let headSig = "";
  if (headCid && sign) {
    const msg = new TextEncoder().encode(`${headCid}|${merkleRoot}|${pulse}`);
    const sig = await sign(msg);
    headSig = b64url(sig);
  }

  return { headCid, prevCid, merkleRoot, pulse, headSig, pubKeyJwk };
}

function b64url(bytes: Uint8Array): string {
  // avoid stack overflow on large arrays (no spread)
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    let s = "";
    for (let j = 0; j < chunk.length; j++) s += String.fromCharCode(chunk[j] ?? 0);
    bin += s;
  }

  // browser-safe base64
  const b64 = globalThis.btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
