/**
 * Aduce un WAV PCM 16-bit (cum îl dă vocea din browser, 22 kHz) la mono 8 kHz — calitatea telefoniei. Fișierele ies de ~16 KB/s
 * (un mesaj de 10 s ≈ 160 KB), deci încap multe într-o arhivă de câțiva MB pentru autoinformarea din PBX.
 */
export async function wavToTelephony(blob: Blob, targetRate = 8000): Promise<Uint8Array> {
  const view = new DataView(await blob.arrayBuffer());
  const tag = (p: number) => String.fromCharCode(view.getUint8(p), view.getUint8(p + 1), view.getUint8(p + 2), view.getUint8(p + 3));
  if (view.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Format audio neașteptat");

  let pos = 12;
  let rate = 22050;
  let channels = 1;
  let bits = 16;
  let dataStart = -1;
  let dataLen = 0;
  while (pos + 8 <= view.byteLength) {
    const id = tag(pos);
    const size = view.getUint32(pos + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(pos + 10, true);
      rate = view.getUint32(pos + 12, true);
      bits = view.getUint16(pos + 22, true);
    } else if (id === "data") {
      dataStart = pos + 8;
      dataLen = Math.min(size, view.byteLength - dataStart);
      break;
    }
    pos += 8 + size + (size & 1);
  }
  if (dataStart < 0 || bits !== 16 || channels < 1) throw new Error("Format audio neașteptat");

  const frames = Math.floor(dataLen / (2 * channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += view.getInt16(dataStart + (i * channels + c) * 2, true);
    mono[i] = sum / channels;
  }

  // reeșantionare cu mediere pe fereastră (filtru simplu împotriva aliasing-ului)
  const ratio = rate / targetRate;
  const outLen = Math.max(1, Math.floor(frames / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(frames, Math.max(from + 1, Math.ceil((i + 1) * ratio)));
    let sum = 0;
    for (let j = from; j < to; j++) sum += mono[j];
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sum / (to - from))));
  }

  const bytes = new Uint8Array(44 + out.length * 2);
  const dv = new DataView(bytes.buffer);
  const put = (p: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(p + i, s.charCodeAt(i)); };
  put(0, "RIFF"); dv.setUint32(4, 36 + out.length * 2, true); put(8, "WAVE");
  put(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, targetRate, true); dv.setUint32(28, targetRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  put(36, "data"); dv.setUint32(40, out.length * 2, true);
  for (let i = 0; i < out.length; i++) dv.setInt16(44 + i * 2, out[i], true);
  return bytes;
}
