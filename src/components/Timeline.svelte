<script>
    import { mainTrackClips, audioTrackClips, textTrackClips, generateId, selectedClipIds, draggedFile } from '../stores/timelineStore';
    import { currentTime, isPlaying, currentVideoSource } from '../stores/playerStore';
    import { splitClip, resolveOverlaps } from '../stores/timelineStore';
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import historyStack, { addToHistory, undo, redo } from '../stores/historyStore'; // 🔥 引入

    let pixelsPerSecond = 20; 
    let timelineContainer; 
    let scrollContainer;
    
    // --- 視窗與捲動變數 ---
    let visibleWidth = 0;
    let currentScrollLeft = 0; // 用於追蹤捲動位置

    // --- 狀態變數 ---
    let totalDuration = 60;     
    
    // --- Auto Scroll 變數 ---
    let autoScrollSpeed = 0;
    let animationFrameId = null;
    let lastMouseEvent = null;
    let initialScrollLeft = 0; 
    let isScrubbing = false;   

    // Resize 變數
    let resizingClipId = null;  
    let resizingTrack = null; 
    let resizingEdge = null;  
    let initialX = 0;           
    let initialDuration = 0;    
    let initialStartOffset = 0; 
    let initialMediaStart = 0; 
    let maxDurationLimit = 0;   
    
    // Move 變數
    let movingClipId = null;
    let movingTrack = null;
    let moveInitialX = 0;
    let moveInitialStart = 0;
    let groupInitialOffsets = {}; 

    // UI 輔助
    let isSelecting = false;
    let selectStartX = 0;
    let selectStartY = 0;
    let selectBox = { x: 0, y: 0, width: 0, height: 0 };
    let showGuide = false;    
    let guideX = 0;           
    let guideTimeText = "";   

    // 🔥 新增：防止無效操作存入歷史紀錄
    let hasMoved = false;
    let hasResized = false;

    const TRACK_Y = { RULER: 24, TEXT: 64, MAIN: 96, AUDIO: 64 };
    const TRACK_BOUNDS = {
        text: { top: TRACK_Y.RULER, bottom: TRACK_Y.RULER + TRACK_Y.TEXT },
        main: { top: TRACK_Y.RULER + TRACK_Y.TEXT, bottom: TRACK_Y.RULER + TRACK_Y.TEXT + TRACK_Y.MAIN },
        audio: { top: TRACK_Y.RULER + TRACK_Y.TEXT + TRACK_Y.MAIN, bottom: TRACK_Y.RULER + TRACK_Y.TEXT + TRACK_Y.MAIN + TRACK_Y.AUDIO }
    };

    // --- 🔥 修復：手動處理捲動事件 ---
    function handleScroll(e) {
        // 當捲動發生時，手動更新變數
        currentScrollLeft = e.currentTarget.scrollLeft;
    }

    // --- Reactive: 計算總長度 (無限畫布邏輯) ---
    $: {
        const maxMain = $mainTrackClips.length > 0 ? Math.max(...$mainTrackClips.map(c => c.startOffset + c.duration)) : 0;
        const maxAudio = $audioTrackClips.length > 0 ? Math.max(...$audioTrackClips.map(c => c.startOffset + c.duration)) : 0;
        const maxText = $textTrackClips.length > 0 ? Math.max(...$textTrackClips.map(c => c.startOffset + c.duration)) : 0;
        
        const maxClipEnd = Math.max(maxMain, maxAudio, maxText);
        
        // 使用 currentScrollLeft 計算視窗右邊界
        const visibleRightEdgeTime = (currentScrollLeft + visibleWidth - 100) / pixelsPerSecond;

        totalDuration = Math.max(60, maxClipEnd + 30, visibleRightEdgeTime + 10);
    }

    function switchToTimeline() { currentVideoSource.set(null); }
    function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }

    // --- Drop Logic ---
    function handleDrop(e) {
        e.preventDefault();
        switchToTimeline();
        const data = e.dataTransfer.getData('application/json');
        if (data) {
            addToHistory(); // 🔥 在修改 mainTrackClips 之前記錄

            const fileData = JSON.parse(data);
            if (fileData.type.startsWith('audio')) { alert("Audio -> Audio Track"); return; }
            const actualFileObject = get(draggedFile); 
            const currentMaxTime = $mainTrackClips.length > 0 ? Math.max(...$mainTrackClips.map(c => c.startOffset + c.duration)) : 0;
            const originalDuration = fileData.duration || 5;
            const isImage = fileData.type.startsWith('image'); 

            const newClip = { 
                id: generateId(), fileUrl: fileData.url, name: fileData.name, type: fileData.type, 
                startOffset: currentMaxTime, duration: originalDuration, sourceDuration: isImage ? Infinity : originalDuration,
                mediaStartOffset: 0, volume: 1.0, file: actualFileObject ? actualFileObject.file : null,
                thumbnails: actualFileObject ? actualFileObject.thumbnails : [], thumbnailUrls: fileData.thumbnailUrls || []
            };
            mainTrackClips.update(clips => resolveOverlaps([...clips, newClip], newClip.id));
            draggedFile.set(null); 
        }
    }

    function handleAudioDrop(e) {
        e.preventDefault();
        switchToTimeline();
        const data = e.dataTransfer.getData('application/json');
        if (data) {
            const fileData = JSON.parse(data);
            if (!fileData.type.startsWith('audio')) { alert("Video -> Main Track"); return; }
            const actualFileObject = get(draggedFile);
            const currentMaxTime = $audioTrackClips.length > 0 ? Math.max(...$audioTrackClips.map(c => c.startOffset + c.duration)) : 0;
            const originalDuration = fileData.duration || 5;
            const newClip = { 
                id: generateId(), fileUrl: fileData.url, name: fileData.name, type: fileData.type, 
                startOffset: currentMaxTime, duration: originalDuration, sourceDuration: originalDuration, 
                mediaStartOffset: 0, volume: 1.0, file: actualFileObject ? actualFileObject.file : null,
                waveform: fileData.waveform || (actualFileObject ? actualFileObject.waveform : null)
            };
            audioTrackClips.update(clips => resolveOverlaps([...clips, newClip], newClip.id));
            draggedFile.set(null);
        }
    }

    // --- Auto Scroll Logic ---
    function checkAutoScroll(currentX) {
        if (!scrollContainer) return;
        const { left, right } = scrollContainer.getBoundingClientRect();
        const edgeThreshold = 50; 
        const maxSpeed = 15; 

        if (currentX < left + edgeThreshold) {
            const intensity = Math.min(1, (left + edgeThreshold - currentX) / edgeThreshold);
            autoScrollSpeed = -maxSpeed * intensity;
        } else if (currentX > right - edgeThreshold) {
            const intensity = Math.min(1, (currentX - (right - edgeThreshold)) / edgeThreshold);
            autoScrollSpeed = maxSpeed * intensity;
        } else {
            autoScrollSpeed = 0;
        }
    }

    function performAutoScroll() {
        if (autoScrollSpeed !== 0 && scrollContainer) {
            // 直接修改 scrollLeft，這會觸發 on:scroll 事件，進而更新 currentScrollLeft
            scrollContainer.scrollLeft += autoScrollSpeed;
            
            if (lastMouseEvent) {
                if (resizingClipId) handleResizeMove(lastMouseEvent);
                else if (movingClipId) handleMoveClip(lastMouseEvent);
                else if (isSelecting) handleMarqueeMove(lastMouseEvent);
                else if (isScrubbing) handleTimelineMouseMove(lastMouseEvent);
            }
        }
        animationFrameId = requestAnimationFrame(performAutoScroll);
    }

    function startAutoScrollLoop() {
        if (!animationFrameId) {
            performAutoScroll();
        }
    }

    function stopAutoScrollLoop() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        autoScrollSpeed = 0;
        lastMouseEvent = null;
    }

    // --- Split & Delete ---
    function handleSplit() {
        if (!$selectedClipIds || $selectedClipIds.length !== 1) { alert("Please select a single clip to split."); return; }
        addToHistory(); // 🔥 記錄
        switchToTimeline();
        splitClip($selectedClipIds[0], $currentTime);
        selectedClipIds.set([]);
    }
    function deleteSelected() {
        if ($selectedClipIds.length === 0) return;
        addToHistory(); // 🔥 記錄
        mainTrackClips.update(clips => clips.filter(c => !$selectedClipIds.includes(c.id)));
        audioTrackClips.update(clips => clips.filter(c => !$selectedClipIds.includes(c.id)));
        textTrackClips.update(clips => clips.filter(c => !$selectedClipIds.includes(c.id)));
        selectedClipIds.set([]);
    }
    function handleKeyDown(e) { 
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected(); 
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); handleSplit(); }
        // 🔥 Undo (Ctrl+Z)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            e.preventDefault();
            undo();
        }

        // 🔥 Redo (Ctrl+Y 或 Ctrl+Shift+Z)
        if (
            ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') || 
            ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey)
        ) {
            e.preventDefault();
            redo();
        }
    }
    function handleContextMenu(e, clipId) { 
        e.preventDefault(); switchToTimeline(); 
        if (!$selectedClipIds.includes(clipId)) selectedClipIds.set([clipId]); 
        deleteSelected(); 
    }
    function selectClip(e, clipId) { 
        e.stopPropagation(); switchToTimeline();
        if (e.shiftKey) {
            selectedClipIds.update(ids => ids.includes(clipId) ? ids.filter(id => id !== clipId) : [...ids, clipId]);
        } else {
            if (!$selectedClipIds.includes(clipId)) selectedClipIds.set([clipId]);
        }
    }

    // --- Resize Logic ---
    function startResize(e, clip, trackType, edge) {
        e.stopPropagation();
        
        hasResized = false; // 🔥 重置旗標

        switchToTimeline();
        selectedClipIds.set([clip.id]);
        resizingClipId = clip.id;
        resizingTrack = trackType;
        resizingEdge = edge; 
        
        initialX = e.clientX;
        initialScrollLeft = scrollContainer.scrollLeft; 
        
        initialDuration = clip.duration;
        initialStartOffset = clip.startOffset;
        initialMediaStart = clip.mediaStartOffset || 0;
        maxDurationLimit = clip.sourceDuration === undefined ? Infinity : clip.sourceDuration;
        
        showGuide = true;
        startAutoScrollLoop();
        window.addEventListener('mousemove', handleResizeMove);
        window.addEventListener('mouseup', stopResize);
    }

    function handleResizeMove(e) {
        if (!resizingClipId) return;

         // 🔥🔥🔥 關鍵修改：第一次真的產生位移時，才存入歷史 🔥🔥🔥
         if (!hasResized) {
            addToHistory();
            hasResized = true;
        }


        lastMouseEvent = e;
        checkAutoScroll(e.clientX);

        const mouseDelta = e.clientX - initialX;
        const scrollDelta = scrollContainer.scrollLeft - initialScrollLeft;
        const totalDeltaX = mouseDelta + scrollDelta;

        const deltaSeconds = totalDeltaX / pixelsPerSecond; 
        
        let newDuration = initialDuration;
        let newStartOffset = initialStartOffset;
        let newMediaStart = initialMediaStart;
        const snapThreshold = 15 / pixelsPerSecond;
        const targetTime = $currentTime;

        if (resizingEdge === 'end') {
            let tempEnd = initialStartOffset + initialDuration + deltaSeconds;
            if (Math.abs(tempEnd - targetTime) < snapThreshold) tempEnd = targetTime;
            const maxAllowedDuration = maxDurationLimit === Infinity ? Infinity : (maxDurationLimit - initialMediaStart);
            newDuration = tempEnd - initialStartOffset;
            newDuration = Math.max(0.5, newDuration); 
            if (maxAllowedDuration !== Infinity) newDuration = Math.min(maxAllowedDuration, newDuration); 
        } else if (resizingEdge === 'start') {
            let tempStart = initialStartOffset + deltaSeconds;
            if (Math.abs(tempStart - targetTime) < snapThreshold) tempStart = targetTime;
            const change = tempStart - initialStartOffset;
            let attemptedDuration = initialDuration - change;

            if (attemptedDuration < 0.5) {
                newStartOffset = initialStartOffset + (initialDuration - 0.5);
                newDuration = 0.5;
                newMediaStart = initialMediaStart + (initialDuration - 0.5);
            } else if (maxDurationLimit !== Infinity && initialMediaStart + change < 0) {
                newMediaStart = 0;
                newStartOffset = initialStartOffset - initialMediaStart;
                newDuration = initialDuration + initialMediaStart;
            } else {
                newStartOffset = tempStart;
                newDuration = attemptedDuration;
                newMediaStart = initialMediaStart + change;
            }
            if (newStartOffset < 0) newStartOffset = 0;
        }

        const updateLogic = (clips) => clips.map(c => c.id === resizingClipId ? { 
            ...c, startOffset: newStartOffset, duration: newDuration, mediaStartOffset: newMediaStart
        } : c);

        if (resizingTrack === 'main') mainTrackClips.update(updateLogic);
        else if (resizingTrack === 'audio') audioTrackClips.update(updateLogic);
        else if (resizingTrack === 'text') textTrackClips.update(updateLogic);

        guideX = e.clientX;
        const currentEdgeTime = resizingEdge === 'end' ? (newStartOffset + newDuration) : newStartOffset;
        const isSnapped = Math.abs(currentEdgeTime - $currentTime) < 0.001;
        guideTimeText = (isSnapped ? "🧲 " : "") + `${currentEdgeTime.toFixed(2)}s`;
    }

    function stopResize() {
        resizingClipId = null; resizingTrack = null; resizingEdge = null; showGuide = false;
        stopAutoScrollLoop();
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', stopResize);
    }

    // --- Move Logic ---
    function startMoveClip(e, clip, trackType) {
        e.stopPropagation();
        
        hasMoved = false; // 🔥 重置旗標

        switchToTimeline();
        
        if (!$selectedClipIds.includes(clip.id) && !e.shiftKey) selectedClipIds.set([clip.id]);
        else if (!$selectedClipIds.includes(clip.id) && e.shiftKey) selectedClipIds.update(ids => [...ids, clip.id]);

        movingClipId = clip.id;
        movingTrack = trackType;
        
        moveInitialX = e.clientX;
        initialScrollLeft = scrollContainer.scrollLeft; 
        moveInitialStart = clip.startOffset;

        groupInitialOffsets = {};
        const allClips = [...get(mainTrackClips), ...get(audioTrackClips), ...get(textTrackClips)];
        get(selectedClipIds).forEach(id => {
            const c = allClips.find(i => i.id === id);
            if (c) groupInitialOffsets[id] = c.startOffset;
        });

        showGuide = true;
        startAutoScrollLoop();
        window.addEventListener('mousemove', handleMoveClip);
        window.addEventListener('mouseup', stopMoveClip);
    }

    function handleMoveClip(e) {
        if (!movingClipId) return;


        // 🔥🔥🔥 關鍵修改：第一次真的產生位移時，才存入歷史 🔥🔥🔥
        if (!hasMoved) {
            addToHistory();
            hasMoved = true;
        }


        lastMouseEvent = e;
        checkAutoScroll(e.clientX);

        const mouseDelta = e.clientX - moveInitialX;
        const scrollDelta = scrollContainer.scrollLeft - initialScrollLeft;
        const totalDeltaX = mouseDelta + scrollDelta;

        const deltaSeconds = totalDeltaX / pixelsPerSecond;
        
        const updateBatch = (clips) => clips.map(c => {
            if ($selectedClipIds.includes(c.id) && groupInitialOffsets[c.id] !== undefined) {
                const newStart = Math.max(0, groupInitialOffsets[c.id] + deltaSeconds);
                return { ...c, startOffset: newStart };
            }
            return c;
        });

        if (movingTrack === 'main') mainTrackClips.update(updateBatch);
        else if (movingTrack === 'audio') audioTrackClips.update(updateBatch);
        else if (movingTrack === 'text') textTrackClips.update(updateBatch);

        const currentStart = Math.max(0, moveInitialStart + deltaSeconds);
        currentTime.set(currentStart);
        guideX = e.clientX;
        guideTimeText = deltaSeconds > 0 ? `+${deltaSeconds.toFixed(2)}s` : `${deltaSeconds.toFixed(2)}s`;
    }

    function stopMoveClip() {
        const currentId = movingClipId;
        if (movingTrack === 'main') mainTrackClips.update(clips => resolveOverlaps(clips, currentId));
        else if (movingTrack === 'audio') audioTrackClips.update(clips => resolveOverlaps(clips, currentId));
        else if (movingTrack === 'text') textTrackClips.update(clips => resolveOverlaps(clips, currentId));

        movingClipId = null; movingTrack = null; showGuide = false; groupInitialOffsets = {};
        stopAutoScrollLoop();
        window.removeEventListener('mousemove', handleMoveClip);
        window.removeEventListener('mouseup', stopMoveClip);
    }

    // --- Marquee Logic ---
    function handleTimelineMouseDown(e) {
        switchToTimeline();
        if (e.target.classList.contains('track-bg')) {
            if (!e.shiftKey) selectedClipIds.set([]);
            startMarquee(e);
        } else {
            if (!e.shiftKey) selectedClipIds.set([]);
            isScrubbing = true;
            updateTimeFromEvent(e);
            startAutoScrollLoop();
            window.addEventListener('mousemove', handleTimelineMouseMove);
            window.addEventListener('mouseup', handleTimelineMouseUp);
        }
    }

    function startMarquee(e) {
        isSelecting = true;
        if (!scrollContainer) return;
        const rect = scrollContainer.getBoundingClientRect();
        const startX = e.clientX - rect.left + scrollContainer.scrollLeft;
        const startY = e.clientY - rect.top + scrollContainer.scrollTop;
        selectStartX = startX; selectStartY = startY;
        selectBox = { x: startX, y: startY, width: 0, height: 0 };
        
        startAutoScrollLoop();
        window.addEventListener('mousemove', handleMarqueeMove);
        window.addEventListener('mouseup', stopMarquee);
    }

    function handleMarqueeMove(e) {
        if (!isSelecting || !scrollContainer) return;
        lastMouseEvent = e;
        checkAutoScroll(e.clientX);

        const rect = scrollContainer.getBoundingClientRect();
        const currentX = e.clientX - rect.left + scrollContainer.scrollLeft;
        const currentY = e.clientY - rect.top + scrollContainer.scrollTop;
        const x = Math.min(selectStartX, currentX);
        const y = Math.min(selectStartY, currentY);
        const width = Math.abs(currentX - selectStartX);
        const height = Math.abs(currentY - selectStartY);
        selectBox = { x, y, width, height };

        const startTime = x / pixelsPerSecond;
        const endTime = (x + width) / pixelsPerSecond;
        
        const boxTop = y;
        const boxBottom = y + height;
        const isYOverlap = (track) => boxTop < track.bottom && boxBottom > track.top;

        const newSelected = [];
        const checkTrack = (trackClips) => {
             trackClips.forEach(clip => {
                if (clip.startOffset < endTime && (clip.startOffset + clip.duration) > startTime) newSelected.push(clip.id);
            });
        };
        if (isYOverlap(TRACK_BOUNDS.text)) checkTrack($textTrackClips);
        if (isYOverlap(TRACK_BOUNDS.main)) checkTrack($mainTrackClips);
        if (isYOverlap(TRACK_BOUNDS.audio)) checkTrack($audioTrackClips);
        
        selectedClipIds.set(newSelected);
    }

    function stopMarquee() {
        isSelecting = false;
        selectBox = { x: 0, y: 0, width: 0, height: 0 };
        stopAutoScrollLoop();
        window.removeEventListener('mousemove', handleMarqueeMove);
        window.removeEventListener('mouseup', stopMarquee);
    }

    // --- Timeline Playhead Logic ---
    function handleTimelineMouseMove(e) { 
        lastMouseEvent = e;
        checkAutoScroll(e.clientX);
        updateTimeFromEvent(e); 
    }

    function handleTimelineMouseUp() { 
        isScrubbing = false;
        stopAutoScrollLoop();
        window.removeEventListener('mousemove', handleTimelineMouseMove); 
        window.removeEventListener('mouseup', handleTimelineMouseUp); 
    }

    function updateTimeFromEvent(e) {
        if (!timelineContainer) return;
        const rect = timelineContainer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const timelineX = x - 96; 
        currentTime.set(Math.max(0, timelineX / pixelsPerSecond));
    }

    function drawWaveform(canvas, clip) {
        if (!canvas || !clip.waveform) return;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const data = clip.waveform;
        ctx.clearRect(0, 0, width, height);
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#fb923c');   
        gradient.addColorStop(0.5, '#facc15'); 
        gradient.addColorStop(1, '#4ade80');   
        ctx.fillStyle = gradient;
        const barWidth = 4; const gap = 2; const step = barWidth + gap;
        const totalBars = Math.floor(width / step);
        const dataStep = data.length / totalBars;
        for (let i = 0; i < totalBars; i++) {
            const dataIndex = Math.floor(i * dataStep);
            const value = data[dataIndex] || 0; 
            let barHeight = value * height * 0.9;
            if (barHeight < 1) barHeight = 2;
            const x = i * step; const y = height - barHeight;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
            else ctx.rect(x, y, barWidth, barHeight);
            ctx.fill();
        }
    }
</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="h-[35%] bg-[#181818] border-t border-gray-700 flex flex-col relative select-none overflow-hidden">
    
    <div class="h-8 bg-[#252525] border-b border-gray-700 flex items-center px-4 justify-between z-50 relative">
        <div class="flex items-center gap-2">
            <button on:click={handleSplit} class="text-gray-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-700 transition-colors text-xs" title="Split (Ctrl+B)">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/></svg>
                Split
            </button>
            <!-- 分隔線 -->
        <div class="w-[1px] h-4 bg-gray-600 mx-1"></div>

        <!-- 🔥 Undo Button -->
        <button 
            on:click={undo} 
            disabled={$historyStack.past.length === 0}
            class="text-gray-400 hover:text-white flex items-center justify-center p-1.5 rounded hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" 
            title="Undo (Ctrl+Z)"
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
        </button>

        <!-- 🔥 Redo Button -->
        <button 
            on:click={redo} 
            disabled={$historyStack.future.length === 0}
            class="text-gray-400 hover:text-white flex items-center justify-center p-1.5 rounded hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" 
            title="Redo (Ctrl+Y)"
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 3.7"/></svg>
        </button>
        </div>
        <div class="flex items-center gap-3">
            <span class="text-xs text-gray-400">Zoom</span>
            <input type="range" min="10" max="100" step="5" bind:value={pixelsPerSecond} class="w-32 accent-cyan-500 h-1 bg-gray-600 rounded appearance-none cursor-pointer">
            <span class="text-xs text-gray-500 w-8 text-right">{pixelsPerSecond}px</span>
        </div>
    </div>

    <!-- 🔥 使用 on:scroll 代替 bind:scrollLeft -->
    <div 
        bind:this={scrollContainer} 
        bind:clientWidth={visibleWidth}
        on:scroll={handleScroll}
        class="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar relative"
    >
        <div bind:this={timelineContainer} class="relative h-full flex flex-col min-w-full" style="width: {totalDuration * pixelsPerSecond + 100}px;" on:mousedown={handleTimelineMouseDown}>

            <!-- Ruler -->
            <div class="h-6 border-b border-gray-700 flex text-[10px] text-gray-500 bg-[#181818] sticky left-0 z-20 pointer-events-none">
                <div class="w-24 border-r border-gray-700 shrink-0 bg-[#181818] sticky left-0 z-30"></div> 
                <div class="flex-1 relative">
                    {#each Array(Math.ceil(totalDuration / 5)) as _, i}
                        <div class="absolute border-l border-gray-700 pl-1 h-full" style="left: {i * 5 * pixelsPerSecond}px">{i * 5}s</div>
                    {/each}
                </div>
            </div>

            <!-- Playhead -->
            <div class="absolute top-0 bottom-0 w-[1px] bg-cyan-400 z-40 pointer-events-none will-change-transform" style="left: 0; transform: translateX({96 + ($currentTime * pixelsPerSecond)}px) translateZ(0);">
                <div class="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 -mt-1.5 rotate-45 bg-cyan-400 rounded-sm"></div>
            </div>

            {#if isSelecting}
                <div class="absolute border border-cyan-500 bg-cyan-500/20 z-50 pointer-events-none" style="left: {selectBox.x}px; top: {selectBox.y}px; width: {selectBox.width}px; height: {selectBox.height}px;"></div>
            {/if}

            {#if showGuide}
                <div class="fixed top-[calc(60%-1px)] bottom-0 w-[1px] bg-white/50 z-[60] pointer-events-none border-l border-dashed border-white" style="left: {guideX}px;">
                    <div class="absolute -top-8 -left-8 bg-black/90 text-white text-[10px] px-2 py-1 rounded border border-gray-600 whitespace-nowrap">{guideTimeText}</div>
                </div>
            {/if}

            <div class="flex-1 relative">
                <!-- Text Track -->
                <div class="flex h-16 border-b border-gray-800 relative track-bg">
                    <div class="w-24 shrink-0 border-r border-gray-700 flex items-center pl-3 text-xs text-gray-400 bg-[#181818] z-30 sticky left-0 h-full">Text</div>
                    <div class="flex-1 bg-[#151515] relative h-full track-bg">
                        {#each $textTrackClips as clip (clip.id)}
                            <div 
                                class="absolute top-2 bottom-2 rounded-lg overflow-hidden border backdrop-blur-sm transition-colors cursor-move 
                                       { $selectedClipIds.includes(clip.id) 
                                            ? 'border-purple-300 bg-purple-500/40 ring-1 ring-purple-300 z-20' 
                                            : 'border-purple-500/30 bg-purple-900/20 hover:border-purple-400/60 hover:bg-purple-500/30' }" 
                                style="left: {clip.startOffset * pixelsPerSecond}px; width: {clip.duration * pixelsPerSecond}px;" 
                                title={clip.name} 
                                on:mousedown={(e) => startMoveClip(e, clip, 'text')} 
                                on:click={(e) => selectClip(e, clip.id)} 
                                on:contextmenu={(e) => handleContextMenu(e, clip.id)}
                            >
                                <div class="w-full h-full flex items-center px-2 gap-2 pointer-events-none">
                                    <div class="w-4 h-4 rounded bg-purple-500/80 flex items-center justify-center shrink-0 shadow-sm">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"/><path d="M12 7v14"/></svg>
                                    </div>
                                    <span class="text-[11px] text-purple-100 truncate font-medium tracking-wide drop-shadow-md">
                                        {clip.text || 'New Text'}
                                    </span>
                                </div>
                                <div class="absolute top-0 bottom-0 left-0 w-4 cursor-ew-resize z-50 hover:bg-white/10 transition-colors flex items-center justify-center" on:mousedown={(e) => startResize(e, clip, 'text', 'start')} on:click|stopPropagation><div class="w-[2px] h-3 bg-white/40 rounded-full"></div></div>
                                <div class="absolute top-0 bottom-0 right-0 w-4 cursor-ew-resize z-50 hover:bg-white/10 transition-colors flex items-center justify-center" on:mousedown={(e) => startResize(e, clip, 'text', 'end')} on:click|stopPropagation><div class="w-[2px] h-3 bg-white/40 rounded-full"></div></div>
                            </div>
                        {/each}
                    </div>
                </div>

                <!-- Main Track -->
                <div class="flex h-24 border-b border-gray-800 group relative track-bg" on:dragover={handleDragOver} on:drop={handleDrop}>
                    <div class="w-24 shrink-0 border-r border-gray-700 flex flex-col justify-center pl-3 text-xs text-gray-400 bg-[#181818] z-30 sticky left-0 h-full">
                        <div class="flex items-center gap-2"><span>Main Track</span></div>
                    </div>
                    <div class="flex-1 relative h-full bg-[#151515] track-bg">
                        {#each $mainTrackClips as clip (clip.id)}
                            <div 
                                class="absolute top-2 bottom-2 rounded overflow-hidden border bg-cyan-900/50 group/clip cursor-move { $selectedClipIds.includes(clip.id) ? 'border-white ring-1 ring-white z-10' : 'border-cyan-600' }" 
                                style="left: {clip.startOffset * pixelsPerSecond}px; width: {clip.duration * pixelsPerSecond}px;" 
                                title={clip.name} 
                                on:mousedown={(e) => startMoveClip(e, clip, 'main')} 
                                on:click={(e) => selectClip(e, clip.id)} 
                                on:contextmenu={(e) => handleContextMenu(e, clip.id)}
                            >
                                {#if clip.thumbnailUrls && clip.thumbnailUrls.length > 0}
                                    <div 
                                        class="absolute top-0 bottom-0 flex overflow-hidden pointer-events-none select-none opacity-50 h-full" 
                                        style="left: {clip.sourceDuration === Infinity ? 0 : -(clip.mediaStartOffset || 0) * pixelsPerSecond}px; width: {clip.sourceDuration === Infinity ? '100%' : (clip.sourceDuration * pixelsPerSecond) + 'px'};"
                                    >
                                        {#each clip.thumbnailUrls as url}
                                        <div class="flex-1 h-full min-w-0 border-r border-white/20 last:border-0 overflow-hidden bg-black/50">
                                            <img src={url} class="w-full h-full object-cover opacity-80" alt="frame" draggable="false" />
                                        </div>
                                        {/each}
                                    </div>
                                {/if}
                                <div class="w-full h-full flex items-center justify-center pointer-events-none relative z-10"><span class="text-[10px] text-white truncate px-1 drop-shadow-md font-medium">{clip.name}</span></div>
                                <div class="absolute top-0 bottom-0 left-0 w-4 cursor-ew-resize z-50 hover:bg-cyan-400/50 transition-colors flex items-center justify-center" on:mousedown={(e) => startResize(e, clip, 'main', 'start')} on:click|stopPropagation><div class="w-[2px] h-4 bg-white/50 rounded-full"></div></div>
                                <div class="absolute top-0 bottom-0 right-0 w-4 cursor-ew-resize z-50 hover:bg-cyan-400/50 transition-colors flex items-center justify-center" on:mousedown={(e) => startResize(e, clip, 'main', 'end')} on:click|stopPropagation><div class="w-[2px] h-4 bg-white/50 rounded-full"></div></div>
                            </div>
                        {/each}
                    </div>
                </div>
                
                <!-- Audio Track -->
                <div class="flex h-16 border-b border-gray-800 relative track-bg" on:dragover={handleDragOver} on:drop={handleAudioDrop}>
                     <div class="w-24 shrink-0 border-r border-gray-700 flex items-center pl-3 text-xs text-gray-400 bg-[#181818] z-30 sticky left-0 h-full">Audio</div>
                    <div class="flex-1 bg-[#151515] relative h-full track-bg">
                        {#each $audioTrackClips as clip (clip.id)}
                            <div 
                                class="absolute top-2 bottom-2 rounded-lg overflow-hidden border border-white/20 bg-gray-800/40 group/clip cursor-move { $selectedClipIds.includes(clip.id) ? 'border-white ring-1 ring-white z-10' : 'hover:border-white/40' }" 
                                style="left: {clip.startOffset * pixelsPerSecond}px; width: {clip.duration * pixelsPerSecond}px;" 
                                title={clip.name} 
                                on:mousedown={(e) => startMoveClip(e, clip, 'audio')} 
                                on:click={(e) => selectClip(e, clip.id)} 
                                on:contextmenu={(e) => handleContextMenu(e, clip.id)}
                            >
                                {#if clip.waveform}
                                    <canvas class="absolute inset-0 w-full h-full pointer-events-none opacity-80" use:drawWaveform={clip}></canvas>
                                {/if}
                                <div class="w-full h-full flex items-start justify-start pointer-events-none relative z-10 p-1">
                                    <span class="text-[10px] text-white/80 truncate px-1.5 py-0.5 bg-black/30 rounded">🎵 {clip.name}</span>
                                </div>
                                <div class="absolute top-0 bottom-0 left-0 w-4 cursor-ew-resize z-50 hover:bg-white/10 transition-colors flex items-center justify-center" on:mousedown={(e) => startResize(e, clip, 'audio', 'start')} on:click|stopPropagation><div class="w-[2px] h-4 bg-white/50 rounded-full"></div></div>
                                <div class="absolute top-0 bottom-0 right-0 w-4 cursor-ew-resize z-50 hover:bg-white/10 transition-colors flex items-center justify-center" on:mousedown={(e) => startResize(e, clip, 'audio', 'end')} on:click|stopPropagation><div class="w-[2px] h-4 bg-white/50 rounded-full"></div></div>
                            </div>
                        {/each}
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
  .custom-scrollbar::-webkit-scrollbar { height: 8px; }
  .custom-scrollbar::-webkit-scrollbar-track { background: #181818; }
  .custom-scrollbar::-webkit-scrollbar-thumb { background: #444; border-radius: 4px; }
  .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #555; }
  .cursor-ew-resize { cursor: ew-resize; }
  .cursor-move { cursor: grab; }
  .cursor-move:active { cursor: grabbing; }
</style>