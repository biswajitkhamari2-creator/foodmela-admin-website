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

// Try as admin if possible, otherwise try with lipun2 but check doc via different method
// First, try to sign in as lipun2 and see what doc id would be
console.log('=== Trying lipun2 auth + doc checks ===');
try {
  const cred = await signInWithEmailAndPassword(auth, 'lipun2@gmail.com', 'Lipun@1234');
  console.log('lipun2 uid:', cred.user.uid, 'email:', cred.user.email);
  console.log('token email:', cred.user.email);

  // Try reading own doc by uid (should fail if doc is phone-based)
  try {
    const byUid = await getDoc(doc(db, 'users', cred.user.uid));
    console.log('By UID exists:', byUid.exists(), byUid.exists() ? JSON.stringify(byUid.data()) : 'no doc');
  } catch(e) { console.log('By UID error:', e.code, e.message); }

  // Try reading by phone doc ids that might be lipun2's phone
  // We don't know lipun2's phone, so try to query by email (will fail with current rules, but let's see)
  try {
    const q = query(collection(db, 'users'), where('email', '==', 'lipun2@gmail.com'));
    const snap = await getDocs(q);
    console.log('Query by email as lipun2 found:', snap.size);
    snap.forEach(d => console.log('  DOC', d.id, JSON.stringify(d.data())));
  } catch(e) { console.log('Query by email as lipun2 error:', e.code, e.message); }

  await auth.signOut();
} catch(e) { console.log('lipun2 sign-in failed:', e.code, e.message); }

console.log('\n=== Trying to find lipun2 via admin-like query (using lipun2 auth to list all?) ===');
// We can't query all as lipun2 due to rules, so let's try to brute force phone doc ids
// Common pattern: doc id is phone number. Let's try to sign in as lipun2 and then try to read doc with phone that might be in Auth displayName or elsewhere
// Instead, let's check what the admin panel sees for lipun2 by trying to use the same Firestore instance but with different auth
// We need to check if lipun2 doc exists at all by trying to create a secondary app with admin creds
// For now, let's just check the Firestore rules issue and propose fix

console.log('\n=== Diagnosis ===');
console.log('lipun2 Auth exists and password is correct (sign-in succeeded)');
console.log('But Firestore doc read fails due to rules: doc id is phone, not uid');
console.log('And email query is blocked because rule requires uid == docId or admin');
console.log('Fix needed: add email-based read rule');

process.exit(0);
