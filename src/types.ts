export type VehicleType = "car" | "rocket" | "horse" | "plane" | "ufo" | "dragon" | "bicycle" | "cheetah";

export interface Score {
  id?: string;
  name: string;
  wpm: number;
  accuracy: number;
  errors: number;
  createdAt: any; // Firestore timestamp or number
  vehicle: VehicleType;
}

export interface Quote {
  text: string;
  source: string;
  difficulty?: "easy" | "medium" | "hard";
}

export type GameStatus = 'idle' | 'countdown' | 'playing' | 'finished';
