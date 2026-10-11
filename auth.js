/* ===== FIREBASE CONFIG ===== */
const firebaseConfig = {
  apiKey: "AIzaSyAoOPT5O4_6BJtR9wqyCbPUdMuFrZOwHwc",
  authDomain: "studyapp-92dca.firebaseapp.com",
  projectId: "studyapp-92dca",
  appId: "1:273865559816:web:9f9f58c686b476badf66bd"
};

const loginEl = $('#login'), loginErr = $('#login-error'), landing = $('#landing');
let appStarted = false, signUp = false;

function authMessage(e) {
  const m = {
    'auth/popup-closed-by-user': 'The sign-in window was closed. Try again.',
    'auth/popup-blocked': 'Your browser blocked the popup. Allow popups for this page.',
    'auth/unauthorized-domain': 'Add this website address to Authorized domains in Firebase.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled in Firebase yet.',
    'auth/invalid-credential': 'Wrong email or password. If you signed up with Google, use the Google button.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account with this email. Tap "Create an account".',
    'auth/email-already-in-use': 'This email already has an account. Sign in instead.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.'
  };
  return m[e.code] || 'Sign-in failed: ' + (e.code || e.message);
}

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .catch(err => {
    console.error('Firebase persistence error:', err);
  });

/* Switch between "Sign in" and "Create account" */
function setMode(on) {
  signUp = on;
  $('#auth-title').textContent = on ? 'Create your account' : 'Sign in to StudyApp';
  $('#auth-submit').textContent = on ? 'Create account' : 'Sign in';
  $('#switch-text').textContent = on ? 'Already have an account?' : 'New to StudyApp?';
  $('#switch-mode').textContent = on ? 'Sign in' : 'Create an account';
  $('#forgot').hidden = on;
  $('#auth-pass').autocomplete = on ? 'new-password' : 'current-password';
  loginErr.textContent = '';
}
$('#switch-mode').addEventListener('click', () => setMode(!signUp));

/* Email + password */
$('#auth-form').addEventListener('submit', e => {
  e.preventDefault();
  loginErr.textContent = '';
  const email = $('#auth-email').value.trim(), pass = $('#auth-pass').value;
  const attempt = signUp ? auth.createUserWithEmailAndPassword(email, pass) : auth.signInWithEmailAndPassword(email, pass);
  attempt.catch(err => { loginErr.textContent = authMessage(err); });
});

/* Forgot password */
$('#forgot').addEventListener('click', () => {
  const email = $('#auth-email').value.trim();
  if (!email) { loginErr.textContent = 'Type your email first, then tap Forgot password.'; return; }
  auth.sendPasswordResetEmail(email)
    .then(() => { loginErr.textContent = 'If this email has an account, a reset link was sent. Check spam too.'; })
    .catch(err => { loginErr.textContent = authMessage(err); });
});

/* Google (popup on laptop, full-page redirect on phone) */
$('#btn-google').addEventListener('click', () => {
  loginErr.textContent = '';
  const p = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(p).catch(err => {
    if (err.code === 'auth/popup-blocked' ||
        err.code === 'auth/operation-not-supported-in-this-environment') {
      auth.signInWithRedirect(p);
    } else {
      loginErr.textContent = authMessage(err);
    }
  });
});
auth.getRedirectResult().catch(err => { loginErr.textContent = authMessage(err); });

$('#sign-out').addEventListener('click', () => auth.signOut());

/* Homepage buttons */
$('#landing-signin').addEventListener('click', () => { landing.hidden = true; });
$('#landing-cta').addEventListener('click', () => { landing.hidden = true; });

auth.onAuthStateChanged(user => {
  loginEl.classList.add('ready');
  if (!user) { loginEl.hidden = false; landing.hidden = false; return; }
  landing.hidden = true;
  KEY = 'studyAppData_' + user.uid;
  if (!localStorage.getItem(KEY) && localStorage.getItem('studyAppData')) {
    localStorage.setItem(KEY, localStorage.getItem('studyAppData'));
  }
  loginEl.hidden = true;
  if (!appStarted) { appStarted = true; init(); }
  else { loadData(); saveData(); go('overview'); }
  const first = user.displayName ? user.displayName.split(' ')[0] : (user.email || '').split('@')[0];
  if (data.studentName === 'Student' && first) saveName(first);
  $('#account-email').textContent = 'Signed in as ' + (user.email || user.displayName || 'your account');
});