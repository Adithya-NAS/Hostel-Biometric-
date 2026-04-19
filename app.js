const state = {
  students: [],
  biometrics: [],
  attendance: [],
  alerts: 0,
  adminLogged: false,
  editingStudentId: null,
  cameraStream: null,
  enrollingBiometricType: null,
  biometricCapabilities: {},
  mobileDevice: false,
  biometricSupported: false,
};

// Detect mobile device and biometric capabilities on startup
function detectBiometricCapabilities() {
  const ua = navigator.userAgent.toLowerCase();
  state.mobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(ua);
  
  // Check WebAuthn/FIDO2 support
  state.biometricCapabilities.webauthn = !!window.PublicKeyCredential;
  
  // Check camera/MediaDevices API
  state.biometricCapabilities.camera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  
  // Check TouchID/FaceID (iOS)
  state.biometricCapabilities.iosBiometric = /iphone|ipad/.test(ua) && state.biometricCapabilities.webauthn;
  
  // Check Android fingerprint/face
  state.biometricCapabilities.androidBiometric = /android/.test(ua) && state.biometricCapabilities.webauthn;
  
  // Check Windows Hello
  state.biometricCapabilities.windowsHello = /windows|win32/.test(ua) && state.biometricCapabilities.webauthn;
  
  // Overall biometric support
  state.biometricSupported = state.biometricCapabilities.webauthn || state.biometricCapabilities.camera;
  
  console.log('Device Capabilities:', {
    mobileDevice: state.mobileDevice,
    webauthn: state.biometricCapabilities.webauthn,
    camera: state.biometricCapabilities.camera,
    ios: state.biometricCapabilities.iosBiometric,
    android: state.biometricCapabilities.androidBiometric,
    windowsHello: state.biometricCapabilities.windowsHello,
  });
  
  if (!state.biometricSupported) {
    showToast('⚠️ Your device does not support biometric hardware. Using manual enrollment.');
  }
}

const selectors = {
  studentList: document.getElementById('student-list'),
  attendanceList: document.getElementById('attendance-list'),
  reportOutput: document.getElementById('report-output'),
  summaryStudents: document.getElementById('summary-students'),
  summaryBiometrics: document.getElementById('summary-biometrics'),
  summaryLogs: document.getElementById('summary-logs'),
  summaryAlerts: document.getElementById('summary-alerts'),
};

function loadState() {
  state.students = JSON.parse(localStorage.getItem('hb_students') || '[]');
  state.biometrics = JSON.parse(localStorage.getItem('hb_biometrics') || '[]');
  state.attendance = JSON.parse(localStorage.getItem('hb_attendance') || '[]');
  state.alerts = parseInt(localStorage.getItem('hb_alerts') || '0', 10);
}

function saveState() {
  localStorage.setItem('hb_students', JSON.stringify(state.students));
  localStorage.setItem('hb_biometrics', JSON.stringify(state.biometrics));
  localStorage.setItem('hb_attendance', JSON.stringify(state.attendance));
  localStorage.setItem('hb_alerts', String(state.alerts));
}

function renderSummary() {
  selectors.summaryStudents.textContent = state.students.length;
  selectors.summaryBiometrics.textContent = state.biometrics.length;
  selectors.summaryLogs.textContent = state.attendance.length;
  selectors.summaryAlerts.textContent = state.alerts;
}

function renderStudents() {
  if (!selectors.studentList) return;
  if (!state.students.length) {
    selectors.studentList.innerHTML = '<div class="data-item">No students registered yet.</div>';
    return;
  }

  selectors.studentList.innerHTML = state.students.map(student => {
    const fingerprint = state.biometrics.some(b => b.studentId === student.id && b.type === 'fingerprint');
    const face = state.biometrics.some(b => b.studentId === student.id && b.type === 'face');
    return `
      <div class="data-item">
        <div>
          <strong>${student.name}</strong>
          <small>Roll: ${student.rollNo} • Room: ${student.roomNo} • ${student.contact}</small>
          <small>Fingerprint: ${fingerprint ? '✅' : '❌'} • Face: ${face ? '✅' : '❌'}</small>
        </div>
        <div class="data-actions">
          <button onclick="startEditStudent('${student.id}')">Edit</button>
          <button class="secondary" onclick="deleteStudent('${student.id}')">Delete</button>
        </div>
      </div>`;
  }).join('');
}

function renderAttendance() {
  if (!selectors.attendanceList) return;
  if (!state.attendance.length) {
    selectors.attendanceList.innerHTML = '<div class="data-item">No attendance records yet.</div>';
    return;
  }

  selectors.attendanceList.innerHTML = state.attendance
    .slice().reverse()
    .map(entry => {
      const student = state.students.find(s => s.id === entry.studentId) || { name: 'Unknown', rollNo: 'N/A' };
      return `
      <div class="data-item">
        <div>
          <strong>${student.name}</strong>
          <small>${student.rollNo} • ${entry.date} • ${entry.time}</small>
          <small>Status: ${entry.status}</small>
        </div>
      </div>`;
    }).join('');
}

function renderReport(period = 'daily') {
  const today = new Date().toISOString().slice(0, 10);
  let entries = state.attendance.filter(entry => entry.date === today);

  if (period === 'monthly') {
    const month = today.slice(0, 7);
    entries = state.attendance.filter(entry => entry.date.startsWith(month));
  }

  selectors.reportOutput.textContent = entries.length
    ? entries.map(entry => {
        const student = state.students.find(s => s.id === entry.studentId) || { name: 'Unknown', rollNo: 'N/A' };
        return `${entry.date} ${entry.time} - ${student.name} (${student.rollNo}) → ${entry.status}`;
      }).join('\n')
    : 'No attendance records for this period.';
}

function showStudentForm() {
  resetStudentForm();
  document.getElementById('student-form-title').textContent = 'Enroll Student';
  scrollTo(document.getElementById('student-form-card')); 
}

function resetStudentForm() {
  state.editingStudentId = null;
  document.getElementById('student-name').value = '';
  document.getElementById('student-roll').value = '';
  document.getElementById('student-room').value = '';
  document.getElementById('student-phone').value = '';
  document.getElementById('student-form-title').textContent = 'Enroll Student';
}

function saveStudent() {
  const name = document.getElementById('student-name').value.trim();
  const rollNo = document.getElementById('student-roll').value.trim();
  const roomNo = document.getElementById('student-room').value.trim();
  const contact = document.getElementById('student-phone').value.trim();

  if (!name || !rollNo) {
    showToast('Name and roll number are required.');
    return;
  }

  const duplicate = state.students.find(s => s.rollNo === rollNo && s.id !== state.editingStudentId);
  if (duplicate) {
    showToast('A student with this roll number already exists.');
    return;
  }

  if (state.editingStudentId) {
    const student = state.students.find(s => s.id === state.editingStudentId);
    if (student) {
      student.name = name;
      student.rollNo = rollNo;
      student.roomNo = roomNo;
      student.contact = contact;
      showToast('Student record updated.');
    }
  } else {
    state.students.push({
      id: crypto.randomUUID(),
      name,
      rollNo,
      roomNo,
      contact,
    });
    showToast('Student registered successfully.');
  }

  saveState();
  renderStudents();
  renderSummary();
  resetStudentForm();
}

function startEditStudent(studentId) {
  const student = state.students.find(s => s.id === studentId);
  if (!student) return;
  state.editingStudentId = student.id;
  document.getElementById('student-name').value = student.name;
  document.getElementById('student-roll').value = student.rollNo;
  document.getElementById('student-room').value = student.roomNo;
  document.getElementById('student-phone').value = student.contact;
  document.getElementById('student-form-title').textContent = 'Edit Student';
  scrollTo(document.getElementById('student-form-card'));
}

function deleteStudent(studentId) {
  state.students = state.students.filter(s => s.id !== studentId);
  state.biometrics = state.biometrics.filter(b => b.studentId !== studentId);
  state.attendance = state.attendance.filter(a => a.studentId !== studentId);
  saveState();
  renderStudents();
  renderAttendance();
  renderSummary();
  showToast('Student data deleted.');
}

async function startFingerprintEnrollment() {
  const rollNo = document.getElementById('student-roll').value.trim();
  if (!rollNo) {
    showToast('Enter the student roll number before enrolling biometric data.');
    return;
  }

  const student = state.students.find(s => s.rollNo === rollNo);
  if (!student) {
    showToast('Student not found. Save the student details first.');
    return;
  }

  const duplicate = state.biometrics.some(b => b.type === 'fingerprint' && b.studentId === student.id);
  if (duplicate) {
    showToast('Fingerprint is already enrolled for this student.');
    return;
  }

  if (!state.biometricCapabilities.webauthn) {
    showToast('WebAuthn/FIDO2 not supported on this device.');
    return;
  }

  try {
    updateEnrollmentStatus('🔐 Requesting biometric hardware access...', true);
    
    // Generate a unique challenge for this enrollment
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: challenge,
        rp: {
          name: 'Hostel Biometric System',
          id: window.location.hostname,
        },
        user: {
          id: new Uint8Array(Buffer.from(student.id)),
          name: student.rollNo,
          displayName: student.name,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },  // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform', // Use device's built-in authenticator
          userVerification: 'required',         // Require biometric verification
          residentKey: 'preferred',
        },
        timeout: 60000, // 60 seconds
        attestation: 'direct',
      },
    });

    if (credential) {
      let biometricInfo = '✅ Fingerprint enrolled';
      if (state.mobileDevice) {
        if (state.biometricCapabilities.iosBiometric) {
          biometricInfo = '✅ Enrolled via iOS Touch ID/Face ID';
        } else if (state.biometricCapabilities.androidBiometric) {
          biometricInfo = '✅ Enrolled via Android Biometric';
        }
      } else if (state.biometricCapabilities.windowsHello) {
        biometricInfo = '✅ Enrolled via Windows Hello';
      }
      
      state.biometrics.push({
        id: crypto.randomUUID(),
        studentId: student.id,
        type: 'fingerprint',
        template: JSON.stringify({
          credentialId: Array.from(new Uint8Array(credential.id)),
          publicKey: credential.response.getPublicKey(),
          transports: credential.response.getTransports(),
        }),
        deviceType: state.mobileDevice ? 'mobile' : 'desktop',
        platform: getPlatformInfo(),
      });
      
      saveState();
      renderStudents();
      renderSummary();
      showToast(biometricInfo);
      updateEnrollmentStatus(biometricInfo, true);
      setTimeout(() => updateEnrollmentStatus('', false), 3000);
    }
  } catch (error) {
    const errorMsg = error.name === 'NotAllowedError' 
      ? 'Biometric enrollment cancelled or not available.'
      : error.message;
    showToast(`Fingerprint enrollment failed: ${errorMsg}`);
    updateEnrollmentStatus(`❌ ${errorMsg}`, false);
  }
}

function getPlatformInfo() {
  const ua = navigator.userAgent;
  if (/iphone|ipad/.test(ua.toLowerCase())) {
    return 'iOS (Touch ID/Face ID)';
  } else if (/android/.test(ua.toLowerCase())) {
    return 'Android (Biometric Sensor)';
  } else if (/windows|win32/.test(ua.toLowerCase())) {
    return 'Windows (Windows Hello)';
  } else if (/mac|osx/.test(ua.toLowerCase())) {
    return 'macOS (Touch ID)';
  }
  return 'Unknown Platform';
}

async function startFaceEnrollment() {
  const rollNo = document.getElementById('student-roll').value.trim();
  if (!rollNo) {
    showToast('Enter the student roll number before enrolling biometric data.');
    return;
  }

  const student = state.students.find(s => s.rollNo === rollNo);
  if (!student) {
    showToast('Student not found. Save the student details first.');
    return;
  }

  const duplicate = state.biometrics.some(b => b.type === 'face' && b.studentId === student.id);
  if (duplicate) {
    showToast('Face is already enrolled for this student.');
    return;
  }

  state.enrollingBiometricType = 'face';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    state.cameraStream = stream;
    const video = document.getElementById('camera-preview');
    video.srcObject = stream;
    document.getElementById('camera-container').classList.remove('hidden');
    updateEnrollmentStatus('📷 Camera open. Position your face and click Capture.', true);
  } catch (error) {
    showToast(`Camera access denied: ${error.message}`);
    updateEnrollmentStatus(`❌ ${error.message}`, false);
  }
}

function captureFaceImage() {
  const video = document.getElementById('camera-preview');
  const canvas = document.getElementById('face-capture-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);

  const imageData = canvas.toDataURL('image/jpeg');
  const rollNo = document.getElementById('student-roll').value.trim();
  const student = state.students.find(s => s.rollNo === rollNo);

  if (student) {
    state.biometrics.push({
      id: crypto.randomUUID(),
      studentId: student.id,
      type: 'face',
      template: imageData,
    });
    saveState();
    renderStudents();
    renderSummary();
    stopCamera();
    showToast('Face enrolled successfully from camera capture.');
    updateEnrollmentStatus('✅ Face enrolled from camera', true);
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(track => track.stop());
    state.cameraStream = null;
  }
  document.getElementById('camera-container').classList.add('hidden');
  state.enrollingBiometricType = null;
  updateEnrollmentStatus('', false);
}

function updateEnrollmentStatus(message, show) {
  const statusDiv = document.getElementById('enrollment-status');
  if (show && message) {
    statusDiv.textContent = message;
    statusDiv.classList.remove('hidden');
  } else {
    statusDiv.classList.add('hidden');
  }
}

function enrollBiometric(type) {
  if (type === 'fingerprint') {
    startFingerprintEnrollment();
  } else if (type === 'face') {
    startFaceEnrollment();
  }
}

async function performBiometricLogin(type) {
  if (type === 'fingerprint') {
    try {
      if (!state.biometricCapabilities.webauthn) {
        throw new Error('Biometric hardware not available on this device.');
      }
      
      let loginMsg = '🔐 Attempting fingerprint authentication...';
      if (state.mobileDevice) {
        if (state.biometricCapabilities.iosBiometric) {
          loginMsg = '🔐 Please authenticate with iOS Touch ID/Face ID...';
        } else if (state.biometricCapabilities.androidBiometric) {
          loginMsg = '🔐 Please authenticate with Android Biometric...';
        }
      }
      showToast(loginMsg);
      
      // Get enrolled credentials
      const enrolled = state.biometrics.filter(b => b.type === 'fingerprint');
      if (!enrolled.length) {
        showToast('No fingerprint enrollments found.');
        return;
      }

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          userVerification: 'required',
          timeout: 60000,
          allowCredentials: enrolled.slice(0, 5).map(b => {
            try {
              const parsed = JSON.parse(b.template);
              return {
                id: new Uint8Array(parsed.credentialId),
                type: 'public-key',
                transports: parsed.transports || [],
              };
            } catch {
              return null;
            }
          }).filter(Boolean),
        },
      });

      if (assertion) {
        matchBiometricLogin('fingerprint', assertion);
      }
    } catch (error) {
      const errorMsg = error.name === 'NotAllowedError' 
        ? 'Biometric authentication cancelled.'
        : error.message;
      showToast(`Fingerprint authentication failed: ${errorMsg}`);
    }
  } else if (type === 'face') {
    startFaceLogin();
  }
}

async function startFaceLogin() {
  try {
    showToast('Opening camera for face authentication...');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    state.cameraStream = stream;
    const video = document.getElementById('camera-preview');
    video.srcObject = stream;
    document.getElementById('camera-container').classList.remove('hidden');
    updateEnrollmentStatus('📷 Camera open. Position your face and click Capture for authentication.', true);
  } catch (error) {
    showToast(`Camera access denied: ${error.message}`);
  }
}

function matchBiometricLogin(type, credentialData) {
  const enrolled = state.biometrics.filter(b => b.type === type);
  if (!enrolled.length) {
    showToast('No biometric profiles found for this type.');
    return;
  }

  const biometric = enrolled[Math.floor(Math.random() * enrolled.length)];
  const student = state.students.find(s => s.id === biometric.studentId);
  if (!student) {
    showToast('Matched student record not found.');
    return;
  }

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5);
  const status = now.getHours() >= 9 ? 'Late entry' : 'On time';
  state.attendance.push({ studentId: student.id, date, time, status });
  if (status === 'Late entry') {
    state.alerts += 1;
  }
  saveState();
  renderAttendance();
  renderSummary();
  showToast(`Welcome ${student.name}! Attendance marked as ${status}.`);
}

function takeAttendanceForRandomStudent(type) {
  const enrolled = state.biometrics.filter(b => b.type === type);
  if (!enrolled.length) {
    showToast('No biometric profiles found. Enroll a student first.');
    return;
  }

  const biometric = enrolled[Math.floor(Math.random() * enrolled.length)];
  const student = state.students.find(s => s.id === biometric.studentId);
  if (!student) {
    showToast('Matched student record not found.');
    return;
  }

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5);
  const status = now.getHours() >= 9 ? 'Late entry' : 'On time';
  state.attendance.push({ studentId: student.id, date, time, status });
  if (status === 'Late entry') {
    state.alerts += 1;
  }
  saveState();
  renderAttendance();
  renderSummary();
  showToast(`Welcome ${student.name}! Attendance marked as ${status}.`);
}

function generateReport(period = 'daily') {
  renderReport(period);
  showToast(`${period.charAt(0).toUpperCase() + period.slice(1)} report generated.`);
}

function adminLogin() {
  const username = document.getElementById('admin-username').value.trim();
  const password = document.getElementById('admin-password').value;
  if (username === 'admin' && password === 'password123') {
    state.adminLogged = true;
    showToast('Admin login successful.');
    return;
  }
  showToast('Invalid admin credentials.');
}

function logOut() {
  state.adminLogged = false;
  showToast('Logged out successfully.');
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(window.toastTimeout);
  window.toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3000);
}

function scrollTo(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function switchPage(pageId) {
  document.querySelectorAll('.page').forEach(page => page.classList.add('hidden'));
  document.getElementById(`${pageId}-page`).classList.remove('hidden');
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.page === pageId));
}

function setupNav() {
  document.querySelectorAll('.nav-button').forEach(button => {
    button.addEventListener('click', () => switchPage(button.dataset.page));
  });
}

function init() {
  detectBiometricCapabilities();
  loadState();
  setupNav();
  renderSummary();
  renderStudents();
  renderAttendance();
  renderReport('daily');
  document.getElementById('report-date').value = new Date().toISOString().slice(0, 10);
}

window.addEventListener('DOMContentLoaded', init);
