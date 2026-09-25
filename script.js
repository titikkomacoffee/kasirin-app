// ==========================================
// 1. INISIALISASI SUPABASE (SESI PERMANEN)
// ==========================================
const SUPABASE_URL = "https://ankprmkhsqkgugzndlcx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFua3BybWtoc3FrZ3Vnem5kbGN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNzI2NzgsImV4cCI6MjEwNTg0ODY3OH0.D48Jxrv2f51Ggl9yT5Tayme5eDAC_Eo1jpM_pmGfp-E";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let currentUser = null;
let currentProfile = null;
let activeShift = null;
let products = [];
let cart = [];
let storeSettings = { store_name: 'TEMAN COFFEE', pakasir_slug: 'temancoffee', pakasir_api_key: '' };
let selectedPaymentMethod = 'CASH';

// ==========================================
// 2. NOTIFIKASI KEKINIAN (TOASTIFY)
// ==========================================
function showNotif(message, type = 'success') {
  Toastify({
    text: message,
    duration: 3500,
    gravity: "top",
    position: "center",
    stopOnFocus: true,
    style: {
      background: type === 'success' 
        ? "linear-gradient(to right, #10B981, #059669)" 
        : "linear-gradient(to right, #EF4444, #DC2626)",
      borderRadius: "16px",
      fontSize: "12px",
      fontWeight: "bold",
      boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)"
    }
  }).showToast();
}

// ==========================================
// 3. INITIALIZATION & SESSION
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
  await checkUserSession();
  await loadStoreSettingsFromSupabase();
  await loadExpenseCategories();
  await loadProducts();
  await checkActiveShift();
  await updateDashboardStats();
});

async function checkUserSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && session.user) {
    currentUser = session.user;
    
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();

    currentProfile = profile || { role: 'kasir', full_name: currentUser.email };
    const roleText = (currentProfile.role || 'KASIR').toUpperCase();
    document.getElementById('userStatusHeader').innerText = `${roleText}: ${currentProfile.full_name || currentUser.email}`;

    // HAK AKSES BERDASARKAN ROLE:
    // Admin: Mengatur Integrasi Pakasir, Produk, dan Manajemen Karyawan.
    // Kasir / Manajer: Hanya bisa transaksi, absensi, dan lihat laporan shift.
    if (currentProfile.role === 'admin') {
      document.getElementById('sectionEmployeeMgmt').classList.remove('hidden');
      document.getElementById('sectionProductMgmt').classList.remove('hidden');
      document.getElementById('sectionPakasirMgmt').classList.remove('hidden');
      document.getElementById('btnManageCategories').classList.remove('hidden');
      document.getElementById('btnAbsenHeader').classList.add('hidden'); // Admin tidak perlu absen
      loadEmployeeList();
    } else {
      document.getElementById('btnAbsenHeader').classList.remove('hidden'); // Kasir/Manajer
    }
  }
}

async function handleUserLogout() {
  await supabaseClient.auth.signOut();
  showNotif("Berhasil keluar akun");
  window.location.reload();
}

// ==========================================
// 4. SUPABASE PAKASIR INTEGRATION
// ==========================================
async function loadStoreSettingsFromSupabase() {
  const { data } = await supabaseClient.from('store_settings').select('*').eq('id', 1).maybeSingle();
  if (data) {
    storeSettings = data;
    document.getElementById('storeNameHeader').innerText = data.store_name || 'TEMAN COFFEE POS';
    document.getElementById('storeNameInput').value = data.store_name || '';
    document.getElementById('pakasirSlugInput').value = data.pakasir_slug || '';
    document.getElementById('pakasirApiKeyInput').value = data.pakasir_api_key || '';
  }
}

async function savePakasirSettingsToSupabase() {
  const storeName = document.getElementById('storeNameInput').value;
  const slug = document.getElementById('pakasirSlugInput').value;
  const apiKey = document.getElementById('pakasirApiKeyInput').value;

  const { error } = await supabaseClient.from('store_settings').upsert({
    id: 1,
    store_name: storeName,
    pakasir_slug: slug,
    pakasir_api_key: apiKey
  });

  if (!error) {
    showNotif("Pengaturan PAKASIR & Toko Berhasil Disimpan di Supabase!");
    loadStoreSettingsFromSupabase();
  } else {
    showNotif(error.message, "error");
  }
}

// ==========================================
// 5. DASHBOARD STATS (PEMBARUAN DASHBOARD)
// ==========================================
async function updateDashboardStats() {
  const today = new Date().toISOString().split('T')[0];

  // Hitung Penjualan Hari Ini
  const { data: sales } = await supabaseClient
    .from('transactions')
    .select('total_amount')
    .gte('created_at', `${today}T00:00:00Z`);

  const totalSales = (sales || []).reduce((sum, item) => sum + parseFloat(item.total_amount), 0);
  document.getElementById('dashTotalSalesText').innerText = `Rp ${totalSales.toLocaleString('id-ID')}`;
  document.getElementById('dashTotalOrdersText').innerText = (sales || []).length;

  // Render Peringatan Stok Menipis
  const lowStockContainer = document.getElementById('lowStockList');
  const lowStockItems = products.filter(p => p.stock < 5);

  if (lowStockItems.length > 0) {
    lowStockContainer.innerHTML = lowStockItems.map(p => `
      <div class="flex justify-between items-center p-2 bg-red-50 rounded-xl border border-red-100 text-xs">
        <span class="font-bold text-gray-800">${p.name}</span>
        <span class="font-black text-red-600">Sisa ${p.stock} cup</span>
      </div>
    `).join('');
  } else {
    lowStockContainer.innerHTML = `<p class="text-xs text-gray-400">Semua stok produk aman.</p>`;
  }
}

// ==========================================
// 6. PRODUK, CART, DAN AI GENERATOR
// ==========================================
async function loadProducts() {
  const { data } = await supabaseClient.from('products').select('*');
  products = data || [];
  renderProductGrid();
  renderAdminProductList();
  updateDashboardStats();
}

function renderProductGrid() {
  const grid = document.getElementById('productGrid');
  grid.innerHTML = '';
  products.forEach(p => {
    grid.innerHTML += `
      <div class="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm space-y-2">
        <img src="${p.image_url || 'https://via.placeholder.com/150'}" class="w-full h-24 object-cover rounded-xl">
        <h4 class="font-bold text-xs text-gray-800 line-clamp-1">${p.name}</h4>
        <div class="flex justify-between items-center">
          <p class="text-[11px] font-black text-purple-700">Rp ${parseFloat(p.price).toLocaleString('id-ID')}</p>
          <span class="text-[10px] text-gray-400">Stok: ${p.stock}</span>
        </div>
        <button onclick="addToCart('${p.id}')" class="w-full bg-purple-50 text-purple-700 font-bold py-1.5 rounded-xl text-[11px] hover:bg-purple-600 hover:text-white transition">
          + Tambah
        </button>
      </div>`;
  });
}

function generateAIProductImage() {
  const prodName = document.getElementById('prodNameInput').value || 'Coffee Drink';
  const aiGeneratedUrl = `https://pollinations.ai/p/${encodeURIComponent(prodName + ' coffee drink professional photo 8k')}?width=400&height=400&seed=${Math.floor(Math.random() * 1000)}`;
  document.getElementById('prodImageInput').value = aiGeneratedUrl;
  showNotif("Foto AI Produk Berhasil Dibuat!");
}

function addToCart(productId) {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  const existing = cart.find(item => item.id === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...prod, qty: 1 });
  }

  showNotif(`${prod.name} ditambahkan ke keranjang`);
  updateCartBadge();
}

function updateCartBadge() {
  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
  document.getElementById('cartCountBadge').innerText = totalQty;
}

// ==========================================
// 7. TRANSAKSI & PAKASIR AUTOMATIC QRIS
// ==========================================
function openPaymentModal() {
  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  if (total <= 0) return showNotif("Keranjang belanja masih kosong!", "error");

  document.getElementById('payModalTotalText').innerText = `Rp ${total.toLocaleString('id-ID')}`;
  
  // Render Item Keranjang
  const summaryList = document.getElementById('cartSummaryList');
  summaryList.innerHTML = cart.map(i => `
    <div class="flex justify-between items-center py-1">
      <span>${i.name} x${i.qty}</span>
      <span class="font-bold">Rp ${(i.price * i.qty).toLocaleString('id-ID')}</span>
    </div>
  `).join('');

  document.getElementById('paymentModal').classList.remove('hidden');
  selectPaymentMethod('CASH'); // Default Cash
}

function selectPaymentMethod(method) {
  selectedPaymentMethod = method;
  const btnCash = document.getElementById('btnPayCash');
  const btnQris = document.getElementById('btnPayQris');
  const qrisArea = document.getElementById('qrisDisplayArea');

  if (method === 'PAKASIR_QRIS') {
    btnQris.className = "p-3 border-2 border-purple-600 rounded-2xl bg-purple-50 text-purple-700 font-bold text-xs flex flex-col items-center gap-1";
    btnCash.className = "p-3 border-2 border-gray-200 rounded-2xl bg-gray-50 text-gray-600 font-bold text-xs flex flex-col items-center gap-1";
    
    // Tarik Slug Pakasir dari Supabase
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const slug = storeSettings.pakasir_slug || 'temancoffee';
    const orderId = `INV-${Date.now()}`;
    
    // Dynamic QRIS Pakasir URL
    const pakasirUrl = `https://pakasir.com/api/qris?project=${slug}&amount=${totalAmount}&order_id=${orderId}`;
    document.getElementById('qrisImage').src = pakasirUrl;
    qrisArea.classList.remove('hidden');
  } else {
    btnCash.className = "p-3 border-2 border-purple-600 rounded-2xl bg-purple-50 text-purple-700 font-bold text-xs flex flex-col items-center gap-1";
    btnQris.className = "p-3 border-2 border-gray-200 rounded-2xl bg-gray-50 text-gray-600 font-bold text-xs flex flex-col items-center gap-1";
    qrisArea.classList.add('hidden');
  }
}

async function confirmTransaction() {
  const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  if (totalAmount <= 0) return;

  const { error } = await supabaseClient.from('transactions').insert([{
    user_id: currentUser ? currentUser.id : null,
    shift_id: activeShift ? activeShift.id : null,
    total_amount: totalAmount,
    payment_method: selectedPaymentMethod,
    status: 'success'
  }]);

  if (!error) {
    showNotif("Transaksi Berhasil Diselesaikan!");
    cart = [];
    updateCartBadge();
    closePaymentModal();
    updateDashboardStats();
  } else {
    showNotif(error.message, "error");
  }
}

// ==========================================
// 8. SHIFT CONTROL & KARYAWAN
// ==========================================
async function checkActiveShift() {
  if (!currentUser) return;
  const { data } = await supabaseClient
    .from('shifts')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('status', 'open')
    .maybeSingle();

  activeShift = data;
  const statusEl = document.getElementById('shiftStatusText');
  const btnEl = document.getElementById('btnToggleShift');

  if (activeShift) {
    statusEl.innerText = "Shift Aktif (Berjalan)";
    statusEl.className = "text-xs font-bold text-emerald-600";
    btnEl.innerText = "Close Shift";
    btnEl.className = "bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl";
  } else {
    statusEl.innerText = "Shift Belum Dibuka";
    statusEl.className = "text-xs font-bold text-red-500";
    btnEl.innerText = "Buka Shift";
    btnEl.className = "bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl";
  }
}

async function handleShiftAction() {
  if (activeShift) {
    const actualCash = prompt("Masukkan total Uang Kas Fisik di Laci saat ini (Rp):");
    if (actualCash === null) return;

    const { error } = await supabaseClient.from('shifts').update({
      end_time: new Date(),
      status: 'closed',
      actual_cash: parseFloat(actualCash) || 0
    }).eq('id', activeShift.id);

    if (!error) {
      showNotif("Shift Berhasil Ditutup!");
      activeShift = null;
      checkActiveShift();
    }
  } else {
    const openingBal = prompt("Masukkan Modal Kas Awal di Laci (Rp):", "100000");
    if (!openingBal) return;

    const { data, error } = await supabaseClient.from('shifts').insert([{
      user_id: currentUser.id,
      opening_balance: parseFloat(openingBal) || 0,
      status: 'open'
    }]).select().single();

    if (!error) {
      showNotif("Shift Berhasil Dibuka!");
      activeShift = data;
      checkActiveShift();
    }
  }
}

// Navigasi & Modal Helper
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
  document.getElementById(`tab${tabName}`).classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(n => n.className = "nav-item text-gray-400 flex flex-col items-center gap-1");
  const activeNav = document.getElementById(`nav${tabName}`);
  if (activeNav) activeNav.className = "nav-item text-purple-600 flex flex-col items-center gap-1";
}

function closePaymentModal() { document.getElementById('paymentModal').classList.add('hidden'); }
function openAttendanceModal() { document.getElementById('attendanceModal').classList.remove('hidden'); }
function closeAttendanceModal() { document.getElementById('attendanceModal').classList.add('hidden'); }
function openAddProductModal() { document.getElementById('productModal').classList.remove('hidden'); }
function closeProductModal() { document.getElementById('productModal').classList.add('hidden'); }
function openAddEmployeeModal() { document.getElementById('employeeModal').classList.remove('hidden'); }
function closeEmployeeModal() { document.getElementById('employeeModal').classList.add('hidden'); }
    
