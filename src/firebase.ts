import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "gen-lang-client-0276587344",
  appId: "1:437492681286:web:4d35e162131f75e6959847",
  apiKey: "AIzaSyD7LKR04qLM5-fK8FxVfnJryfUilxP_WZk",
  authDomain: "gen-lang-client-0276587344.firebaseapp.com",
  storageBucket: "gen-lang-client-0276587344.firebasestorage.app",
  messagingSenderId: "437492681286"
};

const app = initializeApp(firebaseConfig);

// Use the custom database ID provided in the config file to avoid default connection issues
export const db = getFirestore(app, "ai-studio-bf6e2f4a-0734-42c2-8a00-931d59f68111");

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: null;
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: null,
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

