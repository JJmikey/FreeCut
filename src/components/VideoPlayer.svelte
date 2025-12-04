<script>
    import { onMount } from 'svelte';
    import { currentVideoSource, currentTime, isPlaying } from '../stores/playerStore';
    import { mainTrackClips, audioTrackClips, textTrackClips, draggedFile, projectSettings, uploadedFiles, generateId, resolveOverlaps, createTextClip } from '../stores/timelineStore';
    import { isExporting, startExportTrigger } from '../stores/exportStore';
    import { addToHistory } from '../stores/historyStore';
    import { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } from 'mp4-muxer';
    import { get } from 'svelte/store';
    
    import { decodeGifFrames } from '../utils/gifHelper';
    import { generateThumbnails } from '../utils/thumbnailGenerator';
    import { generateWaveform } from '../utils/waveformGenerator';

    let videoRef;
    let audioRef; 
    let imageRef;
    let canvasRef;
    let containerWidth = 0;
    let lastTime = 0;
    
    let exportProgress = 0;
    let exportStatus = "";
    let estimatedTimeText = ""; 
    let exportStartTime = 0;    
    
    let isProcessingDrag = false;

    onMount(() => {
        isExporting.set(false);
        startExportTrigger.set(0);
    });

    // ============================================================
    // Reactive State
    // ============================================================
    
    $: maxMain = $mainTrackClips.length > 0 ? Math.max(...$mainTrackClips.map(c => c.startOffset + c.duration)) : 0;
    $: maxAudio = $audioTrackClips.length > 0 ? Math.max(...$audioTrackClips.map(c => c.startOffset + c.duration)) : 0;
    $: maxText = $textTrackClips.length > 0 ? Math.max(...$textTrackClips.map(c => c.startOffset + c.duration)) : 0;
    
    $: contentDuration = Math.max(maxMain, maxAudio, maxText);
    $: hasClips = contentDuration > 0;
    $: previewRatio = (containerWidth && $projectSettings?.width) ? (containerWidth / $projectSettings.width) : 1;

    $: isSourceMode = !!$currentVideoSource;
    $: activeClip = $mainTrackClips.find(clip => $currentTime >= clip.startOffset && $currentTime < (clip.startOffset + clip.duration));
    $: activeAudioClip = $audioTrackClips.find(clip => $currentTime >= clip.startOffset && $currentTime < (clip.startOffset + clip.duration));
    $: activeTextClip = $textTrackClips.find(clip => $currentTime >= clip.startOffset && $currentTime < (clip.startOffset + clip.duration));
  
    // 監聽導出觸發 (防止幽靈觸發)
    $: if ($startExportTrigger > 0) {
        if (!$isExporting && hasClips) {
            fastExportProcess();
        } else if (!hasClips) {
            console.log("Export clicked but timeline is empty. Resetting trigger.");
            startExportTrigger.set(0);
        }
    }

    // 類型判斷 Helper
    const isVideoType = (type) => type && (type.startsWith('video') || type === 'video/quicktime' || type === 'application/octet-stream');
    const isAudioType = (type) => type && type.startsWith('audio');
    const isImageType = (type) => type && type.startsWith('image');

    // Sync Video / Image
    $: if (!$isExporting && !isSourceMode) {
        if (activeClip) {
            if (isVideoType(activeClip.type)) {
                if (videoRef) {
                    if (!videoRef.src.includes(activeClip.fileUrl)) videoRef.src = activeClip.fileUrl;
                    videoRef.volume = activeClip.volume !== undefined ? activeClip.volume : 1.0;
                    const seekTime = ($currentTime - activeClip.startOffset) + (activeClip.mediaStartOffset || 0);
                    if ((!$isPlaying || Math.abs(videoRef.currentTime - seekTime) > 0.25) && !videoRef.seeking) {
                        videoRef.currentTime = seekTime;
                    }
                }
            } else if (isImageType(activeClip.type)) {
                if (imageRef && !imageRef.src.includes(activeClip.fileUrl)) imageRef.src = activeClip.fileUrl;
            }
        } else {
            if (videoRef && videoRef.src) videoRef.removeAttribute('src');
            if (imageRef && imageRef.src) imageRef.removeAttribute('src');
        }

        if (activeAudioClip && audioRef) {
            if (!audioRef.src.includes(activeAudioClip.fileUrl)) audioRef.src = activeAudioClip.fileUrl;
            audioRef.volume = activeAudioClip.volume !== undefined ? activeAudioClip.volume : 1.0;
            const audioSeekTime = ($currentTime - activeAudioClip.startOffset) + (activeAudioClip.mediaStartOffset || 0);
            if ((!$isPlaying || Math.abs(audioRef.currentTime - audioSeekTime) > 0.25) && !audioRef.seeking) {
                audioRef.currentTime = audioSeekTime;
            }
        } else if (audioRef) {
            if (audioRef.src) audioRef.removeAttribute('src');
        }
    }

    // Source Preview Mode Sync
    $: if (isSourceMode && !$isExporting) {
        const src = $currentVideoSource;
        if (isVideoType(src.type)) {
            if (videoRef && videoRef.src !== src.url) { 
                videoRef.src = src.url; 
                videoRef.volume = 1.0; 
                videoRef.play().catch(e => {}); 
            }
            if (audioRef) audioRef.pause();
        } else if (isAudioType(src.type)) {
            if (audioRef && audioRef.src !== src.url) { 
                audioRef.src = src.url; 
                audioRef.volume = 1.0; 
                audioRef.play().catch(e => {}); 
            }
            if (videoRef) { videoRef.pause(); videoRef.removeAttribute('src'); }
        } else if (isImageType(src.type)) {
            if (imageRef && imageRef.src !== src.url) imageRef.src = src.url;
            if (videoRef) videoRef.pause(); if (audioRef) audioRef.pause();
        }
    }

    // Play/Pause Control
    $: if (!$isExporting) {
        if ($isPlaying && !isSourceMode) {
            if (videoRef && activeClip && isVideoType(activeClip.type)) videoRef.play().catch(() => {});
            if (audioRef && activeAudioClip) audioRef.play().catch(() => {});
        } else if (isSourceMode) {
        } else {
            if (videoRef) videoRef.pause();
            if (audioRef) audioRef.pause();
        }
    }

    // Loop Logic
    $: if ($isPlaying && !$isExporting && !isSourceMode) {
        lastTime = performance.now();
        requestAnimationFrame(loop);
    }

    // ============================================================
    // Main Handlers
    // ============================================================

    function togglePlay() {
        if (isSourceMode) {
            const type = $currentVideoSource.type;
            if (isVideoType(type)) {
                videoRef.paused ? videoRef.play() : videoRef.pause();
            } else if (isAudioType(type)) {
                audioRef.paused ? audioRef.play() : audioRef.pause();
            }
            return;
        }
        if (!hasClips || $isExporting) return;
        if (!$isPlaying && $currentTime >= contentDuration) currentTime.set(0);
        isPlaying.update(v => !v);
    }
    
    function loop(timestamp) {
        if (!$isPlaying || $isExporting || isSourceMode) return;
        if (contentDuration === 0) { isPlaying.set(false); currentTime.set(0); return; }
        const deltaTime = (timestamp - lastTime) / 1000;
        lastTime = timestamp;
        currentTime.update(t => t + deltaTime);
        if ($currentTime >= contentDuration) {
            isPlaying.set(false);
            currentTime.set(contentDuration);
            return;
        }
        requestAnimationFrame(loop);
    }

    function addToProject() {
        const source = $currentVideoSource;
        if (!source) return;

        const targetStore = isAudioType(source.type) ? audioTrackClips : mainTrackClips;
        const currentClips = get(targetStore);
        
        const insertTime = currentClips.length > 0 
            ? Math.max(...currentClips.map(c => c.startOffset + c.duration)) 
            : 0;

        const newClip = {
            id: generateId(),
            fileUrl: source.url || source.fileUrl,
            name: source.name,
            type: source.type,
            startOffset: insertTime,
            duration: source.duration || 5,
            sourceDuration: isImageType(source.type) ? Infinity : (source.duration || 5),
            mediaStartOffset: 0,
            volume: 1.0,
            file: source.file,
            thumbnails: source.thumbnails || [],
            thumbnailUrls: source.thumbnailUrls || [],
            waveform: source.waveform
        };

        targetStore.update(clips => resolveOverlaps([...clips, newClip], newClip.id));
        currentVideoSource.set(null);
        currentTime.set(insertTime);
    }

    async function loadSampleProject() {
        try {
            isProcessingDrag = true; 
            const [vidRes, audRes] = await Promise.all([fetch('/sample_video.mp4'), fetch('/sample_audio.mp3')]);
            if (!vidRes.ok || !audRes.ok) throw new Error(`Sample files missing.`);
            const vidBlob = await vidRes.blob(); const audBlob = await audRes.blob();
            const vidFile = new File([vidBlob], "Demo_Video.mp4", { type: "video/mp4" });
            const audFile = new File([audBlob], "Demo_Music.mp3", { type: "audio/mpeg" });
            const vidUrl = URL.createObjectURL(vidFile);
            const info = await getMediaDuration(vidFile, vidUrl);
            const vidDuration = info ? info.duration : 10;
            const thumbs = await generateThumbnails(vidFile, vidDuration);
            const thumbUrls = thumbs.map(b => URL.createObjectURL(b));
            const audUrl = URL.createObjectURL(audFile);
            const audInfo = await getMediaDuration(audFile, audUrl);
            const audDuration = audInfo ? audInfo.duration : 10;
            const waveform = await generateWaveform(audFile);
            const sampleFiles = [
                { name: vidFile.name, type: vidFile.type, url: vidUrl, duration: vidDuration, file: vidFile, thumbnails: thumbs, thumbnailUrls: thumbUrls },
                { name: audFile.name, type: audFile.type, url: audUrl, duration: audDuration, file: audFile, waveform: waveform }
            ];
            uploadedFiles.update(curr => [...curr, ...sampleFiles]);
            mainTrackClips.update(clips => [{
                id: generateId(), fileUrl: vidUrl, name: vidFile.name, type: vidFile.type,
                startOffset: 0, duration: vidDuration, sourceDuration: vidDuration, mediaStartOffset: 0, volume: 1.0,
                file: vidFile, thumbnails: thumbs, thumbnailUrls: thumbUrls
            }]);
            audioTrackClips.update(clips => [{
                id: generateId(), fileUrl: audUrl, name: audFile.name, type: audFile.type,
                startOffset: 0, duration: audDuration, sourceDuration: audDuration, mediaStartOffset: 0, volume: 0.5,
                file: audFile, waveform: waveform
            }]);
            textTrackClips.update(clips => [{
                id: generateId(), type: 'text', name: 'Text', startOffset: 0, duration: 5, sourceDuration: Infinity,
                text: "✨FastVideoCutter", fontSize: 28, color: '#ffffff', fontWeight: 'bold', fontFamily: 'Arial, sans-serif',
                x: 90, y: 85, volume: 1.0, showBackground: true, backgroundColor: '#00000080', strokeWidth: 0, strokeColor: '#000000'
            }]);
            if (typeof window !== 'undefined') fetch('/api/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'sample', filename: 'Demo Project', duration: '10' }) }).catch(e => {});
        } catch (e) { console.error(e); alert("Failed to load sample project."); } finally { isProcessingDrag = false; }
    }
  
    async function handlePreviewDrop(e) {
        e.preventDefault(); if ($isExporting) return;
        const jsonString = e.dataTransfer.getData('application/json');
        if (jsonString) {
            try {
                const data = JSON.parse(jsonString); const storeFile = get(draggedFile);
                currentVideoSource.set({ ...data, file: storeFile?.file, thumbnails: storeFile?.thumbnails, waveform: storeFile?.waveform });
                return;
            } catch (err) { console.error("Internal drop failed", err); }
        }
        const files = Array.from(e.dataTransfer.files); if (files.length === 0) return;
        isProcessingDrag = true;
        try {
            const processedPromises = files.map(async (file) => {
                if (file.size > 2 * 1024 * 1024 * 1024) { alert(`File too large: ${file.name}`); return null; }
                const url = URL.createObjectURL(file);
                const info = await getMediaDuration(file, url);
                if (!info) return null;
                const { duration, width, height } = info;
                const DURATION_LIMIT = 1800; 
                if (duration > DURATION_LIMIT) { if (!confirm(
                    `⚠️ Large File Warning: "${file.name}"\n\n` +
                      `This video is over 30 minutes long (${Math.floor(duration/60)} mins).\n` +
                      `Browser-based editing may run out of memory and crash with large files.\n\n` +
                      `We recommend trimming it into shorter segments.\n` +
                      `Do you still want to proceed?`)) return null; }
                const thumbnailBlobs = await generateThumbnails(file, duration);
                const thumbnailUrls = thumbnailBlobs.map(b => URL.createObjectURL(b));
                let waveform = null;
                if (isAudioType(file.type) || isVideoType(file.type)) waveform = await generateWaveform(file);
                return { name: file.name, type: file.type || 'video/mp4', url: url, duration: duration, width, height, file: file, thumbnails: thumbnailBlobs, waveform: waveform, thumbnailUrls: thumbnailUrls };
            });
            const results = await Promise.all(processedPromises);
            const validFiles = results.filter(r => r !== null);
            
            const currentClips = get(mainTrackClips);
            if (currentClips.length === 0 && validFiles.length > 0) {
                const firstVideo = validFiles.find(f => (isVideoType(f.type) || f.name.endsWith('.mov')) && f.width > 0);
                if (firstVideo) {
                    addToHistory();
                    console.log(`[Drag] Auto-set canvas: ${firstVideo.width}x${firstVideo.height}`);
                    // 🔥🔥🔥 修正為 'original'，解決顯亮問題 🔥🔥🔥
                    projectSettings.update(s => ({ ...s, width: firstVideo.width, height: firstVideo.height, aspectRatio: 'original' }));
                }
            }
            uploadedFiles.update(current => [...current, ...validFiles]);
            if (validFiles.length > 0) {
                currentVideoSource.set(validFiles[0]);
                if (typeof window !== 'undefined') {
                    const firstFile = validFiles[0];
                    fetch('/api/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'import', filename: firstFile.name, fileCount: validFiles.length, duration: firstFile.duration ? Math.round(firstFile.duration) : 0 }) }).catch(e => {});
                }
            }
        } catch (err) { console.error("Drop failed:", err); } finally { isProcessingDrag = false; }
    }

    function handleExternalDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    function triggerUpload() { const input = document.getElementById('global-file-input'); if (input) input.click(); }
    function handleDragStart(e) {
        const source = isSourceMode ? $currentVideoSource : activeClip;
        if (!source) { e.preventDefault(); return; }
        if (source.file) draggedFile.set({ file: source.file, thumbnails: source.thumbnails, waveform: source.waveform });
        const dragData = JSON.stringify({
            url: source.url || source.fileUrl, name: source.name, type: source.type,
            duration: source.sourceDuration || source.duration || 5,
            thumbnailUrls: source.thumbnailUrls || [], waveform: source.waveform
        });
        e.dataTransfer.setData('application/json', dragData);
        e.dataTransfer.effectAllowed = 'copy';
    }

    async function chooseAudioEncoderConfig() {
        const aac = { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2, bitrate: 128_000 };
        try {
            const ok = await AudioEncoder.isConfigSupported(aac);
            if (ok.supported) return { config: aac, muxerCodec: 'aac', sampleRate: 44100 };
        } catch (_) {}
        const opus = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128_000 };
        try {
            const ok2 = await AudioEncoder.isConfigSupported(opus);
            if (ok2.supported) return { config: opus, muxerCodec: 'opus', sampleRate: 48000 };
        } catch (_) {}
        throw new Error('No supported audio encoder (AAC/Opus) available.');
    }

    // ------------------------------------------------
    // 🔥🔥🔥 Export Logic (Full Integrated) 🔥🔥🔥
    // ------------------------------------------------
    async function fastExportProcess() {
        const preventClose = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', preventClose);

        let currentProcessingClip = null;
        let fileHandle = null;
        let writableStream = null; 
        
        const offscreenVideo = document.createElement('video');
        offscreenVideo.crossOrigin = "anonymous"; offscreenVideo.muted = true; offscreenVideo.playsInline = true; offscreenVideo.preload = 'auto';

        try {
            isExporting.set(true); isPlaying.set(false); if (videoRef) videoRef.pause(); if (audioRef) audioRef.pause();
            exportProgress = 0; exportStatus = "Initializing..."; estimatedTimeText = "Calculating..."; exportStartTime = Date.now(); 
            if (typeof window !== 'undefined') fetch('/api/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'export_start', filename: 'Exporting...', duration: contentDuration.toFixed(1) }) }).catch(() => {});

            let width = $projectSettings.width;
            let height = $projectSettings.height;
            if (width % 2 !== 0) width -= 1; if (height % 2 !== 0) height -= 1;
            if (width < 2) width = 2; if (height < 2) height = 2;
            console.log(`Exporting with safe resolution: ${width}x${height}`);

            const fps = 30;
            const durationInSeconds = contentDuration; 
            const totalFrames = Math.ceil(durationInSeconds * fps);
            
            let muxerTarget;
            if (typeof window.showSaveFilePicker === 'function') {
                try {
                    fileHandle = await window.showSaveFilePicker({ suggestedName: `fastvideocutter_${Date.now()}.mp4`, types: [{ description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } }] });
                    writableStream = await fileHandle.createWritable(); muxerTarget = new FileSystemWritableFileStreamTarget(writableStream);
                } catch (err) {
                    if (err.name === 'AbortError') { isExporting.set(false); window.removeEventListener('beforeunload', preventClose); return; }
                    console.warn("FS API failed:", err); muxerTarget = new ArrayBufferTarget(); 
                }
            } else { muxerTarget = new ArrayBufferTarget(); }

            // Audio & Muxer Setup
            exportStatus = "Preparing Audio...";
            const { config: audioConfig, muxerCodec: audioMuxCodec, sampleRate: AUDIO_SR } = await chooseAudioEncoderConfig();

            const muxer = new Muxer({
                target: muxerTarget,
                video: { codec: 'avc', width, height },
                audio: { codec: audioMuxCodec, numberOfChannels: 2, sampleRate: AUDIO_SR },
                fastStart: muxerTarget instanceof ArrayBufferTarget ? false : 'in-memory', 
            });

            const videoEncoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { throw e; } });
            const targetBitrate = getSmartBitrate(width, height, fps);
            let codecString = 'avc1.64002a'; if (width > 1920 || height > 1080) codecString = 'avc1.640033'; 
            const videoConfig = { codec: codecString, width, height, bitrate: targetBitrate, framerate: fps, latencyMode: 'quality' };
            const vSupport = await VideoEncoder.isConfigSupported(videoConfig);
            if (!vSupport.supported) {
                videoConfig.codec = 'avc1.4d002a'; const vSupportMain = await VideoEncoder.isConfigSupported(videoConfig);
                if (!vSupportMain.supported) videoConfig.codec = 'avc1.42002a';
            }
            await videoEncoder.configure(videoConfig);

            // Audio Queue (Buffer before Mux)
            const audioQueue = [];
            const audioEncoder = new AudioEncoder({ 
                output: (chunk, meta) => { audioQueue.push({ chunk, meta, timestamp: chunk.timestamp }); },
                error: (e) => console.error("Audio Error:", e)
            });
            audioEncoder.configure(audioConfig);

            exportStatus = "Mixing Audio...";
            const allClips = [...$mainTrackClips, ...$audioTrackClips];
            const mixedBuffer = await mixAllAudio(allClips, durationInSeconds, AUDIO_SR);
            
            if (mixedBuffer) {
                const left = mixedBuffer.getChannelData(0); const right = mixedBuffer.getChannelData(1);
                const interleaved = convertFloat32ToInt16(interleave(left, right));
                const chunkSize = AUDIO_SR; const totalSamples = mixedBuffer.length;

                for (let i = 0; i < totalSamples; i += chunkSize) {
                    if (audioEncoder.state !== 'configured') { console.warn("Audio encoder closed."); break; }
                    const len = Math.min(chunkSize, totalSamples - i); const chunkData = interleaved.slice(i * 2, (i + len) * 2);
                    const audioData = new AudioData({
                        format: 's16', sampleRate: AUDIO_SR, numberOfFrames: len, numberOfChannels: 2,
                        timestamp: Math.round((i / AUDIO_SR) * 1_000_000), data: chunkData
                    });
                    try { audioEncoder.encode(audioData); } catch(e) { console.warn(e); }
                    audioData.close();
                }
                // Safe Flush
                try { if (audioEncoder.state === 'configured') await audioEncoder.flush(); } catch(e) { console.warn("Audio flush warn:", e); }
            }

            exportStatus = "Decoding GIFs...";
            const gifCache = {}; const imageClips = $mainTrackClips.filter(c => c.type === 'image/gif');
            for (const clip of imageClips) { try { const decoded = await decodeGifFrames(clip.fileUrl); gifCache[clip.id] = decoded; } catch (e) { } }

            exportStatus = "Rendering Video...";
            const ctx = canvasRef.getContext('2d', { willReadFrequently: true, alpha: false });
            canvasRef.width = width; canvasRef.height = height;
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

            let audioWriteIndex = 0;

            for (let i = 0; i < totalFrames; i++) {
                if (videoEncoder.state === 'closed') throw new Error("Video Encoder crashed.");
                const timeInSeconds = i / fps; const timestampMicros = i * (1_000_000 / fps);
                exportProgress = Math.round((i / totalFrames) * 100);
                if (i % 30 === 0) { estimatedTimeText = updateETR(timeInSeconds, durationInSeconds); await new Promise(r => setTimeout(r, 0)); }

                const activeClip = $mainTrackClips.find(clip => timeInSeconds >= clip.startOffset && timeInSeconds < (clip.startOffset + clip.duration));
                const activeText = $textTrackClips.find(clip => timeInSeconds >= clip.startOffset && timeInSeconds < (clip.startOffset + clip.duration));
                currentProcessingClip = activeClip;

                ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);

                if (activeClip) {
                    let sourceElement = null; let sw, sh;
                    if (activeClip.type === 'image/gif' && gifCache[activeClip.id]) {
                        const gifData = gifCache[activeClip.id]; const clipInternalTime = (timeInSeconds - activeClip.startOffset) + (activeClip.mediaStartOffset || 0);
                        const loopTime = clipInternalTime % gifData.totalDuration; const frameObj = gifData.frames.find(f => loopTime >= f.startTime && loopTime < (f.startTime + f.duration));
                        if (frameObj) { sourceElement = frameObj.image; sw = sourceElement.displayWidth; sh = sourceElement.displayHeight; }
                    } else if (isVideoType(activeClip.type)) {
                        sourceElement = offscreenVideo;
                        if (!offscreenVideo.src.includes(activeClip.fileUrl)) { offscreenVideo.src = activeClip.fileUrl; await new Promise(r => offscreenVideo.onloadedmetadata = r); }
                        const seekTime = (timeInSeconds - activeClip.startOffset) + (activeClip.mediaStartOffset || 0);
                        await new Promise((resolve) => { const onSeeked = () => { offscreenVideo.removeEventListener('seeked', onSeeked); resolve(); }; offscreenVideo.addEventListener('seeked', onSeeked); offscreenVideo.currentTime = seekTime; });
                        sw = offscreenVideo.videoWidth; sh = offscreenVideo.videoHeight;
                    } else if (isImageType(activeClip.type)) {
                        sourceElement = imageRef;
                        if (!imageRef.src.includes(activeClip.fileUrl)) { imageRef.src = activeClip.fileUrl; await new Promise((resolve) => { if (imageRef.complete) resolve(); else imageRef.onload = resolve; }); }
                        sw = imageRef.naturalWidth; sh = imageRef.naturalHeight;
                    }
                    if (sourceElement && sw && sh) {
                        const r = Math.min(width / sw, height / sh); const dw = Math.round(sw * r); const dh = Math.round(sh * r);
                        const scale = activeClip.scale || 1.0; const cx = Math.round(width / 2 + (activeClip.positionX || 0)); const cy = Math.round(height / 2 + (activeClip.positionY || 0));
                        ctx.save(); ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.drawImage(sourceElement, -Math.round(dw / 2), -Math.round(dh / 2), dw, dh); ctx.restore();
                    }
                }
                if (activeText) {
                    const fontSize = activeText.fontSize; const lineHeight = fontSize * 1.2; const lines = activeText.text.split('\n');
                    ctx.font = `${activeText.fontWeight || 'bold'} ${fontSize}px ${activeText.fontFamily || 'Arial, sans-serif'}`;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; 
                    const x = Math.round((activeText.x / 100) * width); const y = Math.round((activeText.y / 100) * height); const padding = 20;
                    const totalTextHeight = lines.length * lineHeight; const startY = y - (totalTextHeight / 2) + (lineHeight / 2);
                    if (activeText.showBackground) {
                        let maxLineWidth = 0; lines.forEach(line => { const m = ctx.measureText(line); if (m.width > maxLineWidth) maxLineWidth = m.width; });
                        ctx.fillStyle = activeText.backgroundColor; ctx.fillRect(x - maxLineWidth / 2 - padding, y - totalTextHeight / 2 - padding, maxLineWidth + padding * 2, totalTextHeight + padding * 2);
                    }
                    if (activeText.strokeWidth > 0) { ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = activeText.strokeWidth; ctx.strokeStyle = activeText.strokeColor; }
                    ctx.fillStyle = activeText.color;
                    lines.forEach((line, index) => { const lineY = startY + (index * lineHeight); if (activeText.strokeWidth > 0) ctx.strokeText(line, x, lineY); ctx.fillText(line, x, lineY); });
                }

                const frame = new VideoFrame(canvasRef, { timestamp: timestampMicros });
                const keyFrame = i % (fps * 2) === 0; 
                
                videoEncoder.encode(frame, { keyFrame });
                
                // Interleave Audio
                while (audioWriteIndex < audioQueue.length && audioQueue[audioWriteIndex].timestamp <= timestampMicros) {
                    const { chunk, meta } = audioQueue[audioWriteIndex];
                    muxer.addAudioChunk(chunk, meta);
                    audioWriteIndex++;
                }
                frame.close();
            }

            // Remaining audio
            while (audioWriteIndex < audioQueue.length) {
                const { chunk, meta } = audioQueue[audioWriteIndex];
                muxer.addAudioChunk(chunk, meta);
                audioWriteIndex++;
            }

            Object.values(gifCache).forEach(data => data.frames.forEach(f => f.image.close()));
            offscreenVideo.src = ""; offscreenVideo.remove();
            await videoEncoder.flush(); muxer.finalize();

            if (writableStream) { await writableStream.close(); console.log("Stream closed."); } 
            else if (muxerTarget instanceof ArrayBufferTarget) {
                const { buffer } = muxer.target; const blob = new Blob([buffer], { type: 'video/mp4' }); const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `fastvideocutter_export_${Date.now()}.mp4`; document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 1000);
            }
            isExporting.set(false); startExportTrigger.set(0);
            if (typeof window !== 'undefined') { if (window.gtag) window.gtag('event', 'video_export', { 'event_category': 'engagement', 'event_label': 'duration', 'value': Math.round(durationInSeconds) }); fetch('/api/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'export', filename: activeClip?.name || 'Mixed', duration: durationInSeconds.toFixed(1) }) }).catch(() => {}); }

        } catch (err) {
            console.error(err); alert(`Export Failed: ${err.message}`);
            if (writableStream) writableStream.close().catch(() => {});
            if (typeof window !== 'undefined') fetch('/api/discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'error', filename: currentProcessingClip?.name || "Unknown", errorMessage: err.message }) }).catch(() => {});
            isExporting.set(false); startExportTrigger.set(0);
        } finally { window.removeEventListener('beforeunload', preventClose); }
    }

    // ============================================================
    // Helper Functions (Consolidated)
    // ============================================================

    function getMediaDuration(file, url) {
      return new Promise((resolve) => {
        if (file.type.startsWith('image')) { resolve({ duration: 3, width: 1920, height: 1080 }); return; } 
        const isVideo = file.type.startsWith('video') || file.name.toLowerCase().endsWith('.mov');
        const element = isVideo ? document.createElement('video') : document.createElement('audio');
        element.preload = 'metadata'; element.muted = true; element.src = url; if (isVideo) element.playsInline = true;
        const isMov = file.name.toLowerCase().endsWith('.mov') || file.type === 'video/quicktime';
        let isResolved = false;
        const timeout = setTimeout(() => {
            if (isResolved) return; isResolved = true;
            if (isMov) { alert(`Load Failed: ${file.name}\nTry Chrome.`); resolve(null); }
            else { console.warn("Timeout, default 30s"); resolve({ duration: 30, width: 1280, height: 720 }); }
        }, 4000);
        element.onloadedmetadata = () => {
            if (isResolved) return;
            if (element instanceof HTMLVideoElement && (element.videoWidth === 0 || element.videoHeight === 0)) {
                isResolved = true; clearTimeout(timeout); alert(`Format Error: ${file.name}`); resolve(null); return;
            }
            const rawDuration = element.duration;
            const vWidth = element.videoWidth || 0;
            const vHeight = element.videoHeight || 0;
            if (rawDuration !== Infinity && !isNaN(rawDuration) && rawDuration > 0) {
                isResolved = true; clearTimeout(timeout); resolve({ duration: rawDuration, width: vWidth, height: vHeight }); return;
            }
            element.currentTime = 1e7; 
            element.onseeked = () => {
                if (isResolved) return; isResolved = true; clearTimeout(timeout);
                let realDuration = element.currentTime;
                if (realDuration === 0 || realDuration > 360000) if (element.buffered.length > 0) realDuration = element.buffered.end(element.buffered.length - 1);
                if (realDuration === 0 || realDuration > 360000) realDuration = 30; 
                resolve({ duration: realDuration, width: vWidth, height: vHeight });
            };
        };
        element.onerror = () => { if (isResolved) return; isResolved = true; clearTimeout(timeout); resolve({ duration: 5, width: 0, height: 0 }); };
      });
    }

    function calculateAspectRatio(w, h) {
        if (!w || !h) return '16:9';
        const ratio = w / h;
        if (Math.abs(ratio - 16/9) < 0.05) return '16:9';
        if (Math.abs(ratio - 9/16) < 0.05) return '9:16';
        if (Math.abs(ratio - 1) < 0.05) return '1:1';
        if (Math.abs(ratio - 4/5) < 0.05) return '4:5';
        return 'custom';
    }

    function updateETR(currentTimestamp, totalDuration) {
        const now = Date.now(); const elapsedRealTime = (now - exportStartTime) / 1000; 
        if (elapsedRealTime < 2 || currentTimestamp <= 0) return "Calculating...";
        const processingSpeed = currentTimestamp / elapsedRealTime;
        const remainingVideoSeconds = totalDuration - currentTimestamp;
        const secondsLeft = remainingVideoSeconds / processingSpeed;
        if (!isFinite(secondsLeft) || secondsLeft < 0) return "Calculating...";
        if (secondsLeft < 60) return `${Math.ceil(secondsLeft)}s remaining`;
        const minutes = Math.floor(secondsLeft / 60); const seconds = Math.ceil(secondsLeft % 60);
        return `${minutes}m ${seconds}s remaining`;
    }

    function getSmartBitrate(width, height, fps) {
        const numPixels = width * height;
        if (numPixels >= 8_294_400) return 80_000_000; // 4K
        if (numPixels >= 3_686_400) return 40_000_000; // 2K
        if (numPixels >= 2_073_600) return 18_000_000; // 1080p
        if (numPixels >= 921_600) return 8_000_000;    // 720p
        return 4_000_000;
    }

    function convertFloat32ToInt16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16Array;
    }

    async function mixAllAudio(clips, totalDuration, targetSampleRate) {
        try {
            const safeDuration = (totalDuration > 0 && isFinite(totalDuration)) ? totalDuration : 1;
            const offlineCtx = new OfflineAudioContext(2, Math.ceil(safeDuration * targetSampleRate), targetSampleRate);
            const promises = clips.map(async (clip) => {
                try {
                    if (isImageType(clip.type) || clip.type === 'text') return; 
                    const response = await fetch(clip.fileUrl);
                    const arrayBuffer = await response.arrayBuffer();
                    const tempCtx = new AudioContext();
                    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
                    tempCtx.close(); 
                    const source = offlineCtx.createBufferSource();
                    source.buffer = audioBuffer;
                    const gainNode = offlineCtx.createGain();
                    gainNode.gain.value = clip.volume !== undefined ? clip.volume : 1.0;
                    source.connect(gainNode);
                    gainNode.connect(offlineCtx.destination);
                    const offset = clip.mediaStartOffset || 0;
                    source.start(clip.startOffset, offset, clip.duration);
                } catch (e) { }
            });
            await Promise.all(promises);
            return await offlineCtx.startRendering();
        } catch (e) { console.error("Audio Mix Failed:", e); return null; }
    }

    function interleave(inputL, inputR) {
        const length = inputL.length + inputR.length;
        const result = new Float32Array(length);
        let index = 0, inputIndex = 0;
        while (index < length) {
            result[index++] = inputL[inputIndex];
            result[index++] = inputR[inputIndex];
            inputIndex++;
        }
        return result;
    }
</script>

<!-- HTML Template -->
<div class="flex-1 bg-[#101010] relative flex flex-col justify-center items-center overflow-hidden w-full h-full select-none">
    <canvas bind:this={canvasRef} class="hidden"></canvas>
    <audio bind:this={audioRef} class="hidden"></audio>

    <div 
        class="relative flex justify-center items-center group cursor-grab active:cursor-grabbing bg-black shadow-2xl transition-all duration-300 overflow-hidden" 
        style="aspect-ratio: {$projectSettings.width} / {$projectSettings.height}; height: 80%; max-width: 90%;"
        draggable="true" on:dragstart={handleDragStart} on:drop={handlePreviewDrop} on:dragover={handleExternalDragOver} on:click={togglePlay} bind:clientWidth={containerWidth}
    >
        <video bind:this={videoRef} class="max-w-full max-h-full object-contain pointer-events-none {(isSourceMode && isVideoType($currentVideoSource.type)) || (!isSourceMode && activeClip && isVideoType(activeClip.type)) ? 'block' : 'hidden'}" style={!isSourceMode && activeClip ? `transform: translate(${(activeClip.positionX || 0) * previewRatio}px, ${(activeClip.positionY || 0) * previewRatio}px) scale(${activeClip.scale || 1}); transform-origin: center;` : ''} muted={false} crossorigin="anonymous"></video>
        <img bind:this={imageRef} class="max-w-full max-h-full object-contain pointer-events-none {(isSourceMode && isImageType($currentVideoSource.type)) || (!isSourceMode && activeClip && isImageType(activeClip.type)) ? 'block' : 'hidden'}" style={!isSourceMode && activeClip ? `transform: translate(${(activeClip.positionX || 0) * previewRatio}px, ${(activeClip.positionY || 0) * previewRatio}px) scale(${activeClip.scale || 1}); transform-origin: center;` : ''} alt="preview" />
        
        {#if isSourceMode && isAudioType($currentVideoSource.type)} <div class="flex flex-col items-center gap-4 text-green-400 animate-pulse"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><span class="text-sm font-mono">Previewing Audio...</span></div> {/if}
        
        {#if !isSourceMode && activeTextClip} <div class="absolute pointer-events-none text-center select-none" style="top: {activeTextClip.y}%; left: {activeTextClip.x}%; transform: translate(-50%, -50%); font-size: {activeTextClip.fontSize * previewRatio}px; color: {activeTextClip.color}; font-family: {activeTextClip.fontFamily || 'Arial, sans-serif'}; font-weight: {activeTextClip.fontWeight || 'bold'}; white-space: pre; paint-order: stroke fill; -webkit-text-stroke: {activeTextClip.strokeWidth * previewRatio}px {activeTextClip.strokeColor}; background-color: {activeTextClip.showBackground ? activeTextClip.backgroundColor : 'transparent'}; padding: {activeTextClip.showBackground ? `${10 * previewRatio}px ${20 * previewRatio}px` : '0'}; border-radius: {8 * previewRatio}px; line-height: 1.2;">{activeTextClip.text}</div> {/if}
        
        {#if isProcessingDrag} <div class="absolute inset-0 z-[60] bg-black/80 flex flex-col items-center justify-center backdrop-blur-sm"><div class="w-12 h-12 border-4 border-gray-600 border-t-cyan-400 rounded-full animate-spin mb-4"></div><p class="text-cyan-400 font-bold animate-pulse">Processing Media...</p></div> {/if}

        {#if isSourceMode} <div class="absolute top-4 left-4 z-20"><button class="bg-black/60 hover:bg-red-600/90 text-white px-4 py-2 rounded-full flex items-center gap-2 transition-all backdrop-blur-md shadow-lg cursor-pointer pointer-events-auto text-xs font-bold border border-white/10 hover:border-red-500/50" on:click|stopPropagation={() => currentVideoSource.set(null)}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg><span>Exit Preview</span></button></div><div class="absolute bottom-8 left-1/2 -translate-x-1/2 z-20"><button class="bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-2 rounded-full font-bold text-sm transition-all shadow-lg shadow-cyan-500/30 flex items-center gap-2 border border-cyan-400/50 hover:scale-105 pointer-events-auto" on:click|stopPropagation={addToProject}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>Add to Timeline</button></div>{/if}

        {#if !activeClip && !isSourceMode && !activeTextClip} <div class="absolute inset-0 flex flex-col items-center justify-center bg-[#0f172a] z-10">{#if isProcessingDrag}<div class="w-12 h-12 border-4 border-gray-600 border-t-cyan-400 rounded-full animate-spin mb-4"></div><p class="text-cyan-400 font-bold animate-pulse">Processing Media...</p>{:else}<div class="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mb-6 border-2 border-dashed border-slate-600 group-hover:border-cyan-400 group-hover:bg-slate-800 transition-all duration-300"><svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8 text-slate-400 group-hover:text-cyan-400 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg></div><h3 class="text-xl font-bold text-white mb-2">Start Creating</h3><p class="text-slate-400 text-sm mb-8 max-w-xs text-center leading-relaxed">Drag & drop your video here,<br>or click the button below.</p><button on:click|stopPropagation={triggerUpload} class="bg-cyan-600 hover:bg-cyan-500 text-white px-8 py-3 rounded-full font-bold text-sm transition-all shadow-lg shadow-cyan-500/20 flex items-center gap-2 pointer-events-auto"><svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5v14"/></svg>Import Video</button><button on:click|stopPropagation={loadSampleProject} class="text-slate-400 hover:text-white text-sm underline decoration-slate-600 underline-offset-4 transition-colors pointer-events-auto mt-4">No video? Try sample project</button>{/if}</div>{/if}
      
        {#if $isExporting} <div class="absolute z-50 bg-black/90 px-8 py-6 rounded-xl flex flex-col items-center gap-4 shadow-2xl border border-gray-800"><div class="relative w-12 h-12"><div class="absolute inset-0 border-4 border-gray-700 rounded-full"></div><div class="absolute inset-0 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div></div><div class="text-center"><div class="text-white font-bold text-lg">{exportStatus}</div><div class="text-cyan-400 font-mono text-xl mt-1">{exportProgress}%</div><div class="text-gray-400 text-xs mt-2 font-mono">{estimatedTimeText}</div></div></div>{/if}
    </div>

    <div class={`absolute bottom-8 bg-[#1e1e1e] border border-gray-700 rounded-full px-6 py-2 flex items-center gap-6 text-white z-30 transition-opacity ${(!hasClips && !isSourceMode) || $isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <button on:click|stopPropagation={togglePlay} class="hover:text-cyan-400 disabled:cursor-not-allowed" disabled={(!hasClips && !isSourceMode) || $isExporting}>
            {#if $isPlaying || (isSourceMode && videoRef && !videoRef.paused) || (isSourceMode && audioRef && !audioRef.paused)} ⏸ {:else} ▶ {/if}
        </button>
        <div class="w-[1px] h-4 bg-gray-600"></div>
        <span class="font-mono text-sm w-16 text-center">{isSourceMode ? 'Preview' : $currentTime.toFixed(1) + 's'}</span>
    </div>
</div>