<script>
    import { mainTrackClips, generateId } from '../stores/timelineStore';
    import { currentTime, isPlaying } from '../stores/playerStore'; // 引入播放相關 Store
    import { onMount } from 'svelte';

    const PIXELS_PER_SECOND = 20; 
    
    // --- 1. 狀態變數定義 (這是報錯缺失的部分) ---
    let totalDuration = 60;     // 總時間長度
    let resizingClipId = null;  // 正在縮放的 ID
    let initialX = 0;           // 縮放起始 X
    let initialDuration = 0;    // 縮放起始長度
    let maxDurationLimit = 0;   // 縮放最大限制

    // --- 2. Reactive: 自動計算總時間軸長度 ---
    $: {
        const maxClipEnd = $mainTrackClips.length > 0 
            ? Math.max(...$mainTrackClips.map(c => c.startOffset + c.duration)) 
            : 0;
        // 確保至少有 60秒，或是最遠片段後再加 30秒
        totalDuration = Math.max(60, maxClipEnd + 30);
    }

    // --- 3. 拖放邏輯 (Drag & Drop) ---
    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }

    function handleDrop(e) {
        e.preventDefault();
        const data = e.dataTransfer.getData('application/json');
        
        if (data) {
            const file = JSON.parse(data);
            // 找出目前最後一個片段的結束時間，把新片段接在後面
            const currentMaxTime = $mainTrackClips.length > 0 
                ? Math.max(...$mainTrackClips.map(c => c.startOffset + c.duration)) 
                : 0;
            
            const originalDuration = file.duration || 5;

            const newClip = {
                id: generateId(),
                fileUrl: file.url,
                name: file.name,
                type: file.type,
                startOffset: currentMaxTime,
                duration: originalDuration, 
                sourceDuration: originalDuration 
            };
            mainTrackClips.update(clips => [...clips, newClip]);
        }
    }

    // --- 4. 縮放邏輯 (Resizing) ---
    function startResize(e, clip) {
        e.stopPropagation(); // 防止觸發 Timeline 的點擊跳轉
        
        resizingClipId = clip.id;
        initialX = e.clientX;
        initialDuration = clip.duration;
        maxDurationLimit = clip.sourceDuration || clip.duration;

        window.addEventListener('mousemove', handleResizeMove);
        window.addEventListener('mouseup', stopResize);
    }

    function handleResizeMove(e) {
        if (!resizingClipId) return;

        const deltaX = e.clientX - initialX;
        const deltaSeconds = deltaX / PIXELS_PER_SECOND; 
        
        let newDuration = initialDuration + deltaSeconds;
        newDuration = Math.max(0.5, newDuration); // 最小 0.5s
        newDuration = Math.min(maxDurationLimit, newDuration); // 最大不超過原始長度

        mainTrackClips.update(clips => 
            clips.map(c => c.id === resizingClipId ? { ...c, duration: newDuration } : c)
        );
    }

    function stopResize() {
        resizingClipId = null;
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', stopResize);
    }

    // --- 5. 點擊跳轉邏輯 (Click to Seek) ---
    function handleTimelineClick(e) {
        // 取得點擊位置相對於容器的 X 座標
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        
        // 扣掉左側 Header 的寬度 (96px)
        const timelineX = x - 96; 
        
        // 換算成秒數，並防止負數
        const newTime = Math.max(0, timelineX / PIXELS_PER_SECOND);
        
        // 更新 Store，這會讓指針移動，也會讓 VideoPlayer 跳轉
        currentTime.set(newTime);
    }
</script>

<!-- HTML 結構 -->
<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="h-[35%] bg-[#181818] border-t border-gray-700 flex flex-col relative select-none overflow-x-auto overflow-y-hidden custom-scrollbar">
    
    <div 
        class="relative h-full flex flex-col min-w-full"
        style="width: {totalDuration * PIXELS_PER_SECOND + 100}px;"
        on:click={handleTimelineClick} 
    >

        <!-- Ruler (時間刻度尺) -->
        <div class="h-6 border-b border-gray-700 flex text-[10px] text-gray-500 bg-[#181818] sticky left-0 z-20">
            <div class="w-24 border-r border-gray-700 shrink-0 bg-[#181818] sticky left-0 z-30"></div> 
            <div class="flex-1 relative">
                {#each Array(Math.ceil(totalDuration / 5)) as _, i}
                    <div class="absolute border-l border-gray-700 pl-1 h-full" style="left: {i * 5 * PIXELS_PER_SECOND}px">
                        {i * 5}s
                    </div>
                {/each}
            </div>
        </div>

        <!-- Playhead (藍色播放指針) -->
        <!-- 位置綁定 $currentTime -->
        <div 
            class="absolute top-0 bottom-0 w-[1px] bg-cyan-400 z-40 pointer-events-none transition-all duration-75 ease-linear"
            style="left: {96 + ($currentTime * PIXELS_PER_SECOND)}px;"
        >
            <div class="w-3 h-3 -ml-[5px] -mt-1.5 rotate-45 bg-cyan-400 rounded-sm"></div>
        </div>

        <!-- Tracks (軌道區) -->
        <div class="flex-1 relative">
            
            <!-- Main Track -->
            <div 
                class="flex h-24 border-b border-gray-800 group relative"
                on:dragover={handleDragOver}
                on:drop={handleDrop}
            >
                <div class="w-24 shrink-0 border-r border-gray-700 flex flex-col justify-center pl-3 text-xs text-gray-400 bg-[#181818] z-30 sticky left-0 h-full">
                    <div class="flex items-center gap-2"><span>Main Track</span></div>
                </div>

                <div class="flex-1 relative h-full bg-[#151515]">
                    {#each $mainTrackClips as clip (clip.id)}
                        <div 
                            class="absolute top-2 bottom-2 rounded overflow-hidden border border-cyan-600 bg-cyan-900/50 group/clip"
                            style="
                                left: {clip.startOffset * PIXELS_PER_SECOND}px; 
                                width: {clip.duration * PIXELS_PER_SECOND}px;
                            "
                            title={clip.name}
                        >
                            <div class="w-full h-full flex items-center justify-center pointer-events-none">
                                <span class="text-[10px] text-white truncate px-1">
                                    {clip.name} ({clip.duration.toFixed(1)}s)
                                </span>
                            </div>

                            <!-- Resize Handle -->
                            <!-- svelte-ignore a11y-no-static-element-interactions -->
                            <div 
                                class="absolute top-0 bottom-0 right-0 w-4 cursor-ew-resize z-50 hover:bg-cyan-400/50 transition-colors flex items-center justify-center"
                                on:mousedown={(e) => startResize(e, clip)}
                                on:click|stopPropagation
                            >
                                <div class="w-[2px] h-4 bg-white/50 rounded-full"></div>
                            </div>

                        </div>
                    {/each}
                </div>
            </div>
            
            <!-- Audio Track -->
            <div class="flex h-16 border-b border-gray-800 relative">
                 <div class="w-24 shrink-0 border-r border-gray-700 flex items-center pl-3 text-xs text-gray-400 bg-[#181818] z-30 sticky left-0 h-full">Audio</div>
                <div class="flex-1 bg-[#151515]"></div>
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
</style>