import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

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

// ── Test Rider ─────────────────────────────────────────────────────────
const TEST_RIDER = {
  name: 'Test Rider',
  email: 'rider_test@foodmela.com',
  phone: '919999888899',
  password: 'Test@1234',
  partnerId: 'FM-TES-0001',
};

async function createTestRider() {
  console.log('🔧 Creating test rider:', TEST_RIDER.email);

  let uid;
  try {
    const cred = await createUserWithEmailAndPassword(auth, TEST_RIDER.email, TEST_RIDER.password);
    uid = cred.user.uid;
    console.log(`✅ Auth user created: ${uid} (${TEST_RIDER.email})`);
  } catch (e) {
    if (e.code === 'auth/email-already-in-use') {
      console.log('ℹ️ Auth user already exists, signing in...');
      const cred = await signInWithEmailAndPassword(auth, TEST_RIDER.email, TEST_RIDER.password);
      uid = cred.user.uid;
      console.log(`✅ Signed in: ${uid}`);
    } else {
      console.error('❌ Auth failed:', e.code, e.message);
      throw e;
    }
  }

  // Sign in as admin to create Firestore docs (rules require admin for cross-user writes)
  // First, sign out rider and sign in as admin
  const ADMIN_EMAIL = 'admin@foodmela.com';
  const ADMIN_PASS = 'Bisu@1234';
  try {
    await auth.signOut();
    const adminCred = await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASS);
    console.log(`✅ Signed in as admin: ${adminCred.user.uid}`);
  } catch (e) {
    console.log(`⚠️ Admin sign-in failed (${e.code}), trying local admin fallback...`);
    // Try with FoodMela@2026
    try {
      await signInWithEmailAndPassword(auth, ADMIN_EMAIL, 'FoodMela@2026');
      console.log('✅ Signed in as admin (FoodMela@2026)');
    } catch (e2) {
      console.log(`⚠️ Admin sign-in also failed (${e2.code}), will try as rider (may fail due to rules)`);
      await signInWithEmailAndPassword(auth, TEST_RIDER.email, TEST_RIDER.password);
    }
  }

  // Create Firestore doc (phone as doc ID)
  await setDoc(doc(db, 'users', TEST_RIDER.phone), {
    name: TEST_RIDER.name,
    email: TEST_RIDER.email,
    phone: TEST_RIDER.phone,
    role: 'delivery_partner',
    accountStatus: 'active',
    approvalStatus: 'approved',
    partnerId: TEST_RIDER.partnerId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  console.log(`✅ Firestore doc created: users/${TEST_RIDER.phone}`);

  // Also create UID-based doc for lookup
  await setDoc(doc(db, 'users', uid), {
    name: TEST_RIDER.name,
    email: TEST_RIDER.email,
    phone: TEST_RIDER.phone,
    role: 'delivery_partner',
    accountStatus: 'active',
    approvalStatus: 'approved',
    partnerId: TEST_RIDER.partnerId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  console.log(`✅ Firestore doc created: users/${uid}`);

  console.log('\n✅ Test Rider ready!');
  console.log(`   Email: ${TEST_RIDER.email}`);
  console.log(`   Phone: ${TEST_RIDER.phone}`);
  console.log(`   Password: ${TEST_RIDER.password}`);
  console.log(`   Partner ID: ${TEST_RIDER.partnerId}`);
  console.log(`   UID: ${uid}`);
  console.log('\n📱 Login on Rider app with:');
  console.log(`   Email: ${TEST_RIDER.email}  OR  Phone: ${TEST_RIDER.phone}`);
  console.log(`   Password: ${TEST_RIDER.password}`);
}

createTestRider().catch(e => {
  console.error('Failed:', e);
  process.exit(1);
});
