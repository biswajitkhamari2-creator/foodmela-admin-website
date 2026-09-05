import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
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

console.log('=== 1. Try lipun2 auth ===');
try {
  const cred = await signInWithEmailAndPassword(auth, 'lipun2@gmail.com', 'Lipun@1234');
  console.log('lipun2 uid:', cred.user.uid);
  console.log('lipun2 email:', cred.user.email);
  // Try to get ID token to see claims
  const token = await cred.user.getIdTokenResult();
  console.log('token email:', token.claims.email);
  console.log('token claims:', JSON.stringify(token.claims, null, 2));

  // Try reading own doc by uid
  try {
    const snap = await getDoc(doc(db, 'users', cred.user.uid));
    console.log('read by uid:', snap.exists() ? JSON.stringify(snap.data()) : 'NOT FOUND (exists=false)');
  } catch(e) { console.log('read by uid error:', e.code, e.message); }

  // Try reading by phone doc ids - brute force common phones?
  // Let's try to query by email (should fail with current rules, but let's see)
  try {
    const q = query(collection(db, 'users'), where('email', '==', 'lipun2@gmail.com'));
    const snap = await getDocs(q);
    console.log('query by email as lipun2:', snap.size);
    snap.forEach(d => console.log('  ', d.id, JSON.stringify(d.data())));
  } catch(e) { console.log('query by email error:', e.code, e.message); }

  await signOut(auth);
} catch(e) { console.log('lipun2 sign-in error:', e.code, e.message); }

console.log('\n=== 2. Try admin auth to find lipun2 doc ===');
try {
  const cred = await signInWithEmailAndPassword(auth, 'admin@foodmela.com', 'Bisu@1234');
  console.log('admin uid:', cred.user.uid, 'email:', cred.user.email);
  const token = await cred.user.getIdTokenResult();
  console.log('admin token email:', token.claims.email);

  // As admin, try to find lipun2
  try {
    const q = query(collection(db, 'users'), where('email', '==', 'lipun2@gmail.com'));
    const snap = await getDocs(q);
    console.log('admin query lipun2 by email:', snap.size);
    snap.forEach(d => console.log('  FOUND', d.id, JSON.stringify(d.data(), null, 2)));
    if (snap.empty) console.log('  -> lipun2 doc NOT FOUND in Firestore (only Auth exists)');
  } catch(e) { console.log('admin query error:', e.code, e.message); }

  // List all delivery partners
  try {
    const q = query(collection(db, 'users'), where('role', '==', 'delivery_partner'));
    const snap = await getDocs(q);
    console.log('all delivery_partners as admin:', snap.size);
    snap.forEach(d => {
      const data = d.data();
      console.log(`  ${d.id} | ${data.name} | ${data.email} | ${data.phone} | approval:${data.approvalStatus} | status:${data.accountStatus}`);
    });
  } catch(e) { console.log('list partners error:', e.code, e.message); }

  await signOut(auth);
} catch(e) { console.log('admin sign-in error:', e.code, e.message); }

process.exit(0);
