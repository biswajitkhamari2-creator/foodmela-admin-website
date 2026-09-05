import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCGj-c4WU6PwCF9s0Z6k3xT6dbA6yqdKEQ',
  authDomain: 'food-mela-notification.firebaseapp.com',
  projectId: 'food-mela-notification',
  storageBucket: 'food-mela-notification.firebasestorage.app',
  messagingSenderId: '623657462795',
  appId: '1:623657462795:web:26da5491d2c14a671fab0e',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const email = 'lipun2@gmail.com';
const password = 'Lipun@1234';

console.log('=== DEBUG lipun2@gmail.com ===');
console.log('Trying Firebase Auth sign-in...');

try {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  console.log('✅ Auth SUCCESS — uid:', cred.user.uid, 'email:', cred.user.email);

  // Try to find Firestore doc by uid
  const byUid = await getDoc(doc(db, 'users', cred.user.uid));
  console.log('By UID exists:', byUid.exists(), byUid.exists() ? JSON.stringify(byUid.data(), null, 2) : '');

  // By email query
  const qEmail = query(collection(db, 'users'), where('email', '==', email));
  const snapEmail = await getDocs(qEmail);
  console.log('By email query found:', snapEmail.size);
  snapEmail.forEach(d => console.log('  DOC', d.id, JSON.stringify(d.data(), null, 2)));

  // By email lower
  const qEmailLower = query(collection(db, 'users'), where('email', '==', email.toLowerCase()));
  const snapLower = await getDocs(qEmailLower);
  console.log('By email lower found:', snapLower.size);

  // All delivery partners with lipun
  const qAll = query(collection(db, 'users'), where('role', '==', 'delivery_partner'));
  const snapAll = await getDocs(qAll);
  console.log('All delivery_partners:', snapAll.size);
  snapAll.forEach(d => {
    const data = d.data();
    if ((data.email || '').includes('lipun') || (data.name || '').toLowerCase().includes('lipun')) {
      console.log('  LIPUN PARTNER', d.id, JSON.stringify(data, null, 2));
    }
  });

} catch (e) {
  console.log('❌ Auth FAILED — code:', e.code, 'message:', e.message);
  console.log('Full error:', e);

  // Even if auth fails, try Firestore queries (might be readable without auth)
  console.log('\n--- Trying Firestore without auth ---');
  try {
    const qEmail = query(collection(db, 'users'), where('email', '==', email));
    const snapEmail = await getDocs(qEmail);
    console.log('By email (no auth) found:', snapEmail.size);
    snapEmail.forEach(d => console.log('  DOC', d.id, JSON.stringify(d.data(), null, 2)));
  } catch (e2) {
    console.log('Firestore query without auth failed:', e2.code, e2.message);
  }

  try {
    const qAll = query(collection(db, 'users'), where('role', '==', 'delivery_partner'));
    const snapAll = await getDocs(qAll);
    console.log('All delivery_partners (no auth):', snapAll.size);
    snapAll.forEach(d => {
      const data = d.data();
      if ((data.email || '').includes('lipun')) {
        console.log('  LIPUN PARTNER', d.id, JSON.stringify(data, null, 2));
      }
    });
  } catch (e2) {
    console.log('All partners query failed:', e2.code, e2.message);
  }
}

process.exit(0);
