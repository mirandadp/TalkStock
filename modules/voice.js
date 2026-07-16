// ══════════════════════════════════════════════
// MÓDULO: RECONOCIMIENTO DE VOZ (WHISPER)
// ══════════════════════════════════════════════

let isRecording = false;
let whisperPipeline = null;
let whisperLoading = false;
let whisperReady = false;
let transformersLib = null;
let qwenTextPipeline = null;
let qwenTextLoading = false;
let qwenTextReady = false;
let mediaStream = null, mediaRecorder = null, audioChunks = [];
let vadContext = null, vadAnalyser = null, vadRaf = null;
let recordStartTime = null, silenceStart = null, spokeAtLeastOnce = false;
let pendingBtnId = null, pendingLabelId = null;

const SILENCE_THRESHOLD = 0.015;
const SILENCE_DURATION = 1100;
const MAX_RECORD_MS = 12000;

function initVoice() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const hint = document.querySelector('#wiz-idle p');
        if (hint) hint.textContent = '⚠️ Este navegador no permite acceso al micrófono.';
        return;
    }
    ensureWhisperLoaded().catch(() => { });
}

async function ensureWhisperLoaded(onProgress) {
    if (whisperPipeline) return whisperPipeline;
    if (whisperLoading) {
        while (whisperLoading) await new Promise(r => setTimeout(r, 200));
        return whisperPipeline;
    }
    whisperLoading = true;
    try {
        const mod = await loadTransformersLibrary();
        const { pipeline, env } = mod;
        if (env) {
            env.allowRemoteModels = true;
            env.allowLocalModels = false;
            env.useBrowserCache = true;
            if (env.backends?.onnx?.wasm) {
                env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';
            }
        }
        whisperPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
            progress_callback: p => { if (onProgress) onProgress(p); }
        });
        whisperReady = true;
    } catch (e) {
        console.error('Error cargando Whisper local:', e);
        toast('No se pudo cargar el reconocimiento de voz local', 'error');
    } finally {
        whisperLoading = false;
    }
    return whisperPipeline;
}

async function ensureQwenVoiceModel(onProgress) {
    if (qwenTextPipeline) return qwenTextPipeline;
    if (qwenTextLoading) {
        while (qwenTextLoading) await new Promise(r => setTimeout(r, 200));
        return qwenTextPipeline;
    }
    qwenTextLoading = true;
    try {
        const mod = await loadTransformersLibrary();
        const { pipeline, env } = mod;
        if (env) {
            env.allowRemoteModels = true;
            env.allowLocalModels = false;
            env.useBrowserCache = true;
        }
        const candidates = ['Qwen/Qwen2.5-Coder-3B-Instruct', 'Xenova/Qwen2.5-Coder-3B-Instruct'];
        let lastError = null;
        for (const modelId of candidates) {
            try {
                qwenTextPipeline = await pipeline('text-generation', modelId, {
                    progress_callback: p => { if (onProgress) onProgress(p); }
                });
                qwenTextReady = true;
                return qwenTextPipeline;
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError || new Error('No se pudo cargar el modelo Qwen');
    } catch (e) {
        console.warn('No se pudo cargar Qwen para normalizar voz:', e);
        return null;
    } finally {
        qwenTextLoading = false;
    }
}

async function normalizeVoiceTextWithQwen(rawText) {
    if (!rawText) return rawText;
    try {
        const model = await ensureQwenVoiceModel();
        if (!model) return rawText;
        const prompt = `Corrige y normaliza este texto de voz al español. Responde solo con el texto corregido, sin explicaciones.\nTexto: ${rawText}\nTexto corregido:`;
        const result = await model(prompt, { max_new_tokens: 80, temperature: 0.2, do_sample: false });
        const generated = Array.isArray(result) ? result[0]?.generated_text : result?.generated_text;
        const normalized = typeof generated === 'string'
            ? generated.replace(/^.*Texto corregido:\s*/is, '').trim()
            : '';
        return normalized || rawText;
    } catch (e) {
        console.warn('Error aplicando Qwen a la voz:', e);
        return rawText;
    }
}

function startListening(btnId, labelId) {
    if (isRecording) return;
    pendingBtnId = btnId; pendingLabelId = labelId;

    navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true }
    }).then(stream => {
        mediaStream = stream;
        audioChunks = [];
        const mimeType = (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
            ? 'audio/webm;codecs=opus' : '';
        mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = () => finishRecording();
        mediaRecorder.start();

        isRecording = true;
        recordStartTime = Date.now();
        spokeAtLeastOnce = false;
        silenceStart = null;

        document.querySelectorAll('.mic-btn,.mic-btn-sm').forEach(b => b.classList.add('recording'));
        const btn = document.getElementById(btnId);
        if (btn) btn.classList.add('recording');
        if (labelId) { const lbl = document.getElementById(labelId); if (lbl) lbl.textContent = 'Escuchando...'; }

        if (!whisperReady) {
            updateWizVoiceText('🎙️ Escuchando… (preparando reconocimiento local)', true);
        }

        startSilenceDetection(stream);
    }).catch(() => {
        toast('Micrófono no permitido — actívalo en el navegador', 'error');
    });
}

function startSilenceDetection(stream) {
    vadContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = vadContext.createMediaStreamSource(stream);
    vadAnalyser = vadContext.createAnalyser();
    vadAnalyser.fftSize = 512;
    source.connect(vadAnalyser);
    const data = new Uint8Array(vadAnalyser.fftSize);

    const tick = () => {
        if (!isRecording) return;
        vadAnalyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sumSq += v * v; }
        const rms = Math.sqrt(sumSq / data.length);
        const elapsed = Date.now() - recordStartTime;

        if (rms > SILENCE_THRESHOLD) {
            spokeAtLeastOnce = true;
            silenceStart = null;
        } else if (spokeAtLeastOnce) {
            if (silenceStart === null) silenceStart = Date.now();
            else if (Date.now() - silenceStart > SILENCE_DURATION) { stopListening(); return; }
        }

        if (elapsed > MAX_RECORD_MS) { stopListening(); return; }
        vadRaf = requestAnimationFrame(tick);
    };
    vadRaf = requestAnimationFrame(tick);
}

function stopSilenceDetection() {
    if (vadRaf) cancelAnimationFrame(vadRaf);
    vadRaf = null;
    if (vadContext) { try { vadContext.close(); } catch (e) { } vadContext = null; }
    vadAnalyser = null;
}

function stopListening() {
    if (!isRecording) return;
    isRecording = false;
    stopSilenceDetection();
    document.querySelectorAll('.mic-btn,.mic-btn-sm').forEach(b => b.classList.remove('recording'));
    try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch (e) { }
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
}

async function finishRecording() {
    const lbl = document.getElementById('micBtnStepLabel');
    if (lbl) lbl.textContent = 'Hablar';

    if (!audioChunks.length) return;
    const blob = new Blob(audioChunks, { type: audioChunks[0].type || 'audio/webm' });
    audioChunks = [];

    updateWizVoiceText('🧠 Transcribiendo…', true);

    try {
        const float32 = await blobToWhisperInput(blob);
        const pipe = await ensureWhisperLoaded(p => {
            if (p && p.status === 'progress') {
                const pct = Math.round(p.progress || 0);
                updateWizVoiceText(`⬇️ Descargando modelo de voz local… ${pct}%`, true);
            }
        });
        if (!pipe) { updateWizVoiceText('No se pudo cargar el reconocimiento de voz', 'false'); return; }

        const result = await pipe(float32, { language: 'spanish', task: 'transcribe', chunk_length_s: 15 });
        const rawText = (result?.text || '').trim();

        if (!rawText) {
            updateWizVoiceText('No se detectó voz clara — inténtalo de nuevo', false);
            return;
        }
        const normalizedDraft = normalizeNumbersInText(rawText);
        const finalText = await normalizeVoiceTextWithQwen(normalizedDraft);
        const text = normalizeNumbersInText(finalText || normalizedDraft);
        updateWizVoiceText(text, false);
        wizProcessSpeech(text);
    } catch (e) {
        console.error('Error de transcripción Whisper:', e);
        updateWizVoiceText('Error al transcribir — inténtalo de nuevo', false);
    }
}

async function blobToWhisperInput(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    const targetRate = 16000;
    let channelData = decoded.getChannelData(0);

    if (decoded.sampleRate !== targetRate) {
        const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
        const src = offlineCtx.createBufferSource();
        src.buffer = decoded;
        src.connect(offlineCtx.destination);
        src.start();
        const rendered = await offlineCtx.startRendering();
        channelData = rendered.getChannelData(0);
    }
    try { audioCtx.close(); } catch (e) { }
    return channelData;
}

function updateWizVoiceText(text, interim) {
    const el = document.getElementById('wiz-voice-text');
    if (!el) return;
    el.textContent = (interim ? '🎙️ ' : '') + text + (interim ? '…' : '');
    el.classList.toggle('wiz-voice-active', true);
    if (!interim) setTimeout(() => el.classList.remove('wiz-voice-active'), 1000);
}

function wizListenTipo() {
    if (isRecording) { stopListening(); return; }
    startListening('micBtnIdle', null);
}

function wizListenStep() {
    if (isRecording) { stopListening(); return; }
    const el = document.getElementById('wiz-voice-text');
    if (el) { el.textContent = '🎙️ Escuchando...'; el.classList.add('wiz-voice-active'); }
    startListening('micBtnStep', 'micBtnStepLabel');
}

function phoneticKey(s) {
    let t = norm(s);
    t = t.replace(/[bv]/g, 'b').replace(/z/g, 's').replace(/c(?=[ei])/g, 's').replace(/qu/g, 'k').replace(/c(?=[aou])/g, 'k').replace(/h/g, '').replace(/ll/g, 'y').replace(/rr/g, 'r').replace(/[^a-z0-9]/g, '');
    return t;
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    const dp = [];
    for (let i = 0; i <= m; i++) { dp.push(new Array(n + 1).fill(0)); dp[i][0] = i; }
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[m][n];
}

function fuzzyMatch(a, b) {
    const ka = phoneticKey(a), kb = phoneticKey(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    if (ka.length >= 3 && kb.length >= 3 && (ka.includes(kb) || kb.includes(ka))) return true;
    const dist = levenshtein(ka, kb);
    const maxLen = Math.max(ka.length, kb.length);
    return dist <= Math.max(1, Math.floor(maxLen * 0.28));
}

function fuzzyScore(a, b) {
    const ka = phoneticKey(a), kb = phoneticKey(b);
    if (!ka || !kb) return 0;
    if (ka === kb) return 1;
    const dist = levenshtein(ka, kb);
    const maxLen = Math.max(ka.length, kb.length);
    return 1 - dist / maxLen;
}

const NUM_UNITS = {
    cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
    veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29
};
const NUM_TENS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const NUM_HUNDREDS = { cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900 };

function parseSpanishNumberWords(text) {
    const words = norm(text).split(/\s+/).filter(w => w && w !== 'y');
    if (!words.length) return null;
    let total = 0, current = 0;
    for (const w of words) {
        if (w === 'mil') { current = (current || 1) * 1000; total += current; current = 0; continue; }
        if (NUM_HUNDREDS[w] !== undefined) { current += NUM_HUNDREDS[w]; continue; }
        if (NUM_TENS[w] !== undefined) { current += NUM_TENS[w]; continue; }
        if (NUM_UNITS[w] !== undefined) { current += NUM_UNITS[w]; continue; }
        return null;
    }
    total += current;
    return total > 0 ? total : null;
}

function normalizeNumbersInText(text) {
    if (/\d/.test(text)) return text;
    const words = text.trim().split(/\s+/);
    for (let start = 0; start < words.length; start++) {
        for (let end = words.length; end > start; end--) {
            const segment = words.slice(start, end).join(' ');
            const val = parseSpanishNumberWords(segment);
            if (val !== null && val > 0) {
                return [...words.slice(0, start), String(val), ...words.slice(end)].join(' ');
            }
        }
    }
    return text;
}

async function loadTransformersLibrary() {
    if (transformersLib) return transformersLib;
    try {
        transformersLib = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    } catch (e1) {
        try {
            transformersLib = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js');
        } catch (e2) {
            throw e2;
        }
    }
    return transformersLib;
}

function speak(text) {
    try {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'es-ES'; utter.rate = 1.05; utter.pitch = 1;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
    } catch (e) { }
}
