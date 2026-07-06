import { useEffect, useState } from "react";
import { db, handleFirestoreError, OperationType } from "../firebase";
import { collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { Score } from "../types";
import { Trophy, Clock, Zap, RefreshCw, Car, Rocket, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";

export default function Leaderboard() {
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchScores = async () => {
    setLoading(true);
    setError(null);
    try {
      const scoresCol = collection(db, "typeracer_scores");
      // Query top 10 scores ordered by WPM desc, then accuracy desc
      const q = query(
        scoresCol,
        orderBy("wpm", "desc"),
        orderBy("accuracy", "desc"),
        limit(10)
      );
      const snapshot = await getDocs(q);
      const fetchedScores: Score[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        fetchedScores.push({
          id: doc.id,
          name: data.name || "Anonymous",
          wpm: data.wpm || 0,
          accuracy: data.accuracy || 0,
          errors: data.errors || 0,
          vehicle: data.vehicle || "car",
          createdAt: data.createdAt || Date.now()
        });
      });
      setScores(fetchedScores);
    } catch (err: any) {
      console.error("Error fetching leaderboard scores: ", err);
      setError("Could not load high scores. Please check your connection.");
      // Handle the Firestore error with structured JSON logging as required
      handleFirestoreError(err, OperationType.GET, "typeracer_scores");
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => {
    fetchScores();
  }, []);

  const getRankBadge = (index: number) => {
    if (index === 0) return "🥇";
    if (index === 1) return "🥈";
    if (index === 2) return "🥉";
    return `#${index + 1}`;
  };

  const getVehicleEmoji = (vehicle: string) => {
    if (vehicle === "rocket") return "🚀";
    if (vehicle === "horse") return "🐎";
    return "🚗";
  };

  const formatTime = (timestamp: any) => {
    if (!timestamp) return "Just now";
    try {
      // If it's a Firestore timestamp with toDate method
      if (typeof timestamp.toDate === "function") {
        return timestamp.toDate().toLocaleDateString();
      }
      // If it's a number/milisecond
      const date = new Date(timestamp);
      return date.toLocaleDateString();
    } catch (e) {
      return "Recently";
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl border border-slate-100 shadow-xl p-6 md:p-8" id="leaderboard-section">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-50 rounded-xl text-amber-500">
            <Trophy className="w-6 h-6" id="leaderboard-trophy-icon" />
          </div>
          <div>
            <h2 className="text-2xl font-sans font-bold text-slate-800 tracking-tight" id="leaderboard-title">Top 10 Leaderboard</h2>
            <p className="text-slate-500 text-sm" id="leaderboard-subtitle">The fastest typists in the system</p>
          </div>
        </div>

        <button
          onClick={fetchScores}
          disabled={loading}
          className="p-2.5 bg-slate-50 hover:bg-slate-100 active:scale-95 text-slate-600 rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center border border-slate-100 disabled:opacity-50"
          title="Refresh Leaderboard"
          id="leaderboard-refresh-btn"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16" id="leaderboard-loading">
          <div className="relative w-12 h-12">
            <div className="absolute top-0 left-0 w-full h-full border-4 border-emerald-100 rounded-full"></div>
            <div className="absolute top-0 left-0 w-full h-full border-4 border-emerald-500 rounded-full border-t-transparent animate-spin"></div>
          </div>
          <p className="text-slate-400 mt-4 text-sm font-mono">Loading typist elite...</p>
        </div>
      ) : error ? (
        <div className="text-center py-12 px-4 bg-red-50 rounded-xl border border-red-100" id="leaderboard-error-container">
          <p className="text-red-600 font-medium mb-3" id="leaderboard-error-text">{error}</p>
          <button
            onClick={fetchScores}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg text-sm transition-colors cursor-pointer"
            id="leaderboard-retry-btn"
          >
            Retry Fetching
          </button>
        </div>
      ) : scores.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-xl border border-dashed border-slate-200" id="leaderboard-empty">
          <p className="text-slate-400 mb-4" id="leaderboard-empty-text">No scores recorded yet! Be the first to establish a high score.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-100" id="leaderboard-table-container">
          <div className="grid grid-cols-12 bg-slate-50 border-b border-slate-100 py-3 px-4 text-xs font-mono font-medium uppercase tracking-wider text-slate-500">
            <div className="col-span-2 text-center">Rank</div>
            <div className="col-span-4 pl-2">Racer</div>
            <div className="col-span-2 text-center">WPM</div>
            <div className="col-span-2 text-center">Accuracy</div>
            <div className="col-span-2 text-right">Date</div>
          </div>

          <div className="divide-y divide-slate-50">
            {scores.map((score, index) => {
              const isTop3 = index < 3;
              const bgClass = index === 0 
                ? "bg-amber-50/20 hover:bg-amber-50/40" 
                : index === 1 
                ? "bg-slate-50/30 hover:bg-slate-50/50" 
                : index === 2 
                ? "bg-orange-50/10 hover:bg-orange-50/20"
                : "bg-white hover:bg-slate-50/30";

              return (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  key={score.id || index}
                  className={`grid grid-cols-12 py-4 px-4 items-center text-sm text-slate-700 transition-colors ${bgClass}`}
                  id={`leaderboard-row-${index}`}
                >
                  <div className="col-span-2 flex items-center justify-center font-bold text-center">
                    <span className={isTop3 ? "text-xl" : "text-slate-400 font-mono text-xs"}>
                      {getRankBadge(index)}
                    </span>
                  </div>

                  <div className="col-span-4 flex items-center gap-2 pl-2">
                    <span className="text-xl" title={score.vehicle}>
                      {getVehicleEmoji(score.vehicle)}
                    </span>
                    <span className="font-sans font-semibold text-slate-800 truncate" title={score.name}>
                      {score.name}
                    </span>
                  </div>

                  <div className="col-span-2 text-center">
                    <span className="font-mono font-bold text-slate-900 bg-emerald-50 px-2.5 py-1 rounded-full text-emerald-700 border border-emerald-100/50">
                      {score.wpm}
                    </span>
                  </div>

                  <div className="col-span-2 text-center font-mono text-slate-600">
                    {Math.round(score.accuracy)}%
                  </div>

                  <div className="col-span-2 text-right font-mono text-xs text-slate-400">
                    {formatTime(score.createdAt)}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
