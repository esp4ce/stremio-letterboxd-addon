import { Buffer } from 'node:buffer';

function box(type: string, ...children: Buffer[]): Buffer {
  const payload = Buffer.concat(children);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function fullBox(type: string, version: number, flags: number, payload: Buffer): Buffer {
  const vf = Buffer.alloc(4);
  vf.writeUInt32BE((version << 24) | flags, 0);
  return box(type, vf, payload);
}

function buildTinyMp4(): Buffer {
  // ftyp
  const ftyp = box('ftyp',
    Buffer.from('isom'),                    // major brand
    Buffer.from([0, 0, 2, 0]),              // minor version
    Buffer.from('isomiso2mp41'),            // compatible brands
  );

  // mvhd (version 0, timescale 600, duration 0)
  const mvhd = (() => {
    const b = Buffer.alloc(96);
    b.writeUInt32BE(600, 12);               // timescale
    b.writeUInt32BE(0, 16);                 // duration
    b.writeUInt32BE(0x00010000, 20);        // rate 1.0
    b.writeUInt16BE(0x0100, 24);            // volume 1.0
    // identity matrix at offset 36
    b.writeUInt32BE(0x00010000, 36);
    b.writeUInt32BE(0x00010000, 52);
    b.writeUInt32BE(0x40000000, 68);
    b.writeUInt32BE(2, 92);                 // next_track_id
    return fullBox('mvhd', 0, 0, b);
  })();

  // tkhd
  const tkhd = (() => {
    const b = Buffer.alloc(80);
    b.writeUInt32BE(1, 12);                 // track_id
    // duration = 0 at offset 20
    // identity matrix at offset 40
    b.writeUInt32BE(0x00010000, 40);
    b.writeUInt32BE(0x00010000, 56);
    b.writeUInt32BE(0x40000000, 72);
    return fullBox('tkhd', 0, 1, b);
  })();

  // mdhd
  const mdhd = (() => {
    const b = Buffer.alloc(20);
    b.writeUInt32BE(600, 8);                // timescale
    // duration = 0 at offset 12
    b.writeUInt16BE(0x55C4, 16);            // language: und
    return fullBox('mdhd', 0, 0, b);
  })();

  // hdlr
  const hdlr = fullBox('hdlr', 0, 0, Buffer.concat([
    Buffer.alloc(4),                         // pre-defined
    Buffer.from('vide'),                     // handler type
    Buffer.alloc(12),                        // reserved
    Buffer.from('VideoHandler\0'),           // name
  ]));

  // vmhd
  const vmhd = fullBox('vmhd', 0, 1, Buffer.alloc(8));

  // dinf > dref
  const dref = fullBox('dref', 0, 0, Buffer.concat([
    Buffer.from([0, 0, 0, 1]),               // entry count
    fullBox('url ', 0, 1, Buffer.alloc(0)),   // self-contained
  ]));
  const dinf = box('dinf', dref);

  // stbl with empty tables
  const stsd = fullBox('stsd', 0, 0, Buffer.from([0, 0, 0, 0])); // 0 entries
  const stts = fullBox('stts', 0, 0, Buffer.from([0, 0, 0, 0]));
  const stsc = fullBox('stsc', 0, 0, Buffer.from([0, 0, 0, 0]));
  const stsz = fullBox('stsz', 0, 0, Buffer.alloc(8));            // sample_size=0, count=0
  const stco = fullBox('stco', 0, 0, Buffer.from([0, 0, 0, 0]));
  const stbl = box('stbl', stsd, stts, stsc, stsz, stco);

  const minf = box('minf', vmhd, dinf, stbl);
  const mdia = box('mdia', mdhd, hdlr, minf);
  const trak = box('trak', tkhd, mdia);
  const moov = box('moov', mvhd, trak);

  return Buffer.concat([ftyp, moov]);
}

export const TINY_MP4 = buildTinyMp4();
