<script>
    import { currentVideoSource, currentTime, isPlaying } from '../stores/playerStore';
    import { mainTrackClips } from '../stores/timelineStore';
    import { isExporting, startExportTrigger } from '../stores/exportStore';
    import { onMount } from 'svelte';
    
    // 👇 引入 MP4 打包器
    import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
  
    let videoRef;
    let canvasRef;
    let lastTime = 0;
    
    // 導出進度 (0 ~ 100)
    let exportProgress = 0;
  
    $: hasClips = $mainTrackClips.length > 0;
    $: contentDuration = hasClips 
        ? Math.max(...$mainTrackClips.map(c => c.startOffset + c.duration)) 
        : 0;
  
    // ------------------------------------------------
    // 1. 導出監聽
    // ------------------------------------------------
    $: if ($startExportTrigger > 0 && !$isExporting && hasClips) {
        renderVideoProcess();
    }
  
    // ------------------------------------------------
    // 2. 核心：逐幀渲染 (Frame-by-Frame Rendering)
    // ------------------------------------------------
    async function renderVideoProcess() {
        try {
            console.log("開始導出...");
            isExporting.set(true);
            isPlaying.set(false); // 停止 UI 播放
            exportProgress = 0;
  
            // A. 設定參數
            const width = 1280;
            const height = 720;
            const fps = 30;
            const totalFrames = Math.ceil(contentDuration * fps);
            
            // B. 建立 MP4 Muxer
            const muxer = new Muxer({
                target: new ArrayBufferTarget(),
                video: { codec: 'avc', width, height },
                fastStart: false 
            });
  
            // C. 建立編碼器
            const videoEncoder = new VideoEncoder({
                output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                error: (e) => { throw e; }
            });
  
            // D. 設定參數 & 檢查支援度
            const config = {
                codec: 'avc1.42001f', // H.264 Baseline
                width,
                height,
                bitrate: 5_000_000,
                framerate: fps
            };
            
            const support = await VideoEncoder.isConfigSupported(config);
            if (!support.supported) {
                throw new Error(`瀏覽器不支援此編碼設定: ${config.codec}`);
            }
            videoEncoder.configure(config);
  
            // E. 準備 Canvas
            const ctx = canvasRef.getContext('2d', { willReadFrequently: true });
            canvasRef.width = width;
            canvasRef.height = height;
  
            // F. 開始迴圈
            for (let i = 0; i < totalFrames; i++) {
                const timeInSeconds = i / fps;
                const timestampMicros = i * (1_000_000 / fps);
  
                // 更新 UI 進度
                exportProgress = Math.round((i / totalFrames) * 100);
                await new Promise(r => setTimeout(r, 0));
  
                // 1. 找出 Clip
                const activeClip = $mainTrackClips.find(clip => 
                    timeInSeconds >= clip.startOffset && 
                    timeInSeconds < (clip.startOffset + clip.duration)
                );
  
                // 2. 繪製黑底 (這就是黑邊的來源)
                ctx.fillStyle = '#000'; 
                ctx.fillRect(0, 0, width, height);
  
                if (activeClip) {
                    // 切換來源
                    if (!videoRef.src.includes(activeClip.fileUrl)) {
                        videoRef.src = activeClip.fileUrl;
                        await new Promise((resolve, reject) => {
                            videoRef.onloadedmetadata = resolve;
                            videoRef.onerror = reject;
                        });
                    }
  
                    // 計算時間
                    const seekTime = timeInSeconds - activeClip.startOffset;
  
                    // 🔥 改良版 Seek：使用 EventListener 確保穩定
                    await new Promise((resolve, reject) => {
                        const onSeeked = () => {
                            videoRef.removeEventListener('seeked', onSeeked);
                            videoRef.removeEventListener('error', onError);
                            resolve();
                        };
                        const onError = (e) => {
                            videoRef.removeEventListener('seeked', onSeeked);
                            videoRef.removeEventListener('error', onError);
                            reject(new Error("Video Seek Failed"));
                        };
                        videoRef.addEventListener('seeked', onSeeked);
                        videoRef.addEventListener('error', onError);
                        
                        // 設定時間觸發 Seek
                        videoRef.currentTime = seekTime;
                    });
  
                    // 🔥 新增：比例計算 (Object Fit: Contain)
                    const vw = videoRef.videoWidth;
                    const vh = videoRef.videoHeight;
                    const videoRatio = vw / vh;
                    const canvasRatio = width / height;
                    
                    let drawW, drawH;
  
                    if (videoRatio > canvasRatio) {
                        // 影片比較寬 -> 以寬為主，上下留黑
                        drawW = width;
                        drawH = width / videoRatio;
                    } else {
                        // 影片比較高 -> 以高為主，左右留黑
                        drawH = height;
                        drawW = height * videoRatio;
                    }
  
                    // 算出置中偏移
                    const offsetX = (width - drawW) / 2;
                    const offsetY = (height - drawH) / 2;
  
                    // 畫上去
                    ctx.drawImage(videoRef, offsetX, offsetY, drawW, drawH);
                }
  
                // 3. 編碼
                const frame = new VideoFrame(canvasRef, { timestamp: timestampMicros });
                const keyFrame = i % (fps * 2) === 0; 
                videoEncoder.encode(frame, { keyFrame });
                frame.close();
            }
  
            // G. 結束與下載
            await videoEncoder.flush();
            muxer.finalize();
  
            const { buffer } = muxer.target;
            const blob = new Blob([buffer], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `capcut_export_${Date.now()}.mp4`;
            document.body.appendChild(a);
            a.click();
            
            setTimeout(() => {
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                isExporting.set(false);
                startExportTrigger.set(0);
            }, 1000);
  
        } catch (err) {
            console.error("Export Error:", err);
            alert(`Export Failed: ${err.message}`);
            isExporting.set(false);
            startExportTrigger.set(0);
        }
    }
  
  
    // ------------------------------------------------
    // 3. UI 播放邏輯 (Preview Mode)
    // ------------------------------------------------
    
    $: activeClip = $mainTrackClips.find(clip => 
        $currentTime >= clip.startOffset && 
        $currentTime < (clip.startOffset + clip.duration)
    );
  
    $: if (videoRef && activeClip && !$isExporting) {
        if (!videoRef.src.includes(activeClip.fileUrl)) {
            videoRef.src = activeClip.fileUrl;
        }
        const seekTime = $currentTime - activeClip.startOffset;
        if (Math.abs(videoRef.currentTime - seekTime) > 0.2) {
            videoRef.currentTime = seekTime;
        }
    }
  
    function togglePlay() {
        if (!hasClips || $isExporting) return;
        if (!$isPlaying && $currentTime >= contentDuration) currentTime.set(0);
        isPlaying.update(v => !v);
    }
  
    $: if ($isPlaying && !$isExporting) {
        lastTime = performance.now();
        requestAnimationFrame(loop);
        if (videoRef) videoRef.play().catch(() => {}); 
    } else {
        if (videoRef && !$isExporting) videoRef.pause();
    }
  
    $: if ($isPlaying && hasClips && $currentTime >= contentDuration && !$isExporting) {
        isPlaying.set(false);
        currentTime.set(contentDuration);
    }
  
    function loop(timestamp) {
        if (!$isPlaying || $isExporting) return;
        const deltaTime = (timestamp - lastTime) / 1000;
        lastTime = timestamp;
        currentTime.update(t => t + deltaTime);
        requestAnimationFrame(loop);
    }
  
    function handleDragStart(e) { if (!activeClip) e.preventDefault(); }
  
</script>

<div class="flex-1 bg-[#101010] relative flex flex-col justify-center items-center overflow-hidden w-full h-full select-none">
  
    <!-- 隱藏的 Canvas (Export 用) -->
    <canvas bind:this={canvasRef} class="hidden"></canvas>

    <div class="relative w-full h-full flex justify-center items-center group" on:click={togglePlay}>
      
        <!-- 
           🔥 修復重點：
           1. 移除了 {#if activeClip}，確保 DOM 元素始終存在
           2. 使用 CSS class 控制顯示/隱藏
        -->
        <video 
            bind:this={videoRef}
            class="max-w-full max-h-full object-contain pointer-events-none {activeClip ? 'block' : 'hidden'}" 
            muted={false}
            crossorigin="anonymous"
        ></video>
        
        {#if activeClip && !$isExporting}
            <div class="absolute top-4 left-4 bg-black/50 px-2 py-1 rounded text-xs text-white z-20">Playing: {activeClip.name}</div>
        {/if}

        {#if !activeClip}
            <div class="flex flex-col items-center gap-4 opacity-20 text-white absolute">
                <span class="text-sm">{!hasClips ? 'Drag media to start' : 'Black Screen'}</span>
            </div>
        {/if}

        {#if !$isPlaying && hasClips && !$isExporting}
            <div class="absolute z-50 bg-black/50 p-4 rounded-full backdrop-blur-sm pointer-events-none">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
        {/if}
      
        {#if $isExporting}
            <div class="absolute z-50 bg-black/90 px-8 py-6 rounded-xl flex flex-col items-center gap-4 shadow-2xl border border-gray-800">
                <div class="relative w-12 h-12">
                    <div class="absolute inset-0 border-4 border-gray-700 rounded-full"></div>
                    <div class="absolute inset-0 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <div class="text-center">
                    <div class="text-white font-bold text-lg">Exporting MP4...</div>
                    <div class="text-cyan-400 font-mono text-xl mt-1">{exportProgress}%</div>
                </div>
                <div class="text-xs text-gray-500">Do not close this tab</div>
            </div>
        {/if}
    </div>

    <div class={`absolute bottom-8 bg-[#1e1e1e] border border-gray-700 rounded-full px-6 py-2 flex items-center gap-6 text-white z-30 transition-opacity ${!hasClips || $isExporting ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <button on:click|stopPropagation={togglePlay} class="hover:text-cyan-400 disabled:cursor-not-allowed" disabled={!hasClips || $isExporting}>
            {#if $isPlaying} ⏸ {:else} ▶ {/if}
        </button>
        <div class="w-[1px] h-4 bg-gray-600"></div>
        <span class="font-mono text-sm w-16 text-center">{$currentTime.toFixed(1)}s</span>
    </div>
</div>