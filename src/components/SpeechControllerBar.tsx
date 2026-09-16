import React from 'react';
import { Play, Pause, Square, RotateCcw, Volume2, Gauge, X } from 'lucide-react';
import { SpeechRate, SpeechState } from '../lib/speechSynthesis';
import { MenuItem } from '../types';

interface SpeechControllerBarProps {
  items: MenuItem[];
  speechState: SpeechState;
  onReadFullMenu: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRepeat: () => void;
  onChangeRate: (rate: SpeechRate) => void;
}

export const SpeechControllerBar: React.FC<SpeechControllerBarProps> = ({
  items,
  speechState,
  onPause,
  onResume,
  onStop,
  onRepeat,
  onChangeRate,
}) => {
  const { isPlaying, isPaused, currentItemId, currentIndex, totalItems, rate } = speechState;

  // Only show when audio is playing or paused
  if (!isPlaying && !isPaused) {
    return null;
  }

  const activeItem = items.find((i) => i.id === currentItemId) || items[currentIndex];

  return (
    <div
      id="speech-controller-bar"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[95%] max-w-2xl bg-stone-950/95 backdrop-blur-md text-stone-100 rounded-2xl p-3 sm:p-4 shadow-2xl border border-amber-500/40 animate-in slide-in-from-bottom-5 duration-200"
      role="region"
      aria-label="Audio menu reader player"
    >
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Left: Active item being read */}
        <div className="flex items-center gap-3 w-full sm:w-auto min-w-0">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
            <Volume2 className="w-5 h-5 text-amber-400 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.2 rounded bg-stone-800 text-amber-300">
                {isPaused ? 'Paused' : 'Playing'}
              </span>
              <span className="text-xs text-stone-400 font-mono">
                {totalItems > 1 ? `${currentIndex + 1} / ${totalItems}` : 'Audio'}
              </span>
            </div>
            <p className="text-sm font-bold text-white truncate">
              {activeItem ? activeItem.englishName : 'Reading Menu...'}
            </p>
          </div>
        </div>

        {/* Right: Audio playback controls & speed */}
        <div className="flex items-center justify-between sm:justify-end gap-2.5 w-full sm:w-auto shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-stone-800">
          {/* Play/Pause */}
          {isPaused ? (
            <button
              id="btn-voice-resume"
              onClick={onResume}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-transform active:scale-95 shadow-xs cursor-pointer"
              aria-label="Resume voice playback"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Resume</span>
            </button>
          ) : (
            <button
              id="btn-voice-pause"
              onClick={onPause}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-transform active:scale-95 shadow-xs cursor-pointer"
              aria-label="Pause voice playback"
            >
              <Pause className="w-3.5 h-3.5 fill-current" />
              <span>Pause</span>
            </button>
          )}

          {/* Repeat */}
          <button
            id="btn-voice-repeat"
            onClick={onRepeat}
            className="p-2 bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white rounded-xl border border-stone-700 transition-colors cursor-pointer"
            aria-label="Repeat current item"
            title="Repeat Item"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Speed Toggle */}
          <button
            type="button"
            onClick={() => onChangeRate(rate === 'normal' ? 'slower' : 'normal')}
            className="px-2.5 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white rounded-xl border border-stone-700 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
            title="Toggle speech speed"
          >
            <Gauge className="w-3 h-3 text-amber-400" />
            <span>{rate === 'normal' ? '1.0x' : '0.75x'}</span>
          </button>

          {/* Stop / Close */}
          <button
            id="btn-voice-stop"
            onClick={onStop}
            className="p-2 bg-stone-800 hover:bg-red-950/80 text-stone-300 hover:text-red-400 rounded-xl border border-stone-700 hover:border-red-800 transition-colors cursor-pointer"
            aria-label="Stop reading"
            title="Stop Audio"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
