import { useState, useEffect, useRef, ChangeEvent, FormEvent } from "react";
import { Quote, VehicleType } from "../types";
import { QUOTES } from "../data/quotes";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { collection, addDoc } from "firebase/firestore";
import { Zap, Play, RotateCcw, Save, Sparkles, CheckCircle2, Flame } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";


interface TyperacerGameProps {
  onScoreSaved: () => void;
}

export default function TyperacerGame({ onScoreSaved }: TyperacerGameProps) {
  // Game Setup States
  const [vehicle, setVehicle] = useState<VehicleType>("car");
  const [difficulty, setDifficulty] = useState<"all" | "easy" | "medium" | "hard">("all");
  const [quote, setQuote] = useState<Quote>(QUOTES[0]);

  // Gameplay States
  const [gameState, setGameState] = useState<"setup" | "countdown" | "playing" | "finished">("setup");
  const [countdown, setCountdown] = useState(3);
  const [userInput, setUserInput] = useState("");
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0); // in seconds
  const [mistakeCount, setMistakeCount] = useState(0);
  const [realtimeWpm, setRealtimeWpm] = useState(0);
  const [realtimeAccuracy, setRealtimeAccuracy] = useState(100);

  // Score Saving States
  const [playerName, setPlayerName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Refs for tracking and focusing
  const inputRef = useRef<HTMLInputElement>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Track unique keys pressed to count total inputs vs mistakes
  const totalTypedCharactersRef = useRef(0);
  const processedMistakesRef = useRef<Set<number>>(new Set());

  // Set initial random quote
  useEffect(() => {
    getRandomQuote();
  }, [difficulty]);

  // Handle countdown timer
  useEffect(() => {
    if (gameState !== "countdown") return;

    playBeep(440, 100); // Countdown blip

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setGameState("playing");
          setStartTime(Date.now());
          setElapsedTime(0);
          setUserInput("");
          totalTypedCharactersRef.current = 0;
          processedMistakesRef.current.clear();
          setMistakeCount(0);
          setRealtimeWpm(0);
          setRealtimeAccuracy(100);
          playBeep(880, 250); // GO beep!
          return 3;
        }
        playBeep(440, 100); // Countdown blip
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [gameState]);

  // Focus input automatically when race starts
  useEffect(() => {
    if (gameState === "playing" && inputRef.current) {
      inputRef.current.focus();
    }
  }, [gameState]);

  // Handle playing timer
  useEffect(() => {
    if (gameState !== "playing" || !startTime) {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      return;
    }

    timerIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setElapsedTime(elapsed);

      // Update real-time statistics
      if (elapsed > 0.5) {
        // Calculate matching portion
        const matchingLength = getMatchingLength(userInput, quote.text);
        const wpm = Math.round((matchingLength / 5) / (elapsed / 60));
        setRealtimeWpm(wpm);

        const totalTyped = totalTypedCharactersRef.current;
        const accuracy = totalTyped > 0 
          ? Math.max(0, Math.min(100, ((totalTyped - mistakeCount) / totalTyped) * 100))
          : 100;
        setRealtimeAccuracy(accuracy);
      }
    }, 100);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [gameState, startTime, userInput, quote, mistakeCount]);

  // Web Audio synth for nice sound effects
  const playBeep = (freq: number, duration: number) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = freq;
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration / 1000);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + duration / 1000);
    } catch (e) {
      // AudioContext blocked or not supported
    }
  };

  const playSuccessFanfare = () => {
    const scale = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    scale.forEach((note, index) => {
      setTimeout(() => playBeep(note, 150), index * 120);
    });
  };

  // Select random quote based on selected difficulty
  const getRandomQuote = () => {
    const filtered = difficulty === "all"
      ? QUOTES
      : QUOTES.filter((q) => q.difficulty === difficulty);
    const randomIndex = Math.floor(Math.random() * filtered.length);
    setQuote(filtered[randomIndex] || QUOTES[0]);
  };

  const startRace = () => {
    setSavedSuccess(false);
    setPlayerName("");
    setGameState("countdown");
    setCountdown(3);
  };

  const getMatchingLength = (input: string, text: string): number => {
    let matching = 0;
    const minLen = Math.min(input.length, text.length);
    for (let i = 0; i < minLen; i++) {
      if (input[i] === text[i]) {
        matching++;
      } else {
        break;
      }
    }
    return matching;
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    
    // Only accept typing if we are actively playing
    if (gameState !== "playing") return;

    // Track total unique key characters typed (excluding backspaces/special controls)
    if (val.length > userInput.length) {
      totalTypedCharactersRef.current += 1;
      
      // Look at the character just added
      const lastTypedIdx = val.length - 1;
      const expectedChar = quote.text[lastTypedIdx];
      const typedChar = val[lastTypedIdx];

      // If it's a mistake and we haven't logged this character index as a mistake yet
      if (typedChar !== expectedChar && !processedMistakesRef.current.has(lastTypedIdx)) {
        processedMistakesRef.current.add(lastTypedIdx);
        setMistakeCount((prev) => prev + 1);
        playBeep(220, 80); // Lower-pitched buzzer for mistakes
      }
    }

    setUserInput(val);

    // Check if fully finished (input exactly matches quote text)
    if (val === quote.text) {
      const finalEndTime = Date.now();
      const totalElapsed = (finalEndTime - (startTime || finalEndTime)) / 1000;
      setElapsedTime(totalElapsed);
      setGameState("finished");
      
      // Calculate final exact stats
      const finalWpm = Math.round((quote.text.length / 5) / (totalElapsed / 60));
      setRealtimeWpm(finalWpm);

      const finalTotalTyped = totalTypedCharactersRef.current;
      const finalAccuracy = finalTotalTyped > 0
        ? Math.max(0, Math.min(100, ((finalTotalTyped - mistakeCount) / finalTotalTyped) * 100))
        : 100;
      setRealtimeAccuracy(finalAccuracy);

      playSuccessFanfare();
    }
  };

  // Calculate the styled slices of text to display
  const renderQuoteText = () => {
    const text = quote.text;
    const inputLen = userInput.length;
    
    // Find matching part
    const matchingCount = getMatchingLength(userInput, text);
    
    // The correct part (matched prefix)
    const correctText = text.substring(0, matchingCount);
    
    // The incorrect part (what the user typed wrong)
    const incorrectCount = inputLen - matchingCount;
    const incorrectText = text.substring(matchingCount, matchingCount + incorrectCount);
    
    // The upcoming part (rest of the quote)
    const upcomingText = text.substring(matchingCount + incorrectCount);

    return (
      <div className="font-sans text-lg md:text-xl leading-relaxed tracking-wide text-slate-700 bg-slate-50/50 p-6 md:p-8 rounded-2xl border border-slate-100 shadow-inner relative overflow-hidden" id="quote-display-container">
        {/* Subtle decorative quote marks */}
        <div className="absolute top-2 left-3 text-slate-200/60 font-serif text-5xl select-none">“</div>
        <div className="absolute bottom-[-15px] right-3 text-slate-200/60 font-serif text-5xl select-none">”</div>

        <span className="text-emerald-600 font-semibold bg-emerald-50 border-b-2 border-emerald-500 py-0.5" id="text-correct">
          {correctText}
        </span>
        {incorrectText && (
          <span className="text-rose-600 bg-rose-50 border-b-2 border-rose-500 py-0.5" id="text-incorrect-highlight">
            {incorrectText}
          </span>
        )}
        <span className="text-slate-400 font-normal relative" id="text-upcoming">
          {/* Virtual caret blinking indicator at current spot */}
          {incorrectText.length === 0 && (
            <span className="absolute left-0 top-0.5 w-[2px] h-[1.2em] bg-emerald-500 animate-pulse" />
          )}
          {upcomingText}
        </span>
        <div className="text-right text-xs font-medium text-slate-400 mt-4 italic" id="quote-author">
          — {quote.source}
        </div>
      </div>
    );
  };

  // Save score to Firestore
  const saveScoreToFirestore = async (e: FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) return;

    setIsSaving(true);
    try {
      const scoreData = {
        name: playerName.trim(),
        wpm: realtimeWpm,
        accuracy: Math.round(realtimeAccuracy),
        errors: mistakeCount,
        vehicle: vehicle,
        createdAt: Date.now(),
      };
      await addDoc(collection(db, "typeracer_scores"), scoreData);
      setSavedSuccess(true);
      playSuccessFanfare();
      
      // Auto transition to leaderboard after 1.5 seconds
      setTimeout(() => {
        onScoreSaved();
      }, 1500);
    } catch (err: any) {
      console.error("Error writing document: ", err);
      alert("Failed to save score. Please try again.");
      handleFirestoreError(err, OperationType.WRITE, "typeracer_scores");
    } finally {
      setIsSaving(false);
    }
  };

  // Game Progress Percentage
  const progressPercent = quote.text.length > 0 
    ? (getMatchingLength(userInput, quote.text) / quote.text.length) * 100
    : 0;

  // Track Themes based on vehicle
  const getTrackStyle = () => {
    if (vehicle === "rocket") {
      return {
        containerClass: "bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 border-indigo-900/30",
        laneClass: "border-indigo-500/20 bg-slate-900/50",
        roadLineClass: "border-dashed border-indigo-400/40",
        emoji: "🚀",
        accentColor: "indigo"
      };
    }
    if (vehicle === "horse") {
      return {
        containerClass: "bg-gradient-to-r from-emerald-100 via-green-50 to-emerald-100 border-emerald-200/50",
        laneClass: "border-emerald-500/10 bg-emerald-50/20",
        roadLineClass: "border-dashed border-emerald-300/30",
        emoji: "🐎",
        accentColor: "emerald"
      };
    }
    // Default Car
    return {
      containerClass: "bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 border-slate-200",
      laneClass: "border-slate-300/10 bg-slate-100/30",
      roadLineClass: "border-dashed border-slate-300/50",
      emoji: "🚗",
      accentColor: "slate"
    };
  };

  const track = getTrackStyle();

  return (
    <div className="w-full max-w-2xl mx-auto" id="typeracer-game-container">
      {gameState === "setup" && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl border border-slate-100 shadow-xl p-6 md:p-8"
          id="game-setup-panel"
        >
          <div className="text-center mb-8">
            <span className="px-3 py-1 bg-emerald-50 text-emerald-600 text-xs font-mono font-bold tracking-wider rounded-full uppercase" id="game-tagline">
              English Typing Speed Test
            </span>
            <h2 className="text-3xl font-sans font-extrabold text-slate-800 tracking-tight mt-3" id="game-headline">
              Are you ready to Race?
            </h2>
            <p className="text-slate-500 text-sm mt-2" id="game-instructions">
              Select your vehicle, choose a difficulty, and match the text perfectly.
            </p>
          </div>

          <div className="space-y-6" id="game-options-container">
            {/* Vehicle selection */}
            <div id="vehicle-selection-container">
              <label className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 block mb-3">
                1. Select Your Ride
              </label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: "car", label: "Race Car", icon: "🚗", desc: "Sleek Asphalt Track" },
                  { id: "rocket", label: "Rocket", icon: "🚀", desc: "Cosmic Nebula Lane" },
                  { id: "horse", label: "Horse", icon: "🐎", desc: "Grass Pasture Trail" }
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setVehicle(option.id as VehicleType)}
                    className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer ${
                      vehicle === option.id
                        ? "border-emerald-500 bg-emerald-50/30 shadow-md text-emerald-900"
                        : "border-slate-100 bg-white hover:border-slate-200 text-slate-600 hover:shadow-sm"
                    }`}
                    id={`vehicle-option-${option.id}`}
                  >
                    <span className="text-3xl mb-2">{option.icon}</span>
                    <span className="text-xs font-bold tracking-tight">{option.label}</span>
                    <span className="text-[10px] text-slate-400 mt-1">{option.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Difficulty selection */}
            <div id="difficulty-selection-container">
              <label className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 block mb-3">
                2. Difficulty Level
              </label>
              <div className="flex gap-2">
                {[
                  { id: "all", label: "All Levels" },
                  { id: "easy", label: "Easy" },
                  { id: "medium", label: "Medium" },
                  { id: "hard", label: "Hard" }
                ].map((level) => (
                  <button
                    key={level.id}
                    onClick={() => setDifficulty(level.id as any)}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer text-center ${
                      difficulty === level.id
                        ? "bg-slate-800 border-slate-800 text-white shadow-sm"
                        : "bg-slate-50 hover:bg-slate-100 border-slate-150 text-slate-600"
                    }`}
                    id={`difficulty-option-${level.id}`}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Current quote preview */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100" id="quote-preview-container">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-mono font-bold uppercase text-slate-400">Quote Preview</span>
                <button
                  onClick={getRandomQuote}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-semibold flex items-center gap-1 cursor-pointer"
                  id="new-quote-btn"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Different Quote
                </button>
              </div>
              <p className="text-slate-600 text-sm italic line-clamp-2">"{quote.text}"</p>
            </div>

            {/* Start button */}
            <button
              onClick={startRace}
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99] text-white font-sans font-bold rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all duration-150 cursor-pointer text-base mt-4"
              id="start-race-btn"
            >
              <Play className="w-5 h-5 fill-current" />
              Enter the Race Track
            </button>
          </div>
        </motion.div>
      )}

      {/* Countdown overlay */}
      {gameState === "countdown" && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-xl p-12 text-center flex flex-col items-center justify-center py-20 relative overflow-hidden" id="countdown-panel">
          <div className="absolute inset-0 bg-slate-50/40 backdrop-blur-[1px]"></div>
          <div className="relative z-10">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-emerald-500 mb-2 block">Starting Engine</span>
            <motion.div
              key={countdown}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1.2, opacity: 1 }}
              exit={{ scale: 1.5, opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="text-7xl md:text-8xl font-black text-slate-800"
              id="countdown-timer-value"
            >
              {countdown}
            </motion.div>
            <p className="text-slate-500 text-sm mt-4">Place your hands on the keyboard!</p>
          </div>
        </div>
      )}

      {/* Active Racing Screen */}
      {(gameState === "playing" || gameState === "finished") && (
        <div className="space-y-6" id="active-race-panel">
          {/* Race Track Canvas */}
          <div className={`p-4 md:p-6 rounded-2xl border shadow-lg overflow-hidden ${track.containerClass}`} id="racing-canvas">
            <div className="flex justify-between items-center mb-4 text-xs font-mono font-bold uppercase tracking-wide text-slate-400">
              <span className={vehicle === "rocket" ? "text-indigo-300" : vehicle === "horse" ? "text-emerald-700" : "text-slate-500"}>
                RACING TRACK
              </span>
              <span className="flex items-center gap-1 bg-white/60 px-2 py-1 rounded border border-white/80 text-slate-700">
                🏁 FINISH
              </span>
            </div>

            {/* Lane */}
            <div className={`relative h-20 rounded-xl border flex items-center px-4 ${track.laneClass}`} id="racing-lane">
              {/* Lane Center Line */}
              <div className={`absolute left-0 right-0 top-[49%] h-0.5 border-t ${track.roadLineClass}`}></div>

              {/* Vehicle Body moving forward */}
              <motion.div
                className="absolute text-4xl md:text-5xl z-10 select-none flex flex-col items-center"
                style={{ left: `calc(${progressPercent}% - 24px)` }}
                animate={{ x: [0, 1, -1, 0] }}
                transition={{ repeat: Infinity, duration: 0.15 }}
                id="racer-vehicle"
              >
                {track.emoji}
                {/* Mini Speed trail */}
                {gameState === "playing" && progressPercent > 0 && (
                  <span className="absolute right-full top-3 text-xs opacity-60 mr-1 animate-pulse">
                    {vehicle === "rocket" ? "✨" : vehicle === "horse" ? "💨" : "⚡"}
                  </span>
                )}
              </motion.div>
            </div>
          </div>

          {/* Text and stats */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-xl p-6 md:p-8 space-y-6" id="gameplay-box">
            {/* Live stats dashboard */}
            <div className="grid grid-cols-3 gap-3" id="live-stats-dashboard">
              <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100" id="live-stat-wpm">
                <span className="text-[10px] font-mono font-semibold uppercase text-slate-400 block">SPEED</span>
                <span className="text-xl md:text-2xl font-black text-emerald-600 font-mono">
                  {realtimeWpm} <span className="text-xs font-normal text-slate-500">WPM</span>
                </span>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100" id="live-stat-accuracy">
                <span className="text-[10px] font-mono font-semibold uppercase text-slate-400 block">ACCURACY</span>
                <span className="text-xl md:text-2xl font-black text-amber-600 font-mono">
                  {Math.round(realtimeAccuracy)}%
                </span>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100" id="live-stat-errors">
                <span className="text-[10px] font-mono font-semibold uppercase text-slate-400 block">MISTAKES</span>
                <span className="text-xl md:text-2xl font-black text-rose-600 font-mono">
                  {mistakeCount}
                </span>
              </div>
            </div>

            {/* Displaying Quote text */}
            {renderQuoteText()}

            {/* Input field */}
            {gameState === "playing" && (
              <div className="relative" id="typing-input-container">
                <input
                  ref={inputRef}
                  type="text"
                  value={userInput}
                  onChange={handleInputChange}
                  placeholder="Type the quote exactly here..."
                  className="w-full py-4 px-5 pr-12 text-base md:text-lg border-2 border-slate-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 rounded-xl outline-none transition-all font-sans bg-white shadow-sm placeholder-slate-400 text-slate-800"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck="false"
                  id="typeracer-text-input"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300">
                  <Zap className="w-5 h-5" />
                </div>
              </div>
            )}

            {/* Cancel/Reset button */}
            <div className="flex gap-3 justify-end pt-2" id="game-controls">
              <button
                onClick={() => setGameState("setup")}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                id="cancel-race-btn"
              >
                Cancel Race
              </button>
              <button
                onClick={startRace}
                className="px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center gap-1.5"
                id="restart-race-btn"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restart Match
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finished Game / Score Saver screen */}
      {gameState === "finished" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl border border-slate-100 shadow-2xl p-6 md:p-8 space-y-8 mt-6"
          id="score-submit-panel"
        >
          <div className="text-center relative py-4">
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-500 border border-emerald-100">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h2 className="text-3xl font-sans font-black text-slate-800 tracking-tight" id="completion-title">
              Race Completed! 🏁
            </h2>
            <p className="text-slate-500 text-sm mt-1" id="completion-subtitle">
              Outstanding effort. Check out your driving statistics below.
            </p>
          </div>

          {/* Stats Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4" id="final-stats-grid">
            <div className="bg-emerald-50/30 rounded-xl p-4 text-center border border-emerald-500/10">
              <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block mb-1">FINAL WPM</span>
              <span className="text-3xl font-black text-emerald-700 font-mono">{realtimeWpm}</span>
            </div>
            <div className="bg-amber-50/30 rounded-xl p-4 text-center border border-amber-500/10">
              <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block mb-1">ACCURACY</span>
              <span className="text-3xl font-black text-amber-700 font-mono">{Math.round(realtimeAccuracy)}%</span>
            </div>
            <div className="bg-rose-50/30 rounded-xl p-4 text-center border border-rose-500/10">
              <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block mb-1">MISTAKES</span>
              <span className="text-3xl font-black text-rose-700 font-mono">{mistakeCount}</span>
            </div>
            <div className="bg-indigo-50/30 rounded-xl p-4 text-center border border-indigo-500/10">
              <span className="text-[10px] font-mono font-bold uppercase text-slate-400 block mb-1">TIME</span>
              <span className="text-3xl font-black text-indigo-700 font-mono">{elapsedTime.toFixed(1)}s</span>
            </div>
          </div>

          {/* Save score section */}
          {!savedSuccess ? (
            <div className="p-6 bg-slate-50 rounded-xl border border-slate-100" id="save-score-section">
              <h3 className="text-sm font-sans font-bold text-slate-700 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-amber-500 animate-bounce" />
                Secure Your Spot on the Leaderboard
              </h3>
              <form onSubmit={saveScoreToFirestore} className="space-y-4" id="save-score-form">
                <div>
                  <input
                    type="text"
                    required
                    maxLength={20}
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="Enter your name / racer handle..."
                    className="w-full py-3.5 px-4 border border-slate-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 rounded-xl outline-none font-sans bg-white shadow-sm text-sm"
                    id="player-name-input"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSaving || !playerName.trim()}
                  className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99] disabled:opacity-50 text-white font-sans font-bold rounded-xl shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer text-sm"
                  id="submit-score-btn"
                >
                  {isSaving ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Score
                    </>
                  )}
                </button>
              </form>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-6 bg-emerald-50/50 border border-emerald-100 rounded-xl text-center flex flex-col items-center justify-center space-y-2"
              id="save-success-container"
            >
              <Sparkles className="w-8 h-8 text-emerald-500" />
              <h3 className="text-emerald-800 font-bold text-base">Score Saved Successfully!</h3>
              <p className="text-emerald-600 text-xs">Loading Top 10 Leaderboard rankings...</p>
            </motion.div>
          )}

          {/* Play again button */}
          <div className="flex gap-4 justify-center" id="finished-actions">
            <button
              onClick={() => {
                setGameState("setup");
                getRandomQuote();
              }}
              className="px-6 py-3 bg-slate-800 hover:bg-slate-900 text-white font-sans font-bold rounded-xl transition-all shadow-md cursor-pointer text-sm flex items-center gap-1.5"
              id="play-again-btn"
            >
              <RotateCcw className="w-4 h-4" />
              Play Again
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
