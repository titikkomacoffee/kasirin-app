// ==========================================
// 1. INISIALISASI SUPABASE (SESI PERMANEN)
// ==========================================
const SUPABASE_URL = "https://ankprmkhsqkgugzndlcx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFua3BybWtoc3FrZ3Vnem5kbGN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNzI2NzgsImV4cCI6MjEwNTg0ODY3OH0.D48Jxrv2f51Ggl9yT5Tayme5eDAC_Eo1jpM_pmGfp-E";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true, // Menyimpan sesi login di localStorage browser/webview
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// State Global Aplikasi
let cart = [];
let products = [];
let paymentMethods = [];
let selectedPaymentMethod = null;
let currentTotalTransaction = 0;
let currentUser = null;
let videoStream = null;

// ==========================================
// 2. CEK SESI USER SAAT APLIKASI DIMUAT
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  await checkUserSession();
  await loadPaymentMethods();
  await loadProducts();
  await loadFinancialSummary();
});

async function checkUserSession() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();

  if (session && session.user) {
    currentUser = session.user;
    
    // Ambil data detail dari tabel profiles
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();

    const roleText = profile && profile.role === 'admin' ? 'Admin' : 'Kasir';
    const nameText = profile && profile.full_name ? profile.full_name : currentUser.email;

    // Tampilkan role dan nama/email secara dinamis
    document.getElementById('userStatusHeader').innerText = `${roleText}: ${nameText}`;
    
    // Jika Admin, tampilkan menu pengaturan khusus
    if (profile && profile.role === 'admin') {
      console.log("Login sebagai Admin");
    }
  } else {
    console.log("Pengguna belum login.");
  }
}


// Fungsi Logout Eksplisit (Hanya keluar jika tombol diklik)
async function handleUserLogout() {
  const confirmLogout = confirm("Apakah Anda yakin ingin keluar dari akun?");
  if (!confirmLogout) return;

  const { error } = await supabaseClient.auth.signOut();
  if (!error) {
    alert("Berhasil keluar dari akun.");
    window.location.reload();
  } else {
    alert("Gagal logout: " + error.message);
  }
}

// ==========================================
// 3. LOGIKA METODE PEMBAYARAN DINAMIS
// ==========================================
async function loadPaymentMethods() {
  const { data, error } = await supabaseClient
    .from('payment_methods')
    .select('*')
    .order('created_at', { ascending: true });

  if (!error && data) {
    paymentMethods = data;
    renderPaymentAdminUI();
  }
}

function renderPaymentAdminUI() {
  const container = document.getElementById('paymentMethodsAdminList');
  if (!container) return;
  container.innerHTML = '';

  paymentMethods.forEach(pm => {
    container.innerHTML += `
      <div class="flex items-center justify-between p-2.5 bg-gray-50 rounded-xl border border-gray-100">
        <span class="text-xs font-bold text-gray-700">${pm.name}</span>
        <label class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" ${pm.is_active ? 'checked' : ''} onchange="togglePaymentMethod('${pm.id}', ${!pm.is_active})" class="sr-only peer">
          <div class="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
        </label>
      </div>`;
  });
}

async function togglePaymentMethod(id, newStatus) {
  const { error } = await supabaseClient
    .from('payment_methods')
    .update({ is_active: newStatus })
    .eq('id', id);

  if (!error) {
    const pm = paymentMethods.find(p => p.id === id);
    if (pm) pm.is_active = newStatus;
    renderPaymentAdminUI();
  }
}

// ==========================================
// 4. LOGIKA MODAL PEMBAYARAN KASIR
// ==========================================
function openPaymentModal() {
  currentTotalTransaction = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  if (currentTotalTransaction <= 0) return alert('Keranjang masih kosong!');

  document.getElementById('payModalTotalText').innerText = `Rp ${currentTotalTransaction.toLocaleString('id-ID')}`;
  
  const container = document.getElementById('paymentMethodButtons');
  container.innerHTML = '';
  
  const activeMethods = paymentMethods.filter(p => p.is_active);

  activeMethods.forEach((pm, index) => {
    const isSelected = index === 0;
    if (isSelected) selectedPaymentMethod = pm;

    container.innerHTML += `
      <button id="pmBtn_${pm.code}" onclick="selectPaymentMethod('${pm.code}')" 
        class="pm-btn py-2.5 px-3 rounded-2xl text-xs font-bold border transition ${isSelected ? 'border-purple-600 bg-purple-50 text-purple-700 shadow-sm' : 'border-gray-200 bg-white text-gray-600'}">
        ${pm.name}
      </button>`;
  });

  document.getElementById('payInputAmount').value = currentTotalTransaction;
  calculateChange();
  document.getElementById('paymentModal').classList.remove('hidden');
}

function selectPaymentMethod(code) {
  selectedPaymentMethod = paymentMethods.find(p => p.code === code);
  document.querySelectorAll('.pm-btn').forEach(btn => {
    btn.className = 'pm-btn py-2.5 px-3 rounded-2xl text-xs font-bold border transition border-gray-200 bg-white text-gray-600';
  });

  const selectedBtn = document.getElementById(`pmBtn_${code}`);
  if (selectedBtn) {
    selectedBtn.className = 'pm-btn py-2.5 px-3 rounded-2xl text-xs font-bold border transition border-purple-600 bg-purple-50 text-purple-700 shadow-sm';
  }

  const cashSection = document.getElementById('cashPaymentSection');
  if (selectedPaymentMethod.is_cash_type) {
    cashSection.classList.remove('hidden');
  } else {
    cashSection.classList.add('hidden');
    document.getElementById('payInputAmount').value = currentTotalTransaction;
    calculateChange();
  }
}

function setQuickAmount(val) {
  document.getElementById('payInputAmount').value = val;
  calculateChange();
}

function setExactAmount() {
  document.getElementById('payInputAmount').value = currentTotalTransaction;
  calculateChange();
}

function resetPayAmount() {
  document.getElementById('payInputAmount').value = '';
  calculateChange();
}

function calculateChange() {
  const payVal = parseFloat(document.getElementById('payInputAmount').value) || 0;
  const change = Math.max(0, payVal - currentTotalTransaction);
  document.getElementById('payChangeText').innerText = `Rp ${change.toLocaleString('id-ID')}`;
}

function closePaymentModal() {
  document.getElementById('paymentModal').classList.add('hidden');
}

async function confirmTransaction() {
  const payVal = parseFloat(document.getElementById('payInputAmount').value) || 0;
  if (selectedPaymentMethod.is_cash_type && payVal < currentTotalTransaction) {
    return alert('Jumlah bayar kurang dari total!');
  }

  const customerName = document.getElementById('payCustomerName').value;
  const tableNumber = document.getElementById('payTableNumber').value;
  const notes = document.getElementById('payNotes').value;
  const changeVal = Math.max(0, payVal - currentTotalTransaction);

  const { error } = await supabaseClient.from('transactions').insert([{
    total_amount: currentTotalTransaction,
    payment_method_id: selectedPaymentMethod.id,
    payment_method: selectedPaymentMethod.code,
    customer_name: customerName,
    table_number: tableNumber,
    notes: notes,
    pay_amount: payVal,
    change_amount: changeVal
  }]);

  if (!error) {
    alert(`Transaksi ${selectedPaymentMethod.name} Berhasil!`);
    cart = [];
    document.getElementById('cartCountBadge').innerText = 0;
    closePaymentModal();
    loadFinancialSummary();
  } else {
    alert('Gagal memproses transaksi: ' + error.message);
  }
}

// ==========================================
// 5. FITUR ABSENSI FOTO KAMERA
// ==========================================
async function openAttendanceModal() {
  document.getElementById('attendanceModal').classList.remove('hidden');
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    document.getElementById('cameraVideo').srcObject = videoStream;
  } catch (err) {
    alert("Gagal membuka kamera: " + err.message);
  }
}

function closeAttendanceModal() {
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
  }
  document.getElementById('attendanceModal').classList.add('hidden');
}

async function takeAttendancePhoto() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  const photoBase64 = canvas.toDataURL('image/jpeg');

  // Simpan data absensi ke Supabase
  const { error } = await supabaseClient.from('attendances').insert([{
    user_id: currentUser ? currentUser.id : null,
    photo_url: photoBase64
  }]);

  if (!error) {
    alert("Absensi berhasil disimpan!");
    closeAttendanceModal();
  } else {
    alert("Gagal menyimpan absensi: " + error.message);
  }
}

// ==========================================
// 6. TAB NAVIGATION
// ==========================================
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(nav => nav.className = 'nav-item text-gray-400 flex flex-col items-center gap-1');

  document.getElementById(`tab${tabName}`).classList.remove('hidden');
  document.getElementById(`nav${tabName}`).className = 'nav-item text-purple-600 flex flex-col items-center gap-1';
      }
