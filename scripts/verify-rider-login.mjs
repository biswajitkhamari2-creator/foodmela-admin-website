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

// Simulate RiderAuthService.login for lipun2@gmail.com
async function testEmailLogin(email, password) {
  console.log(`\n=== Testing email login: ${email} ===`);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    console.log('✅ Auth OK uid:', cred.user.uid);
    const uid = cred.user.uid;

    // Mimic _signInWithEmail profile fetch
    let riderDoc = await getDoc(doc(db, 'users', uid));
    console.log('  by uid exists:', riderDoc.exists());
    if (!riderDoc.exists()) {
      // Try email query (this is what was failing before)
      const q = await getDocs(query(collection(db, 'users'), where('email', '==', email.toLowerCase()), where('role', '==', 'delivery_partner')));
      console.log('  by email query found:', q.size);
      if (q.docs.length > 0) riderDoc = q.docs[0];
    }
    if (!riderDoc.exists()) {
      console.log('❌ Rider profile NOT FOUND');
      await signOut(auth);
      return false;
    }
    const data = riderDoc.data();
    console.log('  profile:', JSON.stringify({ name: data.name, email: data.email, phone: data.phone, role: data.role, approval: data.approvalStatus, status: data.accountStatus, partnerId: data.partnerId }));
    if (data.role !== 'delivery_partner') { console.log('❌ wrong role'); await signOut(auth); return false; }
    if (data.approvalStatus === 'pending') { console.log('❌ pending approval'); await signOut(auth); return false; }
    if (data.accountStatus === 'blocked') { console.log('❌ blocked'); await signOut(auth); return false; }
    console.log('✅ LOGIN SUCCESS — would navigate to RiderDashboard');
    await signOut(auth);
    return true;
  } catch (e) {
    console.log('❌ Login failed:', e.code, e.message);
    try { await signOut(auth); } catch {}
    return false;
  }
}

async function testPhoneLogin(phone, password) {
  console.log(`\n=== Testing phone login: ${phone} ===`);
  // Mimic phone -> email resolution
  let phoneNorm = phone.replace(/[^0-9]/g, '');
  if (phoneNorm.length === 10) phoneNorm = '91' + phoneNorm;
  console.log('  normalized phone:', phoneNorm);
  try {
    // Try phone query (before auth, like RiderAuthService does)
    // Need to be unauthenticated for this part, so sign out first
    try { await signOut(auth); } catch {}
    let q = await getDocs(query(collection(db, 'users'), where('phone', '==', phoneNorm), where('role', '==', 'delivery_partner')));
    console.log('  query by 91+phone found:', q.size);
    let q2 = null;
    if (q.empty) {
      const short = phoneNorm.length > 10 ? phoneNorm.slice(-10) : phoneNorm;
      q2 = await getDocs(query(collection(db, 'users'), where('phone', '==', short), where('role', '==', 'delivery_partner')));
      console.log('  query by short phone found:', q2.size);
    }
    const found = q.docs.length > 0 ? q.docs[0] : (q2 && q2.docs.length > 0 ? q2.docs[0] : null);
    if (!found) { console.log('❌ No rider found for phone'); return false; }
    const email = (found.data().email || '').toLowerCase();
    console.log('  resolved email:', email);
    return await testEmailLogin(email, password);
  } catch (e) {
    console.log('❌ Phone lookup failed:', e.code, e.message);
    return false;
  }
}

const r1 = await testEmailLogin('lipun2@gmail.com', 'Lipun@1234');
const r2 = await testPhoneLogin('9999998909', 'Lipun@1234');
const r3 = await testEmailLogin('lipun1@gmail.com', 'Lipun@1234'); // control

console.log('\n=== SUMMARY ===');
console.log('lipun2 email login:', r1 ? '✅ PASS' : '❌ FAIL');
console.log('lipun2 phone login:', r2 ? '✅ PASS' : '❌ FAIL');
console.log('lipun1 email login (control):', r3 ? '✅ PASS' : '❌ FAIL (maybe wrong password)');

process.exit(0);
