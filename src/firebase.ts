import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ── Same Firebase project as Customer + Rider apps ───────────────────────
const firebaseConfig = {
  apiKey: 'AIzaSyCGj-c4WU6PwCF9s0Z6k3xT6dbA6yqdKEQ',
  authDomain: 'food-mela-notification.firebaseapp.com',
  projectId: 'food-mela-notification',
  storageBucket: 'food-mela-notification.firebasestorage.app',
  messagingSenderId: '623657462795',
  appId: '1:623657462795:web:26da5491d2c14a671fab0e',
};

const app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
