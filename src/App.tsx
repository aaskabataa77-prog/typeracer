import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  orderBy, 
  limit, 
  serverTimestamp,
  doc,
  setDoc,
  updateDoc,
  getDoc,
  deleteDoc,
  onSnapshot
} from 'firebase/firestore';
import { db } from './firebase';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Trophy, 
  User, 
  ChevronRight, 
  Check, 
  ShieldAlert,
  Sparkles,
  Award
} from 'lucide-react';
import { QUOTES } from './data/quotes';
import { Score, GameStatus, Quote, VehicleType } from './types';

// Supported Vehicles List
const VEHICLES_LIST = [
  { id: 'car', emoji: '🚗', label: 'Тэрэг' },
  { id: 'rocket', emoji: '🚀', label: 'Пуужин' },
  { id: 'horse', emoji: '🐎', label: 'Морь' },
  { id: 'plane', emoji: '✈️', label: 'Онгоц' },
  { id: 'ufo', emoji: '🛸', label: 'Таваг' },
  { id: 'dragon', emoji: '🐉', label: 'Луу' },
  { id: 'bicycle', emoji: '🚲', label: 'Дугуй' },
  { id: 'cheetah', emoji: '🐆', label: 'Ирвэс' },
] as const;

// Web Audio synthesizer for key feedback
const playSound = (type: 'keypress' | 'error' | 'countdown' | 'finish' | 'button', enabled = true) => {
  if (!enabled) return;
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (type === 'keypress') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    } else if (type === 'error') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } else if (type === 'countdown') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === 'finish') {
      // Small musical chime
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } else if (type === 'button') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(350, ctx.currentTime);
      gain.gain.setValueAtTime(0.03, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    }
  } catch (e) {
    // browser auto-play block protection
  }
};

export default function App() {
  // Game States
  const [quote, setQuote] = useState<Quote>(() => QUOTES.find(q => q.difficulty === 'medium') || QUOTES[0]);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [inputValue, setInputValue] = useState('');
  const [status, setStatus] = useState<GameStatus>('idle');
  const [countdown, setCountdown] = useState(3);
  const [vehicle, setVehicle] = useState<VehicleType>('car');
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  // Local History State
  const [history, setHistory] = useState<number[]>(() => {
    const saved = localStorage.getItem('typeracer_history');
    return saved ? JSON.parse(saved) : [];
  });

  // Scoring / Timing States
  const [startTime, setStartTime] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [errorsCount, setErrorsCount] = useState(0);
  const [totalKeystrokes, setTotalKeystrokes] = useState(0);
  
  // Registration Flow
  const [username, setUsername] = useState(() => {
    return localStorage.getItem('typeracer_username') || '';
  });
  const [isRegistered, setIsRegistered] = useState(() => {
    return !!localStorage.getItem('typeracer_username');
  });

  // Leaderboard States
  const [leaderboard, setLeaderboard] = useState<Score[]>([]);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  
  // Submission indicator
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Multiplayer States
  const [gameMode, setGameMode] = useState<'single' | 'multi'>('single');
  const [myPlayerId] = useState(() => {
    let id = localStorage.getItem('typeracer_player_id');
    if (!id) {
      id = 'p_' + Math.random().toString(36).substring(2, 11);
      localStorage.setItem('typeracer_player_id', id);
    }
    return id;
  });
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeRoomData, setActiveRoomData] = useState<any | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [multiplayerError, setMultiplayerError] = useState<string | null>(null);
  const [isRoomCreating, setIsRoomCreating] = useState(false);
  const [isRoomJoining, setIsRoomJoining] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // References
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const gameplayTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Deriving repeated text to fit a 5-minute typing test
  const targetText = (() => {
    if (!quote || !quote.text) return '';
    let compound = quote.text;
    // Repeat the quote to ensure it is long enough for 5 minutes of continuous typing.
    // Average 50 WPM * 5 minutes = 250 words = ~1250 characters. We target ~2000 characters.
    while (compound.length < 2000) {
      compound += ' ' + quote.text;
    }
    return compound;
  })();

  const formatTime = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Initialize: Load leaderboard and pick an initial random quote
  useEffect(() => {
    fetchLeaderboard();
    selectRandomQuote();
  }, []);

  // Sync Input focus during countdown or gameplay
  useEffect(() => {
    if (status === 'playing' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [status]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (gameplayTimerRef.current) clearInterval(gameplayTimerRef.current);
    };
  }, []);

  // Check for 5-minute (300 seconds) timeout during gameplay
  useEffect(() => {
    if (status === 'playing' && startTime > 0) {
      const elapsed = (currentTime - startTime) / 1000;
      if (elapsed >= 300) {
        if (activeRoomId) {
          const finalWpm = elapsed > 0.5 ? Math.round((correctCharCount / 5) / (elapsed / 60)) : 0;
          const finalAccuracy = totalKeystrokes > 0 ? Math.round((Math.max(0, totalKeystrokes - errorsCount) / totalKeystrokes) * 100) : 100;
          handleMultiplayerFinish(finalWpm, finalAccuracy, errorsCount);
        } else {
          handleFinish(true);
        }
      }
    }
  }, [currentTime, status, startTime]);

  // Smooth scroll active character into view
  useEffect(() => {
    if (status === 'playing' && canvasRef.current) {
      const activeElement = canvasRef.current.querySelector('.border-cyan-400');
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [inputValue, status]);

  // Real-time Multiplayer listener
  useEffect(() => {
    if (gameMode !== 'multi' || !activeRoomId) return;

    const unsubscribe = onSnapshot(doc(db, 'rooms', activeRoomId), (snapshot) => {
      if (!snapshot.exists()) {
        setActiveRoomId(null);
        setActiveRoomData(null);
        if (status !== 'idle') {
          setStatus('idle');
          setMultiplayerError("Өрөө хаагдсан байна.");
        }
        return;
      }

      const data = snapshot.data();
      setActiveRoomData(data);

      if (data.startTriggered && status === 'idle') {
        setQuote({
          text: data.quoteText,
          source: data.quoteAuthor,
          difficulty: data.quoteDifficulty
        });
        startMultiplayerCountdown();
      }
    }, (error) => {
      console.error("Snapshot room listener error: ", error);
    });

    return () => {
      unsubscribe();
    };
  }, [gameMode, activeRoomId, status]);

  // Sync current player info when details change inside a multiplayer lobby
  useEffect(() => {
    if (gameMode === 'multi' && activeRoomId && activeRoomData) {
      const myCurrentRecord = activeRoomData.players?.[myPlayerId];
      if (myCurrentRecord && (myCurrentRecord.username !== username || myCurrentRecord.vehicle !== vehicle)) {
        updateDoc(doc(db, 'rooms', activeRoomId), {
          [`players.${myPlayerId}.username`]: username.trim() || 'Тоглогч',
          [`players.${myPlayerId}.vehicle`]: vehicle
        }).catch(err => console.error("Error syncing player info: ", err));
      }
    }
  }, [username, vehicle, gameMode, activeRoomId, activeRoomData]);

  // Cancel / Quit race in the middle
  const cancelRace = () => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    if (gameplayTimerRef.current) clearInterval(gameplayTimerRef.current);
    setStatus('idle');
    setInputValue('');
    setErrorsCount(0);
    setTotalKeystrokes(0);
    setIsSubmitted(false);
    playSound('button', soundEnabled);

    if (activeRoomId) {
      updatePlayerProgressInDb(0, 0, 100);
    }
  };

  // Keyboard shortcut to start race when pressing Enter, or cancel with Escape
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const isEditingUsername = document.activeElement?.tagName === 'INPUT' && 
          document.activeElement.getAttribute('placeholder')?.includes('Жишээ');
        if (!isEditingUsername && (status === 'idle' || status === 'finished')) {
          e.preventDefault();
          startRace();
        }
      }
      
      if (e.key === 'Escape' && (status === 'playing' || status === 'countdown')) {
        e.preventDefault();
        cancelRace();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [status, soundEnabled]);

  // Fetch TOP 10 Leaderboard from Firestore
  const fetchLeaderboard = async () => {
    setIsLoadingLeaderboard(true);
    setLeaderboardError(null);
    try {
      const q = query(
        collection(db, 'typeracer_scores'),
        orderBy('wpm', 'desc'),
        limit(10)
      );
      const querySnapshot = await getDocs(q);
      const scoresList: Score[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        scoresList.push({
          id: doc.id,
          name: data.name || 'Тоглогч',
          wpm: data.wpm || 0,
          accuracy: data.accuracy !== undefined ? data.accuracy : 100,
          errors: data.errors !== undefined ? data.errors : 0,
          vehicle: data.vehicle || 'car',
          createdAt: data.createdAt 
            ? (typeof data.createdAt.toDate === 'function' ? data.createdAt.toDate() : new Date(data.createdAt))
            : new Date(),
        });
      });
      setLeaderboard(scoresList);
    } catch (error) {
      console.error("Error fetching leaderboard: ", error);
      setLeaderboardError("Холболтын алдаа гарлаа. Шинэчлэх товчийг дарна уу.");
    } finally {
      setIsLoadingLeaderboard(false);
    }
  };

  // Helper to pick a new quote
  const selectRandomQuote = (diffParam?: 'easy' | 'medium' | 'hard') => {
    const activeDiff = diffParam || difficulty;
    const filteredQuotes = QUOTES.filter(q => q.difficulty === activeDiff);
    const remainingQuotes = filteredQuotes.filter(q => q.text !== quote?.text);
    const sourceList = remainingQuotes.length > 0 ? remainingQuotes : (filteredQuotes.length > 0 ? filteredQuotes : QUOTES);
    const random = sourceList[Math.floor(Math.random() * sourceList.length)];
    setQuote(random);
    setInputValue('');
    setErrorsCount(0);
    setTotalKeystrokes(0);
  };

  // Multiplayer helpers
  const updatePlayerProgressInDb = async (progress: number, wpm: number, accuracy: number) => {
    if (!activeRoomId) return;
    try {
      await updateDoc(doc(db, 'rooms', activeRoomId), {
        [`players.${myPlayerId}.progress`]: progress,
        [`players.${myPlayerId}.wpm`]: wpm,
        [`players.${myPlayerId}.accuracy`]: accuracy
      });
    } catch (err) {
      console.error("Error updating player progress in DB: ", err);
    }
  };

  const createMultiplayerRoom = async () => {
    if (!username.trim()) {
      setMultiplayerError("Уралдааны нэрээ оруулна уу.");
      return;
    }
    setIsRoomCreating(true);
    setMultiplayerError(null);
    try {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      const filteredQuotes = QUOTES.filter(q => q.difficulty === difficulty);
      const selected = filteredQuotes[Math.floor(Math.random() * filteredQuotes.length)] || QUOTES[0];

      const roomRef = doc(db, 'rooms', code);
      await setDoc(roomRef, {
        id: code,
        quoteText: selected.text,
        quoteAuthor: selected.source,
        quoteDifficulty: difficulty,
        hostId: myPlayerId,
        status: 'lobby',
        startTriggered: false,
        createdAt: new Date().toISOString(),
        players: {
          [myPlayerId]: {
            uid: myPlayerId,
            username: username.trim(),
            vehicle: vehicle,
            progress: 0,
            wpm: 0,
            accuracy: 100,
            isHost: true,
            finishedAt: null
          }
        }
      });

      setActiveRoomId(code);
      setQuote(selected);
    } catch (err: any) {
      console.error("Error creating room: ", err);
      setMultiplayerError(`Өрөө үүсгэхэд алдаа гарлаа: ${err?.message || err}`);
    } finally {
      setIsRoomCreating(false);
    }
  };

  const joinMultiplayerRoom = async (codeToJoin: string) => {
    const formattedCode = codeToJoin.trim().toUpperCase();
    if (!username.trim()) {
      setMultiplayerError("Уралдааны нэрээ оруулна уу.");
      return;
    }
    if (formattedCode.length !== 5) {
      setMultiplayerError("Өрөөний код 5 тэмдэгттэй байх ёстой.");
      return;
    }

    setIsRoomJoining(true);
    setMultiplayerError(null);

    try {
      const roomRef = doc(db, 'rooms', formattedCode);
      const snap = await getDoc(roomRef);

      if (!snap.exists()) {
        setMultiplayerError("Оруулсан кодтой өрөө олдсонгүй.");
        setIsRoomJoining(false);
        return;
      }

      const data = snap.data();
      if (data.status !== 'lobby') {
        setMultiplayerError("Энэ өрөөний уралдаан хэдийнээ эхэлсэн байна.");
        setIsRoomJoining(false);
        return;
      }

      const playersCount = Object.keys(data.players || {}).length;
      if (playersCount >= 4) {
        setMultiplayerError("Уучлаарай, энэ өрөө дүүрсэн байна (дээд тал нь 4 тоглогч).");
        setIsRoomJoining(false);
        return;
      }

      await updateDoc(roomRef, {
        [`players.${myPlayerId}`]: {
          uid: myPlayerId,
          username: username.trim(),
          vehicle: vehicle,
          progress: 0,
          wpm: 0,
          accuracy: 100,
          isHost: false,
          finishedAt: null
        }
      });

      setActiveRoomId(formattedCode);
      setQuote({
        text: data.quoteText,
        source: data.quoteAuthor,
        difficulty: data.quoteDifficulty
      });
    } catch (err: any) {
      console.error("Error joining room: ", err);
      setMultiplayerError(`Өрөөнд холбогдоход алдаа гарлаа: ${err?.message || err}`);
    } finally {
      setIsRoomJoining(false);
    }
  };

  const triggerStartRace = async () => {
    if (!activeRoomId) return;
    try {
      await updateDoc(doc(db, 'rooms', activeRoomId), {
        startTriggered: true,
        status: 'playing'
      });
    } catch (err) {
      console.error("Error triggering start race: ", err);
    }
  };

  const leaveMultiplayerRoom = async () => {
    if (!activeRoomId) return;
    try {
      if (activeRoomData) {
        if (activeRoomData.hostId === myPlayerId) {
          await deleteDoc(doc(db, 'rooms', activeRoomId));
        } else {
          const updatedPlayers = { ...activeRoomData.players };
          delete updatedPlayers[myPlayerId];
          await updateDoc(doc(db, 'rooms', activeRoomId), {
            players: updatedPlayers
          });
        }
      }
    } catch (err) {
      console.error("Error leaving room: ", err);
    } finally {
      setActiveRoomId(null);
      setActiveRoomData(null);
      setStatus('idle');
      setInputValue('');
      setErrorsCount(0);
      setTotalKeystrokes(0);
    }
  };

  const startMultiplayerCountdown = () => {
    setInputValue('');
    setErrorsCount(0);
    setTotalKeystrokes(0);
    setIsSubmitted(false);
    setCountdown(3);
    setStatus('countdown');
    playSound('countdown', soundEnabled);

    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    if (gameplayTimerRef.current) clearInterval(gameplayTimerRef.current);

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          launchMultiplayerGameplay();
          playSound('finish', soundEnabled);
          return 0;
        }
        playSound('countdown', soundEnabled);
        return prev - 1;
      });
    }, 1000);
    countdownTimerRef.current = timer;
  };

  const launchMultiplayerGameplay = () => {
    const now = Date.now();
    setStartTime(now);
    setCurrentTime(now);
    setStatus('playing');

    gameplayTimerRef.current = setInterval(() => {
      setCurrentTime(Date.now());
    }, 100);
  };

  const handleMultiplayerFinish = async (finalWpm: number, finalAccuracy: number, finalErrors: number) => {
    if (gameplayTimerRef.current) clearInterval(gameplayTimerRef.current);
    setStatus('finished');
    setIsSubmitting(true);
    setIsSubmitted(false);

    try {
      if (activeRoomId) {
        await updateDoc(doc(db, 'rooms', activeRoomId), {
          [`players.${myPlayerId}.progress`]: 100,
          [`players.${myPlayerId}.wpm`]: finalWpm,
          [`players.${myPlayerId}.accuracy`]: finalAccuracy,
          [`players.${myPlayerId}.finishedAt`]: new Date().toISOString()
        });
      }

      await addDoc(collection(db, 'typeracer_scores'), {
        name: username.trim() || 'Тоглогч',
        wpm: finalWpm,
        accuracy: finalAccuracy,
        errors: finalErrors,
        vehicle: vehicle,
        createdAt: serverTimestamp()
      });

      setIsSubmitted(true);
      await fetchLeaderboard();
    } catch (err) {
      console.error("Error finishing multiplayer race: ", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetMultiplayerRoom = async () => {
    if (!activeRoomId || !activeRoomData) return;
    try {
      const updatedPlayers = { ...activeRoomData.players };
      Object.keys(updatedPlayers).forEach((uid) => {
        updatedPlayers[uid] = {
          ...updatedPlayers[uid],
          progress: 0,
          wpm: 0,
          accuracy: 100,
          finishedAt: null
        };
      });

      const filteredQuotes = QUOTES.filter(q => q.difficulty === difficulty);
      const random = filteredQuotes[Math.floor(Math.random() * filteredQuotes.length)] || QUOTES[0];

      await updateDoc(doc(db, 'rooms', activeRoomId), {
        startTriggered: false,
        status: 'lobby',
        quoteText: random.text,
        quoteAuthor: random.source,
        players: updatedPlayers
      });

      setStatus('idle');
      setInputValue('');
      setErrorsCount(0);
      setTotalKeystrokes(0);
      setIsSubmitted(false);
    } catch (err) {
      console.error("Error resetting multiplayer room: ", err);
    }
  };

  // Start Countdown sequence
  const startRace = () => {
    // Reset race parameters
    setInputValue('');
    setErrorsCount(0);
    setTotalKeystrokes(0);
    setIsSubmitted(false);
    setCountdown(3);
    setStatus('countdown');
    playSound('countdown', soundEnabled);

    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    if (gameplayTimerRef.current) clearInterval(gameplayTimerRef.current);

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          launchGameplay();
          playSound('finish', soundEnabled);
          return 0;
        }
        playSound('countdown', soundEnabled);
        return prev - 1;
      });
    }, 1000);
    countdownTimerRef.current = timer;
  };

  // Start Game Engine
  const launchGameplay = () => {
    const now = Date.now();
    setStartTime(now);
    setCurrentTime(now);
    setStatus('playing');

    gameplayTimerRef.current = setInterval(() => {
      setCurrentTime(Date.now());
    }, 100);
  };

  // Finish game logic and auto-submit score
  const handleFinish = async (isTimeout = false) => {
    if (gameplayTimerRef.current) clearInterval(gameplayTimerRef.current);
    setStatus('finished');
    setIsSubmitting(true);
    setIsSubmitted(false);

    try {
      const finalSec = Math.min(300, (Date.now() - startTime) / 1000);
      const typedChars = isTimeout ? correctCharCount : targetText.length;
      const finalWpm = finalSec > 0.5 
        ? Math.round((typedChars / 5) / (finalSec / 60)) 
        : 0;
      const finalAccuracy = totalKeystrokes > 0
        ? Math.round((Math.max(0, totalKeystrokes - errorsCount) / totalKeystrokes) * 100)
        : 100;

      // Update local history
      setHistory((prev) => {
        const next = [finalWpm, ...prev].slice(0, 5);
        localStorage.setItem('typeracer_history', JSON.stringify(next));
        return next;
      });

      await addDoc(collection(db, 'typeracer_scores'), {
        name: username.trim() || 'Тоглогч',
        wpm: finalWpm,
        accuracy: finalAccuracy,
        errors: errorsCount,
        vehicle: vehicle,
        createdAt: serverTimestamp()
      });

      setIsSubmitted(true);
      await fetchLeaderboard();
    } catch (err) {
      console.error("Error auto-submitting score: ", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Match Prefix logic
  let firstErrorIndex = -1;
  for (let i = 0; i < inputValue.length; i++) {
    if (inputValue[i] !== targetText[i]) {
      firstErrorIndex = i;
      break;
    }
  }

  const hasActiveError = firstErrorIndex !== -1;

  // Track Correct Characters typed
  const getCorrectCharCount = () => {
    if (firstErrorIndex !== -1) {
      return firstErrorIndex;
    }
    return inputValue.length;
  };

  const correctCharCount = getCorrectCharCount();
  const progressPercent = Math.min(100, Math.round((correctCharCount / targetText.length) * 100));

  // WPM and Accuracy Calculation
  const getElapsedTime = () => {
    if (status === 'playing') {
      return (currentTime - startTime) / 1000;
    }
    if (status === 'finished' && startTime > 0) {
      return (currentTime - startTime) / 1000;
    }
    return 0;
  };

  const elapsedSeconds = getElapsedTime();
  const liveWpm = elapsedSeconds > 0.5 
    ? Math.round((correctCharCount / 5) / (elapsedSeconds / 60)) 
    : 0;

  // Accuracy calculation
  const liveAccuracy = totalKeystrokes > 0
    ? Math.round((Math.max(0, totalKeystrokes - errorsCount) / totalKeystrokes) * 100)
    : 100;

  // Handle typing input
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (status !== 'playing') return;

    if (value.length > targetText.length) return;

    let updatedErrors = errorsCount;
    let updatedKeystrokes = totalKeystrokes;

    if (value.length > inputValue.length) {
      updatedKeystrokes += 1;
      setTotalKeystrokes(updatedKeystrokes);
      
      const newlyTypedIndex = value.length - 1;
      const newlyTypedChar = value[newlyTypedIndex];
      const targetChar = targetText[newlyTypedIndex];

      if (newlyTypedChar !== targetChar) {
        updatedErrors += 1;
        setErrorsCount(updatedErrors);
        playSound('error', soundEnabled);
      } else {
        playSound('keypress', soundEnabled);
      }
    }

    setInputValue(value);

    // Compute live values for sync
    if (activeRoomId) {
      let localFirstErrIdx = -1;
      for (let i = 0; i < value.length; i++) {
        if (value[i] !== targetText[i]) {
          localFirstErrIdx = i;
          break;
        }
      }
      const localCorrectCharCount = localFirstErrIdx !== -1 ? localFirstErrIdx : value.length;
      const localProgressPercent = Math.min(100, Math.round((localCorrectCharCount / targetText.length) * 100));
      const localElapsed = (Date.now() - startTime) / 1000;
      const localWpm = localElapsed > 0.5 ? Math.round((localCorrectCharCount / 5) / (localElapsed / 60)) : 0;
      const localAccuracy = updatedKeystrokes > 0 ? Math.round((Math.max(0, updatedKeystrokes - updatedErrors) / updatedKeystrokes) * 100) : 100;

      // Update DB on every 3 characters, or when finished
      if (value.length % 3 === 0 || value === targetText) {
        updatePlayerProgressInDb(localProgressPercent, localWpm, localAccuracy);
      }
    }

    // Check if finished
    if (value === targetText) {
      if (activeRoomId) {
        const localElapsed = (Date.now() - startTime) / 1000;
        const finalWpm = localElapsed > 0.5 ? Math.round((targetText.length / 5) / (localElapsed / 60)) : 0;
        const finalAccuracy = updatedKeystrokes > 0 ? Math.round((Math.max(0, updatedKeystrokes - updatedErrors) / updatedKeystrokes) * 100) : 100;
        handleMultiplayerFinish(finalWpm, finalAccuracy, updatedErrors);
      } else {
        handleFinish();
      }
    }
  };

  // Skip / Change quote
  const handleSkipQuote = () => {
    if (status === 'idle') {
      selectRandomQuote();
    }
  };

  // Vehicle styling helper
  const getVehicleConfig = () => {
    switch(vehicle) {
      case 'rocket':
        return {
          emoji: '🚀',
          label: 'Сансрын Пуужин',
          bgClass: 'bg-slate-950 border-indigo-500/30 relative overflow-hidden',
          laneClass: 'bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-950 via-slate-950 to-slate-950 border-y border-indigo-900/40 relative h-28 flex items-center',
          trailEffect: 'bg-gradient-to-r from-transparent via-cyan-500/40 to-indigo-500 h-1.5 rounded-full absolute right-full top-1/2 -translate-y-1/2 w-24 blur-xs'
        };
      case 'horse':
        return {
          emoji: '🐎',
          label: 'Хурдан Морь',
          bgClass: 'bg-slate-900 border-emerald-500/30 relative overflow-hidden',
          laneClass: 'bg-gradient-to-r from-emerald-950/20 via-amber-950/10 to-emerald-950/20 border-y border-emerald-800/20 relative h-28 flex items-center',
          trailEffect: 'bg-gradient-to-r from-transparent to-amber-700/30 h-3 rounded-full absolute right-full top-1/2 -translate-y-1/2 w-16 blur-md'
        };
      case 'plane':
        return {
          emoji: '✈️',
          label: 'Нисэх Онгоц',
          bgClass: 'bg-slate-950 border-blue-500/30 relative overflow-hidden',
          laneClass: 'bg-gradient-to-r from-blue-950/40 via-sky-950/20 to-blue-950/40 border-y border-blue-800/30 relative h-28 flex items-center',
          trailEffect: 'bg-gradient-to-r from-transparent via-sky-400/30 to-blue-500 h-1 rounded-full absolute right-full top-1/2 -translate-y-1/2 w-28 blur-xs'
        };
      case 'ufo':
        return {
          emoji: '🛸',
          label: 'Нисдэг Таваг',
          bgClass: 'bg-purple-950/40 border-fuchsia-500/30 relative overflow-hidden',
          laneClass: 'bg-gradient-to-r from-purple-950/30 via-slate-950 to-fuchsia-950/20 border-y border-purple-800/30 relative h-28 flex items-center',
          trailEffect: 'bg-gradient-to-r from-transparent via-fuchsia-500/40 to-purple-500 h-2 rounded-full absolute right-full top-1/2 -translate-y-1/2 w-20 blur-sm'
        };
      case 'dragon':
        return {
          emoji: '🐉',
          label: 'Галт Луу',
          bgClass: 'bg-red-950/40 border-orange-500/30 relative overflow-hidden',
          laneClass: 'bg-gradient-to-r from-red-950/40 via-amber-950/20 to-orange-950/30 border-y border-red-800/30 relative h-28 flex items-center',
          trailEffect: 'bg-gradient-to-r from-transparent via-red-500/50 to-orange-600 h-2.5 rounded-full absolute right-full top-1/2 -translate-y-1/2 w-24'
        };
      case 'bicycle':
        return {
          emoji: '🚲',
          label: 'Унадаг Дугуй',
          bgClass: 'bg-teal-950/40 border-teal-500/30 relative overflow-hidden',
          laneClass: 'bg-gradient-to-r from-teal-950/20 via-slate-950 to-teal-950/20 border-y border-teal-800/20 relative h-28 flex items-center',
          trailEffect: 'bg-gradient-to-r from-transparent to-teal-500/20 h-1 rounded-full absolute right-full top-1/2 -translate-y-1/2 w-12 blur-md'
        };
      case 'cheetah':
        return {
          emoji: '🐆',
          label: 'Хурдан Ирвэс',
          bgClass: 'bg-yellow-950/40 border-amber-500/30 relative overflow-hidden',
          laneClass: 'bg-gradient-to-r from-yellow-950/30 via-amber-950/15 to-yellow-950/30 border-y border-amber-800/20 relative h-28 flex items-center',
          trailEffect: 'bg-gradient-to-r from-transparent to-amber-500/30 h-1.5 rounded-full absolute right-full top-1/2 -translate-y-1/2 w-18'
        };
      default:
        return {
          emoji: '🚗',
          label: 'Уралдааны Тэрэг',
          bgClass: 'bg-slate-900 border-rose-500/30 relative overflow-hidden',
          laneClass: 'bg-slate-950 border-y border-slate-800 relative h-28 flex items-center',
          trailEffect: 'bg-gradient-to-r from-transparent via-orange-500/30 to-rose-600 h-2 rounded-full absolute right-full top-1/2 -translate-y-1/2 w-20'
        };
    }
  };

  const vConfig = getVehicleConfig();

  return (
    <div className="min-h-screen bg-[#030408] text-white flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200 relative overflow-x-hidden" id="app-container">
      {/* Background Glows */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-cyan-950/20 rounded-full blur-[150px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-950/20 rounded-full blur-[150px]"></div>
        <div className="absolute top-[30%] left-[40%] w-[30%] h-[30%] bg-indigo-950/15 rounded-full blur-[130px]"></div>
      </div>

      {/* Header Section */}
      <header className="relative z-10 flex flex-col md:flex-row items-center justify-between px-6 md:px-12 py-5 border-b border-white/5 bg-black/45 backdrop-blur-md shadow-[0_4px_30px_rgba(0,0,0,0.5)]" id="app-header">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-tr from-cyan-500/20 to-blue-500/10 border border-cyan-500/30 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.25)] relative group overflow-hidden">
            <span className="text-2xl z-10">{vConfig.emoji}</span>
            <span className="absolute inset-0 bg-cyan-400/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight uppercase italic text-white leading-none font-display">
              УРАЛДААНТ <span className="text-cyan-400 glow-text-cyan">БИЧЭЭЧ</span>
            </h1>
            <p className="text-[10px] text-white/35 tracking-[0.25em] uppercase font-bold mt-1.5 font-mono">蒙古 TYPING SPEEDWAY &bull; CHRONO V2</p>
          </div>
        </div>
        
        {/* Navigation & Live Metrics */}
        <div className="flex flex-col xl:flex-row items-center gap-4 xl:gap-8 mt-4 md:mt-0">
          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1.5 bg-black/40 p-1.5 rounded-xl border border-white/5 shadow-inner">
            <button
              onClick={() => {
                if (activeRoomId) {
                  leaveMultiplayerRoom();
                }
                setGameMode('single');
                setStatus('idle');
                selectRandomQuote();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 ${
                gameMode === 'single'
                  ? 'text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 shadow-sm'
                  : 'text-white/50 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <span>👤 Ганцаараа</span>
            </button>
            <button
              onClick={() => {
                setGameMode('multi');
                setStatus('idle');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1 ${
                gameMode === 'multi'
                  ? 'text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 shadow-sm'
                  : 'text-white/50 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <span>👥 Олон Тоглогч</span>
            </button>
            <a 
              href="https://typeracer-chi.vercel.app/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider text-white/50 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/5 transition-all duration-150 cursor-pointer group"
            >
              <span>⌨️ Typeracer</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse group-hover:bg-cyan-400 transition-colors" />
            </a>
          </nav>

          {/* Dynamic Live Metrics */}
          <div className="flex gap-8 md:gap-14 bg-black/30 px-6 py-2.5 rounded-2xl border border-white/5 shadow-inner">
            <div className="text-center">
              <p className="text-[9px] text-white/40 uppercase font-black tracking-widest font-mono">WPM (ХУРД)</p>
              <p className="text-2xl md:text-3xl font-black text-cyan-400 font-mono glow-text-cyan transition-all duration-300">{liveWpm}</p>
            </div>
            <div className="text-center border-x border-white/5 px-8">
              <p className="text-[9px] text-white/40 uppercase font-black tracking-widest font-mono">НАРИЙВЧЛАЛ</p>
              <p className="text-2xl md:text-3xl font-black text-emerald-400 font-mono glow-text-emerald transition-all duration-300">{liveAccuracy}%</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] text-white/40 uppercase font-black tracking-widest font-mono">ХУГАЦАА</p>
              <p className="text-2xl md:text-3xl font-black text-white/90 font-mono transition-all duration-300">{elapsedSeconds.toFixed(1)}<span className="text-xs text-white/30 font-sans ml-0.5">с</span></p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-12 p-6 md:p-8 gap-8 max-w-7xl w-full mx-auto" id="app-main">
        
        {/* Game View (Left) */}
        <div className="lg:col-span-8 flex flex-col gap-6" id="game-view">
          
          {!isRegistered ? (
            /* Registration Welcome Card */
            <div className="flex-1 flex flex-col justify-center bg-white/5 border border-white/10 rounded-3xl p-8 md:p-12 relative overflow-hidden" id="registration-panel">
              <div className="absolute top-0 left-0 w-full h-full opacity-5 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:20px_20px]" />
              
              <div className="max-w-md mx-auto w-full space-y-6">
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 mx-auto bg-gradient-to-tr from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.4)] text-3xl">
                    ⚡
                  </div>
                  <h2 className="text-2xl font-black uppercase tracking-tight text-white pt-2">
                    Уралдаанд Бүртгүүлэх
                  </h2>
                  <p className="text-sm text-white/50">
                    Уралдааны талбарт нэвтрэхийн тулд өөрийн нэр болон хөлгөө сонгоно уу. Таны амжилт Хүндэт самбарт хадгалагдана.
                  </p>
                </div>

                <div className="space-y-4 pt-4 text-left">
                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-white/50 mb-2">
                      Уралдаанчийн нэр:
                    </label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <input
                        type="text"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && username.trim()) {
                            e.preventDefault();
                            localStorage.setItem('typeracer_username', username.trim());
                            setIsRegistered(true);
                            selectRandomQuote();
                            setTimeout(() => {
                              startRace();
                            }, 100);
                          }
                        }}
                        placeholder="Жишээ: Амараа, Сүхээ..."
                        maxLength={16}
                        className="w-full bg-black/60 border-2 border-white/10 focus:border-cyan-400 rounded-xl py-3.5 pl-12 pr-4 text-sm text-white focus:outline-none transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-white/50 mb-2">
                      Уралдааны Хөлөг сонгох:
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {VEHICLES_LIST.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            setVehicle(v.id);
                            playSound('button', soundEnabled);
                          }}
                          className={`flex flex-col items-center justify-center gap-1 py-2.5 px-1 rounded-xl border text-[11px] font-bold transition-all cursor-pointer ${
                            vehicle === v.id
                              ? 'bg-cyan-500/15 border-cyan-500 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                              : 'bg-black/40 border-white/5 text-white/50 hover:text-white/80 hover:bg-white/5'
                          }`}
                        >
                          <span className="text-xl">{v.emoji}</span>
                          <span className="truncate max-w-[65px]">{v.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (username.trim()) {
                        localStorage.setItem('typeracer_username', username.trim());
                        setIsRegistered(true);
                        selectRandomQuote();
                        setTimeout(() => {
                          startRace();
                        }, 100);
                      }
                    }}
                    disabled={!username.trim()}
                    className="w-full mt-2 flex items-center justify-center gap-2 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 rounded-xl text-xs font-black uppercase tracking-[0.2em] transition-all text-black shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    🏁 ГАРААНД ГАРАХ
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Active Game Interface */
            <>
              {gameMode === 'multi' && !activeRoomId ? (
                /* Multiplayer Room Creation & Joining Setup Lobby */
                <div className="flex-1 flex flex-col justify-center bg-white/5 border border-white/10 rounded-3xl p-8 md:p-12 relative overflow-hidden" id="multiplayer-lobby-panel">
                  <div className="absolute top-0 left-0 w-full h-full opacity-5 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:20px_20px]" />
                  
                  <div className="max-w-md mx-auto w-full space-y-8">
                    <div className="text-center space-y-2">
                      <div className="w-16 h-16 mx-auto bg-gradient-to-tr from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(124,58,237,0.4)] text-3xl">
                        👥
                      </div>
                      <h2 className="text-2xl font-black uppercase tracking-tight text-white pt-2">
                        Олон Тоглогчийн Танхим
                      </h2>
                      <p className="text-sm text-white/50">
                        Шинэ уралдааны өрөө үүсгэж найзаа урих, эсвэл найзынхаа өрөөний кодоор нэгдэж бодит цагт уралдана уу.
                      </p>
                    </div>

                    {multiplayerError && (
                      <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs px-4 py-3 rounded-xl flex items-center gap-2 font-semibold">
                        ⚠️ {multiplayerError}
                      </div>
                    )}

                    <div className="space-y-6">
                      {/* Action 1: Create a room */}
                      <div className="p-5 bg-black/40 rounded-2xl border border-white/5 text-center space-y-3">
                        <p className="text-xs font-bold text-white/60 uppercase tracking-wider">Шинэ уралдаан эхлүүлэх</p>
                        <button
                          type="button"
                          onClick={createMultiplayerRoom}
                          disabled={isRoomCreating}
                          className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 rounded-xl text-xs font-black uppercase tracking-[0.1em] transition-all text-white shadow-[0_0_15px_rgba(124,58,237,0.3)] disabled:opacity-40 cursor-pointer"
                        >
                          {isRoomCreating ? (
                            <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></span>
                          ) : (
                            "🎮 ӨРӨӨ ҮҮСГЭХ"
                          )}
                        </button>
                      </div>

                      <div className="relative flex py-2 items-center">
                        <div className="flex-grow border-t border-white/10"></div>
                        <span className="flex-shrink mx-4 text-white/30 text-[10px] uppercase font-black font-mono tracking-widest">Эсвэл</span>
                        <div className="flex-grow border-t border-white/10"></div>
                      </div>

                      {/* Action 2: Join a room */}
                      <div className="p-5 bg-black/40 rounded-2xl border border-white/5 space-y-4">
                        <div className="space-y-2">
                          <label className="block text-xs font-bold text-center text-white/60 uppercase tracking-wider">
                            Урилгын Кодоор Нэгдэх
                          </label>
                          <input
                            type="text"
                            value={joinCodeInput}
                            onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                            placeholder="Код оруулна уу (Жишээ нь: ABCD2)"
                            maxLength={5}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && joinCodeInput.trim() && !isRoomJoining) {
                                e.preventDefault();
                                joinMultiplayerRoom(joinCodeInput);
                              }
                            }}
                            className="w-full bg-black/60 border-2 border-white/10 focus:border-purple-400 rounded-xl py-3 px-4 text-center text-base font-black tracking-widest font-mono text-white focus:outline-none transition-all"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => joinMultiplayerRoom(joinCodeInput)}
                          disabled={isRoomJoining || joinCodeInput.trim().length !== 5}
                          className="w-full flex items-center justify-center gap-2 py-3.5 bg-white/10 hover:bg-white/15 border border-white/10 hover:border-purple-500/40 rounded-xl text-xs font-black uppercase tracking-[0.1em] transition-all text-purple-400 disabled:opacity-40 cursor-pointer"
                        >
                          {isRoomJoining ? (
                            <span className="animate-spin rounded-full h-4 w-4 border-2 border-purple-400 border-t-transparent"></span>
                          ) : (
                            "⚡ ӨРӨӨНД ЭЛСЭХ"
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : gameMode === 'multi' && activeRoomId && activeRoomData && activeRoomData.status === 'lobby' ? (
                /* Multiplayer Lobby Screen with Room Details and waiting on players */
                <div className="flex-1 flex flex-col justify-center bg-gradient-to-b from-[#0a0d18] to-[#04060c] border border-cyan-500/20 rounded-3xl p-6 sm:p-10 relative overflow-hidden shadow-[0_0_30px_rgba(6,182,212,0.08)]" id="multiplayer-lobby-wait">
                  <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
                  
                  <div className="max-w-xl mx-auto w-full space-y-6">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-white/5 pb-4">
                      <div>
                        <h2 className="text-xl font-black uppercase tracking-tight text-white flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping shrink-0" />
                          Уралдааны Өрөө
                        </h2>
                        <p className="text-xs text-white/50 mt-1">Олон тоглогч холбогдохыг хүлээж байна.</p>
                      </div>
                      
                      {/* Room Code Display */}
                      <div className="flex items-center gap-2 bg-black/60 border border-white/10 rounded-2xl px-4 py-2.5">
                        <div className="text-left">
                          <p className="text-[8px] text-white/40 font-black uppercase tracking-widest font-mono">Өрөөний Код</p>
                          <p className="text-lg font-black font-mono tracking-widest text-cyan-400">{activeRoomId}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(activeRoomId);
                            setCopiedCode(true);
                            setTimeout(() => setCopiedCode(false), 2000);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                            copiedCode 
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                              : 'bg-white/5 text-white/60 border border-white/10 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          {copiedCode ? "Хууллаа!" : "Хуулах"}
                        </button>
                      </div>
                    </div>

                    {/* Players List */}
                    <div className="space-y-3">
                      <h3 className="text-xs font-black uppercase tracking-wider text-white/40">Холбогдсон Тоглогчид ({Object.keys(activeRoomData.players || {}).length}/4)</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {Object.values(activeRoomData.players || {}).map((p: any) => {
                          const isMe = p.uid === myPlayerId;
                          const pConfig = VEHICLES_LIST.find(v => v.id === p.vehicle) || VEHICLES_LIST[0];
                          return (
                            <div 
                              key={p.uid} 
                              className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                                isMe 
                                  ? 'bg-cyan-500/5 border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                                  : 'bg-black/40 border-white/5'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-2xl filter drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">{pConfig.emoji}</span>
                                <div>
                                  <p className="text-sm font-black text-white/95">
                                    {p.username}
                                    {isMe && <span className="text-[8px] border border-cyan-400/30 text-cyan-400 font-mono px-1 py-0.2 rounded ml-1.5 font-bold uppercase">БИ</span>}
                                  </p>
                                  <p className="text-[10px] text-white/40 font-mono mt-0.5">{pConfig.label}</p>
                                </div>
                              </div>
                              {p.isHost ? (
                                <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider font-mono">Эзэн</span>
                              ) : (
                                <span className="bg-white/5 text-white/40 border border-white/5 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider font-mono">Урилга</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Start actions */}
                    <div className="flex flex-col gap-3 pt-4 border-t border-white/5">
                      {activeRoomData.hostId === myPlayerId ? (
                        <button
                          type="button"
                          onClick={triggerStartRace}
                          className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-black uppercase tracking-[0.2em] rounded-xl text-xs transition-all shadow-[0_0_20px_rgba(6,182,212,0.35)] cursor-pointer"
                        >
                          🏁 УРАЛДААНЫГ ЭХЛҮҮЛЭХ
                        </button>
                      ) : (
                        <div className="bg-white/5 border border-white/5 p-4 rounded-xl text-center">
                          <p className="text-xs text-cyan-400 uppercase font-black tracking-widest animate-pulse flex items-center justify-center gap-2">
                            <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                            Эзэн уралдааныг эхлүүлэхийг хүлээж байна...
                          </p>
                        </div>
                      )}
                      
                      <button
                        type="button"
                        onClick={leaveMultiplayerRoom}
                        className="w-full py-3 bg-rose-500/10 hover:bg-rose-500/15 border border-rose-500/20 text-rose-400 hover:text-rose-300 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer"
                      >
                        ❌ ӨРӨӨНӨӨС ГАРАХ
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Standard Game View */
                <>
                  {/* Runner & User Dashboard */}
                  <div className="bg-black/30 border border-white/5 rounded-2xl p-5 relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6" id="runner-selection">
                <div className="flex-1">
                  <h2 className="text-sm font-black uppercase tracking-wider text-white/80 flex flex-wrap items-center gap-2">
                    <span>Уралдаанч: <span className="text-cyan-400 font-extrabold">{username}</span></span>
                    <button 
                      onClick={() => setIsRegistered(false)} 
                      className="text-[10px] text-white/40 hover:text-cyan-400 transition border border-white/10 px-2 py-0.5 rounded uppercase font-bold cursor-pointer"
                    >
                      Засах
                    </button>
                    <button 
                      onClick={() => {
                        setSoundEnabled(!soundEnabled);
                        playSound('button', !soundEnabled);
                      }} 
                      className={`text-[10px] transition border px-2 py-0.5 rounded uppercase font-bold cursor-pointer ${
                        soundEnabled 
                          ? 'border-cyan-500/30 text-cyan-400 bg-cyan-500/5 hover:bg-cyan-500/10' 
                          : 'border-white/10 text-white/40 hover:text-white/60'
                      }`}
                    >
                      {soundEnabled ? '🔊 ДУУ ОН' : '🔇 ДУУ ОФФ'}
                    </button>
                  </h2>
                  <p className="text-xs text-white/40 mt-1">Уралдах хөлөг болон уралдааны хүнд хөнгөний горимыг өөрчлөх боломжтой</p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
                  {/* Difficulty Selector */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase font-black tracking-widest text-white/35">УРАЛДААНЫ ГОРИМ:</span>
                    <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/5">
                      {[
                        { id: 'easy', label: 'Хялбар', color: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5' },
                        { id: 'medium', label: 'Хэвийн', color: 'border-cyan-500/30 text-cyan-400 bg-cyan-500/5' },
                        { id: 'hard', label: 'Хэцүү', color: 'border-rose-500/30 text-rose-400 bg-rose-500/5' }
                      ].map((d) => (
                        <button
                          key={d.id}
                          disabled={status === 'playing' || status === 'countdown'}
                          onClick={() => {
                            setDifficulty(d.id as any);
                            playSound('button', soundEnabled);
                            selectRandomQuote(d.id as any);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all duration-150 cursor-pointer ${
                            difficulty === d.id
                              ? `${d.color} font-black shadow-inner`
                              : 'text-white/40 hover:text-white/70 border border-transparent hover:bg-white/5'
                          } disabled:opacity-35`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Vehicle Selector */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase font-black tracking-widest text-white/35">УРАЛДАХ ХӨЛӨГ:</span>
                    <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/5">
                      {VEHICLES_LIST.map((v) => (
                        <button 
                          key={v.id}
                          id={`select_${v.id}`}
                          disabled={status === 'playing' || status === 'countdown'}
                          onClick={() => {
                            setVehicle(v.id);
                            playSound('button', soundEnabled);
                          }}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
                            vehicle === v.id 
                              ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.1)] font-extrabold' 
                              : 'text-white/40 hover:text-white/70 border border-transparent hover:bg-white/5'
                          } disabled:opacity-35`}
                        >
                          <span>{v.emoji}</span>
                          <span className="hidden sm:inline">{v.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Race Speedway Track */}
              <div className="bg-gradient-to-b from-[#0a0d18] to-[#04060c] border border-cyan-500/20 rounded-2xl p-6 relative overflow-hidden shadow-[0_0_30px_rgba(6,182,212,0.08)]" id="race-track">
                {/* Cybernetic Tech lines */}
                <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:14px_24px]" />
                <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
                <div className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-purple-500/40 to-transparent" />
                
                {activeRoomId ? (
                  /* Multiplayer Speedway Lanes */
                  <div className="relative flex flex-col gap-6">
                    <div className="flex justify-between text-[10px] uppercase font-black tracking-[0.25em] text-white/40 px-1 font-mono">
                      <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" /> ОЛОН ТОГЛОГЧИЙН УРАЛДААН</span>
                      <span className="flex items-center gap-1.5">БАРИА (FINISH) 🏁</span>
                    </div>

                    <div className="flex flex-col gap-4">
                      {Object.values(activeRoomData?.players || {}).map((p: any) => {
                        const isMe = p.uid === myPlayerId;
                        const pConfig = VEHICLES_LIST.find(v => v.id === p.vehicle) || VEHICLES_LIST[0];
                        return (
                          <div key={p.uid} className="space-y-1">
                            <div className="flex justify-between text-[10px] font-bold text-white/50 px-2 uppercase tracking-wide">
                              <span className="flex items-center gap-1.5">
                                <span className={`w-2 h-2 rounded-full ${isMe ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' : 'bg-purple-400'} animate-pulse`} />
                                <span className={isMe ? 'text-cyan-400 font-extrabold' : 'text-white/70'}>{p.username}</span>
                                {isMe && <span className="text-[8px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-1 rounded font-mono ml-1 font-bold">БИ</span>}
                              </span>
                              <span className="font-mono text-white/40">{p.progress}% completed &bull; {p.wpm} WPM</span>
                            </div>
                            
                            <div className="h-14 w-full bg-black/75 rounded-xl border border-white/5 relative overflow-hidden flex items-center shadow-inner">
                              <div className="absolute right-0 top-0 bottom-0 w-12 bg-white/5 border-l border-white/10 flex items-center justify-center opacity-30 z-10 pointer-events-none">
                                <div className="grid grid-cols-2 gap-0.5 w-4 h-full p-0.5 bg-black/30">
                                  {Array.from({ length: 12 }).map((_, i) => (
                                    <div key={i} className={`w-1.5 h-1.5 ${i % 2 === 0 ? 'bg-white' : 'bg-black'}`} />
                                  ))}
                                </div>
                              </div>

                              <div className="absolute left-4 right-16 inset-y-0 flex items-center">
                                <motion.div 
                                  className="absolute flex items-center"
                                  animate={{ left: `${p.progress}%` }}
                                  transition={{ type: 'spring', stiffness: 95, damping: 18 }}
                                >
                                  {p.progress > 2 && (
                                    <div className="absolute right-full mr-1 h-3 w-16 bg-gradient-to-l from-cyan-500/25 to-transparent blur-[2px] rounded-full opacity-60" />
                                  )}
                                  <motion.div 
                                    className="text-3xl filter drop-shadow-[0_0_8px_rgba(255,255,255,0.45)] cursor-default select-none relative"
                                    animate={status === 'playing' ? {
                                      y: [0, -1.5, 1.5, 0],
                                      rotate: [0, -1, 1, 0]
                                    } : {}}
                                    transition={{ repeat: Infinity, duration: 0.2 }}
                                  >
                                    {pConfig.emoji}
                                  </motion.div>
                                </motion.div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* Standard Single-player Speedway */
                  <div className="relative flex flex-col gap-4">
                    <div className="flex justify-between text-[10px] uppercase font-black tracking-[0.25em] text-white/40 px-3 font-mono">
                      <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" /> ГАРАА (START)</span>
                      <span className="text-cyan-400 font-extrabold">{progressPercent}% ДУУССАН</span>
                      <span className="flex items-center gap-1.5">БАРИА (FINISH) 🏁</span>
                    </div>
                    
                    <div className="h-20 w-full bg-black/70 rounded-2xl border-2 border-white/5 relative overflow-hidden flex items-center shadow-[inset_0_4px_20px_rgba(0,0,0,0.9)]">
                      {/* Speedway asphalt yellow dashed central lane line */}
                      <div className="absolute top-1/2 left-0 w-full h-[2px] bg-gradient-to-r from-yellow-500/5 via-yellow-500/40 to-yellow-500/5 border-dashed bg-[size:16px_100%]" style={{ backgroundImage: 'linear-gradient(90deg, #eab308 50%, transparent 50%)' }} />
                      
                      {/* Glowing neon top and bottom track bounds */}
                      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cyan-500/20 via-cyan-500/60 to-cyan-500/20 shadow-[0_1px_8px_rgba(6,182,212,0.8)]" />
                      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-purple-500/20 via-purple-500/60 to-purple-500/20 shadow-[0_-1px_8px_rgba(168,85,247,0.8)]" />

                      {/* Checkered Finish block */}
                      <div className="absolute right-0 top-0 bottom-0 w-16 bg-white/5 border-l border-white/15 flex items-center justify-center opacity-40 z-10 pointer-events-none">
                        <div className="grid grid-cols-2 gap-0.5 w-6 h-full p-1 bg-black/40">
                          {Array.from({ length: 18 }).map((_, i) => (
                            <div key={i} className={`w-2.5 h-2 ${i % 2 === 0 ? 'bg-white' : 'bg-black'}`} />
                          ))}
                        </div>
                      </div>
   
                      {/* Progress Runner */}
                      <div className="absolute left-6 right-20 inset-y-0 flex items-center">
                        <motion.div 
                          className="absolute flex items-center"
                          animate={{ left: `${progressPercent}%` }}
                          transition={{ type: 'spring', stiffness: 90, damping: 16 }}
                        >
                          {progressPercent > 2 && (
                            <div className={`${vConfig.trailEffect} opacity-90`} />
                          )}
   
                          <motion.div 
                            className="text-4.5xl filter drop-shadow-[0_0_15px_rgba(255,255,255,0.55)] cursor-default select-none relative"
                            animate={status === 'playing' ? {
                              y: [0, -3, 3, 0],
                              rotate: [0, -2, 2, 0]
                            } : {}}
                            transition={{ repeat: Infinity, duration: 0.18 }}
                          >
                            {vConfig.emoji}
                            
                            {/* Under-vehicle neon exhaust glow */}
                            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-2.5 bg-cyan-500/20 blur-md rounded-full animate-pulse" />
                          </motion.div>
   
                          {status === 'playing' && (
                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-cyan-500 text-black text-[9px] font-black font-mono px-2 py-0.5 rounded shadow-xl whitespace-nowrap border border-white/30 animate-bounce">
                              {liveWpm} WPM
                            </div>
                          )}
                        </motion.div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Typing Sandbox Area */}
              <div className="flex-1 flex flex-col gap-6 bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-10 relative overflow-hidden" id="typing-area">
                
                {/* Visual Countdown Overlay */}
                <AnimatePresence>
                  {status === 'countdown' && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/93 backdrop-blur-md flex flex-col items-center justify-center z-20 rounded-3xl"
                    >
                      <motion.div
                        key={countdown}
                        initial={{ scale: 0.3, opacity: 0 }}
                        animate={{ scale: [0.3, 1.3, 1], opacity: 1 }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                        className="text-8xl font-black text-cyan-400 font-mono drop-shadow-[0_0_40px_rgba(6,182,212,0.6)]"
                      >
                        {countdown}
                      </motion.div>
                      <motion.p
                        initial={{ y: 15, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="text-sm font-black uppercase tracking-[0.25em] text-white/50 mt-6 animate-pulse"
                      >
                        Уралдаан эхлэхэд бэлтгэж байна...
                      </motion.p>
                      
                      <motion.button
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        onClick={cancelRace}
                        className="mt-8 px-5 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 hover:border-rose-500/50 rounded-xl text-xs font-bold uppercase tracking-wider text-rose-400 transition-all cursor-pointer flex items-center gap-2 shadow-lg"
                      >
                        <span>❌ Цуцлах [Esc]</span>
                      </motion.button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-white/30 border-b border-white/5 pb-4 gap-3">
                  <span className="font-bold uppercase tracking-widest flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    БИЧИХ ТЭКСТ (5 МИНУТЫН СОРИЛ)
                  </span>
                  <div className="flex flex-wrap items-center gap-4">
                    {status === 'playing' && (
                      <span className="bg-rose-500/15 text-rose-400 border border-rose-500/25 px-2.5 py-1 rounded-lg font-mono font-black animate-pulse flex items-center gap-1.5 shadow-[0_0_12px_rgba(244,63,94,0.15)]">
                        ⏱️ ҮЛДСЭН ХУГАЦАА: {formatTime(300 - elapsedSeconds)}
                      </span>
                    )}
                    <span>Урт: <strong className="text-white/60 font-mono">{targetText.length}</strong> тэмдэгт</span>
                    <span className="capitalize">Хүндрэл: <strong className={
                      quote.difficulty === 'easy' ? 'text-emerald-400' : quote.difficulty === 'medium' ? 'text-amber-400' : 'text-rose-400'
                    }>
                      {quote.difficulty === 'easy' ? 'Хялбар' : quote.difficulty === 'medium' ? 'Дундаж' : 'Хүнд'}
                    </strong></span>
                  </div>
                </div>

                {/* Quote details with active caret and error highlighting */}
                <div 
                  ref={canvasRef}
                  className="text-xl md:text-2xl leading-relaxed font-sans font-medium text-white/80 py-4 select-none min-h-[140px] max-h-56 overflow-y-auto pr-2 scroll-smooth" 
                  id="typer-canvas"
                >
                  {targetText.split('').map((char, idx) => {
                    let charClass = '';
                    
                    if (idx < inputValue.length) {
                      const isCorrect = firstErrorIndex === -1 || idx < firstErrorIndex;
                      charClass = isCorrect 
                        ? 'text-cyan-400 border-b-2 border-cyan-400/40 bg-cyan-500/5' 
                        : 'text-rose-500 bg-rose-500/20 px-0.5 rounded border-b-2 border-rose-500 font-semibold';
                    } else if (idx === inputValue.length) {
                      charClass = status === 'playing'
                        ? 'bg-cyan-400/20 text-cyan-300 border-l-2 border-cyan-400 animate-pulse font-bold'
                        : 'bg-white/10 text-white border-l border-white/50 animate-pulse';
                    } else {
                      charClass = 'text-white/30';
                    }

                    if (char === ' ' && idx === inputValue.length) {
                      return (
                        <span key={idx} className={`${charClass} px-0.5 rounded-sm`}>
                          ␣
                        </span>
                      );
                    }

                    return (
                      <span key={idx} className={`${charClass} transition-all duration-100`}>
                        {char}
                      </span>
                    );
                  })}
                </div>

                {/* Author Credit */}
                <div className="flex justify-between items-center text-xs text-white/40 mt-2">
                  <span className="italic font-medium">— {quote.source}</span>
                  {status === 'idle' && (
                    <button 
                      onClick={handleSkipQuote}
                      className="text-xs text-cyan-400 hover:text-cyan-300 font-bold uppercase tracking-wider transition-colors flex items-center gap-1 cursor-pointer"
                      id="skip-quote-btn"
                    >
                      <span>ӨӨР ТЕКСТ СОНГОХ</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Typing interactive box */}
                <div className="mt-auto flex flex-col gap-4">
                  <div className="relative">
                    <input
                      ref={inputRef}
                      type="text"
                      disabled={status === 'finished'}
                      readOnly={status === 'idle' || status === 'countdown'}
                      value={inputValue}
                      onChange={handleInputChange}
                      onClick={() => {
                        if (status === 'idle') {
                          startRace();
                        }
                      }}
                      onKeyDown={(e) => {
                        if (status === 'idle') {
                          e.preventDefault();
                          startRace();
                        }
                      }}
                      placeholder={
                        status === 'idle' 
                          ? "Уралдааныг эхлүүлэхийн тулд энд дарж эсвэл Enter дарна уу..." 
                          : status === 'countdown'
                            ? `Бэлэн үү... уралдаан эхлэхэд ${countdown}с`
                            : "Текстийг энд алдаагүй, хурдан бичнэ үү..."
                      }
                      className={`w-full bg-black/60 border-2 rounded-xl px-6 py-5 text-lg sm:text-xl font-mono focus:outline-none placeholder:text-white/20 text-white transition-all duration-300 ${
                        status === 'finished'
                          ? 'opacity-60 cursor-not-allowed border-white/5 text-white/40'
                          : status === 'idle'
                            ? 'border-white/15 focus:border-cyan-500/50 hover:border-cyan-500/35 cursor-pointer shadow-[0_0_15px_rgba(0,0,0,0.3)]'
                            : status === 'countdown'
                              ? 'border-cyan-500/20 cursor-default'
                              : hasActiveError
                                ? 'border-rose-500/80 shadow-[0_0_25px_rgba(244,63,94,0.15)] text-rose-100'
                                : 'border-cyan-500/30 focus:border-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.1)] focus:shadow-[0_0_35px_rgba(6,182,212,0.2)]'
                      }`}
                      id="typer-input"
                    />
                    
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-2">
                      {status === 'playing' ? (
                        <span className="bg-cyan-500/10 px-2 py-1 rounded text-[10px] text-cyan-400 border border-cyan-500/20 font-mono tracking-wider uppercase">ШУУД</span>
                      ) : (
                        <kbd className="bg-white/5 px-2 py-1 rounded text-[10px] text-white/40 border border-white/10 font-mono uppercase">Enter</kbd>
                      )}
                    </div>
                  </div>

                  {/* Play Control Action Buttons */}
                  <div className="flex justify-center gap-4">
                    {status === 'idle' ? (
                      <button 
                        onClick={startRace}
                        className="flex items-center gap-2 px-10 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 rounded-full text-xs font-black uppercase tracking-[0.2em] transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:shadow-[0_0_30px_rgba(6,182,212,0.6)] cursor-pointer text-black hover:scale-102"
                        id="enter-track-btn"
                      >
                        🏁 Гараанаас гарах (Эхлэх)
                      </button>
                    ) : status === 'countdown' ? (
                      <button 
                        disabled
                        className="flex items-center gap-2 px-10 py-4 bg-white/10 border border-white/10 rounded-full text-xs font-black uppercase tracking-[0.2em] text-white/40 cursor-not-allowed"
                      >
                        ⏱️ Хөдөлгүүрийг бэлдэж байна...
                      </button>
                    ) : status === 'playing' ? (
                      <div className="flex flex-wrap justify-center gap-3">
                        <button 
                          onClick={startRace}
                          className="flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-xs font-bold uppercase tracking-widest transition-all text-white/80 cursor-pointer hover:scale-102"
                          id="reset-match-btn"
                        >
                          🔄 Дахин эхлүүлэх
                        </button>
                        <button 
                          onClick={cancelRace}
                          className="flex items-center gap-2 px-6 py-3 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 hover:border-rose-500/40 rounded-full text-xs font-bold uppercase tracking-widest transition-all text-rose-400 cursor-pointer hover:scale-102 shadow-[0_0_15px_rgba(244,63,94,0.05)]"
                          id="cancel-match-btn"
                        >
                          ❌ Уралдаанаас гарах [Esc]
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-4">
                        <button 
                          onClick={startRace}
                          className="flex items-center gap-2 px-8 py-3 bg-gradient-to-tr from-cyan-500 to-blue-600 rounded-full text-xs font-bold uppercase tracking-widest transition-all text-black cursor-pointer hover:scale-105 shadow-[0_0_20px_rgba(6,182,212,0.3)]"
                          id="retry-race-btn"
                        >
                          🏁 Дахин уралдах
                        </button>
                        <button 
                          onClick={cancelRace}
                          className="flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-xs font-bold uppercase tracking-widest transition-all text-white/60 cursor-pointer hover:scale-102"
                          id="quit-after-race-btn"
                        >
                          ⬅️ Танхим руу буцах
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Warning overlay when they have active errors */}
                <AnimatePresence>
                  {hasActiveError && status === 'playing' && (
                    <motion.div 
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 15 }}
                      className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-rose-500 text-white text-xs px-4 py-2 rounded-lg font-bold flex items-center gap-2 shadow-2xl border border-rose-400"
                    >
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>Алдаагаа засаад уралдаанаа үргэлжлүүлнэ үү!</span>
                    </motion.div>
                  )}
                </AnimatePresence>

              </div>

              {/* Victory Screen Modal */}
              <AnimatePresence>
                {status === 'finished' && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="bg-gradient-to-br from-black/85 to-indigo-950/40 border border-cyan-500/30 rounded-3xl p-8 shadow-2xl relative overflow-hidden"
                    id="victory-overlay"
                  >
                    <div className="absolute inset-0 bg-cyan-500/5 pointer-events-none" />
                    
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-white/15 pb-6">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-cyan-500/10 rounded-xl flex items-center justify-center border border-cyan-500/30 text-2xl">
                          🏆
                        </div>
                        <div>
                          <h3 className="text-xl font-black uppercase tracking-tight text-cyan-400">УРАЛДААН ДУУСЛАА!</h3>
                          <p className="text-xs text-white/40 mt-0.5">Таны амжилтыг Хүндэт самбарт автоматаар бүртгэж байна</p>
                        </div>
                      </div>
                      <div className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-3 py-1 rounded font-mono text-xs font-bold">
                        {liveAccuracy}% Нарийвчлалтай
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-6">
                      <div className="text-center bg-white/5 rounded-xl p-4 border border-white/5">
                        <p className="text-[10px] text-white/40 uppercase font-black tracking-widest">Бичих Хурд</p>
                        <p className="text-2xl font-mono font-black text-cyan-400 mt-1">{liveWpm} <span className="text-[10px] text-white/40">WPM</span></p>
                      </div>
                      <div className="text-center bg-white/5 rounded-xl p-4 border border-white/5">
                        <p className="text-[10px] text-white/40 uppercase font-black tracking-widest">Нийт Алдаа</p>
                        <p className="text-2xl font-mono font-black text-rose-500 mt-1">{errorsCount}</p>
                      </div>
                      <div className="text-center bg-white/5 rounded-xl p-4 border border-white/5">
                        <p className="text-[10px] text-white/40 uppercase font-black tracking-widest">Нийт Хугацаа</p>
                        <p className="text-2xl font-mono font-black text-white mt-1">{elapsedSeconds.toFixed(1)}с</p>
                      </div>
                      <div className="text-center bg-white/5 rounded-xl p-4 border border-white/5">
                        <p className="text-[10px] text-white/40 uppercase font-black tracking-widest">Ашигласан Хөлөг</p>
                        <p className="text-2xl mt-1">{vConfig.emoji}</p>
                      </div>
                    </div>

                    {/* Auto Submission Status Panel */}
                    <div className="bg-cyan-500/5 border border-cyan-500/20 p-5 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        {isSubmitting ? (
                          <div className="w-10 h-10 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400 border border-cyan-500/20">
                            <span className="animate-spin rounded-full h-4 w-4 border-2 border-cyan-400 border-t-transparent"></span>
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                            ✓
                          </div>
                        )}
                        <div>
                          <h4 className="font-black text-cyan-400 uppercase tracking-wide">
                            {isSubmitting ? "Амжилтыг хадгалж байна..." : "Амжилт Амжилттай Хадгалагдлаа! 🏆"}
                          </h4>
                          <p className="text-xs text-white/60">
                            {isSubmitting 
                              ? "Хурдны үзүүлэлтийг Firestore мэдээллийн санд бүртгэж байна."
                              : "Таны гайхалтай амжилтыг Firestore мэдээллийн санд бүртгэлээ."
                            }
                          </p>
                        </div>
                      </div>
                      {activeRoomId ? (
                        <button 
                          onClick={leaveMultiplayerRoom}
                          className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest cursor-pointer hover:scale-102 transition-transform border border-rose-500/30"
                        >
                          Танхимаас Гарах 🚪
                        </button>
                      ) : (
                        <button 
                          onClick={startRace}
                          className="bg-cyan-500 hover:bg-cyan-400 text-black px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest cursor-pointer hover:scale-102 transition-transform"
                        >
                          Дахин уралдах 🏁
                        </button>
                      )}
                    </div>

                    {activeRoomId && activeRoomData && (
                      <div className="mt-6 border-t border-white/10 pt-6 space-y-3">
                        <h4 className="text-xs font-black uppercase tracking-wider text-white/50">Уралдааны Төгсгөлийн Дүн (Room Standings)</h4>
                        <div className="space-y-2">
                          {Object.values(activeRoomData.players || {})
                            .sort((a: any, b: any) => {
                              if (a.finishedAt && b.finishedAt) {
                                return new Date(a.finishedAt).getTime() - new Date(b.finishedAt).getTime();
                              }
                              if (a.finishedAt) return -1;
                              if (b.finishedAt) return 1;
                              return b.progress - a.progress;
                            })
                            .map((p: any, rankIdx: number) => {
                              const isMe = p.uid === myPlayerId;
                              const pConfig = VEHICLES_LIST.find(v => v.id === p.vehicle) || VEHICLES_LIST[0];
                              const medal = rankIdx === 0 ? "🥇" : rankIdx === 1 ? "🥈" : rankIdx === 2 ? "🥉" : "🏁";
                              return (
                                <div 
                                  key={p.uid} 
                                  className={`flex items-center justify-between p-3.5 rounded-xl border ${
                                    isMe 
                                      ? 'bg-cyan-500/10 border-cyan-400/30' 
                                      : 'bg-black/30 border-white/5'
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <span className="text-lg font-mono font-black">{medal}</span>
                                    <span className="text-xl">{pConfig.emoji}</span>
                                    <span className={`text-sm font-black ${isMe ? 'text-cyan-400' : 'text-white/80'}`}>
                                      {p.username} {isMe && "(БИ)"}
                                    </span>
                                  </div>
                                  <div className="text-right font-mono">
                                    <span className="text-cyan-400 font-extrabold text-sm">{p.wpm} WPM</span>
                                    <span className="text-white/35 text-[10px] ml-2">({p.accuracy}% Acc)</span>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                        {activeRoomData.hostId === myPlayerId && (
                          <div className="pt-2 text-center">
                            <button
                              onClick={resetMultiplayerRoom}
                              className="px-6 py-2.5 bg-gradient-to-tr from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-colors"
                            >
                              🔄 ДАРААГИЙН УРАЛДААНЫГ БЭЛТГЭХ (ЭЗЭН)
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                  </motion.div>
                )}
              </AnimatePresence>
                </>
              )}
            </>
          )}

        </div>

        {/* Leaderboard View (Right) */}
        <div className="lg:col-span-4 flex flex-col bg-black/40 border border-white/10 rounded-3xl overflow-hidden shadow-2xl h-full" id="leaderboard-view">
          
          <div className="p-6 border-b border-white/10 flex items-center justify-between bg-black/10">
            <h2 className="text-xs font-black uppercase tracking-[0.3em] text-white/50 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-500" />
              ШИЛДЭГ 10 БИЧЭЭЧ 🏆
            </h2>
            <button
              onClick={fetchLeaderboard}
              disabled={isLoadingLeaderboard}
              className="text-[10px] uppercase tracking-wider font-bold text-cyan-400 hover:text-cyan-300 transition cursor-pointer"
            >
              {isLoadingLeaderboard ? 'ШИНЭЧЛЭЖ БАЙНА...' : 'ШИНЭЧЛЭХ'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2 max-h-[560px]">
            {isLoadingLeaderboard && leaderboard.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-cyan-400 border-t-transparent"></div>
                <span className="text-[10px] text-white/40 font-mono tracking-widest uppercase">Холбогдож байна...</span>
              </div>
            ) : leaderboardError ? (
              <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
                <span className="text-xl text-rose-500">⚠</span>
                <p className="text-xs text-rose-400 max-w-[200px]">{leaderboardError}</p>
                <button 
                  onClick={fetchLeaderboard} 
                  className="mt-2 text-xs bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  Дахин оролдох
                </button>
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
                <span className="text-3xl">🏁</span>
                <h4 className="text-xs font-black uppercase tracking-wider text-white/40 mt-1">Амжилт байхгүй байна</h4>
                <p className="text-[11px] text-white/30 max-w-[200px] leading-relaxed">Анхны уралдаанаа дуусгаж шилдэг уралдаанчдын тэргүүн эгнээнд жагсаарай!</p>
              </div>
            ) : (
              leaderboard.map((item, index) => {
                const isTop1 = index === 0;
                
                const getRankColor = () => {
                  if (index === 0) return 'text-cyan-400 font-bold';
                  if (index === 1) return 'text-white/80 font-bold';
                  if (index === 2) return 'text-amber-600/90 font-bold';
                  return 'text-white/20';
                };

                const getVehicleEmoji = (v?: string) => {
                  if (v === 'rocket') return '🚀';
                  if (v === 'horse') return '🐎';
                  if (v === 'plane') return '✈️';
                  if (v === 'ufo') return '🛸';
                  if (v === 'dragon') return '🐉';
                  if (v === 'bicycle') return '🚲';
                  if (v === 'cheetah') return '🐆';
                  return '🚗';
                };

                return (
                  <div 
                    key={item.id}
                    className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-200 ${
                      isTop1 
                        ? 'bg-cyan-500/10 border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                        : 'bg-black/20 border-white/5 hover:bg-white/5'
                    }`}
                  >
                    {/* Rank index */}
                    <span className={`w-5 text-xs font-mono tracking-wider font-black ${getRankColor()}`}>
                      {(index + 1).toString().padStart(2, '0')}
                    </span>
                    
                    {/* Racer Info */}
                    <span className="flex-1 text-sm font-bold text-white/90 truncate flex items-center gap-2 min-w-0">
                      <span className="truncate">{item.name}</span>
                      <span className="text-xs select-none opacity-80" title="Уралдах хөлөг">{getVehicleEmoji(item.vehicle)}</span>
                    </span>

                    {/* Speed Metrics */}
                    <span className={`text-sm font-mono font-black ${isTop1 ? 'text-cyan-400' : 'text-white/60'} flex items-baseline gap-1`}>
                      {item.wpm}
                      <span className="text-[9px] text-white/30 uppercase font-black font-sans">wpm</span>
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Local User Speed History */}
          {history.length > 0 && (
            <div className="p-5 border-t border-white/10 bg-black/30">
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-cyan-400 mb-3 flex items-center gap-1.5">
                <Award className="w-4.5 h-4.5 text-cyan-400 animate-pulse" />
                МИНИЙ СҮҮЛИЙН ХУРД
              </h3>
              <div className="grid grid-cols-5 gap-1.5">
                {history.map((h, i) => (
                  <div key={i} className="flex flex-col items-center justify-center bg-white/5 border border-white/5 rounded-xl py-2 px-1 text-center">
                    <span className="text-[9px] text-white/30 font-bold font-mono">#{history.length - i}</span>
                    <span className="text-xs font-black font-mono text-cyan-300 mt-0.5">{h}</span>
                    <span className="text-[8px] text-white/40 uppercase font-black tracking-tighter">wpm</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="p-4 bg-white/5 text-[10px] text-center text-white/20 font-bold uppercase tracking-widest border-t border-white/5 font-mono">
            Firestore Synchronization Active
          </div>

        </div>

      </main>

      {/* Footer bar */}
      <footer className="px-6 md:px-10 py-5 flex flex-col sm:flex-row justify-between items-center text-[10px] font-bold uppercase tracking-[0.2em] text-white/20 border-t border-white/5 bg-black/40 mt-auto" id="app-footer">
        <div className="flex gap-6">
          <span>Уралдааны дугаар: TYPR-2026</span>
          <span>Мотор: SLATE-ENG</span>
        </div>
        <div className="flex gap-4 mt-2 sm:mt-0">
          <span className="hover:text-cyan-500/50 transition duration-150 cursor-help">Уралдааны дүрэм</span>
          <span>&copy; 2026 Mongolian TypeRacer Speed Club</span>
        </div>
      </footer>
    </div>
  );
}
