import { initializeApp } from 'firebase/app';
import { getFirestore, doc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';
const firebaseConfig = {
  apiKey: 'AIzaSyCGj-c4WU6PwCF9s0Z6k3xT6dbA6yqdKEQ',
  authDomain: 'food-mela-notification.firebaseapp.com',
  projectId: 'food-mela-notification',
  storageBucket: 'food-mela-notification.firebasestorage.app',
  messagingSenderId: '623657462795',
  appId: '1:623657462795:web:26da5491d2c14a671fab0e',
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const q = query(collection(db, 'users'), where('phone', '==', '9876500011'));
const snap = await getDocs(q);
console.log('found by phone field:', snap.size);
for (const d of snap.docs) {
  console.log('deleting', d.id, d.data().name, d.data().email);
  await deleteDoc(doc(db, 'users', d.id));
  console.log('deleted', d.id);
}
try {
  await deleteDoc(doc(db, 'users', '9876500011'));
  console.log('deleted by doc id 9876500011');
} catch(e) { console.log('delete by id:', e.message); }
console.log('done');
process.exit(0);
