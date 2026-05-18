// MediaRecorder wrapper for capturing the output canvas to a WebM/MP4 blob.
// Picks the best supported MIME type. On stop, triggers a download.

const PREFERRED_MIMES = [
  'video/webm; codecs="vp9, opus"',
  'video/webm; codecs="vp9"',
  'video/webm; codecs="vp8"',
  'video/webm',
  'video/mp4',
];

function pickMime() {
  for (const m of PREFERRED_MIMES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export function createRecorder(canvas, { fps = 60, bitrate = 8_000_000 } = {}) {
  let recorder = null;
  let chunks = [];
  let mime = '';
  let startedAt = 0;

  function start() {
    if (recorder) return;
    const stream = canvas.captureStream(fps);
    mime = pickMime();
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: bitrate } : { videoBitsPerSecond: bitrate });
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunks.push(e.data); };
    recorder.start(250); // emit chunks every 250ms (so we can incrementally accumulate)
    startedAt = performance.now();
  }

  function stop() {
    return new Promise((resolve) => {
      if (!recorder) return resolve(null);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mime || 'video/webm' });
        recorder = null;
        chunks = [];
        resolve(blob);
      };
      recorder.stop();
    });
  }

  async function stopAndDownload(filename = 'r0n1n.webm') {
    const blob = await stop();
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    return blob;
  }

  return {
    start,
    stop,
    stopAndDownload,
    get recording() { return !!recorder; },
    get elapsedMs() { return recorder ? performance.now() - startedAt : 0; },
    get mime() { return mime; },
  };
}
